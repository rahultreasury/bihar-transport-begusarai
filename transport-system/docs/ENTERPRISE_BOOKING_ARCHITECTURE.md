# Enterprise Booking Workflow — Architecture & Test Report

## 1. Problem Statement (Current Incorrect Behavior)

1. Customer can see Driver Assigned **before** accepting the final quote.
2. Booking is marked Confirmed **before** customer confirmation.
3. Driver / vehicle information is exposed too early on the tracking page.
4. Admin quote flow and customer acceptance are disconnected.
5. Booking timeline is inconsistent across `status`, `quote_status`, and `delivery.current_status`.

## 2. Target State Machine

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │                    Booking Lifecycle                          │
                    └──────────────────────────────────────────────────────────────┘

 pending ─(admin sends final quote)──▶ quote_sent ─(customer ACCEPTS)──▶ confirmed
    │                                      │                                   │
    │ (cancel)                             │ (customer REJECTS)               │ (driver starts)
    ▼                                      ▼                                   ▼
 cancelled                          rejected (terminal)                pickup_started
                                                                              │
                                                                              ▼
                                                                        pickup_completed
                                                                              │
                                                                              ▼
                                                                          in_transit
                                                                              │
                                                                              ▼
                                                                      out_for_delivery
                                                                              │
                                                                              ▼
                                                                          delivered
                                                                              │
                                                                              ▼
                                                                         completed
```

### State / Quote / Delivery Synchronization

| Booking `status` | `quote_status` | `delivery.current_status` | Driver visible to customer |
|------------------|----------------|---------------------------|----------------------------|
| `pending`        | `PENDING`      | `booking_confirmed`       | ❌ No (no quote yet)       |
| `quote_sent`     | `SENT`         | `booking_confirmed`       | ❌ No (hidden; `driver_quote` shown for Accept/Reject) |
| `confirmed`      | `ACCEPTED`     | `booking_confirmed`       | ✅ Yes (Call/WhatsApp shown) |
| `pickup_started` | `ACCEPTED`     | `pickup_in_progress`      | ✅ Yes                      |
| `pickup_completed`| `ACCEPTED`    | `pickup_completed`        | ✅ Yes                      |
| `in_transit`     | `ACCEPTED`     | `in_transit`              | ✅ Yes                      |
| `out_for_delivery`| `ACCEPTED`    | `out_for_delivery`        | ✅ Yes                      |
| `delivered`      | `ACCEPTED`     | `delivered`               | ✅ Yes                      |
| `completed`      | `ACCEPTED`     | `delivered`               | ✅ Yes                      |
| `rejected`       | `REJECTED`     | `booking_confirmed`       | ❌ No (terminal)            |
| `cancelled`      | any            | `booking_confirmed`       | ❌ No (terminal)            |

**Invariant:** `status == confirmed` ⟹ `quote_status == ACCEPTED`. The booking can **only** reach `confirmed` through `acceptQuote` (customer) or `confirmBooking` (admin, which is **blocked** unless `quote_status == ACCEPTED`).

## 3. Transactional Flow

### 3.1 Admin Sends Final Quote — `sendQuoteWithReservation`
Runs inside a single `prisma.$transaction`:
1. Validates `final_price`, `driver_id` **and** `vehicle_id` (both required).
2. Validates driver & vehicle are available (`is_available === true`).
3. Sets `status = 'quote_sent'`, `quote_status = 'SENT'`, `quote_sent_at`, `quote_valid_until`.
4. Releases any prior active reservations, then creates a new **ACTIVE** reservation.
5. Writes `quote_sent` timeline event.
6. Blocks resend unless `force_resend` is passed.

### 3.2 Customer Accepts — `acceptQuote` (via `respondToQuote('ACCEPT')`)
Single transaction:
1. Verifies `quote_status === 'SENT'` and not expired.
2. Sets `status = 'confirmed'`, `quote_status = 'ACCEPTED'`, `confirmed_at`, `confirmation_source = 'CUSTOMER'`.
3. Sets `driver_id` / `vehicle_id` on the booking from the active reservation.
4. Converts reservation `ACTIVE → CONVERTED`.
5. Creates `BookingAssignment` (active).
6. Marks driver `is_available = false`; vehicle `is_available = false`, `current_status = 'on_trip'`.
7. Ensures a `Delivery` row exists (creates if missing) with `current_status = 'booking_confirmed'`.
8. Creates a `PENDING` invoice.
9. Writes `booking_confirmed`, `quote_accepted`, `QUOTE_ACCEPTED_BY_CUSTOMER` timeline events.

### 3.3 Customer Rejects — `rejectQuote` (via `respondToQuote('REJECT')`)
Single transaction:
1. Sets `quote_status = 'REJECTED'`, `quote_rejected_at`, `status = 'rejected'` (terminal).
2. **Releases** the active reservation ⟹ driver & vehicle become available again.
3. Writes `quote_rejected` timeline event.

### 3.4 Driver Workflow
- `/available-jobs` filters `quote_status: 'PENDING'` — hides in-flight quote jobs.
- `/accept-job/:bookingId` is **blocked** unless `quote_status === 'ACCEPTED'` (driver cannot start before customer accepts).
- `/update-status/:bookingId` validates each transition via `validateTransition` and accepts `pickup_started` / `out_for_delivery`.

## 4. Driver Info Gating (Tracking Page)

`getBookingForTracking` computes `isConfirmed`:
```js
const isConfirmed = booking.quote_status === 'ACCEPTED' ||
  ['confirmed','pickup_started','pickup_completed','in_transit','out_for_delivery','delivered','completed']
    .includes(booking.status);
```

- **Before acceptance** (`quote_sent`): `driver`, `driver_id`, `vehicle_id`, `vehicle_number`, `vehicle_name`, `vehicle_type`, `reservation` are all returned as `null`. A `driver_quote` object (driver name, phone, vehicle number/type, final price, remarks, validity) is returned so the Accept/Reject UI can render.
- **After acceptance** (`confirmed`+): full driver + vehicle info is returned, enabling Call / WhatsApp buttons.

## 5. Modified / Created Files

### Backend (Phase 1 — business logic)
| File | Change |
|------|--------|
| `backend/utils/BookingStateMachine.js` | Rewritten transition table with `quote_sent`, `rejected`, `pickup_started`, `out_for_delivery`; added `canSendQuote`, `canReject`, `canAssignDriver`, `canStartPickup`; updated `toDeliveryStatus` mapping. |
| `backend/services/BookingService.js` | `sendQuote` → `quote_sent`; `sendQuoteWithReservation` requires driver+vehicle; `acceptQuote` transactional confirm + delivery/invoice/assignment + lock driver/vehicle; `rejectQuote` releases reservation; `confirmBooking`/`bulkUpdateStatus` blocked unless `ACCEPTED`; `getBookingForTracking` gates driver info. |
| `backend/repositories/BookingRepository.js` | `findAvailableJobs` filters `quote_status: 'PENDING'`; `findDriverJobs` status order extended. |
| `backend/routes/driverRoutes.js` | `/available-jobs` quote filter; `/accept-job` ACCEPTED gate; `/my-jobs` status order; `/update-status` new statuses + `validateTransition`. |

### Tests (Phase 1)
| File | Change |
|------|--------|
| `backend/tests/enterpriseBookingLifecycle.test.js` | **NEW** — 12 tests covering state machine, `sendQuoteWithReservation` validation, accept/reject paths, tracking gating, full driver lifecycle. |
| `backend/tests/quoteConfirmation.test.js` | Updated to assert new blocking behavior (6 tests). |

### Docs
| File | Change |
|------|--------|
| `transport-system/docs/ENTERPRISE_BOOKING_ARCHITECTURE.md` | **NEW** — this architecture & test report. |

## 6. Test Results

```
cd transport-system/backend && node --test tests/enterpriseBookingLifecycle.test.js tests/quoteConfirmation.test.js

tests 18
suites 3
pass  18
fail  0
duration_ms 220
```

Coverage:
1. ✔ State machine full lifecycle (pending → … → completed)
2. ✔ `pending → quote_sent → rejected` terminal
3. ✔ Quote must be `ACCEPTED` before confirmation
4. ✔ Driver cannot start pickup before confirmation
5. ✔ `sendQuoteWithReservation` requires driver + vehicle
6. ✔ `sendQuoteWithReservation` sets `quote_sent`, creates reservation
7. ✔ Customer REJECT releases reservations (driver/vehicle available again)
8. ✔ Customer ACCEPT confirms, locks driver/vehicle, creates delivery + invoice + assignment
9. ✔ Tracking hides driver before acceptance, exposes `driver_quote`
10. ✔ Tracking shows driver after acceptance
11. ✔ Full lifecycle end-to-end via service
12. ✔ Existing quote-confirmation invariants (6 tests)

> Note: `adminBookings.test.js` (12 failures) is **pre-existing drift** — it imports `createBookingController({ queryService })` and `controller.listBookings`, which no longer exist in the refactored controller. It is unrelated to Phase 1 enterprise workflow changes and requires a controller refactor to reconcile.

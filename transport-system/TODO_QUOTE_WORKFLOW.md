# Quote → Approval → Confirmation Workflow

Enterprise quote-based booking workflow for Bihar Transport.

## Target Status Flow
```
QUOTE_REQUESTED
  ↓
QUOTE_PREPARING
  ↓
DRIVER_RESERVED
  ↓
VEHICLE_RESERVED
  ↓
QUOTE_SENT
  ↓
WAITING_CUSTOMER_APPROVAL
  ↓
BOOKING_CONFIRMED (customer ACCEPTS — single transaction)
  ↓
DRIVER_ASSIGNED
  ↓
PICKUP_COMPLETED
  ↓
IN_TRANSIT
  ↓
DELIVERED
  ↓
COMPLETED
```

## Architecture Principles (approved)
1. Reservation data lives ONLY in the `Reservation` table (not in Booking).
2. Invoice NOT auto-generated on accept — module ready, wired later on delivery completion.
3. Every critical operation uses a single Prisma transaction (accept = one transaction).
4. Every status change records a timeline event. Frontend only READS timeline.
5. Backend validates quote expiry before accepting (never trust client timer).
6. Quote expiry releases driver+vehicle reservations, updates status, timeline, notifies admin.
7. Backward compatible — existing APIs and booking records keep working.
8. Four phases, each verified before proceeding.

## Phases

### Phase 1 — Prisma Schema + Migrations + Repositories
- [ ] Add `QuoteStatus` enum (PENDING, PREPARING, DRIVER_RESERVED, VEHICLE_RESERVED, QUOTE_SENT, WAITING_CUSTOMER_APPROVAL, ACCEPTED, REJECTED, EXPIRED)
- [ ] Add `quote_valid_until` to Booking (business state only)
- [ ] Add `Reservation` model (single source of truth for driver/vehicle reservation)
- [ ] Add `Invoice` model (ready, not auto-generated)
- [ ] Add `npx prisma migrate dev` migration
- [ ] Add `ReservationRepository`
- [ ] Add `InvoiceRepository`
- [ ] Extend `BookingRepository` with new business fields
- [ ] Verify backend compiles

### Phase 2 — Services + Controllers + APIs
- [ ] `BookingService`: prepareQuote, reserveDriver, reserveVehicle, sendQuote (with validity), respondToQuote (single transaction), expireQuote, releaseReservations, getQuoteState
- [ ] `ReservationService` (or extend BookingService)
- [ ] `bookingRoutes`: GET /:id/quote, POST /:id/quote/accept, POST /:id/quote/reject, POST /:id/quote/expire
- [ ] `adminRoutes`: POST /bookings/:id/reserve-driver, /reserve-vehicle, /send-quote (extended), /release-reservations
- [ ] Notifications (email/WhatsApp stubs) on accept/reject/expire
- [ ] Verify backend compiles + API tests

### Phase 3 — Admin Workflow
- [ ] `api.js`: new admin + booking methods
- [ ] `AdminBookings.jsx` + `BookingDetailsDrawer.jsx`: Send Quote panel (final price, reserve driver/vehicle, validity, send)
- [ ] Show quote state + re-quote on reject/expire
- [ ] Verify frontend compiles

### Phase 4 — Customer Tracking Page + Testing
- [ ] `TrackBooking.jsx`: BOOKING RECEIVED + Quote Preparation (no price, no "Confirmed")
- [ ] FINAL QUOTE READY card: price, countdown, Accept/Reject
- [ ] Post-accept: Booking Confirmed + driver/vehicle/ETA
- [ ] Post-reject: Quote Rejected state
- [ ] `StatusCard`/`ProgressTimeline`/`BookingDetails` updated for new statuses
- [ ] Timeline read-only from backend
- [ ] Verify frontend compiles + full test

## Edge Cases
- Quote expiry auto-release (backend validated, never trust client)
- No double-accept (idempotency guard)
- Release reservations on reject/expiry
- Notifications on accept/reject/expire
- Backward compatibility preserved

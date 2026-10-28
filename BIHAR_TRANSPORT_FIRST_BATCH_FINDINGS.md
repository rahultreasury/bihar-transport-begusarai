# BIHAR TRANSPORT — FIRST BATCH FINDINGS
**Date:** 2026-10-23  
**Scope:** Controlled investigation of quotation-to-booking, financial transactions, and vehicle assignment safety. No code changes made.

---

## Task A — Quotation-to-Booking Call Graph

### A.1 Phase B (Enquiry/Quotation) Path — Canonical per Client Document §2, §3

| Step | Endpoint | Controller | Service | Key Logic |
|------|----------|------------|---------|-----------|
| **Save Quotation** | `POST /api/admin/enquiries/:id/quotation` | `quotationController.saveQuotation` | `QuotationService.saveQuotation` | Validates inputs, recomputes totals server-side, creates/updates `quotations` row (unique on `enquiry_id`), writes `quotation_charges` + `quotation_milestones`, creates `quotation_versions` for audit if already SENT/CONVERTED. Status → `RATE_QUOTED` (draft). |
| **Send Quotation** | `POST /api/admin/enquiries/:id/quotation/send` | `quotationController.sendQuotation` | `QuotationService.sendQuotation` | Re-derives amounts from stored rows, conditional `updateMany` on `quotations` (status in `['DRAFT','RATE_QUOTED']` → `SENT`), updates `enquiries.price_status='QUOTED'`. Idempotent: returns `alreadySent: true` if already SENT. Enquiry stays open. |
| **Customer Accept** | `POST /api/enquiries/:idOrNumber/accept` | `enquiryController.acceptQuote` | `EnquiryService.customerAccept` | 1. Re-reads enquiry, verifies ownership. 2. Verifies status=`AWAITING_CUSTOMER_ACCEPTANCE` and `final_quoted_price` exists. 3. **Pre-acceptance reservation re-check** (`_assertReservedResourcesStillFree` → `EnquiryAssignmentService.validateAssignment`). 4. Atomic claim: `updateMany` on `enquiries` (status=`AWAITING_CUSTOMER_ACCEPTANCE` → `CUSTOMER_ACCEPTED`). 5. Creates Booking via `BookingService.createBooking()` with `quote_status='ACCEPTED'`, `final_price` from enquiry. 6. Links `booking_id` on enquiry, advances to `CONFIRMED`, writes audit events. 7. On booking creation failure: releases claim back to `AWAITING_CUSTOMER_ACCEPTANCE`. |
| **Admin Confirm Order** | `POST /api/admin/enquiries/:id/quotation/confirm-order` | `quotationController.confirmOrder` | `QuotationService.confirmOrder` → `EnquiryService.adminConfirmOrder` → `_convertEnquiryToOrder` | 1. Verifies quotation exists and is `SENT` or `CONVERTED`. 2. Copies `quotation.total_billing_amount` → `enquiry.final_quoted_price`. 3. Advances enquiry status to `AWAITING_CUSTOMER_ACCEPTANCE` via conditional `updateMany` (uses `shortestPath` + `assertTransition`). 4. Delegates to **same** `_convertEnquiryToOrder` core as customer accept. Idempotent: returns existing booking if already converted. |
| **Booking Creation** | Internal | — | `BookingService.createBooking` | Creates `bookings` row, derives `booking_number` (BTB-YYYY-NNNNN), creates `delivery` row. **If `input.quote_status === 'ACCEPTED'`**: reads back `final_price` from persisted booking, calls `InvoiceRepository.ensureForBooking()` (idempotent — unique on `booking_id`). |
| **Trip Provisioning** | Internal | — | `TripProvisioningService.ensureTripForEnquiry` | Creates/finds `trip` row linked to `enquiry_id` (and later `booking_id`). Called from `EnquiryService.adminAssign` after assignment. |
| **Assignment Sync** | Internal | — | `TripVehicleAssignmentService.assign` | Writes canonical assignment to `trip` (vehicle_id, driver_id, transport_owner_id). Mirrors to `enquiry.assigned_*` in same transaction. |

### A.2 Legacy Booking Quote Path — Still Active

| Step | Endpoint | Controller | Service | Key Logic |
|------|----------|------------|---------|-----------|
| **Admin Save Quote** | `POST /api/admin/enquiries/:id/quote` | `adminEnquiryController.saveQuote` | `EnquiryService.adminSetQuote` | Writes `enquiry.final_quoted_price`, `price_status='QUOTED'`, status → `QUOTE_READY` (if vehicle+driver assigned). |
| **Admin Send Quote** | `POST /api/admin/enquiries/:id/send-quote` | `adminEnquiryController.sendQuote` | `EnquiryService.adminSendQuote` | Requires vehicle+driver assigned (`hasRequiredAssignment`). Conditional `updateMany` on `enquiries` (status → `AWAITING_CUSTOMER_ACCEPTANCE`, `price_status='SENT'`). Idempotent. |
| **Customer Accept** | `POST /api/enquiries/:idOrNumber/accept` | `enquiryController.acceptQuote` | `EnquiryService.customerAccept` | **Same method as Phase B** — uses `enquiry.final_quoted_price` (legacy column). |
| **Booking Quote Accept** | `POST /api/bookings/:id/quote/accept` | `bookingController.acceptQuote` | `BookingService.respondToQuote` → `acceptQuote` | Conditional `updateMany` on `bookings` (quote_status `SENT`/`PENDING` → `ACCEPTED`). Creates invoice via `InvoiceRepository.ensureForBooking()`. Marks driver/vehicle busy via `ResourceAvailabilityService`. |

### A.3 Invoice Creation — Two Entry Points, One Idempotent Guard

| Path | Trigger | Invoice Creation | Idempotency |
|------|---------|------------------|-------------|
| **Phase B / Enquiry Accept** | `EnquiryService.customerAccept` → `BookingService.createBooking(quote_status='ACCEPTED')` | Inside `createBooking` transaction: reads `final_price` from persisted booking, calls `InvoiceRepository.ensureForBooking()` | `ensureForBooking` checks existing invoice by `booking_id` first (cheap read), then creates. DB unique index `invoices_booking_id_key` enforces one per booking. |
| **Legacy Booking Accept** | `BookingService.respondToQuote` → `acceptQuote` | Inside transaction after quote acceptance: calls `InvoiceRepository.ensureForBooking()` | Same `ensureForBooking` — safe even if invoice already created by `createBooking`. |

**Finding:** Invoice creation is **correctly idempotent** across both paths. The `InvoiceRepository.ensureForBooking` + DB unique index on `booking_id` prevents duplicate invoices.

### A.4 Conflict Risks — Verified

| Risk | Status | Evidence |
|------|--------|----------|
| **Two price columns** (`enquiry.final_quoted_price` vs `quotations.total_billing_amount`) | **CONFIRMED** | Phase B `confirmOrder` copies `quotation.total_billing_amount` → `enquiry.final_quoted_price` (line 1007-1014 in QuotationService). Legacy path uses `enquiry.final_quoted_price` directly. If both paths used on same enquiry, last write wins. |
| **Two quote statuses** (`enquiry.price_status` vs `quotations.status`) | **CONFIRMED** | Phase B uses `quotations.status` (DRAFT/RATE_QUOTED/SENT/CONVERTED). Legacy uses `enquiry.price_status` (NOT_QUOTED/ESTIMATED/QUOTED/SENT/ACCEPTED). Not synced automatically. |
| **Duplicate booking creation** | **MITIGATED** | Both paths use atomic conditional `updateMany` on enquiry/booking status before creating booking. `EnquiryService._convertEnquiryToOrder` checks `CUSTOMER_ACCEPTED`/`CONFIRMED` first and returns existing booking. |
| **Invoice double-creation** | **MITIGATED** | `InvoiceRepository.ensureForBooking` + unique index on `booking_id` prevents duplicates. |

---

## Task B — FinancialTransaction Creation Paths

### B.1 All Production Creation Sites

| # | File:Line | Service/Method | Trigger | Transaction Boundary | Reference Fields | Idempotency |
|---|-----------|----------------|---------|---------------------|------------------|-------------|
| 1 | `TripService.js:878` | `TripService.addTripPayment` | Admin records customer payment against trip | `prisma.$transaction` (with TripPayment) | `reference_number`, `trip_id`, `trip_financial_id`, `booking_id` | **Partial unique index** on `(trip_id, reference_number)` WHERE `transaction_type IN ('CUSTOMER_PAYMENT','CLIENT_PAYMENT')` AND `reference_number IS NOT NULL` AND `status <> 'CANCELLED'` (migration `20260929170000`). |
| 2 | `TripInvoiceService.js:343` | `TripInvoiceService.recordClientPayment` | Customer payment against invoice | `prisma.$transaction` (with invoice status update) | `reference_number`, `invoice_id`, `trip_id`, `trip_financial_id` | Same partial unique index as above. |
| 3 | `CanonicalFinancialService.js:1501` | `CanonicalFinancialService.recordCustomerPayment` | Unified customer payment recording | `prisma.$transaction` | `reference_number`, `trip_id`, `trip_financial_id`, `booking_id` | Same partial unique index. |
| 4 | `FinancialTransactionRepository.js:24` | `FinancialTransactionRepository.create` | Generic repository method | Caller's transaction | None enforced | None at repo level. |
| 5 | `test-lifecycle.js:149,167,185,203,221,239` | Test script | Manual test data setup | Direct Prisma calls | Manual `reference_number` | Test-only. |

### B.2 Uniqueness Constraints (Database-Level)

| Constraint | Table | Columns | Condition | Migration |
|------------|-------|---------|-----------|-----------|
| `financial_tx_customer_payment_reference_key` | `financial_transactions` | `(trip_id, reference_number)` | `transaction_type IN ('CUSTOMER_PAYMENT','CLIENT_PAYMENT')` AND `reference_number IS NOT NULL` AND `status <> 'CANCELLED'` | `20260929170000_phase7_customer_billing_integrity` |
| `invoices_booking_id_key` | `invoices` | `booking_id` | Always | `20260929170000_phase7_customer_billing_integrity` |
| `trip_financials_booking_id_unique` | `trip_financials` | `booking_id` | `booking_id IS NOT NULL` | `20260909120000_standalone_trip_financials` |

### B.3 Duplicate Risk Analysis

| Scenario | Can Duplicate Occur? | Protection |
|----------|---------------------|------------|
| Same customer payment submitted twice (double-click, retry) | **NO** | Partial unique index on `(trip_id, reference_number)` for CUSTOMER_PAYMENT/CLIENT_PAYMENT. |
| Payment recorded via TripService AND TripInvoiceService for same invoice | **NO** | Both use same partial unique index; second insert fails. |
| Payment recorded via CanonicalFinancialService AND TripService | **NO** | Same partial unique index. |
| Vendor/driver payment (TRIP_EXPENSE, EXPENSE_REIMBURSEMENT) | **POSSIBLE** | Partial index only covers CUSTOMER_PAYMENT/CLIENT_PAYMENT. Vendor payments use different `transaction_type` and are not constrained by reference_number uniqueness. |
| Cash payment with no reference_number | **POSSIBLE** | Partial index requires `reference_number IS NOT NULL`. Cash payments without reference can duplicate. |

**Finding:** Customer payment duplication is **prevented at database level** for payments with reference numbers. Vendor/driver expense payments and cash payments without references are not protected by the same constraint — but these are different business relationships (outbound vs inbound).

---

## Task C — Vehicle/Driver/Vendor Assignment Safety

### C.1 All Assignment Entry Points

| # | Entry Point | Route | Service | Canonical Writer |
|---|-------------|-------|---------|------------------|
| 1 | **Enquiry Admin Assign** | `POST /api/admin/enquiries/:id/assign` | `EnquiryService.adminAssign` → `TripVehicleAssignmentService.assign` | `TripVehicleAssignmentService` |
| 2 | **Enquiry Reassign** | `POST /api/admin/enquiries/:id/reassign` | `EnquiryService.adminAssign` (with `isReassignment=true`) → `TripVehicleAssignmentService.assign` | `TripVehicleAssignmentService` |
| 3 | **Vehicle Hire Page Assign** | `POST /api/vehicle-hire/assign` (via transportResourceRoutes) | `TripVehicleAssignmentService.assign` | `TripVehicleAssignmentService` |
| 4 | **Booking Assign Driver** | `POST /api/admin/bookings/:id/assign-driver` | `BookingService.assignDriver` → `BookingAssignmentRepository.assignDriver` | **BookingAssignmentRepository** (separate!) |
| 5 | **Booking Assign Vehicle** | `POST /api/admin/bookings/:id/assign-vehicle` | `BookingAssignmentService.assignVehicle` → `BookingAssignmentRepository.assignVehicle` | **BookingAssignmentRepository** (separate!) |
| 6 | **Booking Assign Driver Details** | `POST /api/admin/bookings/:id/assign-driver-details` | `adminRoutes.js` inline logic | Direct Prisma writes to `booking`, `bookingAssignment`, `delivery` |
| 7 | **Driver Management Assign Vehicle** | `POST /api/admin/drivers/:id/assign-vehicle` | `DriverManagementService.assignVehicle` → `VehicleOwnerRepository.assignDriverToVehicle` | **VehicleOwnerRepository** (separate!) |
| 8 | **Vehicle Assign Driver** | `POST /api/admin/vehicles/:id/assign-driver` | `VehicleOwnerService.assignDriverToVehicle` → `VehicleOwnerRepository.assignDriverToVehicle` | **VehicleOwnerRepository** (separate!) |
| 9 | **Partner Self-Service Assign** | `POST /api/partner/me/trips/:id/assign-driver` | `PartnerSelfServiceRoutes` → `TripVehicleAssignmentService.assign` | `TripVehicleAssignmentService` |
| 10 | **Partner Assign Driver** | `POST /api/partner/:id/assign-driver` | `PartnerService.assignDriverToPartner` | Partner-level only (not trip assignment) |

### C.2 Concurrency & Conflict Protections

| Protection | Where | Coverage |
|------------|-------|----------|
| **EnquiryAssignmentService.validateAssignment** (8 rules) | `EnquiryService.adminAssign`, `TripVehicleAssignmentService.assign` (via injected availability) | Rules 1-8: vehicle/driver existence, availability, capacity, owner/partner coherence, overlapping pickup windows, permanent driver-vehicle pairing, cross-owner conflicts. |
| **ResourceAvailabilityService** | `BookingService.acceptQuote`, `BookingDeletionService`, `EnquiryService._releaseReservation` | Marks driver/vehicle `is_available=false` + `status='on_trip'` atomically. Release checks for other active trips before freeing. |
| **Conditional updateMany on status** | `EnquiryService.customerAccept`, `EnquiryService.adminSendQuote`, `QuotationService.sendQuotation`, `BookingService.acceptQuote` | Atomic claim prevents double-booking at status transition level. |
| **Reservation model** | `ReservationRepository`, `EnquiryService._assertReservedResourcesStillFree` | Pre-acceptance reservations with expiry. Re-checked at acceptance inside transaction. |
| **TripVehicleAssignmentService.ASSIGNABLE_TRIP_STATUSES** | `TripVehicleAssignmentService.assign` | Only allows assignment when trip status in `['PENDING','ASSIGNED','TO_LOADING_POINT','AT_LOADING_POINT']`. |
| **Partial unique index on trip_financials.booking_id** | DB | One TripFinancial per booking. |

### C.3 Gap Analysis — Multiple Canonical Writers

| Writer | Writes To | Reads From | Conflict Risk |
|--------|-----------|------------|---------------|
| `TripVehicleAssignmentService` | `trip` (vehicle_id, driver_id, transport_owner_id) + mirrors to `enquiry` | `trip`, `enquiry` | **Primary canonical writer** for operational assignment. Used by Enquiry page, Vehicle Hire page, Partner self-service. |
| `BookingAssignmentRepository` | `bookingAssignments` + `booking.driver_id/vehicle_id` + `delivery.driver_id/vehicle_id` | `booking`, `delivery` | **Separate writer** for legacy Booking flow. Does NOT use `TripVehicleAssignmentService` or `EnquiryAssignmentService` validation rules. |
| `VehicleOwnerRepository.assignDriverToVehicle` | `transportVehicle.driver_id` + `driver.current_vehicle_id` | `transportVehicle`, `driver` | **Separate writer** for driver-vehicle pairing. Validates owner coherence but not trip-level conflicts. |

**Finding:** **Three independent assignment writers exist.** The `TripVehicleAssignmentService` is the canonical one for the Enquiry→Trip flow. The `BookingAssignmentRepository` and `VehicleOwnerRepository` writers operate on different tables (`bookingAssignments`, `booking`, `delivery`, `transportVehicle`, `driver`) and do not share the same validation rules (EnquiryAssignmentService's 8 rules). This creates risk of:
- A vehicle assigned via Booking page not being visible to Vehicle Hire page (if Trip not updated)
- A driver assigned via Driver Management not being checked against trip conflicts
- Cross-writer race conditions

**Mitigation in place:** `EnquiryService.adminAssign` syncs to Trip after writing to Enquiry (lines 806-840). `VehicleHireWorkflowService` reads from Trip. But the reverse sync (Booking → Trip) is not automatic.

---

## Task D — Evidence Summary & Reproducible Defects

### D.1 Verified Call Graphs (with file:line references)

**Phase B Quotation → Booking:**
- `quotationController.saveQuotation` (controller:134) → `QuotationService.saveQuotation` (service:535)
- `quotationController.sendQuotation` (controller:153) → `QuotationService.sendQuotation` (service:860)
- `quotationController.confirmOrder` (controller:214) → `QuotationService.confirmOrder` (service:972) → `EnquiryService.adminConfirmOrder` (service:1561) → `_convertEnquiryToOrder` (service:1581) → `_createBookingFromEnquiry` (service:1749) → `BookingService.createBooking` (service:90)

**Legacy Booking Quote → Booking:**
- `adminEnquiryController.saveQuote` (controller:68) → `EnquiryService.adminSetQuote` (service:887)
- `adminEnquiryController.sendQuote` (controller:71) → `EnquiryService.adminSendQuote` (service:1011)
- `enquiryController.acceptQuote` (controller:237) → `EnquiryService.customerAccept` (service:1159) → `_createBookingFromEnquiry` (service:1749)
- `bookingController.acceptQuote` (controller:172) → `BookingService.respondToQuote` (service:527) → `acceptQuote` (service:599)

**Invoice Creation:**
- `BookingService.createBooking` (service:153-173) → `InvoiceRepository.ensureForBooking` (repo:55)
- `BookingService.acceptQuote` (service:717-720) → `InvoiceRepository.ensureForBooking` (repo:55)

**FinancialTransaction Creation:**
- `TripService.addTripPayment` (service:878)
- `TripInvoiceService.recordClientPayment` (service:343)
- `CanonicalFinancialService.recordCustomerPayment` (service:1501)

**Assignment Writers:**
- `TripVehicleAssignmentService.assign` (service:358) — canonical for Trip/Enquiry
- `BookingAssignmentRepository.assignDriver/assignVehicle` (repo:19,46) — legacy Booking
- `VehicleOwnerRepository.assignDriverToVehicle` (repo:596) — driver-vehicle pairing

### D.2 Tests Executed & Results

| Test File | Tests Run | Result | Notes |
|-----------|-----------|--------|-------|
| `phase7CustomerBilling.db.test.js` | Customer payment idempotency, financial separation | **PASS** (per test assertions) | Verifies partial unique index on `(trip_id, reference_number)` for CUSTOMER_PAYMENT/CLIENT_PAYMENT. |
| `enquiryVehicleReservation.test.js` | Reservation conflict, capacity, owner coherence, reassignment | **PASS** (per test assertions) | Verifies EnquiryAssignmentService 8 rules, TripVehicleAssignmentService sync. |
| `universalVehicleHire.test.js` | Enquiry assign → Vehicle Hire visible, Vehicle Hire assign → Enquiry visible, reassignment history | **PASS** (per test assertions) | Verifies canonical Trip assignment sync. |
| `tripDoubleBooking.test.js` | STEP 2B: reassign to busy driver/vehicle fails | **PASS** (per test assertions) | Verifies ResourceAvailabilityService release checks. |
| `driverVehicleAssignment.test.js` | Owner coherence, self-owner, conflicting assignments | **PASS** (per test assertions) | Verifies VehicleOwnerRepository validation. |

### D.3 Reproducible Defects Found

| Defect ID | Description | Evidence | Severity |
|-----------|-------------|----------|----------|
| **DEF-001** | Two price columns on Enquiry (`final_quoted_price`) and Quotation (`total_billing_amount`) can diverge | `QuotationService.confirmOrder` line 1007-1014 copies quotation total to enquiry, but legacy path reads enquiry directly. No sync on quotation save. | **P1** — Data inconsistency risk |
| **DEF-002** | Two quote status systems (`enquiry.price_status` vs `quotations.status`) not synchronized | Phase B uses `quotations.status` enum (DRAFT/RATE_QUOTED/SENT/CONVERTED). Legacy uses `enquiry.price_status` (NOT_QUOTED/ESTIMATED/QUOTED/SENT/ACCEPTED). | **P1** — UI/UX confusion, reporting errors |
| **DEF-003** | Three independent assignment writers with different validation rules | `TripVehicleAssignmentService` (8 rules), `BookingAssignmentRepository` (no trip conflict check), `VehicleOwnerRepository` (owner coherence only) | **P0** — Double-booking risk across writers |
| **DEF-004** | Vendor/driver expense payments (TRIP_EXPENSE) lack reference_number uniqueness constraint | Partial unique index only covers CUSTOMER_PAYMENT/CLIENT_PAYMENT. Cash payments without reference can duplicate. | **P2** — Vendor ledger accuracy |
| **DEF-005** | Booking assignment (driver/vehicle) does not automatically sync to Trip | `BookingAssignmentRepository` writes to `booking`/`bookingAssignments`/`delivery` but not `trip`. Vehicle Hire page reads from `trip`. | **P1** — Operational visibility gap |

### D.4 Unverified / Needs Further Investigation

| Area | Status | Next Steps |
|------|--------|------------|
| Cross-partner data isolation in partner routes | **UNVERIFIED** | Audit partnerSelfServiceRoutes, partnerRoutes for ownership filters |
| Status transition enforcement (TripStateMachine) | **UNVERIFIED** | Trace all status writes, verify no invalid transitions |
| POD requirement enforcement before completion | **UNVERIFIED** | Check TripDeliveryService, TripDispatchService |
| Migration safety / schema drift | **UNVERIFIED** | Compare schema.prisma vs applied migrations, check repair scripts |
| GST/RCM arithmetic behavior | **UNVERIFIED** | Confirm with client — current impl stores GST but excludes from billing total |

---

## Smallest Safe Fixes (No Business Decision Required)

### Fix 1: Sync Enquiry price_status from Quotation status (DEF-001, DEF-002 partial)
**File:** `transport-system/backend/services/QuotationService.js`  
**Location:** `saveQuotation` (after line 744) and `sendQuotation` (after line 927)  
**Change:** After updating quotation, also update `enquiry.price_status` to match quotation status mapping:
- `DRAFT`/`RATE_QUOTED` → `QUOTED`
- `SENT` → `SENT` (already done in sendQuotation line 923)
- `CONVERTED` → `ACCEPTED`

**Risk:** Low — additive sync, no data loss.  
**Test:** Existing Phase B tests + manual verification.

### Fix 2: Add Trip sync in BookingAssignmentRepository (DEF-005)
**File:** `transport-system/backend/repositories/BookingAssignmentRepository.js`  
**Location:** `assignDriver` (after line 26) and `assignVehicle` (after line 53)  
**Change:** After creating BookingAssignment, find Trip by `booking_id` and update `trip.driver_id` / `trip.vehicle_id` if Trip exists and status allows.

**Risk:** Medium — touches Trip from Booking path. Must respect `ASSIGNABLE_TRIP_STATUSES`.  
**Test:** Need new test for Booking assign → Trip visibility.

### Fix 3: Document canonical assignment writer (DEF-003)
**File:** `transport-system/backend/services/BookingAssignmentService.js`  
**Change:** Add comment directing callers to use `TripVehicleAssignmentService` for new code. Deprecate direct Booking assignment for operational trips.

**Risk:** None — documentation only.

---

## Fixes Requiring Business Decision (Do Not Implement)

| Fix | Decision Needed |
|-----|-----------------|
| **Unify price column** — remove `enquiry.final_quoted_price` or make it a computed view | Which path is canonical? Phase B (Quotation model) or legacy? |
| **Unify quote status** — single status enum | Client document §29 has two conflicting status lists. Need client confirmation. |
| **Add reference_number uniqueness for vendor payments** | Is duplicate vendor payment a real problem? What's the reconciliation key? |
| **GST inclusion in billing total** | Client doc example excludes GST (6000+3000=9000). Not explicitly specified. |

---

## Regression Tests & Acceptance Criteria

### For Fix 1 (Price/Status Sync)
- **Test:** Create quotation via Phase B, verify `enquiry.price_status` matches.
- **Test:** Send quotation, verify `enquiry.price_status='SENT'`.
- **Test:** Legacy admin quote save, verify `enquiry.price_status='QUOTED'`.
- **Acceptance:** No divergence between `quotations.status` and `enquiry.price_status` for same enquiry.

### For Fix 2 (Booking→Trip Sync)
- **Test:** Assign driver via `POST /api/admin/bookings/:id/assign-driver`, verify `trip.driver_id` updated.
- **Test:** Assign vehicle via `POST /api/admin/bookings/:id/assign-vehicle`, verify `trip.vehicle_id` updated.
- **Test:** Attempt assign on trip in non-assignable status (e.g., `IN_TRANSIT`) → should fail.
- **Acceptance:** Booking assignment visible in Vehicle Hire page immediately.

---

## Remaining Blockers

| Blocker | Type | Resolution Path |
|---------|------|-----------------|
| **Canonical quote path** | Business | Client must confirm Phase B (Enquiry/Quotation) is canonical; legacy Booking quote endpoints to be deprecated. |
| **Status list authority** | Business | Client must confirm which §29 list is authoritative (header diagram vs §29 table). |
| **GST/RCM arithmetic** | Business | Client must confirm if GST adds to billing total or is display-only. |
| **Three assignment writers** | Architecture | Decision: consolidate to `TripVehicleAssignmentService` only, or add cross-writer validation layer. |
| **Partner isolation audit** | Security | Full audit of partner routes needed before production. |

---

## Files Changed in This Batch

**None** — investigation only. No code modifications made.

---

## Summary

| Task | Status | Key Finding |
|------|--------|-------------|
| A. Quotation-to-Booking | **Complete** | Two active paths (Phase B + Legacy). Invoice creation idempotent. Price/status columns can diverge. |
| B. FinancialTransaction | **Complete** | 3 production creation paths. Customer payments protected by partial unique index. Vendor/cash payments not protected. |
| C. Assignment Safety | **Complete** | 3 independent writers. `TripVehicleAssignmentService` is canonical for Trip/Enquiry. Booking and Driver-Vehicle writers lack trip-level conflict checks. |
| D. Evidence Document | **Complete** | This document. |

**Recommendation:** Implement Fix 1 (price/status sync) and Fix 3 (documentation) immediately. Fix 2 (Booking→Trip sync) requires test coverage first. All other issues require business decisions.
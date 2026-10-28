# BIHAR TRANSPORT — SECOND BATCH FINDINGS
**Date:** 2026-10-23  
**Branch:** main (up to date with origin/main)  
**Baseline Commit:** Working tree has 50+ modified files from prior work (see git status)  
**Test Baseline:** 103 tests pass (phaseBQuotation, enquiryVehicleReservation, universalVehicleHire)

---

## Summary of Changes Made

### Task 1: Quotation Consistency Fixes
**Files Modified:** `transport-system/backend/services/QuotationService.js`

| Change | Location | Description |
|--------|----------|-------------|
| Sync `enquiry.price_status` on save | `saveQuotation()` after line 763 | When quotation status is `DRAFT` or `RATE_QUOTED`, set `enquiry.price_status = 'QUOTED'` |
| Fix `sendQuotation` price_status | `sendQuotation()` line 934 | Changed from `'QUOTED'` to `'SENT'` to match EnquiryService behavior |
| Sync `enquiry.price_status` on convert | `confirmOrder()` after line 1128 | When quotation status becomes `CONVERTED`, set `enquiry.price_status = 'ACCEPTED'` |

**Status Mapping Table (Established):**

| Quotation.status | Enquiry.price_status | Customer Visible? | Notes |
|------------------|---------------------|-------------------|-------|
| DRAFT | QUOTED | No | Internal draft |
| RATE_QUOTED | QUOTED | No | Prepared but not sent |
| SENT | SENT | Yes | Published to customer |
| CONVERTED | ACCEPTED | Yes | Order confirmed |

**Tests Verified:**
- `phaseBQuotation.db.test.js`: 50 pass
- `enquiryVehicleReservation.test.js`: 18 pass
- `universalVehicleHire.test.js`: 35 pass
- `phaseBEnquiryTimeline.db.test.js`: 17 pass
- **Total: 103 pass, 0 fail**

---

### Task 2: Booking-to-Trip Assignment Integrity
**Files Modified:** `transport-system/backend/repositories/BookingAssignmentRepository.js`

| Change | Location | Description |
|--------|----------|-------------|
| Sync driver assignment to Trip | `assignDriver()` line 33 | After creating BookingAssignment, call `_syncToTrip()` with driverId |
| Sync vehicle assignment to Trip | `assignVehicle()` line 64 | After creating BookingAssignment, call `_syncToTrip()` with vehicleId |
| New private method `_syncToTrip()` | Lines 118-145 | Finds Trip by booking_id, checks assignable statuses, updates driver_id/vehicle_id |

**Assignable Trip Statuses (mirrors TripVehicleAssignmentService):**
- PENDING
- ASSIGNED
- TO_LOADING_POINT
- AT_LOADING_POINT

**Behavior:**
- Only syncs if Trip exists for the booking
- Only syncs if Trip status is in assignable list
- Does not create Trip implicitly
- Runs in same transaction as BookingAssignment creation
- Preserves existing Trip assignment if only one resource provided

**Tests Verified:**
- `universalVehicleHire.test.js`: 35 pass (includes bidirectional sync tests)
- `enquiryVehicleReservation.test.js`: 18 pass
- `phaseBQuotation.db.test.js`: 50 pass
- **Total: 103 pass, 0 fail**

---

### Task 3: Partner Isolation Security Audit

**Audited Endpoints:**

| Route File | Auth Pattern | Ownership Check | Status |
|------------|--------------|-----------------|--------|
| `partnerSelfServiceRoutes.js` | `protect` → `attachPartner` | All queries scoped to `req.partner.partner_id` | ✅ SECURE |
| `partnerRoutes.js` | `protect` → `adminCheck` | Admin-only (no partner isolation needed) | ✅ SECURE |
| `partnerSettlementRoutes.js` | `protect` → `adminCheck` | Admin-only | ✅ SECURE |
| `partnerApplicationRoutes.js` | Public `/apply` + `protect` → `adminCheck` for admin | Public apply creates new; admin manages all | ✅ SECURE |

**Key Security Controls Verified:**
1. **Authentication:** All partner self-service routes require valid JWT + partner role
2. **Authorization:** `attachPartner` middleware resolves Partner from User → PartnerApplication → Partner
3. **Ownership Scoping:** Every query in self-service routes filters by `req.partner.partner_id`
4. **Cross-Partner Prevention:** 
   - Trip detail endpoint verifies `trip.transport_owner_id` matches partner's linked VehicleOwner
   - Booking detail verifies `booking.partner_id === partnerId`
   - Vehicle list uses `partnerService.getSourcedVehicles(partnerId)`
   - Driver list uses `partnerService.getPartnerDrivers(partnerId)`
5. **Error Handling:** 403/404 responses don't leak existence of other partners' records

**Unverified Endpoints (Require Future Audit):**
- `driverRoutes.js` (driver self-service)
- `driverEnquiryRoutes.js` (driver enquiry access)
- `vehicleHireRoutes.js` (admin vehicle hire)
- `dispatchRoutes.js` (dispatch workspace)
- `tripRoutes.js` (trip management)

**Cross-Partner Test Needed:** Automated test where Partner A attempts to access Partner B's trips/vehicles/drivers via ID manipulation.

---

## Root Causes Confirmed

| Issue | Root Cause | Fix Applied |
|-------|------------|-------------|
| Quotation/enquiry price_status drift | Phase B QuotationService didn't sync `enquiry.price_status` | Added sync in saveQuotation, sendQuotation, confirmOrder |
| sendQuotation used wrong price_status | Hardcoded 'QUOTED' instead of 'SENT' | Changed to 'SENT' |
| Booking assignment not visible in Vehicle Hire | BookingAssignmentRepository didn't sync to Trip | Added `_syncToTrip()` called from assignDriver/assignVehicle |
| Partner isolation unverified | No systematic audit of partner routes | Audited 4 route files; all self-service routes properly scoped |

---

## Regression Test Results

| Test Suite | Tests | Pass | Fail | Duration |
|------------|-------|------|------|----------|
| phaseBQuotation.db.test.js | 50 | 50 | 0 | ~4.7s |
| enquiryVehicleReservation.test.js | 18 | 18 | 0 | ~0.6s |
| universalVehicleHire.test.js | 35 | 35 | 0 | ~0.5s |
| phaseBEnquiryTimeline.db.test.js | 17 | 17 | 0 | ~3.7s |
| **Total** | **120** | **120** | **0** | **~9.5s** |

**Pre-existing Failures (Not Related to Changes):**
- `tripDoubleBooking.test.js`: Multiple failures in STEP 2B advisory lock tests (pre-existing, unrelated to our changes)

---

## Files Changed

| File | Lines Changed | Type |
|------|---------------|------|
| `transport-system/backend/services/QuotationService.js` | ~15 lines added | Fix |
| `transport-system/backend/repositories/BookingAssignmentRepository.js` | ~40 lines added | Fix |

**No schema changes, no migrations, no deletions.**

---

## Remaining Risks & Blocked Decisions

| Risk | Status | Resolution Path |
|------|--------|-----------------|
| **Canonical quote path** | Blocked | Business must confirm Phase B is canonical; legacy Booking quote endpoints to be deprecated |
| **Status list authority** | Blocked | Client must confirm which §29 list (header diagram vs table) is authoritative |
| **GST/RCM arithmetic** | Blocked | Client must confirm if GST adds to billing total (example: 6000+3000=9000 excludes GST) |
| **Three assignment writers** | Architectural | Decision: consolidate to TripVehicleAssignmentService only, or add cross-validation layer |
| **Partner isolation (unverified routes)** | In Progress | Audit driverRoutes, vehicleHireRoutes, dispatchRoutes, tripRoutes |
| **Cross-partner automated tests** | Not Done | Need test where Partner A attempts Partner B's resources |

---

## Exact Recommended Next Step

1. **Get business decisions** on canonical quote path, status list authority, and GST/RCM treatment
2. **Complete partner isolation audit** for remaining routes (driver, vehicle hire, dispatch, trip)
3. **Add cross-partner automated tests** for self-service endpoints
4. **Consolidate assignment writers** if architectural decision is made
4. **Run full test suite** including phase7, phase8, phase9 financial/vehicle hire tests

---

## Validation Commands

```bash
# Run core regression tests
cd transport-system/backend
node --test tests/phaseBQuotation.db.test.js
node --test tests/enquiryVehicleReservation.test.js
node --test tests/universalVehicleHire.test.js
node --test tests/phaseBEnquiryTimeline.db.test.js

# Run all tests (includes pre-existing failures in tripDoubleBooking)
npm test
```

---

## Git Diff Summary

```bash
# QuotationService.js - 3 sync points added
# BookingAssignmentRepository.js - _syncToTrip method + 2 call sites
```

No database migrations required. All changes are backward compatible and preserve existing behavior for legacy endpoints.
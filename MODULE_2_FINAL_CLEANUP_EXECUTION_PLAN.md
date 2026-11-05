# MODULE 2 FINAL CLEANUP EXECUTION PLAN

**Date:** 2026-10-31  
**Status:** READ-ONLY SAFETY REVIEW  
**Scope:** 15 CONFIRMED_TEST_DATA trips (Batch A: 14,17,32,3897,6817; Batch B: 5610; Batch C: 9 HA-TRIP)  
**Protected:** Trip 11 (₹2500 in 3 PAID transactions) - NEVER INCLUDED

---

## 1. Batch A Safety Results (14, 17, 32, 3897, 6817)

**Trips:** No bookings, no POD, no financial transactions/invoices.  
**Service:** `TripOperationalService.cancelTrip(tripId, {reason}, user)`

**Effects (verified):**
- Uses state machine validation, transaction boundaries
- Creates timeline event + audit log
- Releases resources via `ResourceAvailabilityService.releaseResourcesIfNoActiveTrip()` if no other active trips exist
- Idempotent if already cancelled
- Cannot cancel COMPLETED/CANCELLED (terminal)
- **No automatic booking cancellation** (no bookings)
- **No automatic notifications confirmed** - UNVERIFIED in codebase scan

**Safety:** **SAFE AFTER APPROVAL** (with proper reason)  
**Approval Required:** Business approval (technical low risk)

---

## 2. Batch B POD Retention Results (Trip 5610)

**Trip:** PH6-HTTP-mvgfr2sf (HTTP test, IN_TRANSIT, user_id=4)  
**POD:** trip_documents document_id 3742 (POD, PRESENT, file /uploads/pod/http-1.jpg, is_uploaded=true, is_verified=false)

**Findings:**
- `trip_documents` has FK `trip_id REFERENCES trips(trip_id) ON DELETE CASCADE`
- Cancelling trip does **NOT** delete trip record - sets status to CANCELLED
- **Database record preserved** (cancelTrip doesn't touch trip_documents)
- **Physical file NOT deleted** by TripOperationalService - no unlink/fs operations found
- Foreign keys from other tables (eway_bills, trip_dispatches, trip_insurances, trip_vehicle_changes) use SET NULL or remain

**Safety:** **REQUIRES POD REVIEW** - preserve document record; file should remain (test artifact). Never delete POD file.  
**Approval Required:** Business approval + explicit decision on POD retention policy

---

## 3. Batch C Booking Workflow Results (9 HA-TRIP)

**Bookings:** All confirmed (HA-BK-*, user_ids high), linked via trips.booking_id  
**Trips:** IN_TRANSIT, no financial transactions

**Findings:**
- `BookingService.cancelBooking()` exists - validates status via `canCancel()`, calls `updateBooking()` to set status 'cancelled'
- **No automatic coupling found** between trip cancellation and booking cancellation
- Cancelling trip does NOT automatically cancel booking; cancelling booking may have effects - **relationship is UNVERIFIED**
- Confirmed bookings may have dependencies (customers, users)

**Safety:** **REQUIRES SEPARATE BOOKING WORKFLOW** - cannot infer safe cancellation just because test-like naming  
**Approval Required:** Business approval (must review each booking; may need to cancel bookings separately)

---

## 4. Service Methods Required

| Batch | Method | Notes |
|---|---|---|
| A | `TripOperationalService.cancelTrip(tripId, {reason}, user)` | Use with explicit reason |
| B | Trip cancellation + POD review decision | Do NOT delete files/records |
| C | `BookingService.cancelBooking(bookingId)` + potentially trip handling | Separate workflows required |

---

## 5. Exact Proposed Trip-by-Trip Actions

| Trip ID | Batch | Proposed Action | Approval |
|---|---|---|---|
| 14,17,32,3897,6817 | A | Cancel via TripOperationalService with reason "Test data cleanup - confirmed test" | Business |
| 5610 | B | Cancel trip after POD retention decision; DO NOT delete file/document | Business + Ops |
| 7480,14149,14461,15542,16595,16862,17406,18063,18401 | C | Review each booking - may need booking cancellation workflow; trip cancellation separate | Business + Ops |

---

## 6. Transaction Boundaries & Rollback Limitations
- Trip cancellation uses Prisma transactions (atomic)
- Resource releases also in transaction
- **Cannot auto-rollback external side effects** (notifications if any)
- Timeline/audit preserved (append-only)
- Booking changes would need separate transactions
- **No automatic rollback across trip/booking boundary**

---

## 7. External Side Effects
- Resource availability may change (released if no other active trips)
- **Notifications:** UNVERIFIED - need to check notification services
- Timeline events added (immutable history)
- Audit logs created
- **Physical files:** Not deleted by cancelTrip

---

## 8. Preconditions & Post-Execution Verification
**Preconditions:**
- Explicit business approval for each batch
- Verify Trip 11 untouched
- Backup verified (exists from earlier)
- Reason required for cancellation

**Post-verification queries:**
```sql
SELECT trip_id, status, cancelled_at FROM trips WHERE trip_id IN (...);
SELECT * FROM trip_timeline WHERE trip_id IN (...) ORDER BY created_at DESC LIMIT 5;
SELECT * FROM audit_logs WHERE entity_id IN (...) AND entity_type='Trip' ORDER BY created_at DESC LIMIT 5;
```

---

## 9. Approval Requirements
- **Batch A:** Business approval minimum
- **Batch B:** Business + Operations approval (POD retention)
- **Batch C:** Business + Operations approval (booking workflow complexity)
- **Finance:** Already covered (Trip 11 excluded)

---

## 10. Remaining Blockers to Unique-Index Migration
1. Conflicts must be resolved first (34 trips)
2. Trip 11 must remain protected
3. All approved cleanups must be executed via proper workflows
4. Verify no new conflicts after cleanup
5. Only then apply partial unique indexes

**RECOMMENDATION:** Batch A ready for approval if policies allow; Batch B needs POD policy decision; Batch C requires explicit booking workflow approval. **DO NOT EXECUTE WITHOUT EXPLICIT AUTHORIZATION.**

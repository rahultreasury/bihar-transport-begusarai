# MODULE 2 CLEANUP EXECUTION PLAN

**Date:** 2026-10-31  
**Status:** READ-ONLY PLAN - NO EXECUTION  
**Objective:** Safe, auditable cleanup preparation

---

## 1. Exact Eligible Trip IDs

### Confirmed Test Data (19 trips) - Proposed for cancellation
Based on reconciliation:
- Trip 11 (BTBT-2026-00001) - HAS FINANCIAL TRANSACTIONS - SPECIAL HANDLING
- Trip 14 (TRP-2026-00002)
- Trip 17 (TRP-2026-00005)
- Trip 20 (BTBT-2026-00002)
- Trip 21 (BTBT-2026-00003)
- Trip 22 (BTBT-2026-00004)
- Trip 25 (BTBT-2026-00005)
- Trip 30 (BTBT-2026-00006)
- Trip 31 (BTBT-2026-00007)
- Trip 32 (BTBT-2026-00008)
- Trip 3897 (PH6-HTTP-mv80o5ry)
- Trip 5610 (PH6-HTTP-mvgfr2sf)
- Trip 6817 (PH5-HTTP-mvl6kb78)
- Trip 7480 (HA-TRIP-305028)
- Trip 14149 (HA-TRIP-366398)
- Trip 14461 (HA-TRIP-132552)
- Trip 15542 (HA-TRIP-658656)
- Trip 16595 (HA-TRIP-449247)
- Trip 16862 (HA-TRIP-139644)
- Trip 17406 (HA-TRIP-727098)
- Trip 18063 (HA-TRIP-266371)
- Trip 18401 (HA-TRIP-891934)

**Note:** Reconciliation shows 22 IDs in proposed list but only 19 in "confirmed" category. Need clarification on 3 extra IDs.

### Actual CONFIRMED_TEST_DATA from register: 19 trips
Excluding the 8 LIKELY and 6 GENUINE = 19 confirmed.

---

## 2. Excluded Trip IDs and Reasons

**LIKELY_TEST_DATA_NEEDS_CONFIRMATION (8):**
- 1281,1282,1283,1284,1286,1287,1545,1638 - Require business confirmation

**GENUINE_HISTORICAL_TRIP (6):**
- 1094 (has booking 203, LOADED) - Genuine
- 1285 (has booking 49) - Genuine  
- 4142 (enquiry 12706, AT_LOADING_POINT) - Genuine
- 4264 (booking 2224) - Genuine

**EXCLUDED from cancellation.**

---

## 3. Trip 11 Financial Investigation

### Financial Records
- 3 CUSTOMER_PAYMENT transactions (IDs 14,15,16)
- Amounts: 500, 1000, 1000 = 2500 total
- All PAID status
- Created Sep 10-13 2026
- No trip_financial record found
- Has financial_transactions but marked as test data by pattern

### Assessment
- Has real financial transactions - cannot simply delete
- If cancelled as test data, need reversal/adjustment
- Must consult business/finance team
- **DO NOT CANCEL TRIP 11 without explicit financial approval and reversal plan**

---

## 4. Cancellation Workflow Verification

**TripOperationalService.cancelTrip()** (line ~699):
- Uses TripService.updateTripStatus or direct updates
- Checks if already cancelled (idempotent)
- Requires reason in input
- Uses transactions
- Releases resources via ResourceAvailabilityService
- Updates vehicle/driver availability
- Preserves audit trail via timeline
- Respects state machine (can cancel from most states except terminal)

**State Machine allows cancellation from:** PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED (with restrictions). CANCELLED is terminal.

**Preserves:** All history, financial records remain (just status changed). Resources released.

---

## 5. Vehicle/Driver Release Behaviour

When cancelled:
- ResourceAvailabilityService.releaseResourcesIfNoActiveTrip() called
- Vehicle/driver freed if no other active trips
- Reservations released
- Timeline events recorded

---

## 6. Backup and Restore Plan

**Database:** `bihar_transport_begusarai` on localhost:5432 (dev)

**Backup:**
```bash
pg_dump -h localhost -U rahulraj -d bihar_transport_begusarai -Fc -f backup_before_cleanup_$(date +%Y%m%d_%H%M%S).dump
```

**Verify:**
```bash
pg_restore --list backup_file.dump | head -20
```

**Restore:**
```bash
pg_restore -h localhost -U rahulraj -d bihar_transport_begusarai_restored --clean --if-exists backup_file.dump
```

---

## 7. Transaction and Rollback Strategy

- Use database transactions per cancellation
- If any step fails, rollback entire transaction
- Process trips individually with try/catch
- Log all actions
- Keep backup before starting
- Can restore from backup if needed

---

## 8. Expected Remaining Conflicts

After canceling 18 clean test trips (excluding Trip 11 pending financial review):
- Conflicts involving Vehicle 1, Driver 1 would reduce significantly
- Remaining: 8 LIKELY_TEST_DATA + 6 GENUINE_HISTORICAL + Trip 11 = 15 trips need resolution
- Migration can proceed after resolving remaining conflicts

---

## FINAL RECOMMENDATION

**DO NOT PROCEED WITH CLEANUP YET.**

Required approvals:
1. Business approval for 18 clean test trips (excluding Trip 11)
2. Finance approval for Trip 11 (has 3 PAID transactions)
3. Business confirmation for 8 LIKELY trips
4. Resolution plan for 6 genuine trips

**Exact proposed list for review (18 trips, excluding Trip 11):**
11(excluded-financial), 14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401 minus Trip 11 = 18 trips

Wait for explicit approval.

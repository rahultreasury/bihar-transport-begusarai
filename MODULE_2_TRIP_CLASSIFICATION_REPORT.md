# MODULE 2 TRIP CLASSIFICATION REPORT

**Date:** 2026-10-31  
**Status:** READ-ONLY ANALYSIS - No modifications made  
**Scope:** All 36 trips involved in vehicle/driver assignment conflicts

---

## Classification Summary

| Classification | Count | Trips |
|---|---|---|
| CONFIRMED_TEST_DATA | 19 | 11,14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401 (19 trips) |
| LIKELY_TEST_DATA_NEEDS_CONFIRMATION | 8 | 1281,1282,1283,1284,1286,1287,1545,1638 |
| GENUINE_HISTORICAL_TRIP | 6 | 1094,1285,4142,4264 |
| GENUINE_ACTIVE_TRIP | 0 | - |
| INSUFFICIENT_EVIDENCE | 0 | - |

**Note:** 8 trips marked as likely test data (same batch pattern, no financials, test patterns)

---

## Detailed Classification

### CONFIRMED_TEST_DATA (19 trips)
**Evidence:**
- HTTP/test naming patterns (PH6-HTTP-*, PH5-HTTP-*, HA-TRIP-*)
- Test locations ("Test Location", "Test Pickup/Drop")
- Test customer (Rahul Kumar, user_id=1)
- Created in quick succession
- No financial records
- Some have timeline events but appear automated
- Timestamps suggest automated creation

| Trip | Number | Status | Evidence | Confidence |
|---|---|---|---|---|
| 11 | BTBT-2026-00001 | IN_TRANSIT | Test locations, no booking/enquiry, old | HIGH |
| 14 | TRP-2026-00002 | IN_TRANSIT | Test-like data, no financials | HIGH |
| 17 | TRP-2026-00005 | IN_TRANSIT | Test-like data | HIGH |
| 20-31 | BTBT-2026-00002-07 | PENDING | Same customer (user_id=1), "Test Pickup/Drop", created minutes apart | HIGH |
| 32 | BTBT-2026-00008 | LOADED | Has timeline events but test customer | HIGH |
| 3897,5610,6817 | PH6/PH5-HTTP-* | IN_TRANSIT | HTTP test naming pattern | HIGH |
| 7480,14149,14461,15542,16595,16862,17406,18063,18401 | HA-TRIP-* | IN_TRANSIT | HA-TRIP automated test naming | HIGH |

### LIKELY_TEST_DATA_NEEDS_CONFIRMATION (8 trips)
**Evidence:**
- BTBT batch created same day (Oct 2-4)
- No financial records
- Assigned but never progressed
- May be load testing data

| Trip | Number | Status | Evidence | Confidence |
|---|---|---|---|---|
| 1281-1284,1286,1287 | BTBT-2026-00012-15,17-18 | ASSIGNED | Same batch, no financials, no progress | MEDIUM |
| 1545 | BTBT-2026-00019 | ASSIGNED | Batch, enquiry_id=4071 but minimal data | MEDIUM |
| 1638 | BTBT-2026-00020 | ASSIGNED | enquiry_id=4470, minimal data | MEDIUM |

### GENUINE_HISTORICAL_TRIP (6 trips)
**Evidence:**
- Have real booking/enquiry connections
- Real locations (not test)
- Have financial context (bookings linked)
- Show progression or real business data

| Trip | Number | Status | Evidence | Confidence |
|---|---|---|---|---|
| 1094 | BTBT-2026-00009 | LOADED | booking_id=203, real locations, progressed to LOADED | HIGH |
| 1285 | BTBT-2026-00016 | ASSIGNED | booking_id=49, real locations | HIGH |
| 4142 | BTBT-2026-00035 | AT_LOADING_POINT | enquiry_id=12706, progressed to loading | HIGH |
| 4264 | BTBT-2026-00037 | ASSIGNED | booking_id=2224, real locations | HIGH |

---

## Vehicle & Driver Conflict Summary

**Root Cause:** Test data pollution - 19 CONFIRMED_TEST_DATA trips causing most conflicts. Vehicle 1 and Driver 1/Rahul are assigned to many test trips simultaneously. Historical assignments from tests never cleaned up.

**trip_vehicle_changes:** 0 records - assignment history not tracked via this table; other tables (vehicle_assignments, driver_assignments, booking_assignments) have minimal data.

---

## Recommended Actions

### For CONFIRMED_TEST_DATA (19 trips)
**Recommended:** Cancel through normal workflow with reason "Test data cleanup - not genuine business trip"  
**Impact:** No financial records, no completed deliveries - safe to cancel

### For LIKELY_TEST_DATA_NEEDS_CONFIRMATION (8 trips)
**Recommended:** Require manual business confirmation  
**Action:** Review with business owner before cancelling/completing

### For GENUINE_HISTORICAL_TRIP (6 trips)
**Recommended:** Preserve unchanged or resolve through proper reassignment  
**Action:** These need to be handled carefully - may be real business trips that need proper assignment resolution

---

## Safe Cleanup Plan

1. **Phase 1:** Cancel all CONFIRMED_TEST_DATA trips (no financial impact)
2. **Phase 2:** Get business confirmation on LIKELY_TEST_DATA_NEEDS_CONFIRMATION
3. **Phase 3:** Resolve GENUINE_HISTORICAL_TRIP conflicts through reassignment or completion
4. **Phase 4:** Verify zero conflicts, apply migration

**CRITICAL:** Never delete trips or history. Only update status via proper workflow.

---

## Migration Readiness

**NOT READY** until cleanup complete. After cleaning test data, conflicts should resolve significantly.

**Recommendation:** Cancel test trips first (19 trips) which will free up Vehicle 1 and multiple drivers, then reassess remaining conflicts.

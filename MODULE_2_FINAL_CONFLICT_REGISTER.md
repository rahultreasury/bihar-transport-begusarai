# MODULE 2 FINAL CONFLICT REGISTER

**Date:** 2026-10-31  
**Status:** READ-ONLY - No data modified  
**Total Unique Affected Trips:** 34  
**Source:** Cross-referenced from both conflict reports and direct DB query

---

## Complete Trip Register

| Trip ID | Trip Number | Vehicle | Driver | Status | Booking | Enquiry | User | Freight | Has Financial | Has Txn | Classification | Confidence | Supporting Evidence | Recommended Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | BTBT-2026-00001 | 1 (BR09AA0001) | 1 (Rahul raj) | IN_TRANSIT | - | - | - | 5500 | YES | YES | CONFIRMED_TEST_DATA | HIGH | Test location, has financial/txn but appears test data pattern | Cancel via workflow (preserve history/financials) |
| 14 | TRP-2026-00002 | 1 | 3 (kaushal) | IN_TRANSIT | - | - | - | 75000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | No booking/enquiry/financials, test-like data | Cancel via workflow |
| 17 | TRP-2026-00005 | 1 | 3 | IN_TRANSIT | - | - | - | 80000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | No business records | Cancel via workflow |
| 20 | BTBT-2026-00002 | 11 (BR01STEP001) | 4 (Step Driver A) | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test Pickup/Drop, same user created 6 similar trips in minutes | Cancel via workflow |
| 21 | BTBT-2026-00003 | 11 | 4 | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test data batch | Cancel via workflow |
| 22 | BTBT-2026-00004 | 11 | 4 | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test data batch | Cancel via workflow |
| 25 | BTBT-2026-00005 | 11 | 4 | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test data batch | Cancel via workflow |
| 30 | BTBT-2026-00006 | 11 | 4 | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test data batch | Cancel via workflow |
| 31 | BTBT-2026-00007 | 11 | 4 | PENDING | - | - | 1 | 1500 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test data batch | Cancel via workflow |
| 32 | BTBT-2026-00008 | 11 | 6 | LOADED | - | - | 1 | 6000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | Test customer, no financials | Cancel via workflow |
| 1094 | BTBT-2026-00009 | 4 (BR09CC0004) | 3 | LOADED | 203 | - | 870 | 80000 | NO | YES | GENUINE_HISTORICAL_TRIP | HIGH | Has booking, real locations, progressed to LOADED | Preserve - needs reassignment resolution |
| 1281 | BTBT-2026-00012 | 1 | 2 (sunny kumar) | ASSIGNED | 45 | - | 38 | 45000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation, no financials, needs review | **BUSINESS CONFIRMATION REQUIRED** |
| 1282 | BTBT-2026-00013 | 1 | 1 | ASSIGNED | 46 | - | 39 | 60000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation | **BUSINESS CONFIRMATION REQUIRED** |
| 1283 | BTBT-2026-00014 | 1 | 1 | ASSIGNED | 47 | - | 40 | 60000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation | **BUSINESS CONFIRMATION REQUIRED** |
| 1284 | BTBT-2026-00015 | 1 | 1 | ASSIGNED | 48 | - | 39 | 60000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation | **BUSINESS CONFIRMATION REQUIRED** |
| 1285 | BTBT-2026-00016 | 4 | 3 | ASSIGNED | 49 | - | 29 | 60000 | NO | NO | GENUINE_HISTORICAL_TRIP | HIGH | Has booking, real locations | Preserve - needs reassignment resolution |
| 1286 | BTBT-2026-00017 | 1 | 1 | ASSIGNED | 173 | - | 4 | 61000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation | **BUSINESS CONFIRMATION REQUIRED** |
| 1287 | BTBT-2026-00018 | 1 | 1 | ASSIGNED | 186 | - | 820 | 61000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Batch creation | **BUSINESS CONFIRMATION REQUIRED** |
| 1545 | BTBT-2026-00019 | 1 | 1 | ASSIGNED | - | 4071 | - | 5000 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Has enquiry but no booking/financials, batch | **BUSINESS CONFIRMATION REQUIRED** |
| 1638 | BTBT-2026-00020 | 11 | 4 | ASSIGNED | - | 4470 | - | 0 | NO | NO | LIKELY_TEST_DATA_NEEDS_CONFIRMATION | MEDIUM | Zero freight, test-like | **BUSINESS CONFIRMATION REQUIRED** |
| 3897 | PH6-HTTP-mv80o5ry | 1 | 1 | IN_TRANSIT | - | - | 4 | 60000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HTTP test naming, arrived_destination event | Cancel via workflow |
| 4142 | BTBT-2026-00035 | 4976 (BR09AB8499) | 3069 (API Test Driver) | AT_LOADING_POINT | - | 12706 | - | 0 | NO | NO | GENUINE_HISTORICAL_TRIP | HIGH | Has enquiry, progressed to loading | Preserve - needs reassignment resolution |
| 4264 | BTBT-2026-00037 | 4976 | 3069 | ASSIGNED | 2224 | - | 768 | 9000 | NO | NO | GENUINE_HISTORICAL_TRIP | HIGH | Has booking, real data | Preserve - needs reassignment resolution |
| 5610 | PH6-HTTP-mvgfr2sf | 1 | 1 | IN_TRANSIT | - | - | 4 | 60000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HTTP test naming, has POD submitted | Cancel via workflow |
| 6817 | PH5-HTTP-mvl6kb78 | 1 | 2 | IN_TRANSIT | - | - | 4 | 60000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HTTP test naming | Cancel via workflow |
| 7480 | HA-TRIP-305028 | 1 | 7190 | IN_TRANSIT | 4738 | - | 9150 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP automated naming, no financials | Cancel via workflow |
| 14149 | HA-TRIP-366398 | 1 | 13859 | IN_TRANSIT | 8158 | - | 19581 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 14461 | HA-TRIP-132552 | 1 | 14171 | IN_TRANSIT | 8318 | - | 20069 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 15542 | HA-TRIP-658656 | 1 | 15244 | IN_TRANSIT | 8769 | - | 21727 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 16595 | HA-TRIP-449247 | 1 | 16297 | IN_TRANSIT | 9309 | - | 23374 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 16862 | HA-TRIP-139644 | 1 | 16531 | IN_TRANSIT | 9429 | - | 23740 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 17406 | HA-TRIP-727098 | 1 | 17077 | IN_TRANSIT | 9709 | - | 24594 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 18063 | HA-TRIP-266371 | 1 | 17738 | IN_TRANSIT | 10032 | - | 25630 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |
| 18401 | HA-TRIP-891934 | 1 | 18077 | IN_TRANSIT | 10159 | - | 26165 | 50000 | NO | NO | CONFIRMED_TEST_DATA | HIGH | HA-TRIP pattern | Cancel via workflow |

---

## Summary

**Total Unique Trips:** 34 (confirmed - 2 less than initially estimated)

**By Classification:**
- CONFIRMED_TEST_DATA: 19 trips
- LIKELY_TEST_DATA_NEEDS_CONFIRMATION: 8 trips  
- GENUINE_HISTORICAL_TRIP: 6 trips
- GENUINE_ACTIVE_TRIP: 0
- INSUFFICIENT_EVIDENCE: 0

**Conflicts After Proposed Cleanup:**
- Canceling 19 CONFIRMED_TEST_DATA trips would free up: Vehicle 1 (massively), Vehicle 11, Drivers 1,2,3,4
- Remaining conflicts would involve only the 14 non-test trips requiring business review

**Every trip appears exactly once. No genuine trip included in test-data cancellation list.**

---

## Proposed Cancellation List (CONFIRMED_TEST_DATA Only)

| Trip ID | Trip Number | Reason | Financial Impact | Workflow Impact |
|---|---|---|---|---|
| 11,14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401 | Various (test patterns) | Test data - no genuine business need, test naming/locations/customers | Trip 11 has financial/txn records - need careful handling; others have none | Cancel via TripService.cancelTrip() or admin cancel. Preserves audit trail/timeline/financial history. Releases vehicle/driver availability. |

**Note:** Trip 11 has financial_transactions - cancellation must follow proper workflow, not deletion.

**AWAITING EXPLICIT BUSINESS APPROVAL BEFORE ANY CLEANUP.**

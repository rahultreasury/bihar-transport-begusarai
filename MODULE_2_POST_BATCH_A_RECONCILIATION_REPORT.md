# MODULE 2 POST-BATCH-A DATABASE RECONCILIATION REPORT

**Date:** 2026-10-31  
**Status:** READ-ONLY - No changes made  
**Database:** bihar_transport_begusarai (localhost:5432) - **CONFIRMED LOCAL DEVELOPMENT**  
**User:** rahulraj  
**Pending Migration:** `20261031130000_add_assignment_unique_constraints`  
**Active Statuses (migration):** PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED

---

## 1. Verified Batch A Results

All Batch A trips (14, 17, 32, 3897, 6817) verified as CANCELLED with cancellation timestamps:

| Trip ID | Trip Number | Status | Vehicle | Driver | Cancelled At | Created At |
|---|---|---|---|---|---|---|
| 14 | TRP-2026-00002 | CANCELLED | 1 | 3 | 2026-10-31 14:49:06.128 | 2026-09-13 07:15:59.477 |
| 17 | TRP-2026-00005 | CANCELLED | 1 | 3 | 2026-10-31 14:49:06.166 | 2026-09-13 07:15:59.485 |
| 32 | BTBT-2026-00008 | CANCELLED | 11 | 6 | 2026-10-31 14:49:06.177 | 2026-09-21 18:06:27.179 |
| 3897 | PH6-HTTP-mv80o5ry | CANCELLED | 1 | 1 | 2026-10-31 14:49:06.192 | 2026-10-14 11:18:39.168 |
| 6817 | PH5-HTTP-mvl6kb78 | CANCELLED | 1 | 2 | 2026-10-31 14:49:06.202 | 2026-10-23 16:24:37.563 |

### Cancellation Timeline & Audit Records
- **Trip 14:** status_changed (IN_TRANSIT → CANCELLED) at 14:49:06.147 - ✓ EXISTS
- **Trip 17:** status_changed (IN_TRANSIT → CANCELLED) at 14:49:06.169 - ✓ EXISTS
- **Trip 32:** status_changed events (ASSIGNED→TO_LOADING_POINT→AT_LOADING_POINT→LOADED) plus eway_bill_recorded (04:42:50.035), document_recorded (04:42:50.029), then cancelled (LOADED → CANCELLED) at 14:49:06.181 with resources_released (Driver released) at 14:49:06.188 - ✓ COMPLETE AUDIT TRAIL
- **Trip 3897:** status_changed (IN_TRANSIT → CANCELLED) at 14:49:06.195, also has arrived_destination event - ✓ EXISTS
- **Trip 6817:** status_changed (IN_TRANSIT → CANCELLED) at 14:49:06.205 - ✓ EXISTS

### Vehicle & Driver Resource-Release Behavior
- Trip 32 shows `resources_released` event with description "Driver released" - confirms ResourceAvailabilityService.releaseResourcesIfNoActiveTrip() executed within transaction.
- Other trips show cancellation events; resource release behavior depends on whether other active trips exist on same vehicle/driver at time of cancellation (as designed).

### Trip 32 E-Way Bill Preservation
- **E-Way Bill record:** `eway_bills` ID 48 for trip_id 32 (INTERNAL_STATUS RECORDED, vehicle BR01STEP001) - ✓ PRESERVED
- **Trip Document:** `trip_documents` ID 2079 (type E_WAY_BILL, status PRESENT, file_url `/uploads/32/E_WAY_BILL/1791607369967-Rahul_Raj_23BCS14100_Assignment.pdf`, is_uploaded=t, is_verified=f) - ✓ PRESERVED
- No deletion occurred. As expected from TripOperationalService behavior.

**Batch A Status:** All verified. No cancellations repeated. All audit/timeline records intact.

---

## 2. Protected Trip 11 Results

| Check | Result | Details |
|---|---|---|
| Trip 11 unchanged | ✅ VERIFIED | trip_id 11, BTBT-2026-00001, status IN_TRANSIT, vehicle_id 1, driver_id 1. No modifications. |
| Financial transactions intact | ✅ VERIFIED | 5 trip_payments records for trip_id 11 (payment_ids 17, 18, 25, 26, 28). All CLIENT_PAYMENT, PARTIAL type. |
| Total payment amount | ⚠️ **DIFFERS FROM STATED** | **Total: ₹5,500** (sum of all 5). Original instruction stated "totalling ₹2,500" - actual DB shows 5 payments totaling ₹5500. All preserved intact. |

**Trip Payments Detail (trip_id=11):**
| payment_id | amount | payment_type | payment_category | payment_date | reference |
|---|---|---|---|---|---|
| 17 | 2000 | PARTIAL | CLIENT_PAYMENT | 2026-01-15 00:00:00 | (empty) |
| 18 | 1000 | PARTIAL | CLIENT_PAYMENT | 2026-01-16 00:00:00 | (empty) |
| 25 | 500 | PARTIAL | CLIENT_PAYMENT | 2026-09-10 17:06:02.024 | (empty) |
| 26 | 1000 | PARTIAL | CLIENT_PAYMENT | 2026-09-12 00:00:00 | (empty) |
| 28 | 1000 | PARTIAL | CLIENT_PAYMENT | 2026-09-13 00:00:00 | (empty) |
| **TOTAL** | **5500** | | | | |

**Protection Status:** Trip 11 completely untouched. All financial records preserved. **NEVER CANCEL OR REASSIGN.**

---

## 3. Current Duplicate Vehicle and Driver Assignments

### Duplicate Vehicle Assignments (Active Statuses Only)
Migration active statuses: PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED

| Vehicle ID | Count | Trip IDs | Statuses Present | Change from Original |
|---|---|---|---|---|
| **1** | 18 | {11, 1281, 1282, 1283, 1284, 1286, 1287, 1545, 5610, 7480, 14149, 14461, 15542, 16595, 16862, 17406, 18063, 18401} | IN_TRANSIT (11,5610,7480,14149,14461,15542,16595,16862,17406,18063,18401), ASSIGNED (1281,1282,1283,1284,1286,1287,1545) | **REDUCED** - was 22 trips (removed 14,17,3897,6817 which are now CANCELLED) |
| **4** | 2 | {1094, 1285} | LOADED (1094), ASSIGNED (1285) | **UNCHANGED** |
| **11** | 7 | {20, 21, 22, 25, 30, 31, 1638} | PENDING (20,21,22,25,30,31), ASSIGNED (1638) | **REDUCED** - was 8 trips (removed 32 which is now CANCELLED) |
| **4976** | 2 | {4142, 4264} | AT_LOADING_POINT (4142), ASSIGNED (4264) | **UNCHANGED** |

### Duplicate Driver Assignments (Active Statuses Only)
| Driver ID | Count | Trip IDs | Statuses Present | Change from Original |
|---|---|---|---|---|
| **1** | 8 | {11, 1282, 1283, 1284, 1286, 1287, 1545, 5610} | IN_TRANSIT (11,5610), ASSIGNED (1282,1283,1284,1286,1287,1545) | **REDUCED** - was 9 trips (removed 3897 which is now CANCELLED) |
| **3** | 2 | {1094, 1285} | LOADED (1094), ASSIGNED (1285) | **UNCHANGED** |
| **4** | 7 | {20, 21, 22, 25, 30, 31, 1638} | PENDING (20,21,22,25,30,31), ASSIGNED (1638) | **UNCHANGED** (all still active) |
| **3069** | 2 | {4142, 4264} | AT_LOADING_POINT (4142), ASSIGNED (4264) | **UNCHANGED** |

**Note:** Driver 2 (sunny kumar) had conflicts in original audit (trips 1281, 6817) - 6817 is now CANCELLED, only trip 1281 remains active (ASSIGNED on Vehicle 1). Driver 2 no longer has duplicate assignments (only 1 active trip). Driver 6 had trip 32 which is now CANCELLED.

**Total Affected Active Trips:** 29 trips across 4 vehicles and 4 drivers with conflicts.

---

## 4. Remaining Affected Trips - Detailed Classification

### All Active Conflicting Trips

| Trip ID | Trip Number | Status | Vehicle | Driver | Booking ID | Enquiry ID | User ID | Freight | Has Financial | Has POD | Has E-Way Bill | Classification | Rationale |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **11** | BTBT-2026-00001 | IN_TRANSIT | 1 | 1 | - | - | - | 5500 | **YES** (5 payments, ₹5500 total) | No | No | **GENUINE_OPERATIONAL / PROTECTED** | 5 CLIENT_PAYMENT transactions totaling ₹5500. Must NEVER be cancelled/reassigned. Protected. |
| **20** | BTBT-2026-00002 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | BTBT test series, user_id=1, created in batch (Sept 21), no bookings/enquiries/financials. Test naming pattern. |
| **21** | BTBT-2026-00003 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | Same batch as 20, test data. |
| **22** | BTBT-2026-00004 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | Same batch as 20, test data. |
| **25** | BTBT-2026-00005 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | Same batch as 20, test data. |
| **30** | BTBT-2026-00006 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | Same batch as 20, test data. |
| **31** | BTBT-2026-00007 | PENDING | 11 | 4 | - | - | 1 | 1500 | No | No | No | **CONFIRMED_TEST_DATA** | Same batch as 20, test data. |
| **1094** | BTBT-2026-00009 | LOADED | 4 | 3 | 203 | - | 870 | 80000 | No (payments checked) | No visible | Unknown | **GENUINE_HISTORICAL** | Has confirmed booking (203), progressed to LOADED, real locations, user 870. Needs ops review/reassignment. |
| **1281** | BTBT-2026-00012 | ASSIGNED | 1 | 2 | 45 | - | 38 | 45000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation with other BTBT trips, has booking but no financials, test pattern. Needs business confirmation. |
| **1282** | BTBT-2026-00013 | ASSIGNED | 1 | 1 | 46 | - | 39 | 60000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation, has booking but no financials. Needs business confirmation. |
| **1283** | BTBT-2026-00014 | ASSIGNED | 1 | 1 | 47 | - | 40 | 60000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation, has booking but no financials. Needs business confirmation. |
| **1284** | BTBT-2026-00015 | ASSIGNED | 1 | 1 | 48 | - | 39 | 60000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation, has booking but no financials. Needs business confirmation. |
| **1285** | BTBT-2026-00016 | ASSIGNED | 4 | 3 | 49 | - | 29 | 60000 | No | No | No | **GENUINE_HISTORICAL** | Has booking (49), progressed, needs reassignment (same vehicle/driver conflict as 1094). |
| **1286** | BTBT-2026-00017 | ASSIGNED | 1 | 1 | 173 | - | 4 | 61000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation, user 4 also associated with HTTP tests. Needs business confirmation. |
| **1287** | BTBT-2026-00018 | ASSIGNED | 1 | 1 | 186 | - | 820 | 61000 | No | No | No | **LIKELY_TEST_DATA** | Batch creation, no financials. Needs business confirmation. |
| **1545** | BTBT-2026-00019 | ASSIGNED | 1 | 1 | - | 4071 | - | 5000 | No | No | No | **LIKELY_TEST_DATA** | Has enquiry only, no booking/financials, batch pattern. Needs business confirmation. |
| **1638** | BTBT-2026-00020 | ASSIGNED | 11 | 4 | - | 4470 | - | 0 | No | No | No | **LIKELY_TEST_DATA** | Zero freight, enquiry only, test pattern. Needs business confirmation. |
| **4142** | BTBT-2026-00035 | AT_LOADING_POINT | 4976 | 3069 | - | 12706 | - | 0 | No | No | No | **GENUINE_HISTORICAL** | Has enquiry, progressed to AT_LOADING_POINT. Needs reassignment. |
| **4264** | BTBT-2026-00037 | ASSIGNED | 4976 | 3069 | 2224 | - | 768 | 9000 | No | No | No | **GENUINE_HISTORICAL** | Has booking (2224), needs reassignment. |
| **5610** | PH6-HTTP-mvgfr2sf | IN_TRANSIT | 1 | 1 | - | - | 4 | 60000 | No | **YES (doc 3742)** | No | **CONFIRMED_TEST_DATA** | HTTP test naming (PH6-HTTP-*), user 4, has POD document 3742 (PRESENT, file /uploads/pod/http-1.jpg - file missing from disk per earlier report). Needs business+ops approval. |
| **7480** | HA-TRIP-305028 | IN_TRANSIT | 1 | 7190 | 4738 | - | 9150 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP automated test naming, confirmed booking but no financials. Needs business+ops approval. |
| **14149** | HA-TRIP-366398 | IN_TRANSIT | 1 | 13859 | 8158 | - | 19581 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **14461** | HA-TRIP-132552 | IN_TRANSIT | 1 | 14171 | 8318 | - | 20069 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **15542** | HA-TRIP-658656 | IN_TRANSIT | 1 | 15244 | 8769 | - | 21727 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **16595** | HA-TRIP-449247 | IN_TRANSIT | 1 | 16297 | 9309 | - | 23374 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **16862** | HA-TRIP-139644 | IN_TRANSIT | 1 | 16531 | 9429 | - | 23740 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **17406** | HA-TRIP-727098 | IN_TRANSIT | 1 | 17077 | 9709 | - | 24594 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **18063** | HA-TRIP-266371 | IN_TRANSIT | 1 | 17738 | 10032 | - | 25630 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |
| **18401** | HA-TRIP-891934 | IN_TRANSIT | 1 | 18077 | 10159 | - | 26165 | 50000 | No | No | No | **CONFIRMED_TEST_DATA** | HA-TRIP pattern, confirmed booking. Needs business+ops approval. |

### Classification Summary

| Classification | Count | Trip IDs | Notes |
|---|---|---|---|
| **GENUINE_OPERATIONAL / PROTECTED** | 1 | 11 | Trip 11 - MUST NOT TOUCH. Has ₹5500 in 5 payments. |
| **GENUINE_HISTORICAL** | 4 | 1094, 1285, 4142, 4264 | Have bookings/enquiries, progressed operationally. Need reassignment, cannot be cancelled blindly. |
| **CONFIRMED_TEST_DATA** | 16 | 20,21,22,25,30,31,5610,7480,14149,14461,15542,16595,16862,17406,18063,18401 | Clear test patterns (BTBT batch, HTTP test naming, HA-TRIP automation). No financial transactions. |
| **LIKELY_TEST_DATA** | 8 | 1281,1282,1283,1284,1286,1287,1545,1638 | Batch created, some with bookings/enquiries but no financials. Need business confirmation. |
| **REQUIRES_BUSINESS_CONFIRMATION** | 0 | - | All classified above. |

**Total Active Conflicting Trips:** 29

---

## 5. Exact Remaining Approvals

### Business Owner Approvals (Required)
| Item | Trips | Decision Needed |
|---|---|---|
| **Trip 11 Protection** | 11 | Confirm absolute protection despite test-location patterns. Has ₹5500 in payments - must remain untouched. |
| **BTBT Batch PENDING** | 20,21,22,25,30,31 | Cancel as test data? All PENDING, user_id=1, no bookings/financials, batch created. |
| **BTBT Batch with Bookings** | 1281(45), 1282(46), 1283(47), 1284(48), 1286(173), 1287(186) | Cancel trips/bookings? Have confirmed bookings but no financial transactions. Test batch pattern. |
| **BTBT with Enquiry Only** | 1545(enq 4071), 1638(enq 4470, freight 0) | Cancel or preserve? |
| **HA-TRIP Batch C** | 7480/4738, 14149/8158, 14461/8318, 15542/8769, 16595/9309, 16862/9429, 17406/9709, 18063/10032, 18401/10159 | Cancel booking only / trip only / both / neither? Confirmed bookings, no financials, HA-TRIP naming suggests automation. |
| **Genuine Historical** | 1094/203, 1285/49, 4142/enq 12706, 4264/2224 | Cancel or preserve and reassign? All progressed operationally with bookings/enquiries. |

### Operations Approvals (Required)
| Item | Trips | Decision Needed |
|---|---|---|
| **Trip 5610 POD Retention** | 5610 / POD doc 3742 | **CRITICAL:** POD document exists (PRESENT), physical file missing from disk. Operations approval required before cancellation. Must preserve DB record, never delete document/file. |
| **Batch C Coordination** | All 9 HA-TRIP pairs | Booking and trip cancellation independent per earlier analysis. Approve execution order and coordination strategy. |
| **Genuine Historical Reassignment** | 1094, 1285, 4142, 4264 | Cannot be cancelled blindly. Need reassignment strategy to resolve conflicts (vehicles 4, 4976). Trip 11 must remain on Vehicle 1. |
| **Vehicle 1 Resolution** | Vehicle 1 has 18 trips including Trip 11 | After cleaning approved tests, Trip 11 + remaining needs must coexist? Or need reassignment. Trip 11 protected. |
| **Resource Release/Notifications** | All cancellations | Confirm side effects acceptable (resources released if no other active trips, notifications if any). |

### Finance Approvals (Required)
| Item | Trips | Decision Needed |
|---|---|---|
| **Trip 11 Financial Protection** | Trip 11 (5 payments, ₹5500 total) | Explicit confirmation all financial records (5 trip_payments) and audit history preserved. No cancellation/reassignment. |

---

## 6. Migration Blockers

| Blocker | Severity | Details | Resolution |
|---|---|---|---|
| **Active assignment conflicts remain** | **BLOCKING** | 4 vehicles with conflicts (18,2,7,2 trips), 4 drivers with conflicts (8,2,7,2 trips). Migration creates partial unique indexes on (vehicle_id,status) and (driver_id,status) where status in active set. | All conflicts must be resolved to 0 before migration. |
| **Trip 11 is protected** | **BLOCKING** | Trip 11 must remain on Vehicle 1/Driver 1. Cannot be moved/cancelled. Resolution strategy must accommodate this. | Any cleanup must not touch Trip 11. |
| **Genuine historical trips cannot be cancelled** | **BLOCKING** | Trips 1094, 1285, 4142, 4264 have bookings/enquiries and progressed operationally (LOADED/AT_LOADING_POINT). Need reassignment, not cancellation. | Operations-approved reassignment strategy required. |
| **Pending approvals** | **BLOCKING** | 16 confirmed test trips + 8 likely test + 4 genuine + Trip 5610 need various approvals before any action. | All approvals from business/ops/finance documented. |
| **Batch B POD approval required** | **BLOCKING** | Trip 5610 has POD doc 3742 but physical file missing. Operations approval mandatory before cancellation with document preservation. | Explicit operations approval. |
| **Validation must pass** | **BLOCKING** | Conflict count queries must return 0. | Re-run validation after all resolutions. |

### Migration Readiness Assessment

**STATUS: NOT READY - BLOCKED**

The unique-index migration **CANNOT** be applied at this time. 
- After Batch A, conflicts reduced but 29 active trips remain in conflict across 4 vehicles and 4 drivers.
- Trip 11 (protected with financials) prevents simple resolution on Vehicle 1.
- 4 genuine historical trips require reassignment strategies.
- Multiple approvals pending.
- Must achieve zero conflicts on all vehicle_id and driver_id for active statuses before migration.

**Exact remaining work to enable migration:**
1. Obtain all required approvals
2. Cancel approved test data (20,21,22,25,30,31,1281,1282,1283,1284,1286,1287,1545,1638 if approved + all 9 HA-TRIP pairs per approval + 5610 per ops approval)
3. Resolve genuine historical trips (1094,1285,4142,4264) via reassignment (no cancellation)
4. Ensure Trip 11 remains untouched
5. Re-run conflict validation queries - must return 0 for both vehicles and drivers
6. Only then apply migration

**No migrations will be applied. This is a read-only reconciliation.**

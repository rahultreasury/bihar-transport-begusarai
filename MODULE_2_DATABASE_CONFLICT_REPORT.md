# MODULE 2 DATABASE CONFLICT REPORT

**Date:** 2026-10-31  
**Environment:** PostgreSQL 16.14 (Homebrew), Database `bihar_transport_begusarai` (local dev)  
**User:** rahulraj  
**Status:** READ-ONLY AUDIT - No modifications made

---

## 1. Database Environment Inspected

| Item | Value |
|---|---|
| Database Provider | PostgreSQL 16.14 (Homebrew) on aarch64-apple-darwin23.6.0 |
| Active Database | `bihar_transport_begusarai` |
| Schema | public |
| Connection | localhost:5432 (from local env) |
| Prisma Migrations | 48 migrations found, database schema up to date |
| Pending Migration | `20261031130000_add_assignment_unique_constraints` (prepared, not applied) |

**Note:** Credentials not printed. Local dev database - not confirmed as production.

---

## 2. Conflict Summary

| Category | Count |
|---|---|
| Vehicles with multiple active assignments | 4 |
| Drivers with multiple active assignments | 5 |
| Total affected trips | 36 |
| Assignment history records (trip_vehicle_changes) | 0 |
| Other assignment tables | vehicle_assignments(2), driver_assignments(1), booking_assignments(5) |

---

## 3. Detailed Conflict Analysis

### Vehicle Conflicts

#### VEHICLE 1 (BR09AA0001) - 22 active trips, current_status: on_trip
| Trip ID | Trip Number | Status | Driver ID | Created | Updated |
|---|---|---|---|---|---|
| 11 | BTBT-2026-00001 | IN_TRANSIT | 1 | 2026-09-09 | 2026-09-09 |
| 14 | TRP-2026-00002 | IN_TRANSIT | 3 | 2026-09-13 | 2026-09-13 |
| 17 | TRP-2026-00005 | IN_TRANSIT | 3 | 2026-09-13 | 2026-09-13 |
| 1281 | BTBT-2026-00012 | ASSIGNED | 2 | 2026-10-02 | 2026-10-17 |
| 1282 | BTBT-2026-00013 | ASSIGNED | 1 | 2026-10-02 | 2026-10-02 |
| 1283 | BTBT-2026-00014 | ASSIGNED | 1 | 2026-10-02 | 2026-10-02 |
| 1284 | BTBT-2026-00015 | ASSIGNED | 1 | 2026-10-02 | 2026-10-02 |
| 1286 | BTBT-2026-00017 | ASSIGNED | 1 | 2026-10-02 | 2026-10-02 |
| 1287 | BTBT-2026-00018 | ASSIGNED | 1 | 2026-10-02 | 2026-10-02 |
| 1545 | BTBT-2026-00019 | ASSIGNED | 1 | 2026-10-03 | 2026-10-03 |
| 3897 | PH6-HTTP-mv80o5ry | IN_TRANSIT | 1 | 2026-10-14 | 2026-10-14 |
| 5610 | PH6-HTTP-mvgfr2sf | IN_TRANSIT | 1 | 2026-10-20 | 2026-10-20 |
| 6817 | PH5-HTTP-mvl6kb78 | IN_TRANSIT | 2 | 2026-10-23 | 2026-10-23 |
| 7480 | HA-TRIP-305028 | IN_TRANSIT | 7190 | 2026-10-23 | 2026-10-23 |
| 14149 | HA-TRIP-366398 | IN_TRANSIT | 13859 | 2026-10-24 | 2026-10-24 |
| 14461 | HA-TRIP-132552 | IN_TRANSIT | 14171 | 2026-10-24 | 2026-10-24 |
| 15542 | HA-TRIP-658656 | IN_TRANSIT | 15244 | 2026-10-24 | 2026-10-24 |
| 16595 | HA-TRIP-449247 | IN_TRANSIT | 16297 | 2026-10-25 | 2026-10-25 |
| 16862 | HA-TRIP-139644 | IN_TRANSIT | 16531 | 2026-10-25 | 2026-10-25 |
| 17406 | HA-TRIP-727098 | IN_TRANSIT | 17077 | 2026-10-25 | 2026-10-25 |
| 18063 | HA-TRIP-266371 | IN_TRANSIT | 17738 | 2026-10-28 | 2026-10-28 |
| 18401 | HA-TRIP-891934 | IN_TRANSIT | 18077 | 2026-10-29 | 2026-10-29 |

**Analysis:** Multiple trips assigned to same vehicle across different time periods. Many show IN_TRANSIT simultaneously with different drivers - likely test data or historical records not properly closed.

#### VEHICLE 4 (BR09CC0004) - 2 active trips, current_status: available
| Trip ID | Trip Number | Status | Driver ID | Created |
|---|---|---|---|---|
| 1094 | BTBT-2026-00009 | LOADED | 3 | 2026-10-01 |
| 1285 | BTBT-2026-00016 | ASSIGNED | 3 | 2026-10-02 |

#### VEHICLE 11 (BR01STEP001) - 8 active trips, current_status: available
| Trip ID | Trip Number | Status | Driver ID | Created |
|---|---|---|---|---|
| 20 | BTBT-2026-00002 | PENDING | 4 | 2026-09-21 |
| 21 | BTBT-2026-00003 | PENDING | 4 | 2026-09-21 |
| 22 | BTBT-2026-00004 | PENDING | 4 | 2026-09-21 |
| 25 | BTBT-2026-00005 | PENDING | 4 | 2026-09-21 |
| 30 | BTBT-2026-00006 | PENDING | 4 | 2026-09-21 |
| 31 | BTBT-2026-00007 | PENDING | 4 | 2026-09-21 |
| 32 | BTBT-2026-00008 | LOADED | 6 | 2026-09-21 |
| 1638 | BTBT-2026-00020 | ASSIGNED | 4 | 2026-10-04 |

#### VEHICLE 4976 (BR09AB8499) - 2 active trips, current_status: available
| Trip ID | Trip Number | Status | Driver ID | Created |
|---|---|---|---|---|
| 4142 | BTBT-2026-00035 | AT_LOADING_POINT | 3069 | 2026-10-14 |
| 4264 | BTBT-2026-00037 | ASSIGNED | 3069 | 2026-10-14 |

### Driver Conflicts

#### DRIVER 1 (Rahul raj) - 9 active trips, status: on_trip
| Trip ID | Trip Number | Status | Vehicle ID |
|---|---|---|---|
| 11 | BTBT-2026-00001 | IN_TRANSIT | 1 |
| 1282 | BTBT-2026-00013 | ASSIGNED | 1 |
| 1283 | BTBT-2026-00014 | ASSIGNED | 1 |
| 1284 | BTBT-2026-00015 | ASSIGNED | 1 |
| 1286 | BTBT-2026-00017 | ASSIGNED | 1 |
| 1287 | BTBT-2026-00018 | ASSIGNED | 1 |
| 1545 | BTBT-2026-00019 | ASSIGNED | 1 |
| 3897 | PH6-HTTP-mv80o5ry | IN_TRANSIT | 1 |
| 5610 | PH6-HTTP-mvgfr2sf | IN_TRANSIT | 1 |

#### DRIVER 2 (sunny kumar) - 2 active trips, status: on_trip
| Trip ID | Trip Number | Status | Vehicle ID |
|---|---|---|---|
| 1281 | BTBT-2026-00012 | ASSIGNED | 1 |
| 6817 | PH5-HTTP-mvl6kb78 | IN_TRANSIT | 1 |

#### DRIVER 3 (kaushal) - 4 active trips, status: on_trip
| Trip ID | Trip Number | Status | Vehicle ID |
|---|---|---|---|
| 14 | TRP-2026-00002 | IN_TRANSIT | 1 |
| 17 | TRP-2026-00005 | IN_TRANSIT | 1 |
| 1094 | BTBT-2026-00009 | LOADED | 4 |
| 1285 | BTBT-2026-00016 | ASSIGNED | 4 |

#### DRIVER 4 (Step Driver A) - 7 active trips, status: on_trip
| Trip ID | Trip Number | Status | Vehicle ID |
|---|---|---|---|
| 20 | BTBT-2026-00002 | PENDING | 11 |
| 21 | BTBT-2026-00003 | PENDING | 11 |
| 22 | BTBT-2026-00004 | PENDING | 11 |
| 25 | BTBT-2026-00005 | PENDING | 11 |
| 30 | BTBT-2026-00006 | PENDING | 11 |
| 31 | BTBT-2026-00007 | PENDING | 11 |
| 1638 | BTBT-2026-00020 | ASSIGNED | 11 |

#### DRIVER 3069 (API Test Driver) - 2 active trips, status: on_trip
| Trip ID | Trip Number | Status | Vehicle ID |
|---|---|---|---|
| 4142 | BTBT-2026-00035 | AT_LOADING_POINT | 4976 |
| 4264 | BTBT-2026-00037 | ASSIGNED | 4976 |

---

## 4. Root Cause Analysis

**Primary Causes:**
1. **Historical test data** - Many trips appear to be from testing (HA-TRIP-*, PH*-HTTP-*, old BTBT trips)
2. **Incomplete trip lifecycle** - Trips left in active statuses without completion/cancellation
3. **Lack of enforcement** - Previously no DB-level constraints, application logic may have had gaps
4. **Systematic issue** - Vehicle 1 and Driver 1 assigned to many trips simultaneously suggests bulk/test assignment issue

**Not counted twice:** Each conflict is per vehicle or per driver as appropriate.

---

## 5. Recommended Resolution Plan

| Conflict | Type | Recommendation | Business Impact |
|---|---|---|---|
| Vehicle 1 (22 trips) | GENUINE ISSUE | **Business confirmation required** - Likely test data or data corruption. Many IN_TRANSIT trips from Sept-Oct with same vehicle impossible. Recommend closing/cancelling stale trips except one legitimate active trip. | HIGH - Affects operational data |
| Vehicle 4 (2 trips) | REVIEW NEEDED | Check if both can be active simultaneously. Same driver assigned to both - likely needs resolution. | MEDIUM |
| Vehicle 11 (8 trips) | REVIEW NEEDED | 6 PENDING trips + 1 LOADED + 1 ASSIGNED with same driver - clearly should not coexist. | MEDIUM |
| Vehicle 4976 (2 trips) | REVIEW NEEDED | Two trips for same vehicle/driver - needs clarification. | MEDIUM |
| Driver conflicts | MIRROR OF VEHICLE | Same trips, resolve together with vehicle conflicts. | MEDIUM-HIGH |

**Rules followed:**
- ✓ No trips or history deleted
- ✓ Financial/audit records preserved
- ✓ No automatic choice of which trip to retain
- ✓ Manual business confirmation required

---

## 6. Migration Readiness Assessment

### Preflight Validation Queries
```sql
-- Check for conflicts (should return 0 after cleanup)
SELECT COUNT(*) FROM (
  SELECT vehicle_id FROM trips 
  WHERE vehicle_id IS NOT NULL AND status IN ('PENDING','ASSIGNED','TO_LOADING_POINT','AT_LOADING_POINT','LOADED','DISPATCHED','IN_TRANSIT','DELIVERED')
  GROUP BY vehicle_id HAVING COUNT(*) > 1
) x;

SELECT COUNT(*) FROM (
  SELECT driver_id FROM trips 
  WHERE driver_id IS NOT NULL AND status IN ('PENDING','ASSIGNED','TO_LOADING_POINT','AT_LOADING_POINT','LOADED','DISPATCHED','IN_TRANSIT','DELIVERED')
  GROUP BY driver_id HAVING COUNT(*) > 1
) x;
```

### Status Match Verification
Migration uses: `('PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED')`
TripStateMachine.ACTIVE_TRIP_STATUSES: `['PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED']`
**✓ MATCHES EXACTLY**

### Readiness Status
**NOT READY** - 4 vehicles and 5 drivers have conflicting active assignments. Migration will fail until resolved.

---

## 7. Next Steps

1. **Business Review:** Present conflicts to business owner for decisions on each conflicting trip
2. **Data Cleanup:** Resolve conflicts through proper workflow (complete/cancel stale trips) with approval
3. **Validation:** Re-run conflict queries to confirm zero conflicts
4. **Migration:** Apply migration only after validation passes
5. **Verification:** Confirm indexes created and no constraint violations

**NO DATA MODIFICATIONS MADE. AWAITING EXPLICIT APPROVAL FOR CLEANUP.**

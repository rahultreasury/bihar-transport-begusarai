# MODULE 2 FINAL READ-ONLY DATABASE AUDIT

**Date:** 2026-10-31  
**Status:** READ-ONLY - NO CHANGES  
**Database:** bihar_transport_begusarai (localhost:5432)  
**User:** rahulraj  
**Pending Migration:** transport-system/backend/prisma/migrations/20261031130000_add_assignment_unique_constraints/migration.sql

---

## 1. Database Identity
- **Prisma Datasource:** postgresql://rahulraj@localhost:5432/bihar_transport_begusarai
- **Host:** localhost:5432
- **DB Name:** bihar_transport_begusarai
- **Confirmed:** Local development database

---

## 2. Schema & Status Enum
**TripStatus enum values (actual):** PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED  
**Primary key:** trip_id (integer) ✓

**Migration active statuses:** PENDING, ASSIGNED, TO_LOADING_POINT, AT_LOADING_POINT, LOADED, DISPATCHED, IN_TRANSIT, DELIVERED  
**Match:** ✓ All match actual enum

---

## 3. Vehicle Conflicts (duplicates on active trips)
| Vehicle ID | Count | Trip IDs | Notes |
|---|---|---|---|
| 1 | 22 | {11,14,17,1281,1282,1283,1284,1286,1287,1545,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401} | Largest conflict - includes Trip 11 (paid), HTTP/HA test trips |
| 11 | 8 | {20,21,22,25,30,31,32,1638} | All BTBT trips, test user 1 |
| 4 | 2 | {1094,1285} | Both LOADED/ASSIGNED, linked to bookings |
| 4976 | 2 | {4142,4264} | AT_LOADING_POINT/ASSIGNED |

---

## 4. Driver Conflicts (duplicates on active trips)
| Driver ID | Count | Trip IDs | Notes |
|---|---|---|---|
| 1 | 9 | {11,1282,1283,1284,1286,1287,1545,3897,5610} | Includes Trip 11 |
| 4 | 7 | {20,21,22,25,30,31,1638} | All BTBT trips |
| 3 | 4 | {14,17,1094,1285} | Mix of test and booking trips |
| 2 | 2 | {1281,6817} | ASSIGNED/IN_TRANSIT |
| 3069 | 2 | {4142,4264} | Linked to bookings |

---

## 5. Trip-by-Trip Classification

### CRITICAL - Must Preserve
| Trip ID | Status | Notes | Classification | Evidence | Confidence |
|---|---|---|---|---|---|
| 11 | IN_TRANSIT | Vehicle 1, Driver 1 - 3 PAID CUSTOMER_PAYMENT transactions (₹2500) | **REQUIRES_BUSINESS_CONFIRMATION** | Financial records exist | HIGH |

### CONFIRMED_TEST_DATA (High Confidence)
| Trip IDs | Pattern | Evidence |
|---|---|---|
| 14,17 | TRP-2026-00002/00005, no bookings/enquiries, test routes | No financials, assigned to test drivers/vehicles |
| 20,21,22,25,30,31,32,1638 | BTBT-2026 series, user_id=1, no bookings/enquiries | System test data |
| 3897,5610,6817 | PH5/PH6-HTTP-* patterns, user_id=4 | HTTP test automation naming |
| 7480,14149,14461,15542,16595,16862,17406,18063,18401 | HA-TRIP-*, user_id 9150+, bookings confirmed but no financials, test naming | HA automation tests |

### REQUIRES_BUSINESS_CONFIRMATION
| Trip ID | Status | Evidence | Reason |
|---|---|---|---|
| 1094 | LOADED | booking_id 203, user_id 870, freight ₹6000 | Has booking but needs ops review |
| 1281-1287,1545 | ASSIGNED | Various bookings/users | Need to check if genuine |
| 4142,4264 | AT_LOADING_POINT/ASSIGNED | booking_id 2224, user_id 768, vehicle/driver 4976/3069 | In progress, need ops approval |

---

## 6. Migration Readiness

### Status Match
- ✓ Migration uses exact active statuses that match enum
- ✓ All statuses exist in PostgreSQL enum

### Conflicts
- **34 unique trips affected** across all conflicts
- Conflicts exist in vehicle 1 (22 trips), vehicle 11 (8 trips), drivers heavily duplicated
- Cannot create unique indexes until conflicts resolved

### Index Compatibility
- ✓ Partial indexes with WHERE clause compatible
- ✓ Uses vehicle_id/driver_id IS NOT NULL
- ✓ Existing indexes won't conflict

### Blockers
1. **Must resolve conflicts before migration** - 34 trips across multiple vehicles/drivers
2. **Trip 11 is financial blocker** - cannot touch
3. **15 trips identified as operational** need confirmation
4. **Booking/workflow dependencies** for HA-TRIP bookings

---

## Executive Summary

**Module 2 Migration Status: BLOCKED**

- Database identified: bihar_transport_begusarai (local)
- Schema matches migration expectations
- **4 vehicles, 5 drivers** have duplicate active assignments
- **34 unique trips** affected
- Many are CONFIRMED_TEST_DATA (HTTP/HA/BTBT patterns) but Trip 11 must be preserved (financial)
- 15 trips need operational approval
- Cannot create partial unique indexes until all conflicts resolved

**Recommended Next Steps:**
1. Resolve test data trips (after approvals) using controlled cleanup
2. Resolve genuine conflicts case by case
3. Re-test migration after conflicts cleared
4. Only then apply `20261031130000_add_assignment_unique_constraints`

# MODULE 2 CONTROLLED CLEANUP EXECUTION PLAN

**Date:** 2026-10-31  
**Status:** PREPARATION ONLY - NO EXECUTION  
**Type:** Controlled cleanup of confirmed test data  
**Environment:** Local development (`bihar_transport_begusarai` on localhost:5432)

---

## 1. Database Target & Environment

| Item | Value |
|---|---|
| Database | `bihar_transport_begusarai` |
| Host | localhost |
| Port | 5432 |
| User | rahulraj |
| Environment | **Local Development** (confirmed) |
| PostgreSQL | 16.14 (Homebrew) |
| Migration Pending | `20261031130000_add_assignment_unique_constraints` (DO NOT APPLY) |

**Confirmation:** Local dev database. Not production/staging.

---

## 2. Backup and Restore Procedure

### Create Full Backup
```bash
cd /Users/rahulraj/Downloads/bihar-transport-begusarai-main/transport-system/backend
pg_dump -h localhost -U rahulraj -d bihar_transport_begusarai -Fc -f ../backups/bihar_transport_backup_$(date +%Y%m%d_%H%M%S).dump
```

### Verify Backup
```bash
pg_restore --list ../backups/bihar_transport_backup_YYYYMMDD_HHMMSS.dump | head -30
echo "Backup size: $(du -h ../backups/bihar_transport_backup_*.dump | tail -1)"
```

### Restore (if needed)
```bash
createdb -h localhost -U rahulraj bihar_transport_begusarai_restored
pg_restore -h localhost -U rahulraj -d bihar_transport_begusarai_restored --clean --if-exists --no-owner ../backups/bihar_transport_backup_*.dump
```

**Requirements:** Create backup before any execution. Verify integrity. Keep backup until migration applied successfully.

---

## 3. Staging Environment Testing

**Check for staging:**
```bash
psql -l | grep staging
```

If staging exists, test cancellation workflow on 1-2 non-critical trips first. If not available, test in a transaction with ROLLBACK.

---

## 4. TripOperationalService.cancelTrip() Details

**Method:** `TripOperationalService.cancelTrip(tripId, input = {}, user = null)`

**Required Arguments:**
- `tripId` (number) - Trip ID
- `input.reason` (string, required) - Cancellation reason
- `user` (object, optional) - Admin user context

**Behavior:**
- Validates reason is provided
- Uses state machine via `_perform(tripId, OPERATIONS.CANCEL, { reason }, user)`
- Idempotent if already cancelled
- Preserves reason in timeline event metadata
- Releases resources via ResourceAvailabilityService
- Uses transactions
- Records audit events

**Usage:**
```javascript
const TripOperationalService = require('./services/TripOperationalService');
const service = new TripOperationalService();
await service.cancelTrip(tripId, { reason: 'Confirmed test data cleanup' }, { user_id: adminId, role: 'admin' });
```

---

## 5. Row-by-Row Execution Checklist

### Eligible Trips (21) - All have NO financial dependencies

| # | Trip ID | Trip Number | Status | Vehicle | Driver | Pre-Check | Cancel | Post-Check | Status |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 14 | TRP-2026-00002 | IN_TRANSIT | 1 | 3 | [ ] | [ ] | [ ] | PENDING |
| 2 | 17 | TRP-2026-00005 | IN_TRANSIT | 1 | 3 | [ ] | [ ] | [ ] | PENDING |
| 3 | 20 | BTBT-2026-00002 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 4 | 21 | BTBT-2026-00003 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 5 | 22 | BTBT-2026-00004 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 6 | 25 | BTBT-2026-00005 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 7 | 30 | BTBT-2026-00006 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 8 | 31 | BTBT-2026-00007 | PENDING | 11 | 4 | [ ] | [ ] | [ ] | PENDING |
| 9 | 32 | BTBT-2026-00008 | LOADED | 11 | 6 | [ ] | [ ] | [ ] | PENDING |
| 10 | 3897 | PH6-HTTP-mv80o5ry | IN_TRANSIT | 1 | 1 | [ ] | [ ] | [ ] | PENDING |
| 11 | 5610 | PH6-HTTP-mvgfr2sf | IN_TRANSIT | 1 | 1 | [ ] | [ ] | [ ] | PENDING |
| 12 | 6817 | PH5-HTTP-mvl6kb78 | IN_TRANSIT | 1 | 2 | [ ] | [ ] | [ ] | PENDING |
| 13 | 7480 | HA-TRIP-305028 | IN_TRANSIT | 1 | 7190 | [ ] | [ ] | [ ] | PENDING |
| 14 | 14149 | HA-TRIP-366398 | IN_TRANSIT | 1 | 13859 | [ ] | [ ] | [ ] | PENDING |
| 15 | 14461 | HA-TRIP-132552 | IN_TRANSIT | 1 | 14171 | [ ] | [ ] | [ ] | PENDING |
| 16 | 15542 | HA-TRIP-658656 | IN_TRANSIT | 1 | 15244 | [ ] | [ ] | [ ] | PENDING |
| 17 | 16595 | HA-TRIP-449247 | IN_TRANSIT | 1 | 16297 | [ ] | [ ] | [ ] | PENDING |
| 18 | 16862 | HA-TRIP-139644 | IN_TRANSIT | 1 | 16531 | [ ] | [ ] | [ ] | PENDING |
| 19 | 17406 | HA-TRIP-727098 | IN_TRANSIT | 1 | 17077 | [ ] | [ ] | [ ] | PENDING |
| 20 | 18063 | HA-TRIP-266371 | IN_TRANSIT | 1 | 17738 | [ ] | [ ] | [ ] | PENDING |
| 21 | 18401 | HA-TRIP-891934 | IN_TRANSIT | 1 | 18077 | [ ] | [ ] | [ ] | PENDING |

---

## 6. Verification Queries

### Pre-Execution
```sql
SELECT trip_id, status, vehicle_id, driver_id FROM trips WHERE trip_id IN (14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401);
SELECT COUNT(*) FROM financial_transactions WHERE trip_id IN (14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401);
```

### Post-Execution
```sql
SELECT trip_id, status FROM trips WHERE trip_id IN (14,17,20,21,22,25,30,31,32,3897,5610,6817,7480,14149,14461,15542,16595,16862,17406,18063,18401);
-- All should be CANCELLED

-- Check conflicts reduced
SELECT vehicle_id, COUNT(*) FROM trips WHERE vehicle_id IN (1,11) AND status NOT IN ('COMPLETED','CANCELLED') GROUP BY vehicle_id;
```

---

## 7. Stop Conditions

STOP IMMEDIATELY if:
- Unexpected financial transactions found
- Trip status changed unexpectedly
- Cancellation fails
- Unexpected resource assignments appear
- Trip becomes terminal unexpectedly
- Database errors occur

---

## 8. Rollback Procedure

1. Stop all operations
2. Restore from backup: `pg_restore ...`
3. Verify restored DB
4. Re-run conflict queries
5. Investigate failure

---

## FINAL STATUS

**PREPARATION COMPLETE - AWAITING EXPLICIT EXECUTION APPROVAL**

- Trip 11: REMAINS UNTOUCHED (has financials)
- 8 LIKELY trips: NOT included
- 6 GENUINE trips: NOT included
- 21 candidates: Identified and verified, no financial deps
- Backup procedure documented
- Workflow verified
- Rollback plan ready

**Do NOT execute without explicit approval.**

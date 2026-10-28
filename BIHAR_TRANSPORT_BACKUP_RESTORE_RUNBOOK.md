# Bihar Transport — Backup & Restore Runbook
**Date:** 2026-10-23  
**Environment:** Neon PostgreSQL (Managed Cloud)  
**Database:** `bihar_transport_begusarai` (schema: `public`)  
**Status:** Documentation only — no production operations performed

---

## 1. Neon PostgreSQL Backup Capabilities

### 1.1 Automated Backups (Neon Managed)
| Feature | Details |
|---------|---------|
| **Point-in-Time Recovery (PITR)** | ✅ Enabled by default on all Neon projects |
| **Retention Period** | 7 days (Free tier) / Up to 30 days (Pro) / Custom (Enterprise) |
| **Backup Frequency** | Continuous (WAL archiving) |
| **Storage** | Encrypted at rest (AES-256) |
| **Geographic Redundancy** | Same region as primary (configurable for cross-region) |

### 1.2 Manual Branching (Neon's Equivalent of Snapshots)
| Feature | Details |
|---------|---------|
| **Branch Creation** | Instant copy-on-write (metadata only, no data copy) |
| **Use Cases** | Testing migrations, staging environments, point-in-time analysis |
| **Isolation** | Fully isolated compute + storage |
| **TTL** | Configurable (default: 7 days for ephemeral branches) |

### 1.3 Export/Import (pg_dump/pg_restore)
| Tool | Support |
|------|---------|
| `pg_dump` | ✅ Standard PostgreSQL tool, works with Neon connection strings |
| `pg_restore` | ✅ Works with custom-format dumps |
| `COPY` | ✅ For bulk data export/import |

---

## 2. Current Operational Procedures

### 2.1 Automated Backup Verification
- **Frequency:** Daily (Neon automatic)
- **Verification:** Neon dashboard shows "Last backup" timestamp
- **Alerting:** Neon sends email on backup failures (configured in project settings)

### 2.2 Manual Backup (On-Demand)
```bash
# Create a branch for point-in-time recovery
# Via Neon CLI:
neonctl branches create --project-id <project-id> --parent-branch main --name backup-$(date +%Y%m%d-%H%M)

# Or via Neon Console:
# 1. Navigate to Project → Branches
# 2. Click "New Branch"
# 3. Select "Main" as parent, name it "backup-YYYYMMDD-HHMM"
```

### 2.3 Schema Migration Safety
- **Tool:** Prisma Migrate (`npx prisma migrate deploy`)
- **Strategy:** Additive-only migrations (no DROP COLUMN, no DROP TABLE in production)
- **Rollback:** Not supported by Prisma Migrate; use Neon branch for rollback
- **Pre-deployment:** Run `npx prisma migrate diff` against staging branch

---

## 3. Restore Procedures

### 3.1 Point-in-Time Recovery (PITR) via Branch
**Scenario:** Accidental data corruption, need to recover to specific timestamp

```bash
# 1. Create a branch at the desired timestamp
neonctl branches create \
  --project-id <project-id> \
  --parent-branch main \
  --name recovery-$(date +%Y%m%d-%H%M) \
  --timestamp "2026-10-23T10:30:00Z"

# 2. Verify the branch data
# Connect to the branch endpoint and run verification queries

# 3. If correct, promote branch to primary (or copy data back)
# Option A: Swap connection strings in application config
# Option B: Copy specific tables using pg_dump/pg_restore
```

### 3.2 Full Database Restore (pg_restore)
**Scenario:** Complete disaster recovery

```bash
# 1. Create a fresh Neon project or branch
neonctl projects create --name "bihar-transport-restore-$(date +%Y%m%d)"

# 2. Restore from pg_dump file
pg_restore \
  --host <new-project-host> \
  --port 5432 \
  --username <username> \
  --dbname bihar_transport_begusarai \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  backup.dump

# 3. Verify row counts and key constraints
# 4. Update application connection strings
```

### 3.3 Partial Table Restore
**Scenario:** Single table corruption

```bash
# Export specific table from recovery branch
pg_dump \
  --host <recovery-branch-host> \
  --table public.trips \
  --data-only \
  --column-inserts \
  > trips_recovery.sql

# Import into production
psql \
  --host <prod-host> \
  --dbname bihar_transport_begusarai \
  -f trips_recovery.sql
```

---

## 4. Recovery Verification Checklist

After any restore operation, verify:

| Check | Query | Expected |
|-------|-------|----------|
| **Row counts** | `SELECT COUNT(*) FROM trips;` | Matches pre-incident count |
| **Key constraints** | `SELECT * FROM trips WHERE trip_id NOT IN (SELECT trip_id FROM vehicle_hires);` | No orphan trips |
| **Financial integrity** | `SELECT SUM(freight_amount) FROM trips;` | Matches pre-incident total |
| **Referential integrity** | `SELECT * FROM trips WHERE driver_id NOT IN (SELECT driver_id FROM drivers);` | No orphan drivers |
| **Migration status** | `SELECT * FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;` | All migrations applied |
| **Health endpoint** | `GET /api/health` | Returns 200 with `status: "ok"` |
| **Readiness endpoint** | `GET /api/ready` | Returns 200 with `status: "ready"` and `database: "connected"` |

---

## 5. Rollback Considerations

### 5.1 Migration Rollback (Not Supported by Prisma)
- **Do not** use `prisma migrate resolve --rolled-back` in production
- **Instead:** Create a Neon branch before migration, test there, then deploy
- **If migration fails:** Drop the branch, investigate, fix migration, retry

### 5.2 Application-Level Rollback
- **Feature flags:** Use for gradual rollout
- **Blue-green deploy:** Maintain two Neon branches (blue/green)
- **DNS switch:** Update connection string to point to verified branch

### 5.3 Data Rollback (Partial)
- **Never** run `DELETE` or `UPDATE` without `WHERE` clause in production
- **Use transactions:** All data modifications in `prisma.$transaction()`
- **Audit trail:** `AuditLog` table tracks all changes

---

## 6. Production Access Safeguards

| Safeguard | Implementation |
|-----------|----------------|
| **Connection pooling** | PgBouncer (Neon built-in) |
| **Read replicas** | Neon read replicas (configured per branch) |
| **IP allowlist** | Neon IP allowlist (project settings) |
| **SSL enforcement** | `sslmode=require` in connection string |
| **Credential rotation** | Rotate Neon API keys quarterly |
| **Audit logging** | Neon audit logs + application `AuditLog` table |

---

## 7. Backup/Restore Testing Schedule

| Test | Frequency | Owner |
|------|-----------|-------|
| **PITR branch creation** | Monthly | DevOps |
| **Full pg_restore to staging** | Quarterly | DevOps |
| **Partial table restore** | Monthly | Backend Team |
| **Migration rollback drill** | Per major release | Backend Team |
| **Full disaster recovery drill** | Annually | All Teams |
| **Post-deployment smoke test** | Per deployment | DevOps |

---

## 8. Health & Readiness Endpoints

### 8.1 Liveness Check (`GET /api/health`)
Lightweight check that the application process is running.
```bash
curl -f https://api.bihartransport.in/api/health
# Expected: 200 OK with { "success": true, "status": "ok", "data": { "dbReady": true } }
```

### 8.2 Readiness Check (`GET /api/ready`)
Comprehensive check that all critical dependencies (database) are available.
```bash
curl -f https://api.bihartransport.in/api/ready
# Expected: 200 OK with { "success": true, "status": "ready", "data": { "database": "connected", "dbReady": true } }
# On failure: 503 with { "success": false, "status": "not_ready", "data": { "database": "disconnected" } }
```

### 8.3 Database Health (`GET /api/health/db`)
Detailed database connectivity check via Prisma.
```bash
curl -f https://api.bihartransport.in/api/health/db
# Expected: 200 OK with connection details
```

### 8.4 Load Balancer Integration
Configure load balancer health checks:
- **Liveness probe:** `GET /api/health` (interval: 30s, timeout: 5s, threshold: 3)
- **Readiness probe:** `GET /api/ready` (interval: 10s, timeout: 5s, threshold: 2)

---

## 9. Post-Deployment Smoke Test

### 9.1 Script Location
`transport-system/backend/scripts/smoke-test.js`

### 9.2 Usage
```bash
# Against staging
BASE_URL=https://staging-api.bihartransport.in node scripts/smoke-test.js

# Against local development
BASE_URL=http://localhost:3000 node scripts/smoke-test.js

# With admin token for authenticated checks
BASE_URL=https://staging-api.bihartransport.in ADMIN_TOKEN=<jwt> node scripts/smoke-test.js
```

### 9.3 Checks Performed
| Check | Endpoint | Expected |
|-------|----------|----------|
| Liveness | `GET /api/health` | 200, `status: "ok"` |
| Readiness | `GET /api/ready` | 200, `status: "ready"` |
| Database | `GET /api/health/db` | 200/503 |
| Auth accessibility | `POST /api/auth/login` | Not 401/403/500 |
| Auth required | `GET /api/trips` (no token) | 401 |
| Invalid token | `GET /api/trips` (bad token) | 401 |
| Admin endpoints | `GET /api/admin/bookings` (with admin token) | 200 |
| Financial admin | `GET /api/financials/summary` (with admin token) | 200 |

### 9.4 Exit Codes
- `0` — All checks passed
- `1` — One or more checks failed
- `2` — Invalid configuration (missing BASE_URL)

---

## 10. Contact & Escalation

| Role | Contact | Escalation |
|------|---------|------------|
| **Primary DBA** | [TBD] | 15 min |
| **Neon Support** | support@neon.tech | 1 hour (Pro) / 4 hours (Free) |
| **Application Owner** | [TBD] | 30 min |
| **Incident Commander** | [TBD] | Immediate |

---

## 11. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-23 | Batch 4 Implementation | Initial version |
| 1.1 | 2026-10-23 | Batch 9 Remediation | Added health/readiness endpoints, smoke test script, post-deployment verification |

---

**Note:** This runbook documents current Neon capabilities and operational procedures. It does not modify any production data or configuration. All restore operations should be tested in a non-production branch first.
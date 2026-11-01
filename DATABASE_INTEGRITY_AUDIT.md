# BIHAR TRANSPORT — DATABASE INTEGRITY AUDIT

**Audit Date:** 2026-10-31  
**Auditor:** Database Reliability Engineer  
**Database:** PostgreSQL (Neon / local), Prisma ORM v5.22.0  
**Schema File:** `transport-system/backend/prisma/schema.prisma` (1,949 lines)  
**Migrations:** 51 migration directories in `transport-system/backend/prisma/migrations/`  

---

## DATABASE INTEGRITY SCORE: 55/100

**Verdict: NOT SAFE FOR PRODUCTION.** Schema drift, missing constraints, no migration guard, and application-layer-only financial integrity create significant data corruption and data loss risks.

---

## SCHEMA OVERVIEW

The Prisma schema defines 40+ models including:
- **Core:** User, Admin, Booking, Trip, Enquiry, Quotation
- **Financial:** PartnerLedger, PartnerPayment, Settlement, Invoice, FinancialTransaction, CommissionRecord, TripFinancial, TripAdvance, TripSettlement
- **Logistics:** Driver, TransportVehicle, VehicleOwner, Delivery, TripDispatch, TripDocument, EwayBill, TripInsurance
- **Partner/Ecosystem:** Partner, PartnerApplication, PartnerDocument, Client, Reservation
- **Operational:** BookingAssignment, DriverAssignment, VehicleAssignment, BookingEvent, EnquiryEvent, TripTimeline, AuditLog

---

## CRITICAL FINDINGS (P0)

---

### DB-001: Schema Drift — Multiple Reconciliation Migrations Indicate Unreliable Migration History

**Severity:** P0  
**Location:** `transport-system/backend/prisma/migrations/` (51 directories), `transport-system/backend/schema-diff.txt`  
**Evidence:** Migration directories named:
- `20261028150000_reconcile_schema_equivalence`
- `repair-quote-workflow-migration.sql`
- `apply-missing-migrations.sql`

These indicate repeated schema drift repairs. The migration history is not a reliable single source of truth. `schema.prisma` may not match the actual database state in any environment.

**Impact:** Failed deployments, schema inconsistencies between environments, potential data loss during migration, inability to roll back safely.

**Remediation:**
1. Clean migration history — remove reconciliation migrations
2. Make `schema.prisma` the single source of truth
3. Run `prisma migrate diff` to verify schema matches migrations
4. CI gate: `prisma migrate status` must be clean before deploy

**Tests:** DB test verifying migration status clean; CI pipeline test verifying `prisma migrate diff` is empty.

**Dependencies:** Prisma migrate, CI pipeline.

---

### DB-002: No Automated Migration Guard in CI

**Severity:** P0  
**Location:** `transport-system/backend/package.json:14-15` (`prisma:migrate` script), Repository root: no CI config  
**Evidence:** `prisma migrate deploy` run manually. No CI pipeline to validate migrations before deployment. No `prisma migrate status` check in pre-deploy.

**Impact:** Failed migrations deployed to production. Schema out of sync with application code. Data corruption risk.

**Remediation:** Add CI step: `prisma migrate status` must report clean. `prisma migrate deploy` only in deployment stage with approval gate.

**Tests:** CI pipeline test verifying migration gate blocks bad migrations.

**Dependencies:** GitHub Actions or equivalent CI.

---

### DB-003: No Double-Entry Constraint on Financial Transactions

**Severity:** P0  
**Location:** `transport-system/backend/prisma/schema.prisma:894-934` (`FinancialTransaction` model), `transport-system/backend/services/CanonicalFinancialService.js`  
**Evidence:** `FinancialTransaction` has `direction` (DEBIT/CREDIT) and `amount`, but no constraint enforcing debits equal credits. All financial integrity is in application code.

Schema fields:
- `transaction_type` (enum: CUSTOMER_PAYMENT, DRIVER_ADVANCE, COMMISSION, etc.)
- `direction` (enum: DEBIT, CREDIT)
- `amount` (Float)
- `from_party`, `to_party` (enum)

No CHECK constraint, no trigger, no application-level assertion that every transaction is balanced.

**Impact:** Silent money creation or loss. Cannot pass financial audit. Vendor/customer disputes unresolvable. Settlement totals may not match transaction sums.

**Remediation:**
1. Add PostgreSQL CHECK constraint or trigger enforcing double-entry integrity
2. Periodic reconciliation job verifying `SUM(credits) = SUM(debits)` per settlement period
3. Application-level assertion before commit

**Tests:** DB test verifying transaction balancing; reconciliation test verifying ledger equality.

**Dependencies:** Prisma migration for CHECK constraint/trigger.

---

### DB-004: Settlement Arithmetic Not Enforced at DB Level

**Severity:** P0  
**Location:** `transport-system/backend/prisma/schema.prisma:608-643` (`Settlement` model)  
**Evidence:** `Settlement` model fields:
- `gross_revenue`, `commission`, `fuel_advance`, `driver_advance`, `repair_amount`, `toll_amount`, `penalty_amount`, `bonus_amount`, `other_expenses`
- `net_payable`, `amount_paid`, `balance_due`

No CHECK constraint enforcing `gross_revenue − commission − expenses = net_payable` or `net_payable = amount_paid + balance_due`. All arithmetic in application code.

**Impact:** Settlement amount can be incorrect. Vendor under/over-payment. Financial records unreliable.

**Remediation:** Add CHECK constraint on settlement arithmetic:
```sql
CONSTRAINT settlement_arithmetic CHECK (
  net_payable = gross_revenue - commission - fuel_advance - driver_advance - repair_amount - toll_amount - penalty_amount - bonus_amount - other_expenses
)
```

**Tests:** DB test verifying settlement constraint rejects invalid arithmetic.

**Dependencies:** Prisma migration.

---

### DB-005: No Connection Pooling Configuration

**Severity:** P1  
**Location:** `transport-system/backend/prisma/schema.prisma:5-9`, `transport-system/backend/config/prisma.js`  
**Evidence:** Datasource uses default Prisma connection pool. No `connection_limit` configured. No pool monitoring.

**Impact:** Connection exhaustion under high concurrency. 503 errors during traffic spikes.

**Remediation:** Configure `connection_limit` in datasource block. Monitor pool utilization via `pg_stat_activity`. Set appropriate min/max connections.

**Tests:** Load test verifying connection pool behavior under concurrent load.

---

### DB-006: No Soft Delete on Critical Tables

**Severity:** P1  
**Location:** `transport-system/backend/prisma/schema.prisma` (Booking, Trip, Enquiry, PartnerLedger, FinancialTransaction lack `deleted_at`)  
**Evidence:** `deleted_at` exists only on `VehicleOwner`, `Partner`, `Client`. Core tables (`Booking`, `Trip`, `Enquiry`) hard-delete.

**Impact:** Accidental deletion loses data permanently. No audit trail for deleted records. Cannot recover from erroneous deletion.

**Remediation:** Add `deleted_at DateTime?` to Booking, Trip, Enquiry, PartnerLedger, FinancialTransaction. Implement soft-delete pattern in repositories (filter `deleted_at: null`).

**Tests:** DB test verifying soft-delete behavior; recovery test.

**Dependencies:** Prisma migration.

---

### DB-007: Advisory Lock Deadlock Risk

**Severity:** P1  
**Location:** `transport-system/backend/services/TripService.js:86-100`, `transport-system/backend/services/VehicleHireWorkflowService.js`  
**Evidence:** `TripService._acquireAdvisoryLocks` sorts locks by namespace (DRIVER_NS=0x54524456 < VEHICLE_NS=0x54525656). Other services may acquire locks in different order.

**Impact:** Deadlock under concurrent trip creation or vehicle hire. Trip creation hangs or fails.

**Remediation:** Centralize all advisory lock acquisition through one utility with consistent namespace ordering. Document lock ordering.

**Tests:** Load test with concurrent trip creation/vehicle hire.

---

### DB-008: Vehicle Document Dates Stored as TEXT

**Severity:** P1  
**Location:** `transport-system/backend/prisma/schema.prisma:233-256` (`TransportVehicle` model), `transport-system/backend/services/VehicleHireWorkflowService.js:100-143` (`parseDocumentDate`)  
**Evidence:** Document expiry columns stored as `String?` (TEXT): `insurance_expiry`, `permit_expiry`, `pollution_expiry`, `fitness_expiry`, `tax_expiry`, `national_permit_expiry`. Parser accepts 6+ formats.

**Impact:** Invalid dates pass as valid. Trucks with expired/unknown documents can pass hire gate. Compliance risk for vehicle documentation.

**Remediation:** Migrate document expiry columns to proper `DATE` type. Strict ISO date format validation at application layer.

**Tests:** Integration test verifying invalid dates rejected; migration test verifying data conversion.

**Dependencies:** Prisma migration.

---

### DB-009: No Read Replicas or Failover Configuration

**Severity:** P1  
**Location:** `transport-system/backend/prisma/schema.prisma:7` (`DATABASE_URL` only), `transport-system/backend/config/prisma.js`  
**Evidence:** Single `DATABASE_URL`. No read replica connection string. No failover configuration.

**Impact:** Single point of failure. Database downtime = application downtime. No read scaling for reporting queries.

**Remediation:** Configure read replica connection string. Implement read/write splitting for reporting endpoints. Connection pooling with failover.

**Tests:** Failover test verifying application survives primary DB outage.

**Dependencies:** Neon/PostgreSQL read replicas, connection pooler (PgBouncer).

---

### DB-010: Missing Unique Constraint on `trips.booking_id`

**Severity:** P1  
**Location:** `transport-system/backend/prisma/schema.prisma:957-1052` (`Trip` model)  
**Evidence:** `Trip.booking_id` is `Int?` (nullable, not unique). Application code in `TripService.createTrip` checks for existing trips per booking (line 443-449), but no DB-level UNIQUE constraint.

**Impact:** Race condition can create duplicate trips for same booking. Double-billing, dispatch confusion, financial records split across two trips.

**Remediation:** Add `@unique` constraint on `Trip.booking_id` in schema. Migration to enforce.

**Tests:** DB test verifying unique constraint rejects duplicate trips.

**Dependencies:** Prisma migration.

---

## MODERATE FINDINGS (P2)

---

### DB-011: No Index on `FinancialTransaction.from_party` / `to_party` for Query Performance

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma:894-934`  
**Evidence:** Indexes exist on `transaction_type`, `from_party`, `to_party` but no composite index for common query patterns (party + date + type).

**Impact:** Slow financial ledger queries as data grows.

**Remediation:** Add composite indexes: `(from_party, transaction_date)`, `(to_party, transaction_date)`, `(transaction_type, status)`.

**Tests:** Performance test verifying query latency under load.

---

### DB-012: JSON Fields Without Indexing Strategy

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma:999` (`documents_required Json?`), `1074` (`documents_snapshot Json?`), `1114` (`metadata Json?`), `549` (`network_locations String?`)  
**Evidence:** JSON fields used for flexible data but no GIN indexes. Querying inside JSON fields requires full table scan.

**Impact:** Slow queries on JSON content as data volume grows.

**Remediation:** Add GIN indexes on frequently-queried JSON fields. Consider normalizing frequently-queried JSON sub-fields to dedicated columns.

**Tests:** Performance test verifying JSON query latency.

---

### DB-013: No Partitioning on Large Tables

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma` (AuditLog, FinancialTransaction, BookingEvent, EnquiryEvent, TripTimeline)  
**Evidence:** Append-only tables (audit logs, events, transactions) grow unbounded. No partitioning strategy.

**Impact:** Slow queries on large tables. High storage costs. Backup/restore time increases.

**Remediation:** Implement time-based partitioning on `created_at` for AuditLog, FinancialTransaction, BookingEvent. Archive old partitions.

**Tests:** Performance test verifying query latency on partitioned vs non-partitioned tables.

---

### DB-014: No Constraint on `PartnerLedger.running_balance` Consistency

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma:554-582` (`PartnerLedger` model)  
**Evidence:** `running_balance` computed in application code. No constraint verifying `running_balance = previous.running_balance + credit - debit`.

**Impact:** Running balance drift. Ledger totals don't match transaction sums.

**Remediation:** Periodic reconciliation job. Application-level assertion on balance calculation.

**Tests:** Reconciliation test verifying running balance consistency.

---

### DB-015: No Foreign Key `ON DELETE` Consistency Review

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma` (all models)  
**Evidence:** Mixed `onDelete` strategies: `Cascade`, `Restrict`, `NoAction`, `SetNull` (implicit). No documented deletion policy.

**Impact:** Orphaned records on parent deletion. Unexpected cascade deletes losing data.

**Remediation:** Document deletion policy per relationship. Standardize `onDelete` behavior. Add `deleted_at` soft delete to prevent hard deletes.

**Tests:** DB test verifying deletion behavior per relationship.

---

### DB-016: No Constraint Enforcing `VehicleHire.gross_hire − commission = net`

**Severity:** P2  
**Location:** `transport-system/backend/prisma/schema.prisma:1054-1097` (`VehicleHire` model)  
**Evidence:** Schema comment mentions "PostgreSQL enforces the identity too (migration 20260930120100)" but this constraint may not exist on all financial tables. Verified only on `vehicle_hires`.

**Impact:** Financial drift between booking commission and hire commission.

**Remediation:** Extend CHECK constraint to all financial tables (Booking.commission_amount, TripFinancial.commission_amount).

**Tests:** DB test verifying constraint on all financial tables.

**Dependencies:** Prisma migration.

---

## INDEX ANALYSIS

| Table | Indexes | Missing Indexes | Performance Risk |
|-------|---------|-----------------|------------------|
| `users` | email, phone, role | None | Low |
| `bookings` | user_id, driver_id, vehicle_id, partner_id, booking_reference, status, pickup_date, booking_number, settlement_id | `(status, created_at)` composite | Medium |
| `trips` | trip_number, enquiry_id, status+trip_date+trip_id, user_id, transport_owner_id, vehicle_id, driver_id, status, trip_date, booking_id | `(driver_id, status)`, `(vehicle_id, status)` | Medium |
| `enquiries` | customer_id, booking_id, customer_mobile, session_key, status, price_status, assigned_driver_id, assigned_vehicle_id, assigned_partner_id, pickup_date, created_at | None | Low |
| `financial_transactions` | trip_financial_id, booking_id, transaction_type, from_party, to_party, transaction_date, created_at, invoice_id, trip_id | `(from_party, transaction_date)`, `(to_party, transaction_date)` | Medium |
| `partner_ledger` | partner_id, booking_id, transaction_type, date, transaction_id, created_at | None | Low |
| `audit_logs` | user_id, entity_type+entity_id, action, created_at | None | Low |
| `trip_timeline` | event_type, created_at, trip_id | None | Low |

---

## MIGRATION HISTORY ANALYSIS

**51 migration directories** — indicates significant schema evolution. Key concerns:

| Migration | Concern |
|-----------|---------|
| `20261028150000_reconcile_schema_equivalence` | Reconciliation migration — schema drift repair |
| `repair-quote-workflow-migration.sql` | Manual SQL repair — not in Prisma migration history |
| `apply-missing-migrations.sql` | Manual SQL application — not tracked by Prisma |
| `20260810000000_canonical_booking_number` | Booking number canonicalization |

**Risk:** Manual SQL migrations not tracked by Prisma migrate can diverge from `schema.prisma`. `prisma migrate status` may report drift.

---

## RECOMMENDED DATABASE CONSTRAINTS TO ADD

| Constraint | Table | SQL |
|------------|-------|-----|
| Unique trip per booking | `trips` | `UNIQUE(booking_id)` |
| Settlement arithmetic | `settlements` | `CHECK(net_payable = gross_revenue - ...)` |
| Double-entry integrity | `financial_transactions` | Trigger enforcing debit=credit |
| Running balance consistency | `partner_ledger` | Trigger or CHECK |
| Document dates as DATE | `transport_vehicles` | `ALTER COLUMN ... TYPE DATE` |
| Vehicle hire money identity | `vehicle_hires` | Existing (verify) |
| Booking commission non-negative | `bookings` | `CHECK(commission_amount >= 0)` |

---

## RECOVERY & BACKUP ASSESSMENT

| Capability | Status | Gap |
|------------|--------|-----|
| Automated pg_dump | ❌ | No automation |
| Point-in-time recovery | ❌ | Not configured |
| Backup encryption | ❌ | Not documented |
| Restore drill tested | ❌ | Never tested |
| RTO defined | ❌ | Not defined |
| RPO defined | ❌ | Not defined |
| Cross-region backup | ❌ | Single region only |

**Remediation:** Automated daily `pg_dump` to S3 with encryption. Point-in-time recovery via WAL archiving. Quarterly restore drills. Define RTO < 4 hours, RPO < 1 hour.

---

## DATABASE INTEGRITY CHECKLIST FOR PRODUCTION

- [ ] Clean migration history (remove reconciliation migrations)
- [ ] `prisma migrate status` reports clean in CI
- [ ] UNIQUE constraint on `trips.booking_id`
- [ ] CHECK constraint on settlement arithmetic
- [ ] Double-entry integrity on financial transactions
- [ ] `deleted_at` soft delete on core tables
- [ ] Connection pooling configured (`connection_limit`)
- [ ] Document dates migrated to DATE type
- [ ] Read replica configured for reporting
- [ ] Automated backup with pg_dump to S3
- [ ] Restore drill completed (RTO < 4h, RPO < 1h)
- [ ] Composite indexes on high-volume query patterns
- [ ] GIN indexes on frequently-queried JSON fields
- [ ] Time-based partitioning on append-only tables

---

## MONITORING QUERIES FOR PRODUCTION

```sql
-- Connection pool utilization
SELECT count(*) FROM pg_stat_activity WHERE state = 'active';

-- Slow queries
SELECT query, mean_exec_time, calls FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;

-- Table sizes
SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size FROM pg_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Index usage
SELECT schemaname, tablename, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch FROM pg_stat_user_indexes ORDER BY idx_scan ASC;

-- Lock contention
SELECT * FROM pg_locks WHERE granted = false;
```

---

## DATABASE INTEGRITY REMEDIATION PRIORITY

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | DB-001: Clean migration history | 2 days |
| 2 | DB-002: CI migration guard | 1 day |
| 3 | DB-003: Double-entry constraint | 3 days |
| 4 | DB-004: Settlement arithmetic CHECK | 2 days |
| 5 | DB-010: UNIQUE on trips.booking_id | 1 day |
| 6 | DB-006: Soft delete on core tables | 3 days |
| 7 | DB-005: Connection pooling | 2 days |
| 8 | DB-008: Document dates as DATE | 3 days |

**Each database fix will be implemented, tested, reviewed, and released independently. Approval required before any implementation begins. No production migrations will be executed without approval.**
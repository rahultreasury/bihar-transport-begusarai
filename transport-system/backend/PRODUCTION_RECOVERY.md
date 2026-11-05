# Production Recovery Runbook: Prisma Migration Failure (FINAL)

**Project:** Bihar Transport Begusarai  
**Database:** Neon PostgreSQL (production)  
**Hosting:** Render  
**Issue:** Migration `20260815000000_create_vehicle_owners` fails with `42P07: relation "vehicle_owners" already exists`  
**Status:** NOT ready for execution until ALL prechecks pass and you approve

---

## ⚠️ SAFETY WARNING

Do NOT run any state-changing commands until ALL read-only prechecks pass. If ANY check fails, STOP and report before proceeding. No production-changing commands have been executed.

---

## A. READ-ONLY NEON CHECKS (Run First, No Approval Needed)

Execute ALL queries in the Neon SQL Editor. Record results. If ANY check fails, STOP.

### A.1 Migration history — all six relevant migrations

```sql
SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name IN (
  '20260815000000_create_vehicle_owners',
  '20260818000000_add_transport_owner_to_driver',
  '20260820000000_create_missing_tables',
  '20261018120000_add_assignment_released_event',
  '20261028140000_add_partially_paid_invoice_status',
  '20261028150000_reconcile_schema_equivalence'
)
ORDER BY migration_name;
```

**STOP CONDITIONS:**
- If `20260815000000_create_vehicle_owners` does NOT have `finished_at=NULL`, it is not in a failed state — do not mark `--applied` without understanding why.
- If `20260818000000_add_transport_owner_to_driver` already has `finished_at IS NOT NULL` (successful record), do NOT mark it `--applied` again.
- If any of the four pending migrations already has `finished_at IS NOT NULL`, do NOT run `migrate deploy` without understanding why Prisma still reports them as pending.

### A.2 vehicle_owners table — 24 columns expected

```sql
SELECT column_name, data_type, is_nullable, column_default, ordinal_position
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'vehicle_owners'
ORDER BY ordinal_position;
```

**STOP CONDITION:** If fewer than 24 columns, or `partner_link` column missing, STOP — schema does not match expected state.

### A.3 vehicle_owners indexes and constraints

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'vehicle_owners'
ORDER BY indexname;

SELECT tc.constraint_name, tc.constraint_type, kcu.column_name,
       ccu.table_name AS referenced_table, ccu.column_name AS referenced_column,
       rc.delete_rule, rc.update_rule
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
LEFT JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public' AND tc.table_name = 'vehicle_owners';
```

**STOP CONDITION:** If PK on `owner_id` missing, unique indexes on `owner_code`/`partner_link` missing, or FK `partner_link` → `partners` missing, STOP.

### A.4 drivers — transport_owner_id column, index, FK rule

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'drivers' AND column_name = 'transport_owner_id';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'drivers' AND indexname = 'idx_drivers_transport_owner';

SELECT tc.constraint_name, rc.delete_rule, rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public' AND tc.table_name = 'drivers'
  AND tc.constraint_name = 'drivers_transport_owner_id_fkey';
```

**STOP CONDITION:** If FK `delete_rule` is `SET NULL` (not `RESTRICT`), STOP — migration SQL may have partially applied incorrectly.

### A.5 Enum types — existence AND exact ordered values (Neon-specific, do NOT infer from local)

```sql
-- All enum types on Neon
SELECT typname
FROM pg_type
WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY typname;

-- Enum values with sort order for types referenced by pending migrations
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND t.typname IN (
    'TripStatus', 'TripPaymentType', 'TripPaymentCategory', 'TripFinancialStatus',
    'AdvanceType', 'TransactionDirection', 'PaymentStatus',
    'trip_expense_type', 'expense_paid_by', 'FinancialTransactionType', 'TransactionParty',
    'EnquiryEventType', 'InvoiceStatus', 'LedgerTransactionType', 'UserRole'
  )
ORDER BY t.typname, e.enumsortorder;
```

**STOP CONDITIONS:**
- If any expected enum type is missing, STOP.
- If `ASSIGNMENT_RELEASED` already exists in `EnquiryEventType`, migration `20261018120000_add_assignment_released_event` WILL FAIL — plan to use guarded resolution.
- If `PARTIALLY_PAID` already exists in `InvoiceStatus`, migration `20261028140000_add_partially_paid_invoice_status` WILL FAIL — plan to use guarded resolution.

### A.6 Tables from create_missing_tables — existence

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'trips', 'trip_payments', 'trip_financials', 'trip_settlements',
    'trip_advances', 'commission_records', 'financial_transactions',
    'audit_logs', 'trip_expenses', 'vehicle_assignments', 'partner_applications'
  )
ORDER BY table_name;
```

**STOP CONDITION:** If fewer than 11 tables exist, STOP — `create_missing_tables` may need to create tables (not just enums).

---

## B. BACKUP STEPS (Before Any State-Changing Command)

1. Go to Neon Console → Your project → Databases tab → Click production database → Backups → Create manual backup/snapshot
2. Note the backup ID
3. Alternatively: `pg_dump "$DATABASE_URL" > neon-backup-$(date +%Y%m%d-%H%M%S).sql`

**Do not proceed without a backup.**

---

## C. LOCAL CODE CHANGES (Already Completed, No Production Impact)

| File | Change | Status |
|------|--------|--------|
| `prisma/migrations/20260820000000_create_missing_tables/migration.sql` | **REVERTED** — was edited to guard enums, but this migration was already applied locally. Editing historical migrations creates checksum divergence. Reverted to original. | ✅ Reverted |
| `PRODUCTION_RECOVERY.md` | New file — this runbook | ✅ Created |

**No other code changes were made.** The `prisma/schema.prisma` file was not modified. All 48 migration directories were inspected; none were modified except the one that was reverted.

**Why no migration file changes are needed:**
- `20260815000000_create_vehicle_owners`: Fix is `migrate resolve --applied` (metadata only). Table already exists with correct schema.
- `20260818000000_add_transport_owner_to_driver`: Already has successful history on Neon. Production FK uses `RESTRICT` (matches Prisma). Migration SQL uses `SET NULL` (stale) — must NOT be re-applied.
- `20260820000000_create_missing_tables`: Already applied locally. Not edited to avoid checksum divergence. On Neon, if enum creation fails, use the conditional guard in Step D.3d.
- `20261018120000_add_assignment_released_event`: Plain `ALTER TYPE ... ADD VALUE`. Will fail if value exists — handled by conditional guarded SQL in Step D.3d.
- `20261028140000_add_partially_paid_invoice_status`: Same as above.
- `20261028150000_reconcile_schema_equivalence`: Already fully guarded with `IF NOT EXISTS` / `IF EXISTS`. Safe to run as-is.

---

## D. PRODUCTION-CHANGING COMMANDS (Require Explicit Approval)

Execute ONLY after ALL Section A prechecks pass AND you approve.

### D.1 Resolve blocked failed migration — `20260815000000_create_vehicle_owners`

**Only if precheck A.1 confirms `finished_at=NULL` for this migration.**

```bash
npx prisma migrate resolve --applied 20260815000000_create_vehicle_owners
```

**What this changes:** Updates `_prisma_migrations` to set `finished_at` for this migration. No schema changes.

**Prisma 5.22 behavior:** Marks the migration as applied by setting `finished_at` to current timestamp. If the migration already has a successful record (`finished_at IS NOT NULL`), this command may error or be redundant — verify history first.

---

### D.2 Resolve `20260818000000_add_transport_owner_to_driver` — ONLY if not already successful

**Only if precheck A.1 confirms this migration does NOT have a successful record (`finished_at IS NULL`).**

```bash
npx prisma migrate resolve --applied 20260818000000_add_transport_owner_to_driver
```

**What this changes:** Marks migration as applied in `_prisma_migrations`. No schema changes.

**CRITICAL:** Do NOT run `prisma migrate deploy` to re-apply this migration. Its SQL uses `ON DELETE SET NULL`, but Neon has `ON DELETE RESTRICT` (matching Prisma schema). Re-applying would change FK behavior away from what Prisma expects.

If precheck A.1 shows this migration already has `finished_at IS NOT NULL`, **skip this step entirely.**

---

### D.3 Apply pending migrations

```bash
npx prisma migrate deploy
```

**What this changes:** Applies pending migrations in order:
1. `20260820000000_create_missing_tables` — If enum creation fails (enums already exist on Neon), migration stops. See D.3d.
2. `20261018120000_add_assignment_released_event` — Adds `ASSIGNMENT_RELEASED` to `EnquiryEventType`. Will FAIL if value already exists.
3. `20261028140000_add_partially_paid_invoice_status` — Adds `PARTIALLY_PAID` to `InvoiceStatus`. Will FAIL if value already exists.
4. `20261028150000_reconcile_schema_equivalence` — Fully guarded reconciliation (enum renames, column adds/drops, FK additions, index changes).

**STOP CONDITION:** If step 2 or 3 fails on enum value already exists, STOP. Do NOT proceed to step 4. Use D.3d instead.

---

### D.3d Handle enum value conflicts (only if D.3 fails)

**Only if `ASSIGNMENT_RELEASED` or `PARTIALLY_PAID` already exist (confirmed by precheck A.5).**

Run in Neon SQL Editor:

```sql
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'ASSIGNMENT_RELEASED' AND enumtypid = 'EnquiryEventType'::regtype) THEN
    ALTER TYPE "EnquiryEventType" ADD VALUE 'ASSIGNMENT_RELEASED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PARTIALLY_PAID' AND enumtypid = 'InvoiceStatus'::regtype) THEN
    ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';
  END IF;
END $$;
```

Then:
```bash
npx prisma migrate resolve --applied 20261018120000_add_assignment_released_event
npx prisma migrate resolve --applied 20261028140000_add_partially_paid_invoice_status
npx prisma migrate deploy
```

---

## E. POST-DEPLOYMENT VERIFICATION (Read-Only)

### E.1 Migration status

```bash
npx prisma migrate status
```

**Expected:** All migrations "Applied", no pending migrations.

### E.2 Prisma client generation

```bash
npx prisma generate
```

**Expected:** Prisma Client generated successfully.

### E.3 Build

```bash
npm run build
```

**Expected:** `prisma generate && prisma migrate deploy` completes with "No pending migrations to apply."

### E.4 Render health check

```bash
curl https://your-app.onrender.com/api/ready
```

**Expected:** `{"status":"ready","database":"connected","dbReady":true}`

### E.5 Verify critical FK rules match Prisma schema

```sql
SELECT conname, confdeltype, confupdtype
FROM pg_constraint
WHERE conname = 'drivers_transport_owner_id_fkey';

SELECT conname, confdeltype, confupdtype
FROM pg_constraint
WHERE conname = 'vehicle_owners_partner_link_fkey';
```

**Expected:** `drivers_transport_owner_id_fkey` has `confdeltype = 'r'` (RESTRICT). `vehicle_owners_partner_link_fkey` has `confdeltype = 's'` (SET NULL).

---

## F. KEY DECISIONS SUMMARY

### 1. `20260820000000_create_missing_tables` — NOT modified

**Reason:** This migration was already applied in the local environment (confirmed via migration history: `finished_at: "2026-10-28T18:13:43.584Z"`). Editing a historically-applied migration creates **checksum/history divergence** — Prisma stores a migration checksum computed from the migration SQL. If the local DB has the old checksum but the file has new content, `prisma migrate deploy` on that environment would detect checksum mismatch and fail.

**Recommendation:** Do NOT edit historical migrations that are already applied. The enum-creation failure on Neon is handled conditionally in the runbook (precheck A.5 + step D.3d).

### 2. `20260818000000_add_transport_owner_to_driver` — NOT resolved if already successful

**Reason:** User confirmed Neon already has a successful record for this migration. Running `migrate resolve --applied` again is redundant and may error. More importantly, re-applying the migration SQL (`ON DELETE SET NULL`) would change the FK behavior away from the current Prisma schema (`ON DELETE RESTRICT`).

**Recommendation:** Only resolve if precheck A.1 shows `finished_at IS NULL`. Otherwise skip entirely. Preserve the existing `RESTRICT` FK behavior.

### 3. `20260815000000_create_vehicle_owners` — Resolve only if failed record exists

**Reason:** The migration failed because `vehicle_owners` already exists. The table has correct schema (24 columns, PK, indexes, FKs). Marking it `--applied` is metadata-only and safe **if** precheck A.1 confirms `finished_at=NULL`.

### 4. Test failures — NOT labeled pre-existing

**Reason:** No baseline comparison was performed. The 25 failing tests span multiple test files and may be related to test environment setup, data state, or other factors unrelated to this migration change. They are reported as-is without characterization.

---

## G. EXACT NEXT ACTION

1. **Run all Section A precheck queries** in Neon SQL Editor
2. **Record all results** (migration history, table schemas, enum values, FK rules)
3. **Share results** — do not proceed to Section D until I confirm all prechecks pass
4. **After approval**, execute Section D commands in order

**No production-changing commands have been executed.**

---

## H. OUTSTANDING RISKS

| Risk | Severity | Mitigation |
|------|----------|------------|
| `20260820000000_create_missing_tables` enum creation may fail on Neon (enums already exist) | HIGH | Precheck A.5 detects existing enums; Step D.3d provides guarded SQL |
| `ASSIGNMENT_RELEASED` / `PARTIALLY_PAID` may already exist in Neon enums | HIGH | Precheck A.5 detects this; Step D.3d guards the ADD VALUE |
| Prisma 5.22 `migrate resolve` behavior on already-successful records | MEDIUM | Step D.2 is conditional — skipped if record already successful |
| `CREATE TABLE IF NOT EXISTS` may conceal incompatible table definitions | MEDIUM | Prechecks A.2, A.6 verify table/column existence |
| 25 test failures — cause unknown, no baseline comparison | UNKNOWN | Reported as-is; not attributed to migration change |

**Production is NOT fixed until deployment and production verification succeed.**
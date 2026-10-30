# Production Recovery Runbook — Bihar Transport Begusarai

## Step 0: Neon Branch/Snapshot

1. Go to Neon Console → Your project → Branches → Create a branch from main
2. Or: Create a manual backup via Console → Backups → Create snapshot
3. Note the branch/snapshot ID for rollback

## Step 1: Read-Only Migration Status Check

Run in Neon SQL Editor:
```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count
FROM "_prisma_migrations"
ORDER BY started_at;
```

## Step 2: Decision Table

| Scenario | Condition | Action |
|---|---|---|
| (a) Failed migration | `finished_at IS NULL AND rolled_back_at IS NULL` for 20260820000000 | `npx prisma migrate resolve --rolled-back 20260820000000_create_missing_tables`, then `npx prisma migrate deploy` |
| (b) Earlier migration missing/unfinished | Any migration before 20260820000000 has `finished_at IS NULL` | STOP. Investigate which migration failed and why. Do not proceed. |
| (c) Migration already finished | `finished_at IS NOT NULL` for 20260820000000 but Prisma still reports it | Check for checksum mismatch: `SELECT migration_name, checksum FROM "_prisma_migrations" WHERE migration_name = '20260820000000_create_missing_tables'`. Compare with local file checksum. |
| (d) Later migration partially applied | Any migration after 20260820000000 has `finished_at IS NULL` | Use `npx prisma migrate resolve --rolled-back <name>` for each failed one, then `npx prisma migrate deploy` |

## Step 3: Deploy and Verify

```bash
# Pre-deploy (Render Pre-Deploy Command if available)
npm run db:deploy

# Or in build (if no pre-deploy)
npm run build && npm run db:deploy
```

Post-checks:
```sql
-- Row counts
SELECT 'users' as table_name, COUNT(*) FROM users
UNION ALL SELECT 'bookings', COUNT(*) FROM bookings
UNION ALL SELECT 'trips', COUNT(*) FROM trips
UNION ALL SELECT 'drivers', COUNT(*) FROM drivers
UNION ALL SELECT 'vehicle_owners', COUNT(*) FROM vehicle_owners
UNION ALL SELECT 'invoices', COUNT(*) FROM invoices
UNION ALL SELECT 'financial_transactions', COUNT(*) FROM financial_transactions;

-- Enum values
SELECT typname, enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE typname IN ('TripStatus', 'TripExpenseType', 'ExpensePaidBy', 'EnquiryEventType', 'InvoiceStatus')
ORDER BY typname, enumsortorder;

-- FK rules
SELECT conname, confdeltype, confupdtype FROM pg_constraint
WHERE conname IN ('drivers_transport_owner_id_fkey', 'vehicle_owners_partner_link_fkey');
```

## Step 4: Rollback Plan

For each step:
- **Step 1 (resolve --rolled-back):** If something goes wrong, restore from Neon branch/snapshot.
- **Step 2 (deploy):** If a migration fails, the failed record blocks further migrations. Restore from backup, fix the migration, and retry.
- **Step 3 (verify):** If verification fails, restore from backup and investigate.

## Render Environment Variables

Set these in Render Dashboard → Environment:
- `DATABASE_URL` = pooled Neon host (hostname contains `-pooler`)
- `DIRECT_DATABASE_URL` = direct Neon host (hostname does NOT contain `-pooler`)
- `NODE_ENV` = production

## Render Settings

- **Build Command:** `npm ci && npm run build` (build = `prisma generate`)
- **Pre-Deploy Command:** `npm run db:deploy` (if available on your plan)
- **Start Command:** `npm start`

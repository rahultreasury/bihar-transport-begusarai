-- ============================================================================
-- PRODUCTION DATABASE AUDIT - MIGRATION HISTORY
-- ============================================================================
-- File: 01-migration-history.sql
-- Purpose: Verify migration history and checksum status
-- Read-only: Yes

SELECT '=== SECTION 1: MIGRATION HISTORY ===' AS section;

SELECT
  tc.table_schema,
  migration_name,
  checksum,
  finished_at,
  rolled_back_at,
  applied_steps_count,
  logs
FROM _prisma_migrations tc
WHERE migration_name = '20260820000000_create_missing_tables'
UNION ALL
SELECT
  'public' AS table_schema,
  migration_name,
  checksum,
  finished_at,
  rolled_back_at,
  applied_steps_count,
  logs
FROM _prisma_migrations
WHERE migration_name IN (
  '20261018120000_add_assignment_released_event',
  '20261028140000_add_partially_paid_invoice_status',
  '20261028150000_reconcile_schema_equivalence'
)
ORDER BY table_schema, migration_name;

-- ============================================================================
-- END OF SECTION 1
-- ============================================================================
-- ============================================================================
-- PRODUCTION DATABASE AUDIT - PRIMARY FOREIGN KEYS INDEXES
-- ============================================================================
-- File: 03-primary-foreign-keys-indexes.sql
-- Purpose: Verify primary keys, foreign keys, and indexes with schema qualification
-- Read-only: Yes

SELECT '=== SECTION 3: PRIMARY KEYS ===' AS section;

SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  kcu.ordinal_position
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_name IN (
    'trips','trip_payments','trip_financials','trip_settlements',
    'trip_advances','commission_records','financial_transactions',
    'audit_logs','trip_expenses','vehicle_assignments','partner_applications'
  )
ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position;

-- ============================================================================
-- END OF SECTION 3
-- ============================================================================

SELECT '=== SECTION 3.1: FOREIGN KEYS ===' AS section;

SELECT
  tc.table_schema,
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  rc.delete_rule,
  rc.update_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
WHERE tc.table_schema = 'public'
  AND tc.constraint_type = 'FOREIGN KEY'
  AND (
    tc.table_name IN (
      'trips','trip_payments','trip_financials','trip_settlements',
      'trip_advances','commission_records','financial_transactions',
      'audit_logs','trip_expenses','vehicle_assignments','partner_applications'
    )
    OR tc.table_name IN ('drivers','transport_vehicles','vehicle_owners','bookings','users')
  )
ORDER BY tc.table_schema, tc.table_name, tc.constraint_name;

-- ============================================================================
-- END OF SECTION 3.1
-- ============================================================================

SELECT '=== SECTION 3.2: INDEXES ===' AS section;

SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'trips','trip_payments','trip_financials','trip_settlements',
    'trip_advances','commission_records','financial_transactions',
    'audit_logs','trip_expenses','vehicle_assignments','partner_applications'
  )
ORDER BY tablename, indexname;

-- ============================================================================
-- END OF SECTION 3.2
-- ============================================================================
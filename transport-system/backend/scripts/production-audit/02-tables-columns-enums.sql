-- ============================================================================
-- PRODUCTION DATABASE AUDIT - TABLES COLUMNS ENUMS
-- ============================================================================
-- File: 02-tables-columns-enums.sql
-- Purpose: Verify table structures, columns, and enum definitions
-- Read-only: Yes

SELECT '=== SECTION 2: TABLE COLUMNS ===' AS section;

-- Helper CTE to format column info consistently
WITH target_tables AS (
  SELECT unnest(ARRAY[
    'trips','trip_payments','trip_financials','trip_settlements',
    'trip_advances','commission_records','financial_transactions',
    'audit_logs','trip_expenses','vehicle_assignments','partner_applications'
  ]) AS table_name
),
col_info AS (
  SELECT
    c.table_schema,
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default,
    c.character_maximum_length,
    c.numeric_precision,
    c.numeric_scale,
    CASE
      WHEN c.column_default LIKE 'nextval%' THEN 'SERIAL/IDENTITY'
      ELSE ''
    END AS identity_info,
    CASE
      WHEN pk.column_name IS NOT NULL THEN 'PK'
      ELSE ''
    END AS pk_flag
  FROM information_schema.columns c
  JOIN target_tables tt ON c.table_name = tt.table_name
  LEFT JOIN (
    SELECT kcu.table_schema, kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  ) pk ON c.table_schema = pk.table_schema AND c.table_name = pk.table_name AND c.column_name = pk.column_name
  WHERE c.table_schema = 'public'
)
SELECT
  table_schema,
  table_name,
  ordinal_position,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default,
  identity_info,
  pk_flag
FROM col_info
ORDER BY table_schema, table_name, ordinal_position;

-- ============================================================================
-- END OF SECTION 2
-- ============================================================================

SELECT '=== SECTION 2.1: ENUM DEFINITIONS ===' AS section;

SELECT
  t.typname AS enum_name,
  e.enumlabel AS label,
  e.enumsortorder AS sort_order
FROM pg_type t
JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND t.typname IN (
    'TripStatus', 'TripPaymentType', 'TripPaymentCategory',
    'TripFinancialStatus', 'AdvanceType', 'TransactionDirection',
    'PaymentStatus', 'trip_expense_type', 'expense_paid_by',
    'FinancialTransactionType', 'TransactionParty'
  )
ORDER BY t.typname, e.enumsortorder;

-- ============================================================================
-- END OF SECTION 2.1
-- ============================================================================
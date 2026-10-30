-- ============================================================================
-- PRODUCTION DATABASE AUDIT - RECONCILIATION PRECONDITIONS
-- ============================================================================
-- File: 05-reconciliation-preconditions.sql
-- Purpose: Verify reconciliation migration preconditions
-- Read-only: Yes

SELECT '=== SECTION 5: RECONCILIATION PRECONDITIONS ===' AS section;

-- ============================================================================
-- SUBSECTION 5.1: SOURCE TYPE ENUM CONVERSION
-- ============================================================================
SELECT '=== SUBSECTION 5.1: trips.source_type CONVERSION READINESS ===' AS section;

-- First determine the actual data type
WITH column_info AS (
  SELECT data_type, udt_name
  FROM information_schema.columns
  WHERE table_name = 'trips' AND column_name = 'source_type' AND table_schema = 'public'
)
SELECT 
  'COLUMN_TYPE:' AS check_type,
  data_type,
  udt_name,
  NULL AS sample_value,
  NULL AS cast_possible,
  NULL AS value_validation_status
FROM column_info
UNION ALL

-- If it's an enum type, validate values
SELECT 
  'ENUM_VALIDATION' AS check_type,
  data_type,
  udt_name,
  source_type AS sample_value,
  CASE 
    WHEN data_type = 'USER-DEFINED' THEN 'NEEDS_CAST_TO_TEXT' 
    ELSE 'TEXT_OR_OTHER' 
  END AS cast_possible,
  'MANUAL_CHECK' AS value_validation_status
FROM trips, column_info
WHERE source_type IS NOT NULL
  AND CASE 
    WHEN column_info.data_type = 'USER-DEFINED' THEN 'NEEDS_CAST'
    ELSE 'TEXT_OR_OTHER'
  END = 'NEEDS_CAST'
UNION ALL

-- Count values by raw source_type
SELECT 
  'RAW_COUNT_BY_VALUE' AS check_type,
  data_type,
  udt_name,
  source_type,
  'NEEDS_CAST' AS cast_possible,
  COUNT(*) AS value_count
FROM trips, column_info
WHERE source_type IS NOT NULL
  AND column_info.data_type = 'USER-DEFINED'
GROUP BY source_type, data_type, udt_name
ORDER BY value_count DESC;

-- ============================================================================
-- END OF SUBSECTION 5.1
-- ============================================================================

SELECT '=== SUBSECTION 5.2: RECONCILIATION FOREIGN KEY CHANGES ===' AS section;

-- FKs that reconcile migration will DROP (if they exist with wrong rules)
SELECT 'financial_transactions_client_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'financial_transactions_client_id_fkey' AND table_schema = 'public';

SELECT 'transport_vehicles_driver_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'transport_vehicles_driver_id_fkey' AND table_schema = 'public';

-- ============================================================================
-- END OF SUBSECTION 5.2
-- ============================================================================

SELECT '=== SUBSECTION 5.3: RECONCILIATION INDEX CHANGES ===' AS section;

-- Indexes that reconcile migration will DROP (if they exist)
SELECT 'idx_drivers_vehicle_number' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_drivers_vehicle_number' AND schemaname = 'public';

SELECT 'idx_drivers_vehicle_type' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_drivers_vehicle_type' AND schemaname = 'public';

SELECT 'idx_trips_client_id' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_trips_client_id' AND schemaname = 'public';

SELECT 'idx_trips_source_type' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_trips_source_type' AND schemaname = 'public';

SELECT 'drivers_vehicle_number_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'drivers_vehicle_number_key' AND schemaname = 'public';

SELECT 'idx_bookings_archived_at' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_bookings_archived_at' AND schemaname = 'public';

-- ============================================================================
-- END OF SUBSECTION 5.3
-- ============================================================================

SELECT '=== SUBSECTION 5.4: VEHICLE STATUS VEHICLE TYPE DROP SAFETY ===' AS section;

-- Check enum dependency using pg_depend for proper safety analysis
SELECT 
  'VehicleStatus (pg_depend safety check)' AS check_type,
  'NOT_VERIFIED' AS drop_safety_status,
  COUNT(*) AS dependency_count
FROM pg_depend d
JOIN pg_type t ON d.refobjid = t.oid
WHERE t.typname = 'VehicleStatus'
  AND t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND d.deptype IN ('n', 'a', 'i')
UNION ALL

SELECT 
  'VehicleType (pg_depend safety check)' AS check_type,
  'NOT_VERIFIED' AS drop_safety_status,
  COUNT(*) AS dependency_count
FROM pg_depend d
JOIN pg_type t ON d.refobjid = t.oid
WHERE t.typname = 'VehicleType'
  AND t.typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  AND d.deptype IN ('n', 'a', 'i')
;

-- ============================================================================
-- END OF SUBSECTION 5.4
-- ============================================================================

SELECT '=== SUBSECTION 5.5: ENUM RENAME SAFETY ===' AS section;

-- Current enum values for expense_paid_by
SELECT 'expense_paid_by values' AS check_type, enumlabel, enumsortorder
FROM pg_enum e
JOIN pg_type t ON e.enumtypid = t.oid
WHERE t.typname = 'expense_paid_by'
ORDER BY enumsortorder;

-- Check if ExpensePaidBy already exists
SELECT 'ExpensePaidBy exists' AS check_type,
  CASE WHEN EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpensePaidBy' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public'))
  THEN 'YES' ELSE 'NO' END AS exists;

-- Verify trip_expenses.paid_by default
SELECT column_name, column_default, is_nullable, udt_name
FROM information_schema.columns
WHERE table_name = 'trip_expenses' AND column_name = 'paid_by' AND table_schema = 'public';

-- ============================================================================
-- END OF SUBSECTION 5.5
-- ============================================================================

SELECT '=== END OF RECONCILIATION PRECONDITIONS ===' AS section;

-- ============================================================================
-- END OF SECTION 5
-- ============================================================================
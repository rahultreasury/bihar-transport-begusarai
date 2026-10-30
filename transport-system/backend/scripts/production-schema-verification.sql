-- ============================================================================
-- PRODUCTION NEON SCHEMA VERIFICATION SCRIPT
-- Bihar Transport — Migration Recovery Pre-Check
-- ============================================================================
-- Purpose: Read-only verification of Neon production schema against
--          migration 20260820000000_create_missing_tables expectations
--          and reconciliation migration 20261028150000_reconcile_schema_equivalence preconditions.
--
-- Usage: Copy this entire script into Neon SQL Editor and run.
--        Requires DIRECT (non-pooled) Neon connection.
--        Output will be multiple result sets — review each section.
--
-- Safety: READ-ONLY. No CREATE, ALTER, DROP, INSERT, UPDATE, DELETE, TRUNCATE.
-- ============================================================================

-- ============================================================================
-- SECTION 1: MIGRATION HISTORY & CHECKSUM
-- ============================================================================
SELECT '=== SECTION 1: MIGRATION HISTORY ===' AS section;

SELECT
  migration_name,
  checksum,
  finished_at,
  rolled_back_at,
  applied_steps_count,
  logs
FROM _prisma_migrations
WHERE migration_name = '20260820000000_create_missing_tables'
UNION ALL
SELECT
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
ORDER BY migration_name;

-- Expected checksums for reference:
-- Original migration (on Neon): 3dbb90bca771232249c6cc5bdad12b1fd7860f0e55ecb9852a219267efbc0a59
-- Current local (guarded):      7da07e8cefff97829e35dd0d29108a950c193e0900901730e677ee958fe60e2a

-- ============================================================================
-- SECTION 2: ALL ENUM DEFINITIONS (11 enums from failed migration)
-- ============================================================================
SELECT '=== SECTION 2: ENUM DEFINITIONS ===' AS section;

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

-- TripStatus ordering comparison reference:
-- Migration 20260820 expects: PENDING(1), ASSIGNED(2), TO_LOADING_POINT(3), AT_LOADING_POINT(4), LOADED(5), DISPATCHED(6), IN_TRANSIT(7), DELIVERED(8), COMPLETED(9), CANCELLED(10)
-- Prisma schema expects:    PENDING(1), ASSIGNED(2), IN_TRANSIT(3), DELIVERED(4), COMPLETED(5), CANCELLED(6), TO_LOADING_POINT(7), AT_LOADING_POINT(8), LOADED(9), DISPATCHED(10)

-- ============================================================================
-- SECTION 3: TABLE STRUCTURAL COMPARISON (11 tables)
-- ============================================================================
SELECT '=== SECTION 3: TABLE COLUMNS ===' AS section;

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
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
    WHERE tc.constraint_type = 'PRIMARY KEY' AND tc.table_schema = 'public'
  ) pk ON c.table_name = pk.table_name AND c.column_name = pk.column_name
  WHERE c.table_schema = 'public'
)
SELECT
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
ORDER BY table_name, ordinal_position;

-- ============================================================================
-- SECTION 4: PRIMARY KEYS
-- ============================================================================
SELECT '=== SECTION 4: PRIMARY KEYS ===' AS section;

SELECT
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
ORDER BY tc.table_name, kcu.ordinal_position;

-- ============================================================================
-- SECTION 5: ALL INDEXES
-- ============================================================================
SELECT '=== SECTION 5: INDEXES ===' AS section;

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

-- Expected indexes from migration 20260820 (all IF NOT EXISTS):
-- trips: idx_trips_number (UNIQUE on trip_number), idx_trips_enquiry, idx_trips_hire_queue,
--        idx_trips_user, idx_trips_owner, idx_trips_vehicle, idx_trips_driver,
--        idx_trips_status, idx_trips_date, idx_trips_booking
-- trip_payments: idx_trip_payments_type, idx_trip_payments_category, idx_trip_payments_trip
-- trip_financials: idx_trip_financial_booking, idx_trip_financial_status, idx_trip_financial_trip
-- trip_settlements: idx_trip_settlement_financial, idx_trip_settlement_booking
-- trip_advances: idx_trip_advance_financial, idx_trip_advance_booking, idx_trip_advance_driver,
--                idx_trip_advance_owner, idx_trip_advance_trip
-- commission_records: idx_commission_financial, idx_commission_booking
-- financial_transactions: idx_financial_tx_financial, idx_financial_tx_booking,
--                         idx_financial_tx_type, idx_financial_tx_from, idx_financial_tx_to,
--                         idx_financial_tx_date, idx_financial_tx_created, idx_financial_tx_invoice, idx_financial_tx_trip
-- audit_logs: idx_audit_user, idx_audit_entity, idx_audit_action, idx_audit_created
-- trip_expenses: idx_trip_expenses_type, idx_trip_expenses_paid_by, idx_trip_expenses_trip
-- vehicle_assignments: idx_veh_assign_vehicle, idx_veh_assign_driver, idx_veh_assign_status
-- partner_applications: idx_app_code (UNIQUE on application_code), idx_app_phone,
--                       idx_app_email, idx_app_status, idx_app_type

-- ============================================================================
-- SECTION 6: FOREIGN KEYS
-- ============================================================================
SELECT '=== SECTION 6: FOREIGN KEYS ===' AS section;

SELECT
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
ORDER BY tc.table_name, tc.constraint_name;

-- Migration 20260820 adds NO foreign keys (added by later migrations).
-- Reconciliation migration 20261028 adds many FKs (see Section 12).

-- ============================================================================
-- SECTION 7: ENUM DEPENDENCIES (expense_paid_by, trip_expense_type, VehicleStatus, VehicleType)
-- ============================================================================
SELECT '=== SECTION 7: ENUM DEPENDENCIES ===' AS section;

-- Columns using expense_paid_by
SELECT 'expense_paid_by columns:' AS check_type, table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'expense_paid_by' AND table_schema = 'public'
UNION ALL
-- Columns using trip_expense_type (lowercase)
SELECT 'trip_expense_type columns:', table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'trip_expense_type' AND table_schema = 'public'
UNION ALL
-- Columns using TripExpenseType (PascalCase - expected final)
SELECT 'TripExpenseType columns:', table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'TripExpenseType' AND table_schema = 'public'
UNION ALL
-- Columns using ExpensePaidBy (PascalCase - expected final)
SELECT 'ExpensePaidBy columns:', table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'ExpensePaidBy' AND table_schema = 'public'
UNION ALL
-- Columns using VehicleStatus
SELECT 'VehicleStatus columns:', table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'VehicleStatus' AND table_schema = 'public'
UNION ALL
-- Columns using VehicleType
SELECT 'VehicleType columns:', table_name, column_name, data_type, udt_name, column_default
FROM information_schema.columns
WHERE udt_name = 'VehicleType' AND table_schema = 'public';

-- Also check if VehicleStatus/VehicleType types exist
SELECT 'Type existence:' AS check_type, typname, typcategory
FROM pg_type
WHERE typname IN ('VehicleStatus', 'VehicleType', 'trip_expense_type', 'expense_paid_by', 'TripExpenseType', 'ExpensePaidBy')
  AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- SECTION 8: RECONCILIATION PRECONDITIONS — NULL CHECKS FOR SET NOT NULL
-- ============================================================================
SELECT '=== SECTION 8: NULL CHECKS FOR SET NOT NULL ===' AS section;

-- bookings.booking_number (will SET NOT NULL)
SELECT 'bookings.booking_number NULLs' AS check_name, COUNT(*) AS null_count
FROM bookings WHERE booking_number IS NULL;

-- bookings.vehicle_owner_id (will add FK, should be NULL or valid)
SELECT 'bookings.vehicle_owner_id NULLs' AS check_name, COUNT(*) AS null_count
FROM bookings WHERE vehicle_owner_id IS NULL;

-- trip_financials columns that will have DROP NOT NULL (verify current state)
SELECT 'trip_financials NOT NULL status' AS check_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'trip_financials'
  AND column_name IN ('total_advance','total_fuel_advance','total_owner_advance',
                      'commission_rate','commission_amount','bt_margin')
  AND table_schema = 'public';

-- ============================================================================
-- SECTION 9: RECONCILIATION PRECONDITIONS — JSON VALIDITY
-- ============================================================================
SELECT '=== SECTION 9: JSON VALIDITY (trips.documents_required) ===' AS section;

SELECT
  COUNT(*) AS total_rows,
  COUNT(documents_required) AS non_null_count,
  COUNT(CASE WHEN documents_required IS NOT NULL THEN 1 END) AS valid_json_count,
  COUNT(CASE WHEN documents_required IS NOT NULL AND documents_required::text = '' THEN 1 END) AS empty_string_count
FROM trips
WHERE documents_required IS NOT NULL;

-- Sample rows for manual inspection
SELECT trip_id, documents_required
FROM trips
WHERE documents_required IS NOT NULL
LIMIT 10;

-- ============================================================================
-- SECTION 10: RECONCILIATION PRECONDITIONS — FINANCIAL DEFAULTS
-- ============================================================================
SELECT '=== SECTION 10: FINANCIAL DEFAULTS ===' AS section;

-- trip_financials columns affected by DROP DEFAULT / DROP NOT NULL / SET DEFAULT
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default,
  CASE WHEN column_default IS NOT NULL THEN 'HAS_DEFAULT' ELSE 'NO_DEFAULT' END AS default_status
FROM information_schema.columns
WHERE table_name = 'trip_financials'
  AND column_name IN (
    'customer_fare', 'total_advance', 'total_fuel_advance',
    'remaining_driver_settlement', 'total_owner_advance',
    'remaining_owner_settlement', 'commission_rate',
    'commission_amount', 'bt_margin'
  )
  AND table_schema = 'public'
ORDER BY column_name;

-- trips.freight_amount (DROP DEFAULT in reconcile)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'trips' AND column_name = 'freight_amount' AND table_schema = 'public';

-- ============================================================================
-- SECTION 11: RECONCILIATION PRECONDITIONS — trips.source_type ENUM CONVERSION
-- ============================================================================
SELECT '=== SECTION 11: trips.source_type CONVERSION READINESS ===' AS section;

-- Current type of source_type
SELECT column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'trips' AND column_name = 'source_type' AND table_schema = 'public';

-- Check for invalid values that would fail TripSourceType cast
-- TripSourceType enum values: ONLINE_BOOKING, OFFLINE_CLIENT, DIRECT
SELECT
  source_type,
  COUNT(*) AS count
FROM trips
GROUP BY source_type
ORDER BY count DESC;

-- Values NOT in TripSourceType enum
SELECT DISTINCT source_type
FROM trips
WHERE upper(source_type) NOT IN ('ONLINE_BOOKING', 'OFFLINE_CLIENT', 'DIRECT');

-- ============================================================================
-- SECTION 12: RECONCILIATION FOREIGN KEY CHANGES — CURRENT STATE
-- ============================================================================
SELECT '=== SECTION 12: RECONCILIATION FK CHANGES — CURRENT STATE ===' AS section;

-- FKs that reconcile migration will DROP (if they exist with wrong rules)
SELECT 'financial_transactions_client_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'financial_transactions_client_id_fkey' AND table_schema = 'public';

SELECT 'transport_vehicles_driver_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'transport_vehicles_driver_id_fkey' AND table_schema = 'public';

-- FKs that reconcile migration will ADD (verify they don't exist yet)
SELECT 'drivers_current_vehicle_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'drivers_current_vehicle_id_fkey' AND table_schema = 'public';

SELECT 'transport_vehicles_owner_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'transport_vehicles_owner_id_fkey' AND table_schema = 'public';

SELECT 'bookings_vehicle_owner_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'bookings_vehicle_owner_id_fkey' AND table_schema = 'public';

SELECT 'vehicle_assignments_driver_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'vehicle_assignments_driver_id_fkey' AND table_schema = 'public';

SELECT 'vehicle_assignments_vehicle_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'vehicle_assignments_vehicle_id_fkey' AND table_schema = 'public';

SELECT 'partner_applications_partner_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'partner_applications_partner_id_fkey' AND table_schema = 'public';

SELECT 'partner_applications_user_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'partner_applications_user_id_fkey' AND table_schema = 'public';

SELECT 'partner_applications_vehicle_owner_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'partner_applications_vehicle_owner_id_fkey' AND table_schema = 'public';

SELECT 'trip_financials_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_financials_booking_id_fkey' AND table_schema = 'public';

SELECT 'trip_advances_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_advances_booking_id_fkey' AND table_schema = 'public';

SELECT 'trip_advances_trip_financial_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_advances_trip_financial_id_fkey' AND table_schema = 'public';

SELECT 'trip_advances_trip_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_advances_trip_id_fkey' AND table_schema = 'public';

SELECT 'trip_settlements_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_settlements_booking_id_fkey' AND table_schema = 'public';

SELECT 'trip_settlements_trip_financial_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_settlements_trip_financial_id_fkey' AND table_schema = 'public';

SELECT 'commission_records_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'commission_records_booking_id_fkey' AND table_schema = 'public';

SELECT 'commission_records_trip_financial_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'commission_records_trip_financial_id_fkey' AND table_schema = 'public';

SELECT 'financial_transactions_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'financial_transactions_booking_id_fkey' AND table_schema = 'public';

SELECT 'financial_transactions_trip_financial_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'financial_transactions_trip_financial_id_fkey' AND table_schema = 'public';

SELECT 'trips_booking_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trips_booking_id_fkey' AND table_schema = 'public';

SELECT 'trips_driver_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trips_driver_id_fkey' AND table_schema = 'public';

SELECT 'trips_transport_owner_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trips_transport_owner_id_fkey' AND table_schema = 'public';

SELECT 'trips_user_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trips_user_id_fkey' AND table_schema = 'public';

SELECT 'trips_vehicle_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trips_vehicle_id_fkey' AND table_schema = 'public';

SELECT 'trip_expenses_trip_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_expenses_trip_id_fkey' AND table_schema = 'public';

SELECT 'trip_payments_trip_id_fkey' AS fk_name, *
FROM information_schema.table_constraints
WHERE constraint_name = 'trip_payments_trip_id_fkey' AND table_schema = 'public';

-- ============================================================================
-- SECTION 13: RECONCILIATION INDEX CHANGES — CURRENT STATE
-- ============================================================================
SELECT '=== SECTION 13: RECONCILIATION INDEX CHANGES — CURRENT STATE ===' AS section;

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

-- Indexes that reconcile migration will CREATE/RENAME
SELECT 'idx_bookings_vehicle_owner' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_bookings_vehicle_owner' AND schemaname = 'public';

SELECT 'idx_bookings_booking_number' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_bookings_booking_number' AND schemaname = 'public';

SELECT 'idx_drivers_current_vehicle' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_drivers_current_vehicle' AND schemaname = 'public';

SELECT 'idx_vehicles_owner' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_vehicles_owner' AND schemaname = 'public';

SELECT 'idx_trip_expenses_type' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_trip_expenses_type' AND schemaname = 'public';

SELECT 'idx_trip_expenses_paid_by' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_trip_expenses_paid_by' AND schemaname = 'public';

SELECT 'drivers_current_vehicle_id_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'drivers_current_vehicle_id_key' AND schemaname = 'public';

SELECT 'transport_vehicles_vehicle_code_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'transport_vehicles_vehicle_code_key' AND schemaname = 'public';

SELECT 'trip_financials_booking_id_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'trip_financials_booking_id_key' AND schemaname = 'public';

SELECT 'idx_trips_number' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_trips_number' AND schemaname = 'public';

SELECT 'trips_trip_number_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'trips_trip_number_key' AND schemaname = 'public';

SELECT 'idx_app_code' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_app_code' AND schemaname = 'public';

SELECT 'partner_applications_application_code_key' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'partner_applications_application_code_key' AND schemaname = 'public';

SELECT 'idx_deliveries_vehicle' AS idx_name, *
FROM pg_indexes
WHERE indexname = 'idx_deliveries_vehicle' AND schemaname = 'public';

-- ============================================================================
-- SECTION 14: RECONCILIATION — VehicleStatus/VehicleType DROP SAFETY
-- ============================================================================
SELECT '=== SECTION 14: VehicleStatus/VehicleType DROP SAFETY ===' AS section;

-- Check if any columns depend on VehicleStatus
SELECT 'VehicleStatus dependencies' AS check_type,
  COUNT(*) AS dependent_columns
FROM information_schema.columns
WHERE udt_name = 'VehicleStatus' AND table_schema = 'public';

-- Check if any columns depend on VehicleType
SELECT 'VehicleType dependencies' AS check_type,
  COUNT(*) AS dependent_columns
FROM information_schema.columns
WHERE udt_name = 'VehicleType' AND table_schema = 'public';

-- ============================================================================
-- SECTION 15: ENUM RENAME SAFETY — expense_paid_by → ExpensePaidBy
-- ============================================================================
SELECT '=== SECTION 15: expense_paid_by RENAME SAFETY ===' AS section;

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
-- SECTION 16: SUMMARY — CHECKS REQUIRING MANUAL COMPARISON
-- ============================================================================
SELECT '=== SECTION 16: MANUAL COMPARISON CHECKLIST ===' AS section;

SELECT 'Compare each Section 2 enum output with migration 20260820 CREATE TYPE labels and ordering' AS manual_check
UNION ALL SELECT 'Compare Section 3 columns with migration 20260820 CREATE TABLE definitions (types, nullability, defaults, PKs)'
UNION ALL SELECT 'Compare Section 5 indexes with migration 20260820 CREATE INDEX statements (names, columns, uniqueness)'
UNION ALL SELECT 'Compare Section 6 FKs with expected later-migration FKs (not in 20260820, but in reconcile migration)'
UNION ALL SELECT 'Verify TripStatus ordering: migration=TO_LOADING_POINT(3),AT_LOADING_POINT(4),LOADED(5),DISPATCHED(6),IN_TRANSIT(7),DELIVERED(8),COMPLETED(9),CANCELLED(10) vs Prisma=IN_TRANSIT(3),DELIVERED(4),COMPLETED(5),CANCELLED(6),TO_LOADING_POINT(7),AT_LOADING_POINT(8),LOADED(9),DISPATCHED(10)'
UNION ALL SELECT 'Verify trip_expenses.expense_type uses TripExpenseType (PascalCase) not trip_expense_type (lowercase)'
UNION ALL SELECT 'Verify trip_expenses.paid_by uses expense_paid_by (lowercase) — reconcile will rename to ExpensePaidBy'
UNION ALL SELECT 'Confirm no columns depend on VehicleStatus or VehicleType (Section 7)'
UNION ALL SELECT 'Confirm trip_expenses.paid_by default is BIHAR_TRANSPORT (Section 15)'
UNION ALL SELECT 'Confirm all trips.source_type values are ONLINE_BOOKING/OFFLINE_CLIENT/DIRECT (Section 11)'
UNION ALL SELECT 'Confirm trips.documents_required all valid JSON (Section 9)'
UNION ALL SELECT 'Confirm bookings.booking_number has no NULLs (Section 8)'
UNION ALL SELECT 'Confirm all expected reconciliation FKs are missing (Section 12) — they will be added'
UNION ALL SELECT 'Confirm all expected reconciliation indexes are missing (Section 13) — they will be created'
UNION ALL SELECT 'Confirm legacy indexes to be dropped exist (Section 13)'
UNION ALL SELECT 'Verify checksum mismatch: Neon=3dbb90bca..., Local=7da07e8ce... (guards added)'

;

-- ============================================================================
-- END OF SCRIPT
-- ============================================================================
SELECT '=== VERIFICATION SCRIPT COMPLETE ===' AS section;
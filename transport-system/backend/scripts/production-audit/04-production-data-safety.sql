-- ============================================================================
-- PRODUCTION DATABASE AUDIT - PRODUCTION DATA SAFETY
-- ============================================================================
-- File: 04-production-data-safety.sql
-- Purpose: Verify production data safety and integrity checks
-- Read-only: Yes

SELECT '=== SECTION 4: BOOKINGS TABLE SAFETY ===' AS section;

-- Check if bookings table exists before accessing it
WITH table_exists AS (
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'bookings'
  ) AS bookings_exists
),
column_exists AS (
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'booking_number'
  ) AS booking_number_exists
),
duplicate_check AS (
  SELECT 
    CASE 
      WHEN t.bookings_exists AND c.booking_number_exists THEN 
        (SELECT COUNT(*) FROM bookings WHERE booking_number IS NOT NULL AND booking_number IN (
          SELECT booking_number FROM bookings GROUP BY booking_number HAVING COUNT(*) > 1
        ))
      ELSE NULL
    END AS duplicate_booking_count
  FROM table_exists t, column_exists c
)
SELECT 
  CASE 
    WHEN t.bookings_exists AND c.booking_number_exists THEN 'bookings.booking_number NULLs'
    ELSE 'CHECK_FAILED: bookings table or booking_number column not found'
  END AS check_name,
  CASE
    WHEN t.bookings_exists AND c.booking_number_exists THEN 
      (SELECT COUNT(*) FROM bookings WHERE booking_number IS NULL)
    ELSE NULL
  END AS null_count,
  CASE
    WHEN t.bookings_exists AND c.booking_number_exists THEN 
      (SELECT COUNT(*) FROM bookings WHERE booking_number IS NOT NULL AND booking_number IN (
        SELECT booking_number FROM bookings GROUP BY booking_number HAVING COUNT(*) > 1
      ))
    ELSE NULL
  END AS duplicate_count
FROM table_exists t, column_exists c;

-- ============================================================================
-- END OF SECTION 4
-- ============================================================================

SELECT '=== SECTION 4.1: VEHICLE OWNER ID NULLS ===' AS section;

-- bookings.vehicle_owner_id NULL check with safety validation
WITH table_exists AS (
  SELECT EXISTS(
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'bookings'
  ) AS bookings_exists
),
column_exists AS (
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'vehicle_owner_id'
  ) AS vehicle_owner_id_exists
)
SELECT 
  CASE 
    WHEN t.bookings_exists AND c.vehicle_owner_id_exists THEN 'bookings.vehicle_owner_id NULLs'
    ELSE 'CHECK_FAILED: bookings table or vehicle_owner_id column not found'
  END AS check_name,
  CASE
    WHEN t.bookings_exists AND c.vehicle_owner_id_exists THEN 
      (SELECT COUNT(*) FROM bookings WHERE vehicle_owner_id IS NULL)
    ELSE NULL
  END AS null_count,
  NULL AS duplicate_count
FROM table_exists t, column_exists c;

-- ============================================================================
-- END OF SECTION 4.1
-- ============================================================================

SELECT '=== SECTION 4.2: TRIPS DOCUMENTS REQUIRED JSON VALIDITY ===' AS section;

-- First determine the actual column type
WITH column_info AS (
  SELECT data_type, udt_name
  FROM information_schema.columns
  WHERE table_name = 'trips' AND column_name = 'documents_required' AND table_schema = 'public'
)
SELECT 
  'COLUMN_TYPE:' AS check_type,
  data_type,
  udt_name,
  NULL AS documents_required,
  NULL AS json_validation_status,
  NULL AS manual_check_note
FROM column_info
UNION ALL

-- If TEXT, provide safe duplicate count validation
SELECT 
  'TEXT_DUPLICATE_CHECK' AS check_type,
  'TEXT' AS data_type,
  'N/A' AS udt_name,
  NULL AS documents_required,
  'SAFE_DUPLICATE_COUNT:' AS json_validation_status,
  (SELECT COUNT(*) FROM (
    SELECT documents_required FROM trips 
    WHERE documents_required IS NOT NULL AND documents_required != ''
    GROUP BY documents_required
    HAVING COUNT(*) > 1
  ) AS dup_check)
FROM column_info
WHERE data_type = 'TEXT';

-- ============================================================================
-- END OF SECTION 4.2
-- ============================================================================
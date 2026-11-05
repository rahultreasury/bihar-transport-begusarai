-- ============================================================================
-- Test fixture migration file 1: Valid CREATE TYPE with proper guard
-- ============================================================================
DO $$
BEGIN
  CREATE TYPE "TripStatus" AS ENUM (
    'PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN
  RAISE NOTICE 'Type "TripStatus" already exists';
END $$;

-- ============================================================================
-- Test fixture migration file 2: Invalid CREATE TYPE without guard
-- ============================================================================
CREATE TYPE InvalidType AS ENUM (
  'VALUE1', 'VALUE2'
);

-- ============================================================================
-- Test fixture migration file 3: Valid CREATE TABLE with IF NOT EXISTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS "trips" (
  trip_id SERIAL PRIMARY KEY,
  trip_number VARCHAR(20) UNIQUE
);

-- ============================================================================
-- Test fixture migration file 4: Invalid CREATE TABLE without guard
-- ============================================================================
CREATE TABLE "trips" (
  trip_id SERIAL PRIMARY KEY,
  trip_number VARCHAR(20) UNIQUE
);

-- ============================================================================
-- Test fixture migration file 5: Valid CREATE INDEX with IF NOT EXISTS
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_trips_number ON "trips" (trip_number);

-- ============================================================================
-- Test fixture migration file 6: Invalid CREATE INDEX without guard
-- ============================================================================
CREATE INDEX idx_trips_number ON "trips" (trip_number);

-- ============================================================================
-- Test fixture migration file 7: Valid ADD COLUMN with IF NOT EXISTS
-- ============================================================================
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();

-- ============================================================================
-- Test fixture migration file 8: Invalid ADD COLUMN without guard
-- ============================================================================
ALTER TABLE "trips" ADD COLUMN created_at TIMESTAMP DEFAULT NOW();

-- ============================================================================
-- Test fixture migration file 9: Valid DROP with IF EXISTS
-- ============================================================================
DROP TABLE IF EXISTS "temp_table";

-- ============================================================================
-- Test fixture migration file 10: Invalid DROP without guard
-- ============================================================================
DROP TABLE "temp_table";

-- ============================================================================
-- Test fixture migration file 11: Multiline DO $$ block with exception
-- ============================================================================
DO $$
BEGIN
  CREATE TYPE "test_enum" AS ENUM ('A', 'B', 'C');
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Type already exists';
  -- Additional statement in the same block
  CREATE INDEX idx_test ON test_table (id);
END $$;

-- ============================================================================
-- Test fixture migration file 12: Invalid quoted identifier without guard
-- ============================================================================
CREATE TABLE "trips" (
  trip_id SERIAL PRIMARY KEY
);

-- ============================================================================
-- Test fixture migration file 13: Valid CREATE TYPE with dollar quoting
-- ============================================================================
CREATE TYPE "order_status" AS ENUM (
  'PENDING'::text,
  'CONFIRMED'::text
);

-- ============================================================================
-- Test fixture migration file 14: Invalid multiline without proper guards
-- ============================================================================
DO $$
BEGIN
  CREATE TABLE "test_table" (
    id SERIAL PRIMARY KEY,
    name TEXT
  );
  -- Missing EXCEPTION WHEN duplicate_object
END $$;

-- ============================================================================
-- Test fixture migration file 15: Complex CREATE INDEX with quoted identifiers
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_email ON "users" (email);

-- ============================================================================
-- Test fixture migration file 16: Invalid dollar-quoted block
-- ============================================================================
DO $$
DECLARE
  v_var integer;
BEGIN
  v_var := 1;
  RAISE NOTICE 'Test block';
END $$;

-- Note: This block does not contain CREATE statements, so it should pass linting

-- ============================================================================
-- Test fixture migration file 17: Mixed guards with comments
-- ============================================================================
/* This is a comment */
CREATE TABLE IF NOT EXISTS "mixed" (
  id SERIAL PRIMARY KEY
); -- Another comment

-- ============================================================================
-- Test fixture migration file 18: Escaped quotes and multiline
-- ============================================================================
CREATE TABLE "test_table" (
  id SERIAL PRIMARY KEY,
  "description" TEXT DEFAULT '''This is a test'''
);

-- ============================================================================
-- Test fixture migration file 19: Parentheses in various contexts
-- ============================================================================
CREATE TYPE "status" AS ENUM (
  'ACTIVE' (1),
  'INACTIVE' (2)
);

CREATE TABLE "parentheses_test" (
  id SERIAL CHECK (id > 0 AND id < 100),
  "category" TEXT CHECK (category IN ('A', 'B', 'C'))
);

-- ============================================================================
-- Test fixture migration file 20: Real-world scenario with proper guards
-- ============================================================================
DO $$
BEGIN
  CREATE TYPE "trip_status" AS ENUM (
    'PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
  ) ON COMMIT PRESERVE;
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'Trip status type already exists';
  
  CREATE TABLE IF NOT EXISTS "trips" (
    trip_id SERIAL PRIMARY KEY,
    trip_number VARCHAR(20) UNIQUE NOT NULL,
    status "trip_status" DEFAULT 'PLANNED',
    start_date TIMESTAMP,
    end_date TIMESTAMP
  );
  
  CREATE INDEX IF NOT EXISTS idx_trips_status ON "trips" (status);
  CREATE INDEX IF NOT EXISTS idx_trips_number ON "trips" (trip_number);
  
  ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();
  ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
END $$;
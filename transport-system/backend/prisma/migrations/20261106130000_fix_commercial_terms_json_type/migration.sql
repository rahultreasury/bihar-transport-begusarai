-- Convert trips.commercial_terms from JSON to JSONB
--
-- WHY THIS MIGRATION EXISTS
--   Migration 20261104140000_add_manual_trip_source created the column as `json`
--   but Prisma's `Json?` type maps to PostgreSQL `jsonb`. This migration
--   converts the column type to match the schema.prisma declaration.
--
-- BACKWARD COMPATIBILITY
--   * Only alters column type, preserves all data
--   * No table is dropped, truncated or rewritten
--   * No row is deleted
--   * Safe to apply against production

-- Convert commercial_terms from json to jsonb
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trips'
      AND column_name = 'commercial_terms'
      AND data_type = 'json'
  ) THEN
    ALTER TABLE "trips"
    ALTER COLUMN "commercial_terms"
    TYPE JSONB
    USING "commercial_terms"::JSONB;
  END IF;
END $$;
-- Add idempotency_key to Enquiry for admin manual booking idempotency
--
-- WHY THIS MIGRATION EXISTS
--   When an admin creates a manual booking via the shared booking form, the
--   Enquiry and Booking are created in separate transactions. If the first
--   request creates the Enquiry but fails before creating the Booking, a retry
--   with the same idempotency key would not find a Booking and would create a
--   second Enquiry. This migration adds the idempotency key to the Enquiry
--   model so both Enquiry and Booking can be checked for duplicates.
--
-- BACKWARD COMPATIBILITY
--   * Only adds a nullable column and unique index
--   * No table is dropped, truncated or rewritten
--   * No row is deleted or modified
--   * Safe to apply against production

-- 1. Idempotency key column on enquiries
ALTER TABLE "enquiries" ADD COLUMN IF NOT EXISTS "idempotency_key" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'enquiries' AND indexname = 'idx_enquiries_idempotency_key'
  ) THEN
    CREATE UNIQUE INDEX "idx_enquiries_idempotency_key" ON "enquiries"("idempotency_key");
  END IF;
END $$;
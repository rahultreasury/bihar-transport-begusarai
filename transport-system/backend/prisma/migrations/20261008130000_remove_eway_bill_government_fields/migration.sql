-- ============================================================================
-- 20261008130000_remove_eway_bill_government_fields
-- ============================================================================
-- REMOVE GOVERNMENT E-WAY BILL FIELDS
--
-- The E-Way Bill module is purely an INTERNAL RECORD-KEEPING system.
-- Bihar Transport does not integrate with the Government/NIC E-Way Bill API.
-- These columns were placeholders for a government integration that will never
-- exist in this system. They are removed to make the schema honest.
--
-- SAFETY
--   * This is a DROP COLUMN operation. It is NOT reversible without data loss.
--   * The columns being dropped have ALWAYS been NULL or 'NOT_CONNECTED' in
--     production because no government API was ever implemented.
--   * No application code depends on these columns for business logic.
--   * Run this migration only after confirming the columns contain no data
--     that must be preserved.
--
-- LOCAL ONLY. Not deployed until reviewed.
-- ============================================================================

-- Verify the columns are empty before dropping
DO $$
DECLARE
  gov_sync_count INTEGER;
  gov_number_count INTEGER;
  gov_synced_count INTEGER;
  gov_response_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO gov_sync_count FROM "eway_bills" WHERE "gov_sync_status" != 'NOT_CONNECTED';
  SELECT COUNT(*) INTO gov_number_count FROM "eway_bills" WHERE "gov_eway_bill_number" IS NOT NULL;
  SELECT COUNT(*) INTO gov_synced_count FROM "eway_bills" WHERE "gov_synced_at" IS NOT NULL;
  SELECT COUNT(*) INTO gov_response_count FROM "eway_bills" WHERE "gov_response" IS NOT NULL;

  IF gov_sync_count > 0 OR gov_number_count > 0 OR gov_synced_count > 0 OR gov_response_count > 0 THEN
    RAISE EXCEPTION 'Government E-Way Bill columns contain non-default data. Aborting migration.';
  END IF;
END $$;

-- Drop the government columns
ALTER TABLE "eway_bills" DROP COLUMN IF EXISTS "gov_sync_status";
ALTER TABLE "eway_bills" DROP COLUMN IF EXISTS "gov_eway_bill_number";
ALTER TABLE "eway_bills" DROP COLUMN IF EXISTS "gov_synced_at";
ALTER TABLE "eway_bills" DROP COLUMN IF EXISTS "gov_response";
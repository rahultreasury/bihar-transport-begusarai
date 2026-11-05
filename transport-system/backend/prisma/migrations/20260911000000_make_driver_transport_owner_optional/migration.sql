-- =====================================================================
-- Make Driver.transport_owner_id nullable to support independent driver registration
-- =====================================================================

ALTER TABLE "drivers" ALTER COLUMN "transport_owner_id" DROP NOT NULL;

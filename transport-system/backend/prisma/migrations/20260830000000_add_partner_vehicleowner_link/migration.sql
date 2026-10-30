-- AlterTable
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "partner_capability" TEXT NOT NULL DEFAULT 'PARTNER_ONLY';

-- AlterTable
ALTER TABLE "vehicle_owners" ADD COLUMN IF NOT EXISTS "partner_link" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_owners_partner_link_key" ON "vehicle_owners"("partner_link");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_partner_capability" ON "partners"("partner_capability");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_vehicle_owner_partner_link" ON "vehicle_owners"("partner_link");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_owners_partner_link_fkey'
    ) THEN
        ALTER TABLE "vehicle_owners" ADD CONSTRAINT "vehicle_owners_partner_link_fkey" FOREIGN KEY ("partner_link") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

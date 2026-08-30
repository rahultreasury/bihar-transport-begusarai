-- AlterTable
ALTER TABLE "partners" ADD COLUMN     "partner_capability" TEXT NOT NULL DEFAULT 'PARTNER_ONLY';

-- AlterTable
ALTER TABLE "vehicle_owners" ADD COLUMN     "partner_link" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_owners_partner_link_key" ON "vehicle_owners"("partner_link");

-- CreateIndex
CREATE INDEX "idx_partner_capability" ON "partners"("partner_capability");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_partner_link" ON "vehicle_owners"("partner_link");

-- AddForeignKey
ALTER TABLE "vehicle_owners" ADD CONSTRAINT "vehicle_owners_partner_link_fkey" FOREIGN KEY ("partner_link") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;

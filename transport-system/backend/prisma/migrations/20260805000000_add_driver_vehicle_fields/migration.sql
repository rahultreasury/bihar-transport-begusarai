-- AlterTable
ALTER TABLE "drivers" ADD COLUMN     "vehicle_type" TEXT,
ADD COLUMN     "vehicle_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "drivers_vehicle_number_key" ON "drivers"("vehicle_number");

-- CreateIndex
CREATE INDEX "idx_drivers_vehicle_type" ON "drivers"("vehicle_type");

-- CreateIndex
CREATE INDEX "idx_drivers_vehicle_number" ON "drivers"("vehicle_number");


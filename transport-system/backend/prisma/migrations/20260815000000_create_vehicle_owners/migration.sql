-- CreateTable
CREATE TABLE "vehicle_owners" (
    "owner_id" SERIAL NOT NULL,
    "owner_code" TEXT,
    "owner_name" TEXT NOT NULL,
    "company_name" TEXT,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "alternate_mobile" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "gst_number" TEXT,
    "pan_number" TEXT,
    "bank_account" TEXT,
    "bank_ifsc" TEXT,
    "bank_name" TEXT,
    "upi_id" TEXT,
    "address" TEXT,
    "status" TEXT DEFAULT 'active',
    "owner_type" TEXT DEFAULT 'TRANSPORT_COMPANY',
    "notes" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "vehicle_owners_pkey" PRIMARY KEY ("owner_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_owners_owner_code_key" ON "vehicle_owners"("owner_code");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_code" ON "vehicle_owners"("owner_code");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_mobile" ON "vehicle_owners"("mobile");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_status" ON "vehicle_owners"("status");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_city" ON "vehicle_owners"("city");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_state" ON "vehicle_owners"("state");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_active" ON "vehicle_owners"("is_active");

-- CreateIndex
CREATE INDEX "idx_vehicle_owner_type" ON "vehicle_owners"("owner_type");

-- NOTE: partner_link column and its indexes/constraints are added by
-- 20260830000000_add_partner_vehicleowner_link which runs after this migration.

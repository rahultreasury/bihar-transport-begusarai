-- ============================================================================
-- ADDITIVE-ONLY SCHEMA REPAIR
-- Repairs missing migration: 20260803060304_add_quote_workflow
-- AND missing migration: 20260805000000_add_driver_vehicle_fields
--
-- SOURCE: Generated via `prisma migrate diff` from live DB → schema.prisma,
--         then REVIEWED and SANITIZED to be ADDITIVE ONLY.
--
-- SAFETY DECISIONS (reviewed):
--   * The raw `prisma migrate diff` output wanted to DROP the legacy vehicle
--     columns (`bookings.vehicle_id`, `deliveries.vehicle_id`,
--     `booking_assignments.assigned_vehicle_id`) and enums (`VehicleStatus`,
--     `VehicleType`). Those columns STILL CONTAIN DATA in this live DB
--     (1 row each verified). DROPPING THEM WOULD LOSE DATA.
--   * Per the task requirement, this repair is ADDITIVE ONLY and PRESERVES
--     ALL existing booking data.
--   * The legacy vehicle columns are NOT referenced by the current Prisma
--     schema (brokerage model), so leaving them in place is harmless — Prisma
--     simply ignores unknown columns. They can be removed in a separate,
--     deliberate cleanup migration AFTER data is backed up.
--   * `model TransportVehicle` still exists in schema.prisma, so the
--     `transport_vehicles` table is NOT dropped, and its FK from `bookings`
--     is preserved.
--
-- This script performs ONLY:
--   * CREATE TYPE (new enums)
--   * ADD COLUMN (new nullable/default columns)
--   * CREATE TABLE (new tables)
--   * CREATE INDEX (new indexes)
--   * ADD CONSTRAINT (new FKs)
--
-- NO DROP, NO ALTER of existing columns, NO data mutation.
-- ============================================================================

-- 1. Enums (missing)
CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'PREPARING', 'DRIVER_RESERVED', 'VEHICLE_RESERVED', 'QUOTE_SENT', 'WAITING_CUSTOMER_APPROVAL', 'ACCEPTED', 'REJECTED', 'EXPIRED');
CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'PAID', 'CANCELLED');

-- 2. Add quote-workflow columns to bookings (NULLable / DEFAULT — non-destructive)
ALTER TABLE "bookings"
  ADD COLUMN "quote_accepted_at" TIMESTAMP(3),
  ADD COLUMN "quote_rejected_at" TIMESTAMP(3),
  ADD COLUMN "quote_remarks" TEXT,
  ADD COLUMN "quote_sent_at" TIMESTAMP(3),
  ADD COLUMN "quote_status" TEXT DEFAULT 'PENDING',
  ADD COLUMN "quote_valid_until" TIMESTAMP(3);

-- 3. Add driver vehicle fields (missing migration 20260805000000)
ALTER TABLE "drivers"
  ADD COLUMN "vehicle_number" TEXT,
  ADD COLUMN "vehicle_type" TEXT;

-- 4. reservations table (new)
CREATE TABLE "reservations" (
    "reservation_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "driver_id" INTEGER,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "reserved_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservations_pkey" PRIMARY KEY ("reservation_id")
);

-- 5. invoices table (new)
CREATE TABLE "invoices" (
    "invoice_id" SERIAL NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "final_price" DOUBLE PRECISION NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "goods_amount" DOUBLE PRECISION,
    "vehicle_charge" DOUBLE PRECISION,
    "extra_charges" DOUBLE PRECISION DEFAULT 0,
    "discount" DOUBLE PRECISION DEFAULT 0,
    "total_amount" DOUBLE PRECISION,
    "tax_amount" DOUBLE PRECISION DEFAULT 0,
    "grand_total" DOUBLE PRECISION,
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id")
);

-- 6. Indexes for new tables
CREATE INDEX "idx_reservations_booking" ON "reservations"("booking_id");
CREATE INDEX "idx_reservations_driver" ON "reservations"("driver_id");
CREATE INDEX "idx_reservations_status" ON "reservations"("status");
CREATE INDEX "idx_reservations_expires" ON "reservations"("expires_at");

CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX "idx_invoices_number" ON "invoices"("invoice_number");
CREATE INDEX "idx_invoices_booking" ON "invoices"("booking_id");
CREATE INDEX "idx_invoices_status" ON "invoices"("status");

CREATE UNIQUE INDEX "drivers_vehicle_number_key" ON "drivers"("vehicle_number");
CREATE INDEX "idx_drivers_vehicle_type" ON "drivers"("vehicle_type");
CREATE INDEX "idx_drivers_vehicle_number" ON "drivers"("vehicle_number");

-- 7. Foreign keys for new tables
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

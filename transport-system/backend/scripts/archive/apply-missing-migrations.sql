-- ============================================================
-- Repair script: Apply missing migration SQL that was recorded
-- as "applied" in _prisma_migrations but never actually executed.
-- All statements use IF NOT EXISTS / conditional logic for safety.
-- Does NOT delete or reset any data.
-- ============================================================

-- 1. Create missing enums (PostgreSQL doesn't support CREATE TYPE IF NOT EXISTS for enums)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'QuoteStatus') THEN
    CREATE TYPE "QuoteStatus" AS ENUM ('PENDING', 'PREPARING', 'DRIVER_RESERVED', 'VEHICLE_RESERVED', 'QUOTE_SENT', 'WAITING_CUSTOMER_APPROVAL', 'ACCEPTED', 'REJECTED', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReservationStatus') THEN
    CREATE TYPE "ReservationStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InvoiceStatus') THEN
    CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'GENERATED', 'PAID', 'CANCELLED');
  END IF;
END $$;

-- 2. Add missing columns to bookings table
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_status" TEXT DEFAULT 'PENDING';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "confirmation_source" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_remarks" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_sent_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_accepted_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_valid_until" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_rejected_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP;

-- 3. Add missing columns to drivers table
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_type" TEXT;
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "vehicle_number" TEXT;

-- 4. Create reservations table (if missing)
CREATE TABLE IF NOT EXISTS "reservations" (
    "reservation_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "driver_id" INTEGER,
    "vehicle_id" INTEGER,
    "status" "ReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),
    "reserved_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reservations_pkey" PRIMARY KEY ("reservation_id")
);

-- 5. Create invoices table (if missing)
CREATE TABLE IF NOT EXISTS "invoices" (
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

-- 6. Create indexes for reservations
CREATE INDEX IF NOT EXISTS "idx_reservations_booking" ON "reservations"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_reservations_driver" ON "reservations"("driver_id");
CREATE INDEX IF NOT EXISTS "idx_reservations_vehicle" ON "reservations"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_reservations_status" ON "reservations"("status");
CREATE INDEX IF NOT EXISTS "idx_reservations_expires" ON "reservations"("expires_at");

-- 7. Create indexes for invoices
CREATE UNIQUE INDEX IF NOT EXISTS "invoices_invoice_number_key" ON "invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "idx_invoices_number" ON "invoices"("invoice_number");
CREATE INDEX IF NOT EXISTS "idx_invoices_booking" ON "invoices"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_invoices_status" ON "invoices"("status");

-- 8. Create indexes for drivers vehicle fields
CREATE UNIQUE INDEX IF NOT EXISTS "drivers_vehicle_number_key" ON "drivers"("vehicle_number");
CREATE INDEX IF NOT EXISTS "idx_drivers_vehicle_type" ON "drivers"("vehicle_type");
CREATE INDEX IF NOT EXISTS "idx_drivers_vehicle_number" ON "drivers"("vehicle_number");

-- 9. Create index for archived_at
CREATE INDEX IF NOT EXISTS "idx_bookings_archived_at" ON "bookings" ("archived_at");

-- 10. Add foreign keys (conditional)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reservations_booking_id_fkey' AND table_name = 'reservations'
  ) THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reservations_driver_id_fkey' AND table_name = 'reservations'
  ) THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_id_fkey"
      FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'reservations_vehicle_id_fkey' AND table_name = 'reservations'
  ) THEN
    ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'invoices_booking_id_fkey' AND table_name = 'invoices'
  ) THEN
    ALTER TABLE "invoices" ADD CONSTRAINT "invoices_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- =====================================================================
-- Migration: add_client_and_trip_source
-- Phase 2B.1 — Add Client model and Trip source tracking.
-- =====================================================================

-- 1) Create TripSourceType enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripSourceType') THEN
        CREATE TYPE "TripSourceType" AS ENUM ('ONLINE_BOOKING', 'OFFLINE_CLIENT', 'DIRECT');
    END IF;
END $$;

-- 2) Create clients table
CREATE TABLE IF NOT EXISTS "clients" (
    "client_id" SERIAL NOT NULL,
    "client_code" TEXT UNIQUE,
    "company_name" TEXT NOT NULL,
    "contact_person" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "gst_number" TEXT,
    "pan_number" TEXT,
    "bank_account" TEXT,
    "bank_ifsc" TEXT,
    "bank_name" TEXT,
    "upi_id" TEXT,
    "status" TEXT DEFAULT 'active',
    "notes" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "clients_pkey" PRIMARY KEY ("client_id")
);

-- 3) Add source_type and client_id to trips
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "source_type" "TripSourceType" NOT NULL DEFAULT 'ONLINE_BOOKING';
ALTER TABLE "trips" ADD COLUMN IF NOT EXISTS "client_id" INTEGER;

-- 4) Add foreign key for client_id
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'trips_client_id_fkey' 
        AND table_name = 'trips'
    ) THEN
        ALTER TABLE "trips" ADD CONSTRAINT "trips_client_id_fkey" 
            FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") 
            ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;
END $$;

-- 5) Make user_id nullable (for offline/direct trips)
ALTER TABLE "trips" ALTER COLUMN "user_id" DROP NOT NULL;

-- 6) Create indexes
CREATE INDEX IF NOT EXISTS "idx_client_code" ON "clients"("client_code");
CREATE INDEX IF NOT EXISTS "idx_client_company" ON "clients"("company_name");
CREATE INDEX IF NOT EXISTS "idx_client_phone" ON "clients"("phone");
CREATE INDEX IF NOT EXISTS "idx_client_email" ON "clients"("email");
CREATE INDEX IF NOT EXISTS "idx_client_status" ON "clients"("status");
CREATE INDEX IF NOT EXISTS "idx_client_active" ON "clients"("is_active");
CREATE INDEX IF NOT EXISTS "idx_trips_source_type" ON "trips"("source_type");
CREATE INDEX IF NOT EXISTS "idx_trips_client_id" ON "trips"("client_id");

-- Trip Management Enhancement Migration
-- Adds: TripTimeline model, payment_category to TripPayment, new fields to Trip

-- Add payment_category enum
DO $$ BEGIN
    CREATE TYPE "TripPaymentCategory" AS ENUM ('CLIENT_PAYMENT', 'OWNER_PAYMENT', 'DRIVER_PAYMENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add payment_category column to trip_payments
ALTER TABLE "trip_payments"
ADD COLUMN IF NOT EXISTS "payment_category" "TripPaymentCategory" NOT NULL DEFAULT 'CLIENT_PAYMENT';

-- Add index on payment_category
CREATE INDEX IF NOT EXISTS "idx_trip_payments_category" ON "trip_payments"("payment_category");

-- Add new columns to trips table
ALTER TABLE "trips"
ADD COLUMN IF NOT EXISTS "expected_delivery_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "trip_delivered_date" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "client_received" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS "owner_paid" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN IF NOT EXISTS "driver_paid" DOUBLE PRECISION DEFAULT 0;

-- Create TripTimeline table
CREATE TABLE IF NOT EXISTS "trip_timeline" (
    "timeline_id" SERIAL PRIMARY KEY,
    "trip_id" INTEGER NOT NULL REFERENCES "trips"("trip_id") ON DELETE CASCADE,
    "event_type" VARCHAR(50) NOT NULL,
    "description" TEXT NOT NULL,
    "reference_type" VARCHAR(50),
    "reference_id" INTEGER,
    "metadata" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT NOW()
);

-- Create indexes for TripTimeline
CREATE INDEX IF NOT EXISTS "idx_trip_timeline_trip" ON "trip_timeline"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_trip_timeline_event" ON "trip_timeline"("event_type");
CREATE INDEX IF NOT EXISTS "idx_trip_timeline_date" ON "trip_timeline"("created_at");

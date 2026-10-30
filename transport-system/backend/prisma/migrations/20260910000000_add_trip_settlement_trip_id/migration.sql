-- Add trip_id support to TripSettlement for standalone trips
-- Make booking_id nullable (standalone trips may not have a booking)
-- Add trip_id column with FK to trips table

ALTER TABLE "trip_settlements" ALTER COLUMN "booking_id" DROP NOT NULL;

ALTER TABLE "trip_settlements" ADD COLUMN IF NOT EXISTS "trip_id" INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'trip_settlements_trip_id_fkey'
    ) THEN
        ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_trip_id_fkey"
            FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_trip_settlement_trip" ON "trip_settlements"("trip_id");
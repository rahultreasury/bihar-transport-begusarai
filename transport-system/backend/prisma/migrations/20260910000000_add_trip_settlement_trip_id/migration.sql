-- Add trip_id support to TripSettlement for standalone trips
-- Make booking_id nullable (standalone trips may not have a booking)
-- Add trip_id column with FK to trips table

ALTER TABLE "trip_settlements" ALTER COLUMN "booking_id" DROP NOT NULL;

ALTER TABLE "trip_settlements" ADD COLUMN "trip_id" INTEGER;

ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_trip_id_fkey"
    FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "idx_trip_settlement_trip" ON "trip_settlements"("trip_id");
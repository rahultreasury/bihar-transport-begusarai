-- Add archived_at column to bookings table for soft-delete / archive functionality
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP;

-- Index for filtering archived bookings
CREATE INDEX IF NOT EXISTS "idx_bookings_archived_at" ON "bookings" ("archived_at");

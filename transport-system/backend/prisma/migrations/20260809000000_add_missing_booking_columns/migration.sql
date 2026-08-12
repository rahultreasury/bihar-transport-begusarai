-- Add missing quote workflow columns to bookings table
-- These columns exist in prisma/schema.prisma but are absent from the live database

ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_status" TEXT DEFAULT 'PENDING';
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "confirmation_source" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_remarks" TEXT;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_sent_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_accepted_at" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_valid_until" TIMESTAMP(3);
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "quote_rejected_at" TIMESTAMP(3);

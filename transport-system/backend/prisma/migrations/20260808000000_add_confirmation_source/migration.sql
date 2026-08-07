-- Add confirmation_source to bookings (CUSTOMER | ADMIN)
-- Records how the booking was confirmed. quote_status remains the single
-- source of truth for confirmation.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "confirmation_source" TEXT;

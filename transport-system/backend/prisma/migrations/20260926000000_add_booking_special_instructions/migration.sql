-- Persist the customer-entered special_instructions from the booking form.
--
-- Nullable TEXT, so every existing booking row is unaffected and the column
-- simply reads NULL for historical bookings that had no instructions.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "special_instructions" TEXT;

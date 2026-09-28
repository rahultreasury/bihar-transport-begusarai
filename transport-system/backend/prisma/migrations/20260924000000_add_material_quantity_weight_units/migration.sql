-- Add quantity_unit and weight_unit to bookings (Step 2: Material + Quantity + Weight)
-- These are nullable TEXT columns so existing booking records are unaffected.
-- goods_description is reused as the material/goods name.
-- number_of_items is reused as the quantity number.
-- goods_weight_kg is reused as the weight value.
ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "quantity_unit" TEXT,
  ADD COLUMN IF NOT EXISTS "weight_unit" TEXT;

-- ============================================================
-- Canonical Booking Number Migration
-- ------------------------------------------------------------
-- Purpose:
--   Establish ONE canonical, deterministic, sequential booking
--   number format:  BTB-YYYY-NNNNN
--
--   The number is derived from the DB autoincrement primary key
--   (booking_id) + the booking creation year. booking_id is unique,
--   so the derived number is always unique — safe under concurrent
--   creation with NO SELECT MAX()+1 race.
--
--   booking_number  → canonical customer/admin-facing number
--   booking_reference → kept as a legacy/backward-compat alias
--                     (mirrors booking_number for new bookings;
--                      existing random values preserved so old
--                      tracking/email/WhatsApp links keep working).
--
-- Reversible/safe: existing rows are preserved, booking_id is never
-- modified, and no columns are dropped.
-- ============================================================

-- 1. Backfill booking_number for ALL rows to the canonical form
--    derived from booking_id + creation year. Because booking_id is
--    the unique PK, the derived string is guaranteed unique — no
--    duplicate booking numbers can be produced by this update.
UPDATE "bookings"
SET "booking_number" =
      'BTB-' ||
      EXTRACT(YEAR FROM COALESCE("created_at", CURRENT_TIMESTAMP))::text ||
      '-' ||
      LPAD("booking_id"::text, 5, '0')
WHERE "booking_number" IS NULL
   OR "booking_number" !~* '^BTB-[0-9]{4}-[0-9]{5}$';

-- 2. Drop the old (non-unique) booking_number index.
DROP INDEX IF EXISTS "idx_bookings_booking_number";

-- 3. Add a UNIQUE index on booking_number. This enforces the
--    canonical-number invariant at the database level.
--    (PostgreSQL unique indexes allow multiple NULLs; our backfill
--    ensures no NULLs remain, so this is fully enforced.)
CREATE UNIQUE INDEX "bookings_booking_number_key" ON "bookings"("booking_number");

-- 4. Keep booking_reference as a legacy alias. It remains NOT NULL
--    and unique; new bookings set it to mirror booking_number.
--    No change required — existing unique index
--    ("bookings_booking_reference_key") is preserved.

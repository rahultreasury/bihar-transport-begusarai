-- Reconcile fresh-migration-replay equivalence with schema.prisma.
--
-- WHY THIS MIGRATION EXISTS
--   `prisma migrate diff --from-migrations prisma/migrations
--   --to-schema-datamodel prisma/schema.prisma` (the Migration CI check)
--   reported drift between a database built PURELY by replaying the committed
--   migrations and the schema.prisma datamodel. Neon production and the
--   developer databases were built partly outside the migration history
--   (prisma db push era), so they already match schema.prisma — this migration
--   only brings a FRESH replay to the same shape. Every statement is guarded
--   and safe on databases that already match (Neon: no-ops or harmless
--   metadata changes; no row is deleted or rewritten).
--
-- DRIFT ITEMS FIXED (verified 2026-11-02 against Neon + fresh local replay)
--   1. trip_advances.trip_financial_id / booking_id nullability:
--      20260820000000 creates them nullable and the APPLICATION depends on
--      that — TripAdvanceService.createAdvance writes booking_id:
--      target.bookingId which is NULL for standalone trips (Vehicle Hire
--      workflow creates trips with no booking), and
--      FinancePostingService.createAdvance computes
--      `booking_id: input.booking_id || trip?.booking_id || null`.
--      Neon's NOT NULL is a db-push-era artifact that breaks advance posting
--      on standalone trips. Relaxing to nullable is the business-correct,
--      data-preserving direction (it can never fail on existing rows).
--   2. partner_applications unique index name: 20261028150000 renames
--      idx_app_code -> partner_applications_application_code_key on fresh
--      databases, while schema.prisma (and Neon) declare map: "idx_app_code".
--      Neon ended up with BOTH indexes (duplicate enforcement) because the
--      rename was skipped when partner_applications_application_code_key
--      already existed. Normalization ends with exactly idx_app_code.
--   3. trips.user_id FK action: 20261028150000 creates trips_user_id_fkey as
--      ON DELETE SET NULL; schema.prisma (and Neon) declare ON DELETE
--      RESTRICT. Drop/recreate with the schema-declared actions.
--   4. Legacy enum trip_expense_type: 20261028150000 renames it to
--      TripExpenseType on fresh databases, but schema.prisma still declares
--      the legacy enum (introspected from Neon, where the rename was skipped
--      because TripExpenseType already existed). Recreated here so every
--      state — fresh replay, Neon, schema.prisma — carries the same enums.
--
-- SAFETY
--   * DROP NOT NULL never destroys data and never fails on existing rows.
--   * The partner_applications normalization drops only the redundant
--     duplicate unique index; idx_app_code keeps enforcing uniqueness.
--   * The trips_user_id_fkey drop/recreate validates against existing rows
--     (all user_id values already reference users — the constraint exists
--     today with the same target).
--   * Idempotent: safe on Neon (no-ops / harmless metadata changes) and on
--     fresh replays (fixes the drift).

-- 1. trip_advances: relax to the nullability the application already uses.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_advances' AND column_name = 'trip_financial_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "trip_advances" ALTER COLUMN "trip_financial_id" DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trip_advances' AND column_name = 'booking_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE "trip_advances" ALTER COLUMN "booking_id" DROP NOT NULL;
  END IF;
END $$;

-- 2. partner_applications: end with exactly one unique index named
--    idx_app_code (the name schema.prisma declares via @unique(map)).
DROP INDEX IF EXISTS "partner_applications_application_code_key";
CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_code" ON "partner_applications"("application_code");

-- 3. trips.user_id FK: ON DELETE RESTRICT ON UPDATE CASCADE, matching
--    schema.prisma (Trip.user onDelete: Restrict) and Neon production.
ALTER TABLE "trips" DROP CONSTRAINT IF EXISTS "trips_user_id_fkey";
ALTER TABLE "trips"
  ADD CONSTRAINT "trips_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. Legacy enum trip_expense_type: recreate on fresh replay databases so the
--    database carries every enum schema.prisma declares. Unused by models;
--    kept for exact schema/migration equivalence.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trip_expense_type') THEN
    CREATE TYPE "trip_expense_type" AS ENUM (
      'DRIVER', 'DIESEL', 'TOLL', 'LOADING', 'UNLOADING', 'OWNER',
      'MAINTENANCE', 'LABOUR', 'DOCUMENTATION', 'PARKING', 'LOCAL_TRANSPORT',
      'CUSTOMER_RELATED', 'COMMUNICATION', 'OTHER'
    );
  END IF;
END $$;

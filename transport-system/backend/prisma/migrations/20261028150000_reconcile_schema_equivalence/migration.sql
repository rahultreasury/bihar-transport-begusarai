-- reconcile_schema_equivalence
--schema.prisma. Everything here is guarded so the migration is safe BOTH
-- ways:
--   • on a FRESH database built only from the earlier migrations, where the
--     final shape must become exactly what schema.prisma declares (so
--     `prisma migrate diff --from-migrations --to-schema-datamodel` is empty);
--   • on an existing development database that was aligned to schema.prisma
--     directly (where every statement below must be a no-op).
--
-- WHAT THE DRIFT WAS (verified on an isolated `prisma migrate deploy` DB):
--   • production reality ran ahead of the committed migrations: columns such
--     as drivers.current_vehicle_id, bookings.vehicle_owner_id /
--     driver_payout / owner_settlement_amount, transport_vehicles.owner_id /
--     vehicle_code and partners.available_capacity existed in schema.prisma
--     and in live code, but in NO committed migration → a fresh deployment
--     booted, but every Prisma Client SELECT of those columns failed with
--     P2022 ("column does not exist").
--   • several FKs that schema.prisma enforces were never committed (trips →
--     bookings/drivers/vehicle_owners/users/transport_vehicles, the
--     financial-ledger self-tables, etc.) → a fresh deployment had NO
--     referential integrity on the financial core.
--   • enum naming drift: the migrations created lowercase copies
--     (trip_expense_type, expense_paid_by) while schema.prisma uses
--     TripExpenseType / ExpensePaidBy, and LedgerTransactionType / UserRole
--     gained values in schema.prisma that no migration ever added.
--
-- NO DATA IS DESTROYED: enum types are RENAMED, not recreated; columns are
-- added with IF NOT EXISTS; dropped statements are guarded with IF EXISTS.

-- ============================================================================
-- 1. ENUM ALIGNMENT
-- ============================================================================

-- LedgerTransactionType values schema.prisma declares but no migration added.
DO $$
BEGIN
  ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'partner_payable';
  ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'partner_receivable';
  ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'settlement_payment';
  ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'settlement_receipt';
END $$;

-- UserRole gained 'partner'.
DO $$
BEGIN
  ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'partner';
END $$;

-- Enum naming drift: RENAME the legacy lowercase types instead of
-- drop-and-recreate, so every existing column keeps working and no data is
-- touched. Both are renames ONLY — the value sets already match schema.prisma.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'trip_expense_type')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripExpenseType') THEN
    ALTER TYPE "trip_expense_type" RENAME TO "TripExpenseType";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expense_paid_by')
     AND NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExpensePaidBy') THEN
    ALTER TYPE "expense_paid_by" RENAME TO "ExpensePaidBy";
  END IF;
END $$;

-- VehicleStatus / VehicleType are declared by oid legacy migrations but are
-- used by NO column in the present schema — drop them so the DB matches.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleStatus') THEN
    DROP TYPE "VehicleStatus";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VehicleType') THEN
    DROP TYPE "VehicleType";
  END IF;
END $$;

-- ============================================================================
-- 2. COLUMNS
-- ============================================================================

-- bookings
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "driver_payout" DOUBLE PRECISION;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "owner_settlement_amount" DOUBLE PRECISION;
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "vehicle_owner_id" INTEGER;
ALTER TABLE "bookings" ALTER COLUMN "booking_reference" DROP NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "booking_number" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "archived_at" SET DATA TYPE TIMESTAMP(3);

-- drivers
ALTER TABLE "drivers" ADD COLUMN IF NOT EXISTS "current_vehicle_id" INTEGER;
ALTER TABLE "drivers" ALTER COLUMN "driver_code" DROP NOT NULL;
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "vehicle_number";
ALTER TABLE "drivers" DROP COLUMN IF EXISTS "vehicle_type";

-- eway_bills
ALTER TABLE "eway_bills" ALTER COLUMN "internal_status" SET DEFAULT 'RECORDED';

-- partner_applications
ALTER TABLE "partner_applications" ALTER COLUMN "state" DROP NOT NULL;

-- partners
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "available_capacity" TEXT;
ALTER TABLE "partners" ADD COLUMN IF NOT EXISTS "network_locations" TEXT;
ALTER TABLE "partners" ALTER COLUMN "partner_code" DROP NOT NULL;
ALTER TABLE "partners" ALTER COLUMN "partner_capability" DROP NOT NULL;

-- password_reset_tokens
ALTER TABLE "password_reset_tokens" ALTER COLUMN "created_at" DROP NOT NULL;

-- transport_vehicles
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "owner_id" INTEGER;
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "vehicle_code" TEXT;

-- trip_advances / vehicle_assignments
ALTER TABLE "trip_advances" ALTER COLUMN "status" DROP NOT NULL;
ALTER TABLE "vehicle_assignments" ALTER COLUMN "status" DROP NOT NULL;

-- trip_financials (the financial core row: keep the ledger writable without
-- assumption figures that are not yet known)
ALTER TABLE "trip_financials" ALTER COLUMN "customer_fare" DROP DEFAULT;
ALTER TABLE "trip_financials" ALTER COLUMN "total_advance" DROP NOT NULL;
ALTER TABLE "trip_financials" ALTER COLUMN "total_fuel_advance" DROP NOT NULL;
ALTER TABLE "trip_financials" ALTER COLUMN "remaining_driver_settlement" SET DEFAULT 0;
ALTER TABLE "trip_financials" ALTER COLUMN "total_owner_advance" DROP NOT NULL;
ALTER TABLE "trip_financials" ALTER COLUMN "remaining_owner_settlement" SET DEFAULT 0;
ALTER TABLE "trip_financials" ALTER COLUMN "commission_rate" DROP NOT NULL;
ALTER TABLE "trip_financials" ALTER COLUMN "commission_amount" DROP NOT NULL;
ALTER TABLE "trip_financials" ALTER COLUMN "bt_margin" DROP NOT NULL;

-- trip_timeline: free-form operational vocabularies are TEXT, not VARCHAR(n)
ALTER TABLE "trip_timeline" ALTER COLUMN "event_type" SET DATA TYPE TEXT;
ALTER TABLE "trip_timeline" ALTER COLUMN "reference_type" SET DATA TYPE TEXT;

-- trips
ALTER TABLE "trips" ALTER COLUMN "freight_amount" DROP DEFAULT;
-- source_type was added earlier as TEXT; schema.prisma declares it as the
-- TripSourceType enum. Cast existing rows instead of dropping them.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trips' AND column_name = 'source_type'
      AND udt_name <> 'TripSourceType'
  ) AND EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TripSourceType') THEN
    -- Drop the TEXT default first; Postgres cannot auto-cast a text default
    -- to an enum type. Re-set the enum-typed default immediately below.
    ALTER TABLE "trips" ALTER COLUMN "source_type" DROP DEFAULT;
    ALTER TABLE "trips"
      ALTER COLUMN "source_type" SET DATA TYPE "TripSourceType"
      USING upper(source_type)::text::"TripSourceType";
    ALTER TABLE "trips" ALTER COLUMN "source_type" SET DEFAULT 'ONLINE_BOOKING'::"TripSourceType";
  END IF;
END $$;
ALTER TABLE "trips" ALTER COLUMN "documents_required" SET DATA TYPE JSONB
  USING "documents_required"::text::jsonb;

-- ============================================================================
-- 3. FOREIGN KEYS schema.prisma enforces but no migration ever committed
--    (a fresh deployment had NO referential integrity on the financial core)
-- ============================================================================

-- FKs the schema no longer defines.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_client_id_fkey') THEN
    ALTER TABLE "financial_transactions" DROP CONSTRAINT "financial_transactions_client_id_fkey";
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_vehicles_driver_id_fkey') THEN
    ALTER TABLE "transport_vehicles" DROP CONSTRAINT "transport_vehicles_driver_id_fkey";
  END IF;
END $$;

-- Rebuilt with CASCADE semantics the schema declares.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'trip_timeline_trip_id_fkey'
      AND (confdeltype <> 'c' OR confupdtype <> 'c')
  ) THEN
    ALTER TABLE "trip_timeline" DROP CONSTRAINT "trip_timeline_trip_id_fkey";
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trip_timeline_trip_id_fkey'
  ) THEN
    ALTER TABLE "trip_timeline" ADD CONSTRAINT "trip_timeline_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- drivers → their current vehicle
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'drivers_current_vehicle_id_fkey') THEN
    ALTER TABLE "drivers" ADD CONSTRAINT "drivers_current_vehicle_id_fkey"
      FOREIGN KEY ("current_vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- transport_vehicles → the owning VehicleOwner
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_vehicles_owner_id_fkey') THEN
    ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_owner_id_fkey"
      FOREIGN KEY ("owner_id") REFERENCES "vehicle_owners"("owner_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- bookings → the VehicleOwner the booking was sourced through
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_vehicle_owner_id_fkey') THEN
    ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_owner_id_fkey"
      FOREIGN KEY ("vehicle_owner_id") REFERENCES "vehicle_owners"("owner_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- vehicle_assignments: current assignment rows
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_assignments_driver_id_fkey') THEN
    ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_driver_id_fkey"
      FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_assignments_vehicle_id_fkey') THEN
    ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- partner_applications
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_applications_partner_id_fkey') THEN
    ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partner_id_fkey"
      FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_applications_user_id_fkey') THEN
    ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partner_applications_vehicle_owner_id_fkey') THEN
    ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_vehicle_owner_id_fkey"
      FOREIGN KEY ("vehicle_owner_id") REFERENCES "vehicle_owners"("owner_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- trip_financials → its Booking (the booking-first ledger row)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_financials_booking_id_fkey') THEN
    ALTER TABLE "trip_financials" ADD CONSTRAINT "trip_financials_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- trip_advances
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_advances_booking_id_fkey') THEN
    ALTER TABLE "trip_advances" ADD CONSTRAINT "trip_advances_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_advances_trip_financial_id_fkey') THEN
    ALTER TABLE "trip_advances" ADD CONSTRAINT "trip_advances_trip_financial_id_fkey"
      FOREIGN KEY ("trip_financial_id") REFERENCES "trip_financials"("trip_financial_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_advances_trip_id_fkey') THEN
    ALTER TABLE "trip_advances" ADD CONSTRAINT "trip_advances_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- trip_settlements
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_settlements_booking_id_fkey') THEN
    ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_settlements_trip_financial_id_fkey') THEN
    ALTER TABLE "trip_settlements" ADD CONSTRAINT "trip_settlements_trip_financial_id_fkey"
      FOREIGN KEY ("trip_financial_id") REFERENCES "trip_financials"("trip_financial_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- commission_records
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_records_booking_id_fkey') THEN
    ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_records_trip_financial_id_fkey') THEN
    ALTER TABLE "commission_records" ADD CONSTRAINT "commission_records_trip_financial_id_fkey"
      FOREIGN KEY ("trip_financial_id") REFERENCES "trip_financials"("trip_financial_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- financial_transactions (canonical money ledger)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_booking_id_fkey') THEN
    ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'financial_transactions_trip_financial_id_fkey') THEN
    ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_trip_financial_id_fkey"
      FOREIGN KEY ("trip_financial_id") REFERENCES "trip_financials"("trip_financial_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- trips → the entities a trip is made of
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_booking_id_fkey') THEN
    ALTER TABLE "trips" ADD CONSTRAINT "trips_booking_id_fkey"
      FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_driver_id_fkey') THEN
    ALTER TABLE "trips" ADD CONSTRAINT "trips_driver_id_fkey"
      FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_transport_owner_id_fkey') THEN
    ALTER TABLE "trips" ADD CONSTRAINT "trips_transport_owner_id_fkey"
      FOREIGN KEY ("transport_owner_id") REFERENCES "vehicle_owners"("owner_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_user_id_fkey') THEN
    ALTER TABLE "trips" ADD CONSTRAINT "trips_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trips_vehicle_id_fkey') THEN
    ALTER TABLE "trips" ADD CONSTRAINT "trips_vehicle_id_fkey"
      FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  -- trip_expenses / trip_payments
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_expenses_trip_id_fkey') THEN
    ALTER TABLE "trip_expenses" ADD CONSTRAINT "trip_expenses_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'trip_payments_trip_id_fkey') THEN
    ALTER TABLE "trip_payments" ADD CONSTRAINT "trip_payments_trip_id_fkey"
      FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- 4. INDEXES
-- ============================================================================

-- Indexes the schema no longer declares.
DROP INDEX IF EXISTS "idx_bookings_archived_at";
DROP INDEX IF EXISTS "idx_drivers_vehicle_number";
DROP INDEX IF EXISTS "idx_drivers_vehicle_type";
DROP INDEX IF EXISTS "idx_trips_client_id";
DROP INDEX IF EXISTS "idx_trips_source_type";

-- legacy explicit-unique drivers_vehicle_number_key (the column is gone above)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'drivers_vehicle_number_key' AND relkind = 'i') THEN
    DROP INDEX "drivers_vehicle_number_key";
  END IF;
END $$;

-- Indexes schema.prisma declares.
CREATE INDEX IF NOT EXISTS "idx_bookings_vehicle" ON "bookings"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_bookings_vehicle_owner" ON "bookings"("vehicle_owner_id");
CREATE INDEX IF NOT EXISTS "idx_bookings_booking_number" ON "bookings"("booking_number");
CREATE INDEX IF NOT EXISTS "idx_deliveries_vehicle" ON "deliveries"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_drivers_current_vehicle" ON "drivers"("current_vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_vehicles_owner" ON "transport_vehicles"("owner_id");
CREATE INDEX IF NOT EXISTS "idx_trip_expenses_type" ON "trip_expenses"("expense_type");
CREATE INDEX IF NOT EXISTS "idx_trip_expenses_paid_by" ON "trip_expenses"("paid_by");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'drivers_current_vehicle_id_key' AND relkind = 'i') THEN
    CREATE UNIQUE INDEX "drivers_current_vehicle_id_key" ON "drivers"("current_vehicle_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'transport_vehicles_vehicle_code_key' AND relkind = 'i') THEN
    CREATE UNIQUE INDEX "transport_vehicles_vehicle_code_key" ON "transport_vehicles"("vehicle_code");
  END IF;
END $$;

-- trip_financials.booking_id is UNIQUE in the schema; a legacy migration
-- created the same uniqueness PARTIAL (WHERE booking_id IS NOT NULL), which
-- prisma reports as drift. Recreate it as the full unique index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'trip_financials_booking_id_key'
      AND indexdef LIKE '%WHERE %'
  ) THEN
    DROP INDEX "trip_financials_booking_id_key";
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "trip_financials_booking_id_key" ON "trip_financials"("booking_id");

-- trips.trips_trip_number_key: the migrations created the same UNIQUE index
-- under the legacy name idx_trips_number.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_trips_number' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'trips_trip_number_key' AND relkind = 'i') THEN
    ALTER INDEX "idx_trips_number" RENAME TO "trips_trip_number_key";
  END IF;
END $$;
-- The schema ALSO declares a plain (non-unique) idx_trips_number alongside it.
CREATE INDEX IF NOT EXISTS "idx_trips_number" ON "trips"("trip_number");

-- partner_applications.application_code unique
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'idx_app_code' AND relkind = 'i')
     AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'partner_applications_application_code_key' AND relkind = 'i') THEN
    ALTER INDEX "idx_app_code" RENAME TO "partner_applications_application_code_key";
  END IF;
END $$;

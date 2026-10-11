-- ============================================================
-- VEHICLE HIRE (Phase 8) — RATE BASISES + VEHICLE DOCUMENT EXPIRIES
-- ============================================================
--
-- WHY
--   Two things the universal Vehicle Hire page needs that the repository did
--   not have. Neither introduces a new entity and neither touches a row that
--   already exists.
--
--   1. "Rate As Per" needs to express two more bases the business actually
--      uses on the road:
--        · TRANSPORT_COMMISSION — the trip is booked as a transport charge.
--        · NET_FREIGHT         — the vendor is quoted a NET payable, so the
--                                gross and the commission are solved from it.
--      Both are APPENDED to the existing VehicleHireRateBasis enum, so the
--      sort order of FIXED / PER_TON / PER_KG / PER_DAY / MONTHLY is unchanged
--      and no existing hire reorders.
--
--   2. The page reports six document expiries. `transport_vehicles` already
--      stored insurance_expiry, permit_expiry and pollution_expiry; tax,
--      fitness and the national permit were never captured at all. They are
--      added here as NULLABLE TEXT columns — the same type the three existing
--      expiry columns use, because `TransportVehicle` stores its documents as
--      text (see the "ENUM stored as TEXT" comment on vehicle_type) and a
--      mixed representation would mean two parsers for one concept.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • No new table, no rename, no drop, no data deletion.
--   • No backfill. A NULL expiry means "not recorded", which is the truth.
--     Inventing a date for a document the business never entered would let a
--     truck with an unknown fitness certificate pass the hire gate.
--   • No rewrite of the existing insurance / permit / pollution columns.
--   • No change to any other table, so the Vehicle master, the Driver master
--     and every financial table are exactly as they were.
--
-- PRODUCTION SAFETY
--   `ALTER TYPE ... ADD VALUE` and `ADD COLUMN ... NULL` are both non-blocking
--   catalog operations on PostgreSQL: no table is rewritten and no row is
--   locked for a meaningful period. Safe to run online with
--   `prisma migrate deploy`.
--
--   NOTE ON ENUM VALUES: PostgreSQL cannot USE a newly-added enum value inside
--   the same transaction that created it. This migration only ADDS the values
--   — it never writes one — and the `vehicle_hires` table (which does use
--   them) is created by the NEXT migration, which runs in its own
--   transaction. That ordering is deliberate; do not merge the two.

-- ── Rate bases (appended, never reordered) ─────────────────────────────────
ALTER TYPE "VehicleHireRateBasis" ADD VALUE IF NOT EXISTS 'TRANSPORT_COMMISSION';
ALTER TYPE "VehicleHireRateBasis" ADD VALUE IF NOT EXISTS 'NET_FREIGHT';

-- ── Vehicle document expiries the master did not capture ───────────────────
-- Tax token (road tax / cess receipt)
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "tax_number" TEXT;
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "tax_expiry" TEXT;

-- Fitness certificate
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "fitness_number" TEXT;
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "fitness_expiry" TEXT;

-- National / inter-state permit (only held by vehicles that cross states)
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "national_permit_number" TEXT;
ALTER TABLE "transport_vehicles" ADD COLUMN IF NOT EXISTS "national_permit_expiry" TEXT;

-- ── Indexes for the hire gate's expiry sweep ──────────────────────────────
-- The page asks "which vehicles have an expired critical document?" far more
-- often than it asks "which vehicle is BR01XX1234?", so the expiry columns are
-- the ones worth an index.
CREATE INDEX IF NOT EXISTS "idx_vehicles_insurance_expiry"
  ON "transport_vehicles" ("insurance_expiry");
CREATE INDEX IF NOT EXISTS "idx_vehicles_permit_expiry"
  ON "transport_vehicles" ("permit_expiry");
CREATE INDEX IF NOT EXISTS "idx_vehicles_fitness_expiry"
  ON "transport_vehicles" ("fitness_expiry");

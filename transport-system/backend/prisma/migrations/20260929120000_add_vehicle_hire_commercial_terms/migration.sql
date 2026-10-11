-- ============================================================
-- PHASE 2 — UNIVERSAL VEHICLE HIRE (commercial terms on Trip)
-- ============================================================
--
-- WHY
--   The operational Trip is already the vehicle-hire record: it owns the
--   vehicle, the transport owner (vendor), the driver, the customer and the
--   freight. What it did NOT store was the COMMERCIAL TERMS of the hire —
--   who it is billed to, whether it is a CONTRACT or a COMMISSION deal, the
--   rate basis it was quoted on, and the commission terms for this specific
--   hire. Without them the hire model could only be guessed, and the
--   commission always fell back to the flat 5% policy because the Trip had
--   nowhere to record a per-trip rate or a fixed commission.
--
-- WHAT THIS ADDS (and nothing else)
--   • 3 new enums: VehicleHireBillingTo, VehicleHireBusinessModel,
--     VehicleHireRateBasis.
--   • 5 new NULLABLE columns on `trips`.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--   • No new table. TripFinancial / TripAdvance / TripSettlement /
--     FinancialTransaction / PartnerLedger remain the single financial
--     subsystem; this migration adds no second ledger.
--   • No new money column. The GROSS hire is the existing
--     `trips.freight_amount` and is left exactly as it is. The NET vendor
--     payable is DERIVED at read time (gross − commission) and is never
--     stored, so gross can never be overwritten by net.
--   • No backfill. Every new column is NULL for all existing rows, so no
--     historical trip is given an invented billing party, business model or
--     rate basis. A NULL means "not recorded", which is the truth.
--   • No rename, no drop, no data deletion. This is purely additive.
--   • No DEFAULT on commission_type / commission_percentage: the commission is
--     computed by CommissionCalculator from the persisted terms, and a NULL
--     correctly means "use the config/commissionPolicy.js rate".
--
-- PRODUCTION SAFETY
--   Adding a nullable column and a new enum type is non-blocking on
--   PostgreSQL: no table is rewritten and no row is locked for a meaningful
--   period. Safe to run online with `prisma migrate deploy`.

-- ── Enums ────────────────────────────────────────────────────────────────
-- Who the hire is billed to.
CREATE TYPE "VehicleHireBillingTo" AS ENUM (
  'CONSIGNOR',
  'CONSIGNEE',
  'THIRD_PARTY',
  'VEHICLE_VENDOR'
);

-- How this hire is commercially booked.
CREATE TYPE "VehicleHireBusinessModel" AS ENUM (
  'COMMISSION',
  'CONTRACT'
);

-- The basis the gross hire was quoted on. These values reuse the rate
-- catalogue the booking form already ships
-- (frontend/src/utils/bookingForm.js → RATE_AS_PER_OPTIONS). FIXED is that
-- catalogue's "quotes the whole trip" mode, i.e. a per-trip hire.
CREATE TYPE "VehicleHireRateBasis" AS ENUM (
  'FIXED',
  'PER_TON',
  'PER_KG',
  'PER_DAY',
  'MONTHLY'
);

-- ── Columns (all nullable — no existing row is modified) ──────────────────
ALTER TABLE "trips" ADD COLUMN "billing_to" "VehicleHireBillingTo";
ALTER TABLE "trips" ADD COLUMN "business_model" "VehicleHireBusinessModel";
ALTER TABLE "trips" ADD COLUMN "rate_basis" "VehicleHireRateBasis";

-- Commission terms for THIS hire. commission_type reuses the existing
-- 'percentage' | 'fixed' convention already stored as text on
-- commission_records.commission_type, so CommissionCalculator's supported
-- types apply unchanged and no second vocabulary is introduced.
ALTER TABLE "trips" ADD COLUMN "commission_type" TEXT;
ALTER TABLE "trips" ADD COLUMN "commission_percentage" DOUBLE PRECISION;

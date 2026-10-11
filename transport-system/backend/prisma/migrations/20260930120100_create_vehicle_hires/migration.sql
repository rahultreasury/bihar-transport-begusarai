-- ============================================================
-- VEHICLE HIRE (Phase 8) — THE HIRE RECORD
-- ============================================================
--
-- WHY A TABLE AT ALL, WHEN PHASE 2 PUT THE TERMS ON `trips`
--   Migration 20260929120000 deliberately stored the COMMERCIAL TERMS of a hire
--   on the Trip row: billing party, business model, rate basis, commission type
--   and rate. It explicitly did not store the hire's MONEY, because at that
--   point the gross was already `trips.freight_amount` and the net was derived
--   on read.
--
--   The Vehicle Hiring page needs three things that arrangement cannot give:
--
--   1. A hire is an EVENT, not just a state. "This vehicle was hired for this
--      trip, on this date, by this operator, at these terms" is a fact with a
--      timestamp and an author. A column set on `trips` has neither.
--
--   2. The rate INPUT must be kept, not only its result. "₹5,000 per ton × 8
--      ton = ₹40,000" is not recoverable from ₹40,000 alone. Without the
--      inputs, a rate dispute months later cannot be settled from the record.
--
--   3. Money needs `Decimal`, not `Float`. `trips.freight_amount` is a double
--      precision column that has been in production for years; changing its type
--      would rewrite the table and is out of scope. A new table can be correct
--      from day one, so it is.
--
--   So this is an ADDITIVE, properly-linked record — not a second ledger, not a
--   second trip, and not a replacement for anything.
--
-- WHAT IT IS NOT
--   • Not a payment table. Nothing here is a cash movement. A hire creates an
--     OBLIGATION; the money leaves later through FinancialTransaction /
--     TripAdvance / TripSettlement, which this table never writes.
--   • Not a second copy of the vehicle, the vendor, the driver or the trip.
--     Every one of those is a foreign key to the existing master.
--   • Not a second set of commercial terms. The hire WRITES the terms back to
--     the `trips` columns Phase 2 added, so existing reporting keeps working
--     from the same numbers.
--
-- GROSS IS NEVER OVERWRITTEN BY NET
--   `gross_hire` and `net_vendor_payable` are separate columns, and a CHECK
--   constraint states the identity the whole module rests on:
--
--       net_vendor_payable = gross_hire - commission_amount
--
--   That is enforced by PostgreSQL, not by discipline. A buggy future migration,
--   a hand-edited row or a stray UPDATE cannot break the relationship between
--   what Bihar Transport charged and what the vendor is owed.
--
-- PARTIAL PAYMENT COMPATIBILITY
--   There is deliberately NO `paid_amount` and no `payment_status` column here.
--   How much has been paid to the vendor is a question the existing ledger
--   already answers (VendorLedgerService / TripAdvance); duplicating it onto
--   the hire would create two answers that eventually disagree.
--
-- PRODUCTION SAFETY
--   One new table, created empty, with three foreign keys. No existing table is
--   touched, no row is written, nothing is locked beyond the (brief) ACCESS
--   EXCLUSIVE a CREATE TABLE takes. Safe to run online with
--   `prisma migrate deploy`.
--
--   This migration RUNS AFTER 20260930120000, which is what added
--   'TRANSPORT_COMMISSION' and 'NET_FREIGHT' to "VehicleHireRateBasis".
--   PostgreSQL requires a new enum value to be committed before it can be used,
--   and `prisma migrate deploy` gives each migration its own transaction, so the
--   ordering below is both necessary and sufficient.

CREATE TABLE "vehicle_hires" (
  "hire_id"       SERIAL       NOT NULL,

  -- ── The link. A hire always belongs to exactly one trip. ────────────────
  "trip_id"       INTEGER      NOT NULL,
  "booking_id"    INTEGER, -- NULL for a standalone DIRECT / OFFLINE_CLIENT trip
  "vehicle_id"    INTEGER      NOT NULL,
  "vendor_id"     INTEGER      NOT NULL, -- VehicleOwner — the transport owner / vendor
  "driver_id"     INTEGER      NOT NULL,

  -- ── Commercial terms ────────────────────────────────────────────────────
  "billing_to"          "VehicleHireBillingTo"   NOT NULL,
  "business_model"      "VehicleHireBusinessModel" NOT NULL,
  "business_model_overridden" BOOLEAN  NOT NULL DEFAULT false,

  "rate_basis"     "VehicleHireRateBasis" NOT NULL,
  "rate_value"     DECIMAL(14,2) NOT NULL, -- the agreed rate, in its own unit
  "rate_quantity"  DECIMAL(14,3),         -- tons / kg / days / months; NULL when the basis ignores it
  "rate_unit"      TEXT,                  -- 'Ton', 'Kg', 'Day', 'Month', NULL

  -- ── Money. Three separate, separately-stored figures. ───────────────────
  -- DECIMAL, never FLOAT: these are contractual amounts and the identity
  -- between them has to hold exactly, which binary floating point cannot promise.
  "gross_hire"          DECIMAL(14,2) NOT NULL,
  "commission_type"     TEXT           NOT NULL, -- 'percentage' | 'fixed' (existing vocabulary)
  "commission_rate"     DECIMAL(12,4) NOT NULL, -- percent when 'percentage', rupees when 'fixed'
  "commission_amount"   DECIMAL(14,2) NOT NULL,
  "net_vendor_payable"  DECIMAL(14,2) NOT NULL,

  "remarks"        TEXT,

  -- ── Compliance snapshot ────────────────────────────────────────────────
  -- The document statuses as they stood at the moment of hiring. Stored, not
  -- read live, so a hire signed today still shows the paperwork the operator
  -- actually saw even after the master dates are corrected.
  "documents_snapshot"   JSONB,
  "documents_expired_ack" BOOLEAN NOT NULL DEFAULT false,
  "documents_expired_ack_by" INTEGER,
  "documents_expired_ack_at" TIMESTAMP(3),

  -- Stable identifier for the printable challan, derived once from the trip so
  -- re-downloading produces the same document.
  "challan_number" TEXT,

  "status"        TEXT         NOT NULL DEFAULT 'ACTIVE',
  "created_by"    INTEGER, -- admin_id; no FK, matching TripTimeline.created_by / AuditLog.user_id
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "vehicle_hires_pkey" PRIMARY KEY ("hire_id"),

  -- ONE hire per trip. This is the double-hire guard: a double-clicked
  -- "Hire Vehicle" button can never produce two obligations for one consignment,
  -- and there is no code path that would let a vendor be paid twice for it.
  CONSTRAINT "vehicle_hires_trip_id_key" UNIQUE ("trip_id"),

  -- ── The financial invariants, enforced by the database ─────────────────
  CONSTRAINT "vehicle_hires_gross_non_negative"    CHECK ("gross_hire" >= 0),
  CONSTRAINT "vehicle_hires_commission_non_negative" CHECK ("commission_amount" >= 0),
  CONSTRAINT "vehicle_hires_net_non_negative"     CHECK ("net_vendor_payable" >= 0),

  -- THE identity. Gross hire is stored whole and is never replaced by the net.
  CONSTRAINT "vehicle_hires_net_equals_gross_minus_commission"
    CHECK ("net_vendor_payable" = "gross_hire" - "commission_amount"),

  -- A commission larger than the gross would make the payable negative, which
  -- the identity above already forbids; stated separately so the failure says
  -- what actually went wrong.
  CONSTRAINT "vehicle_hires_commission_within_gross"
    CHECK ("commission_amount" <= "gross_hire"),

  -- ── Foreign keys to the EXISTING masters. No duplicate is created. ──────
  CONSTRAINT "vehicle_hires_trip_fk"
    FOREIGN KEY ("trip_id")    REFERENCES "trips"("trip_id")            ON DELETE CASCADE,
  CONSTRAINT "vehicle_hires_booking_fk"
    FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id")      ON DELETE SET NULL,
  CONSTRAINT "vehicle_hires_vehicle_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE RESTRICT,
  CONSTRAINT "vehicle_hires_vendor_fk"
    FOREIGN KEY ("vendor_id")  REFERENCES "vehicle_owners"("owner_id")  ON DELETE RESTRICT,
  CONSTRAINT "vehicle_hires_driver_fk"
    FOREIGN KEY ("driver_id")  REFERENCES "drivers"("driver_id")        ON DELETE RESTRICT
);

-- ── Reporting indexes ─────────────────────────────────────────────────────
-- Accounting asks the same three questions every month: what did we hire, from
-- whom, and against which vehicle. These make each of them a single index scan
-- instead of a table scan.
CREATE INDEX "idx_vehicle_hires_trip"     ON "vehicle_hires" ("trip_id");
CREATE INDEX "idx_vehicle_hires_vehicle"  ON "vehicle_hires" ("vehicle_id");
CREATE INDEX "idx_vehicle_hires_vendor"   ON "vehicle_hires" ("vendor_id");
CREATE INDEX "idx_vehicle_hires_driver"   ON "vehicle_hires" ("driver_id");
CREATE INDEX "idx_vehicle_hires_created"  ON "vehicle_hires" ("created_at");
CREATE INDEX "idx_vehicle_hires_billing"  ON "vehicle_hires" ("billing_to");
CREATE INDEX "idx_vehicle_hires_model"    ON "vehicle_hires" ("business_model");

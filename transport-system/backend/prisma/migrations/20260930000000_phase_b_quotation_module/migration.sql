-- ============================================================================
-- PHASE B — QUOTATION / RATE MODULE
-- Client document: "Bihar Transport — Complete Transport Software Workflow"
-- Section §2 "QUOTATION / RATE"
--
-- DESIGN INTENT
--   The Enquiry is the canonical quotation source:
--       ENQUIRY → GIVE RATE → RATE QUOTED → CONFIRM ORDER → ORDER CONFIRMED
--   (client document §2/§3). The Booking is NOT the quotation source; it only
--   receives an immutable financial SNAPSHOT at conversion time.
--
-- SAFETY
--   This migration is PURELY ADDITIVE:
--     • no DROP TABLE
--     • no DROP COLUMN
--     • no TRUNCATE
--     • no destructive constraint changes
--     • no modification of existing rows
--   Every existing table keeps its current shape and data. New tables and
--   columns are added alongside; existing enquiry rows simply have a NULL
--   quotation_id until an operator quotes them.
-- ============================================================================

-- ── Enums ───────────────────────────────────────────────────────────────────

-- CreateEnum
CREATE TYPE "QuotationRateType" AS ENUM ('FIXED', 'PER_UNIT');

-- CreateEnum
CREATE TYPE "QuotationGstType" AS ENUM ('RCM', 'FORWARD_CHARGE', 'EXEMPT');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'RATE_QUOTED', 'SENT', 'CONVERTED');

-- CreateEnum
CREATE TYPE "QuotationPaymentScheduleType" AS ENUM ('FULL_PAYMENT_IN_ADVANCE', 'BOOKING_ADVANCE_BALANCE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QuotationMilestoneAmountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- Audit trail event types. Additive — existing history rows are untouched.
--   QUOTATION_SAVED / QUOTATION_DOWNLOADED / QUOTATION_CONFIRMED
-- Note: PostgreSQL requires ALTER TYPE ... ADD VALUE to be committed on its own
-- before the new value can be used in the same transaction. Prisma runs each
-- migration file in one transaction; these values are only WRITTEN by
-- application code afterwards, never inside this migration, so this is safe.
ALTER TYPE "EnquiryEventType" ADD VALUE IF NOT EXISTS 'QUOTATION_SAVED';
ALTER TYPE "EnquiryEventType" ADD VALUE IF NOT EXISTS 'QUOTATION_DOWNLOADED';
ALTER TYPE "EnquiryEventType" ADD VALUE IF NOT EXISTS 'QUOTATION_CONFIRMED';

-- ── Enquiry: one canonical quotation link ────────────────────────────────────
-- Enquiry.quotation_id is @unique → one Enquiry has at most ONE quotation.
-- The FK constraint itself is added at the END of this file, once the
-- "quotations" table exists.
ALTER TABLE "enquiries" ADD COLUMN "quotation_id" INTEGER;

CREATE UNIQUE INDEX "enquiries_quotation_id_key" ON "enquiries"("quotation_id");

-- ── Quotation ───────────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "quotations" (
  "quotation_id" SERIAL NOT NULL,
  "enquiry_id" INTEGER NOT NULL,
  "quotation_number" TEXT NOT NULL,
  "rate_type" "QuotationRateType" NOT NULL DEFAULT 'FIXED',
  "rate" DOUBLE PRECISION,
  "freight" DOUBLE PRECISION NOT NULL,
  "total_freight" DOUBLE PRECISION NOT NULL,
  "gst_type" "QuotationGstType",
  "gst_percentage" DOUBLE PRECISION,
  "gst_amount" DOUBLE PRECISION DEFAULT 0,
  "total_additional_charges" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "additional_charges_tax" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "total_billing_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "validity_days" INTEGER,
  "valid_until" TIMESTAMP(3),
  "payment_schedule_type" "QuotationPaymentScheduleType" NOT NULL DEFAULT 'FULL_PAYMENT_IN_ADVANCE',
  "booking_amount" DOUBLE PRECISION,
  "advance_after_loading_percentage" DOUBLE PRECISION,
  "schedule_total" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "schedule_remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "remarks" TEXT,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "quoted_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "confirmed_total_billing_amount" DOUBLE PRECISION,
  "quoted_by_admin_id" INTEGER,
  "sent_by_admin_id" INTEGER,
  "updated_by_admin_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quotations_pkey" PRIMARY KEY ("quotation_id")
);

-- CreateTable
CREATE TABLE "quotation_charges" (
  "charge_id" SERIAL NOT NULL,
  "quotation_id" INTEGER NOT NULL,
  "charges_name" TEXT NOT NULL,
  "rate" DOUBLE PRECISION NOT NULL,
  "quantity" DOUBLE PRECISION NOT NULL,
  "quantity_unit" TEXT,
  "total" DOUBLE PRECISION NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quotation_charges_pkey" PRIMARY KEY ("charge_id")
);

-- CreateTable
CREATE TABLE "quotation_milestones" (
  "milestone_id" SERIAL NOT NULL,
  "quotation_id" INTEGER NOT NULL,
  "due_point" TEXT NOT NULL,
  "amount_type" "QuotationMilestoneAmountType" NOT NULL DEFAULT 'FIXED',
  "amount_value" DOUBLE PRECISION NOT NULL,
  "computed_amount" DOUBLE PRECISION NOT NULL,
  "remaining_balance" DOUBLE PRECISION NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "quotation_milestones_pkey" PRIMARY KEY ("milestone_id")
);

-- CreateTable
CREATE TABLE "quotation_versions" (
  "version_id" SERIAL NOT NULL,
  "quotation_id" INTEGER NOT NULL,
  "version_number" INTEGER NOT NULL,
  "rate_type" "QuotationRateType" NOT NULL,
  "rate" DOUBLE PRECISION,
  "freight" DOUBLE PRECISION NOT NULL,
  "total_freight" DOUBLE PRECISION NOT NULL,
  "gst_type" "QuotationGstType",
  "gst_percentage" DOUBLE PRECISION,
  "gst_amount" DOUBLE PRECISION,
  "total_additional_charges" DOUBLE PRECISION NOT NULL,
  "additional_charges_tax" DOUBLE PRECISION NOT NULL,
  "total_billing_amount" DOUBLE PRECISION NOT NULL,
  "validity_days" INTEGER,
  "payment_schedule_type" "QuotationPaymentScheduleType" NOT NULL,
  "booking_amount" DOUBLE PRECISION,
  "advance_after_loading_percentage" DOUBLE PRECISION,
  "schedule_total" DOUBLE PRECISION NOT NULL,
  "schedule_remaining" DOUBLE PRECISION NOT NULL,
  "remarks" TEXT,
  "changed_by_admin_id" INTEGER,
  "change_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "quotation_versions_pkey" PRIMARY KEY ("version_id")
);

-- CreateTable
CREATE TABLE "booking_quotation_snapshots" (
  "snapshot_id" SERIAL NOT NULL,
  "booking_id" INTEGER NOT NULL,
  "quotation_id" INTEGER,
  "rate_type" "QuotationRateType" NOT NULL,
  "rate" DOUBLE PRECISION,
  "freight" DOUBLE PRECISION NOT NULL,
  "total_freight" DOUBLE PRECISION NOT NULL,
  "gst_type" "QuotationGstType",
  "gst_percentage" DOUBLE PRECISION,
  "gst_amount" DOUBLE PRECISION,
  "total_additional_charges" DOUBLE PRECISION NOT NULL,
  "additional_charges_tax" DOUBLE PRECISION NOT NULL,
  "total_billing_amount" DOUBLE PRECISION NOT NULL,
  "validity_days" INTEGER,
  "payment_schedule_type" "QuotationPaymentScheduleType" NOT NULL,
  "schedule_total" DOUBLE PRECISION NOT NULL,
  "schedule_remaining" DOUBLE PRECISION NOT NULL,
  "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "booking_quotation_snapshots_pkey" PRIMARY KEY ("snapshot_id")
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- CreateIndex
CREATE UNIQUE INDEX "quotations_enquiry_id_key" ON "quotations"("enquiry_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotations_quotation_number_key" ON "quotations"("quotation_number");

-- CreateIndex
CREATE INDEX "idx_quotations_enquiry" ON "quotations"("enquiry_id");

-- CreateIndex
CREATE INDEX "idx_quotations_status" ON "quotations"("status");

-- CreateIndex
CREATE INDEX "idx_quotations_number" ON "quotations"("quotation_number");

-- CreateIndex
CREATE INDEX "idx_quotation_charges_quotation" ON "quotation_charges"("quotation_id");

-- CreateIndex
CREATE INDEX "idx_quotation_milestones_quotation" ON "quotation_milestones"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "quotation_versions_quotation_id_version_number_key" ON "quotation_versions"("quotation_id", "version_number");

-- CreateIndex
CREATE INDEX "idx_quotation_versions_quotation" ON "quotation_versions"("quotation_id");

-- CreateIndex
CREATE UNIQUE INDEX "booking_quotation_snapshots_booking_id_key" ON "booking_quotation_snapshots"("booking_id");

-- CreateIndex
CREATE INDEX "idx_booking_quotation_snapshot_quotation" ON "booking_quotation_snapshots"("quotation_id");

-- ── Foreign keys ────────────────────────────────────────────────────────────

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_enquiry_id_fkey"
  FOREIGN KEY ("enquiry_id") REFERENCES "enquiries"("enquiry_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Enquiry → Quotation back-link. Deliberately LAST, because it references the
-- "quotations" table that is created above.
ALTER TABLE "enquiries"
  ADD CONSTRAINT "enquiries_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_quoted_by_admin_id_fkey"
  FOREIGN KEY ("quoted_by_admin_id") REFERENCES "admins"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_sent_by_admin_id_fkey"
  FOREIGN KEY ("sent_by_admin_id") REFERENCES "admins"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_updated_by_admin_id_fkey"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "admins"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "quotation_charges"
  ADD CONSTRAINT "quotation_charges_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_milestones"
  ADD CONSTRAINT "quotation_milestones_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_versions"
  ADD CONSTRAINT "quotation_versions_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quotation_versions"
  ADD CONSTRAINT "quotation_versions_changed_by_admin_id_fkey"
  FOREIGN KEY ("changed_by_admin_id") REFERENCES "admins"("admin_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_quotation_snapshots"
  ADD CONSTRAINT "booking_quotation_snapshots_booking_id_fkey"
  FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_quotation_snapshots"
  ADD CONSTRAINT "booking_quotation_snapshots_quotation_id_fkey"
  FOREIGN KEY ("quotation_id") REFERENCES "quotations"("quotation_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Create missing tables referenced by the Prisma schema but never created
-- in any committed migration. This migration is placed between
-- 20260818000000_add_transport_owner_to_driver and
-- 20260824000000_enhance_trip_management so that trip_payments (and its
-- dependency trips) exist before the enhance_trip_management migration
-- attempts to ALTER TABLE trip_payments.
--
-- All CREATE TABLE and CREATE INDEX statements use IF NOT EXISTS so the
-- migration is safe to re-run on databases where some of these objects
-- were already created by a partial historical migration application.
-- Enum types use plain CREATE TYPE (no IF NOT EXISTS exists for enums in
-- PostgreSQL). No FOREIGN KEY constraints are added here — they are added
-- by later migrations to avoid duplicate constraint errors.
--
-- NOTE: vehicle_owners.partner_link is NOT created here — it is added by
-- 20260830000000_add_partner_vehicleowner_link which runs after this migration.
-- NOTE: trips.client_id FK to clients is NOT added here — clients table is
-- created by 20260905180000_add_client_and_trip_source which runs later.
-- NOTE: financial_transactions.client_id FK to clients is NOT added here
-- for the same reason.
-- NOTE: trip_settlements.trip_id is NOT added here — it is added by
-- 20260910000000_add_trip_settlement_trip_id which runs later.
-- NOTE: Enum type names use lowercase_with_underscores to match the names
-- expected by later migrations (e.g. 20260905000000_add_trip_expense_paid_by_receipt
-- extends trip_expense_type and creates expense_paid_by).
-- NOTE: trips.billing_to, business_model, rate_basis, commission_type,
-- commission_percentage are NOT added here — they are added by
-- 20260929120000_add_vehicle_hire_commercial_terms which runs later.

-- ============================================================================
-- ENUM TYPES (referenced by the tables below but not created in earlier migrations)
-- ============================================================================

DO $$
BEGIN
    CREATE TYPE "TripStatus" AS ENUM ('PENDING', 'ASSIGNED', 'TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TripPaymentType" AS ENUM ('ADVANCE', 'PARTIAL', 'FULL', 'SETTLEMENT', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TripPaymentCategory" AS ENUM ('CLIENT_PAYMENT', 'OWNER_PAYMENT', 'DRIVER_PAYMENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TripFinancialStatus" AS ENUM ('DRAFT', 'CALCULATED', 'ADJUSTED', 'SETTLED', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "AdvanceType" AS ENUM ('DRIVER_ADVANCE', 'FUEL_ADVANCE', 'OWNER_ADVANCE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TransactionDirection" AS ENUM ('DEBIT', 'CREDIT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID', 'CANCELLED', 'REFUNDED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Note: trip_expense_type is extended by 20260905000000_add_trip_expense_paid_by_receipt
-- which adds LABOUR, DOCUMENTATION, PARKING, LOCAL_TRANSPORT, CUSTOMER_RELATED, COMMUNICATION.
DO $$
BEGIN
    CREATE TYPE "trip_expense_type" AS ENUM ('DRIVER', 'DIESEL', 'TOLL', 'LOADING', 'UNLOADING', 'OWNER', 'MAINTENANCE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Note: expense_paid_by is created by 20260905000000_add_trip_expense_paid_by_receipt
-- but we create it here since trip_expenses.paid_by references it.
DO $$
BEGIN
    CREATE TYPE "expense_paid_by" AS ENUM ('BIHAR_TRANSPORT', 'TRANSPORT_OWNER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "FinancialTransactionType" AS ENUM ('CUSTOMER_PAYMENT', 'DRIVER_ADVANCE', 'FUEL_ADVANCE', 'OWNER_ADVANCE', 'DRIVER_SETTLEMENT', 'OWNER_SETTLEMENT', 'COMMISSION', 'ADJUSTMENT', 'REFUND', 'CLIENT_PAYMENT', 'TRIP_EXPENSE', 'EXPENSE_REIMBURSEMENT', 'REVERSAL');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "TransactionParty" AS ENUM ('BIHAR_TRANSPORT', 'CUSTOMER', 'CLIENT', 'TRANSPORT_OWNER', 'DRIVER', 'VENDOR', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- trips — central operational table, referenced by many later migrations
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trips" (
    "trip_id" SERIAL NOT NULL,
    "trip_number" TEXT NOT NULL,
    "booking_id" INTEGER,
    "user_id" INTEGER,
    "transport_owner_id" INTEGER,
    "vehicle_id" INTEGER,
    "driver_id" INTEGER,
    "pickup_location" TEXT NOT NULL,
    "pickup_city" TEXT NOT NULL,
    "drop_location" TEXT NOT NULL,
    "drop_city" TEXT NOT NULL,
    "distance_km" DOUBLE PRECISION,
    "expected_delivery_date" TIMESTAMP(3),
    "trip_delivered_date" TIMESTAMP(3),
    "freight_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "driver_payment" DOUBLE PRECISION,
    "owner_payment" DOUBLE PRECISION,
    "notes" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'PENDING',
    "trip_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "client_id" INTEGER,
    "source_type" TEXT NOT NULL DEFAULT 'ONLINE_BOOKING',
    -- Note: billing_to, business_model, rate_basis, commission_type,
    -- commission_percentage are added by 20260929120000_add_vehicle_hire_commercial_terms
    "sent_to_loading_at" TIMESTAMP(3),
    "arrived_at_loading_at" TIMESTAMP(3),
    "loading_started_at" TIMESTAMP(3),
    "loading_completed_at" TIMESTAMP(3),
    "loading_remarks" TEXT,
    "loaded_by" TEXT,
    "dispatched_at" TIMESTAMP(3),
    "actual_quantity" DOUBLE PRECISION,
    "actual_quantity_unit" TEXT,
    "actual_weight_kg" DOUBLE PRECISION,
    "documents_required" JSON,
    "current_latitude" DOUBLE PRECISION,
    "current_longitude" DOUBLE PRECISION,
    "location_updated_at" TIMESTAMP(3),
    "location_source" TEXT,
    "location_accuracy_m" DOUBLE PRECISION,
    "estimated_arrival_at" TIMESTAMP(3),
    "eta_calculated_at" TIMESTAMP(3),
    "distance_remaining_km" DOUBLE PRECISION,
    "arrived_at_destination_at" TIMESTAMP(3),
    "arrival_remarks" TEXT,
    "delivered_receiver_name" TEXT,
    "delivery_remarks" TEXT,
    "delivered_quantity" DOUBLE PRECISION,
    "delivered_quantity_unit" TEXT,
    "delivered_weight_kg" DOUBLE PRECISION,
    "enquiry_id" INTEGER,
    "pod_required" BOOLEAN,
    "insurance_required" BOOLEAN,
    "value_of_goods" DOUBLE PRECISION,

    CONSTRAINT "trips_pkey" PRIMARY KEY ("trip_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_trips_number" ON "trips"("trip_number");
CREATE INDEX IF NOT EXISTS "idx_trips_enquiry" ON "trips"("enquiry_id");
CREATE INDEX IF NOT EXISTS "idx_trips_hire_queue" ON "trips"("status", "trip_date" DESC, "trip_id" DESC);
CREATE INDEX IF NOT EXISTS "idx_trips_user" ON "trips"("user_id");
CREATE INDEX IF NOT EXISTS "idx_trips_owner" ON "trips"("transport_owner_id");
CREATE INDEX IF NOT EXISTS "idx_trips_vehicle" ON "trips"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_trips_driver" ON "trips"("driver_id");
CREATE INDEX IF NOT EXISTS "idx_trips_status" ON "trips"("status");
CREATE INDEX IF NOT EXISTS "idx_trips_date" ON "trips"("trip_date");
CREATE INDEX IF NOT EXISTS "idx_trips_booking" ON "trips"("booking_id");

-- ============================================================================
-- trip_payments — per-payment record (referenced by enhance_trip_management)
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trip_payments" (
    "payment_id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_type" "TripPaymentType" NOT NULL,
    "payment_category" "TripPaymentCategory" NOT NULL DEFAULT 'CLIENT_PAYMENT',
    "payment_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "payment_method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_payments_pkey" PRIMARY KEY ("payment_id")
);

CREATE INDEX IF NOT EXISTS "idx_trip_payments_type" ON "trip_payments"("payment_type");
CREATE INDEX IF NOT EXISTS "idx_trip_payments_category" ON "trip_payments"("payment_category");
CREATE INDEX IF NOT EXISTS "idx_trip_payments_trip" ON "trip_payments"("trip_id");

-- ============================================================================
-- trip_financials — per-trip financial summary
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trip_financials" (
    "trip_financial_id" SERIAL NOT NULL,
    "booking_id" INTEGER,
    "status" "TripFinancialStatus" NOT NULL DEFAULT 'DRAFT',
    "customer_fare" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "driver_payout" DOUBLE PRECISION,
    "total_advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_fuel_advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining_driver_settlement" DOUBLE PRECISION,
    "owner_settlement_amount" DOUBLE PRECISION,
    "total_owner_advance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining_owner_settlement" DOUBLE PRECISION,
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "commission_amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bt_margin" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMP(3),
    "calculated_by" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "trip_id" INTEGER,

    CONSTRAINT "trip_financials_pkey" PRIMARY KEY ("trip_financial_id")
);

CREATE INDEX IF NOT EXISTS "idx_trip_financial_booking" ON "trip_financials"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_trip_financial_status" ON "trip_financials"("status");
CREATE INDEX IF NOT EXISTS "idx_trip_financial_trip" ON "trip_financials"("trip_id");

-- ============================================================================
-- trip_settlements — per-trip settlement records
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trip_settlements" (
    "settlement_id" SERIAL NOT NULL,
    "trip_financial_id" INTEGER NOT NULL,
    "booking_id" INTEGER,
    "driver_settlement_amount" DOUBLE PRECISION,
    "driver_settlement_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "driver_settlement_paid_at" TIMESTAMP(3),
    "driver_settlement_payment_method" TEXT,
    "driver_settlement_reference" TEXT,
    "driver_settlement_notes" TEXT,
    "owner_settlement_amount" DOUBLE PRECISION,
    "owner_settlement_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "owner_settlement_paid_at" TIMESTAMP(3),
    "owner_settlement_payment_method" TEXT,
    "owner_settlement_reference" TEXT,
    "owner_settlement_notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    -- Note: trip_id column is added by 20260910000000_add_trip_settlement_trip_id

    CONSTRAINT "trip_settlements_pkey" PRIMARY KEY ("settlement_id")
);

CREATE INDEX IF NOT EXISTS "idx_trip_settlement_financial" ON "trip_settlements"("trip_financial_id");
CREATE INDEX IF NOT EXISTS "idx_trip_settlement_booking" ON "trip_settlements"("booking_id");
-- Note: idx_trip_settlement_trip is added by 20260910000000_add_trip_settlement_trip_id

-- ============================================================================
-- trip_advances — per-trip advance records
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trip_advances" (
    "advance_id" SERIAL NOT NULL,
    "trip_financial_id" INTEGER,
    "booking_id" INTEGER,
    "driver_id" INTEGER,
    "vehicle_id" INTEGER,
    "transport_owner_id" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "advance_type" "AdvanceType" NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference_number" TEXT,
    "given_by" INTEGER,
    "given_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "trip_id" INTEGER,

    CONSTRAINT "trip_advances_pkey" PRIMARY KEY ("advance_id")
);

CREATE INDEX IF NOT EXISTS "idx_trip_advance_financial" ON "trip_advances"("trip_financial_id");
CREATE INDEX IF NOT EXISTS "idx_trip_advance_booking" ON "trip_advances"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_trip_advance_driver" ON "trip_advances"("driver_id");
CREATE INDEX IF NOT EXISTS "idx_trip_advance_owner" ON "trip_advances"("transport_owner_id");
CREATE INDEX IF NOT EXISTS "idx_trip_advance_trip" ON "trip_advances"("trip_id");

-- ============================================================================
-- commission_records — per-trip commission records
-- ============================================================================

CREATE TABLE IF NOT EXISTS "commission_records" (
    "commission_id" SERIAL NOT NULL,
    "trip_financial_id" INTEGER NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "commission_rate" DOUBLE PRECISION NOT NULL,
    "commission_type" TEXT NOT NULL DEFAULT 'percentage',
    "commission_base" DOUBLE PRECISION NOT NULL,
    "commission_amount" DOUBLE PRECISION NOT NULL,
    "applied_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "applied_by" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_records_pkey" PRIMARY KEY ("commission_id")
);

CREATE INDEX IF NOT EXISTS "idx_commission_financial" ON "commission_records"("trip_financial_id");
CREATE INDEX IF NOT EXISTS "idx_commission_booking" ON "commission_records"("booking_id");

-- ============================================================================
-- financial_transactions — per-transaction ledger entries
-- ============================================================================

CREATE TABLE IF NOT EXISTS "financial_transactions" (
    "transaction_id" SERIAL NOT NULL,
    "trip_financial_id" INTEGER NOT NULL,
    "booking_id" INTEGER,
    "vehicle_id" INTEGER,
    "driver_id" INTEGER,
    "transport_owner_id" INTEGER,
    "transaction_type" "FinancialTransactionType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "direction" "TransactionDirection" NOT NULL,
    "payment_method" TEXT,
    "reference_number" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PAID',
    "metadata" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "purpose" TEXT,
    "transaction_date" TIMESTAMP(3),
    "notes" TEXT,
    "trip_id" INTEGER,
    "client_id" INTEGER,
    "from_party" "TransactionParty",
    "to_party" "TransactionParty",
    "invoice_id" INTEGER,

    CONSTRAINT "financial_transactions_pkey" PRIMARY KEY ("transaction_id")
);

CREATE INDEX IF NOT EXISTS "idx_financial_tx_financial" ON "financial_transactions"("trip_financial_id");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_booking" ON "financial_transactions"("booking_id");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_type" ON "financial_transactions"("transaction_type");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_from" ON "financial_transactions"("from_party");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_to" ON "financial_transactions"("to_party");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_date" ON "financial_transactions"("transaction_date");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_created" ON "financial_transactions"("created_at");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_invoice" ON "financial_transactions"("invoice_id");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_trip" ON "financial_transactions"("trip_id");

-- ============================================================================
-- audit_logs — audit trail
-- ============================================================================

CREATE TABLE IF NOT EXISTS "audit_logs" (
    "audit_id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "user_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("audit_id")
);

CREATE INDEX IF NOT EXISTS "idx_audit_user" ON "audit_logs"("user_id");
CREATE INDEX IF NOT EXISTS "idx_audit_entity" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_audit_action" ON "audit_logs"("action");
CREATE INDEX IF NOT EXISTS "idx_audit_created" ON "audit_logs"("created_at");

-- ============================================================================
-- trip_expenses — per-trip expense records
-- ============================================================================

CREATE TABLE IF NOT EXISTS "trip_expenses" (
    "expense_id" SERIAL NOT NULL,
    "trip_id" INTEGER NOT NULL,
    "expense_type" "trip_expense_type" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "expense_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "paid_by" "expense_paid_by" NOT NULL DEFAULT 'BIHAR_TRANSPORT',
    "receipt" TEXT,
    "payment_method" TEXT,
    "reference_number" TEXT,

    CONSTRAINT "trip_expenses_pkey" PRIMARY KEY ("expense_id")
);

CREATE INDEX IF NOT EXISTS "idx_trip_expenses_type" ON "trip_expenses"("expense_type");
CREATE INDEX IF NOT EXISTS "idx_trip_expenses_paid_by" ON "trip_expenses"("paid_by");
CREATE INDEX IF NOT EXISTS "idx_trip_expenses_trip" ON "trip_expenses"("trip_id");

-- ============================================================================
-- vehicle_assignments — vehicle-driver assignment history
-- ============================================================================

CREATE TABLE IF NOT EXISTS "vehicle_assignments" (
    "assignment_id" SERIAL NOT NULL,
    "vehicle_id" INTEGER NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "assigned_by" INTEGER,
    "assigned_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_assignments_pkey" PRIMARY KEY ("assignment_id")
);

CREATE INDEX IF NOT EXISTS "idx_veh_assign_vehicle" ON "vehicle_assignments"("vehicle_id");
CREATE INDEX IF NOT EXISTS "idx_veh_assign_driver" ON "vehicle_assignments"("driver_id");
CREATE INDEX IF NOT EXISTS "idx_veh_assign_status" ON "vehicle_assignments"("status");

-- ============================================================================
-- partner_applications — partner application records
-- ============================================================================

CREATE TABLE IF NOT EXISTS "partner_applications" (
    "application_id" SERIAL NOT NULL,
    "application_code" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "partnership_type" TEXT NOT NULL,
    "company_name" TEXT,
    "gst_number" TEXT,
    "pan_number" TEXT,
    "city" TEXT,
    "state" TEXT NOT NULL DEFAULT 'Bihar',
    "address" TEXT,
    "vehicle_number" TEXT,
    "vehicle_type" TEXT,
    "number_of_vehicles" INTEGER,
    "available_capacity" TEXT,
    "network_locations" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reviewed_by" INTEGER,
    "reviewed_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "admin_notes" TEXT,
    "partner_id" INTEGER,
    "vehicle_owner_id" INTEGER,
    "user_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_applications_pkey" PRIMARY KEY ("application_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_app_code" ON "partner_applications"("application_code");
CREATE INDEX IF NOT EXISTS "idx_app_phone" ON "partner_applications"("phone");
CREATE INDEX IF NOT EXISTS "idx_app_email" ON "partner_applications"("email");
CREATE INDEX IF NOT EXISTS "idx_app_status" ON "partner_applications"("status");
CREATE INDEX IF NOT EXISTS "idx_app_type" ON "partner_applications"("partnership_type");

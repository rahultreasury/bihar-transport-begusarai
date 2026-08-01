-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('customer', 'driver', 'admin');

-- CreateEnum
CREATE TYPE "DriverGender" AS ENUM ('male', 'female', 'other');

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('truck', 'mini_truck', 'pickup', 'tempo', 'lorry');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('available', 'on_trip', 'maintenance');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('pending', 'confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('booking_confirmed', 'driver_assigned', 'pickup_in_progress', 'pickup_completed', 'in_transit', 'out_for_delivery', 'delivered');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('super_admin', 'admin', 'operator');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('active');

-- CreateEnum
CREATE TYPE "PartnerStatus" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "TruckStatus" AS ENUM ('available', 'on_trip', 'maintenance', 'off_road');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('booking_income', 'commission', 'fuel_advance', 'driver_advance', 'toll', 'repair', 'penalty', 'bonus', 'cash', 'online_transfer', 'other_expense');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'paid', 'partially_paid', 'cancelled', 'locked');

-- CreateEnum
CREATE TYPE "PartnerDocumentType" AS ENUM ('gst', 'pan', 'aadhaar', 'rc', 'insurance', 'bank_details', 'other');

-- CreateTable
CREATE TABLE "users" (
    "user_id" SERIAL NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "pincode" TEXT,
    "role" "UserRole" DEFAULT 'customer',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "drivers" (
    "driver_id" SERIAL NOT NULL,
    "driver_code" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "driver_name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "alternate_mobile" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "pincode" TEXT,
    "partner_id" INTEGER,
    "license_number" TEXT,
    "license_expiry" TEXT,
    "license_class" TEXT,
    "joining_date" TEXT,
    "status" TEXT DEFAULT 'available',
    "profile_image" TEXT,
    "is_available" BOOLEAN DEFAULT true,
    "is_verified" BOOLEAN DEFAULT false,
    "rating" DOUBLE PRECISION DEFAULT 0,
    "total_deliveries" INTEGER DEFAULT 0,
    "total_advance" DOUBLE PRECISION DEFAULT 0,
    "total_paid" DOUBLE PRECISION DEFAULT 0,
    "total_expenses" DOUBLE PRECISION DEFAULT 0,
    "current_balance" DOUBLE PRECISION DEFAULT 0,
    "performance_rating" DOUBLE PRECISION DEFAULT 0,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drivers_pkey" PRIMARY KEY ("driver_id")
);

-- CreateTable
CREATE TABLE "driver_transactions" (
    "transaction_id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "balance_before" DOUBLE PRECISION NOT NULL,
    "balance_after" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "reference_type" TEXT,
    "reference_id" INTEGER,
    "payment_mode" TEXT,
    "transaction_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "recorded_by" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_transactions_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "driver_timeline" (
    "event_id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" INTEGER,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_timeline_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "transport_vehicles" (
    "vehicle_id" SERIAL NOT NULL,
    "driver_id" INTEGER,
    "partner_id" INTEGER,
    "vehicle_number" TEXT NOT NULL,
    "vehicle_type" TEXT NOT NULL,
    "vehicle_name" TEXT,
    "capacity_kg" DOUBLE PRECISION,
    "capacity_volume" DOUBLE PRECISION,
    "body_type" TEXT,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "manufacturing_year" INTEGER,
    "registration_date" TEXT,
    "insurance_number" TEXT,
    "insurance_expiry" TEXT,
    "permit_number" TEXT,
    "permit_expiry" TEXT,
    "pollution_certificate" TEXT,
    "pollution_expiry" TEXT,
    "is_available" BOOLEAN DEFAULT true,
    "is_verified" BOOLEAN DEFAULT false,
    "current_status" TEXT DEFAULT 'available',
    "base_location" TEXT,
    "hourly_rate" DOUBLE PRECISION,
    "per_km_rate" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transport_vehicles_pkey" PRIMARY KEY ("vehicle_id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "booking_id" SERIAL NOT NULL,
    "booking_reference" TEXT NOT NULL,
    "booking_number" TEXT,
    "user_id" INTEGER NOT NULL,
    "driver_id" INTEGER,
    "vehicle_id" INTEGER,
    "partner_id" INTEGER,
    "partner_name_snapshot" TEXT,
    "driver_name_snapshot" TEXT,
    "truck_number_snapshot" TEXT,
    "mobile_snapshot" TEXT,
    "commission_percentage" DOUBLE PRECISION DEFAULT 0,
    "commission_amount" DOUBLE PRECISION DEFAULT 0,
    "commission_type" TEXT DEFAULT 'percentage',
    "settlement_status" TEXT DEFAULT 'pending',
    "settlement_id" INTEGER,
    "pickup_location" TEXT NOT NULL,
    "pickup_address" TEXT,
    "pickup_city" TEXT NOT NULL,
    "pickup_state" TEXT DEFAULT 'Bihar',
    "pickup_pincode" TEXT,
    "pickup_date" TEXT NOT NULL,
    "pickup_time" TEXT NOT NULL,
    "drop_location" TEXT NOT NULL,
    "drop_address" TEXT,
    "drop_city" TEXT NOT NULL,
    "drop_state" TEXT DEFAULT 'Bihar',
    "drop_pincode" TEXT,
    "goods_description" TEXT NOT NULL,
    "goods_type" TEXT,
    "goods_weight_kg" DOUBLE PRECISION,
    "goods_volume" DOUBLE PRECISION,
    "number_of_items" INTEGER DEFAULT 1,
    "fragile" BOOLEAN DEFAULT false,
    "vehicle_type_required" TEXT NOT NULL,
    "estimated_distance_km" DOUBLE PRECISION,
    "estimated_price" DOUBLE PRECISION,
    "final_price" DOUBLE PRECISION,
    "status" TEXT DEFAULT 'pending',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "driver_assigned_at" TIMESTAMP(3),
    "pickup_completed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("booking_id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "delivery_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "driver_id" INTEGER,
    "vehicle_id" INTEGER,
    "current_status" TEXT DEFAULT 'booking_confirmed',
    "status_description" TEXT,
    "current_latitude" DOUBLE PRECISION,
    "current_longitude" DOUBLE PRECISION,
    "last_location_update" TIMESTAMP(3),
    "estimated_pickup_time" TIMESTAMP(3),
    "actual_pickup_time" TIMESTAMP(3),
    "estimated_delivery_time" TIMESTAMP(3),
    "actual_delivery_time" TIMESTAMP(3),
    "delivery_otp" TEXT,
    "otp_verified" BOOLEAN DEFAULT false,
    "delivery_proof_image" TEXT,
    "delivery_notes" TEXT,
    "recipient_name" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("delivery_id")
);

-- CreateTable
CREATE TABLE "admins" (
    "admin_id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT DEFAULT 'admin',
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("admin_id")
);

-- CreateTable
CREATE TABLE "booking_events" (
    "booking_event_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_payload" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_events_pkey" PRIMARY KEY ("booking_event_id")
);

-- CreateTable
CREATE TABLE "booking_assignments" (
    "booking_assignment_id" SERIAL NOT NULL,
    "booking_id" INTEGER NOT NULL,
    "assigned_driver_id" INTEGER,
    "assigned_vehicle_id" INTEGER,
    "assigned_by_admin_id" INTEGER,
    "assignment_status" TEXT DEFAULT 'active',
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_assignments_pkey" PRIMARY KEY ("booking_assignment_id")
);

-- CreateTable
CREATE TABLE "partners" (
    "partner_id" SERIAL NOT NULL,
    "partner_code" TEXT NOT NULL,
    "partner_name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL,
    "company_name" TEXT,
    "email" TEXT,
    "mobile" TEXT NOT NULL,
    "alternate_mobile" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "gst_number" TEXT,
    "pan_number" TEXT,
    "bank_account" TEXT,
    "bank_ifsc" TEXT,
    "bank_name" TEXT,
    "upi_id" TEXT,
    "address" TEXT,
    "status" "PartnerStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "commission_percentage" DOUBLE PRECISION DEFAULT 10,
    "commission_type" TEXT DEFAULT 'percentage',
    "fixed_commission" DOUBLE PRECISION DEFAULT 0,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "partners_pkey" PRIMARY KEY ("partner_id")
);

-- CreateTable
CREATE TABLE "driver_assignments" (
    "assignment_id" SERIAL NOT NULL,
    "driver_id" INTEGER NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "assigned_by" INTEGER,
    "assigned_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "unassigned_at" TIMESTAMP(3),
    "status" TEXT DEFAULT 'active',
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_assignments_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "partner_ledger" (
    "ledger_id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "booking_id" INTEGER,
    "transaction_id" TEXT NOT NULL,
    "transaction_type" "LedgerTransactionType" NOT NULL,
    "date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "description" TEXT,
    "debit" DOUBLE PRECISION DEFAULT 0,
    "credit" DOUBLE PRECISION DEFAULT 0,
    "running_balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payment_mode" TEXT,
    "remarks" TEXT,
    "reference_number" TEXT,
    "created_by" INTEGER,
    "is_reversal" BOOLEAN DEFAULT false,
    "reversal_of" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_ledger_pkey" PRIMARY KEY ("ledger_id")
);

-- CreateTable
CREATE TABLE "partner_payments" (
    "payment_id" SERIAL NOT NULL,
    "payment_number" TEXT NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "payment_method" TEXT NOT NULL,
    "reference_number" TEXT,
    "date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "status" TEXT DEFAULT 'pending',
    "remarks" TEXT,
    "settlement_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "settlement_id" SERIAL NOT NULL,
    "settlement_number" TEXT NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "total_bookings" INTEGER DEFAULT 0,
    "gross_revenue" DOUBLE PRECISION DEFAULT 0,
    "commission" DOUBLE PRECISION DEFAULT 0,
    "fuel_advance" DOUBLE PRECISION DEFAULT 0,
    "driver_advance" DOUBLE PRECISION DEFAULT 0,
    "repair_amount" DOUBLE PRECISION DEFAULT 0,
    "toll_amount" DOUBLE PRECISION DEFAULT 0,
    "penalty_amount" DOUBLE PRECISION DEFAULT 0,
    "bonus_amount" DOUBLE PRECISION DEFAULT 0,
    "other_expenses" DOUBLE PRECISION DEFAULT 0,
    "net_payable" DOUBLE PRECISION DEFAULT 0,
    "amount_paid" DOUBLE PRECISION DEFAULT 0,
    "balance_due" DOUBLE PRECISION DEFAULT 0,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "locked_at" TIMESTAMP(3),
    "settled_at" TIMESTAMP(3),
    "notes" TEXT,
    "pdf_url" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("settlement_id")
);

-- CreateTable
CREATE TABLE "partner_documents" (
    "document_id" SERIAL NOT NULL,
    "partner_id" INTEGER NOT NULL,
    "document_type" "PartnerDocumentType" NOT NULL,
    "document_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_size" INTEGER,
    "mime_type" TEXT,
    "expiry_date" TIMESTAMP(3),
    "is_verified" BOOLEAN DEFAULT false,
    "notes" TEXT,
    "uploaded_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE INDEX "idx_users_email" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_users_phone" ON "users"("phone");

-- CreateIndex
CREATE INDEX "idx_users_role" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "drivers_driver_code_key" ON "drivers"("driver_code");

-- CreateIndex
CREATE INDEX "idx_drivers_code" ON "drivers"("driver_code");

-- CreateIndex
CREATE INDEX "idx_drivers_user" ON "drivers"("user_id");

-- CreateIndex
CREATE INDEX "idx_drivers_partner" ON "drivers"("partner_id");

-- CreateIndex
CREATE INDEX "idx_drivers_license" ON "drivers"("license_number");

-- CreateIndex
CREATE INDEX "idx_drivers_status" ON "drivers"("status");

-- CreateIndex
CREATE INDEX "idx_drivers_mobile" ON "drivers"("mobile");

-- CreateIndex
CREATE INDEX "idx_drivers_alt_mobile" ON "drivers"("alternate_mobile");

-- CreateIndex
CREATE INDEX "idx_drivers_city" ON "drivers"("city");

-- CreateIndex
CREATE INDEX "idx_drivers_state" ON "drivers"("state");

-- CreateIndex
CREATE INDEX "idx_driver_tx_driver" ON "driver_transactions"("driver_id");

-- CreateIndex
CREATE INDEX "idx_driver_tx_type" ON "driver_transactions"("transaction_type");

-- CreateIndex
CREATE INDEX "idx_driver_tx_date" ON "driver_transactions"("transaction_date");

-- CreateIndex
CREATE INDEX "idx_driver_timeline_driver" ON "driver_timeline"("driver_id");

-- CreateIndex
CREATE INDEX "idx_driver_timeline_event" ON "driver_timeline"("event_type");

-- CreateIndex
CREATE INDEX "idx_driver_timeline_date" ON "driver_timeline"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "transport_vehicles_vehicle_number_key" ON "transport_vehicles"("vehicle_number");

-- CreateIndex
CREATE INDEX "idx_vehicles_driver" ON "transport_vehicles"("driver_id");

-- CreateIndex
CREATE INDEX "idx_vehicles_partner" ON "transport_vehicles"("partner_id");

-- CreateIndex
CREATE INDEX "idx_vehicles_number" ON "transport_vehicles"("vehicle_number");

-- CreateIndex
CREATE INDEX "idx_vehicles_type" ON "transport_vehicles"("vehicle_type");

-- CreateIndex
CREATE INDEX "idx_vehicles_available" ON "transport_vehicles"("is_available");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_booking_reference_key" ON "bookings"("booking_reference");

-- CreateIndex
CREATE INDEX "idx_bookings_user" ON "bookings"("user_id");

-- CreateIndex
CREATE INDEX "idx_bookings_driver" ON "bookings"("driver_id");

-- CreateIndex
CREATE INDEX "idx_bookings_partner" ON "bookings"("partner_id");

-- CreateIndex
CREATE INDEX "idx_bookings_reference" ON "bookings"("booking_reference");

-- CreateIndex
CREATE INDEX "idx_bookings_status" ON "bookings"("status");

-- CreateIndex
CREATE INDEX "idx_bookings_date" ON "bookings"("pickup_date");

-- CreateIndex
CREATE INDEX "idx_bookings_booking_number" ON "bookings"("booking_number");

-- CreateIndex
CREATE INDEX "idx_bookings_settlement" ON "bookings"("settlement_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_booking_id_key" ON "deliveries"("booking_id");

-- CreateIndex
CREATE INDEX "idx_deliveries_booking" ON "deliveries"("booking_id");

-- CreateIndex
CREATE INDEX "idx_deliveries_driver" ON "deliveries"("driver_id");

-- CreateIndex
CREATE INDEX "idx_deliveries_status" ON "deliveries"("current_status");

-- CreateIndex
CREATE UNIQUE INDEX "admins_username_key" ON "admins"("username");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "idx_booking_events_booking_id" ON "booking_events"("booking_id");

-- CreateIndex
CREATE INDEX "idx_booking_events_event_type" ON "booking_events"("event_type");

-- CreateIndex
CREATE INDEX "idx_booking_events_created_at" ON "booking_events"("created_at");

-- CreateIndex
CREATE INDEX "idx_booking_assignments_booking_id" ON "booking_assignments"("booking_id");

-- CreateIndex
CREATE INDEX "idx_booking_assignments_driver_id" ON "booking_assignments"("assigned_driver_id");

-- CreateIndex
CREATE INDEX "idx_booking_assignments_vehicle_id" ON "booking_assignments"("assigned_vehicle_id");

-- CreateIndex
CREATE INDEX "idx_booking_assignments_created_at" ON "booking_assignments"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "partners_partner_code_key" ON "partners"("partner_code");

-- CreateIndex
CREATE INDEX "idx_partner_code" ON "partners"("partner_code");

-- CreateIndex
CREATE INDEX "idx_partner_mobile" ON "partners"("mobile");

-- CreateIndex
CREATE INDEX "idx_partner_status" ON "partners"("status");

-- CreateIndex
CREATE INDEX "idx_partner_city" ON "partners"("city");

-- CreateIndex
CREATE INDEX "idx_partner_state" ON "partners"("state");

-- CreateIndex
CREATE INDEX "idx_partner_active" ON "partners"("is_active");

-- CreateIndex
CREATE INDEX "idx_drv_assign_driver" ON "driver_assignments"("driver_id");

-- CreateIndex
CREATE INDEX "idx_drv_assign_partner" ON "driver_assignments"("partner_id");

-- CreateIndex
CREATE INDEX "idx_drv_assign_status" ON "driver_assignments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "partner_ledger_transaction_id_key" ON "partner_ledger"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_ledger_partner" ON "partner_ledger"("partner_id");

-- CreateIndex
CREATE INDEX "idx_ledger_booking" ON "partner_ledger"("booking_id");

-- CreateIndex
CREATE INDEX "idx_ledger_type" ON "partner_ledger"("transaction_type");

-- CreateIndex
CREATE INDEX "idx_ledger_date" ON "partner_ledger"("date");

-- CreateIndex
CREATE INDEX "idx_ledger_txn_id" ON "partner_ledger"("transaction_id");

-- CreateIndex
CREATE INDEX "idx_ledger_created" ON "partner_ledger"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "partner_payments_payment_number_key" ON "partner_payments"("payment_number");

-- CreateIndex
CREATE INDEX "idx_payment_partner" ON "partner_payments"("partner_id");

-- CreateIndex
CREATE INDEX "idx_payment_number" ON "partner_payments"("payment_number");

-- CreateIndex
CREATE INDEX "idx_payment_status" ON "partner_payments"("status");

-- CreateIndex
CREATE INDEX "idx_payment_date" ON "partner_payments"("date");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_settlement_number_key" ON "settlements"("settlement_number");

-- CreateIndex
CREATE INDEX "idx_settlement_partner" ON "settlements"("partner_id");

-- CreateIndex
CREATE INDEX "idx_settlement_number" ON "settlements"("settlement_number");

-- CreateIndex
CREATE INDEX "idx_settlement_month_year" ON "settlements"("month", "year");

-- CreateIndex
CREATE INDEX "idx_settlement_status" ON "settlements"("status");

-- CreateIndex
CREATE INDEX "idx_doc_partner" ON "partner_documents"("partner_id");

-- CreateIndex
CREATE INDEX "idx_doc_type" ON "partner_documents"("document_type");

-- CreateIndex
CREATE INDEX "idx_doc_expiry" ON "partner_documents"("expiry_date");

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_transactions" ADD CONSTRAINT "driver_transactions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_timeline" ADD CONSTRAINT "driver_timeline_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transport_vehicles" ADD CONSTRAINT "transport_vehicles_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("settlement_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_events" ADD CONSTRAINT "booking_events_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_assigned_driver_id_fkey" FOREIGN KEY ("assigned_driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_assigned_vehicle_id_fkey" FOREIGN KEY ("assigned_vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_assignments" ADD CONSTRAINT "booking_assignments_assigned_by_admin_id_fkey" FOREIGN KEY ("assigned_by_admin_id") REFERENCES "admins"("admin_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_assignments" ADD CONSTRAINT "driver_assignments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger" ADD CONSTRAINT "partner_ledger_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_ledger" ADD CONSTRAINT "partner_ledger_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("booking_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_payments" ADD CONSTRAINT "partner_payments_settlement_id_fkey" FOREIGN KEY ("settlement_id") REFERENCES "settlements"("settlement_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("partner_id") ON DELETE CASCADE ON UPDATE CASCADE;


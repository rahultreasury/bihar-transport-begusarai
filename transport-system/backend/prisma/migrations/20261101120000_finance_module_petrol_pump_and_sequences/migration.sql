-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'CNG', 'OTHER');

-- CreateEnum
CREATE TYPE "PetrolPumpBillStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PetrolPumpPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER');

-- AlterTable
ALTER TABLE "trip_advances" ADD COLUMN     "adjusted_amount" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "adjusted_at" TIMESTAMP(3),
ADD COLUMN     "adjustment_reference" TEXT;

-- CreateTable
CREATE TABLE "document_sequences" (
    "sequence_id" SERIAL NOT NULL,
    "document_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("sequence_id")
);

-- CreateTable
CREATE TABLE "petrol_pumps" (
    "pump_id" SERIAL NOT NULL,
    "pump_name" TEXT NOT NULL,
    "pump_code" TEXT,
    "owner_name" TEXT,
    "contact_number" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT DEFAULT 'Bihar',
    "gst_number" TEXT,
    "pan_number" TEXT,
    "bank_name" TEXT,
    "bank_account" TEXT,
    "bank_ifsc" TEXT,
    "credit_limit" DECIMAL(14,2) DEFAULT 0,
    "opening_balance" DECIMAL(14,2) DEFAULT 0,
    "current_balance" DECIMAL(14,2) DEFAULT 0,
    "status" TEXT DEFAULT 'active',
    "is_active" BOOLEAN DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrol_pumps_pkey" PRIMARY KEY ("pump_id")
);

-- CreateTable
CREATE TABLE "petrol_pump_fuel_transactions" (
    "transaction_id" SERIAL NOT NULL,
    "pump_id" INTEGER NOT NULL,
    "trip_id" INTEGER,
    "vehicle_id" INTEGER,
    "driver_id" INTEGER,
    "fuel_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fuel_type" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "litres" DECIMAL(10,3) NOT NULL,
    "rate_per_litre" DECIMAL(10,2) NOT NULL,
    "total_amount" DECIMAL(14,2) NOT NULL,
    "invoice_number" TEXT,
    "receipt_number" TEXT,
    "bill_id" INTEGER,
    "is_billed" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "supporting_doc" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrol_pump_fuel_transactions_pkey" PRIMARY KEY ("transaction_id")
);

-- CreateTable
CREATE TABLE "petrol_pump_bills" (
    "bill_id" SERIAL NOT NULL,
    "bill_number" TEXT NOT NULL,
    "pump_id" INTEGER NOT NULL,
    "bill_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "fuel_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "adjustment_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "bill_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "outstanding_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PetrolPumpBillStatus" NOT NULL DEFAULT 'PENDING',
    "due_date" TIMESTAMP(3),
    "remarks" TEXT,
    "approved_by" INTEGER,
    "approved_at" TIMESTAMP(3),
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrol_pump_bills_pkey" PRIMARY KEY ("bill_id")
);

-- CreateTable
CREATE TABLE "petrol_pump_payments" (
    "payment_id" SERIAL NOT NULL,
    "payment_number" TEXT NOT NULL,
    "pump_id" INTEGER NOT NULL,
    "bill_id" INTEGER,
    "amount" DECIMAL(14,2) NOT NULL,
    "payment_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_method" "PetrolPumpPaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference_number" TEXT,
    "bank_name" TEXT,
    "voucher_number" TEXT,
    "remarks" TEXT,
    "idempotency_key" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "petrol_pump_payments_pkey" PRIMARY KEY ("payment_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_document_sequence_type_year" ON "document_sequences"("document_type", "year");

-- CreateIndex
CREATE UNIQUE INDEX "petrol_pumps_pump_code_key" ON "petrol_pumps"("pump_code");

-- CreateIndex
CREATE INDEX "idx_petrol_pump_name" ON "petrol_pumps"("pump_name");

-- CreateIndex
CREATE INDEX "idx_petrol_pump_code" ON "petrol_pumps"("pump_code");

-- CreateIndex
CREATE INDEX "idx_petrol_pump_status" ON "petrol_pumps"("status");

-- CreateIndex
CREATE INDEX "idx_petrol_pump_active" ON "petrol_pumps"("is_active");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_pump" ON "petrol_pump_fuel_transactions"("pump_id");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_trip" ON "petrol_pump_fuel_transactions"("trip_id");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_vehicle" ON "petrol_pump_fuel_transactions"("vehicle_id");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_driver" ON "petrol_pump_fuel_transactions"("driver_id");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_date" ON "petrol_pump_fuel_transactions"("fuel_date");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_bill" ON "petrol_pump_fuel_transactions"("bill_id");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_billed" ON "petrol_pump_fuel_transactions"("is_billed");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_pump_date" ON "petrol_pump_fuel_transactions"("pump_id", "fuel_date");

-- CreateIndex
CREATE INDEX "idx_pp_fuel_pump_unbilled" ON "petrol_pump_fuel_transactions"("pump_id", "is_billed", "fuel_date");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_pp_fuel_pump_receipt" ON "petrol_pump_fuel_transactions"("pump_id", "receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "petrol_pump_bills_bill_number_key" ON "petrol_pump_bills"("bill_number");

-- CreateIndex
CREATE INDEX "idx_pp_bill_pump" ON "petrol_pump_bills"("pump_id");

-- CreateIndex
CREATE INDEX "idx_pp_bill_number" ON "petrol_pump_bills"("bill_number");

-- CreateIndex
CREATE INDEX "idx_pp_bill_date" ON "petrol_pump_bills"("bill_date");

-- CreateIndex
CREATE INDEX "idx_pp_bill_status" ON "petrol_pump_bills"("status");

-- CreateIndex
CREATE INDEX "idx_pp_bill_pump_period" ON "petrol_pump_bills"("pump_id", "period_start", "period_end");

-- CreateIndex
CREATE UNIQUE INDEX "petrol_pump_payments_payment_number_key" ON "petrol_pump_payments"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "petrol_pump_payments_idempotency_key_key" ON "petrol_pump_payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "idx_pp_payment_pump_date" ON "petrol_pump_payments"("pump_id", "payment_date");

-- CreateIndex
CREATE INDEX "idx_pp_payment_pump" ON "petrol_pump_payments"("pump_id");

-- CreateIndex
CREATE INDEX "idx_pp_payment_bill" ON "petrol_pump_payments"("bill_id");

-- CreateIndex
CREATE INDEX "idx_pp_payment_date" ON "petrol_pump_payments"("payment_date");

-- CreateIndex
CREATE INDEX "idx_pp_payment_number" ON "petrol_pump_payments"("payment_number");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_pp_payment_pump_ref" ON "petrol_pump_payments"("pump_id", "reference_number");

-- AddForeignKey
ALTER TABLE "petrol_pump_fuel_transactions" ADD CONSTRAINT "petrol_pump_fuel_transactions_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "petrol_pump_bills"("bill_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_fuel_transactions" ADD CONSTRAINT "petrol_pump_fuel_transactions_pump_id_fkey" FOREIGN KEY ("pump_id") REFERENCES "petrol_pumps"("pump_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_fuel_transactions" ADD CONSTRAINT "petrol_pump_fuel_transactions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_fuel_transactions" ADD CONSTRAINT "petrol_pump_fuel_transactions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "transport_vehicles"("vehicle_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_fuel_transactions" ADD CONSTRAINT "petrol_pump_fuel_transactions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "drivers"("driver_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_bills" ADD CONSTRAINT "petrol_pump_bills_pump_id_fkey" FOREIGN KEY ("pump_id") REFERENCES "petrol_pumps"("pump_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_payments" ADD CONSTRAINT "petrol_pump_payments_pump_id_fkey" FOREIGN KEY ("pump_id") REFERENCES "petrol_pumps"("pump_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "petrol_pump_payments" ADD CONSTRAINT "petrol_pump_payments_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "petrol_pump_bills"("bill_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "OpeningBalancePartyType" AS ENUM ('CUSTOMER', 'VENDOR', 'DRIVER', 'PETROL_PUMP');

-- CreateTable
CREATE TABLE "party_opening_balances" (
    "opening_id" SERIAL NOT NULL,
    "party_type" "OpeningBalancePartyType" NOT NULL,
    "party_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "as_of_date" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "party_opening_balances_pkey" PRIMARY KEY ("opening_id")
);

-- CreateIndex
CREATE INDEX "idx_opening_balance_party" ON "party_opening_balances"("party_type", "party_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_opening_balance_party_date" ON "party_opening_balances"("party_type", "party_id", "as_of_date");

-- AlterTable
ALTER TABLE "financial_transactions" ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "voucher_number" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_voucher_number_key" ON "financial_transactions"("voucher_number");

-- CreateIndex
CREATE UNIQUE INDEX "financial_transactions_idempotency_key_key" ON "financial_transactions"("idempotency_key");


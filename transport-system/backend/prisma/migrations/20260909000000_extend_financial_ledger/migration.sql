-- Create enum types if they don't exist
DO $$ BEGIN
  CREATE TYPE "TransactionParty" AS ENUM ('BIHAR_TRANSPORT', 'CUSTOMER', 'CLIENT', 'TRANSPORT_OWNER', 'DRIVER', 'VENDOR', 'OTHER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Extend FinancialTransaction with proper transaction ledger fields
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "from_party" "TransactionParty";
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "to_party" "TransactionParty";
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "purpose" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "transaction_date" TIMESTAMP;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "trip_id" INTEGER;
ALTER TABLE "financial_transactions" ADD COLUMN IF NOT EXISTS "client_id" INTEGER;

-- Add indexes
CREATE INDEX IF NOT EXISTS "idx_financial_tx_trip" ON "financial_transactions"("trip_id");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_from" ON "financial_transactions"("from_party");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_to" ON "financial_transactions"("to_party");
CREATE INDEX IF NOT EXISTS "idx_financial_tx_date" ON "financial_transactions"("transaction_date");

-- Add foreign keys
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trips"("trip_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "financial_transactions" ADD CONSTRAINT "financial_transactions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("client_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add new fields to trip_expenses
ALTER TABLE "trip_expenses" ADD COLUMN IF NOT EXISTS "paid_to" "TransactionParty" DEFAULT 'VENDOR';
ALTER TABLE "trip_expenses" ADD COLUMN IF NOT EXISTS "payment_method" TEXT;
ALTER TABLE "trip_expenses" ADD COLUMN IF NOT EXISTS "reference_number" TEXT;

-- Remove duplicate cached fields from trips table
-- These will be derived from FinancialTransaction going forward
ALTER TABLE "trips" DROP COLUMN IF EXISTS "advance";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "client_received";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "owner_paid";
ALTER TABLE "trips" DROP COLUMN IF EXISTS "driver_paid";

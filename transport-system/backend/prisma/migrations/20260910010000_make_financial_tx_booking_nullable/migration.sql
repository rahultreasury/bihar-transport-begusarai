-- Make booking_id nullable in FinancialTransaction for standalone trips
ALTER TABLE "financial_transactions" ALTER COLUMN "booking_id" DROP NOT NULL;
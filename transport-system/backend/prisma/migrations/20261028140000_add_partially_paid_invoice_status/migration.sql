-- Add PARTIALLY_PAID to InvoiceStatus enum
-- This allows invoices with partial payments to be correctly tracked
-- as PARTIALLY_PAID instead of remaining PENDING/UNPAID.
DO $$
BEGIN
    ALTER TYPE "InvoiceStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_PAID';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

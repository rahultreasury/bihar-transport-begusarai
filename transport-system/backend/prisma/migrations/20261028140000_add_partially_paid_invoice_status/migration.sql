-- Add PARTIALLY_PAID to InvoiceStatus enum
-- This allows invoices with partial payments to be correctly tracked
-- as PARTIALLY_PAID instead of remaining PENDING/UNPAID.
ALTER TYPE "InvoiceStatus" ADD VALUE 'PARTIALLY_PAID';

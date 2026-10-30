-- Add ASSIGNMENT_RELEASED to EnquiryEventType enum
-- This enum value is used when a customer rejects a quote and the reserved vehicle/driver are released back to the fleet

DO $$
BEGIN
    ALTER TYPE "EnquiryEventType" ADD VALUE IF NOT EXISTS 'ASSIGNMENT_RELEASED';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

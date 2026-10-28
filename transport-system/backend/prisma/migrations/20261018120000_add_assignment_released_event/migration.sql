-- Add ASSIGNMENT_RELEASED to EnquiryEventType enum
-- This enum value is used when a customer rejects a quote and the reserved vehicle/driver are released back to the fleet

ALTER TYPE "EnquiryEventType" ADD VALUE 'ASSIGNMENT_RELEASED';
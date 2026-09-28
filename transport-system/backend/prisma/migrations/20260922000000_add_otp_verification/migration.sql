-- Add OtpVerification table for phone-based OTP authentication
-- Stores SHA-256 hashed OTPs (never plaintext) with expiration, attempt tracking,
-- and single-use enforcement for customer authentication via phone.

-- Create otp_verifications table
CREATE TABLE IF NOT EXISTS "otp_verifications" (
    "id"           SERIAL PRIMARY KEY,
    "user_id"      INTEGER,
    "phone"        TEXT NOT NULL,
    "otp_hash"     TEXT NOT NULL,
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "attempts"     INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "verified_at"  TIMESTAMP(3),
    "consumed"     BOOLEAN NOT NULL DEFAULT false,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraint to users (nullable — allows pre-registration OTPs)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'otp_verifications_user_id_fkey'
    ) THEN
        ALTER TABLE "otp_verifications"
        ADD CONSTRAINT "otp_verifications_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Index on phone for fast lookup of active OTPs
CREATE INDEX IF NOT EXISTS "idx_otp_phone"
    ON "otp_verifications"("phone");

-- Index on expires_at for cleanup of expired OTPs
CREATE INDEX IF NOT EXISTS "idx_otp_expires"
    ON "otp_verifications"("expires_at");

-- Index on created_at for time-based queries
CREATE INDEX IF NOT EXISTS "idx_otp_created"
    ON "otp_verifications"("created_at");

-- Index on user_id for user-linked OTP lookups
CREATE INDEX IF NOT EXISTS "idx_otp_user"
    ON "otp_verifications"("user_id");
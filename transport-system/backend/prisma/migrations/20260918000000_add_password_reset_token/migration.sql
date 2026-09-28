-- Add PasswordResetToken table for secure password reset functionality
-- This migration represents the schema change that was previously applied via `prisma db push`
-- The table already exists in the database, so this migration uses IF NOT EXISTS to be idempotent

-- Create password_reset_tokens table
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id" SERIAL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add foreign key constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'password_reset_tokens_user_id_fkey'
    ) THEN
        ALTER TABLE "password_reset_tokens" 
        ADD CONSTRAINT "password_reset_tokens_user_id_fkey" 
        FOREIGN KEY ("user_id") REFERENCES "users"("user_id") 
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Create unique index on token_hash
CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_key" 
ON "password_reset_tokens"("token_hash");

-- Create index on user_id
CREATE INDEX IF NOT EXISTS "idx_password_reset_user" 
ON "password_reset_tokens"("user_id");

-- Create index on expires_at
CREATE INDEX IF NOT EXISTS "idx_password_reset_expires" 
ON "password_reset_tokens"("expires_at");
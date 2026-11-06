-- Add reversal_of_transaction_id to financial_transactions for self-referential reversal tracking
--
-- WHY THIS MIGRATION EXISTS
--   The FinancialTransaction model declares a self-referential relation for tracking
--   transaction reversals (reversal_of_transaction_id, reversal_of, reversal).
--   No prior migration created this column, index, or foreign key.
--   This adds them safely with guards so the migration is idempotent.
--
-- BACKWARD COMPATIBILITY
--   * Only adds a nullable column, unique index, and FK
--   * No table is dropped, truncated or rewritten
--   * No row is deleted or modified
--   * Safe to apply against production

-- 1. Add nullable reversal_of_transaction_id column
ALTER TABLE "financial_transactions"
ADD COLUMN IF NOT EXISTS "reversal_of_transaction_id" INTEGER;

-- 2. Add unique index (Prisma default name for @unique on this field)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'financial_transactions'
      AND indexname = 'financial_transactions_reversal_of_transaction_id_key'
  ) THEN
    CREATE UNIQUE INDEX "financial_transactions_reversal_of_transaction_id_key"
    ON "financial_transactions"("reversal_of_transaction_id");
  END IF;
END $$;

-- 3. Add self-referencing foreign key (ON DELETE RESTRICT ON UPDATE CASCADE matching Prisma relation)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_transactions_reversal_of_transaction_id_fkey'
  ) THEN
    ALTER TABLE "financial_transactions"
    ADD CONSTRAINT "financial_transactions_reversal_of_transaction_id_fkey"
    FOREIGN KEY ("reversal_of_transaction_id")
    REFERENCES "financial_transactions"("transaction_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
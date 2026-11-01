-- Accounting journal engine (Phase 4B)
CREATE TABLE "accounting_accounts" (
    "account_id" SERIAL NOT NULL,
    "account_code" TEXT NOT NULL,
    "account_name" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_accounts_pkey" PRIMARY KEY ("account_id")
);
CREATE UNIQUE INDEX "accounting_accounts_account_code_key" ON "accounting_accounts"("account_code");
CREATE INDEX "idx_accounting_accounts_type" ON "accounting_accounts"("account_type");

CREATE TABLE "journal_entries" (
    "journal_id" SERIAL NOT NULL,
    "reference" TEXT NOT NULL,
    "posting_date" TIMESTAMP(3) NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'POSTED',
    "created_by" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("journal_id")
);
CREATE UNIQUE INDEX "journal_entries_reference_key" ON "journal_entries"("reference");
CREATE INDEX "idx_journal_entries_source" ON "journal_entries"("source_type", "source_id");
CREATE INDEX "idx_journal_entries_date" ON "journal_entries"("posting_date");

CREATE TABLE "journal_lines" (
    "line_id" SERIAL NOT NULL,
    "journal_id" INTEGER NOT NULL,
    "account_id" INTEGER NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("line_id")
);
CREATE INDEX "idx_journal_lines_journal" ON "journal_lines"("journal_id");
CREATE INDEX "idx_journal_lines_account" ON "journal_lines"("account_id");

ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "journal_entries"("journal_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounting_accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;

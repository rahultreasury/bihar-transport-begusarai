# Monetary Precision Inventory

Authoritative money fields:
- `services/finance/money.js` — integer-paise engine (authoritative).
- `services/finance/financeUtils.js` — mixed Number-based helpers (`roundMoney`, `num`, `invoiceTotal`).
- Prisma `Float` legacy columns: Invoice amounts, TripFinancial monetary columns, FinancialTransaction.amount, TripAdvance.amount, PartyOpeningBalance.amount.
- Prisma `Decimal` columns: PetrolPump monetary columns, JournalLine.amount.

Remaining Float fields are preserved for backward compatibility; conversion to Decimal requires non-destructive migration and data validation not yet performed.

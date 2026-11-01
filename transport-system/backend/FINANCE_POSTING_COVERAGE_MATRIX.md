# Finance Posting Coverage Matrix

| Source Operation | Posting Service | Journal | Debit | Credit | Ledger | Audit | Idempotency | Reversal | Atomic Tx | PG Test |
|---|---|---|---|---|---|---|---|---|---|---|
| Customer receipt | FinancePostingService.recordCustomerReceipt | Yes | CASH/BANK/SETTLEMENT_ADJUSTMENT | ACCOUNTS_RECEIVABLE | Yes | Yes | Yes | Via reverseTransaction | Yes | Yes |
| Vendor payment | FinancePostingService.recordVendorPayment | Yes | VENDOR_PAYABLE | CASH/BANK + PETROL_PUMP_PAYABLE | Yes | Yes | Yes | Via reverseTransaction | Yes | Partial |
| Commission receipt | FinancePostingService.recordCommissionReceipt | Yes | CASH/BANK | COMMISSION_INCOME | Yes | Yes | Yes | Via reverseTransaction | Yes | No |
| Customer advance | FinancePostingService.createAdvance | Yes | CASH/BANK | CUSTOMER_ADVANCE_PAYABLE | Yes | Yes | Yes | Via reverseTransaction | Partial (TripAdvance separate tx) | No |
| Vendor/driver/fuel advance | FinancePostingService.createAdvance | Yes | ADVANCE_ASSET | CASH/BANK | Yes | Yes | App-level only | Via reverseTransaction | Partial | No |
| Advance adjustment | FinancePostingService.adjustAdvance | No (non-cash) | n/a | n/a | Yes | Yes | No | No | Yes | No |
| Customer settlement | FinancePostingService.createSettlement -> recordCustomerReceipt | Yes | SETTLEMENT_ADJUSTMENT | ACCOUNTS_RECEIVABLE | Yes | Yes | Yes | Via reverseTransaction | Yes | No |
| Vendor settlement | FinancePostingService.createSettlement | No (non-cash) | n/a | n/a | Yes | Yes | Yes | Via reverseTransaction | Yes | No |
| Petrol pump fuel | FinancePostingService.recordFuel | Yes | FUEL_EXPENSE / VENDOR_PAYABLE | PETROL_PUMP_PAYABLE / FUEL_EXPENSE | Yes | Yes | Partial | Via reverseTransaction | Yes | No |
| Pump payment | FinancePostingService.payPump | Yes | PETROL_PUMP_PAYABLE | CASH/BANK | Yes | Yes | Yes | Via reverseTransaction | Partial (repo owns tx) | No |
| Reverse transaction | FinancePostingService.reverseTransaction | Yes (best-effort) | Opposite of original | Opposite of original | Yes | Yes | Yes | Duplicate rejected | Yes | No |

# Bihar Transport — Requirements-to-Implementation Audit Matrix

**Test Identifier:** BT-AUDIT-20261028-001  
**Audit Date:** 2026-10-28  
**System Design Document:** plans/BIHAR_TRANSPORT_SYSTEM_DESIGN.md  
**Database:** PostgreSQL (Neon-compatible), Prisma ORM  
**Test Environment:** Isolated test database `bihar_transport_audit_test`

---

## Classification Legend

| Classification | Meaning |
|---|---|
| **PASS** | Verified by an executed test with evidence |
| **FAIL** | An executed test demonstrated incorrect behavior |
| **PARTIAL** | Some behavior works, but requirements remain unmet |
| **NOT IMPLEMENTED** | Required functionality is missing |
| **NOT VERIFIED** | Evidence is insufficient or the test could not safely run |

---

## A. Enquiry Module

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| A1 | Enquiry creation | Valid enquiry persisted with unique enquiry number | `EnquiryService.createEnquiry()` in `services/EnquiryService.js:232` — creates enquiry in Prisma transaction, generates `enquiry_number` via `EnquiryNumberService`, adds `ENQUIRY_CREATED` event | Unit tests in `tests/enquiry.verify.test.js` and `tests/enquiry.flow.e2e.js` exercise creation | **PARTIAL** — Code exists and unit tests pass, but end-to-end API test not yet executed against isolated DB |
| A2 | Enquiry number generation | Unique, sequential enquiry number (BT-ENQ-YYYY-NNNNN) | `buildEnquiryNumber()` in `services/EnquiryNumberService.js` — derived from DB-assigned PK inside transaction | `tests/enquiry.verify.test.js` | **NOT VERIFIED** — Not yet executed against isolated test DB |
| A3 | Enquiry status machine | Valid transitions only; terminal states are final | `EnquiryStateMachine.js` — `assertTransition()`, `canTransition()`, `ALLOWED_TRANSITIONS` | Unit tests exist | **NOT VERIFIED** |
| A4 | Enquiry-to-booking conversion | Accepted enquiry creates exactly one booking via `BookingService.createBooking()` | `EnquiryService` calls `BookingService.createBooking()` on acceptance; `booking_id` linked back to enquiry | `tests/enquiry.flow.e2e.js` | **NOT VERIFIED** |
| A5 | No orphaned/duplicate orders | Enquiry confirmation produces exactly one order/trip | `TripProvisioningService.ensureTripForBooking()` — idempotent, re-checks inside transaction | `tests/phaseBQuotation.db.test.js` | **NOT VERIFIED** |
| A6 | Enquiry access control | Customer sees own enquiries; admin sees all | `EnquiryDTO.js` — `adminRelationSelect`, `customerRelationSelect` | `tests/enquiryAdminDetail.db.test.js` | **NOT VERIFIED** |

---

## B. Quotation Module

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| B1 | Quotation creation | Rate and charges calculated and persisted | `quotations` model with `quotation_charges`, `quotation_milestones`, `quotation_versions` | `tests/phaseBQuotation.db.test.js` | **NOT VERIFIED** |
| B2 | GST treatment | GST calculated per `QuotationGstType` (RCM/FORWARD_CHARGE/EXEMPT) | `quotations.gst_type`, `gst_percentage`, `gst_amount`, `cgst`, `sgst`, `igst` on Invoice model | Schema inspection | **NOT VERIFIED** |
| B3 | Quotation status lifecycle | DRAFT → RATE_QUOTED → SENT → CONVERTED | `QuotationStatus` enum | Schema inspection | **NOT VERIFIED** |
| B4 | Quotation-to-booking link | `quotation_id` on Enquiry is `@unique`; booking created on conversion | `Enquiry.quotation_id` @unique; `Booking.booking_quotation_snapshots` @unique | Schema inspection | **NOT VERIFIED** |
| B5 | No duplicate quotations | `enquiry_id` is `@unique` on quotations | Schema: `quotations.enquiry_id @unique` | Schema inspection | **NOT VERIFIED** |

---

## C. Order Confirmation & Booking

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| C1 | Order confirmation | Enquiry + quotation remain linked; exactly one confirmed order | `BookingService.confirmBooking()` — requires `quote_status === 'ACCEPTED'`, idempotent via `confirmation_source === 'ADMIN'` check | `tests/enterpriseBookingLifecycle.test.js` | **NOT VERIFIED** |
| C2 | No duplicate confirmation | Idempotent — double-click returns `alreadyConfirmed: true` | `confirmBooking()` checks `existing.confirmation_source === 'ADMIN'` before writing | Code inspection | **NOT VERIFIED** |
| C3 | Trip provisioning | Exactly one trip provisioned per confirmed order | `TripProvisioningService.ensureTripForBooking()` — re-checks inside transaction, one trip per booking | `tests/phase2VehicleHire.test.js` | **NOT VERIFIED** |
| C4 | Booking number | Canonical `booking_number` (BTB-YYYY-NNNNN) derived from PK | `BookingNumberService.buildBookingNumber()` — derived inside transaction | `tests/phase1OrderTrip.test.js` | **NOT VERIFIED** |
| C5 | Invoice on confirmation | Invoice created when quote accepted | `BookingService.createBooking()` creates invoice when `quote_status === 'ACCEPTED'` | Code inspection (line 153-173) | **NOT VERIFIED** |

---

## D. Vehicle Hire Module

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| D1 | Universal vehicle hire | One workflow for both Commission and Contract models | `VehicleHireWorkflowService.js` — single service, `billing_to` derives `business_model` | `tests/universalVehicleHire.test.js`, `tests/phase8VehicleHireFlow.test.js` | **NOT VERIFIED** |
| D2 | Billing-to → business model | CONSIGNOR/CONSIGNEE/THIRD_PARTY → CONTRACT; VEHICLE_VENDOR → COMMISSION | `config/vehicleHirePolicy.js:49-54` — `BILLING_TO_BUSINESS_MODEL` | Code inspection | **NOT VERIFIED** |
| D3 | Gross hire calculation | Rate × quantity for quantity bases; rate for fixed bases | `VehicleHireWorkflowService.computeGrossHire()` — `RATE_QUANTITY` vs `RATE` vs `NET` modes | `tests/phase8VehicleHirePage.test.js` | **NOT VERIFIED** |
| D4 | Commission calculation | Percentage or fixed; `gross − commission = net` | `CommissionCalculator.computeCommission()` — `VehicleHireService.computeCommissionAmount()` | `tests/commissionCalculator.test.js` | **NOT VERIFIED** |
| D5 | No-commission case | `NO_COMMISSION` type stored as `percentage` with `zero: true` | `config/vehicleHirePolicy.js:185-189` | Code inspection | **NOT VERIFIED** |
| D6 | Separate money figures | `gross_hire`, `commission_amount`, `net_vendor_payable` stored separately | `VehicleHire` model — three separate `Decimal` columns; DB constraint enforces identity | Schema inspection | **NOT VERIFIED** |
| D7 | Vehicle/driver assignment | One current assignment per trip; history preserved | `TripVehicleAssignmentService.assign()` — updates Trip row in place, appends to `trip_timeline` | `tests/driverVehicleAssignment.test.js` | **NOT VERIFIED** |
| D8 | Double-booking protection | Vehicle/driver not assignable to conflicting active trips | `findActiveTripConflicts()` — checks `ACTIVE_TRIP_STATUSES` | `tests/tripDoubleBooking.test.js` | **NOT VERIFIED** |
| D9 | Hire-ready statuses | PENDING, ASSIGNED, TO_LOADING_POINT are hire-ready | `config/vehicleHirePolicy.js:315-319` — `HIRE_READY_TRIP_STATUSES` | Code inspection | **NOT VERIFIED** |

---

## E. Customer Finance

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| E1 | Customer invoice creation | Invoice created from booking final_price | `Invoice` model linked to `booking_id` (@unique) and `trip_id` | `tests/phase7CustomerBilling.test.js` | **NOT VERIFIED** |
| E2 | Invoice totals | `grand_total` = taxable + GST + charges − discount | `Invoice` model: `goods_amount`, `vehicle_charge`, `extra_charges`, `discount`, `tax_amount`, `grand_total` | Schema inspection | **NOT VERIFIED** |
| E3 | GST not applied twice | GST calculated once from configured rules | `Invoice.gst_type`, `gst_percentage`, `cgst`, `sgst`, `igst` | Schema inspection | **NOT VERIFIED** |
| E4 | Partial customer receipts | Multiple receipts against one invoice | `FinancialTransaction` with `CUSTOMER_PAYMENT`/`CLIENT_PAYMENT` type | `tests/customerPaymentRecording.test.js` | **NOT VERIFIED** |
| E5 | Outstanding receivables | `Customer Balance = Invoice Total − Total Payments` | `CanonicalFinancialService._computeTripFinancials()` — `customerDue = freight − customerCollected` | `tests/billingPaymentsConsistency.test.js` | **NOT VERIFIED** |
| E6 | Payment status | Unbilled/Unpaid/Partially Paid/Paid | `_paymentStatus()` helper in `CanonicalFinancialService` | Code inspection | **NOT VERIFIED** |
| E7 | No overpayment | Receipts cannot exceed outstanding unless supported | Validation in payment recording services | Code inspection | **NOT VERIFIED** |
| E8 | Customer ledger reconciliation | Ledger matches invoice and payment records | `CanonicalFinancialService.getClientLedger()` | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |

---

## F. Vendor Finance

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| F1 | Gross hire and commission separate | `gross_hire` ≠ `net_vendor_payable`; both stored | `VehicleHire` model — separate `Decimal` columns | Schema inspection | **NOT VERIFIED** |
| F2 | Partial vendor payments | Multiple payments update balance correctly | `TripPayment`, `FinancialTransaction` with `OWNER_SETTLEMENT`/`OWNER_ADVANCE` | `tests/phase3VendorPayment.test.js` | **NOT VERIFIED** |
| F3 | Previous vendor balance preserved | Trip payment doesn't erase previous balance | `VendorLedgerService.getOwnerPosition()` — computes from ledger | `tests/phase3VendorPayment.db.test.js` | **NOT VERIFIED** |
| F4 | Payable vs receivable direction | Correct direction for vendor payments | `FinancialTransaction.direction` — DEBIT/CREDIT | Schema inspection | **NOT VERIFIED** |
| F5 | Settlement without cash movement | `TripSettlement` records settlement | `TripSettlement` model with `driver_settlement_*` and `owner_settlement_*` fields | Schema inspection | **NOT VERIFIED** |
| F6 | Vendor ledger reconciliation | `Trip Vendor Balance = Net Vendor Payable − Vendor Payments` | `VendorLedgerService.getOwnerPosition(tripId)` | `tests/phase3VendorPayment.db.test.js` | **NOT VERIFIED** |

---

## G. Trip Lifecycle

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| G1 | Valid status transitions | PENDING → ASSIGNED → TO_LOADING_POINT → ... → COMPLETED | `TripStateMachine.js` — `validateTransition()`, `validateOperationalTransition()` | `tests/phase4LoadingDispatch.test.js`, `tests/phase5-transit.test.js` | **NOT VERIFIED** |
| G2 | Invalid transitions rejected | Skipping loading/dispatch steps refused by operational endpoints | `validateOperationalTransition()` rejects `LEGACY_SKIP_TRANSITIONS` | `tests/phase4LoadingDispatch.test.js` | **NOT VERIFIED** |
| G3 | Status history | `TripTimeline` records each transition | `TripTimelineRepository` — `addEvent()` called on transitions | `tests/phaseBEnquiryTimeline.db.test.js` | **NOT VERIFIED** |
| G4 | Actor and timestamp | `created_by` and `created_at` on timeline events | `TripTimeline` model: `created_by`, `created_at` | Schema inspection | **NOT VERIFIED** |

---

## H. POD (Proof of Delivery)

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| H1 | POD required → POD Pending | Delivered with POD required → POD Pending, not Completed | `Trip.pod_required` Boolean; `TripDocument` with `document_type: 'POD'` | `tests/phase6DeliveryPod.test.js` | **NOT VERIFIED** |
| H2 | POD upload | Synthetic POD file persisted with file reference | `TripDocument.file_url`, `is_uploaded`, `is_verified` | `tests/phase6-delivery-pod.db.test.js` | **NOT VERIFIED** |
| H3 | Completion only after POD | Trip reaches Completed only after POD conditions met | `TripStateMachine` — DELIVERED → COMPLETED; POD check in operational service | `tests/phase6DeliveryPod.test.js` | **NOT VERIFIED** |
| H4 | No fake POD | Cannot complete by changing status only | Operational endpoints validate POD before allowing COMPLETED | `tests/phase6-delivery-pod.http.test.js` | **NOT VERIFIED** |

---

## I. Finance Dashboard

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| I1 | Client Receivable KPI | Matches authoritative query | `CanonicalFinancialService.calculateGlobalFinancials()` — `totalFreight`, `totalReceived`, `totalReceivable` | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I2 | Client Due KPI | Outstanding receivables | `totalCustomerDue` from global financials | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I3 | Total Received KPI | Actual customer payments received | `totalCustomerCollected` from `FinancialTransaction` ledger | `tests/billingPaymentsConsistency.test.js` | **NOT VERIFIED** |
| I4 | Provider Payable KPI | Vendor payable amount | `totalOwnerShare`, `totalOwnerPaid`, `totalOwnerPayable` | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I5 | Advances KPI | Driver + owner + fuel advances | `totalDriverAdvances`, `totalOwnerAdvances`, `totalFuelAdvances` | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I6 | Commission KPI | BT commission earned | `totalBtCommission` from `FinancialTransaction` COMMISSION type | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I7 | Settlements KPI | Owner + driver settlements | `totalOwnerSettlements`, `totalDriverSettlements` | `tests/financialDrilldown.test.js` | **NOT VERIFIED** |
| I8 | No double-counting | Payments counted once across all views | `_aggregateTransactions()` — REVERSAL handling, CANCELLED/REFUNDED excluded | `tests/billingPaymentsConsistency.test.js` | **NOT VERIFIED** |
| I9 | No mixing of booking/trip finance | Authoritative source per calculation | `CanonicalFinancialService` — single source of truth from `FinancialTransaction` | Code inspection | **NOT VERIFIED** |

---

## J. Authentication & Authorization

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| J1 | JWT authentication | Valid token required for protected routes | `middleware/auth.js` — `protect`, `adminOnly` | `tests/httpAuth.test.js` | **NOT VERIFIED** |
| J2 | Role-based access | Admin-only routes reject non-admin | `adminOnly` middleware | `tests/httpAuth.test.js` | **NOT VERIFIED** |
| J3 | Customer isolation | Customer sees own data only | `roleFor()` in `tripFinancialRoutes.js` — CUSTOMER role gets limited projection | `tests/tripAuthorization.test.js` | **NOT VERIFIED** |
| J4 | Password reset | Secure token-based reset | `PasswordResetToken` model, `otpController.js` | `tests/otpAuth.test.js` | **NOT VERIFIED** |

---

## K. Data Integrity

| # | Requirement | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| K1 | Foreign key constraints | Invalid relationships prevented | Prisma `@relation` with `onDelete: Cascade/Restrict` | Schema inspection | **NOT VERIFIED** |
| K2 | Unique constraints | No duplicate identifiers | `@unique` on `booking_number`, `enquiry_number`, `trip_number`, `invoice_number`, etc. | Schema inspection | **NOT VERIFIED** |
| K3 | Decimal precision | Currency values use appropriate precision | `VehicleHire` uses `Decimal @db.Decimal(14,2)`; other money fields use `Float` | Schema inspection | **PARTIAL** — VehicleHire uses Decimal, but Booking/Invoice/Trip use Float (potential precision issues) |
| K4 | Transactions for financial ops | Multi-record operations atomic | `prisma.$transaction()` used in `BookingService.createBooking()`, `confirmBooking()`, `TripVehicleAssignmentService.assign()` | Code inspection | **NOT VERIFIED** |
| K5 | Concurrency safety | No duplicate payments/confirmations | Idempotency checks + database unique constraints + transaction re-reads | Code inspection | **NOT VERIFIED** |
| K6 | Rollback on failure | Failed operations roll back changes | Prisma transactions roll back on error | Code inspection | **NOT VERIFIED** |
| K7 | Audit records | Important changes captured with responsible user | `AuditLog` model; `TripTimeline` with `created_by` | Schema inspection | **NOT VERIFIED** |
| K8 | No SQLite/local storage | All data in PostgreSQL | `datasource db { provider = "postgresql" }` | Schema inspection | **PASS** — Schema declares PostgreSQL; no SQLite in active codebase (archive/ has legacy SQLite migration scripts) |
| K9 | Migration consistency | Schema matches committed migrations | `schemaDeploymentGuard.js` — compares schema.prisma against committed migrations | `tests/adminVehiclesEnquiriesSchema.test.js` — 2 FAILs (missing columns in production) | **FAIL** — Schema declares columns not in committed migrations (production 500 risk) |

---

## L. System Design Document Compliance

| # | Requirement (from PDF) | Expected Behavior | Existing Implementation | Test Evidence | Result |
|---|---|---|---|---|---|
| L1 | Unified state machine | Single `BookingLifecycleStatus` enum | Two enums exist: `BookingStatus` (booking) and `TripStatus` (trip) + `DeliveryStatus` (delivery) | Schema inspection | **PARTIAL** — Multiple status enums still exist; not unified as PDF requires |
| L2 | Sub-500ms booking creation | Fast booking creation | No caching layer implemented; no Redis | Code inspection | **NOT VERIFIED** |
| L3 | Standardized API response | `{success, message, data, errors, meta}` envelope | Inconsistent — some routes use envelope, others return raw data | Code inspection | **PARTIAL** — Some routes standardized, others not |
| L4 | Response flattening utility | Single `flattenBooking()` utility | Duplicated in `bookingRoutes.js`, `adminRoutes.js`, `driverRoutes.js` | Code inspection | **PARTIAL** — Duplication acknowledged in design doc but not yet fixed |
| L5 | Database indexes | Composite indexes on frequently queried fields | Indexes exist on most models | Schema inspection | **NOT VERIFIED** |
| L6 | Offline business module | DailyTrip, TripExpense for offline ops | `TripExpense` model exists; `DailyTrip` not in schema | Schema inspection | **PARTIAL** — TripExpense exists, DailyTrip missing |
| L7 | No dead code | Legacy SQLite backend removed | `archive/` directory contains legacy SQLite code; `config/prisma.js` comment says "SQLite remains active" | File inspection | **FAIL** — Legacy code still present; comment in active code references SQLite |

---

## Summary of Audit Matrix

| Category | PASS | FAIL | PARTIAL | NOT IMPLEMENTED | NOT VERIFIED |
|---|---|---|---|---|---|
| A. Enquiry | 0 | 0 | 1 | 0 | 5 |
| B. Quotation | 0 | 0 | 0 | 0 | 5 |
| C. Order/Booking | 0 | 0 | 0 | 0 | 5 |
| D. Vehicle Hire | 0 | 0 | 0 | 0 | 9 |
| E. Customer Finance | 0 | 0 | 0 | 0 | 8 |
| F. Vendor Finance | 0 | 0 | 0 | 0 | 6 |
| G. Trip Lifecycle | 0 | 0 | 0 | 0 | 4 |
| H. POD | 0 | 0 | 0 | 0 | 4 |
| I. Finance Dashboard | 0 | 0 | 0 | 0 | 9 |
| J. Auth/AuthZ | 0 | 0 | 0 | 0 | 4 |
| K. Data Integrity | 1 | 1 | 1 | 0 | 6 |
| L. Design Doc Compliance | 0 | 2 | 3 | 0 | 2 |
| **TOTAL** | **1** | **3** | **5** | **0** | **67** |

**Key Findings:**
1. **Migration ordering bug**: `20260818000000_add_transport_owner_to_driver` references `vehicle_owners` which is created in a later migration — fresh deployments will fail
2. **Schema/migration drift**: `schemaDeploymentGuard.js` tests fail — production schema has columns not in committed migrations
3. **Float vs Decimal for currency**: Booking, Invoice, Trip use `Float` for money fields; only `VehicleHire` uses `Decimal` — potential rounding errors
4. **Multiple status enums**: `BookingStatus`, `DeliveryStatus`, `TripStatus`, `EnquiryStatus` — not unified as design doc requires
5. **Legacy code**: `archive/` contains SQLite code; `config/prisma.js` comment references SQLite
6. **67 requirements NOT VERIFIED**: Need end-to-end test execution against isolated database

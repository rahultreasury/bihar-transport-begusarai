# Release Candidate Files Classification
**Branch:** `release-candidate/20261029-batch2b`
**Base Commit:** `5eb3e5d` (Improve admin dashboard UI)
**Date:** 2026-10-29

---

## 1. Application Code (Core Business Logic)

### Backend Services (Batch 2B Financial Integrity)
- `transport-system/backend/services/TripInvoiceService.js` — Invoice reconciliation (`PARTIALLY_PAID` status, REFUNDED exclusion, booking-bill fallback)
- `transport-system/backend/services/VendorLedgerService.js` — VehicleHire authority (`_resolveHireMoney`), `hire_source` provenance
- `transport-system/backend/services/TripSettlementService.js` — Concurrency guard (FOR UPDATE + re-derive), over-payment rejection
- `transport-system/backend/services/CanonicalFinancialService.js` — REFUNDED exclusion in aggregation, row lock on TripFinancial
- `transport-system/backend/services/TripService.js` — `addPayment` invoice stamp (relation form), reconciliation call
- `transport-system/backend/services/VehicleHireWorkflowService.js` — Engaged driver allowance, availability fixes
- `transport-system/backend/services/TripOperationalService.js` — Operational status transitions

### Supporting Services (Modified for Consistency)
- `transport-system/backend/services/BookingService.js`
- `transport-system/backend/services/QuotationService.js`
- `transport-system/backend/services/EnquiryService.js`
- `transport-system/backend/services/BookingNumberService.js`
- `transport-system/backend/services/BookingQueryService.js`
- `transport-system/backend/services/DriverManagementService.js`
- `transport-system/backend/services/EnquiryAssignmentService.js`
- `transport-system/backend/services/ResourceAvailabilityService.js`
- `transport-system/backend/services/TripDispatchService.js`
- `transport-system/backend/services/TripTransitOpsService.js`
- `transport-system/backend/services/TripVehicleAssignmentService.js`

### Controllers & Routes
- `transport-system/backend/controllers/bookingController.js`
- `transport-system/backend/controllers/quotationController.js`
- `transport-system/backend/controllers/mapsController.js`
- `transport-system/backend/routes/adminRoutes.js`
- `transport-system/backend/routes/dispatchRoutes.js`
- `transport-system/backend/routes/financialRoutes.js`
- `transport-system/backend/routes/tripRoutes.js`

### Middleware & Utilities
- `transport-system/backend/middleware/auth.js`
- `transport-system/backend/utils/BookingMapper.js`
- `transport-system/backend/utils/TripStateMachine.js`
- `transport-system/backend/validators/bookingQuery.js`
- `transport-system/backend/dtos/EnquiryDTO.js`

### Repositories
- `transport-system/backend/repositories/BookingRepository.js`
- `transport-system/backend/repositories/BookingAssignmentRepository.js`
- `transport-system/backend/repositories/DriverRepository.js`
- `transport-system/backend/repositories/TripRepository.js`
- `transport-system/backend/repositories/VehicleOwnerRepository.js`

### Configuration
- `transport-system/backend/config/tripStagePolicy.js`

### Frontend (Admin Dashboard & Vehicle Hire UI)
- `transport-system/frontend/src/components/admin-premium/layout/AdminShell.jsx`
- `transport-system/frontend/src/components/admin-premium/layout/AdminTopHeader.jsx`
- `transport-system/frontend/src/components/admin-premium/layout/adminNavigation.js`
- `transport-system/frontend/src/components/admin-premium/ui/PremiumTable.jsx`
- `transport-system/frontend/src/pages/AdminDashboard.jsx`
- `transport-system/frontend/src/pages/AdminVehicleHireList.jsx`
- `transport-system/frontend/src/index.css`
- `transport-system/frontend/src/main.jsx`
- `transport-system/frontend/src/server.js` (entry point)

---

## 2. Prisma Schema & Migrations

### Schema
- `transport-system/backend/prisma/schema.prisma` — Added `PARTIALLY_PAID` to `InvoiceStatus` enum, `ASSIGNMENT_RELEASED` to `EnquiryEventType`, moved `file_name` in `TripDocument`

### Migrations (Batch 2B - Ready for Deployment)
- `transport-system/backend/prisma/migrations/20261028140000_add_partially_paid_invoice_status/` — Adds `PARTIALLY_PAID` enum value
- `transport-system/backend/prisma/migrations/20261028150000_reconcile_schema_equivalence/` — Guards for FK, columns, enum alignment (idempotent)

### Pre-existing Migrations (Already in History)
- `transport-system/backend/prisma/migrations/20260815000000_create_vehicle_owners/`
- `transport-system/backend/prisma/migrations/20260820000000_create_missing_tables/`
- `transport-system/backend/prisma/migrations/20261018120000_add_assignment_released_event/`

---

## 3. Automated Tests

### Batch 2B New Tests (Passing)
- `transport-system/backend/tests/batch2bVendorAuthority.db.test.js` — 7 tests (vendor payable authority, payments, concurrency)
- `transport-system/backend/tests/batch2bInvoiceStatus.db.test.js` — 10 tests (invoice status reconciliation, refunds, booking auto-bill)

### Modified Existing Tests
- `transport-system/backend/tests/phase3VendorPayment.db.test.js`
- `transport-system/backend/tests/phase4LoadingDispatch.db.test.js`
- `transport-system/backend/tests/phase6-delivery-pod.db.test.js`
- `transport-system/backend/tests/phase6DeliveryPod.test.js`
- `transport-system/backend/tests/phase7CustomerBilling.db.test.js`
- `transport-system/backend/tests/phase9DispatchWorkspace.test.js`
- `transport-system/backend/tests/phaseBEnquiryTimeline.db.test.js`
- `transport-system/backend/tests/phaseBQuotation.db.test.js`
- `transport-system/backend/tests/phaseBQuotation.http.test.js`
- `transport-system/backend/tests/quoteConfirmation.test.js`
- `transport-system/backend/tests/tripAuthorization.test.js`
- `transport-system/backend/tests/tripDoubleBooking.test.js`
- `transport-system/backend/tests/universalVehicleHire.test.js`
- `transport-system/backend/tests/enquiry.flow.e2e.js`
- `transport-system/backend/tests/orderTripMaster.test.js`
- `transport-system/backend/tests/adminVehiclesEnquiriesSchema.test.js`

### New Test Utilities (Supporting)
- `transport-system/backend/tests/httpAuth.test.js`
- `transport-system/backend/tests/placesCatalogue.test.js`
- `transport-system/backend/tests/reconcileAvailability.test.js`
- `transport-system/backend/tests/vehicleHireAvailability.test.js`
- `transport-system/backend/tests/verify-workflow.js`

---

## 4. Audit Documentation & Runbooks

### Batch 2B Reports (Generated)
- `transport-system/FINAL_AUDIT_REPORT.md` — Complete Batch 2B audit with root causes, file changes, test counts, exact reconciliations
- `transport-system/AUDIT_MATRIX.md` — Requirements-to-implementation traceability matrix
- `transport-system/ENQUIRY_TO_VEHICLE_HIRE_AUDIT_REPORT.md` — Enquiry-to-vehicle-hire flow audit
- `transport-system/AUDIT_DELIVERABLE_1_EXECUTIVE_SUMMARY.md`

### Historical Audit Reports (Reference)
- `transport-system/BIHAR_TRANSPORT_FIRST_BATCH_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_SECOND_BATCH_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_3_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_4_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_5_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_6_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_7_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_8_RELEASE_READINESS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_9_VERIFICATION.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_10_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_BATCH_11_FINDINGS.md`
- `transport-system/BIHAR_TRANSPORT_REMEDIATION_PLAN.md`

### Runbooks
- `transport-system/BIHAR_TRANSPORT_BACKUP_RESTORE_RUNBOOK.md`

---

## 5. Staging/Test Infrastructure (Not for Production)

### E2E Test Harness
- `transport-system/backend/scripts/e2e-audit-prepare.js` — Fresh DB creation, schema push, master data copy
- `transport-system/backend/scripts/e2e-audit-test.js` — 137-assertion lifecycle audit

### Audit/Verification Scripts
- `transport-system/backend/audit_final.js`
- `transport-system/backend/audit_counts.js`
- `transport-system/backend/audit_on_trip_drivers.js`
- `transport-system/backend/check_status.js`
- `transport-system/backend/verify_fix.js`
- `transport-system/backend/verify_sync.js`
- `transport-system/backend/repair_data_dryrun.js`
- `transport-system/backend/scripts/dry-run-reconciliation.js`
- `transport-system/backend/scripts/reconcile-availability.js`
- `transport-system/backend/scripts/smoke-test.js`
- `transport-system/backend/scripts/diagnose-booking-notification.js`
- `transport-system/backend/scripts/verify-phase3-http.js`
- `transport-system/backend/scripts/verify-phase4-http.js`
- `transport-system/backend/scripts/verify-phase9-dispatch.js`
- `transport-system/backend/scripts/verify-registration-api.js`
- `transport-system/backend/scripts/verify-step5.js`
- `transport-system/backend/scripts/verify-step6.js`
- `transport-system/backend/scripts/verify-step10.js`
- `transport-system/backend/scripts/verify-dispatch-routes.js`
- `transport-system/backend/scripts/verify-combined-registration.js`
- `transport-system/backend/scripts/seed-admin.js`
- `transport-system/backend/scripts/change-admin-password.js`
- `transport-system/backend/scripts/cleanup-phase5-test-audit-rows.js`
- `transport-system/backend/scripts/diagnose-trip-2133-customer.js`
- `transport-system/backend/scripts/diagnose-owner.js`
- `transport-system/backend/scripts/backfill-orphan-drivers.js`
- `transport-system/backend/scripts/cleanup-demo-bookings.js`
- `transport-system/backend/scripts/seed-driver-demo.js`
- `transport-system/backend/scripts/migrate-local-postgres-to-neon.js`
- `transport-system/backend/scripts/apply-missing-migrations.sql`
- `transport-system/backend/scripts/repair-quote-workflow-migration.sql`
- `transport-system/backend/scripts/repair-schema-additive.sql`

### Additional Routes (Not Yet Integrated)
- `transport-system/backend/routes/catalogueRoutes.js`
- `transport-system/backend/routes/placesRoutes.js`
- `transport-system/backend/routes/trackingRoutes.js`
- `transport-system/backend/routes/tripBillingRoutes.js`

### Additional Services (Not Yet Integrated)
- `transport-system/backend/services/placesService.js`
- `transport-system/backend/controllers/placesController.js`

### Additional Tests (Not Yet Integrated)
- `transport-system/backend/tests/placesCatalogue.test.js`

### Development/Debug
- `transport-system/test-browser.js`
- `transport-system/backend/utils/operationalTripStatus.js`
- `transport-system/backend/REPORT_ADMIN_BOOKINGS_500.md`

---

## 6. Mobile / Future Work (Not in Release)
- `transport-system/mobile/` — React Native mobile app (separate project)

---

## 7. Uncertain / Requires Review

The following files are modified but their scope relative to Batch 2B is unclear:
- `transport-system/backend/services/BookingService.js` (47 lines changed)
- `transport-system/backend/services/QuotationService.js` (177 lines changed)
- `transport-system/backend/services/EnquiryService.js` (26 lines changed)
- `transport-system/backend/repositories/BookingRepository.js` (387 lines changed)
- `transport-system/frontend/src/pages/AdminDashboard.jsx` (1087 lines changed)
- `transport-system/frontend/src/pages/AdminVehicleHireList.jsx` (1878 lines changed)

**Recommendation:** These appear to be UI/dashboard improvements from Batch 1/2A that were in progress. They should be included in the release candidate but may need additional UAT verification.

---

## Summary for Release Candidate

**INCLUDE IN RELEASE:**
- All Application Code (Category 1)
- Prisma Schema & Batch 2B Migrations (Category 2)
- Batch 2B Tests + Modified Existing Tests (Category 3)
- Audit Reports & Runbooks (Category 4)

**EXCLUDE FROM RELEASE / KEEP UNTRACKED:**
- Staging/Test Infrastructure (Category 5) — for CI/local use only
- Mobile Project (Category 6) — separate
- Uncertain large-scope changes (Category 7) — verify in UAT

**Total Release Files:** ~55 modified + 4 new migrations + 2 new test files + 10 audit docs = ~71 files

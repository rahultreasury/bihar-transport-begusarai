# BIHAR TRANSPORT — BATCH 3 FINDINGS
**Date:** 2026-10-23  
**Branch:** main (up to date with origin/main)  
**Baseline Commit:** Working tree has 50+ modified files from prior work (see git status)  
**Test Baseline:** 120 core tests pass (phaseBQuotation, enquiryVehicleReservation, universalVehicleHire, phaseBEnquiryTimeline)

---

## 1. Current Git State

**Modified Files (Batch 2 Changes):**
- `transport-system/backend/services/QuotationService.js` — 3 sync points added
- `transport-system/backend/repositories/BookingAssignmentRepository.js` — `_syncToTrip` method + 2 call sites

**Pre-existing Modified Files (50+ files from prior work):**
- Controllers, routes, services, schema, tests, frontend components

**Untracked Files:**
- `BIHAR_TRANSPORT_FIRST_BATCH_FINDINGS.md`
- `BIHAR_TRANSPORT_REMEDIATION_PLAN.md`
- `BIHAR_TRANSPORT_SECOND_BATCH_FINDINGS.md`
- Various audit reports and test files

---

## 2. Verified Status of Batch 2 Changes

### QuotationService.js — Status Mapping Sync
| Fix | Location | Behavior Verified |
|-----|----------|-------------------|
| Sync `enquiry.price_status` on save | `saveQuotation()` line 761 | DRAFT/RATE_QUOTED → `price_status='QUOTED'` |
| Fix `sendQuotation` price_status | `sendQuotation()` line 934 | Changed hardcoded 'QUOTED' → 'SENT' |
| Sync `enquiry.price_status` on convert | `confirmOrder()` line 1130 | CONVERTED → `price_status='ACCEPTED'` |

**Status Mapping Established:**
| Quotation.status | Enquiry.price_status | Customer Visible? |
|------------------|---------------------|-------------------|
| DRAFT | QUOTED | No |
| RATE_QUOTED | QUOTED | No |
| SENT | SENT | Yes |
| CONVERTED | ACCEPTED | Yes |

**Protection Verified:**
- `assertEditable()` prevents editing CONVERTED quotations (line 504-511)
- `sendQuotation()` rejects CONVERTED quotations (line 880-884)
- `confirmOrder()` requires SENT or CONVERTED status (line 993-996)
- Idempotency: duplicate sends/confirms return existing state

### BookingAssignmentRepository.js — Trip Sync
| Fix | Location | Behavior Verified |
|-----|----------|-------------------|
| Sync driver assignment | `assignDriver()` line 33 | Calls `_syncToTrip()` with driverId |
| Sync vehicle assignment | `assignVehicle()` line 64 | Calls `_syncToTrip()` with vehicleId |
| New `_syncToTrip()` method | Lines 118-145 | Finds Trip by booking_id, validates assignable statuses, updates driver_id/vehicle_id |

**Assignable Trip Statuses (mirrors TripVehicleAssignmentService):**
- PENDING
- ASSIGNED
- TO_LOADING_POINT
- AT_LOADING_POINT

**Behavior Verified:**
- Only syncs if Trip exists for the booking
- Only syncs if Trip status is in assignable list
- Does not create Trip implicitly
- Runs in same transaction as BookingAssignment creation
- Preserves existing Trip assignment if only one resource provided

**Gap Identified:** Legacy admin booking assign endpoints in `adminRoutes.js` (lines 2212, 2609) use raw Prisma transactions and do NOT call `BookingAssignmentRepository`, so `_syncToTrip` is not invoked from those paths.

---

## 3. Route-by-Route Authorization Audit

### Audited & Secure ✅

| Route File | Auth Pattern | Ownership Check | Notes |
|------------|--------------|-----------------|-------|
| `partnerSelfServiceRoutes.js` | `protect` → `attachPartner` | All queries scoped to `req.partner.partner_id` | ✅ |
| `partnerRoutes.js` | `protect` → `adminCheck` | Admin-only | ✅ |
| `partnerSettlementRoutes.js` | `protect` → `adminCheck` | Admin-only | ✅ |
| `partnerApplicationRoutes.js` | Public `/apply` + `adminCheck` | Public apply + admin review | ✅ |
| `driverRoutes.js` | `protect` | Verifies driver via `req.user.user_id`; checks booking ownership | ✅ |
| `driverEnquiryRoutes.js` | `protect` | `driverFrom(req)` resolves driver; filters by `assigned_driver_id` | ✅ |
| `vehicleHireRoutes.js` | `protect` → `adminOnly` | Admin-only | ✅ |
| `dispatchRoutes.js` | `protect` → `adminOnly` | Admin-only | ✅ |

### Authorization Gaps ⚠️

| Route File | Issue | Severity |
|------------|-------|----------|
| `tripRoutes.js` GET `/:id` | Uses `protect` but NOT `adminOnly`; `TripService.getTripById()` doesn't use `user` param for authorization | **HIGH** — Any authenticated user can read any trip by ID |
| `adminRoutes.js` booking assign endpoints | Use raw Prisma, bypass `BookingAssignmentRepository._syncToTrip()` | **MEDIUM** — Trip not synced from legacy admin assign |
| `tripRoutes.js` GET `/` | Uses `protect` but no role check; returns all trips with pagination | **MEDIUM** — May expose trips across partners |

### Cross-Partner Negative Tests Needed
- Partner A accessing Partner B's trips via ID manipulation
- Partner A accessing Partner B's vehicles/drivers via ID manipulation
- Driver A accessing Driver B's bookings via ID manipulation
- Customer accessing another customer's enquiry via ID manipulation

---

## 4. Database and Migration Safety Audit

### Migration Status
- **44 migrations** found in `prisma/migrations`
- **Database schema is up to date** (verified via `npx prisma migrate status`)
- All migrations are additive (no destructive operations observed)

### Repair Scripts (Additive-Only ✅)
| Script | Purpose | Safety |
|--------|---------|--------|
| `repair-quote-workflow-migration.sql` | Repairs missing quote workflow migrations | Additive-only, preserves legacy columns |
| `repair-schema-additive.sql` | Repairs all missing objects | Guarded with `IF NOT EXISTS` / `DO` blocks |

### Schema Drift Risks
| Risk | Status |
|------|--------|
| Legacy vehicle columns in `bookings` (`vehicle_id`, `driver_id`) | Preserved per repair script decision; Prisma ignores unknown columns |
| Legacy `VehicleStatus`, `VehicleType` enums | Preserved; not referenced by current schema |
| Partial unique indexes not in `schema.prisma` | `financial_tx_customer_payment_reference_key`, `trip_financials_booking_id_unique` — documented in migration comments |

### Backup/Restore
- No automated backup/restore procedures documented
- Migration lock file exists: `prisma/migrations/migration_lock.toml`

---

## 5. Regression Test Results

### Core Tests (All Pass ✅)
| Test Suite | Tests | Pass | Fail | Duration |
|------------|-------|------|------|----------|
| phaseBQuotation.db.test.js | 50 | 50 | 0 | ~4.7s |
| enquiryVehicleReservation.test.js | 18 | 18 | 0 | ~0.6s |
| universalVehicleHire.test.js | 35 | 35 | 0 | ~0.5s |
| phaseBEnquiryTimeline.db.test.js | 17 | 17 | 0 | ~3.7s |
| **Total** | **120** | **120** | **0** | **~9.5s** |

### Pre-existing Failures (Not Introduced by Batch 2/3)
| Test Suite | Failures | Status |
|------------|----------|--------|
| tripDoubleBooking.test.js | 10 failures (STEP 2B advisory locks) | **Pre-existing** — advisory lock implementation incomplete |
| phase8VehicleHireFlow.test.js | 2 failures (inactive vehicle/driver gates) | **Pre-existing** — validation not implemented in VehicleHireWorkflowService |

**Verification:** Core 120 tests pass. Failures are in unrelated test suites and existed before Batch 2/3 changes.

---

## 6. Confirmed Defects and Severity

| Defect ID | Description | Severity | Status |
|-----------|-------------|----------|--------|
| **DEF-001** | Trip GET `/:id` lacks resource-level authorization | **HIGH** | Unfixed |
| **DEF-002** | Legacy admin booking assign endpoints bypass Trip sync | **MEDIUM** | Unfixed |
| **DEF-003** | Trip list GET `/` lacks partner scoping | **MEDIUM** | Unfixed |
| **DEF-004** | Advisory lock implementation incomplete (STEP 2B) | **MEDIUM** | Pre-existing |
| **DEF-005** | Inactive vehicle/driver validation missing in VehicleHireWorkflowService | **MEDIUM** | Pre-existing |
| **DEF-006** | Legacy vehicle columns/enums preserved in DB | **LOW** | Documented |

---

## 7. Smallest Safe Remediation Plan

### Immediate (No Business Decision Required)
| Fix | Files | Risk |
|-----|-------|------|
| Add resource-level authorization to `TripService.getTripById()` | `TripService.js`, `tripRoutes.js` | Low |
| Add partner scoping to `TripService.getAllTrips()` | `TripService.js`, `tripRoutes.js` | Low |
| Wire legacy admin booking assign endpoints to use `BookingAssignmentService` | `adminRoutes.js`, `adminBookingController.js` | Medium |

### Requires Business Decision
| Decision | Options |
|----------|---------|
| Canonical quote path | Phase B (Enquiry/Quotation) vs Legacy Booking quotes |
| Status list authority | Header diagram vs §29 table in client doc |
| GST/RCM arithmetic | Add to total or display-only? |
| Three assignment writers | Consolidate to TripVehicleAssignmentService or add cross-validation |

### Pre-existing (Defer)
- Advisory lock implementation (STEP 2B)
- Inactive vehicle/driver validation in VehicleHireWorkflowService
- Legacy column/enum cleanup

---

## 8. Exact Test Commands and Outcomes

```bash
# Core regression tests (ALL PASS)
cd transport-system/backend
node --test tests/phaseBQuotation.db.test.js
node --test tests/enquiryVehicleReservation.test.js
node --test tests/universalVehicleHire.test.js
node --test tests/phaseBEnquiryTimeline.db.test.js
# Result: 120 pass, 0 fail

# Pre-existing failures (unrelated to changes)
node --test tests/tripDoubleBooking.test.js
# Result: 10 fail (advisory locks)

node --test tests/phase8VehicleHireFlow.test.js
# Result: 2 fail (inactive vehicle/driver gates)

# Migration status
npx prisma migrate status
# Result: "Database schema is up to date!"
```

---

## 9. Remaining Production Blockers

| Blocker | Type | Resolution Path |
|---------|------|-----------------|
| **Trip authorization gap** | Security | Add resource-level checks in TripService |
| **Partner trip scoping** | Security | Add partner_id filtering in TripService.getAllTrips |
| **Legacy admin assign → Trip sync** | Data integrity | Wire adminRoutes to BookingAssignmentService |
| **Canonical quote path** | Business | Client must confirm Phase B is canonical |
| **Status list authority** | Business | Client must confirm §29 authoritative list |
| **GST/RCM arithmetic** | Business | Client must confirm GST treatment |
| **Advisory locks** | Technical | Complete STEP 2B implementation |
| **Backup/restore procedures** | Operational | Document and test restore |

---

## 10. Recommended Next Step

**Do not deploy.** Present findings for review. Priority order for next batch:

1. **Fix Trip authorization gaps** (DEF-001, DEF-003) — security critical
2. **Wire legacy admin assign to Trip sync** (DEF-002) — data integrity
3. **Get business decisions** on canonical quote path, status list, GST
4. **Complete partner isolation audit** for remaining routes
5. **Add cross-partner negative tests** to test suite
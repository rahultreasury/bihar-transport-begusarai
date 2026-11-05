# Bihar Transport — End-to-End Enquiry → Vehicle Hire → Customer Acceptance → Booking Audit Report

**Date:** 2026-10-18  
**Scope:** Comprehensive repository-based audit of the complete transport request lifecycle  
**Status:** AUDIT COMPLETE — No code changes made

---

## 1. Overall Verdict

**PARTIALLY WORKING** with clear, intentional separation of concerns between (a) customer quotation (Enquiry/Quotation domain) and (b) vendor vehicle hire (Trip/VehicleHire domain). The core architecture is sound: Trip is the canonical operational record, Booking is created on acceptance with idempotency guarantees, and Vehicle Hire is connected to Trip. However, the integration points need verification through end-to-end testing.

### Key Findings:
- ✅ Idempotency and duplicate-prevention logic exist in `EnquiryService.customerAccept()` (status-based claim + release on failure)
- ✅ Trip provisioning is idempotent and transaction-safe via `TripProvisioningService.ensureTripForEnquiry/Booking`
- ✅ Vehicle/driver assignment is canonicalized to Trip via `TripVehicleAssignmentService`
- ✅ Quotation is the authoritative source for customer-facing amounts (persisted backend)
- ⚠️ The workflow splits customer quote (in Enquiry/Quotation) from vendor hire (in Vehicle Hire workspace) — this is by design per codebase architecture, not a defect
- ⚠️ End-to-end runtime verification (steps A–M from task) was not executed as part of this static audit (requires live DB/API)

---

## 2. Confirmed Working Steps (From Code Evidence)

| Step | Evidence | Status |
|---|---|---|
| 1. Customer submits enquiry | `enquiryController.create()` ([110-147](transport-system/backend/controllers/enquiryController.js#L110-L147)), `EnquiryService.createEnquiry()` ([232-452](transport-system/backend/services/EnquiryService.js#L232-L452)), `Enquiry` Prisma model | **VERIFIED** — Persisted via Prisma with validation, audit events, timeline |
| 2. Enquiry persisted in PostgreSQL | `EnquiryRepository` patterns, transactions in `EnquiryService` | **VERIFIED** — Uses Prisma with Neon/Postgres |
| 3. Enquiry appears in Admin Enquiries list | Admin routes/controllers query enquiries; frontend lists them | **VERIFIED** — Admin enquiries API exists |
| 4. Admin opens enquiry detail/workspace | [`AdminEnquiryWorkspace.jsx`](transport-system/frontend/src/pages/AdminEnquiryWorkspace.jsx) loads enquiry with quote, timeline, booking, reservation | **VERIFIED** |
| 5. Admin clicks Assign Vehicle & Driver | [`VehicleHireStatusCard.jsx`](transport-system/frontend/src/components/admin-premium/enquiries/VehicleHireStatusCard.jsx#L157-167) provisions trip via `POST /api/vehicle-hire/provision` | **VERIFIED** — Calls `TripProvisioningService.ensureTripForEnquiry()` |
| 6. Navigates to Vehicle Hire workspace | Provision returns trip_id; card navigates to hire route via [`hireHandoff.js`](transport-system/frontend/src/components/admin-premium/enquiries/hireHandoff.js) | **VERIFIED** — Uses `hireRouteFor(assignment.trip_id)` |
| 7. Vehicle Hire loads correct context | [`VehicleHireWorkflowService.getContext(tripId)`](transport-system/backend/services/VehicleHireWorkflowService.js) joins trip, booking, enquiry, vehicle, driver, owner | **VERIFIED** |
| 8-9. Admin assigns vehicle/driver and sets hire terms | [`VehicleHireWorkspace.jsx`](transport-system/frontend/src/components/admin-premium/trips/process/VehicleHireWorkspace.jsx) posts to `POST/PUT /api/vehicle-hire` (or assign endpoints); written via [`TripVehicleAssignmentService.assign()`](transport-system/backend/services/TripVehicleAssignmentService.js) | **VERIFIED** — Assignment is canonical to Trip |
| 10. Quote persisted and sent from backend | [`QuotationService.saveQuotation()`](transport-system/backend/services/QuotationService.js#L530-745), [`sendQuotation()`](transport-system/backend/services/QuotationService.js#L860-957). Frontend QuotationEditor calls admin quotation APIs | **VERIFIED** — Quotation is separate canonical record linked to enquiry |
| 11-13. Customer acceptance creates Booking + Trip link | [`EnquiryService.customerAccept()`](transport-system/backend/services/EnquiryService.js#L1146-1350) does atomic claim, checks idempotency, calls `_createBookingFromEnquiry()` ([1723-1797](transport-system/backend/services/EnquiryService.js#L1723-L1797)), links trip where `booking_id IS NULL` ([1274](transport-system/backend/services/EnquiryService.js#L1274)) | **VERIFIED** — Single logical booking created; trip linked exactly once |
| 14. Consistency across workspaces | Booking appears in Bookings list (queries Booking table), Trip appears in Vehicle Hire list (queries trips via VehicleHireWorkflowService). Connected via `Booking.trips` and `Trip.booking_id` | **VERIFIED** — Same entity, different views |

---

## 3. Missing or Broken Steps — Analysis

No confirmed code-level defects found. However, the following require runtime verification:

| Potential Issue | Root Cause Hypothesis | Evidence | Action Needed |
|---|---|---|---|
| **Navigation ID consistency** | Ensure provision returns correct trip_id and frontend navigates with it | [VehicleHireStatusCard provision flow](transport-system/frontend/src/components/admin-premium/enquiries/VehicleHireStatusCard.jsx#L103-148) uses `hireRouteFor(assignment.trip_id)` | E2E test: assign → confirm Vehicle Hire loads correct trip context (not wrong ID) |
| **Assignment mirroring between Enquiry and Trip** | Enquiry mirrors assignment fields for UI; Trip is canonical. Sync happens in [`adminAssign()`](transport-system/backend/services/EnquiryService.js#L621-835) — throws on trip sync failure (fail-safe) | Lines 820-827: throws if trip assignment fails after enquiry commit — prevents partial state | Verify no stale mirror if trip sync fails; behavior is "fail loudly" which is correct |
| **Quote visibility vs acceptance** | Customer quote visibility gated by quotation status (`SENT`/`CONVERTED`) and also enquiry state. Acceptance requires quote to be sent/accepted conditions | [`isQuoteVisibleToCustomer()`](transport-system/backend/utils/EnquiryStateMachine.js#L234-243), [`getQuotationForCustomer()`](transport-system/backend/services/QuotationService.js#L788-837) | Test: quote sent → visible to customer; draft → not visible |
| **Resource conflicts on acceptance** | Acceptance checks reserved resources still free via `_assertReservedResourcesStillFree()` | [EnquiryService.customerAccept() calls it](transport-system/backend/services/EnquiryService.js#L1151, context) | E2E: simulate conflict between reservation and acceptance |

**Conclusion:** No broken steps identified in static analysis. Architecture matches the specified workflow.

---

## 4. Data Model and Identifier Map

Canonical identifiers and relationships from schema ([schema.prisma](transport-system/backend/prisma/schema.prisma)):

| Concept | Model | PK | Key Fields | Relations |
|---|---|---|---|---|
| **Enquiry** | `Enquiry` | `enquiry_id` (Int) | `enquiry_number` (String), `status` (Enum), `customer_id`, `final_quoted_price`, `quotation_id`, `booking_id` (nullable), `trip_id` (nullable), `assigned_vehicle_id`, `assigned_driver_id`, `assigned_transport_owner_id`, `vehicle_hire_id` (nullable) | → `Quotation` (1:1), → `Booking` (1:1 nullable), → `Trip` (1:1 nullable), → `VehicleHire` (1:1 nullable) |
| **Quotation** | `Quotations` | `quotation_id` (Int) | `quotation_number`, `enquiry_id` (unique FK), `status` (DRAFT/RATE_QUOTED/SENT/CONVERTED), `total_billing_amount`, `freight`, `gst_*`, `validity_days`, `sent_at`, `confirmed_at` | → `Enquiry` (1:1), has `quotation_charges[]`, `quotation_milestones[]` |
| **Booking** | `Booking` | `booking_id` (Int) | `booking_number` (String), `enquiry_id` (nullable FK), `final_price`, `booking_status`, `customer_id`, `trip_id` (denormalized in some flows) | → `Enquiry` (1:1), → `Trip[]` (1:N), has timeline/events |
| **Trip** | `Trip` | `trip_id` (Int) | `trip_number`, `enquiry_id` (nullable unique), `booking_id` (nullable), `status` (Enum), `vehicle_id`, `driver_id`, `transport_owner_id`, `customer_id`, `vehicle_hire_id` (nullable) | → `Booking` (M:1), → `Enquiry` (1:1), → `VehicleHire` (1:1 nullable) |
| **VehicleHire** | `VehicleHire` | `vehicle_hire_id` (Int) | `trip_id` (FK), `enquiry_id` (nullable), `booking_id` (nullable), `vehicle_id`, `vendor_id` (transport_owner), `driver_id`, `gross_hire`, `commission_amount`, `net_vendor_payable`, `billing_to`, `rate_basis`, `payment_status` | → `Trip` (1:1), → `Enquiry` (1:1), → `Booking` (1:1) |

**Identifier Consistency Rules:**
- After acceptance: `Enquiry.booking_id` is set; `Enquiry.trip_id` may be set; `Trip.booking_id` is set (or Trip linked); `Booking` exists with `enquiry_id` FK. 
- Trip is canonical operational record — assignment lives on Trip. Enquiry mirrors assignment fields for UX; services sync them.
- Quotation is 1:1 with Enquiry and is the authoritative customer quote. Never created as parallel competing implementation.

---

## 5. Status Transition Table: Expected vs Actual (Code-Level)

| Transition | Trigger | Backend Endpoint/Service | Persisted DB Changes | Resulting Status | Enquiries List | Vehicle Hire | Bookings | Customer App |
|---|---|---|---|---|---|---|---|---|
| **ENQUIRY_CREATED → ADMIN_REVIEW** | Admin clicks "Start Reviewing" | `adminEnquiryController.update()` or assign flow; [`updateEnquiry()`](transport-system/backend/services/EnquiryService.js) | `Enquiry.status = 'ADMIN_REVIEW'`, timeline event | `ADMIN_REVIEW` | Shows under review | Trip may not exist yet (unless provisioned) | Not visible (no booking) | Enquiry state reflects |
| **ADMIN_REVIEW → ASSIGNED (resources reserved)** | Click "Assign Vehicle & Driver" from Enquiry | `POST /api/vehicle-hire/provision` → `TripProvisioningService.ensureTripForEnquiry()`; then assignment via Vehicle Hire workspace or `EnquiryService.adminAssign()` | Trip created if missing (idempotent), `Enquiry.assigned_*` set, `Trip` gets assignment (mirrored), reservation recorded if any | `ASSIGNED`/`VEHICLE_ASSIGNED` per state machine ([EnquiryStateMachine](transport-system/backend/utils/EnquiryStateMachine.js)) | Shows assigned | Trip appears in Vehicle Hire list (context loads) | No booking | Shows assignment info per privacy rules |
| **ASSIGNED → QUOTE_READY/RATE_QUOTED** | Admin saves quotation | `POST /api/quotations/:enquiryId/save` → `QuotationService.saveQuotation()` | Quotation created/updated (DRAFT/RATE_QUOTED), charges/milestones stored, `Enquiry.quotation_id` linked | `QUOTE_READY`/`RATE_QUOTED` (state depends on flow) | Updated | Trip context unchanged | No booking | Draft not visible to customer |
| **RATE_QUOTED → AWAITING_CUSTOMER_ACCEPTANCE** | Admin sends quotation | `POST /api/quotations/:enquiryId/send` → `QuotationService.sendQuotation()` | Quotation.status='SENT', `sent_at`, `sent_by_admin_id`; totals re-derived server-side. Enquiry status updated per state machine | `AWAITING_CUSTOMER_ACCEPTANCE` | Shows awaiting acceptance | Trip visible with assignment | No booking | **Customer sees quote** (gated by SENT/CONVERTED) |
| **AWAITING_CUSTOMER_ACCEPTANCE → CUSTOMER_ACCEPTED/CONFIRMED** | Customer accepts quote (auth/guest token) | `POST /api/enquiries/:id/accept` → `EnquiryService.customerAccept()` | Atomic claim on enquiry (status filter). Create Booking via `_createBookingFromEnquiry()` (single point). Link Trip where `booking_id IS NULL`. Update enquiry status to `CUSTOMER_ACCEPTED`/`CONFIRMED`. Create timeline events. Idempotent: if already accepted, returns existing booking. | `CONFIRMED` (or `CUSTOMER_ACCEPTED` then confirmed) | Shows confirmed/accepted | **Trip appears with booking linked** (same logical entity) | **Booking appears in Bookings list** (new Booking row created once) | Shows confirmed status, booking info per privacy |
| **AWAITING_CUSTOMER_ACCEPTANCE → CUSTOMER_REJECTED** | Customer rejects | `POST /api/enquiries/:id/reject` → `EnquiryService.customerReject()` | Status → `CUSTOMER_REJECTED`, reservation released if any, timeline recorded. **No booking created.** | `CUSTOMER_REJECTED` | Shows rejected | Trip may remain (assignment exists) but no booking; depends on policy | Not created | Shows rejection |
| **CONFIRMED → Operational states (LOADING/DISPATCH etc.)** | Admin advances via Trip/Booking ops | Trip/Booking lifecycle endpoints (dispatch/loading/delivery) — separate from acceptance | Updates Trip.status/Booking lifecycle; **no new Booking/Trip created** | Progresses per Trip state machine | Reflects via relations | **Updates reflected here** (canonical Trip) | **Updates reflected here** (linked to same Trip) | Status updates per rules |

**Note:** The split between "customer quote" (Enquiry/Quotation) and "vendor hire terms" (VehicleHire on Trip) is intentional. Both can be true simultaneously. The state machine controls enquiry status; operational state lives on Trip.

---

## 6. Duplicate-Record Risks

Assessment based on code inspection (high confidence):

| Risk | Assessment | Evidence | Mitigation |
|---|---|---|---|
| **Navigation creates duplicates** | **NONE** — Read-only | Provision endpoint calls `ensureTripForEnquiry()` which checks for existing trip by `enquiry_id` first ([206-231](transport-system/backend/services/TripProvisioningService.js#L206-L231)); transaction re-check prevents races ([237-283](transport-system/backend/services/TripProvisioningService.js#L237-L283)) | Idempotent provision; unique index on `trips.enquiry_id` (partial) prevents duplicates at DB level |
| **Double-click acceptance creates duplicate Booking** | **NONE** — Idempotent | `customerAccept()` does `updateMany` with status filter `['AWAITING_CUSTOMER_ACCEPTANCE', 'QUOTE_SENT']` → if count==0, checks current enquiry status: if already `CUSTOMER_ACCEPTED`/`CONFIRMED`, returns existing booking (lines [1150-1159](transport-system/backend/services/EnquiryService.js#L1150-L1159)) | Status-based claim + early return with existing booking; claim released on booking creation failure ([1214-1229](transport-system/backend/services/EnquiryService.js#L1214-L1229)) |
| **Double-click acceptance creates duplicate Trip** | **NONE** | Trip linking does `where: { enquiry_id: enquiry.enquiry_id, booking_id: null }` ([1274](transport-system/backend/services/EnquiryService.js#L1274)) — only links unlinked trips; never creates new trip | Update-only, constrained by `booking_id IS NULL` |
| **Double send-quote** | **NONE** — Idempotent | `sendQuotation()` returns `alreadySent: true` if status already `SENT` ([891-894](transport-system/backend/services/QuotationService.js#L891-L894)); claim uses conditional update on `status IN ['DRAFT','RATE_QUOTED']` ([897-916](transport-system/backend/services/QuotationService.js#L897-L916)) | Conditional update + status check |
| **Assignment creates duplicates** | **NONE** | [`TripVehicleAssignmentService.assign()`](transport-system/backend/services/TripVehicleAssignmentService.js) upserts/reassigns to the same Trip (canonical). Enquiry mirrors don't create separate assignment entities | Canonical writer on Trip; single source of truth |
| **Duplicate financial records** | **NONE** — Single creation point | Booking created once in `_createBookingFromEnquiry()`; Invoice created at acceptance (per [`InvoiceRepository`](transport-system/backend/repositories/InvoiceRepository.js#L4-L5): "invoice is raised the moment a quote is accepted"). No other paths create bookings from enquiry acceptance | Controlled via service layer; atomic claim prevents races |

**Verdict:** Duplicate-record risks are well-mitigated by design.

---

## 7. Financial Consistency Risks

### Authoritative Sources

| Value | Authoritative | Evidence | Notes |
|---|---|---|---|
| **Final customer quote** | `Quotations.total_billing_amount` (persisted) shown to customer via `getQuotationForCustomer()`; also stored as `Enquiry.final_quoted_price` and propagated to `Booking.final_price` | [`QuotationService.getQuotationForCustomer()`](transport-system/backend/services/QuotationService.js#L788-837) returns persisted values; [`EnquiryService.adminSetQuote()`](transport-system/backend/services/EnquiryService.js#L874-978) sets `final_quoted_price`; [`_createBookingFromEnquiry()`](transport-system/backend/services/EnquiryService.js#L1723-1797) sets `Booking.final_price = enquiry.final_quoted_price` | Customer never sees draft quotes. Server recomputes totals on send/save (lines 883-908 in sendQuotation) — client cannot dictate price |
| **Booking price** | `Booking.final_price` | Set from enquiry's final quoted price at acceptance ([1767](transport-system/backend/services/EnquiryService.js#L1767)) | Consistent with customer quote |
| **Vehicle hire (vendor)** | `VehicleHire.gross_hire`, `commission_amount`, `net_vendor_payable` | [`VehicleHireWorkflowService`](transport-system/backend/services/VehicleHireWorkflowService.js) computes server-side via preview/hire; amounts stored on `VehicleHire` row | **Separate from customer quote.** Correctly treated as operational/vendor terms |
| **Commission** | Split by context: `VehicleHire.commission_*` (vendor/intermediation) vs `Booking.commission_amount` (booking-level) | Different models — by design | No conflation observed |
| **Net vendor payable** | `VehicleHire.net_vendor_payable` | Calculated and stored in VehicleHire | Settlement flows use VehicleHire/settlement modules |
| **Customer payments** | Financial modules (`TripFinancial`, `FinancialTransaction`) | Separate from quote acceptance | Acceptance does **not** auto-mark customer/vendor payments paid — correct |
| **Vendor payments/settlements** | PartnerSettlement/TripSettlement | No writes to settlement status in acceptance flow | Correct — prevents premature payment marking |

### Observations

- ✅ **Server-authoritative:** All quote amounts recomputed from stored charges/milestones on send ([883-908](transport-system/backend/services/QuotationService.js#L883-908)). Totals persisted after re-derivation.
- ✅ **No trust in frontend:** QuotationEditor shows server-returned values; money not computed client-side for persistence ([comment in QuotationEditor](transport-system/frontend/src/components/admin-premium/enquiries/QuotationEditor.jsx#L28-34)).
- ✅ **Separation maintained:** Customer quote ≠ vendor hire cost — correctly modeled as separate entities. No evidence of cross-contamination.
- ✅ **No duplicate financial writes on acceptance:** Single booking creation path; invoice created once.

**Verdict:** Financial consistency is sound. No conflicts in sources of truth identified.

---

## 8. Minimal Fix Plan (Ordered by Dependency & Severity)

No critical defects found. Recommended actions are verification-focused:

| Priority | Item | Root Cause | Minimal Fix | Verification |
|---|---|---|---|---|
| **P0** | **Run full E2E happy path (A–M)** | Static audit only; runtime behavior unverified | Execute scenario with test data: submit enquiry → assign in VH → save/send quote → customer accept → verify both workspaces + IDs | Confirm single Booking, single Trip, correct linkage, no duplicates. Compare DB state after each step. |
| **P0** | **Test idempotency: double-click accept** | Need to confirm early-return path works in practice | Call accept twice rapidly (same guest token/context) | Second call returns `alreadyAccepted: true` with existing booking_id; DB unchanged (no new rows). |
| **P0** | **Test quote rejection** | Ensure no booking created | Reject quote after SENT | Status `CUSTOMER_REJECTED`, no Booking row, reservation released. |
| **P0** | **Test "missing Trip" compatibility** | Provisioning must handle bookings without trips | Create scenario where booking exists without trip (legacy) and call provision or access Vehicle Hire | `ensureTripForBooking()` creates trip and copies assignment if present ([70-171](transport-system/backend/services/TripProvisioningService.js#L70-L171)) |
| **P1** | **Verify assignment mirroring resilience** | If trip assignment fails after enquiry update, must fail loudly | Mock `TripVehicleAssignmentService.assign()` to throw in `adminAssign()` path | Operation throws at [820-827](transport-system/backend/services/EnquiryService.js#L820-827); no partial state (enquiry changes rolled appropriately by transaction) |
| **P1** | **Test resource conflict on acceptance** | `_assertReservedResourcesStillFree()` must prevent booking if conflicted | Simulate vehicle/driver taken between reservation and acceptance | Acceptance fails with actionable error; no Booking created; enquiry remains in pre-accept state |
| **P1** | **Test both workspaces visibility** | Booking must appear in Bookings list; Trip in Vehicle Hire list | After acceptance, query both APIs/lists | Same logical entity: Booking by booking_number visible; Trip by trip_number visible in VH with correct context (customer, route, vehicle, driver, vendor) |
| **P2** | **Quote requires assignment enforcement** | `sendQuotation` checks assignment via `hasRequiredAssignment()`? Or EnquiryService? | Try to send quote without vehicle+driver assigned | Should fail per [`EnquiryService.sendQuote()`](transport-system/backend/services/EnquiryService.js#L998-1120) which checks assignment (1010-1017 in that method) |
| **P2** | **Customer privacy on customer pages** | Ensure no driver/owner private numbers exposed to customer | Inspect customer-facing quote/acceptance responses | [`getQuotationForCustomer()`](transport-system/backend/services/QuotationService.js#L788-837) returns commercial fields only; no internal ops data. Driver/owner private contacts not included. |

**Note:** No code changes required based on audit. Fixes only if runtime tests reveal failures.

---

## 9. Regression Tests Required

Exact scenarios with expected results:

| Test ID | Scenario | Setup | Steps | Expected | Priority |
|---|---|---|---|---|---|
| **RT-001 (Happy Path)** | Full E2E A–M | Clean test enquiry | Submit → Admin assigns via VH → Save quote → Send quote → Customer accept → Check both workspaces → Refresh | All pass; 1 Booking, 1 Trip; IDs linked correctly; consistent data after refresh | **P0** |
| **RT-002 (Idempotent Accept)** | Double accept | Enquiry AWAITING_CUSTOMER_ACCEPTANCE with SENT quote | Call `POST /api/enquiries/:id/accept` twice concurrently/rapidly | 2nd returns `{alreadyAccepted:true, bookingId, ...}`; Booking count unchanged; Trip count unchanged | **P0** |
| **RT-003 (Reject No Booking)** | Quote rejection | SENT quote | `POST /api/enquiries/:id/reject` | Status CUSTOMER_REJECTED; `Booking` does not exist; reservation released (if present) | **P0** |
| **RT-004 (Send Twice Idempotent)** | Double send | RATE_QUOTED quotation | `POST /api/quotations/:id/send` twice | 2nd returns `alreadySent:true`; quotation status still SENT; `sent_at` unchanged (or preserved); no duplicate events | **P0** |
| **RT-005 (Assign Before Accept)** | Provision + assign before quote | Enquiry in ADMIN_REVIEW | Click Assign Vehicle & Driver → VH opens with trip → assign vehicle/driver → save hire | Trip provisioned with `enquiry_id`; assignment on Trip; Enquiry mirrors assignment; acceptance later links Trip to Booking | **P0** |
| **RT-006 (Both Workspaces)** | Cross-workspace visibility | After RT-001 | Query Vehicle Hire list (trips) and Bookings list (bookings) | Same consignment: Trip in VH list with correct context; Booking in Bookings list with same booking_number, customer, route; linked via IDs | **P0** |
| **RT-007 (Missing Trip Provision)** | Legacy booking without trip | Booking exists without Trip, linked to enquiry? | Access Vehicle Hire for related trip/enquiry or call provision | `ensureTripForBooking()` creates Trip, copies assignment if exists; no duplicate | **P1** |
| **RT-008 (Resource Conflict)** | Conflict on accept | Reserve vehicle V for enquiry E1; V becomes unavailable/taken | Customer accepts E1 after conflict | Accept fails with conflict error; no Booking created; state remains safe; retry possible after resolution | **P1** |
| **RT-009 (Assignment Sync Failure)** | Trip assignment fails after enquiry update | Mock TripVehicleAssignmentService.assign() to throw in adminAssign | Admin assigns vehicle/driver | Throws error; operation fails; no inconsistent state (transaction handling per code) | **P1** |
| **RT-010 (Claim Release on Failure)** | Booking creation fails after claim | Mock BookingService/create to fail after claim acquired | Accept quote | Claim released ([1214-1229](transport-system/backend/services/EnquiryService.js#L1214-L1229)); enquiry can be retried later | **P1** |
| **RT-011 (Quote Needs Assignment)** | Send without assignment | Enquiry assigned? No vehicle/driver | Try to send quote | Fails with validation: "Assign vehicle and driver before sending" per [`EnquiryService.sendQuote()`](transport-system/backend/services/EnquiryService.js#L1010-L1017) | **P0** |
| **RT-012 (Refresh Consistency)** | Persistence after refresh | After acceptance | Reload both pages, refetch APIs | All IDs, statuses, assignments, financial values match persisted DB state; no data loss | **P0** |

**Existing test suites to leverage:** [`enquiry.flow.e2e.js`](transport-system/backend/tests/enquiry.flow.e2e.js), [`enquiryVehicleReservation.test.js`](transport-system/backend/tests/enquiryVehicleReservation.test.js), [`phase1OrderTrip.test.js`](transport-system/backend/tests/phase1OrderTrip.test.js), [`universalVehicleHire.test.js`](transport-system/backend/tests/universalVehicleHire.test.js), [`quotation.e2e.test.js`](transport-system/backend/tests/quotation.e2e.test.js) (if present).

---

## 10. Evidence: Files, Functions, Endpoints, DB

### Backend Services (Core)
- [`EnquiryService.js`](transport-system/backend/services/EnquiryService.js) — create (232-452), adminAssign (621-835), adminSetQuote (874-978), sendQuote (998-1120), customerAccept (1146-1350), _createBookingFromEnquiry (1723-1797)
- [`TripProvisioningService.js`](transport-system/backend/services/TripProvisioningService.js) — ensureTripForBooking (70-171), ensureTripForEnquiry (195-283)
- [`TripVehicleAssignmentService.js`](transport-system/backend/services/TripVehicleAssignmentService.js) — canonical assignment writer
- [`VehicleHireWorkflowService.js`](transport-system/backend/services/VehicleHireWorkflowService.js) — context, assign/hire, preview
- [`QuotationService.js`](transport-system/backend/services/QuotationService.js) — save (530-745), send (860-957), getForCustomer (788-837), confirm (various)

### Backend Controllers/Routes
- [`enquiryController.js`](transport-system/backend/controllers/enquiryController.js) — create (110-147), accept (routes to service)
- [`adminEnquiryController.js`](transport-system/backend/controllers/adminEnquiryController.js) — assign (198-212), saveQuote/sendQuote (218-265)
- [`enquiryRoutes.js`](transport-system/backend/routes/enquiryRoutes.js) — POST `/` (145), POST `/:id/accept` (161)
- [`adminEnquiryRoutes.js`](transport-system/backend/routes/adminEnquiryRoutes.js) — assign/send/save quote endpoints
- [`vehicleHireRoutes.js`](transport-system/backend/routes/vehicleHireRoutes.js) — provision (252-320), context, trips
- [`quotationController.js`](transport-system/backend/controllers/quotationController.js) — quotation endpoints

### Frontend (Key Components/Pages)
- [`AdminEnquiryWorkspace.jsx`](transport-system/frontend/src/pages/AdminEnquiryWorkspace.jsx) — Enquiry workspace (read-only quote display; directs to VH for quoting)
- [`VehicleHireWorkspace.jsx`](transport-system/frontend/src/components/admin-premium/trips/process/VehicleHireWorkspace.jsx) — Vehicle Hire workspace with vendor hire form; **now has Customer Quotation section** (integrated as per feedback)
- [`AdminVehicleHire.jsx`](transport-system/frontend/src/pages/AdminVehicleHire.jsx), [`AdminVehicleHireList.jsx`](transport-system/frontend/src/pages/AdminVehicleHireList.jsx)
- [`VehicleHireStatusCard.jsx`](transport-system/frontend/src/components/admin-premium/enquiries/VehicleHireStatusCard.jsx) — "Assign Vehicle & Driver" → provisions → navigates to VH
- [`QuotationEditor.jsx`](transport-system/frontend/src/components/admin-premium/enquiries/QuotationEditor.jsx) — Quotation UI (save/send/confirm) — integrated into VH workspace
- [`AdminBookings.jsx`](transport-system/frontend/src/pages/AdminBookings.jsx), [`AdminBookingDetail.jsx`](transport-system/frontend/src/pages/AdminBookingDetail.jsx)

### State/Utils
- [`EnquiryStateMachine.js`](transport-system/backend/utils/EnquiryStateMachine.js) — status transitions, visibility gates (234-243 for quote visibility)
- [`EnquiryDTO.js`](transport-system/backend/dtos/EnquiryDTO.js) — customer-facing DTOs

### Database (Schema/Migrations Evidence)
- [`schema.prisma`](transport-system/backend/prisma/schema.prisma) — models: Enquiry, Quotations, Booking, Trip, VehicleHire with relations
- Migrations: [`20260930000000_phase_b_quotation_module/migration.sql`](transport-system/backend/prisma/migrations/20260930000000_phase_b_quotation_module/migration.sql), [`20260930120100_create_vehicle_hires/migration.sql`](transport-system/backend/prisma/migrations/20260930120100_create_vehicle_hires/migration.sql), [`20261003120000_enquiry_trip_reservation/migration.sql`](transport-system/backend/prisma/migrations/20261003120000_enquiry_trip_reservation/migration.sql)

### Tests (For Regression)
- [`enquiry.flow.e2e.js`](transport-system/backend/tests/enquiry.flow.e2e.js)
- [`enquiryVehicleReservation.test.js`](transport-system/backend/tests/enquiryVehicleReservation.test.js)
- [`phase1OrderTrip.test.js`](transport-system/backend/tests/phase1OrderTrip.test.js)
- [`universalVehicleHire.test.js`](transport-system/backend/tests/universalVehicleHire.test.js)

---

## Final Assessment

**Overall Verdict:** **PARTIALLY WORKING**. The implementation is architecturally correct with strong idempotency, transaction safety, and clear separation of concerns. The canonical flow (Enquiry → Trip provision → Vehicle Hire assignment → Quotation → Customer accept → Booking created once → linked to Trip → visible in both workspaces) is properly implemented in code.

**What’s Confirmed Working:** Idempotent acceptance, duplicate prevention, trip provisioning safety, server-authoritative quoting, correct relationships (Trip as operational canonical), and integration of quotation into Vehicle Hire workspace.

**What Needs Verification:** Runtime end-to-end execution of steps A–M against a real/test database. No confirmed defects found in static code inspection.

**Recommendation:** Proceed to runtime verification using the regression test suite (RT-001 through RT-012). Only implement fixes if any of these tests fail. The audit is complete as requested.

---

**Audit conducted by:** Kilo Code (Code mode)  
**Report location:** [`transport-system/ENQUIRY_TO_VEHICLE_HIRE_AUDIT_REPORT.md`](transport-system/ENQUIRY_TO_VEHICLE_HIRE_AUDIT_REPORT.md)  
**Status:** STOP — Awaiting approval before implementing any fixes.
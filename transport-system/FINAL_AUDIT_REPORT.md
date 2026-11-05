# FINAL AUDIT REPORT — Batch 2B: Financial Integrity & End-to-End Verification

**Project:** Bihar Transport (Begusarai) — transport-system (Fleet + Hire dispatch app)
**Batch:** 2B — vendor payable authority, customer invoice reconciliation, invoice API, quotation/timeline integrity, isolated E2E lifecycle
**Audit ID:** BT-AUDIT-20261028-001 (E2E artifact: `transport-system/backend/scripts/e2e-audit-test.js`)
**Report date:** 2026-10-29
**Verdict: READY** (for the Batch 2B scope — after isolated validation, awaiting review. Nothing deployed, nothing committed.)

---

## 1. Executive Summary

Batch 2B closed the two financial-integrity gaps and ran the full lifecycle end-to-end on an isolated throwaway database:

- **Vendor payable is now governed by the accepted VehicleHire**, not the quotation price: ₹50,000 freight → gross hire ₹42,000 → commission ₹2,000 → net payable ₹40,000; three payments totalling ₹30,000 leave **₹10,000 vendor outstanding**; a ₹40,001 over-payment is refused and the refusal leaves no trace.
- **Customer money and vendor money are provably separate.** The trip's customer freight stays ₹50,000 (never overwritten by the vendor net), vendor advances never move customer due, and no vendor money row ever names the customer's invoice.
- **The invoice API (Phase 3) is live, authenticated, idempotent and transactional** — and it closes the *double-bill* hole: for a booking-backed consignment it returns the Phase 7 auto-invoice (booking-linked, `trip_id: NULL`) instead of raising a second document.
- **Invoice status reconciliation is ledger-derived on both status columns** (`payment_status` and the enum `status`), with `paid_at` stamped only when the balance clears, and `PARTIALLY_PAID` moving with cash.
- **Quote-send behaves as one transaction:** enquiry lands on `AWAITING_CUSTOMER_ACCEPTANCE`, exactly one `QUOTE_SENT` event is written, retries are idempotent, and *failed* transitions write nothing.
- **E2E: 137/137 assertions PASS** (`/tmp/e2e8.out`) against a real server on a fresh isolated PostgreSQL database, covering the whole lifecycle plus duplicate/invalid/authorization/rollback checks and post-completion financial invariants.
- Final full suite: **1158 tests — 1100 pass, 14 fail (all pre-existing families, none in Batch 2B scope), 44 skipped (fixture guards)**, up from a 20-failure baseline at the start of this phase.

---

## 2. Root Causes (what was actually broken)

1. **Vendor payable authority was anchored to the wrong price.** The vendor position could fall back to `TRIP_TERMS` (quotation-derived ₹50,000/hire with 5% commission over four figure bands), producing a vendor outstanding of ₹17,500 — a consequence of the completion hire being *refused* by the availability gate rather than a money bug itself. Fixes in the hire-authority path put the accepted `VehicleHire` (₹42,000/₹2,000/₹40,000) on top (`hire_source: VEHICLE_HIRE_RECORD` proves the authority) and un-blocked the hire itself (root cause 5 and 8).

2. **The booking-bill blind spot (double-bill).** `TripInvoiceService` looked for existing invoices by `trip_id` only. The Phase 7 auto-invoice is created at order confirmation — *before any trip exists* — so it carries `booking_id` with `trip_id: NULL` and was invisible to the trip lookups. Pressing "Create Invoice" on a booking-backed trip raised a *second* document and hit the per-booking unique index (`invoices_booking_id_key` → P2002) instead of returning the bill the operator already had. Fixed in `createInvoice`, `getInvoiceForTrip` **and** `recordCustomerPayment` (all three doors now reach the booking bill); the API returns the existing document (`created:false`) and never rewrites it.

3. **Refunded receipts were counted as money-in.** `reconcileInvoiceStatus` and `getPosition` excluded only `CANCELLED` ledger rows, while the canonical due-check excludes both `CANCELLED` and `REFUNDED`. A refunded partial payment would leave the document claiming money the ledger had already given back. Both now use `status: { notIn: ['CANCELLED','REFUNDED'] }` — the document can no longer contradict the canonical layer.

4. **The Prisma create-input FK-scalar rule broke every customer receipt at `/trips/:id/payments` (HTTP 500).** When a `create` mixes relation arguments (`tripFinancial: { connect }`, `trip: { connect }`), Prisma selects the checked `CreateInput`, in which bare FK scalars are not writable. `TripService.addPayment` stamped `invoice_id` as a scalar alongside those relations → "Unknown argument `invoice_id`"-class failure on every payment. Fixed with the relation form `invoices: { connect: { invoice_id } }` (this is also why the canonical `recordClientPayment` stamps by post-create `update` — that discovery recurred and is now documented at the write site).

5. **The engaged-driver availability gate refused a trip's own driver.** The enquiry-assignment path legitimately marks the assigned driver `is_available:false / on_trip`; the hire gate then refused *exactly the driver THE trip had already paired*, forcing the `TRIP_TERMS` fallback (root cause 1's trigger) and producing the wrong vendor money. Fixed in `VehicleHireWorkflowService.checkDriverUsable`: unavailability is tolerated **only** when the driver is the trip's own driver AND his status is an engaged status (`on_trip`/`assigned`) — the mirror of the existing vehicle rule; inactive statuses are still refused.

6. **Stale E2E contract (audit-side, not product).** The audit script's STEP 11 expected one timeline event *per status*; the deployed chain writes a single `status_changed` event carrying from/to metadata (`previousStatus/newStatus` + `from/to/operation` dual vocabulary). The script was aligned; the dual metadata vocabulary is kept for consumer compatibility (no migration needed).

7. **Audit isolation was missing.** First E2E runs inherited busy master state (`driver unavailable`, expired vehicle documents) and un-advanced PK sequences (copied ids without `setval` collided on the first customer creation — the very first `confirm-order` 500 was a `users` unique violation). The harness contract is now `scripts/e2e-audit-prepare.js --fresh`: drop/recreate the throwaway DB → `prisma db push` → copy masters read-only from the dev DB → advance sequences → roll document expiries → force availability.

8. **The POD gate's address.** The completion POD enforcement lives on `POST /api/trips/:id/complete` (TripDeliveryService). The generic `PATCH /:id/status` is the admin's documented legacy bypass and accepts a DELIVERED→COMPLETED move. The E2E asserts the refusal at the real gate (and that the refusal writes no timeline event), then completes through it.

9. **A parallel-suite coupling class in the test estate.** The shared throwaway DB runs suites concurrently, so table-wide counts are not stable observations: phase 4's "foreign trips untouched" population-count assertions and phase 6's global `financialSnapshot` collided with siblings' legitimate writes. And phase 6 *cloned foreign donor trips* (owner/vehicle/driver of whatever sibling was mid-flight), which surfaced as a cross-suite FK failure in `phase3VendorPayment.db` teardown (`trips_vehicle_id_fkey`). Fixes: phase 4 asserts per-row; phase 6 scopes `financialSnapshot` to the consignment's keys and seeds its **own** owner→vehicle→user→driver→trip chain (no donor cloning at all).

---

## 3. Files Changed (Batch 2B, all uncommitted)

**Product code**
| File | Change |
|---|---|
| `backend/services/TripInvoiceService.js` | Booking-bill fallbacks in `createInvoice` / `getInvoiceForTrip` / `recordCustomerPayment`; `REFUNDED` exclusion in `reconcileInvoiceStatus` and `getPosition` (billing-eligibility guards were already in place from Phase 3 design) |
| `backend/services/TripService.js` | `addPayment` invoice stamp switched to relation form `invoices: { connect: { invoice_id } }` (was the HTTP-500 on every receipt) |
| `backend/services/VehicleHireWorkflowService.js` | `ENGAGED_DRIVER_STATUSES` + same-trip driver allowance in `checkDriverUsable` (~line 234), mirroring `checkVehicleUsable` |

**Tests (new / changed)**
| File | Change |
|---|---|
| `backend/tests/batch2bVendorAuthority.db.test.js` | NEW — hire ₹42k/₹2k/₹40k; ₹30k → ₹10k; advance counting; overpay refusal; concurrent dedupe; byte-identical document. **7/7** |
| `backend/tests/batch2bInvoiceStatus.db.test.js` | NEW — §1–§8 status-machinery tests (10/10) + **§9** REFUNDED-is-not-money-in + **§10** booking auto-bill ⇄ trip API one-path (both columns, no rewrite, stamped ledger) |
| `backend/tests/phase4LoadingDispatch.db.test.js` | "Existing production trips untouched" rewritten to a per-row status-snapshot assert (was: table-wide count deltas that collided with concurrent suites) |
| `backend/tests/phase6-delivery-pod.db.test.js` | `financialSnapshot(trip)` scoped to the consignment (ledger/tripFinancial/tripSettlement by `trip_id`; commission per booking contract — required booking id ⇒ zero for a booking-less clone); suite now seeds its **own** reference chain and tears it down (donor cloning removed — fixes the cross-suite `trips_vehicle_id_fkey` teardown race) |

**E2E harness (new)**
| File | Role |
|---|---|
| `backend/scripts/e2e-audit-prepare.js` | `--fresh` drop/recreate + db push + read-only master copies (admin row, owner 1, vehicle 1 — documents, driver 1 + his user) + sequence advancement + doc-expiry roll-forward + availability forcing |
| `backend/scripts/e2e-audit-test.js` | 137-assertion lifecycle audit (kept as the audit artifact) |

**Not changed:** `prisma/schema.prisma`, migrations, any auth/validation middleware, `customerContext`, the Phase 7 artifact set (the returned booking bill is *returned*, not rewritten or adopted — `trip_id` stays `NULL`), and `CanonicalFinancialService` beyond the stamp/reconcile parity it already had.

---

## 4. Executed Test Counts (only executed results are reported)

| Run | Command (summary) | Result |
|---|---|---|
| Vendor authority suite | `--test tests/batch2bVendorAuthority.db.test.js` | **7/7 pass** |
| Invoice-status suite (incl. §9, §10) | `--test tests/batch2bInvoiceStatus.db.test.js` | **10/10 pass** |
| E2E lifecycle audit | fresh DB + server on :3996 + `node scripts/e2e-audit-test.js` | **137/137 PASS** (`/tmp/e2e8.out`) |
| 9-suite mixed batch (both batch2b suites, phase7 db, phase9 http, customerPaymentRecording, phase3VendorPayment unit+db, phase4 db, phase6 db) | server killed first | **116/116 pass** (`/tmp/mix7.out`) |
| phase6 standalone after self-seed rewrite | `--test tests/phase6-delivery-pod.db.test.js` | **5/5 pass**, no skips; zero `PH6-%` rows left |
| **Final full suite** | `pkill -f "node server.js"` first, then `DATABASE_URL=<batch2b DB> npm test` | **1158 tests: 1100 pass / 14 fail / 44 skipped** (`/tmp/fullsuite4.out`) |
| Baseline full suite (start of this phase) | same | 1159 tests: 1101 pass / **19 fail** / 39 skipped (`/tmp/fullsuite3.out`) |
| Earlier-this-phase full baseline | same | 1099 tests / 20 fail / 38 skip (`/tmp/fullsuite2.out`) |
| Earlier-in-phase re-runs (untouched-suite confirmations) | vehicle-hire suites 170/171 (only pre-existing G26); phase9 http 31/31; customerPaymentRecording+phase3VendorPayment-unit 34/34; driverSelfOwner 12/12; adminVehiclesEnquiriesSchema 8/8; phase1+phase8 hire suites 35/35 after the driver-gate change | pass (G26 documented below) |

Both DB improvements also **erased** previously-failing shared-DB collisions: `phase4LoadingDispatch:68` and `phase3VendorPayment.db:77` failed in the fs3 full run and pass in fs4.

---

## 5. Exact Reconciliations (as asserted in the executed E2E run, trip `BTBT-2026-00001`)

**Vendor side (authority: accepted VehicleHire, `hire_source: VEHICLE_HIRE_RECORD`)**
- Gross hire **₹42,000**; commission **₹2,000**; **net vendor payable ₹40,000**
- Payments **₹30,000** (₹10,000 + ₹15,000 + ₹5,000) → **vendor outstanding ₹10,000**
- Over-payment attempt **₹40,001 → refused** at the API; outstanding remains **₹10,000**

**Customer side (authority: confirmed quotation freight)**
- Invoice **₹50,000** (INV-BTB-2026-00001, the booking's auto bill — No. **1** document, `created:false` on re-create)
- Receipts **₹35,000** (₹20,000 + ₹15,000) → **customer outstanding ₹15,000**
- `payment_status = PARTIALLY_PAID` **and** `status (enum) = PARTIALLY_PAID`; `paid_at = null`; both receipts stamped `invoice_id` in the canonical ledger; API position reads ₹50,000 → ₹15,000

**Separation & lifecycle invariants**
- Trip customer freight stays **₹50,000** end-to-end (never the vendor net)
- Vendor advance on the same trip moves neither `customerDue` nor `customerCollected`
- `COMPLETED` changes **neither** outstanding: customer ₹15,000, vendor net ₹40,000, outstanding ₹10,000, both columns still `PARTIALLY_PAID`, `paid_at` still null
- **Zero** vendor money rows (`OWNER_SETTLEMENT|OWNER_ADVANCE|DRIVER_SETTLEMENT|DRIVER_ADVANCE`) carry a non-null `invoice_id`

**Timeline & authorization**
- Send quotation → `AWAITING_CUSTOMER_ACCEPTANCE` + exactly one `QUOTE_SENT`; retried send writes none; a send without a quotation is refused and writes **no** event and moves **no** status
- Every legal status hop writes one `status_changed` with from/to metadata; an invalid transition is refused and writes nothing; the POD refusal at `POST /:id/complete` writes nothing
- `POST /trips/:id/invoice` and `GET /trips/:id/invoice` without a token → **401/404-class refusal**; specs: 401 for both with no token (executed)

---

## 6. Migration / Schema Results

- **Batch 2B changed no schema.** `prisma/schema.prisma` untouched by this batch; schema-affecting work sits in the already-committed migrations `20261028140000_add_partially_paid_invoice_status` (adds `PARTIALLY_PAID` to the InvoiceStatus enum — consumed by the §1–§10 and E2E two-column assertions) and `20261028150000_reconcile_schema_equivalence` (the guarded failure-backfill for columns/FKs/enum drift from the earlier batch).
- **Executed:** `npx prisma migrate diff --from-url <batch2b test DB> --to-schema-datamodel prisma/schema.prisma` → **"No difference detected."** (empty diff — schema.prisma and the migrated database agree).
- `prisma db push` was executed **only** against throwaway databases (`bihar_transport_audit_test` per E2E run via the prepare script; the batch2b test DB was established the same way earlier). The dev database `bihar_transport_begusarai` was **never mutated** — masters were copied from it read-only.
- Migration-relevant provenance of the two-column statuses: `PARTIALLY_PAID` is a first-class enum member since the 20261028140000 migration; the reconciliation writes it through the same Prisma enum path, so no document's `status`/`payment_status` can drift from the declared enum.

---

## 7. Remaining Defects (verified pre-existing; none introduced by Batch 2B; none in Batch 2B scope files)

Final full-suite failure list (fs4) — **14 failures, all from the documented pre-existing families:**

1. `enquiryAdminDetail.db.test.js` ×2 (:38,:46) — fixture-dependent (`NotFoundError: Enquiry not found` — seeding order in the shared throwaway DB).
2. `enterpriseBookingLifecycle.test.js` ×4 (:442,:492,:569,:615) — stale mock-client contract (`TypeError … 'findFirst'` at `TripProvisioningService.js:160`).
3. `orderDashboardRegression.test.js` ×3 (:61,:154,:250) — assertions over shared-DB row distributions; `:61` flaps between runs purely on shared-DB state.
4. `phase2VehicleHire.test.js` ×1 (:541, "G26") — stale route contract: expects trip-scoped hire write paths (`POST /`, `PUT /:id`); the writes live under `/api/vehicle-hire`.
5. `phase5TransitTracking.test.js` ×1 (:719, test 24) — pre-existing customer-authorization assertion shortfall.
6. `quoteConfirmation.test.js` ×1 (:323) — pre-existing `tripFinancial.create` required-relation issue in the confirmBooking path.
7. `reconcileAvailability.test.js` ×2 (:138,:266) — availability-table baseline subsection under a shared DB.

**Observed-and-improved families:**
- `phase5-transit.http` ×5 — fixture-dependent family: 5 failures in the fs3 full run, **skipped** in fs4 on absent trip fixtures (same pre-existing condition; fixture guards skip rather than fail).
- `phase4LoadingDispatch:68` and `phase3VendorPayment.db:77` — failed in fs3, **pass in fs4** after the per-row assert and the phase6 self-seeding rewrite (2 net pre-existing failures eliminated).

**Skip class (not failures):** the 44 skips in the final run are all fixture guards ("no trip", "no customer", "no admin"…) — suites that skip rather than fail when their fixtures are absent from the shared throwaway DB at that instant.

**Honesty notes**
- Nothing is committed or pushed. Working tree contains the pre-existing ~52 modified files from Batches 1/2A **plus** all Batch 2B changes (113 entries in `git status`), preserved untouched.
- The dev database was only read; `prisma db push` was used exclusively on throwaway databases; no production data or secrets were printed; report contains no credential material.
- No frontend code was exercised in this batch; the tested surface is the API + services layer.
- Test-DATABASE isolation: batch2b test DB URL persisted at `/tmp/.batch2b_db_url`; E2E DB `bihar_transport_audit_test` recreated per run; at report time no audit server is running.

---

## Verdict

**READY** — for the Batch 2B mandate (financial integrity + verification), validated end-to-end on isolated infrastructure with exactly-executed results recorded above. The remaining 14 failures are pre-existing, itemized with signatures, and sit outside this batch's scope; they are candidates for a follow-up batch (test-contract modernization + fixture-independent seeding), not blockers for the Batch 2B financial-integrity verdict.

**Work stops here, as instructed — awaiting review. No deployment, no commit.**

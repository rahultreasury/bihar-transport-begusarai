# ENQUIRY / QUOTATION CLIENT AUDIT

**Scope:** Enquiry + Quotation module only
**Repository:** `bihar-transport-begusarai-main`
**Date:** 2026-09-30
**Code changes made:** NONE — this is a read-only audit
**Phase 7 / Customer Billing / Customer Payment:** NOT STARTED (held)

---

## 0. AUDIT BLOCKER — THE CLIENT DOCUMENT IS NOT IN THE REPOSITORY

The instruction was that *"Bihar Transport — Complete Transport Software Workflow"* is the
**single source of truth** and that the repository must be compared against it **page-by-page**.

That document **does not exist in this workspace**.

Searches performed:

| Search | Result |
| --- | --- |
| `*.pdf`, `*.docx`, `*.doc`, `*.rtf`, `*.odt` anywhere outside `node_modules` | 0 files |
| `*.txt`, `*.md` anywhere outside `node_modules` | 0 files matching the title |
| Grep for `Complete Transport Software Workflow` across `*.md` | 0 matches |
| Grep for client terminology (`Quote Rate`, `Booking Amount + Advance After Loading`, `Enquiry Source`, `Balance at Unloading`, `Total Billing Amount`) | 0 matches in any document |

**Consequence:** this audit is based **solely on the requirement excerpts quoted inside the task
message**. Any requirement present in the real document but absent from those excerpts is
**UNKNOWN and unaudited**. No requirement has been invented to fill that gap.

**Recommendation:** supply the document before implementation begins. Implementing a new
Quotation schema, a payment-schedule engine, GST/RCM semantics and a PDF layout from a partial
specification is exactly the class of work where invention is most likely and most expensive.

---

## 1. Client Requirements (as extracted from the task message)

### 1.1 Enquiry screen fields

Enquiry No. · Date · Party · Contact Person · Mobile · Pickup City · Drop City ·
Pickup Location · Drop Location · Goods · Quantity · Weight · Trip Type (One Way / Two Way) ·
Distance · Vehicle Type · Vehicle Size · Trip Date · Expected Delivery · Remarks ·
Actions `[Save]` `[Quote Rate]` · Status

### 1.2 Enquiry statuses

The client states there is **no confirmed business at enquiry stage**, and the enquiry should
support:

`Open` · `Quoted` · `On Hold` · `Lost` · `Converted to Order`

Also required: `Assigned To`, and `Enquiry Source` (Phone / WhatsApp / Referral / etc.).

### 1.3 Quotation

Rate Type `FIXED` · Rate/Freight · GST Type `RCM` · GST % · Total Freight ·
Validity (e.g. 15 Days) · Payment Schedule · Additional Charges (name, rate, quantity, total) ·
Total Additional Charges · Additional Charges Tax · Total Billing Amount

Actions: `[Save Quotation]` `[Download Quotation]` `[Send Quotation]` `[Confirm Order]` — each
must be backed by a **real** backend API. No mocks, no client-side fakery.

### 1.4 Payment schedule (quotation-stage terms — NOT vendor/partner payment)

1. Full Payment in Advance
2. Booking Amount + Advance After Loading + Balance at Unloading (balance auto-calculated)
3. Custom Schedule — milestones, each with a **due point** and a **fixed amount OR percentage**,
   with remaining balance calculated.

### 1.5 Additional charges worked example (illustrative only — values must NOT be hardcoded)

Freight ₹6000 · Detention rate ₹1500 × 2 Days = ₹3000 · Total Additional Charges ₹3000 ·
**Total Billing Amount ₹9000**

### 1.6 Order conversion

`ENQ-2026-00125` → `BT-2026-00125`. Enquiry and order stay linked. Repeated confirmation must
**not** create duplicate orders.

### 1.7 Status separation

The client requires **separate axes**:
A. Trip Status · B. Document Status · C. Customer Payment Status ·
D. Vehicle Vendor Payment Status · E. POD Status

### 1.8 High-level workflow

ENQUIRY → GIVE RATE → ORDER CONFIRMED → WAITING FOR VEHICLE → VEHICLE HIRED →
SENT TO LOADING POINT → LOADED / WAITING FOR DISPATCH → DISPATCHED → IN TRANSIT →
REACHED DELIVERY POINT → DELIVERED → POD → COMPLETED

---

## 2. Already Correct — DO NOT REWRITE

These satisfy the client specification and are backed by real, traced code. Any fix must leave
them intact.

| Item | Evidence |
| --- | --- |
| Enquiry No. | `Enquiry.enquiry_number` `@unique`, server-derived by `EnquiryNumberService` — never client input |
| Date, Party, Mobile | `created_at`, `customer_name`, `customer_mobile` |
| Pickup / Drop Location | `pickup_location` + `pickup_address` (+ lat/lng); same for drop |
| Goods, Quantity, Weight | `material`, `quantity`+`quantity_unit`, `weight`+`weight_unit` |
| Distance | `distance_km` |
| Vehicle Type | `requested_vehicle_name` / `assigned_vehicle_type` |
| Trip Date | `pickup_date` + `pickup_time` |
| Remarks | `special_instructions` (enquiry), `quote_remarks` (quote) |
| **Order conversion idempotency** | `EnquiryService.customerAccept()` — conditional `updateMany` claim on `AWAITING_CUSTOMER_ACCEPTANCE`, `Enquiry.booking_id` is `@unique`, claim **released** on booking-creation failure, repeat tap returns `alreadyAccepted` |
| **Enquiry → order link** | `booking_id` + `booking` relation, `@@index([booking_id])` |
| **Guest access security** | `optionalAuth` + `EnquiryService.assertCustomerAccess`; guest via `session_key` / signed access token |
| **Quote publication gate** | `isQuoteVisibleToCustomer()`; draft quotes written with `customerVisible: false` |
| **Admin authorisation** | `protect` + `adminOnly` on the whole admin enquiry router; rate limiters on create/act/read |
| **Rate-limit protection** | 10/15min create, 30/10min action, 300/5min read |
| **Send-quote idempotency** | `EnquiryService.adminSendQuote()` claims the status transition conditionally |
| **Status separation (client §1.7)** | `TripStatus`, `TripDocument`+`TripDocumentStatus`, `TripPayment`+`TripPaymentType`, POD fields on `Trip` are already **separate axes**. No change required. |

---

## 3. Incorrect — conflicts with the client document

### 3.1 The `/admin/enquiries/:id` journey rail does not use client terminology

Current rail (`enquiryStatus.js` → `JOURNEY_STEPS`):

```
Request Received → Under Review → Quote Prepared → Quote Sent → Customer Accepted → Confirmed
```

None of these six labels appear in the client document. The client's enquiry-stage vocabulary is
`Open · Quoted · On Hold · Lost · Converted to Order`.

Worse, these rail steps are **derived from `bookings.quote_status`**, not from enquiry data — so
the enquiry screen is displaying booking vocabulary (see §5).

### 3.2 Enquiry status enum does not match the client

`EnquiryStatus` (schema.prisma):

```
ENQUIRY_SUBMITTED · ADMIN_REVIEW · ASSIGNMENT_PENDING · VEHICLE_ASSIGNED ·
DRIVER_ASSIGNED · QUOTE_READY · AWAITING_CUSTOMER_ACCEPTANCE · CUSTOMER_ACCEPTED ·
CUSTOMER_REJECTED · CONFIRMED · IN_PROGRESS · COMPLETED · CANCELLED
```

- `Open` — no equivalent
- `Quoted` — partially covered by the separate `EnquiryPriceStatus.QUOTED`
- **`On Hold` — no equivalent anywhere in the schema**
- **`Lost` — no equivalent anywhere in the schema**
- `Converted to Order` — implied by `CONFIRMED` + `booking_id`, but not named as such

The enquiry status axis currently **conflates resource assignment** (`VEHICLE_ASSIGNED`,
`DRIVER_ASSIGNED`) with commercial progress — the client explicitly warns *"Do NOT use status for
everything."*

### 3.3 Validity is in hours, the client specifies days

Client: *"Validity: example 15 Days"*.
Current: `QuoteWorkspace.VALIDITY_OPTIONS` offers 1–48 **hours**, sent as
`quote_validity_hours`, persisted as `bookings.quote_valid_until`.

No day-based validity exists anywhere.

### 3.4 Enquiry number format does not match the client example

Client: `ENQ-2026-00125` → Order `BT-2026-00125`
Current: `Enquiry.enquiry_number` is produced as `BTB-YYYYMMDD-NNNNNN`, e.g. `BTB-20260926-000123`.

### 3.5 `[Save Quotation]` sends frontend state, not the persisted quotation

`QuoteWorkspace.handleSubmit()` builds its payload from local React state
(`finalPrice`, `validity`, `remarks`) and posts it. There is no separate "save" action, and no
quotation record exists for a "send" to reference. The document requires **Send Quotation** to
"use the server's persisted quotation".

---

## 4. Missing — nothing exists in schema, API, or UI

### 4.1 Enquiry field gaps

| Client field | Current state | Nearest existing column (do not duplicate) |
| --- | --- | --- |
| **Contact Person** | No column on `Enquiry` | `Client.contact_person` exists but is a different entity |
| **Pickup City** | No column on `Enquiry` | `Booking.pickup_city`, `Trip.pickup_city` exist |
| **Drop City** | No column on `Enquiry` | `Booking.drop_city`, `Trip.drop_city` exist |
| **Trip Type (One Way / Two Way)** | No column, no enum anywhere in the schema | none |
| **Vehicle Size** | No column on `Enquiry` | none |
| **Expected Delivery** | No column on `Enquiry` | `Trip.expected_delivery_date` exists |
| **Enquiry Source** (Phone/WhatsApp/Referral) | No column, no enum | none |
| **Assigned To** (staff) | Only driver/vehicle/partner/owner are assignable | none |
| **`[Save]` action** | No button; `PATCH /:id` is scoped to review state + internal note only | — |

### 4.2 The entire Quotation module is missing

There is **no `Quotation` model and no quotations table**. `grep -n "^model " schema.prisma`
returns 71 models and none of them is a quotation.

| Client requirement | Status |
| --- | --- |
| Rate Type `FIXED` | MISSING |
| Freight | MISSING (only a single scalar price) |
| Total Freight | MISSING |
| GST Type `RCM` | MISSING |
| GST % | MISSING |
| Additional Charges Tax | MISSING |
| Additional Charges lines (name / rate / quantity / total) | MISSING |
| Total Additional Charges | MISSING |
| Total Billing Amount | MISSING |
| Payment Schedule (all 3 options) | MISSING |
| Booking Amount / Advance After Loading / auto balance | MISSING |
| Custom Schedule + milestones (due point + fixed OR %) | MISSING |
| Remaining balance | MISSING |
| `[Save Quotation]` | MISSING |
| `[Download Quotation]` | MISSING |
| `[Confirm Order]` (explicit action) | MISSING (only implicit in customer accept) |

### 4.3 Download Quotation does not exist

- No endpoint
- No button
- **No PDF dependency at all** — `grep -i "pdf\|puppeteer\|playwright" package.json` → 0 matches

### 4.4 GST audit

`gst_number` exists on `Client`, `Partner`, `VehicleOwner` and `PartnerApplication`. In every case
it is a **party tax-identity string**, not tax logic.

There is **no GST percentage, no GST type, no RCM handling and no tax calculation anywhere in the
backend**. Grep for `gst|rcm` outside tests returns only identity fields.

---

## 5. Duplicate Systems

**Two parallel quote pipelines are running simultaneously.**

### System A — Enquiry-level (correct entity for the client's workflow)

```
POST /api/admin/enquiries/:id/quote        → adminEnquiryController.saveQuote
                                           → EnquiryService.adminSetQuote()
                                           → enquiries.final_quoted_price, price_status
POST /api/admin/enquiries/:id/send-quote   → EnquiryService.adminSendQuote()
                                           → status → AWAITING_CUSTOMER_ACCEPTANCE
```

### System B — Booking-level

```
POST /api/admin/bookings/:id/prepare-quote → BookingService
                                           → bookings.final_price, quote_status
POST /api/admin/bookings/:id/send-quote   → BookingService
```

### The conflict

`AdminEnquiryDetail.jsx` (the `/admin/enquiries/:id` route) imports and renders `QuoteWorkspace`.
`QuoteWorkspace` is **hard-wired to System B** — it calls
`adminAPI.prepareQuote(booking.booking_id, …)` and `adminAPI.sendQuote(booking.booking_id, …)`, and
returns early when `booking_id` is absent.

**Effect:** on a genuine pre-order enquiry — exactly the client's *"at enquiry stage there is NO
confirmed business"* scenario — the quote UI is either dead or operates on the wrong entity. The
customer acceptance path (`enquiryController.acceptQuote` → `EnquiryService.customerAccept`) runs
entirely through **System A**.

So the admin writes the quote to a Booking while the customer accepts it from an Enquiry. These
are two different records with two different price columns.

**Instruction:** reuse System A (Enquiry-level). Do **not** build the Quotation module on System B,
and do not create a third system.

---

## 6. Security Review — conflicts found, nothing removed

No security defect was found. The following are recorded as **correct and to be preserved**:

| Control | Location |
| --- | --- |
| Guest enquiry access | `middleware/optionalAuth.js` + `EnquiryService.assertCustomerAccess` |
| Quote publication rule | `EnquiryStateMachine.isQuoteVisibleToCustomer()`; draft quotes `customerVisible: false` |
| Customer acceptance gate | status must be `AWAITING_CUSTOMER_ACCEPTANCE`, price must exist |
| Booking creation protection | `booking_id` `@unique` + claim/release |
| Trip acceptance gate | `EnquiryStateMachine.hasRequiredAssignment()` — a quote needs a vehicle **and** a driver |
| Idempotency | conditional `updateMany` claims on accept and send |
| Authorisation | `protect` + `adminOnly`, per-router rate limiters |

**No security conflicts were found**, therefore nothing needs to be traded away to reach
compliance. Every client requirement can be met without weakening any control above.

---

## 7. Audit Table — Enquiry Screen

| Client Requirement | Current UI | Backend API | Database | Status |
| --- | --- | --- | --- | --- |
| Enquiry No. | Displayed | `GET /api/admin/enquiries/:id` | `enquiries.enquiry_number` (unique, server-derived) | **INCORRECT** — format `BTB-YYYYMMDD-NNNNNN` vs client `ENQ-2026-00125` |
| Date | Displayed | same | `enquiries.created_at` | IMPLEMENTED |
| Party | "Customer" | same | `enquiries.customer_name` | IMPLEMENTED |
| Contact Person | Not rendered | — | No column (`Client.contact_person` only) | **MISSING** |
| Mobile | Displayed | same | `enquiries.customer_mobile` | IMPLEMENTED |
| Pickup City | Not separate | — | No column (`Booking`/`Trip` have it) | **MISSING** |
| Drop City | Not separate | — | No column (`Booking`/`Trip` have it) | **MISSING** |
| Pickup Location | "Pickup" | same | `pickup_location`, `pickup_address` | IMPLEMENTED |
| Drop Location | "Drop" | same | `drop_location`, `drop_address` | IMPLEMENTED |
| Goods | Displayed | same | `enquiries.material` | IMPLEMENTED |
| Quantity | Displayed | same | `quantity`, `quantity_unit` | IMPLEMENTED |
| Weight | Displayed | same | `weight`, `weight_unit` | IMPLEMENTED |
| Trip Type (One Way / Two Way) | Absent | — | No column, no enum | **MISSING** |
| Distance | Displayed | same | `enquiries.distance_km` | IMPLEMENTED |
| Vehicle Type | Displayed | same | `requested_vehicle_name`, `assigned_vehicle_type` | IMPLEMENTED |
| Vehicle Size | Absent | — | No column on `Enquiry` | **MISSING** |
| Trip Date | Displayed | same | `enquiries.pickup_date`, `pickup_time` | IMPLEMENTED |
| Expected Delivery | Absent | — | No column (`Trip.expected_delivery_date` only) | **MISSING** |
| Remarks | Displayed | same | `special_instructions`, `quote_remarks` | IMPLEMENTED |
| Action `[Save]` | **No button** | `PATCH /:id` (review/note only) | — | **MISSING** |
| Action `[Quote Rate]` | "Prepare Quote" | `POST /:id/quote` | `final_quoted_price` | **PARTIALLY IMPLEMENTED** |
| Status: `Open` | Not shown | — | No equivalent | **MISSING** |
| Status: `Quoted` | "Quote Prepared" | `price_status: QUOTED` | `EnquiryPriceStatus.QUOTED` | PARTIALLY IMPLEMENTED |
| Status: `On Hold` | Absent | — | **No equivalent anywhere** | **MISSING** |
| Status: `Lost` | Absent | — | **No equivalent anywhere** | **MISSING** |
| Status: `Converted to Order` | "Confirmed" | `POST /:id/assign` flow | `CONFIRMED` + `booking_id` | PARTIALLY IMPLEMENTED |
| Assigned To | Driver/Owner only | `POST /:id/assign` | `assigned_driver_id`/`vehicle`/`partner`/`owner` | **MISSING** (no staff assignee) |
| Enquiry Source | Absent | — | No column, no enum | **MISSING** |

---

## 8. Audit Table — Quotation

| Client Requirement | Current UI | Backend API | Database | Status |
| --- | --- | --- | --- | --- |
| Rate Type `FIXED` | Absent | — | — | **MISSING** |
| Rate / Freight | Single "Final price" field | `final_price` (Booking) / `final_quoted_price` (Enquiry) | one scalar | **MISSING** — no freight concept |
| GST Type `RCM` | Absent | — | — | **MISSING** |
| GST % | Absent | — | — | **MISSING** |
| Total Freight | Absent | — | — | **MISSING** |
| Validity (e.g. 15 Days) | Dropdown, **hours** 1–48 | `quote_validity_hours` | `bookings.quote_valid_until` | **INCORRECT** — unit mismatch |
| Payment Schedule option 1 (Full Advance) | Absent | — | — | **MISSING** |
| Payment Schedule option 2 (Booking + Advance After Loading + Balance) | Absent | — | — | **MISSING** |
| Payment Schedule option 3 (Custom + milestones) | Absent | — | — | **MISSING** |
| Milestone due point | Absent | — | — | **MISSING** |
| Milestone fixed amount OR percentage | Absent | — | — | **MISSING** |
| Remaining balance | Absent | — | — | **MISSING** |
| Additional Charges (name/rate/qty/total) | Absent | — | — | **MISSING** |
| Total Additional Charges | Absent | — | — | **MISSING** |
| Additional Charges Tax | Absent | — | — | **MISSING** |
| Total Billing Amount | Absent | — | — | **MISSING** |
| `[Save Quotation]` | **No button** | — | — | **MISSING** |
| `[Download Quotation]` | **No button** | **No endpoint**; no PDF dependency in `package.json` | — | **MISSING** |
| `[Send Quotation]` | "Send Quote" | `POST /:id/send-quote` (real, idempotent, uses persisted price) | `final_quoted_price` | **PARTIALLY IMPLEMENTED** |
| `[Confirm Order]` | **No button** | implicit in `customerAccept` | `booking_id` | **PARTIALLY IMPLEMENTED** |

---

## 9. Audit Table — Order Conversion

| Client Requirement | Current UI | Backend API | Database | Status |
| --- | --- | --- | --- | --- |
| Enquiry → Order conversion | Customer accept page | `POST /api/enquiries/:id/accept` → `customerAccept` | `Enquiry.booking_id` `@unique` | IMPLEMENTED |
| Enquiry and order remain linked | Confirmation page shows booking | same | `booking_id` + relation + index | IMPLEMENTED |
| No duplicate order on repeat confirmation | n/a | idempotent `alreadyAccepted` return | `@unique` constraint | IMPLEMENTED |
| Enquiry preserved | n/a | enquiry row retained | `onDelete: SetNull` on booking | IMPLEMENTED |
| Order number format `BT-2026-00125` | Confirmation page | `BookingNumberService` | `bookings.booking_number` | **PARTIALLY IMPLEMENTED** — linked, format unverified against doc |
| `[Confirm Order]` as an explicit admin action | **No button** | — | — | **MISSING** |

---

## 10. Rate / GST Calculation Audit

The client requires:

```
Freight + Additional Charges + Additional Charge Tax = Total Billing Amount
```

**Current state: this expression cannot be evaluated.** Only a single scalar
(`final_price` / `final_quoted_price`) is persisted. There is no freight component, no additional
charge component, no tax component, and therefore no total.

No tax rule has been invented to fill this gap. The client specifies `GST Type` and `GST %`, with
`RCM` as the named type. What `RCM` means arithmetically for *Total Billing Amount* is **not
defined in the available excerpts** — under Reverse Charge the supplier is not the GST
registrant, so whether tax is added to or excluded from the billing amount materially changes the
figure. **This must be confirmed against the real document before implementation.**

Note: the existing `TripFinancial` / `CanonicalFinancial` / `VendorLedger` machinery is a
**different financial system** (vendor/partner settlement) and must not be reused or confused with
quotation-stage customer payment terms.

---

## 11. Planned Implementation (NOT YET DONE — held pending document)

Deliberately withheld. Recording intent so it can be reviewed against the real specification.

### 11.1 Database (minimum, additive only — reuse before creating)

1. Extend `Enquiry` with the missing intake columns: `contact_person`, `pickup_city`,
   `drop_city`, `trip_type`, `vehicle_size`, `expected_delivery_date`, `enquiry_source`,
   `assigned_to_admin_id`.
2. Add `On Hold` / `Lost` to `EnquiryStatus` (additive enum values — safe, no rewrite of
   existing rows).
3. Create `Quotation` (enquiry-scoped, 1 active per enquiry) with freight, rate type, GST type,
   GST %, total freight, validity **in days**, totals.
4. Create `QuotationCharge` (name, rate, quantity, unit, total).
5. Create `QuotationMilestone` (due point, fixed amount, percentage, computed amount, balance).
6. Migration must be additive and must not drop or rename an existing column.

### 11.2 Backend

- `POST /api/admin/enquiries/:id/quotation` — save (upsert, idempotent)
- `GET  /api/admin/enquiries/:id/quotation` — read persisted quotation
- `GET  /api/admin/enquiries/:id/quotation/download` — PDF from **persisted** data only
- `POST /api/admin/enquiries/:id/quotation/send` — send **persisted** quotation
- `POST /api/admin/enquiries/:id/confirm-order` — verify quotation + confirmation, create
  **exactly one** Booking, link, idempotent
- All behind `protect` + `adminOnly`; keep the existing rate limiters and acceptance gate.
- Build on **System A (Enquiry-level)**. Do not extend the Booking quote system.

### 11.3 Frontend

- Extend the existing enquiry detail page with the missing fields — **no redesign**, no new
  navigation, no colour/spacing/typography changes.
- Replace the booking-bound actions in `QuoteWorkspace` with enquiry-level quotation actions.
- Retain existing layout, cards and information.

### 11.4 Not planned (deliberately)

Customer Payment Status tracking, vendor payment, POD, trip lifecycle phases — these belong to
later phases and are out of scope for this correction.

---

## 12. Testing Status

**No tests were run. No test is claimed to have passed.**

Testing is blocked behind implementation. When implementation proceeds, the required matrix is:
create enquiry · save enquiry · quote rate · save quotation · additional charge calculation ·
GST calculation · payment schedule · custom schedule · remaining balance · download quotation ·
send quotation · confirm order · duplicate confirm order · enquiry/order linkage · invalid
quotation · unauthorized access · customer acceptance · no duplicate Booking · Phase 1 regressions ·
Phase 2–6 regressions where relevant.

Existing suites that must remain green (located in `backend/tests/`):
`enquiry.flow.e2e.js`, `enquiry.verify.test.js`, `quoteConfirmation.test.js`,
`enterpriseBookingLifecycle.test.js`, `phase1OrderTrip.test.js`, `phase2VehicleHire.test.js`,
`phase3VendorPayment*.test.js`, `phase4LoadingDispatch*.test.js`, `phase5*`, `phase6*`.

---

## 13. Summary

| Area | Implemented | Partial | Incorrect | Missing |
| --- | --- | --- | --- | --- |
| Enquiry screen | 11 | 3 | 1 | 9 |
| Quotation | 0 | 2 | 1 | 18 |
| Order conversion | 4 | 1 | 0 | 1 |

**Headline findings:**

1. **The client document is absent from the repository** — the audit is incomplete by definition
   until it is supplied.
2. **The Quotation module does not exist at all** — no model, no table, no API, no UI. Every
   quotation line item in the client document is MISSING.
3. **There is no payment schedule of any kind** — not booking amount, not advance after loading,
   not milestones, not remaining balance.
4. **There is no GST logic at all** — `gst_number` is a party identity field only.
5. **There are two competing quote systems**, and the enquiry screen is wired to the wrong one.
6. **The journey rail uses booking vocabulary**, not the client's `Open / Quoted / On Hold / Lost /
   Converted to Order`.
7. **`On Hold` and `Lost` have no representation anywhere in the schema.**
8. **Download Quotation does not exist**, and there is no PDF dependency.
9. **The security model and order-conversion idempotency are correct** and must not be weakened.
10. **Status separation (client §1.7) is already correct** in the trip/document/payment/POD axes
    and needs no work.

**Recommendation: do not implement until the client document is supplied.** The open questions
that would otherwise force invented business rules are: the exact meaning of RCM in the
`Total Billing Amount` formula, and whether the enquiry number format must change from
`BTB-YYYYMMDD-NNNNNN` to `ENQ-YYYY-NNNNN`.

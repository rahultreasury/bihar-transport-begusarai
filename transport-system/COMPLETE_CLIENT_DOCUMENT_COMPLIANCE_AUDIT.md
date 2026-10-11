# COMPLETE CLIENT DOCUMENT COMPLIANCE AUDIT

**READ + AUDIT ONLY — NO CODE CHANGES MADE**

---

## 1. Document Information

**File read:** `/Users/rahulraj/Downloads/Bihar Transport.docx`
*(the file named `Bihar Transport(3).docx` was not present; this file carries the identical title "Bihar Transport — Complete Transport Software Workflow" and matches every excerpt quoted in the task)*

| Property | Value |
| --- | --- |
| Pages read | All — 1,629 extracted content lines, ~5,604 words |
| Sections found | 35 numbered sections plus a header workflow diagram and a closing developer instruction |
| Document type | Client functional specification with worked numeric examples |
| Tables extracted | 8 (Billing-To/Business-Model, Vendor Ledger, Commission criteria, Payment Voucher, Money Receipt, Movement History, Document Expiry, Dashboard) |

### Section inventory

| § | Section |
| --- | --- |
| — | Recommended workflow (header diagram) |
| 1 | Enquiry |
| 2 | Quotation / Rate |
| 3 | Party Confirms |
| 4 | Order / Trip Master |
| 5 | Vehicle Hiring |
| 6 | Vehicle Hire Page |
| 8 | Rate As Per |
| 9 | Commission |
| 10 | Net Vehicle Vendor Payable |
| 11 | Vehicle Hired |
| 12 | Vehicle Payment |
| A | Commission Receipt Entry |
| B | (Worked Q&A) Trip balance after completion / settlement |
| C | Very Important — Ledger Logic |
| D | Your Complete Document Flow |
| 13 | Sent to Loading Point |
| 14 | Vehicle Reaches Loading Point |
| 17 | Loaded |
| 9 | Bill Received from Party (document checklist) |
| 18 | Dispatch |
| 19 | In Transit |
| 1 | Tracking |
| 21 | Deliver |
| 22 | POD Logic |
| 23 | POD Received |
| 3 | Movement History |
| 3 | Finance |
| 4–7 | Change Vehicle, Report Incident, Change Vehicle details, Proof, Confirmation |
| — | E-Way Bill after vehicle change |
| — | Incidents: Vehicle Missing, Driver Unreachable, Accident, Breakdown, Theft, Delivery Problem, Other |
| 15 | Document Expiry Alerts |
| 17 | Your main dashboard |
| 20 | Reached Delivery Point |
| 24 | Customer Billing |
| 25 | Customer Payment |
| 26 | Three Separate Financial Calculations |
| 27 | Business Model |
| 29 | Master Trip Status |
| 30 | Don't Use Status For Everything |
| 31 | Main Dashboard |
| 32 | Trip Detail Page |
| 33 | History / Audit Trail |
| 34 | The Most Important Calculation Rules |
| 35 | Example of One Complete Trip |
| — | Petrol Pump screen, Monthly pump bill, Pay Pump |
| — | One-line developer instruction (closing) |

> **Note:** the document's own numbering is **not sequential** — it jumps (8, 9, 10 … then 13, 14, 17, 18, 19, 21 …) and several sections reuse numbers already used earlier (e.g. two "9"s, two "3"s, two "17"s). Section numbers below are cited verbatim as they appear.

---

## 2. Executive Summary

The repository is a mature, well-architected transport system that has implemented **the operational half** of the client specification very well, and has **not implemented the commercial quoting half at all**.

| Finding | Detail |
| --- | --- |
| **The Quotation module does not exist** | No `Quotation` model, no table, no API, no UI. Of 30 quotation requirements, **0 are implemented**, 2 partial, 1 incorrect, 27 missing. |
| **No payment schedule of any kind** | Booking Amount, Advance After Loading, Balance at Unloading, Custom Schedule, milestones, fixed/percentage, remaining balance — all absent from schema and code. |
| **No GST logic** | `gst_number` exists only as a party tax-identity string on Client/Partner/VehicleOwner. There is no GST %, no RCM type, no tax arithmetic. |
| **Enquiry is ~60% compliant** | 13 of 22 fields implemented. Nine are missing: Contact Person, Pickup City, Drop City, Trip Type, Vehicle Size, Expected Delivery, Enquiry Source, Assigned To (staff), `[Save]`. |
| **Enquiry number format conflicts** | Document specifies `ENQ-2026-00125`. Code produces `BTB-20260926-000123`. |
| **Two competing quote systems** | Admin UI writes to **Booking**; customer accepts from **Enquiry**. Two price columns, two price truths. |
| **Vehicle Hire / Commission / Net Payable** | Substantially **already implemented** — `VehicleHireBillingTo`, `VehicleHireBusinessModel`, `VehicleHireRateBasis`, `CommissionRecord` all exist. Do not rebuild. |
| **Status separation (§30)** | Already **correctly implemented** across Trip / Document / Payment / POD. |
| **Documents to generate** | Download Quotation, Payment Voucher (PDF), Money Receipt (PDF), Settlement Voucher, Challan — **no PDF library exists in `package.json` at all**. |
| **Entirely absent subsystems** | Petrol Pump, Vehicle Change history, Incidents (7 types), Document Expiry Alerts, Customer Billing invoice workflow. |

The document's closing one-line instruction is the correct architectural north-star and the
repository is closer to it than the quotation gaps suggest:

> *"Build the system around one Trip/Order ID. An enquiry becomes a confirmed order, then vehicle
> hiring, loading, dispatch, transit, delivery and POD. Use one universal Vehicle Hire module where
> Billing To automatically determines Contract or Commission…"*

---

## 3. Page-by-Page Requirement Map

The document is a continuous flow document, not a paginated spec. Rows below follow document order.

| Page/§ | Section | Client Requirement | Existing Repository | Status |
|---|---|---|---|---|
| Header | Recommended workflow | 13-stage flow ENQUIRY → … → COMPLETED, with POD branch | `TripStatus` covers the operational half only | PARTIALLY IMPLEMENTED |
| 1 | Enquiry | Enquiry screen with 19 fields | `Enquiry` model has 13 of them | PARTIALLY IMPLEMENTED |
| 1 | Enquiry | `[Save]` `[Quote Rate]` buttons | No `[Save]`; "Prepare Quote" only | PARTIALLY IMPLEMENTED |
| 1 | Enquiry | Status: Open, Quoted, On Hold, Lost, Converted to Order | `EnquiryStatus` enum has none of these | **MISSING** |
| 1 | Enquiry | Assigned To (staff member) | Only driver/vehicle/partner/owner assignable | **MISSING** |
| 1 | Enquiry | Enquiry Source (phone call, WhatsApp, referral) | No column | **MISSING** |
| 2 | Quotation / Rate | Rate Type `FIXED`, Rate, Freight, GST Type `RCM`, GST %, Total Freight | Single scalar price only | **MISSING** |
| 2 | Quotation / Rate | Validity 15 Days | `quote_validity_hours` (hours) | **INCORRECT** |
| 2 | Quotation / Rate | Payment Schedule — 3 options | None | **MISSING** |
| 2 | Quotation / Rate | Booking Amount ₹2,000 + Advance After Loading 80% incl. booking; balance auto | None | **MISSING** |
| 2 | Quotation / Rate | Custom Schedule milestones, due point, fixed OR %, remaining balance | None | **MISSING** |
| 2 | Quotation / Rate | Additional charges (name, rate, qty, total) + total + tax | None | **MISSING** |
| 2 | Quotation / Rate | Total billing Amount 9000 | None | **MISSING** |
| 2 | Quotation / Rate | `[Save][Download][Send][Confirm Order]` | Only Send Quote (booking-level) | PARTIALLY IMPLEMENTED |
| 2 | Quotation / Rate | Send Quotation "leave the enquiry open" | Send flips to AWAITING_CUSTOMER_ACCEPTANCE | PARTIALLY IMPLEMENTED |
| 2 | Quotation / Rate | Status `RATE QUOTED` | `QUOTE_READY` | **INCORRECT** (terminology) |
| 3 | Party Confirms | CONFIRM ORDER → Order `BT-2026-00125`, status `ORDER CONFIRMED`, linked | Idempotent conversion exists; format `BTB-…` | PARTIALLY IMPLEMENTED |
| 4 | Order / Trip Master | 20 master fields + 6 separate status blocks + progress bar | Trip has most fields; status blocks partial | PARTIALLY IMPLEMENTED |
| 4 | Order / Trip Master | Payment Terms, Rate As Per, Rate, Freight, GST Type, GST%, Total Freight | Not on Trip master | **MISSING** |
| 5 | Vehicle Hiring | Status `WAITING FOR VEHICLE`; one universal Hire Vehicle page | `VehicleHireService` exists | PARTIALLY IMPLEMENTED |
| 6 | Vehicle Hire Page | Vehicle + vendor + driver + 6 expiry dates with 🟢/🟠/🔴 | Vehicle fields exist; no expiry alerts | PARTIALLY IMPLEMENTED |
| 6 | Vehicle Hire Page | Billing To → auto Contract/Commission, overridable | `VehicleHireBillingTo`, `VehicleHireBusinessModel` exist | **IMPLEMENTED** |
| 8 | Rate As Per | Rate, Freight, Transport Commission, Net Freight; Per Trip ₹42,000 / Per Ton 5000×8 = 40,000 | `VehicleHireRateBasis`, `CommissionCalculator` exist | **IMPLEMENTED** |
| 9 | Commission | Type: Percentage / Fixed Amount / No Commission, default 5% | `CommissionRecord.commission_type` supports percentage/fixed | **IMPLEMENTED** |
| 10 | Net Vendor Payable | Gross − Commission = Net; **store all three separately**; never overwrite gross | `CommissionRecord` + `TripFinancial` store separately | **IMPLEMENTED** |
| 11 | Vehicle Hired | Status `VEHICLE HIRED`; download challan / share challan | Status exists; **no PDF/challan generation** | PARTIALLY IMPLEMENTED |
| 12 | Vehicle Payment | Make Transaction; 4 balance criteria with exact formulas | `VendorLedgerService`, `TripSettlementService` exist | PARTIALLY IMPLEMENTED |
| 12 | Vehicle Payment | Partial payments allowed (₹2,000 of ₹11,000) | Multiple `TripPayment` rows supported | **IMPLEMENTED** |
| 12 | Vehicle Payment | Payment modes Bank/Cash/Settlement; fuel on left, cash on right | Payment modes exist; **no fuel-side voucher** | PARTIALLY IMPLEMENTED |
| 12 | Save Payment | 9 steps incl. auto PDF voucher generation | No PDF library | PARTIALLY IMPLEMENTED |
| — | Payment Voucher | PV-2026-00452 with Amount in Words, WhatsApp share | No PDF | **MISSING** |
| — | Money Receipt | MR-2026-00452, generated after SAVE | No PDF | **MISSING** |
| B | Trip balance after completion | ₹5,000 stays "Payment Pending" on the trip; not auto-settled | Trip payment history exists | PARTIALLY IMPLEMENTED |
| B | Settlement entry | Trip ₹5,000 → ₹0 Settled; ledger ₹35,000 → ₹30,000; Settlement Voucher | `Settlement` model exists; no voucher PDF | PARTIALLY IMPLEMENTED |
| C | Ledger Logic | Three separate concepts: trip calc / previous balance / actual transaction | `FinancialTransaction` separates these | **IMPLEMENTED** |
| D | Document Flow | Trip → Hire → Commission → Vendor Payable → PV; Fuel → Pump + Vendor Ledger | Vendor ledger exists; **no PetrolPump** | PARTIALLY IMPLEMENTED |
| 13 | Sent to Loading Point | Status `TO LOADING POINT` | `TripStatus.TO_LOADING_POINT` | **IMPLEMENTED** |
| 14 | Reached Loading | Status `AT LOADING POINT`; dashboard "4 vehicles waiting for loading" | `TripStatus.AT_LOADING_POINT` exists; KPI unknown | PARTIALLY IMPLEMENTED |
| 17 | Loaded | Status `LOADED / WAITING FOR DISPATCH` | `TripStatus.LOADED` | **IMPLEMENTED** |
| 9 | Bill Received from Party | Transit Documents checklist; **not** an operational status; `DISPATCH BLOCKED — E-way Bill Pending` | `TripDocument` model with mandatory-ready check | **IMPLEMENTED** |
| 18 | Dispatch | 16 recorded fields (LR/GR, E-way, insurance, consignee, actual qty/weight…) | `Trip` has most; insurance sub-fields partial | PARTIALLY IMPLEMENTED |
| 19 | In Transit | Trip page header, GPS, distance travelled/remaining, ETA | `TripTrackingService` + phase5 tests | **IMPLEMENTED** |
| 21 | Deliver | 23 recorded fields (breakage/excess/shortage/damage/fine, balances) | `TripDeliveryService`, `Trip` fields | PARTIALLY IMPLEMENTED |
| 22 | POD Logic | POD Required? Yes/No at creation drives branch | POD is a `TripDocument`; **no `pod_required` flag** | PARTIALLY IMPLEMENTED |
| 23 | POD Received | Upload POD: file, date, received by, remarks | POD document exists | **IMPLEMENTED** |
| 3 | Movement History | Chronological read-only timeline; auto-entries; corrections recorded; keep separate from status | `TripTimeline` | **IMPLEMENTED** |
| 3 | Finance | Client tab + Vehicle Vendor tab + Trip Margin | `TripFinancial`, `CanonicalFinancialService` | **IMPLEMENTED** |
| 4 | Change Vehicle | Reason, old locked, new, driver, **location+pincode+GPS**, **proof photos**, confirmation summary | **No VehicleChange model** | **MISSING** |
| 4 | Don't delete old vehicle | Vehicle History showing original + changes | **No model** | **MISSING** |
| 4 | E-Way Bill update | Guide staff; **do not pretend** the e-way bill was updated | `TripDocument.E_WAY_BILL` exists; no update workflow | PARTIALLY IMPLEMENTED |
| 5–10 | Incidents | 7 types with checklists, freeze trip, Incident ID INC-00125 | **No Incident model** | **MISSING** |
| 15 | Document Expiry Alerts | Insurance 30d, Permit 15d, Fitness 7d; dashboard | `TripDocumentStatus.EXPIRED` only | **MISSING** |
| 17 | Main dashboard | Today's Operations + Alerts + Money tiles | Admin dashboard exists, different tiles | PARTIALLY IMPLEMENTED |
| 20 | Reached Delivery Point | Status `AT DELIVERY POINT`; arrival date/time, location, receiver | `arrived_at_destination_at` exists | **IMPLEMENTED** |
| 24 | Customer Billing | Independent of operations; Invoice Status Unbilled/Billed/Partially Paid/Paid | `InvoiceStatus` = PENDING/GENERATED/PAID/CANCELLED | **INCORRECT** |
| 25 | Customer Payment | RECORD PAYMENT; multiple partials; "**No fixed payment schedule**" | Partial payments supported | **IMPLEMENTED** |
| 26 | Three Separate Financial Calculations | Customer freight / Gross hire / Commission — must not mix | Separated in `TripFinancial` | **IMPLEMENTED** |
| 27 | Business Model | Contract vs Commission from Billing To; one Vehicle Hire module | Enums exist, single service | **IMPLEMENTED** |
| 29 | Master Trip Status | 15 statuses + CANCELLED | `TripStatus` has 10, different names | PARTIALLY IMPLEMENTED |
| 30 | Don't Use Status For Everything | Five separate axes A–E | All five axes exist | **IMPLEMENTED** |
| 31 | Main Dashboard | 11 operational counts + 5 financial alerts | Different dashboard | **MISSING** |
| 32 | Trip Detail Page | Header + progress + 8 tabs (Overview…History) | Trip page exists, different tabs | PARTIALLY IMPLEMENTED |
| 33 | History / Audit Trail | Every action recorded; **staff must not silently change old records** | `AuditLog`, `EnquiryEvent`, `TripTimeline` | **IMPLEMENTED** |
| 34 | Calculation Rules | 5 explicit formulas | Implemented | **IMPLEMENTED** |
| 35 | Complete Trip Example | End-to-end worked example | Concepts all exist separately | PARTIALLY IMPLEMENTED |
| — | Petrol Pump | Credit limit, outstanding, monthly bill, Pay Pump | **No PetrolPump model** | **MISSING** |

---

## 4. Enquiry Compliance (§1)

Client terminology preserved exactly.

| # | Client Requirement | Existing Repository | Status |
| --- | --- | --- | --- |
| 1 | **Enquiry No.** `ENQ-2026-00125` | `Enquiry.enquiry_number` — server-derived, `@unique`, but format `BTB-YYYYMMDD-NNNNNN` | **INCORRECT** |
| 2 | **Date** `22-09-26` | `Enquiry.created_at` | IMPLEMENTED |
| 3 | **Party** `Aasan OPD` | `Enquiry.customer_name` | IMPLEMENTED |
| 4 | **Contact Person** `Kaushal` | No column on `Enquiry` (`Client.contact_person` is a different entity) | **MISSING** |
| 5 | **Mobile** `9798203741` | `Enquiry.customer_mobile` + index | IMPLEMENTED |
| 6 | **Pickup City** `Begusarai` | No column on `Enquiry` | **MISSING** |
| 7 | **Drop City** `Khagaria` | No column on `Enquiry` | **MISSING** |
| 8 | **Pickup Location** `full address` | `pickup_location` + `pickup_address` + lat/lng | IMPLEMENTED |
| 9 | **Drop Location** `full address` | `drop_location` + `drop_address` + lat/lng | IMPLEMENTED |
| 10 | **Goods** `Pipe 20ft` | `Enquiry.material` + `goods_category` | IMPLEMENTED |
| 11 | **Quantity** `100pcs` | `quantity` + `quantity_unit` | IMPLEMENTED |
| 12 | **Weight** `7 tons` | `weight` + `weight_unit` | IMPLEMENTED |
| 13 | **Trip Type** One Way / Two Way | No column, no enum anywhere in schema | **MISSING** |
| 14 | **Distance** `60 Km` | `Enquiry.distance_km` | IMPLEMENTED |
| 15 | **Vehicle Type** `DCM` | `requested_vehicle_name` / `assigned_vehicle_type` | IMPLEMENTED |
| 16 | **Vehicle Size** `22ft` | No column on `Enquiry` | **MISSING** |
| 17 | **Trip Date** `22-09-26` | `Enquiry.pickup_date` + `pickup_time` | IMPLEMENTED |
| 18 | **Expected Delivery** `22-09-26` | No column on `Enquiry` (`Trip.expected_delivery_date` only) | **MISSING** |
| 19 | **Remarks** `Need all original documents for gate pass` | `special_instructions` + `quote_remarks` | IMPLEMENTED |
| 20 | **Assigned To** — "the staff member responsible for handling the enquiry" | Only driver/vehicle/partner/owner assignable; no staff assignee | **MISSING** |
| 21 | **Enquiry Source** — "how it came in, such as a phone call, WhatsApp, or referral" | No column, no enum | **MISSING** |
| 22 | **`[Save]`** button | No button; `PATCH /api/admin/enquiries/:id` is scoped to review state + internal note | **MISSING** |
| 22b | **`[Quote Rate]`** button | "Prepare Quote" → `POST /api/admin/enquiries/:id/quote` | PARTIALLY IMPLEMENTED |
| 23 | **Status** — "Consider an enquiry status such as Open, Quoted, On Hold, Lost, or Converted to Order" | `EnquiryStatus` = ENQUIRY_SUBMITTED, ADMIN_REVIEW, ASSIGNMENT_PENDING, VEHICLE_ASSIGNED, DRIVER_ASSIGNED, QUOTE_READY, AWAITING_CUSTOMER_ACCEPTANCE, CUSTOMER_ACCEPTED, CUSTOMER_REJECTED, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED | **INCORRECT** — On Hold and Lost have no equivalent anywhere |

**Important wording note (§1):** the document says *"**Plan for changes:** Consider an enquiry status such
as Open, Quoted, On Hold, Lost, or Converted to Order."* The verbs are **"Consider"** and
**"Plan for changes"**, not "must". The requirement is directional, not a hard specification. This
should be confirmed with the client before the existing 13-value `EnquiryStatus` enum is disturbed.

**"No confirmed business" rule (§1):** *"At this point, there is no confirmed business."*
Repository: an Enquiry exists with no Booking until acceptance — **this rule is already satisfied.**

---

## 5. Quotation Compliance (§2)

Client's exact field list, in document order.

| # | Client Requirement | Existing Repository | Status |
| --- | --- | --- | --- |
| 1 | **Rate Type** `FIXED` | No quotation; `VehicleHireRateBasis.FIXED` is a *vehicle hire* concept, not a quote rate type | **MISSING** |
| 2 | **Rate** (no example value given) | None | **MISSING** |
| 3 | **Freight** `6000` | Single scalar `final_quoted_price` / `final_price` | **MISSING** |
| 4 | **GST Type** `RCM` | None | **MISSING** |
| 5 | **GST %** `5%` | None | **MISSING** |
| 6 | **Total Freight** `6000` | None | **MISSING** |
| 7 | **Validity** `15 Days` | `quote_validity_hours` + `bookings.quote_valid_until` — **hours, not days** | **INCORRECT** |
| 8 | **Payment Schedule** (container) | None | **MISSING** |
| 9 | **Full Payment in Advance** | None | **MISSING** |
| 10 | **Booking Amount + Advance After Loading + Balance at Unloading** | None | **MISSING** |
| 11 | **Booking Amount** `₹2,000` | None | **MISSING** |
| 12 | **Advance After Loading** `80% of freight, including the booking amount` | None | **MISSING** |
| 13 | **Balance at Unloading** — "The balance is calculated automatically" | None | **MISSING** |
| 14 | **Custom Schedule** | None | **MISSING** |
| 15 | **Milestones** — "add milestones, choose when each is due" | None | **MISSING** |
| 16 | **Fixed amount** (per milestone) | None | **MISSING** |
| 17 | **Percentage** (per milestone) | None | **MISSING** |
| 18 | **Remaining Balance** — "The software shows the remaining balance" | None | **MISSING** |
| 19 | **Additional charges** (section) | None | **MISSING** |
| 20 | **Charges Name** `Ditention` *(client's spelling)* | None | **MISSING** |
| 21 | **Rate** `1500` | None | **MISSING** |
| 22 | **Quantity** `2 Days` | None | **MISSING** |
| 23 | **Total** `3000` | None | **MISSING** |
| 24 | **Total Aditional Charges** `3000` *(client's spelling)* | None | **MISSING** |
| 25 | **Additional charges Tax** *(no value given)* | None | **MISSING** |
| 26 | **Total billing Amount** `9000` | None | **MISSING** |
| 27 | **`[Save Quotation]`** — "saves the rate" | No button; only Prepare Quote / Send Quote | **MISSING** |
| 28 | **`[Download Quotation]`** | No button, no endpoint, **no PDF library in `package.json`** | **MISSING** |
| 29 | **`[Send Quotation]`** — "use Send Quotation and **leave the enquiry open**" | `POST /api/admin/enquiries/:id/send-quote` — real, idempotent, persisted price; but flips status to AWAITING_CUSTOMER_ACCEPTANCE | PARTIALLY IMPLEMENTED |
| 30 | **`[Confirm Order]`** — "select Confirm Order right there on the quotation screen" | No button; only customer-side accept | **MISSING** |
| 31 | **Status** `RATE QUOTED` | `EnquiryStatus.QUOTE_READY` | **INCORRECT** (terminology) |

**Quotation flow rules stated by the client (§2):**
- *"Save Quotation — saves the rate."*
- *"If the customer wants time, use Send Quotation and leave the enquiry open."* → **Send must not convert the enquiry to an order.**
- *"If the customer confirms on the call, select Confirm Order right there on the quotation screen."* → **Confirm Order is an admin-side action on the quotation screen, not only a customer self-service tap.**

---

## 6. GST / RCM Compliance

| Client Requirement | Existing Repository | Status |
| --- | --- | --- |
| GST Type field with value `RCM` | None | **MISSING** |
| GST % field with value `5%` | None | **MISSING** |
| Additional charges Tax field | None | **MISSING** |
| GST appears on Order/Trip Master (§4) | Not on Trip master | **MISSING** |
| GST in Customer Billing (§24): `GST ₹X`, `Invoice Total ₹X` | `Invoice` has no GST fields | **MISSING** |
| GST treated as a separate linked module (closing instruction) | No GST module | **MISSING** |

**Arithmetic of the client's own worked example (§2):**

```
Freight                ₹6,000
GST%  5%             ₹300   (not shown anywhere)
Detention 1500 × 2    ₹3,000
Total Additional       ₹3,000
Total Billing Amount   ₹9,000   ← 6000 + 3000
```

₹9,000 = ₹6,000 + ₹3,000. **GST is not added into the Total Billing Amount**, and
**"Additional charges Tax" is listed with no value** in the example.

**This is an example, not a stated rule.** The document never says *"under RCM, GST is excluded
from the billing amount"* or *"GST is charged on top and payable by the customer"*.

> **RCM ARITHMETIC: NOT SPECIFIED IN CLIENT DOCUMENT.**
> The worked example is *consistent with* RCM excluding GST from Total Billing Amount, and with
> Additional Charges Tax being ₹0 — but consistency is not specification. Whether RCM GST is
> (a) added on top, (b) excluded entirely, (c) shown for information only, or (d) charged on
> additional charges but not freight, **is not defined**. **Must be confirmed with the client.
> Do not implement on assumption.**

---

## 7. Additional Charges Compliance

| Client Requirement | Existing Repository | Status |
| --- | --- | --- |
| Additional charges section on quotation (§2) | None | **MISSING** |
| Charges Name / Rate / Quantity / Total | None | **MISSING** |
| Total Aditional Charges | None | **MISSING** |
| Additional charges Tax | None | **MISSING** |
| Same block repeated on Order/Trip Master (§4) | None | **MISSING** |
| "Additional chrges for company and vendor" at Dispatch (§18) | None | **MISSING** |
| "Additional Charges" at Deliver (§21) | `TripExpense` exists for costs, but not a customer-billing charge | PARTIALLY IMPLEMENTED |

**Formula:** client gives `Rate 1500 × Quantity 2 Days = Total 3000` — i.e. **Total = Rate ×
Quantity**. This is stated by example only, not as a written formula.

---

## 8. Payment Schedule Compliance

| Client Requirement | Existing Repository | Status |
| --- | --- | --- |
| Payment Schedule selector with 3 options | None | **MISSING** |
| Option 1 Full Payment in Advance | None | **MISSING** |
| Option 2 Booking Amount + Advance After Loading + Balance at Unloading | None | **MISSING** |
| Booking Amount `₹2,000` | None | **MISSING** |
| Advance After Loading = `80% of freight, including the booking amount` | None | **MISSING** |
| Balance calculated automatically | None | **MISSING** |
| Option 3 Custom Schedule | None | **MISSING** |
| Milestones with a chosen due point | None | **MISSING** |
| Milestone fixed amount OR percentage | None | **MISSING** |
| Remaining Balance displayed | None | **MISSING** |
| Payment Terms shown on Order/Trip Master (§4) | None | **MISSING** |

**Client's own worked option-2 semantics (§2):**
*"enter Booking Amount: ₹2,000 and Advance After Loading: **80% of freight, including the booking
amount**. The balance is calculated automatically."*

Reading strictly: advance-after-loading is a **percentage of freight**, and that advance
**already contains** the booking amount. On the example's ₹6,000 freight that would be
₹4,800 (of which ₹2,000 is the booking amount), leaving ₹1,200 balance at unloading.

> **CUSTOM SCHEDULE SEMANTICS: PARTIALLY SPECIFIED.**
> Specified: milestones exist, each has a due point, each is fixed amount OR percentage, remaining
> balance is shown.
> **NOT SPECIFIED:** whether percentages are of freight / total billing amount / remaining balance;
> whether the milestone amounts must sum to 100% / 100% of total billing; rounding; whether
> milestones are editable after the order is confirmed; who may edit them.
> **Must be confirmed with the client.**

> **CRITICAL CROSS-DOCUMENT NOTE:** §25 (Customer Payment) states **"No fixed payment schedule."**
> The quotation-stage Payment Schedule (§2) and the post-delivery customer payment model (§25) are
> therefore **two different things**: §2 is a *commercial term recorded on the quotation*; §25 is
> *actual money received with no enforced cadence*. They must not be merged. This confirms the
> instruction to keep customer billing separate from vendor payment.

---

## 9. Order Conversion Compliance (§3, §4)

| Client Requirement | Existing Repository | Status |
| --- | --- | --- |
| CONFIRM ORDER converts enquiry → Order/Trip | `EnquiryService.customerAccept()` → `_createBookingFromEnquiry()` | IMPLEMENTED |
| Order No. `BT-2026-00125` | `BookingNumberService` produces `BTB-…` format | **INCORRECT** (format) |
| Status `ORDER CONFIRMED` | `Booking.status='confirmed'` | PARTIALLY IMPLEMENTED |
| "The enquiry and order remain linked" | `Enquiry.booking_id` `@unique` + relation + index | IMPLEMENTED |
| No duplicate order on repeat confirmation | Conditional `updateMany` claim + `@unique` | IMPLEMENTED |
| Enquiry preserved | `onDelete: SetNull` | IMPLEMENTED |
| Confirm Order available **on the quotation screen** | No such button | **MISSING** |
| Order/Trip Master carries Payment Terms, Rate, Freight, GST Type, GST%, Total Freight | Not on Trip master | **MISSING** |
| Order/Trip Master carries six separate status blocks | Trip/Document/Payment/POD axes exist | PARTIALLY IMPLEMENTED |
| Order/Trip Master progress bar (10 steps) | No such progress bar on order master | **MISSING** |

---

## 10. Status Architecture Compliance (§29, §30, closing instruction)

**§30 is already correctly implemented.** All five required axes exist as independent concepts:

| Axis | Client requirement | Repository | Status |
| --- | --- | --- | --- |
| A. Trip Status | Enquiry → Vehicle → Loading → Dispatch → Transit → Delivery → Completed | `TripStatus` | IMPLEMENTED |
| B. Document Status | Pending / Received / Generated | `TripDocumentStatus` (PENDING/PRESENT/VERIFIED/REJECTED/EXPIRED) | IMPLEMENTED |
| C. Customer Payment Status | Unbilled / Unpaid / Partially Paid / Paid | `InvoiceStatus` = PENDING/GENERATED/PAID/CANCELLED | **INCORRECT** — `Billed`/`Partially Paid` missing |
| D. Vehicle Vendor Payment Status | Unpaid / Partially Paid / Paid | `PaymentStatus` (PENDING/PARTIAL/PAID/CANCELLED/REFUNDED) | IMPLEMENTED |
| E. POD Status | Not Required / Pending / Received | No `pod_required` flag; POD is a `TripDocument` row only | PARTIALLY IMPLEMENTED |

**§29 Master Trip Status vs repository — the document contradicts itself.**

The document gives **two different status lists** for the same journey:

| Step | Header diagram | §29 Master list | Repository `TripStatus` |
| --- | --- | --- | --- |
| 1 | ENQUIRY | ENQUIRY | — (on `EnquiryStatus`) |
| 2 | GIVE RATE | RATE QUOTED | — (on `EnquiryStatus`) |
| 3 | ORDER CONFIRMED | ORDER CONFIRMED | `PENDING` |
| 4 | WAITING FOR VEHICLE | **VEHICLE PENDING** | `PENDING` |
| 5 | VEHICLE HIRED | VEHICLE HIRED | `ASSIGNED` |
| 6 | SENT TO LOADING POINT | **TO LOADING POINT** | `TO_LOADING_POINT` |
| 7 | — | **AT LOADING POINT** | `AT_LOADING_POINT` |
| 8 | LOADED / WAITING FOR DISPATCH | **LOADED** | `LOADED` |
| 9 | DISPATCHED | DISPATCHED | `DISPATCHED` |
| 10 | IN TRANSIT | IN TRANSIT | `IN_TRANSIT` |
| 11 | REACHED DELIVERY POINT | **AT DELIVERY POINT** | *(absent)* |
| 12 | DELIVERED | DELIVERED | `DELIVERED` |
| 13 | POD PENDING | POD PENDING | *(absent)* |
| 14 | POD RECEIVED | POD RECEIVED | *(absent)* |
| 15 | COMPLETED | COMPLETED | `COMPLETED` |
| — | — | CANCELLED (with reason + audit history) | `CANCELLED` |

Five states are named differently between the document's own two lists, and `AT DELIVERY POINT`
is entirely absent from the repository.

> **CLIENT DOCUMENT INTERNAL CONTRADICTION — the document contradicts itself.**
> The document does not define whether the canonical names are the header-diagram names or the
> §29 names. **Do not rename existing statuses on assumption.** Confirm with the client which list
> is authoritative. The safe path is to keep the existing `TripStatus` values (which already align
> with §29) and add the three genuinely missing states.

**§33 History / Audit Trail** — *"Staff should not be able to silently change old records."*
Repository: `AuditLog`, `EnquiryEvent`, `TripTimeline` all append-only — **IMPLEMENTED.**

---

## 11. Existing API Compliance

| Action | HTTP | Endpoint | Controller | Service | DB | Auth | Authz | Idempotent | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Create enquiry | POST | `/api/enquiries` | `enquiryController.createEnquiry` | `EnquiryService.createEnquiry` | `enquiries` insert | `optionalAuth` | public + rate limit | no | IMPLEMENTED |
| Read enquiry (customer) | GET | `/api/enquiries/:idOrNumber` | `getEnquiry` | `loadForCustomer` | read | `optionalAuth` | `assertCustomerAccess` | n/a | IMPLEMENTED |
| Read enquiry (admin) | GET | `/api/admin/enquiries/:id` | `adminEnquiryController.getEnquiry` | `loadForAdmin` | read | `protect` | `adminOnly` | n/a | IMPLEMENTED |
| **Save enquiry** | — | — | — | — | — | — | — | — | **MISSING** |
| Quote Rate | POST | `/api/admin/enquiries/:id/quote` | `saveQuote` | `adminSetQuote` | `final_quoted_price` | `protect` | `adminOnly` | upsert | PARTIALLY IMPLEMENTED |
| Send Quotation | POST | `/api/admin/enquiries/:id/send-quote` | `sendQuote` | `adminSendQuote` | status + `quoted_at` | `protect` | `adminOnly` | **yes** (conditional update) | PARTIALLY IMPLEMENTED |
| **Save Quotation** | — | — | — | — | — | — | — | — | **MISSING** |
| **Download Quotation** | — | — | — | — | — | — | — | — | **MISSING** |
| Confirm Order (customer) | POST | `/api/enquiries/:idOrNumber/accept` | `acceptQuote` | `customerAccept` | Booking create + link | `optionalAuth` | `assertCustomerAccess` | **yes** | IMPLEMENTED |
| **Confirm Order (admin, from quotation)** | — | — | — | — | — | — | — | — | **MISSING** |
| Hire Vehicle | — | `VehicleHireService` wired into trip routes | — | `VehicleHireService` | vehicle hire fields | `protect` | admin | — | PARTIALLY IMPLEMENTED |
| Vendor payment | — | `VendorLedgerService` | — | `VendorLedgerService` | `FinancialTransaction` | `protect` | admin | — | IMPLEMENTED |
| **Payment Voucher PDF** | — | — | — | — | — | — | — | — | **MISSING** |
| **Money Receipt PDF** | — | — | — | — | — | — | — | — | **MISSING** |
| **Challan download/share** | — | — | — | — | — | — | — | — | **MISSING** |
| **Petrol Pump screen/bill/pay** | — | — | — | — | — | — | — | — | **MISSING** |
| **Vehicle Change** | — | — | — | — | — | — | — | — | **MISSING** |
| **Incidents (7 types)** | — | — | — | — | — | — | — | — | **MISSING** |

---

## 12. Existing Database Compliance

`schema.prisma` — 71 models, 40+ enums.

**Enquiry (relevant columns):** `enquiry_number`, `customer_name`, `customer_mobile`,
`pickup_location`, `pickup_address`, `drop_location`, `drop_address`, `distance_km`,
`material`, `quantity`+`quantity_unit`, `weight`+`weight_unit`, `pickup_date`, `pickup_time`,
`special_instructions`, `quote_remarks`, `final_quoted_price`, `price_status`, `status`,
`booking_id`.

**Missing on Enquiry:** `contact_person`, `pickup_city`, `drop_city`, `trip_type`, `vehicle_size`,
`expected_delivery_date`, `enquiry_source`, `assigned_to_admin_id`.

**No Quotation model exists.** No `QuotationCharge`. No `PaymentSchedule`. No `Milestone`.
No `VehicleChange`. No `Incident`. No `PetrolPump`.

**Already correct and reusable:**

| Client concept | Existing schema object |
| --- | --- |
| Billing To (Consignor/Consignee/Third Party/Vehicle Vendor) | `enum VehicleHireBillingTo` — exact match |
| Business Model (Contract/Commission) | `enum VehicleHireBusinessModel` — exact match |
| Rate As Per | `enum VehicleHireRateBasis` (FIXED/PER_TON/PER_KG/PER_DAY/MONTHLY) |
| Commission (percentage / fixed / none) | `CommissionRecord.commission_type`, `commission_rate`, `commission_base`, `commission_amount` |
| Gross / Commission / Net stored separately | `TripFinancial` + `CommissionRecord` — satisfies §10 "store all three separately" |
| Transit Documents checklist + dispatch block | `TripDocument`, `TripDocumentStatus`, `uq_trip_documents_trip_type` |
| POD | `TripDocumentType.POD` + POD fact columns on `Trip` |
| Vehicle Payment Status | `enum PaymentStatus` |
| Trip Timeline / Movement History | `TripTimeline`, `EnquiryEvent`, `AuditLog` |
| Fuel | `TripExpenseType.DIESEL`, `AdvanceType.FUEL_ADVANCE`, `total_fuel_advance` |

**Present but semantically different — do not reuse without a decision:**

| Object | Issue |
| --- | --- |
| `InvoiceStatus` = PENDING/GENERATED/PAID/CANCELLED | Client §24 wants Unbilled/Billed/Partially Paid/Paid |
| `PaymentStatus.REFUNDED` | Client document **never mentions refunds** |
| `gst_number` on Client/Partner/VehicleOwner | Party tax-identity only — **not** quotation GST logic |
| `TripPayment`, `TripAdvance` | Vendor/driver-side payments — must stay separate from customer payment terms |

---

## 13. Existing UI Compliance

| Screen | Client requirement | Repository reality | Status |
| --- | --- | --- | --- |
| `/admin/enquiries/:id` | Enquiry screen with all 19 fields + `[Save]` `[Quote Rate]` | Shows Customer/Pickup/Drop/Driver/Vehicle/Owner/Price; **no Contact Person, no cities, no Trip Type, no Vehicle Size, no Expected Delivery, no Source, no Assigned To, no `[Save]`** | PARTIALLY IMPLEMENTED |
| `/admin/enquiries/:id` | Quotation screen with Give Rate + 4 buttons | `QuoteWorkspace` renders driver/vehicle/final price/validity-in-hours only | **MISSING** |
| Quote validity control | `15 Days` | `VALIDITY_OPTIONS` = 1–48 **hours** | **INCORRECT** |
| Order/Trip master | 20 fields + 6 status blocks + progress bar | Trip master with a different field set | PARTIALLY IMPLEMENTED |
| Vehicle Hire page | One universal page; Billing To → Business Model; Rate As Per; Commission | `vehiclePricing.js`, `CommissionCalculator` exist server-side; UI shape unverified in this audit | PARTIALLY IMPLEMENTED |
| Trip detail tabs | Overview \| Vehicle \| Loading \| Documents \| Billing \| Payments \| POD \| History | Different tab set | PARTIALLY IMPLEMENTED |
| Dashboard (§17, §31) | 11 operational counts + 5 financial alerts | Existing admin dashboard, different tiles | **MISSING** |
| Document Expiry dashboard | Vehicle / Document / Expiry / Status with 🟢🟠🔴 | None | **MISSING** |
| Petrol Pump screen | Credit limit, outstanding, month fuel, transaction list | None | **MISSING** |

---

## 14. Duplicate / Conflicting Systems

### 14.1 Two quote systems — the primary architectural defect

**System A (Enquiry-level)** — the customer's path:
```
POST /api/admin/enquiries/:id/quote        → EnquiryService.adminSetQuote()
                                           → enquiries.final_quoted_price
POST /api/admin/enquiries/:id/send-quote   → EnquiryService.adminSendQuote()
POST /api/enquiries/:idOrNumber/accept     → EnquiryService.customerAccept()
                                           → Booking created from enquiry.final_quoted_price
```

**System B (Booking-level)** — the admin UI's path:
```
POST /api/admin/bookings/:id/prepare-quote → BookingService
                                           → bookings.final_price, quote_status
POST /api/admin/bookings/:id/send-quote    → BookingService
```

`AdminEnquiryDetail.jsx` renders `QuoteWorkspace.jsx`, which calls **System B** and returns early
without a `booking_id`. So the admin writes the quote to a **Booking** while the customer accepts
from an **Enquiry** — two price columns, two price truths.

### 14.2 Other conflicts

| Conflict | Detail |
| --- | --- |
| **Rate Type collision** | `VehicleHireRateBasis.FIXED` exists for vehicle hire; client §2 "Rate Type: FIXED" is a *quotation* concept. Same token, different meaning — must not be conflated. |
| **"Rate" vs "Freight"** | Client §2 lists both `Rate` and `Freight: 6000`. `Rate` has **no example value**. Their relationship is **NOT SPECIFIED**. |
| **GST naming** | `gst_number` (party identity) vs client GST Type/%. Same word, different meaning. |
| **Payment Status duplicated** | `PaymentStatus` (PENDING/PARTIAL/PAID/CANCELLED/REFUNDED) and `InvoiceStatus` (PENDING/GENERATED/PAID/CANCELLED) both attempt customer-payment state, with different vocabularies. |
| **Trip vs Booking duplication** | `Booking` and `Trip` both model the shipment with overlapping fields (`pickup_city`, `distance_km`, `final_price`…). Trip is the client's "one Trip/Order ID"; Booking is a pre-trip artefact. Needs an explicit canonical decision. |

---

## 15. Security Requirements

The document says nothing about authentication, authorization, rate limiting or data protection.
The following is therefore **repository-observed security posture**, not a client requirement —
recorded so it is not lost when the quotation work begins.

| Control | Location | Verdict |
| --- | --- | --- |
| Guest enquiry submission | `middleware/optionalAuth.js` | Preserve |
| Customer ownership proof | `EnquiryService.assertCustomerAccess` | Preserve |
| Quote visibility gate | `EnquiryStateMachine.isQuoteVisibleToCustomer()`; drafts `customerVisible: false` | Preserve |
| Customer acceptance gate | status must be `AWAITING_CUSTOMER_ACCEPTANCE` + price must exist | Preserve |
| Booking creation protection | `Enquiry.booking_id` `@unique` + conditional claim + release on failure | Preserve |
| Idempotency | conditional `updateMany` on accept and send | Preserve |
| Admin authorization | `protect` + `adminOnly` on the admin enquiry router | Preserve |
| Rate limiting | create 10/15min, action 30/10min, read 300/5min | Preserve |
| Helmet / CORS / CSRF | `server.js` | Preserve |

> **No security conflict exists between the client document and the repository.** The client
> document is silent on security, so nothing needs to be traded away to reach compliance.

---

## 16. Requirements Already Implemented — do not rewrite

Enquiry: Enquiry No. (existence), Date, Party, Mobile, Pickup Location, Drop Location, Goods,
Quantity, Weight, Distance, Vehicle Type, Trip Date, Remarks.
The "no confirmed business at enquiry stage" rule.
Order conversion + idempotency + enquiry↔order linkage.
Vehicle Hire Billing To → Business Model auto-derivation.
Rate As Per (FIXED / PER_TON / PER_KG / PER_DAY / MONTHLY).
Commission (percentage / fixed / none) with base and amount stored.
Gross − Commission = Net Vendor Payable, all three stored separately (§10).
Vendor ledger payable/receivable criteria and partial payments.
Three-separated-concepts ledger logic (§C).
TO LOADING POINT / AT LOADING POINT / LOADED / DISPATCHED / IN TRANSIT states.
Transit Documents checklist with mandatory-before-dispatch gating.
POD as a document with its own lifecycle.
Movement History / Trip Timeline (append-only).
Trip Finance: Customer tab, Vendor tab, Trip Margin.
Business Model Contract vs Commission on a single module (§27).
Vehicle payment status axis.
Audit trail / history (§33).
All five §30 status axes exist as separate concepts.

## 17. Requirements Partially Implemented — fix only the missing portion

Quote Rate / Prepare Quote (enquiry-level, real, persisted).
Send Quotation (real, idempotent, persisted — but sends a scalar, not a quotation, and does not
leave the enquiry open).
Enquiry↔Booking conversion (correct but number format differs).
Vehicle Hire page fields.
Vehicle Payment balance criteria.
Payment entry modes (Bank/Cash/Settlement) without fuel-side or PDF.
Trip payment history without automatic settlement of the residual.
Challan download/share (§11).
POD Required? branching (POD exists as a document; no `pod_required` flag).
Delivery recording fields (§21).
Dispatch recording fields (§18).
Document expiry status (EXPIRED exists; no alert thresholds).

## 18. Requirements Missing — nothing exists

**Enquiry:** Contact Person · Pickup City · Drop City · Trip Type · Vehicle Size ·
Expected Delivery · Enquiry Source · Assigned To (staff) · `[Save]` ·
enquiry status vocabulary (Open/Quoted/On Hold/Lost/Converted to Order).

**Quotation:** Quotation entity · Rate Type · Rate · Freight · Total Freight · GST Type · GST % ·
Additional Charges Tax · Additional charges lines · Total Additional Charges · Total Billing Amount ·
Validity in days · Payment Schedule (all 3 options) · Booking Amount · Advance After Loading ·
Balance at Unloading · Custom Schedule · Milestones · Fixed amount · Percentage · Remaining Balance ·
`[Save Quotation]` · `[Download Quotation]` · `[Confirm Order]` · status `RATE QUOTED`.

**Order master:** Payment Terms · Rate · Freight · GST Type · GST% · Total Freight ·
10-step progress bar · separate status blocks on the master page.

**Documents:** Payment Voucher PDF · Money Receipt PDF · Settlement Voucher PDF ·
Challan PDF · **any PDF capability at all** (no library in `package.json`).

**Subsystems:** Vehicle Change (+ history, location, proof) · Incidents (Vehicle Missing, Driver
Unreachable, Accident, Breakdown, Theft, Delivery Problem, Other) · `pod_required` flag ·
Petrol Pump (credit limit, outstanding, monthly bill, pay) · Document Expiry Alerts with 30/15/7-day
thresholds · Document Expiry dashboard · §31 Main Dashboard tiles · Customer Billing invoice
workflow with Unbilled/Billed/Partially Paid/Paid · Customer RECORD PAYMENT action.

## 19. Requirements Incorrectly Implemented

| Requirement | Current | Should be |
| --- | --- | --- |
| Enquiry No. | `BTB-20260926-000123` | `ENQ-2026-00125` |
| Order No. | `BTB-…` | `BT-2026-00125` |
| Validity | hours (1–48) | **Days** (15) |
| Enquiry status vocabulary | ENQUIRY_SUBMITTED … COMPLETED | Open / Quoted / On Hold / Lost / Converted to Order |
| Quotation status | `QUOTE_READY` | `RATE QUOTED` |
| Customer Payment Status | PENDING / GENERATED / PAID / CANCELLED | Unbilled / Unpaid / Partially Paid / Paid |
| Trip status names | `PENDING`, `ASSIGNED` | `ORDER CONFIRMED`, `VEHICLE PENDING`, `VEHICLE HIRED` (§29) |
| `AT DELIVERY POINT` | absent | must exist (§29) |

## 20. Requirements NOT SPECIFIED IN CLIENT DOCUMENT

Per STEP 7 — **not filled with assumptions:**

1. **RCM arithmetic** — whether GST is added to, excluded from, or shown alongside Total Billing
   Amount. The worked example is consistent with exclusion but never states it.
2. **GST tax responsibility** — who remits under RCM; no text.
3. **"Additional charges Tax"** — rate, base, and value; listed with no number in the example.
4. **Refund rules** — no text anywhere. (`PaymentStatus.REFUNDED` is unsourced.)
5. **Overpayment rules** — what happens if a customer pays more than invoiced; no text.
6. **Enquiry number format** — the document shows `ENQ-2026-00125` as an **example only**, and
   states no format rule, prefix rule, or reset rule.
7. **"Rate" vs "Freight" relationship** — both listed; `Rate` has no value; no relationship stated.
8. **Custom schedule semantics** — percentage base; whether milestones must sum to 100%; rounding;
   post-confirmation editability; permissions.
9. **Payment confirmation rules** — who confirms a customer payment; approval thresholds; §25 only
   says `RECORD PAYMENT`.
10. **Quotation versioning / re-quote history** — not addressed.
11. **Quotation expiry behaviour** — Validity is a number; what happens on expiry is not stated.
12. **Booking Amount vs Advance double-count** — "including the booking amount" is stated for
    option 2; whether the same rule applies to Custom Schedule is not.
13. **Discounts / detention-rate tables / charge catalogues** — not specified.
14. **Challan format and contents** — "download challan / share challan" with no template.
15. **Enquiry → Order field carry-over rules** — not enumerated.
16. **Which status list is canonical** (§ header diagram vs §29) — the document contradicts itself.
17. **Who may override Business Model** — "an authorized user" is stated, but the role is not defined.
18. **Currency, rounding, decimal precision** — not specified.
19. **Multi-currency, tax inclusive/exclusive pricing** — not specified.
20. **POD Required? default when unanswered** — not specified.

---

## 21. Recommended Implementation Phases

Based on the actual document's own dependency order. **None of this has been implemented.**

### Phase A — Enquiry (document §1)
Add the nine missing enquiry fields; add `[Save]`; add Enquiry Source and Assigned To.
Add `OPEN`, `ON_HOLD`, `LOST` to the status vocabulary alongside existing values (**do not
rename** pending client confirmation). Renumber the enquiry number format **only after the client
confirms the format rule**.

### Phase B — Quotation (document §2)
Create `Quotation` (enquiry-scoped) + `QuotationCharge` + `QuotationMilestone`. Implement
Rate Type, Rate, Freight, Total Freight, Validity **in days**, Payment Schedule (3 options),
milestones with fixed-or-percentage and remaining balance, Additional Charges with tax, Total
Billing Amount. Add `GST Type` and `GST %` as stored fields.
**Blocked on:** RCM arithmetic (gap 1), rate-vs-freight (gap 7), custom-schedule base (gap 8).

### Phase C — Quotation actions + order conversion (document §2, §3)
`[Save Quotation]` `[Download Quotation]` `[Send Quotation]` `[Confirm Order]`.
Consolidate onto the enquiry-level quote (System A) and remove the Booking-bound dependency from
`QuoteWorkspace`. Send must **leave the enquiry open**. Confirm Order must be idempotent and must
create exactly one Booking. Requires a **PDF library** — none exists.

### Phase D — Order/Trip Master (document §4)
Add Payment Terms, Rate, Freight, GST Type, GST%, Total Freight, additional charges block, the six
status blocks and the 10-step progress bar.

### Phase E — Vehicle Hire + Commission (document §6, §8, §9, §10)
**Substantially already implemented.** Verify UI parity only; add challan download/share.

### Phase F — Vendor payment + vouchers (document §12, A, B, C, D)
Payment Voucher / Money Receipt / Settlement Voucher PDFs; fuel-side voucher; Petrol Pump module.

### Phase G — Loading / Dispatch / Transit / Delivery / POD (document §13–23)
`AT DELIVERY POINT`, `pod_required` flag, POD branching, dispatch field completeness.

### Phase H — Incidents, Vehicle Change, Document Expiry (document §4–15)
VehicleChange model with history/proof/location; 7 incident types with checklists and trip freeze;
expiry alert thresholds 30/15/7 days.

### Phase I — Customer Billing & Payment (document §24, §25, §26)
Independent invoice workflow with Unbilled/Billed/Partially Paid/Paid; RECORD PAYMENT.

### Phase J — Dashboards, Audit, Trip Detail (document §15, §17, §31, §32, §33)

---

## 22. Exact Files That Would Need Changes

**Read-only listing — nothing was modified.**

### Backend
| File | Phase | Reason |
| --- | --- | --- |
| [`prisma/schema.prisma`](../transport-system/backend/prisma/schema.prisma) | A–J | Add enquiry columns, `Quotation`/`QuotationCharge`/`QuotationMilestone`, `VehicleChange`, `Incident`, `PetrolPump`, `pod_required` |
| `prisma/migrations/<new>/migration.sql` | A–J | Additive migration only |
| [`services/EnquiryService.js`](../transport-system/backend/services/EnquiryService.js) | A, C | Save/fields; admin Confirm Order |
| **new** `services/QuotationService.js` | B, C | Quotation CRUD, totals, milestones |
| [`routes/adminEnquiryRoutes.js`](../transport-system/backend/routes/adminEnquiryRoutes.js) | B, C | Save/download/send/confirm-order routes |
| [`controllers/adminEnquiryController.js`](../transport-system/backend/controllers/adminEnquiryController.js) | A, C | New handlers |
| [`dtos/EnquiryDTO.js`](../transport-system/backend/dtos/EnquiryDTO.js) | A | Validate new fields |
| [`utils/EnquiryStateMachine.js`](../transport-system/backend/utils/EnquiryStateMachine.js) | A | OPEN/ON_HOLD/LOST transitions |
| [`package.json`](../transport-system/backend/package.json) | C, F | **PDF library — none exists** |

### Frontend
| File | Phase | Reason |
| --- | --- | --- |
| [`pages/AdminEnquiryDetail.jsx`](../transport-system/frontend/src/pages/AdminEnquiryDetail.jsx) | A–C | New fields, `[Save]`, quotation panel |
| [`components/admin-premium/enquiries/QuoteWorkspace.jsx`](../transport-system/frontend/src/components/admin-premium/enquiries/QuoteWorkspace.jsx) | B, C | Replace booking-bound actions with enquiry quotation actions |
| [`components/admin-premium/enquiries/enquiryStatus.js`](../transport-system/frontend/src/components/admin-premium/enquiries/enquiryStatus.js) | A | Client terminology |
| `components/admin-premium/enquiries/RequestDetails.jsx` | A | New enquiry fields |
| `components/admin-premium/enquiries/CustomerQuotePreview.jsx` | B, C | Quotation preview |
| **new** `components/admin-premium/enquiries/QuotationEditor.jsx` | B | Payment schedule + charges |
| `pages/AdminOrderMaster.jsx` | D | Order master fields + progress bar |

---

## 23. Database Changes Required

**Nothing was changed.** Proposed, additive only:

**Extend `Enquiry`** — `contact_person`, `pickup_city`, `drop_city`, `trip_type`, `vehicle_size`,
`expected_delivery_date`, `enquiry_source`, `assigned_to_admin_id`.

**Extend `EnquiryStatus`** — add `OPEN`, `ON_HOLD`, `LOST`. Additive; existing rows unaffected.

**New `Quotation`** — `quotation_id`, `enquiry_id` (unique, 1 active per enquiry),
`rate_type`, `rate`, `freight`, `total_freight`, `gst_type`, `gst_percentage`,
`additional_charges_total`, `additional_charges_tax`, `total_billing_amount`,
`validity_days`, `payment_schedule_type`, `booking_amount`, `advance_after_loading_percentage`,
`rate_type`, `payment_terms`, `remarks`, `status` (`RATE QUOTED`), `quoted_by`, `quoted_at`,
`sent_at`, timestamps.

**New `QuotationCharge`** — `charge_id`, `quotation_id`, `charges_name`, `rate`, `quantity`,
`quantity_unit`, `total`, sort order.

**New `QuotationMilestone`** — `milestone_id`, `quotation_id`, `due_point`, `amount_type`
(FIXED | PERCENTAGE), `amount_value`, `computed_amount`, `sort_order`.

**Extend `Trip`** — `pod_required`, `pod_status` (NOT_REQUIRED/PENDING/RECEIVED),
`at_delivery_point_at`. Extend `TripStatus` with `AT_DELIVERY_POINT`.

**Extend `InvoiceStatus`** — add `UNBILLED`, `PARTIALLY_PAID` alongside client vocabulary.

**New (later phases)** — `VehicleChange`, `Incident` + `IncidentChecklistItem`, `PetrolPump`,
`PetrolPumpBill`.

---

## 24. API Changes Required

**Nothing was changed.** Proposed:

```
POST   /api/admin/enquiries/:id                     Save enquiry            [Phase A]
POST   /api/admin/enquiries/:id/quotation           Save Quotation          [Phase B]
GET    /api/admin/enquiries/:id/quotation           Read persisted quote    [Phase B]
GET    /api/admin/enquiries/:id/quotation/download  Download Quotation      [Phase C]
POST   /api/admin/enquiries/:id/quotation/send      Send Quotation          [Phase C]
POST   /api/admin/enquiries/:id/confirm-order       Confirm Order (admin)   [Phase C]
```

All behind the existing `protect` + `adminOnly` + write-rate-limiter. Send and Confirm Order must
be idempotent via conditional updates, mirroring the existing `customerAccept` pattern. Download
must render **persisted** data only.

---

## 25. UI Changes Required

**Nothing was changed.** Proposed — **additive only, no redesign**:

| Phase | Change |
| --- | --- |
| A | Add Contact Person, Pickup City, Drop City, Trip Type, Vehicle Size, Expected Delivery, Enquiry Source, Assigned To to the existing enquiry form; add `[Save]`; add Open/On Hold/Lost to the existing status control. **No card, colour, spacing or typography changes.** |
| B | Add a Quotation section to the existing enquiry page: Rate Type, Rate, Freight, Total Freight, GST Type, GST %, Validity (days), Payment Schedule selector, milestone editor, additional-charges line editor, and server-computed totals. |
| C | Add `[Save Quotation] [Download Quotation] [Send Quotation] [Confirm Order]`; rewire `QuoteWorkspace` off the Booking APIs onto the enquiry quotation APIs. |
| D | Add the missing Order/Trip Master fields and the 10-step progress bar. |

---

## 26. Reconciliation of the Previous Audit

`ENQUIRY_QUOTATION_CLIENT_AUDIT.md` was produced from task excerpts only. Re-checked against the
real document:

| Previous finding | Verdict after reading the real document |
| --- | --- |
| Quotation module entirely missing | **CONFIRMED** |
| No payment schedule | **CONFIRMED**, and option-2 semantics now known (80% of freight, incl. booking) |
| No GST logic | **CONFIRMED** |
| Download Quotation missing | **CONFIRMED**, and no PDF library exists at all |
| Enquiry number format conflict | **CONFIRMED** — `ENQ-2026-00125` is client-stated |
| `On Hold` / `Lost` absent | **CONFIRMED** — and the document hedges with "Consider … Plan for changes" |
| Validity in hours vs days | **CONFIRMED** |
| Two competing quote systems | **CONFIRMED** — plus the document's "Send … leave the enquiry open" and "Confirm Order on the quotation screen" rules sharpen the defect |
| Status separation already correct | **CONFIRMED** — §30 maps 1:1 to existing axes |
| Order conversion idempotency correct | **CONFIRMED** |
| Security correct | **CONFIRMED** — document is silent on security |

**Corrections to the previous audit:**

1. **"RCM arithmetic NOT SPECIFIED" — refined, not reversed.** The document *does* supply an
   example whose arithmetic implies exclusion of GST from Total Billing Amount. It still does not
   *state* the rule. Remains unspecified.
2. **"Payment confirmation rules NOT SPECIFIED" — refined.** §25 does specify the mechanics
   (multiple partial payments, running balance, "No fixed payment schedule"), though not approval
   authority.
3. **New finding not in the previous audit:** the document contradicts itself on trip status names
   (header diagram vs §29).
4. **New finding:** `Send Quotation` must leave the enquiry open, and `Confirm Order` must be
   available on the quotation screen — neither is currently true.
5. **New finding:** §25 "No fixed payment schedule" confirms customer payment terms are a
   *different concept* from the §2 quotation Payment Schedule.

---

**NO CODE CHANGES MADE — COMPLETE CLIENT DOCUMENT AUDIT ONLY.**

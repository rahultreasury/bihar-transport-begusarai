# PHASE 2C — BTB CLIENT BUSINESS RULES FINALIZATION

**Date:** 2026-09-23  
**Purpose:** Identify and document business rules that require client confirmation before the final Prisma schema is created.  
**Scope:** BTB (Back-to-Back) client business rules for the enterprise booking module.  
**Constraint:** No code changes, no schema modifications, no migrations, no API creation, no frontend changes.

---

## A. CLIENT CONFIRMATION REQUIRED

Only genuine unanswered business questions where the existing requirements and codebase do not determine the correct behavior.

### A1. Enquiry → Booking Relationship (CRITICAL BLOCKER)

The current system has a single `Booking` entity with a quote workflow (`QuoteStatus`: PENDING → SENT → ACCEPTED/REJECTED/EXPIRED). There is **no separate `Enquiry` entity** in the schema. The task introduces "Enquiry" as a distinct concept with statuses DRAFT, QUOTED, CONFIRMED, WAITING_FOR_VEHICLE, VEHICLE_HIRED, DISPATCHED, IN_TRANSIT, DELIVERED.

**Questions:**

1. **Is "Enquiry" a new entity separate from `Booking`, or is it a rename/alias of the existing `Booking` concept?**
   - The existing `Booking` model already has `quote_status` (PENDING, PREPARING, DRIVER_RESERVED, VEHICLE_RESERVED, QUOTE_SENT, WAITING_CUSTOMER_APPROVAL, ACCEPTED, REJECTED, EXPIRED) and `status` (pending, quote_sent, confirmed, driver_assigned, pickup_started, pickup_completed, in_transit, out_for_delivery, delivered, rejected, cancelled, completed).
   - The proposed enquiry lifecycle (DRAFT → QUOTED → CONFIRMED → WAITING_FOR_VEHICLE → VEHICLE_HIRED → DISPATCHED → IN_TRANSIT → DELIVERED) does NOT match the existing state machine.
   - **CLIENT CLARIFICATION REQUIRED**: Does the client want a new `Enquiry` entity, or should the existing `Booking` entity be extended to support the proposed lifecycle?

2. **If Enquiry is separate from Booking: does Enquiry automatically create a Booking after confirmation, or are they independent?**
   - The existing code shows `BookingService.createBooking()` creates a Booking + Delivery + Invoice atomically. There is no "Enquiry" step.
   - **CLIENT CLARIFICATION REQUIRED**: Confirm whether (A) Enquiry auto-creates Booking on confirmation, (B) Admin manually converts Enquiry to Booking, or (C) Enquiry and Booking remain separate concepts.

3. **Which statuses in the proposed enquiry lifecycle are mandatory vs. optional?**
   - The existing state machine has `canCancel()` that allows cancellation from pending, quote_sent, confirmed, driver_assigned, pickup_started, pickup_completed, in_transit, out_for_delivery.
   - **CLIENT CLARIFICATION REQUIRED**: Which of the proposed statuses (DRAFT, QUOTED, CONFIRMED, WAITING_FOR_VEHICLE, VEHICLE_HIRED, DISPATCHED, IN_TRANSIT, DELIVERED) are mandatory? Can CONFIRMED enquiry remain without a vehicle? When does an enquiry become VEHICLE_HIRED? Can a confirmed enquiry be cancelled? Can a cancelled enquiry be reopened?

### A2. Partial Vehicle Hiring (CRITICAL BLOCKER)

The proposed scenario involves hiring multiple vehicles for a single enquiry (e.g., 1000 bags / 10 tons split across 3 vehicles). The current schema has **no `VehicleHire` entity** — `Booking` has a single `driver_id` and `vehicle_id`.

**Questions:**

1. **Does the first vehicle hire immediately reduce Due Quantity, or only when the hire is CONFIRMED?**
   - No existing code handles partial allocation.
   - **CLIENT CLARIFICATION REQUIRED**: Does PENDING VehicleHire consume quantity? Only CONFIRMED? What happens when a VehicleHire is cancelled?

2. **Can hired quantity exceed enquiry quantity? Can hired weight exceed enquiry weight?**
   - No existing validation exists.
   - **CLIENT CLARIFICATION REQUIRED**: Are over-allocation checks required?

3. **Can quantity and weight be allocated independently across vehicles?**
   - The current schema has `goods_weight_kg` and `number_of_items` as single values on Booking.
   - **CLIENT CLARIFICATION REQUIRED**: Can different vehicles carry different quantities and weights independently?

### A3. Loading / Unloading Points (BLOCKER)

The proposed architecture has Enquiry with multiple LoadingPoints and UnloadingPoints. The current schema has single `pickup_location`/`drop_location` fields on `Booking`.

**Questions:**

1. **Are loading/unloading points attached to the whole enquiry, or can different EnquiryItems use different loading points?**
   - No `EnquiryItem` or `LoadingPoint` model exists.
   - **CLIENT CLARIFICATION REQUIRED**: Confirm the data model — are points enquiry-level or item-level?

2. **Is sequence mandatory for loading/unloading points?**
   - **CLIENT CLARIFICATION REQUIRED**: Must points be ordered? Can the same location appear multiple times? Can points be reordered after confirmation?

3. **Does each point require date/time? Does each point require contact person/contact number?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm mandatory fields per loading/unloading point.

### A4. Material Master (BLOCKER)

The current schema has no `Material` model. `Booking` has free-text `goods_description` and `goods_type`.

**Questions:**

1. **Can admin create new materials? Can customer type a new material?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm material creation workflow.

2. **Are materials reusable master records? Is HSN mandatory? Is material-specific GST required?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm material master data requirements.

3. **Does a material need attributes such as length, dimensions, packaging, etc.?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm material attribute requirements.

### A5. Quantity and Weight Units (BLOCKER)

The current schema has `goods_weight_kg` (Float), `goods_volume` (Float), `number_of_items` (Int). No unit fields exist.

**Questions:**

1. **Which quantity units are allowed? Can admin create new units?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm allowed units (bags, boxes, crates, kg, tons, etc.).

2. **Is weight mandatory? Can quantity be zero? Can quantity be decimal? Can weight be decimal?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm validation rules for quantity and weight.

3. **What does FTL mean in the business process? Is shipping weight different from actual weight? How is charged weight calculated?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm FTL definition and charged weight calculation.

### A6. Pricing Modes (BLOCKER)

The client requires FIXED, PER_TON, PER_KG, PER_DAY, MONTHLY pricing modes. The current system uses flat `final_price` or per-km rates in `vehiclePricing.js`.

**Questions:**

1. **Where is the rate entered — at Enquiry level, VehicleHire level, or both?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm rate storage location.

2. **What quantity is multiplied by the rate for each mode?**
   - **CLIENT CLARIFICATION REQUIRED**: For PER_TON, is it charged weight × rate? For PER_KG, is it actual weight × rate? For PER_DAY, is it number of days × rate?

3. **How are partial vehicle hires priced? Can different VehicleHires have different rates? Can the rate change after confirmation? Is the original quoted rate preserved?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm pricing behavior for partial hires and rate changes.

4. **What happens if weight is missing for PER_TON/PER_KG pricing?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm fallback behavior.

### A7. GST (BLOCKER)

The current schema has no GST calculation logic. `Partner`, `VehicleOwner`, and `Client` have `gst_number` fields, but no GST rate or type fields.

**Questions:**

1. **For each GST type (RCM, FCM, EXEMPT, NON_GST, CUSTOM): Is GST calculated? Is GST added to customer payable? Who pays/remits GST?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm GST treatment per type.

2. **Does GST apply to freight? Does GST apply to additional charges? Can GST differ by material? Can GST differ by customer/client? Can GST rate be customized?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm GST scope and customization rules.

3. **Is GST stored on Enquiry, VehicleHire, Invoice, or another level?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm GST storage location.

### A8. Additional Charges (BLOCKER)

The current schema has `TripExpense` with types: DRIVER, DIESEL, TOLL, LOADING, UNLOADING, OWNER, MAINTENANCE, LABOUR, DOCUMENTATION, PARKING, LOCAL_TRANSPORT, CUSTOMER_RELATED, COMMUNICATION, OTHER. `paid_by` is BIHAR_TRANSPORT or TRANSPORT_OWNER.

**Questions:**

1. **Can one charge belong to multiple levels (Enquiry, VehicleHire, Dispatch)?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm charge ownership model.

2. **Who pays the charge? Is charge included in customer billing? Is charge included in vendor/vehicle settlement? Can charge have GST? Can charge be edited after dispatch?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm charge lifecycle and financial treatment.

### A9. Vehicle Hire Fields (BLOCKER)

The proposed VehicleHire entity has fields: Bill To, Third Party Name, Arranged By, Arranger Name, Arranger Number, Total Quantity, Total Weight, Due Quantity, Due Weight, Quantity, Shipping Weight, Rate As Per, Rate, Charged Weight, Driver Bhara, Transport Commission, Net Bhara, Remarks.

**Questions:**

1. **For every field: required/optional? user-entered/calculated? source of truth? editable after confirmation?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm field-level rules for all 17 VehicleHire fields.

### A10. Dispatch Workflow (BLOCKER)

The current schema has `Delivery` (1:1 with Booking) with `current_status` (DeliveryStatus enum). There is no `Dispatch` entity, no Challan, no POD, no E-Way Bill.

**Questions:**

1. **Is Dispatch manually created or automatically created after VehicleHire confirmation?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm dispatch creation trigger.

2. **Who confirms Dispatch? Is Challan required before dispatch? Is POD required? When is invoice generated? When is E-Way Bill required? Can dispatch be cancelled? Can dispatch information be edited after Trip creation?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm dispatch lifecycle and document requirements.

### A11. Trip Creation Workflow (BLOCKER)

The current `Trip` model exists as a separate entity with `booking_id` (nullable), `source_type` (ONLINE_BOOKING, OFFLINE_CLIENT, DIRECT). `TripStatus`: PENDING, ASSIGNED, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED.

**Questions:**

1. **The proposed workflow says VehicleHire → Dispatch → Dispatch Confirm → Trip automatically created. Is this the client's intended workflow?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm trip creation trigger.

2. **Can one VehicleHire create multiple Trips? Can one Trip have multiple Dispatch records? Can Trip exist before Dispatch? Can Dispatch exist without Trip?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm trip-dispatch cardinality.

### A12. Status History Scope (BLOCKER)

The current schema has `BookingEvent` (records event_type + event_payload) and `AuditLog` (records previous_value + new_value as JSON snapshots).

**Questions:**

1. **Should EnquiryStatusHistory record only status changes, or all field changes?**
   - **CLIENT CLARIFICATION REQUIRED**: Confirm whether status history and field-change history are separate concepts or unified.

---

## B. ALREADY CONFIRMED BY REQUIREMENTS

These are answered by the existing codebase, schema, and planning documents. Do NOT ask the client again.

### B1. Enquiry Workflow — Existing State Machine (CLIENT CONFIRMED)

The existing `BookingStateMachine` (`transport-system/backend/utils/BookingStateMachine.js:26-59`) defines the canonical lifecycle:

```
pending → quote_sent → confirmed → driver_assigned → pickup_started
  → pickup_completed → in_transit → out_for_delivery → delivered → completed
```

- **Terminal statuses**: `rejected`, `cancelled`, `completed`, `delivered` (`BookingStateMachine.js:41`)
- **Cancellation allowed from**: pending, quote_sent, confirmed, driver_assigned, pickup_started, pickup_completed, in_transit, out_for_delivery (`BookingStateMachine.js:43-58`)
- **Cancelled/rejected bookings cannot restart** (`BookingStateMachine.js:17-18`)
- **Quote must be accepted before confirmation**: `BookingService.confirmBooking()` enforces `quote_status === 'ACCEPTED'` before allowing `confirmed` status (`BookingService.js:229-233`)
- **final_price required for delivered/completed** (`BookingService.js:120-122`)

### B2. Enquiry → Booking — Quote Workflow (CLIENT CONFIRMED)

The existing `TODO_QUOTE_WORKFLOW.md` and `BookingService.js` define the workflow:

- Admin sends quote with `sendQuoteWithReservation()` — reserves driver + vehicle, sets `quote_status = 'SENT'`, `status = 'quote_sent'` (`BookingService.js:654-822`)
- Customer accepts/rejects via `respondToQuote()` — atomic transaction, converts reservations, creates BookingAssignment, marks driver/vehicle busy (`BookingService.js:433-592`)
- Quote expiry auto-releases reservations (`BookingService.js:829-849`)
- Invoice NOT auto-generated on accept — module ready, wired later on delivery completion (`TODO_QUOTE_WORKFLOW.md:34`)
- Every critical operation uses a single Prisma transaction (`TODO_QUOTE_WORKFLOW.md:35`)
- Every status change records a timeline event (`TODO_QUOTE_WORKFLOW.md:36`)
- Backend validates quote expiry before accepting (`TODO_QUOTE_WORKFLOW.md:37`)

### B3. Vehicle / Driver Availability (CLIENT CONFIRMED)

`ResourceAvailabilityService.js` defines the behavior:

- `markDriverBusy()` / `markVehicleBusy()` set `status = 'on_trip'` and `is_available = false` atomically (`ResourceAvailabilityService.js:34-61`)
- `releaseDriverIfNoActiveTrip()` / `releaseVehicleIfNoActiveTrip()` check for other active trips before releasing (`ResourceAvailabilityService.js:110-165`)
- `ACTIVE_TRIP_STATUSES = ['PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED']` — a vehicle/driver CAN have multiple historical hires but only one active trip at a time (`ResourceAvailabilityService.js:16`)
- Vehicle becomes unavailable when assigned to an active trip; becomes available again when no active trips remain (`ResourceAvailabilityService.js:99-103`)

### B4. Financial System — FinancialTransaction as Canonical Ledger (CLIENT CONFIRMED)

`TripFinancialService.js` and `FinancialTransaction` model confirm:

- `FinancialTransaction` is the SINGLE SOURCE OF TRUTH for all trip financials (`schema.prisma:1249-1250`)
- `TripFinancial` is a cached summary, updated from transactions (`TripFinancialService.js:5-7`)
- Transaction types: CUSTOMER_PAYMENT, CLIENT_PAYMENT, DRIVER_ADVANCE, FUEL_ADVANCE, OWNER_ADVANCE, DRIVER_SETTLEMENT, OWNER_SETTLEMENT, COMMISSION, TRIP_EXPENSE, EXPENSE_REIMBURSEMENT, ADJUSTMENT, REFUND, REVERSAL (`schema.prisma:181-195`)
- Direction: DEBIT (money out from BT), CREDIT (money in to BT) (`schema.prisma:1263`)
- Parties: BIHAR_TRANSPORT, CUSTOMER, CLIENT, TRANSPORT_OWNER, DRIVER, VENDOR, OTHER (`schema.prisma:198-206`)
- Commission is FIXED at 5% (`commissionPolicy.js:52`) — does NOT vary by owner, vehicle, driver, customer, route, trip, or date
- BT Margin = customer_fare - driver_payout - commission (`TripFinancialService.js:112`)

### B5. Trip Model — Standalone or Booking-Linked (CLIENT CONFIRMED)

`Trip` model (`schema.prisma:1324-1384`):

- Trip can be created independently or from a Booking (`booking_id` is nullable)
- `source_type`: ONLINE_BOOKING, OFFLINE_CLIENT, DIRECT
- Trip has its own `freight_amount`, `driver_payment`, `owner_payment`
- TripStatus: PENDING, ASSIGNED, IN_TRANSIT, DELIVERED, COMPLETED, CANCELLED
- Trip CANNOT be marked COMPLETED while customer due > 0 (`TripService.js:324-330`)

### B6. Booking Number Format (CLIENT CONFIRMED)

- Canonical booking number: `BTB-YYYY-NNNNN` derived from DB primary key (`BookingService.js:68-69`, `TODO.md:3`)
- `booking_reference` mirrors `booking_number` for backward compatibility (`BookingService.js:73`)

### B7. Quote Expiry (CLIENT CONFIRMED)

- Default quote validity: 2 hours (`BookingService.js:754`)
- Backend validates expiry before accepting (`BookingService.js:408-419`)
- Expired quotes release driver+vehicle reservations (`BookingService.js:836-837`)

### B8. Driver Assignment — Driver Required, Vehicle Optional (CLIENT CONFIRMED)

- Admin selects only the driver — never a vehicle separately (`BookingService.js:665-667`)
- System auto-resolves the driver's current active vehicle from the Driver record (`BookingService.js:742-752`)
- Vehicle ownership validation: vehicle must belong to the selected driver (`BookingService.js:738-739`)

### B9. Trip Expense Types (CLIENT CONFIRMED)

`TripExpenseType` enum (`schema.prisma:108-123`): DRIVER, DIESEL, TOLL, LOADING, UNLOADING, OWNER, MAINTENANCE, LABOUR, DOCUMENTATION, PARKING, LOCAL_TRANSPORT, CUSTOMER_RELATED, COMMUNICATION, OTHER.

- `paid_by`: BIHAR_TRANSPORT or TRANSPORT_OWNER (`schema.prisma:129-132`)
- Only `paid_by = BIHAR_TRANSPORT` expenses reduce BT Net Profit (`schema.prisma:126-128`)

### B10. Booking Cancellation Rules (CLIENT CONFIRMED)

- `canCancel()` allows cancellation from: pending, quote_sent, confirmed, driver_assigned, pickup_started, pickup_completed, in_transit, out_for_delivery (`BookingStateMachine.js:97-99`)
- Cancelled bookings are terminal — cannot restart (`BookingStateMachine.js:57`)

---

## C. ARCHITECTURAL DECISIONS

These are engineering decisions the team can make without client approval. They are inferred from the existing codebase patterns and best practices.

### C1. Enquiry Entity Design

- **Decision**: If the client confirms Enquiry is a new entity, it should follow the existing `Booking` pattern — use a Prisma model with a status enum, snapshot fields for immutability, and a timeline/event table for history.
- **Rationale**: The existing `Booking` + `BookingEvent` + `BookingTimeline` pattern is proven and consistent.

### C2. VehicleHire Entity Design

- **Decision**: If partial vehicle hiring is confirmed, create a `VehicleHire` model with a 1:N relationship to Enquiry, including `hired_quantity`, `hired_weight`, `status` (PENDING/CONFIRMED/CANCELLED), and foreign keys to `TransportVehicle` and `Driver`.
- **Rationale**: Follows the existing `Reservation` model pattern (`schema.prisma:1037-1061`).

### C3. Loading/Unloading Points Design

- **Decision**: If multi-point loading/unloading is confirmed, create `LoadingPoint` and `UnloadingPoint` models with a sequence field, attached to the Enquiry (or EnquiryItem if item-level is confirmed).
- **Rationale**: Follows the existing `BookingAssignment` pattern with ordering.

### C4. Material Master Design

- **Decision**: If materials are confirmed as master records, create a `Material` model with `name`, `hsn_code`, `gst_rate`, and optional attributes. Use a many-to-many or foreign key from EnquiryItem to Material.
- **Rationale**: Follows the existing `Partner` / `VehicleOwner` master data pattern.

### C5. Unit of Measure Design

- **Decision**: If units are confirmed, create a `UnitOfMeasure` master table with `code`, `name`, `category` (quantity/weight), and `is_active`. Reference from EnquiryItem.
- **Rationale**: Follows the existing `PartnerDocumentType` enum pattern but as a table for admin extensibility.

### C6. Pricing Mode Design

- **Decision**: If pricing modes are confirmed, add a `pricing_mode` field to VehicleHire (or Enquiry) with enum values FIXED, PER_TON, PER_KG, PER_DAY, MONTHLY. Store `rate` and `charged_weight` on VehicleHire. Calculate `charged_amount` as a derived field.
- **Rationale**: Follows the existing `commission_type` pattern (percentage/fixed) on Booking and Partner.

### C7. GST Design

- **Decision**: If GST is confirmed, add `gst_type` (enum: RCM, FCM, EXEMPT, NON_GST, CUSTOM), `gst_rate` (Float), and `gst_amount` (Float) to the appropriate entity (Enquiry/VehicleHire/Invoice). Store `gst_type` at the Enquiry level for customer billing, and at the VehicleHire level for vendor settlement.
- **Rationale**: Follows the existing `gst_number` pattern on Partner/VehicleOwner/Client, extended with rate and type.

### C8. Additional Charges Design

- **Decision**: If charges are confirmed, create an `AdditionalCharge` model with `charge_type` (enum), `amount`, `paid_by`, `belongs_to` (Enquiry/VehicleHire/Dispatch), and `is_included_in_billing` / `is_included_in_settlement` booleans.
- **Rationale**: Follows the existing `TripExpense` pattern with `paid_by` and `expense_type`.

### C9. Dispatch Entity Design

- **Decision**: If Dispatch is confirmed as a new entity, create a `Dispatch` model with `challan_number`, `pod_reference`, `eway_bill_number`, `status`, and foreign keys to VehicleHire and Trip. Dispatch creation should be triggered by VehicleHire confirmation (if client confirms auto-creation).
- **Rationale**: Follows the existing `Delivery` model pattern (1:1 with Booking), extended for the BTB workflow.

### C10. Status History Design

- **Decision**: Keep `EnquiryStatusHistory` (status changes only) separate from `AuditLog` (all field changes). Use the existing `BookingEvent` pattern for status history and `AuditLog` for field-change history.
- **Rationale**: The existing codebase already separates these concepts — `BookingEvent` records status events, `AuditLog` records field snapshots (`schema.prisma:1294-1315`).

### C11. Trip Creation from Dispatch

- **Decision**: If the client confirms auto-trip-creation from Dispatch, implement it as a transactional operation: Dispatch confirm → create Trip → mark Dispatch as trip_created. Use the existing `TripService.createTrip()` pattern.
- **Rationale**: Follows the existing `BookingService.acceptQuote()` pattern of atomic multi-entity creation.

### C12. Charged Weight Calculation

- **Decision**: If charged weight is confirmed, implement as: `charged_weight = max(actual_weight, volumetric_weight)` where `volumetric_weight = (length × width × height) / dimensional_factor`. The dimensional factor should be a configurable constant (default 5000 for cm³/kg or 166 for inches³/lb).
- **Rationale**: Standard logistics industry practice; follows the existing `commissionPolicy.js` pattern of centralized business constants.

---

## D. FINAL BUSINESS RULE MATRIX

| Area | Rule | Source | Status |
|------|------|--------|--------|
| Enquiry Lifecycle | Lifecycle: DRAFT → QUOTED → CONFIRMED → WAITING_FOR_VEHICLE → VEHICLE_HIRED → DISPATCHED → IN_TRANSIT → DELIVERED | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Enquiry Lifecycle | Which statuses are mandatory? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Enquiry Lifecycle | Can CONFIRMED enquiry remain without a vehicle? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Enquiry Lifecycle | When does enquiry become VEHICLE_HIRED? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Enquiry Lifecycle | Can enquiry be cancelled after confirmation? | `BookingStateMachine.js:43-58` | CLIENT CONFIRMED |
| Enquiry Lifecycle | Can cancelled enquiry be reopened? | `BookingStateMachine.js:17-18` | CLIENT CONFIRMED (No) |
| Enquiry → Booking | Is Enquiry a new entity or alias of Booking? | Task proposal vs `schema.prisma:548` | CLIENT CLARIFICATION REQUIRED |
| Enquiry → Booking | Auto-create Booking after confirmation? | `BookingService.js:54-100` | CLIENT CLARIFICATION REQUIRED |
| Enquiry → Booking | Admin manually converts Enquiry to Booking? | `BookingService.js:218-266` | CLIENT CLARIFICATION REQUIRED |
| Enquiry → Booking | Enquiry and Booking remain separate? | `BookingService.js:54-100` | CLIENT CLARIFICATION REQUIRED |
| Enquiry → Booking | Quote must be accepted before confirmation | `BookingService.js:229-233` | CLIENT CONFIRMED |
| Enquiry → Booking | final_price required for delivered/completed | `BookingService.js:120-122` | CLIENT CONFIRMED |
| Partial Vehicle Hiring | First hire immediately reduces Due Quantity? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | Does PENDING VehicleHire consume quantity? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | Only CONFIRMED VehicleHire consumes quantity? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | What happens when VehicleHire is cancelled? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | Can hired quantity exceed enquiry quantity? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | Can hired weight exceed enquiry weight? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Partial Vehicle Hiring | Can quantity and weight be allocated independently? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Vehicle Availability | Same vehicle can have multiple historical hires | `ResourceAvailabilityService.js:16` | CLIENT CONFIRMED |
| Vehicle Availability | Vehicle cannot have two active hires | `ResourceAvailabilityService.js:143-165` | CLIENT CONFIRMED |
| Vehicle Availability | Driver cannot have two active hires | `ResourceAvailabilityService.js:110-133` | CLIENT CONFIRMED |
| Vehicle Availability | Vehicle becomes unavailable when trip starts | `ResourceAvailabilityService.js:52-61` | CLIENT CONFIRMED |
| Vehicle Availability | Vehicle becomes available when no active trips remain | `ResourceAvailabilityService.js:143-165` | CLIENT CONFIRMED |
| Vehicle Availability | ACTIVE_TRIP_STATUSES = PENDING, ASSIGNED, IN_TRANSIT, DELIVERED | `ResourceAvailabilityService.js:16` | CLIENT CONFIRMED |
| Loading/Unloading | Points attached to whole enquiry? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Different EnquiryItems use different loading points? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Sequence mandatory? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Same location can appear multiple times? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Points reorderable after confirmation? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Each point requires date/time? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Loading/Unloading | Each point requires contact person/number? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | Admin can create new materials? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | Customer can type new material? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | Materials are reusable master records? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | HSN mandatory? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | Material-specific GST required? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Material | Material needs length, dimensions, packaging? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Which quantity units are allowed? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Admin can create new units? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Weight mandatory? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Quantity can be zero? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Quantity can be decimal? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Weight can be decimal? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | FTL definition in business process? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Shipping weight vs actual weight? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Quantity/Weight | Charged weight calculation? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | FIXED mode — rate entered where? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | PER_TON mode — what quantity × rate? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | PER_KG mode — what quantity × rate? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | PER_DAY mode — what quantity × rate? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | MONTHLY mode — what quantity × rate? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | What happens if weight is missing? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | How are partial vehicle hires priced? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | Different VehicleHires can have different rates? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | Rate stored at Enquiry level? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | Rate stored at VehicleHire level? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | Rate can change after confirmation? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Pricing | Original quoted rate preserved? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | RCM — GST calculated? Added to customer payable? Who remits? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | FCM — GST calculated? Added to customer payable? Who remits? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | EXEMPT — GST calculated? Added to customer payable? Who remits? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | NON_GST — GST calculated? Added to customer payable? Who remits? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | CUSTOM — GST calculated? Added to customer payable? Who remits? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST applies to freight? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST applies to additional charges? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST differs by material? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST differs by customer/client? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST rate can be customized? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| GST | GST stored on Enquiry, VehicleHire, Invoice, or other? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charges can belong to Enquiry? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charges can belong to VehicleHire? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charges can belong to Dispatch? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | One charge belongs to multiple levels? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Who pays the charge? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charge included in customer billing? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charge included in vendor/vehicle settlement? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charge can have GST? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Additional Charges | Charge can be edited after dispatch? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Vehicle Hire Fields | All 17 fields: required/optional, user-entered/calculated, source of truth, editable after confirmation | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Dispatch manually created? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Dispatch auto-created after VehicleHire confirmation? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Who confirms Dispatch? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Challan required before dispatch? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | POD required? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | When is invoice generated? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | When is E-Way Bill required? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Can dispatch be cancelled? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Dispatch | Can dispatch info be edited after Trip creation? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Trip Creation | VehicleHire → Dispatch → Dispatch Confirm → Trip auto-created? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Trip Creation | One VehicleHire can create multiple Trips? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Trip Creation | One Trip can have multiple Dispatch records? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Trip Creation | Trip can exist before Dispatch? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Trip Creation | Dispatch can exist without Trip? | Task proposal | CLIENT CLARIFICATION REQUIRED |
| Financial System | Customer billing belongs to FinancialTransaction | `schema.prisma:1251-1292` | CLIENT CONFIRMED |
| Financial System | Freight belongs to FinancialTransaction | `schema.prisma:1251-1292` | CLIENT CONFIRMED |
| Financial System | GST belongs to FinancialTransaction | `schema.prisma:1251-1292` | CLIENT CONFIRMED |
| Financial System | Additional charges belong to FinancialTransaction | `schema.prisma:1251-1292` | CLIENT CONFIRMED |
| Financial System | Driver Bhara belongs to FinancialTransaction | `TripFinancialService.js:159-204` | CLIENT CONFIRMED |
| Financial System | Transport Commission belongs to FinancialTransaction | `TripFinancialService.js:92-107` | CLIENT CONFIRMED |
| Financial System | Net Bhara belongs to FinancialTransaction | `TripFinancialService.js:112` | CLIENT CONFIRMED |
| Financial System | Owner settlement belongs to FinancialTransaction | `TripFinancialService.js:109-120` | CLIENT CONFIRMED |
| Financial System | Commission is FIXED at 5% | `commissionPolicy.js:52` | CLIENT CONFIRMED |
| Financial System | Trip CANNOT be COMPLETED while customer due > 0 | `TripService.js:324-330` | CLIENT CONFIRMED |
| Status History | EnquiryStatusHistory records only status changes | `BookingStateMachine.js:43-59` | CLIENT CLARIFICATION REQUIRED |
| Status History | All field changes recorded separately | `AuditLog` model `schema.prisma:1294-1315` | CLIENT CLARIFICATION REQUIRED |
| Booking Number | Canonical format: BTB-YYYY-NNNNN | `BookingService.js:68-69` | CLIENT CONFIRMED |
| Booking Number | booking_reference mirrors booking_number | `BookingService.js:73` | CLIENT CONFIRMED |
| Quote Expiry | Default validity: 2 hours | `BookingService.js:754` | CLIENT CONFIRMED |
| Quote Expiry | Backend validates expiry before accepting | `BookingService.js:408-419` | CLIENT CONFIRMED |
| Quote Expiry | Expired quotes release reservations | `BookingService.js:836-837` | CLIENT CONFIRMED |
| Driver Assignment | Admin selects driver only, vehicle auto-resolved | `BookingService.js:665-667` | CLIENT CONFIRMED |
| Driver Assignment | Vehicle must belong to selected driver | `BookingService.js:738-739` | CLIENT CONFIRMED |
| Trip Model | Trip can be standalone or Booking-linked | `schema.prisma:1324-1384` | CLIENT CONFIRMED |
| Trip Model | Trip source_type: ONLINE_BOOKING, OFFLINE_CLIENT, DIRECT | `schema.prisma:93-97` | CLIENT CONFIRMED |
| Trip Expense | Expense types: DRIVER, DIESEL, TOLL, LOADING, UNLOADING, OWNER, MAINTENANCE, LABOUR, DOCUMENTATION, PARKING, LOCAL_TRANSPORT, CUSTOMER_RELATED, COMMUNICATION, OTHER | `schema.prisma:108-123` | CLIENT CONFIRMED |
| Trip Expense | paid_by: BIHAR_TRANSPORT or TRANSPORT_OWNER | `schema.prisma:129-132` | CLIENT CONFIRMED |
| Trip Expense | Only BIHAR_TRANSPORT expenses reduce BT Net Profit | `schema.prisma:126-128` | CLIENT CONFIRMED |

---

## E. FINAL BLOCKERS

Only the questions that actually prevent creating the final production database schema:

1. **Enquiry vs. Booking entity** — The proposed enquiry lifecycle (DRAFT → QUOTED → CONFIRMED → WAITING_FOR_VEHICLE → VEHICLE_HIRED → DISPATCHED → IN_TRANSIT → DELIVERED) does not match the existing `BookingStateMachine` lifecycle (pending → quote_sent → confirmed → driver_assigned → pickup_started → pickup_completed → in_transit → out_for_delivery → delivered → completed). The schema cannot be finalized until the client confirms whether Enquiry is a new entity or a rename of Booking, and which lifecycle is authoritative.

2. **Enquiry → Booking conversion** — The existing code auto-creates Booking + Delivery + Invoice in a single transaction (`BookingService.createBooking()`). The task proposes three possible workflows (auto-create, manual convert, separate). The schema cannot be finalized until the client confirms the conversion mechanism.

3. **Partial Vehicle Hiring** — The current `Booking` model has single `driver_id` and `vehicle_id`. The proposed multi-vehicle hiring requires a new `VehicleHire` entity with allocation logic. The schema cannot be finalized until the client confirms: (a) whether PENDING or CONFIRMED hires consume quantity, (b) whether over-allocation is allowed, (c) whether quantity and weight are allocated independently.

4. **Loading/Unloading Points** — The current schema has single `pickup_location`/`drop_location`. Multi-point loading/unloading requires new `LoadingPoint`/`UnloadingPoint` models. The schema cannot be finalized until the client confirms: (a) whether points are enquiry-level or item-level, (b) whether sequence is mandatory, (c) whether points are editable after confirmation, (d) mandatory fields per point.

5. **Material Master** — No `Material` model exists. The schema cannot be finalized until the client confirms: (a) whether materials are admin-created master records, (b) whether HSN is mandatory, (c) whether material-specific GST is required, (d) what material attributes are needed.

6. **Quantity/Weight Units** — No unit fields exist. The schema cannot be finalized until the client confirms: (a) allowed units, (b) whether admin can create new units, (c) whether quantity/weight can be zero or decimal, (d) FTL definition, (e) charged weight calculation.

7. **Pricing Modes** — No pricing mode fields exist. The schema cannot be finalized until the client confirms: (a) where rates are entered (Enquiry vs VehicleHire), (b) what quantity is multiplied by rate for each mode, (c) how partial hires are priced, (d) whether rates can change after confirmation, (e) fallback when weight is missing.

8. **GST** — No GST calculation logic exists. The schema cannot be finalized until the client confirms: (a) GST treatment per type (RCM, FCM, EXEMPT, NON_GST, CUSTOM), (b) whether GST applies to freight and additional charges, (c) whether GST differs by material/customer, (d) whether GST rate is customizable, (e) where GST is stored.

9. **Additional Charges** — No `AdditionalCharge` model exists. The schema cannot be finalized until the client confirms: (a) which levels charges belong to (Enquiry/VehicleHire/Dispatch), (b) who pays charges, (c) whether charges are included in customer billing and vendor settlement, (d) whether charges can have GST, (e) whether charges can be edited after dispatch.

10. **VehicleHire Fields** — No `VehicleHire` entity exists. The schema cannot be finalized until the client confirms all 17 fields: required/optional, user-entered/calculated, source of truth, and editability after confirmation.

11. **Dispatch Workflow** — No `Dispatch` entity exists. The schema cannot be finalized until the client confirms: (a) whether Dispatch is manually or automatically created, (b) who confirms Dispatch, (c) whether Challan/POD/E-Way Bill are required, (d) when invoice is generated, (e) whether dispatch can be cancelled or edited after Trip creation.

12. **Trip Creation Workflow** — The proposed workflow (VehicleHire → Dispatch → Dispatch Confirm → Trip auto-created) is not implemented. The schema cannot be finalized until the client confirms: (a) whether this is the intended workflow, (b) whether one VehicleHire can create multiple Trips, (c) whether one Trip can have multiple Dispatches, (d) whether Trip can exist before Dispatch, (e) whether Dispatch can exist without Trip.

13. **Status History Scope** — The existing codebase has both `BookingEvent` (status changes) and `AuditLog` (all field changes). The schema cannot be finalized until the client confirms whether EnquiryStatusHistory should record only status changes or all field changes.

---

PHASE 2C COMPLETE — WAITING FOR CLIENT BUSINESS RULE CONFIRMATION.

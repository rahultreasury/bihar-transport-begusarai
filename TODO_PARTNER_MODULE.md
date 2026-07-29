# Transport Partner Module - Implementation TODO

## Architecture Overview

```
Transport Partner
├── Trucks (multiple per partner)
├── Drivers (assignable, reassignable)
├── Ledger (immutable)
├── Payments
├── Settlements (lockable)
└── Documents
```

## Implementation Order

### PHASE 1: Prisma Schema & Database Migration ✅ COMPLETE
- [x] 1.1 Add Partner model
- [x] 1.2 Add Truck support (partner_id FK in TransportVehicle)
- [x] 1.3 Add PartnerLedger model (immutable, running balance)
- [x] 1.4 Add PartnerPayment model
- [x] 1.5 Add Settlement model
- [x] 1.6 Add PartnerDocument model
- [x] 1.7 Add DriverAssignment model (driver reassignment history)
- [x] 1.8 Modify Driver model (add partner_id FK, add performance_rating)
- [x] 1.9 Modify Booking model (add partner_id, commission, settlement, snapshot fields)
- [x] 1.10 Modify TransportVehicle (add partner_id FK, body_type)
- [x] 1.11 Run Prisma migration (`cd transport-system/backend && npx prisma migrate dev --name add_partner_module`)

### PHASE 2: Backend Services & Repositories ✅ COMPLETE
- [x] 2.1 Create PartnerRepository.js
- [x] 2.2 Create PartnerService.js
- [x] 2.3 PartnerLedgerService.js (integrated into PartnerRepository - immutable ledger, reversal logic)
- [x] 2.4 SettlementService.js (integrated into PartnerService - auto-generation, locking)
- [x] 2.5 PartnerDriverService.js (integrated into PartnerService - driver assignment/reassignment)
- [x] 2.6 Booking integration hooks (commission calculation, snapshot storage, auto-ledger update)

### PHASE 3: Backend API Routes ✅ COMPLETE
- [x] 3.1 Create partnerRoutes.js
  - [x] GET /api/admin/partners - List with search/filter/pagination
  - [x] POST /api/admin/partners - Create partner
  - [x] GET /api/admin/partners/:id - Profile with summary
  - [x] PUT /api/admin/partners/:id - Update
  - [x] DELETE /api/admin/partners/:id - Soft delete
  - [x] PATCH /api/admin/partners/:id/status - Toggle status
  - [x] GET /api/admin/partners/:id/dashboard - Summary cards
  - [x] GET /api/admin/partners/:id/ledger - Paginated ledger
  - [x] POST /api/admin/partners/:id/ledger - Record transaction (immutable)
  - [x] POST /api/admin/partners/:id/ledger/reversal - Reversal entry
  - [x] GET /api/admin/partners/:id/payments - Payment history
  - [x] POST /api/admin/partners/:id/payments - Record payment
  - [x] GET /api/admin/partners/:id/trucks - List trucks
  - [x] POST /api/admin/partners/:id/trucks - Add truck
  - [x] DELETE /api/admin/partners/trucks/:id - Remove truck
  - [x] GET /api/admin/partners/:id/documents - List documents
  - [x] GET /api/admin/partners/:id/drivers - List partner's drivers
  - [x] POST /api/admin/partners/:id/assign-driver - Assign driver
  - [x] POST /api/admin/partners/:id/reassign-driver - Reassign driver
- [x] 3.4 Create partnerSettlementRoutes.js
  - [x] GET /api/admin/settlements - List all
  - [x] GET /api/admin/partners/:id/settlements - Partner's settlements
  - [x] POST /api/admin/settlements/generate - Auto-generate
  - [x] GET /api/admin/settlements/:id - Detail
  - [x] PUT /api/admin/settlements/:id/status - Update status
  - [x] POST /api/admin/settlements/:id/lock - Lock settlement
- [x] 3.9 Register all new routes in server.js

### PHASE 4: Frontend - API Layer ✅ COMPLETE
- [x] 4.1 Add partner API calls to api.js

### PHASE 5: Frontend - Pages & Components ✅ COMPLETE
- [x] 5.1 Create AdminPartners.jsx (list page with search, filter, pagination, stats)
- [x] 5.2 Create AdminPartnerProfile.jsx (profile page with 7 tabs: Overview, Trucks, Drivers, Ledger, Payments, Settlements, Documents)
- [x] 5.3 Create AdminSettlements.jsx (settlement management with filters, status updates, locking)
- [x] 5.5 Update AdminSidebar.jsx (add "Transport Partners" and "Settlements" nav items)
- [x] 5.6 Update App.jsx (add routes for partners, partner profile, settlements)
- [ ] 5.7 Update AdminDashboard.jsx (add partner KPIs)
- [ ] 5.8 Update AdminBookings.jsx (add partner column, snapshot, commission)

### PHASE 6: Components Library 🔲 PENDING
- [ ] 6.1 Create PartnerRegisterModal.jsx
- [ ] 6.2 Create PartnerFilters.jsx
- [ ] 6.3 Create PartnerStatusBadge.jsx
- [ ] 6.4 Create PartnerSummaryCards.jsx
- [ ] 6.5 Create PartnerLedgerTable.jsx
- [ ] 6.6 Create PartnerTransactionModal.jsx (predefined expense categories)
- [ ] 6.7 Create PartnerPaymentModal.jsx
- [ ] 6.8 Create PartnerSettlementCard.jsx

### PHASE 7: Booking Integration 🔲 PENDING
- [ ] 7.1 Update booking creation to store snapshot data (partner name, driver name, truck number, mobile)
- [ ] 7.2 Create booking completion hook (auto-commission, auto-ledger)
- [ ] 7.3 Update booking status change to update partner ledger
- [ ] 7.4 Add commission configuration UI to partner form

### PHASE 8: Settlement Engine 🔲 PENDING
- [ ] 8.1 Settlement auto-calculation logic (handled in PartnerService.generateSettlement)
- [ ] 8.2 Settlement locking mechanism (handled in lockSettlement)
- [ ] 8.3 PDF generation for settlements
- [ ] 8.4 Settlement status workflow (implemented: pending → paid → locked)

### PHASE 9: Reports 🔲 PENDING
- [ ] 9.1 Create AdminPartnerReports.jsx page
- [ ] 9.2 Implement report data endpoints
- [ ] 9.3 Add export functionality (CSV, PDF)
- [ ] 9.4 Add charts for revenue trends

### PHASE 10: Data Migration & Testing 🔲 PENDING
- [ ] 10.1 Create migration script for existing TransportVehicle → Truck + Partner
- [ ] 10.2 Create migration script to link existing drivers to partners
- [ ] 10.3 Create migration script to add snapshot data to existing bookings
- [ ] 10.4 Test all CRUD operations
- [ ] 10.5 Test ledger balance calculations
- [ ] 10.6 Test settlement generation
- [ ] 10.7 Test booking integration
- [ ] 10.8 Test data integrity
- [ ] 10.9 Test backward compatibility

## Business Rules

1. One partner can own multiple trucks
2. Drivers can be reassigned between partners (history preserved via DriverAssignment)
3. Partner ledger is immutable - no edits or deletes. Use reversal entries for corrections
4. Monthly settlements lock financial records for that period
5. Commission is configurable per partner (% or fixed amount)
6. Every booking stores snapshot data (partner name, driver name, truck number, mobile)
7. Deleting a booking must not corrupt financial records
8. Predefined expense categories must be used for all transactions
9. Running balance is calculated from all ledger entries

## Expense Categories
- Fuel Advance
- Driver Advance
- Toll
- Repair
- Penalty
- Bonus
- Cash
- Online Transfer
- Other Expense

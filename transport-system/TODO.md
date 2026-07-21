# Booking Module Phase 2 - Implementation Tracker

> Phase 1 must not be modified.

## Information gathered
- Current booking routes exist in `transport-system/backend/routes/bookingRoutes.js`.
- Driver assignment exists in `transport-system/backend/routes/driverRoutes.js`.
- Admin booking management exists in `transport-system/backend/routes/adminRoutes.js` (includes status PATCH).
- DB schema is created in `transport-system/backend/config/database.js`.
- There is also `transport-system/database/schema.sql` (MySQL flavored; may differ from SQLite implementation).

## Phase 2 Plan (high level)
1. Add enterprise booking support tables (without breaking existing ones):
   - `booking_events` (timeline)
   - `booking_statuses` (canonical list)
   - `booking_assignments` (driver/vehicle assignment history)
   - indexes for search/filter/analytics
2. Implement professional booking number:
   - `booking_reference` upgrade logic: keep existing `BTB-*` values backward compatible.
   - add `booking_number` (or new format column) + generate enterprise-style identifier.
3. Implement Booking Lifecycle:
   - unify state transitions with strict validation (no breaking existing API routes)
   - add internal lifecycle service used by new APIs and existing assignment/status endpoints where safe.
4. Add Booking Timeline APIs:
   - GET booking timeline/events
   - include event type, timestamp, actor (customer/admin/driver/system)
5. Add Booking Status APIs (enterprise):
   - GET current status, and transitions
   - POST/PUT admin-driven status update via new endpoint (existing PATCH kept)
6. Add Booking History + Search + Filters:
   - GET user booking history with filtering params
   - POST search endpoint for advanced filters
7. Driver Assignment + Vehicle Assignment:
   - add assignment request/approval flow (enterprise), while keeping existing accept-job flow.
8. Booking Analytics:
   - metrics by status, SLA, completion time, cancellation rate, revenue over time
9. Booking Validation improvements:
   - validate status transitions
   - add payload validation (pickup/drop fields, goods, vehicle_type_required)
   - add OTP/state validation guards
10. Database optimization:
   - add indexes and denormalized columns for fast reads
11. Transactions:
   - wrap critical assignments/status updates in DB transactions.
12. Proper repository pattern:
   - introduce repository layer under `transport-system/backend/repositories/`
   - introduce service layer under `transport-system/backend/services/booking/`
13. Unit tests:
   - add Jest tests for repositories/services with sqlite in-memory (or temp db)

## Progress
- [ ] Step 1: Add new tables + indexes + keep backward compatibility.
- [ ] Step 2: Add professional booking number generator + column.
- [ ] Step 3: Implement lifecycle + validations.
- [ ] Step 4: Timeline APIs.
- [ ] Step 5: Booking status APIs.
- [ ] Step 6: History search filters APIs.
- [ ] Step 7: Assignment APIs.
- [ ] Step 8: Analytics APIs.
- [ ] Step 9: Transaction + repository refactor.
- [ ] Step 10: Unit tests.



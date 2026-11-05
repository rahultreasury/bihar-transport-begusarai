# Phase 2 - Enterprise Booking Module Plan

## Goal
Transform the booking module into an enterprise logistics booking system (Porter/Delhivery/Uber Freight/BlackBuck style) by adding timeline, status history, search/filtering, analytics, and a repository/service architecture—**without modifying Phase 1 APIs**.

## Information gathered (from code reading)
- Core booking APIs (Phase 1) live in: `transport-system/backend/routes/bookingRoutes.js`.
- Driver assignment endpoints live in: `transport-system/backend/routes/driverRoutes.js` (e.g., accept-job updates bookings + deliveries).
- Admin booking status endpoints live in: `transport-system/backend/routes/adminRoutes.js`.
- DB schema initialization happens in: `transport-system/backend/config/database.js` (SQLite).
- There’s also an older MySQL schema in: `transport-system/database/schema.sql` (informational; not the runtime DB).

## Implementation rules honored
- No breaking changes to frontend or existing APIs.
- No removal of existing APIs.
- Additive-only schema changes; never delete/rename existing columns.
- Keep backward compatibility for existing `booking_reference` values.

## Files to be modified/added
### Modify
- `transport-system/backend/config/database.js`
- `transport-system/backend/server.js` (register new Phase 2 routes)

### Add
- `transport-system/backend/routes/enterpriseBookingRoutes.js`
- `transport-system/backend/routes/enterpriseBookingAdminRoutes.js`
- `transport-system/backend/routes/enterpriseBookingDriverRoutes.js`
- `transport-system/backend/repositories/BookingRepository.js`
- `transport-system/backend/repositories/BookingTimelineRepository.js`
- `transport-system/backend/repositories/AssignmentRepository.js`
- `transport-system/backend/repositories/EnterpriseBookingRepository.js`
- `transport-system/backend/services/enterpriseBooking/bookingLifecycleService.js`
- `transport-system/backend/services/enterpriseBooking/enterpriseBookingNumber.js`
- `transport-system/backend/services/enterpriseBooking/enterpriseBookingValidation.js`
- `transport-system/backend/services/enterpriseBooking/enterpriseBookingAnalyticsService.js`
- `transport-system/backend/utils/transaction.js` (sqlite transaction helper)
- `transport-system/backend/utils/apiResponse.js`
- `transport-system/backend/test/enterpriseBooking.test.js`

## New APIs to be added (additive only)
All endpoints are under `/api/enterprise/bookings`.

1. **Professional Booking Number**
   - (internal) derive `BTB-YYYY-000001` and store in `booking_number`
2. **Timeline**
   - `GET /api/enterprise/bookings/:bookingId/timeline`
3. **Status APIs**
   - `GET /api/enterprise/bookings/:bookingId/status`
   - `POST /api/enterprise/bookings/:bookingId/status` (admin-only; validates transitions)
4. **History + Search**
   - `GET /api/enterprise/bookings/history?search=&status=&fromDate=&toDate=&limit=&page=` (customer)
   - `POST /api/enterprise/bookings/search` (advanced filters)
5. **Filters**
   - embedded into search endpoints
6. **Driver/Vehicle Assignment (enterprise)**
   - `POST /api/enterprise/bookings/:bookingId/assign` (admin/dispatcher)
   - `GET /api/enterprise/bookings/assignable?pickupCity=&vehicleType=&date=`
7. **Analytics**
   - `GET /api/enterprise/bookings/analytics?fromDate=&toDate=` (admin)

## Database changes (additive)
- Add `booking_number` column to `bookings` (nullable initially for backward compatibility).
- Create new tables:
  - `booking_events` (timeline/status history)
  - `booking_assignments` (assignment history)
  - `booking_search_cache` (optional, left out unless needed)
- Add indexes for fast search/filter:
  - `bookings(status, pickup_city, drop_city, pickup_date, booking_number)`
  - `booking_events(booking_id, created_at)`
  - `booking_assignments(booking_id, created_at)`

## Transactions
- Wrap all enterprise assignment/status mutations in sqlite transaction helper.

## Unit tests
- Cover:
  - booking number generation uniqueness format
  - status transition validation
  - timeline event insertion
  - search/filter query builder

## Completion criteria
- All existing APIs continue working.
- New endpoints return expected shapes and correct status timeline.
- Unit tests pass.


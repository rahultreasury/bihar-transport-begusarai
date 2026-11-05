# Phase 2 - Controller Integration TODO

## Info gathered
- `transport-system/backend/routes/bookingRoutes.js` contains all booking endpoints and direct DB access.
- `transport-system/backend/services/BookingService.js` provides domain methods:
  - `createBooking(input)`
  - `updateBooking(bookingId, input)`
  - `cancelBooking(bookingId)`
  - `completeBooking(bookingId)`
  - `searchBookings(filters)`
- No `transport-system/backend/controllers/bookingController.js` exists in repo; booking logic lives in routes.

## Plan (high-level)
1. Refactor `transport-system/backend/routes/bookingRoutes.js` endpoints to call `BookingService` methods.
2. Replace controller/route duplicated business rules (validation, status transitions, event creation) with `BookingService` domain calls.
3. Map `BookingService` domain exceptions:
   - `ValidationError` -> 400
   - `NotFoundError` -> 404
   - other -> 500
4. Preserve response formats & HTTP codes currently used by existing endpoints.
5. Ensure authorization checks in routes remain unchanged (so endpoints/behavior stay backward compatible).
6. Run backend tests (or smoke via running server + curl) to verify booking APIs continue working.

## Dependent files
- `transport-system/backend/routes/bookingRoutes.js`
- Possibly `transport-system/backend/services/BookingService.js` only if error mapping/types need small non-architectural adjustments.

## Followup steps
- Start server and run a minimal set of booking API calls:
  - POST `/api/bookings/create`
  - GET `/api/bookings/my-bookings`
  - GET `/api/bookings/:id`
  - PUT `/api/bookings/:id/cancel`
  - GET `/api/bookings/track/:reference`

## Progress
- [ ] Prepare integration edit plan with exact endpoint mapping.
- [ ] Implement changes in bookingRoutes.js.
- [ ] Verify business logic removed from bookingRoutes.
- [ ] Run smoke tests.


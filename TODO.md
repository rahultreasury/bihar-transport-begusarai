# Bihar Transport — Booking System Fixes (Approved Plan)

Booking-number canonicalization (BTB-YYYY-NNNNN) is ALREADY implemented and verified.
Do NOT restructure it. Focus on confirmed remaining gaps.

## Backend
- [ ] 1. `getBookingForTracking` → accept canonical `booking_number` (legacy `booking_reference` still works)
- [ ] 2. `bookingController.js` → remove leftover random `booking_reference` generation
- [ ] 3. `BookingMapper.js` → add camelCase `bookingNumber` field
- [ ] 4. Structured error contract (`error: { code, message }`) for quote + assignment APIs
- [ ] 5. Driver assignment → auto-assign driver's registered vehicle (verify backend already does this)

## Frontend
- [ ] 6. `App.jsx` → wire `/admin/bookings/:bookingNumber` and `/admin/bookings/:bookingNumber/assign-driver`
- [ ] 7. `AdminBookings.jsx` → View → read-only page; Assign Driver → dedicated page; remove Assign Vehicle button
- [ ] 8. `AdminBookingDetail.jsx` → remove Assign Vehicle button (read-only stays)
- [ ] 9. `AdminAssignDriver.jsx` → confirm vehicle is info-only (no dropdown)

## Testing
- [ ] 10. Backend tests pass
- [ ] 11. Frontend build passes

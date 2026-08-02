# TODO — Quote-Based Booking Workflow

## Goal
Extend the existing booking flow into a brokerage workflow:
Booking Received → Final Quote Sent → Customer Accepted Quote →
Searching Driver → Driver Assigned → Pickup Completed → Journey Started → Delivered

## Backend

- [x] 1. `prisma/schema.prisma` — add `quote_status`, `quote_remarks`,
        `quote_sent_at`, `quote_accepted_at` to `Booking`.
- [x] 2. `repositories/BookingRepository.js` — allow quote fields in create/update.
- [x] 3. `services/BookingService.js` — add `sendQuote` + `respondToQuote` service methods.
- [x] 4. `routes/adminRoutes.js`:
        - `POST /api/admin/bookings/:id/send-quote` ({ final_price, remarks })
        - include quote fields in GET /admin/bookings & GET /admin/bookings/:id
        - status update to `confirmed` requires quote ACCEPTED
- [x] 5. `routes/bookingRoutes.js`:
        - `POST /api/bookings/:id/quote/accept` → ACCEPTED + status=confirmed
        - `POST /api/bookings/:id/quote/reject` → REJECTED
        - extend `GET /track/:reference` with quote fields + driver details

## Frontend

- [x] 6. `services/api.js` — add `sendQuote`, `acceptQuote`, `rejectQuote`.
- [x] 7. `src/pages/AdminBookings.jsx` — replace Confirm with Send Quote modal.
- [x] 8. `src/components/admin-premium/booking/BookingDetailsDrawer.jsx`:
        - remove Assign Vehicle card; keep Assign Driver only
        - assignment captures driver + vehicle info (name, phone, vehicle number, type, owner)
- [x] 9. `src/components/tracking/ProgressTimeline.jsx` — new step sequence:
        Booking Received → Final Quote Sent → Customer Accepted Quote →
        Searching Driver → Driver Assigned → Pickup Completed → Journey Started → Delivered
- [x] 10. `src/pages/TrackBooking.jsx`:
         - Accept/Reject Quote UI when quote_status === SENT (Final Freight Charge)
         - driver contact card (name, phone, vehicle number, Call Driver) after assignment
- [x] 11. Verify builds: frontend `npm run build`; backend syntax + prisma generate.


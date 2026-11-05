# Quote → Confirmation Sync Fix

## Goal
Make `quote_status` the single source of truth for booking confirmation.
Support both online (CUSTOMER) and offline/phone (ADMIN) confirmation without
ever leaving the DB in an inconsistent state.

## Invariants
- `status == confirmed` ⇒ `quote_status == ACCEPTED`
- `quote_status == ACCEPTED` ⇒ frontend shows Confirmed everywhere
- Never allow `status=confirmed` with `quote_status` in {PENDING, SENT, ...}

## Steps
- [x] Add `confirmation_source` (CUSTOMER | ADMIN) to Booking schema + migration
- [x] BookingRepository: allow `confirmation_source`, set on create
- [x] BookingService.acceptQuote: set `confirmation_source=CUSTOMER`, timeline `QUOTE_ACCEPTED_BY_CUSTOMER`
- [x] BookingService.bulkUpdateStatus: confirming sets `quote_status=ACCEPTED`, `confirmation_source=ADMIN`, `confirmed_at`, timeline `BOOKING_CONFIRMED_BY_ADMIN`
- [x] BookingService.confirmBooking: explicit admin manual-confirm method
- [x] adminRoutes PATCH /bookings/:id/status: confirming auto-syncs quote_status/source
- [x] Frontend: derive confirmation from quote_status (TrackBooking, BookingHeader, ProgressTimeline, StatusCard, BookingDetailsDrawer)
- [x] Regression tests (customer accept, admin confirm, offline confirm, inconsistent-state prevention)

# Quote Workflow — Frontend Redesign (Tracking + Admin)

## Goal
Redesign the customer tracking page and admin booking drawer to surface the
enterprise quote → approval → confirmation workflow. Backend is already complete.

## Customer Tracking Page States (driven by `booking.quote_status`)
- `PENDING` / `QUOTE_REQUESTED` / `QUOTE_PREPARING` → **Booking Received** + "Finding Best Market Price…" (NO price, NO Confirmed)
- `SENT` → **FINAL QUOTE READY** card: price + live countdown + Accept / Reject
- `ACCEPTED` / `confirmed` → **Booking Confirmed** + driver/vehicle/ETA
- `REJECTED` / `EXPIRED` → clean informational state + support + wait for revised quote

## Phase 1 — New Reusable Tracking Components
- [x] `QuoteCountdown.jsx` — live HH:MM:SS countdown to quote expiry
- [x] `QuoteStatusBadge.jsx` — badge for quote_status
- [x] `QuoteCard.jsx` — final quote card (price, countdown, Accept/Reject)
- [x] `DriverVehicleCard.jsx` — confirmed driver + vehicle + ETA
- [x] Build check

## Phase 2 — Redesign Existing Tracking Components
- [x] `BookingHeader.jsx` — quote-aware, no "Booking Confirmed" unless accepted
- [x] `StatusCard.jsx` — quote-aware status + "Finding Best Market Price…"
- [x] `ProgressTimeline.jsx` — timeline driven by backend events/status
- [x] `ActivityFeed.jsx` — render backend timeline events only
- [x] `BookingDetails.jsx` — hide price until accepted; show reservation details
- [x] Build check

## Phase 3 — Wire up TrackBooking.jsx
- [x] Display quote-aware components (QuoteCard / DriverVehicleCard)
- [x] Accept/Reject handlers calling `bookingAPI.acceptQuote` / `rejectQuote`
- [x] Refresh tracking after accept/reject
- [x] Build check

## Phase 4 — Admin Booking Details Drawer
- [x] Add Send Quote workflow: Final Price input + Reserved Driver + Reserved Vehicle + Quote Validity + Send Quote button
- [x] Call `adminAPI.sendQuote`
- [x] Build check

## Phase 5 — Final Verification
- [x] Full frontend build passes
- [x] Existing features still work
- [x] Backend `getBookingForTracking` returns `bookingEvents` (fix applied)
- [x] Backend syntax checks pass (`node --check`)
- [x] Backend starts & Prisma connects successfully
- [x] New quote workflow functions correctly (tracking returns quote_status, reservation, bookingEvents)

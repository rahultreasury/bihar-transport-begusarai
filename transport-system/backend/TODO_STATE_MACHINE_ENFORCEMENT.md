# TASK 2 — ENFORCE THE BOOKING STATE MACHINE EVERYWHERE

Goal: NO booking status may be changed by directly writing an arbitrary status.
Every transition must pass through `BookingStateMachine.validateTransition(currentStatus, requestedStatus)`.

## Canonical Lifecycle
pending → quote_sent → confirmed → driver_assigned → pickup_started → pickup_completed → in_transit → out_for_delivery → delivered → completed
Terminals: rejected, cancelled

## Steps
1. [x] BookingStateMachine.js — add `driver_assigned` to statuses + transitions
2. [x] deliveryRoutes.js — POST /complete: validate transition → delivered, add event, atomic
3. [ ] adminRoutes.js — PATCH /status: remove inline allowed list, use state machine, add event, transaction
4. [ ] adminRoutes.js — assign-driver: validate transition → driver_assigned
5. [ ] adminRoutes.js — assign-driver-details: validate transition → driver_assigned
6. [ ] driverRoutes.js — update-status: already validates; add timeline event + actor
7. [ ] driverRoutes.js — accept-job: validate transition → confirmed
8. [ ] bookingRoutes.js — cancellation: use canCancel/validateTransition, add event
9. [ ] BookingService.js — confirmBooking, acceptQuote, rejectQuote, sendQuote, sendQuoteWithReservation: validate transitions
10. [ ] Tests — stateMachineEnforcement.test.js (valid + invalid + endpoint-paths)
11. [ ] Run test suite
12. [ ] Report (files, remaining direct writes, migration?, behavior changes)

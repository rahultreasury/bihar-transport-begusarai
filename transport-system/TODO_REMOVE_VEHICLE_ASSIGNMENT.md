# TODO: Remove Vehicle Assignment System (Brokerage Model)

## Goal
Bihar Transport is a broker (commission agent). Remove the Booking ↔ Vehicle
assignment relationship entirely. Keep Driver assignment, Partner truck
inventory, and Booking.vehicle_type_required.

## Backend
- [ ] `services/BookingService.js` — remove vehicle_id from sendQuoteWithReservation, acceptQuote, getBookingForTracking
- [ ] `services/BookingAssignmentService.js` — remove assignVehicle
- [ ] `services/DriverManagementService.js` — remove assignVehicle, getAvailableVehicles
- [ ] `repositories/BookingRepository.js` — remove vehicle_id from create/update
- [ ] `repositories/BookingAnalyticsRepository.js` — remove getVehicleUtilization
- [ ] `repositories/BookingAssignmentRepository.js` — remove assigned_vehicle_id, assignVehicle
- [ ] `repositories/ReservationRepository.js` — remove vehicle_id from create/update/getActiveByBooking
- [ ] `repositories/DriverRepository.js` — remove assignVehicle, getAvailableVehicles, transportVehicles includes
- [ ] `repositories/PartnerRepository.js` — remove vehicle-related references (keep truck inventory)
- [ ] `routes/adminRoutes.js` — remove /vehicles, /vehicles/:id/verify, /bookings/:id/assign-vehicle, vehicle_id in send-quote, totalVehicles in dashboard
- [ ] `routes/driverManagementRoutes.js` — remove vehicle assignment routes
- [ ] `routes/bookingRoutes.js` — remove vehicle_id references in booking creation

## Frontend
- [ ] `pages/BookingDetailsDrawer.jsx` — remove vehicle card, modal, handlers
- [ ] `services/api.js` — remove assignVehicle, getVehicles, getAvailableVehicles
- [ ] `components/tracking/DriverVehicleCard.jsx` — remove vehicle display
- [ ] `pages/TrackBooking.jsx` — remove vehicle references
- [ ] `pages/AdminDrivers.jsx` — remove vehicle column
- [ ] `pages/AdminDriverProfile.jsx` — remove vehicle display
- [ ] `pages/AdminPartnerProfile.jsx` — remove vehicle assignment references (keep truck inventory)
- [ ] `pages/AdminBookings.jsx` — remove vehicle column references
- [ ] Delete `components/admin-premium/drivers/DriverVehicleAssignModal.jsx`

## Verification
- [ ] Repository-wide search: ZERO references to Booking↔Vehicle assignment
- [ ] `node --check` all modified backend files
- [ ] Frontend build passes

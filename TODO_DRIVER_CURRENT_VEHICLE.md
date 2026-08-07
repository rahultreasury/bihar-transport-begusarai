# TODO: Driver → Current Active Vehicle (Booking Flow)

## Goal
Every Driver has ONE CURRENT ACTIVE VEHICLE. The Booking module must use that
vehicle automatically. Admin never selects a vehicle separately.

## Steps
- [ ] Backend: `DriverRepository.findAssignable()` — include `vehicle_id` when a
      TransportVehicle exists for the driver (vehicle_id may be null otherwise).
- [ ] Backend: `BookingService.sendQuoteWithReservation()` — make `vehicle_id`
      optional; auto-resolve the driver's current active vehicle.
- [ ] Frontend: `BookingDetailsDrawer.jsx` — rename "Assigned Vehicle" →
      "Current Vehicle"; remove vehicle_id from payload; validate only that the
      driver has an active vehicle.
- [ ] Verify: driver selected → current vehicle auto-displayed → quote sent.

## Constraints
- Do NOT modify database schema.
- Do NOT remove TransportVehicle.
- Do NOT remove vehicle_id support (make it OPTIONAL).
- Only modify the three listed files.

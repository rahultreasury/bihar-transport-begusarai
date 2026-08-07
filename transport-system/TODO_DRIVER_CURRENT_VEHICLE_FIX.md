# TODO: Driver Current Vehicle — Booking Flow Fix

## Goal
Every Driver has ONE CURRENT ACTIVE VEHICLE. The Booking module must use that
vehicle automatically. Validate only that the driver has an active vehicle linked.

## Scope (ONLY these two files)
- [ ] `frontend/src/components/admin-premium/booking/BookingDetailsDrawer.jsx`
- [ ] `backend/services/BookingService.js`

## Steps
1. [ ] Fix `handleSelectPickerDriver` so UI (Current Vehicle card) and validation
       use the SAME resolved object (`selectedQuoteVehicle`). Add defensive
       assertion — never render a vehicle while reporting "no active vehicle".
2. [ ] Update `BookingService.sendQuoteWithReservation` so `vehicle_id` is OPTIONAL.
       - `driver_id` required.
       - If `vehicle_id` provided → keep existing validation.
       - If `vehicle_id` missing → auto-resolve driver's current active vehicle
         from the Driver record (`vehicle_number`). Validate only that
         `driver.vehicle_number` exists; otherwise throw
         "This driver does not have an active vehicle."
       - Single validation path, no duplicate vehicle validation.

## Verification
- [ ] `node --check` modified backend file
- [ ] Frontend build passes
- [ ] Run booking flow: Driver selected → Current Vehicle shown → Quote sent

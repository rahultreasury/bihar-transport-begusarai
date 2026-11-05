# Database Foundation — TODO (Path A: Retain TransportVehicle architecture)

## Steps

- [x] 1. Re-add `vehicle_id` + `transportVehicle` relations + indexes to `Booking` in `schema.prisma`
- [x] 2. Re-add `vehicle_id` + relation + index to `Delivery` in `schema.prisma`
- [x] 3. Re-add `assigned_vehicle_id` + relation + index to `BookingAssignment` in `schema.prisma`
- [x] 4. Re-add `vehicle_id` + relation + index to `Reservation` in `schema.prisma`
- [x] 5. Add inverse `Booking[]`, `Delivery[]`, `BookingAssignment[]`, `Reservation[]` relations on `TransportVehicle`
- [x] 6. Fix `InvoiceRepository.create()` to map `amount` → `final_price`
- [x] 7. Remove duplicate migration `20260806000000_repair_drivers_vehicle_fields`
- [ ] 8. Verify: `prisma validate`
- [ ] 9. Verify: `prisma generate`
- [ ] 10. Verify: `prisma migrate status`
- [ ] 11. Run `npm test`

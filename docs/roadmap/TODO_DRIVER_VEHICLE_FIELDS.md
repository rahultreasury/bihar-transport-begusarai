# TODO: Driver Vehicle Information Enhancement

Task: Add vehicle_type and vehicle_number to the Driver registration module.

> NOTE: These vehicle fields are a TEMPORARY MVP solution stored directly on the
> `Driver` model. Vehicle-related logic is intentionally isolated in
> `DriverManagementService` (see `normalizeVehicleNumber`, `validateVehicleNumber`,
> `assertVehicleNumberUnique`). In a future release these fields should move into a
> dedicated `Vehicle` entity (vehicle_number unique, vehicle_type, owner_id, status,
> insurance/permit/fitness details) with drivers linked through an assignment
> relationship. Migration path: read `driver.vehicle_number`/`driver.vehicle_type`,
> create a `Vehicle` row, and link via `DriverAssignment`.

## Backend
- [x] 1. Prisma schema: add `vehicle_type`, `vehicle_number` (unique) to `Driver`
- [x] 2. New migration SQL for the new columns + unique index
- [x] 3. DriverRepository: add `findByVehicleNumber`, add vehicle_number to search
- [x] 4. DriverManagementService: normalize/validate/duplicate-check vehicle number
- [x] 5. driverManagementRoutes: POST/PUT validation + 409 duplicate response

## Frontend
- [x] 6. DriverRegisterModal: searchable Vehicle Type dropdown + Vehicle Number input
- [x] 7. AdminDrivers: add Vehicle Type + Vehicle Number columns, search, mobile card
- [x] 8. AdminDriverProfile: show Vehicle Type + Vehicle Number under contact info

## Follow-up
- [x] 9. Apply migration + regenerate Prisma client
- [x] 10. Verify POST/PUT/dedup/409 + search by vehicle number

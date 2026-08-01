# Consistency Repair TODO

Goal: Make the existing project internally consistent and production ready (Prisma schema ↔ code).

## Steps

- [x] Step 0: Complete consistency audit (schema, migration, repos, services, routes, frontend)
- [x] Step 1 (Fix 1): Remove `notes` references from Driver stack
  - [x] backend/services/DriverManagementService.js — remove `notes` from register/update payloads
  - [x] frontend/src/components/admin-premium/drivers/DriverRegisterModal.jsx — remove `notes` form field/UI
- [x] Step 2 (Fix 2): Fix DriverRepository.getTrips() — remove invalid `delivery.estimated_distance_km` select
- [x] Step 3 (Fix 3, limited): Fix corrupt SOURCE_DATABASE_URL in archived migrate script (parse-only fix)
- [x] Step 4 (Fix 4): DriverFilters.jsx — backend-only statuses (available, on_trip, inactive)
- [x] Step 5 (Fix 5): Verify remaining frontend files for removed-field references
- [ ] Step 6: Verify ZERO references to `notes`, `estimated_distance_km` (delivery), removed KYC fields
- [ ] Step 7: Run `prisma validate` and `prisma generate`
- [ ] Step 8: Final consistency report


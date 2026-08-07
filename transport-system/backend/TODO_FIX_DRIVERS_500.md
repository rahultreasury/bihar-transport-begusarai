# TODO — Permanent Fix: GET /api/admin/drivers HTTP 500

Root cause (empirically proven):
- Live `drivers` table missing `vehicle_type` + `vehicle_number` → Prisma P2022 → HTTP 500.
- Legacy `GET /api/admin/drivers` in `adminRoutes.js` shadows the Driver Management module.

## Steps
- [x] 1. Create additive-only Prisma migration for missing `drivers` columns
- [x] 2. Apply migration to live DB (`prisma migrate deploy`)
- [x] 3. Run `npx prisma generate`
- [x] 4. Remove legacy `GET /drivers` from `adminRoutes.js` (remove direct prisma access)
- [x] 5. Update `server.js` mount order (no shadowed routes)
- [x] 6. Convert `driverManagementRoutes` to asyncHandler + next(error) (no masked 500)
- [x] 7. Move any remaining direct Prisma driver access into DriverRepository
- [ ] 8. Add regression tests `tests/adminDrivers.test.js`
- [ ] 9. Verify GET /api/admin/drivers returns HTTP 200 `{ success:true, data:[] }`
- [ ] 10. Final report with proofs

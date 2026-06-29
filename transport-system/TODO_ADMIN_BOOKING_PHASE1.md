# TODO - Admin Booking Management (Phase 1)

This file tracks Phase 1 work for Admin Dashboard booking management.

## Backend tasks
- [ ] Inspect `transport-system/backend/routes/adminRoutes.js` and confirm missing endpoints
- [ ] Add (if missing):
  - [ ] GET `/api/admin/bookings/:id`
  - [ ] PUT `/api/admin/bookings/:id`
  - [ ] DELETE `/api/admin/bookings/:id`
  - [ ] PATCH `/api/admin/bookings/:id/status`
- [ ] Ensure all new endpoints are protected by `protect` and role-checked
- [ ] Validate payloads with existing patterns (express-validator not used in adminRoutes.js yet; keep consistent)

## Frontend tasks
- [ ] Update `transport-system/frontend/src/services/api.js` with admin booking methods
- [ ] Update `transport-system/frontend/src/pages/AdminDashboard.jsx` bookings tab:
  - [ ] Add state for search/filter/date/pagination
  - [ ] Add UI controls (responsive)
  - [ ] Add booking row actions
  - [ ] Implement modals/pages for details + edit
  - [ ] Add confirmation dialogs for destructive actions
  - [ ] Add loading/error handling and success toast notifications
  - [ ] Keep existing dashboard + other tabs working

## QA / Testing
- [ ] Manual: verify bookings tab search/filter/date/pagination works
- [ ] Manual: verify view/edit/delete + status transitions work
- [ ] Manual: verify customer booking flow still works



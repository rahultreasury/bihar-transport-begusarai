# TODO - Phase 1: Admin Dashboard UI Shell + Dashboard Home (Enterprise)

## Scope (must not break backend/APIs)
- Update: `frontend/src/pages/AdminDashboard.jsx`
- Add new UI components under: `frontend/src/components/admin-premium/...`
- Update minimal styling in: `frontend/src/index.css` (only additive)

## Steps
1. Create premium shell building blocks (sidebar, top header, layout)
2. Create reusable UI primitives (cards, KPI cards, skeletons, empty states)
3. Refactor `AdminDashboard.jsx` to use the premium shell and show:
   - KPI cards (from `adminAPI.getDashboard()`)
   - Live Operations sections (from `dashboard` object; fallback to empty states)
   - Recent bookings preview table (read-only)
4. Add basic theme support (light/dark) and smooth animations
5. Ensure loading skeleton shows while dashboard loads
6. Run frontend build/dev sanity checks

## Output after Phase 1
- Files Modified: `frontend/src/pages/AdminDashboard.jsx`, `frontend/src/index.css`
- Files Created: premium shell + UI components
- Routes Added/Backend APIs used: none
- Screens completed: Admin Dashboard Home (/admin)
- Remaining tasks: Booking Management (Phase 2)


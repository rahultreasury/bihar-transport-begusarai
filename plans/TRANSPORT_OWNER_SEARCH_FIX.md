# Transport Owner Search Fix + Driver-Owner Relationship

## Root Cause
The Create Trip wizard's Transport Owner search does **client-side filtering** on a pre-loaded `owners` array instead of calling the backend search API. This causes:
1. Missing results if >50 owners exist (backend `take: 50` limit)
2. Incomplete search fields (missing `owner_code`, `city`)

## Plan

### 1. Backend: Enhance `getAvailableOwners` search
- Add `owner_code` and `city` to the search OR conditions
- File: `transport-system/backend/repositories/TripRepository.js`

### 2. Frontend: Use backend search with debouncing
- Replace client-side `filteredOwners` with backend search results
- Add `searchedOwners` state for search results
- Add `ownerSearchTimeoutRef` for debouncing (300ms)
- Keep `owners` for initial load and selected owner lookup
- File: `transport-system/frontend/src/components/admin-premium/trips/TripWizard.jsx`

### 3. Driver-Owner Relationship (Schema + UI)
- Add `owner_type` field to `VehicleOwner` model: `TRANSPORT_COMPANY`, `INDIVIDUAL_OWNER`, `DRIVER_OWNER`
- Add `is_driver_owner` boolean to `VehicleOwner` to mark driver-owned vehicles
- Create migration
- Update owner search to include owner_type in results
- Update UI to show owner type badges

### 4. Backend Validation
- Validate `owner_id`, `vehicle_id`, `driver_id` consistency before creating trip
- Ensure vehicle belongs to selected owner
- Ensure driver belongs to selected owner (or is the owner themselves for DRIVER_OWNER type)

## Files to Change
1. `transport-system/backend/prisma/schema.prisma` - Add `owner_type` to VehicleOwner
2. `transport-system/backend/repositories/TripRepository.js` - Enhance search
3. `transport-system/backend/routes/tripRoutes.js` - Pass search param
4. `transport-system/frontend/src/components/admin-premium/trips/TripWizard.jsx` - Backend search
5. `transport-system/frontend/src/components/admin-premium/trips/TripSummary.jsx` - Show owner type

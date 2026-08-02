# TODO — Update BookTransport to use shared 18-vehicle catalogue

## Steps
- [x] Create `transport-system/frontend/src/data/vehicleCatalogue.js` (single source of truth)
- [x] Update `Home.jsx` to import catalogue from shared module (remove inline definitions)
- [x] Update `BookTransport.jsx` to render/select/submit the full 18-vehicle fleet
- [x] Verify pre-selection from Home `?vehicle=<id>` works
- [x] Run frontend build to confirm no compile errors

## Summary
- Created `src/data/vehicleCatalogue.js` — single source of truth for the 18-vehicle fleet (images, SVG icon fallbacks, name, capacity, category, priceLabel/priceMin/priceMax, mid rate `price`, bestFor) plus `DEFAULT_VEHICLE_ID`, `getVehicleById`, `getVehicleBySlug`, `getVehicleRate`, `getVehicleName`.
- `Home.jsx` now imports `{ vehicleTypes, DEFAULT_VEHICLE_ID }` from the shared module; removed the inline ~400-line catalogue + duplicate image imports. Zero visual change.
- `BookTransport.jsx`:
  - Removed the old 5-vehicle hardcoded list and `FLEET_VEHICLE_TYPE_MAP`.
  - Imports the shared catalogue + helpers.
  - `vehicle_type_required` now stores the unique fleet id (slug) — compatible with backend `vehiclePricing.js` (rates) and booking validation.
  - `calculateEstimatedPrice` uses the selected vehicle's mid rate (`getVehicleRate`), matching Home's displayed per-km rates.
  - Vehicle selection UI renders all 18 vehicles with the same images / icon fallbacks, capacity, and `priceLabel` rate ranges.
  - `?vehicle=<id>` from Home's Book Now pre-selects the exact vehicle (with a fallback map for legacy type params like `?vehicle=truck`).
  - Price estimation cards + WhatsApp message show the real catalogue vehicle name/rate.
  - Booking form, layout, Google Maps routing, city estimation, and backend submission (`bookingAPI.create`) unchanged.
- `npm run build` succeeded (verified `dist/assets` contains `BookTransport-*.js` and all vehicle images).


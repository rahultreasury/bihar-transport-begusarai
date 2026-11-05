# TODO — Fix Vehicle Dropdown Selection & Per-Kilometre Pricing

## Bug 1 — Vehicle dropdown selection (Home.jsx)
- [x] Investigate root cause: `<option value={v.type}>` used non-unique `type` (e.g. 13 vehicles share `type: 'truck'`), so the browser selected the first match.
- [x] Home.jsx: default `quickBooking.vehicleType` → unique id `truck-17ft`
- [x] Home.jsx: default `priceCalc.vehicleType` → unique id `truck-17ft`
- [x] Home.jsx: `<option value={v.id}>` (unique slug)
- [x] Home.jsx: `handleVehicleClick` sets `selectedVehicle`/`quickBooking.vehicleType` by `vehicle.id`
- [x] Home.jsx: card highlight `isSelected = selectedVehicle === vehicle.id`
- [x] Home.jsx: `latestQuote` stores `vehicleType` (id) + `vehicleName` (display name); modal displays name

## Bug 2 — Per-kilometre pricing (old 5-vehicle logic)
- [x] Backend: created shared `services/vehiclePricing.js` — 18-vehicle catalogue (rate, min, max) + legacy type aliases
- [x] Backend: `controllers/mapsController.js` — uses shared pricing; returns `rate`/`rateMin`/`rateMax`
- [x] Backend: `routes/bookingRoutes.js` — removed hardcoded 5-type map; uses shared pricing; validates all valid ids

## Verification
- [x] Node sanity check of `vehiclePricing.js`
- [x] Confirm every listed vehicle returns correct rate range and selected rate

## Summary of changes
- `transport-system/frontend/src/pages/Home.jsx` — unique `id` (slug) is the single identifier for dropdown, selection, quote, and booking state.
- `transport-system/backend/services/vehiclePricing.js` — new single source of truth for all 18 vehicles' per-km pricing (rate/min/max), plus legacy `truck/mini_truck/pickup/tempo/lorry` aliases for backward compatibility.
- `transport-system/backend/controllers/mapsController.js` — `/api/calculate-price` now resolves any vehicle's own rate and returns `rate`, `rateMin`, `rateMax`.
- `transport-system/backend/routes/bookingRoutes.js` — legacy hardcoded 5-rate map removed; price computed from shared catalogue; validation accepts all 18 ids + legacy types.


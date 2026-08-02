# TODO — Vehicle Catalogue Refactor (JSX out of .js data module)

## Goal
`src/data/vehicleCatalogue.js` contains JSX (SVG components) in a `.js` file,
which breaks Vite's import analysis. Refactor to the preferred architecture:
**pure data module + separate icon component module**.

## Steps

- [x] 1. Create `src/components/icons/VehicleIcons.jsx` with all 7 SVG icons +
        `getVehicleIcon(id)` resolver (preserving exact per-vehicle assignments).
- [x] 2. Rewrite `src/data/vehicleCatalogue.js` as a pure data module:
        - remove all SVG icon component definitions
        - remove the `icon:` field from every vehicle entry
        - keep image imports, metadata, pricing, capacity, ids, helper functions
- [x] 3. Update `src/pages/Home.jsx`:
        - import `getVehicleIcon` from `../components/icons/VehicleIcons`
        - replace all `vehicle.icon` / `v.icon` usages with `getVehicleIcon(...)`
- [x] 4. Update `src/pages/BookTransport.jsx`:
        - import `getVehicleIcon` from `../components/icons/VehicleIcons`
        - replace `vehicle.icon` usage with `getVehicleIcon(...)`
- [x] 5. Verify `npm run build` (Vite) compiles without syntax errors.
        → Result: `✓ built in 5.60s` — no import-analysis / JSX-in-.js errors.
      Result: ✓ built in 5.13s — no import-analysis / syntax errors.


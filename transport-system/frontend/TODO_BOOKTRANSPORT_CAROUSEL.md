# TODO — BookTransport: Premium Horizontal Vehicle Selector

## Goal
Replace the multi-row vehicle grid on Book Transport with a single-row
horizontal carousel (Amazon / Netflix / Apple-style) without changing any
booking logic, pricing, maps, or backend.

## Steps
- [x] 1. Add carousel logic to `src/pages/BookTransport.jsx`:
         - `vehicleCarouselRef`, `canScrollLeft`/`canScrollRight` state
         - rAF-throttled scroll handler, resize sync
         - smooth arrow scroll (one card width per step)
         - auto-scroll selected/preselected card into view (centered)
         - Arrow-key keyboard navigation on the carousel
- [x] 2. Replace the grid markup with a horizontal snap carousel:
         - single row, fixed-width (220px) non-shrinking cards
         - `overflow-x-auto scrollbar-hide snap-x snap-mandatory`
         - desktop-only left/right arrow buttons (shown only on overflow)
         - mobile swipe + snap + hidden scrollbar
         - lazy-loaded images, identical card design & selected state
- [x] 3. Verify `npm run build` (Vite) compiles.
      Result: ✓ built in 5.24s — no errors.


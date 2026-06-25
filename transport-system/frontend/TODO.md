# TODO - Optimize Google Places API usage

## Plan (approved)
1. Add a debounced, min-3-chars, cached predictions + session-token based Places Autocomplete implementation.
2. Replace `@react-google-maps/api` `<Autocomplete />` usage in `src/pages/Home.jsx` for pickup/drop with manual `google.maps.places.AutocompleteService` + custom dropdown.
3. Trigger `Place Details` only once when user selects a suggestion.
4. Add console logs for every Google Places request (predictions + details), including trigger source and request id.
5. Apply the same optimization approach to `src/components/CityAutocomplete.jsx` (or factor into a shared utility).
6. Verify no API calls occur on page load before user interaction; verify min char guard blocks <3.
7. Confirm duplicate requests are prevented (only one request per user action).
8. Run frontend build/lint and quick manual test.

## Progress
- [x] Implement optimized Places autocomplete (Home.jsx) (pending code change)

- [ ] Add Place Details on selection only
- [ ] Add caching + debounce + min 3
- [ ] Add session token reuse
- [ ] Add console logging
- [ ] Update CityAutocomplete.jsx
- [ ] Test & estimate reduction



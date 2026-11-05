/**
 * googleMapsLoader.js
 * ---------------------------------------------------------------------------
 * THE single Google Maps script loader for the whole Bihar Transport frontend.
 *
 * WHY THIS FILE EXISTS — the crash it prevents
 * ---------------------------------------------
 * `@react-google-maps/api` (useJsApiLoader / LoadScript) is built on
 * `@googlemaps/js-api-loader`, whose `Loader` is a PER-DOCUMENT singleton keyed
 * by API key. The browser can only ever load one Maps script per document, so the
 * Loader compares the options of every subsequent call against the first one and
 * throws:
 *
 *   Error: Loader must not be called again with different options.
 *   {libraries:["places","geometry"]}
 *   !== {libraries:["places","geometry","distanceMatrix"]}
 *
 * That throw happens DURING RENDER of whichever component mounted second, so the
 * app-level <ErrorBoundary> caught it and replaced the whole page with
 * "Something went wrong. We couldn't load this page."
 *
 * This only reproduced on a CLIENT-SIDE NAVIGATION — pressing "Submit Booking"
 * on /book-transport and landing on /booking/enquiry/:enquiryNumber, where two
 * map components (each with its OWN, DIFFERENT `libraries` array) are mounted in
 * the same document. A manual refresh mounts only the enquiry page's map, so the
 * second call never happened and the page looked fine. That is precisely the
 * reported "works after refresh, fails on first navigation" symptom.
 *
 * THE RULE
 * Every component in this app must call `useGoogleMapsApi()` from here, and every
 * component that renders the script through <LoadScript> must pass
 * `GOOGLE_MAPS_LIBRARIES`. There is exactly one option set in the codebase, so the
 * singleton comparison can never fail.
 *
 * NOTE: the `libraries` array is the SUPERSET every consumer needs
 * (places for autocomplete, geometry for PolylineF/DirectionsService, and
 * distanceMatrix for the booking page's distance calculation). Loading a superset
 * costs a little bandwidth once and removes an entire class of runtime crash.
 */

import { useJsApiLoader } from '@react-google-maps/api';

/**
 * The one and only library list. `Object.freeze` guarantees no call site can
 * mutate it into a different set and re-trigger the Loader comparison.
 */
export const GOOGLE_MAPS_LIBRARIES = Object.freeze(['places', 'geometry', 'distanceMatrix']);

/** Raw key from the build environment. May be undefined in a misconfigured deploy. */
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

/** A key is only usable if it is actually present and not a placeholder. */
export const hasGoogleMapsApiKey = Boolean(
  GOOGLE_MAPS_API_KEY && GOOGLE_MAPS_API_KEY.length > 10
);

/**
 * Module-level options object. Identity is stable for the lifetime of the
 * document, which matters because `useJsApiLoader` builds its `Loader` inside a
 * `useMemo` keyed on this value.
 */
const LOADER_OPTIONS = Object.freeze({
  googleMapsApiKey: GOOGLE_MAPS_API_KEY,
  libraries: GOOGLE_MAPS_LIBRARIES,
  id: 'script-loader',
});

/**
 * The only sanctioned way to reach the Google Maps JS API.
 *
 * @returns {{isLoaded:boolean, loadError:Error|undefined, hasApiKey:boolean}}
 *   `hasApiKey:false` means the deploy has no key — callers must render their
 *   non-map fallback instead of waiting forever for `isLoaded`.
 */
export function useGoogleMapsApi() {
  const { isLoaded, loadError } = useJsApiLoader(LOADER_OPTIONS);
  return { isLoaded, loadError, hasApiKey: hasGoogleMapsApiKey };
}

export default useGoogleMapsApi;

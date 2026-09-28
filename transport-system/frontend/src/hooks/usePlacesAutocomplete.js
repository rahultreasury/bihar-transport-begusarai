/**
 * usePlacesAutocomplete.js
 * ---------------------------------------------------------------------------
 * Attaches a REAL Google Places Autocomplete widget to an <input> node that is
 * already in the DOM.
 *
 * WHY THIS EXISTS (the bug this replaces)
 * --------------------------------------
 * The Home hero booking bar used to be written as:
 *
 *     <LoadScript>
 *       <Autocomplete ...>
 *         <input placeholder="Enter pickup location" />
 *       </Autocomplete>
 *     </LoadScript>
 *
 * In `@react-google-maps/api@2.20.8` the `LoadScript` class renders:
 *
 *     this.state.loaded
 *       ? this.props.children
 *       : this.props.loadingElement || <div>Loading...</div>
 *
 * so the `<input>` is NOT rendered at all until the Maps script reports success.
 * It never renders when:
 *
 *   1. `window.google.maps` already exists when `LoadScript` mounts. Its
 *      `componentDidMount` early-returns with
 *      `console.error('google api is already presented')` and NEVER injects the
 *      script or sets `loaded: true`. Home mounted two `LoadScript`s with the
 *      same default `id` ("script-loader"), and React 18 StrictMode
 *      (src/main.jsx) unmount/remounts them, so one of them always loses the
 *      race and stays on the placeholder forever.
 *   2. The script 404s / is blocked / the key is invalid. The `.catch` branch
 *      calls `onError` and then falls through — it never sets `loaded: true`,
 *      so the placeholder is permanent, not temporary.
 *
 * Net effect: the Pickup and Drop fields simply were not in the DOM. The
 * labels, the mic buttons and the Vehicle `<select>` are plain elements outside
 * `LoadScript`, which is exactly why only Vehicle rendered.
 *
 * THE FIX
 * -------
 * The input is now rendered unconditionally by the page. This hook reaches out
 * to the already-mounted node and wires Google's widget onto it imperatively,
 * the moment the project's single shared loader (`useGoogleMapsApi`) says the
 * API is live. The customer's field is therefore visible on first paint,
 * survives a refresh, and still gets real Google Places predictions.
 *
 * This is the same single-loader rule documented in
 * `src/services/googleMapsLoader.js` — no `LoadScript` is mounted anywhere in
 * this flow, so the per-document Loader singleton can never be asked to load a
 * second time with different options.
 */

import { useEffect, useRef, useState } from 'react';
import { useGoogleMapsApi } from '../services/googleMapsLoader';

/**
 * @typedef {'idle'|'loading'|'ready'|'unavailable'|'error'} PlacesStatus
 */

/**
 * @param {object} config
 * @param {React.RefObject<HTMLInputElement>} config.inputRef ref to a mounted <input>
 * @param {object} [config.options] options forwarded to `google.maps.places.Autocomplete`
 * @param {(place: google.maps.places.PlaceResult) => void} [config.onPlaceSelected]
 * @param {boolean} [config.enabled=true]
 * @returns {{ status: PlacesStatus, isReady: boolean }}
 *   `isReady === true` means Google's widget is live and owns the dropdown.
 *   `isReady === false` means the caller may offer its own suggestions.
 */
export default function usePlacesAutocomplete({
  inputRef,
  options,
  onPlaceSelected,
  enabled = true,
}) {
  const { isLoaded, loadError, hasApiKey } = useGoogleMapsApi();
  const [status, setStatus] = useState('idle');

  // Latest-value refs: the widget must survive re-renders, so the effect must
  // not depend on freshly-created callback / option objects.
  const optionsRef = useRef(options);
  const onPlaceSelectedRef = useRef(onPlaceSelected);
  optionsRef.current = options;
  onPlaceSelectedRef.current = onPlaceSelected;

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return undefined;
    }

    // No deploy key, or the script failed outright. The caller falls back to
    // its own suggestion source rather than showing a dead text box.
    if (loadError || !hasApiKey) {
      setStatus('unavailable');
      return undefined;
    }

    if (!isLoaded) {
      setStatus('loading');
      return undefined;
    }

    const node = inputRef?.current;
    const AutocompleteCtor =
      typeof window !== 'undefined' ? window.google?.maps?.places?.Autocomplete : null;

    if (!node || typeof AutocompleteCtor !== 'function') {
      setStatus('unavailable');
      return undefined;
    }

    let widget;
    try {
      widget = new AutocompleteCtor(node, optionsRef.current || {});
    } catch (error) {
      // A malformed key can make the constructor throw. The field stays
      // usable; it simply falls back to local suggestions.
      console.error('[usePlacesAutocomplete] Could not attach Google Places Autocomplete:', error);
      setStatus('error');
      return undefined;
    }

    const listener = widget.addListener('place_changed', () => {
      try {
        onPlaceSelectedRef.current?.(widget.getPlace());
      } catch (error) {
        console.error('[usePlacesAutocomplete] place_changed handler failed:', error);
      }
    });

    setStatus('ready');

    return () => {
      // React 18 StrictMode mounts → unmounts → mounts, so this must be
      // idempotent and must not throw when the API never loaded.
      try {
        listener?.remove?.();
      } catch {
        /* listener already gone */
      }
      try {
        window.google?.maps?.event?.clearInstanceListeners?.(widget);
      } catch {
        /* widget already torn down */
      }
    };
  }, [enabled, hasApiKey, inputRef, isLoaded, loadError]);

  return { status, isReady: status === 'ready' };
}

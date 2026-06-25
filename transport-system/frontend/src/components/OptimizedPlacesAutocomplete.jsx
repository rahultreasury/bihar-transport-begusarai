import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

// Custom, optimized Places Autocomplete input using the low-level Places services.
// This avoids excessive internal calls from react-google-maps' <Autocomplete />.

import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_MIN_CHARS,
  createSessionToken,
  createPlacePredictionsLogger,
  createPlaceDetailsLogger,
  createInMemoryCache,
  fetchPlacePredictions,
  fetchPlaceDetails,
} from '../utils/placesAutocompleteOptimized';

const styles = {
  wrapper: 'relative',
  dropdown:
    'absolute left-0 right-0 z-50 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto',
  item:
    'px-3 py-2 hover:bg-gray-50 cursor-pointer text-sm text-gray-800',
  hint: 'text-xs text-gray-500 mt-1',
};

/**
 * Props:
 * - value: string input value (controlled)
 * - onChange: (newValue) => void
 * - onPlaceSelected: ({ place_id, formatted_address, lat, lng }) => void
 * - placeholder
 * - restrictions default { country: 'in' }
 * - minChars (default 3)
 * - debounceMs (default 700)
 * - types default ['geocode']
 * - source: used for logging (e.g., 'pickup' / 'drop')
 */
export default function OptimizedPlacesAutocomplete({
  value,
  onChange,
  onPlaceSelected,
  placeholder = 'Enter location',
  restrictions = { country: 'in' },
  types = ['geocode'],
  minChars = DEFAULT_MIN_CHARS,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  source = 'places',
  className = '',
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [predictions, setPredictions] = useState([]);
  const [loading, setLoading] = useState(false);

  const inputRef = useRef(null);

  // A single session token per user "search session".
  // We reset when the user selects a place OR clears the input.
  const sessionTokenRef = useRef(null);

  // Request guard to ignore stale results ("cancel previous requests").
  const requestIdRef = useRef(0);

  // Debounce input text.
  const debounceTimerRef = useRef(null);
  const [debouncedInput, setDebouncedInput] = useState(value || '');

  const cacheRef = useRef(createInMemoryCache());

  const autocompleteServiceRef = useRef(null);
  const placesServiceRef = useRef(null);

  const predictionsLogger = useMemo(
    () => createPlacePredictionsLogger({ source }),
    [source],
  );
  const detailsLogger = useMemo(
    () => createPlaceDetailsLogger({ source }),
    [source],
  );

  // Initialize services when google is present.
  useEffect(() => {
    if (!globalThis.google?.maps) return;

    if (!autocompleteServiceRef.current) {
      autocompleteServiceRef.current =
        new globalThis.google.maps.places.AutocompleteService();
    }

    if (!placesServiceRef.current) {
      // PlacesService requires a DOM element (or map). We use a detached div.
      // It does not trigger network calls by itself.
      const el = document.createElement('div');
      placesServiceRef.current = new globalThis.google.maps.places.PlacesService(el);
    }
  }, []);

  // Keep debouncedInput in sync with value.
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      setDebouncedInput(value || '');
    }, debounceMs);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [value, debounceMs]);

  const ensureSessionToken = useCallback(() => {
    // Create/reuse session token across predictions & details.
    if (!sessionTokenRef.current) {
      sessionTokenRef.current = createSessionToken();
    }
    return sessionTokenRef.current;
  }, []);

  const resetSessionToken = useCallback(() => {
    sessionTokenRef.current = null;
  }, []);

  const clearDropdown = useCallback(() => {
    setIsOpen(false);
    setPredictions([]);
    setLoading(false);
  }, []);

  const triggerPredictions = useCallback(async () => {
    const input = (debouncedInput || '').trim();

    // Missing min-char validation: we enforce it here.
    if (input.length < minChars) {
      clearDropdown();
      return;
    }

    // Avoid API calls on page load: requires user typing.
    // (debouncedInput will remain '' until user types)

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    const staleGuard = () => requestId === requestIdRef.current;

    const token = ensureSessionToken();

    setLoading(true);
    try {
      const result = await fetchPlacePredictions({
        source,
        input,
        sessionToken: token,
        autocompleteService: autocompleteServiceRef.current,
        componentRestrictions: restrictions,
        types,
        requestId,
        cache: cacheRef.current,
        logger: predictionsLogger,
        minChars,
        staleGuard,
      });

      if (!staleGuard()) return;

      setPredictions(result.predictions || []);
      setIsOpen(true);
    } finally {
      if (staleGuard()) setLoading(false);
    }
  }, [
    debouncedInput,
    minChars,
    ensureSessionToken,
    restrictions,
    types,
    source,
    predictionsLogger,
    clearDropdown,
  ]);

  useEffect(() => {
    triggerPredictions();
  }, [triggerPredictions]);

  const handleSelect = useCallback(
    async (prediction) => {
      if (!prediction?.place_id) return;

      // Cancel any previous prediction request results.
      requestIdRef.current += 1;
      const requestId = requestIdRef.current;
      const staleGuard = () => requestId === requestIdRef.current;

      const token = ensureSessionToken();

      setIsOpen(false);
      setLoading(true);

      // Place Details: ensure this happens once per user selection.
      const details = await fetchPlaceDetails({
        source,
        placeId: prediction.place_id,
        sessionToken: token,
        placesService: placesServiceRef.current,
        requestId,
        logger: detailsLogger,
        staleGuard,
      });

      if (!staleGuard()) return;

      const place = details.place;
      if (place?.geometry?.location) {
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();

        onPlaceSelected?.({
          place_id: place.place_id || prediction.place_id,
          formatted_address: place.formatted_address || prediction.description,
          lat,
          lng,
        });

        // Populate input field with human-readable address.
        onChange?.(place.formatted_address || prediction.description);

        // Reset session token after a successful selection.
        resetSessionToken();

        // Close dropdown.
        clearDropdown();
      }

      setLoading(false);
    },
    [
      source,
      ensureSessionToken,
      detailsLogger,
      onPlaceSelected,
      onChange,
      resetSessionToken,
      clearDropdown,
    ],
  );

  return (
    <div className={`${styles.wrapper} ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          onChange?.(next);

          // If the user cleared the input, start a new session token.
          if (!next.trim()) {
            resetSessionToken();
            clearDropdown();
          }
        }}
        onFocus={() => {
          // Only open if there are already predictions or valid input.
          if ((value || '').trim().length >= minChars) setIsOpen(true);
        }}
        placeholder={placeholder}
        className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
        autoComplete="off"
      />

      {loading && <div className={styles.hint}>Searching…</div>}

      {isOpen && predictions?.length > 0 && (
        <div className={styles.dropdown} role="listbox">
          {predictions.map((p) => (
            <div
              key={p.place_id}
              className={styles.item}
              onMouseDown={(e) => {
                // prevent input blur before selection
                e.preventDefault();
              }}
              onClick={() => handleSelect(p)}
            >
              {p.description}
            </div>
          ))}
        </div>
      )}

      {isOpen && !loading && (value || '').trim().length >= minChars && predictions?.length === 0 && (
        <div className={styles.hint}>No results</div>
      )}

      {/* Click outside handler could be added; keep minimal to avoid extra listeners. */}
    </div>
  );
}


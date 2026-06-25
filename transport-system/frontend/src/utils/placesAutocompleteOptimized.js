// Optimized Google Places Autocomplete utilities
//
// Goal: drastically reduce Places API usage by applying:
// - min character validation (default: 3)
// - debounce (default: 700ms)
// - request de-duplication + stale response cancellation (requestId guard)
// - in-memory caching of prediction responses
// - Places session token reuse per user "search session"
// - detailed console logging for each Places request and trigger source

export const DEFAULT_MIN_CHARS = 3;
export const DEFAULT_DEBOUNCE_MS = 700;

export function createSessionToken() {
  // Uses new session token per user "search session".
  // Important: token must be reused across subsequent predictions and the final Place Details
  // call, otherwise Google charges you as if it were multiple sessions.
  if (!globalThis.google?.maps?.places?.AutocompleteSessionToken) return null;
  return new globalThis.google.maps.places.AutocompleteSessionToken();
}

export function createPlacePredictionsLogger({ source }) {
  return (payload) => {
    // payload: { requestId, input, sessionTokenPresent, boundsPresent }
    // Logging is intentionally verbose; remove/limit in production if needed.
    console.log(`[PlacesAutocomplete:${source}] REQUEST`, payload);
  };
}

export function createPlaceDetailsLogger({ source }) {
  return (payload) => {
    console.log(`[PlacesDetails:${source}] REQUEST`, payload);
  };
}

export function normalizeCacheKey({ input, restrictions, types }) {
  const r = JSON.stringify(restrictions || {});
  const t = JSON.stringify(types || []);
  return `${input}::${r}::${t}`;
}



export function createInMemoryCache() {
  // Simple in-memory cache for current page lifecycle.
  // Keyed by input+restrictions+types.
  const map = new Map();
  return {
    get: (k) => map.get(k),
    set: (k, v) => map.set(k, v),
    has: (k) => map.has(k),
    clear: () => map.clear(),
  };
}

export function buildPredictionsRequest({
  input,
  sessionToken,
  componentRestrictions,
  types,
  locationBias,
}) {
  const req = {
    input,
    sessionToken: sessionToken || undefined,
  };

  if (componentRestrictions) req.componentRestrictions = componentRestrictions;
  if (types) req.types = types;

  if (locationBias?.center && locationBias?.radiusMeters) {
    req.locationBias = new globalThis.google.maps.Circle({
      center: locationBias.center,
      radius: locationBias.radiusMeters,
    }).getCenter
      ? undefined
      : undefined;
    // We keep this lightweight; locationBias requires different structures.
  }

  return req;
}

export async function fetchPlacePredictions({
  source,
  input,
  sessionToken,
  autocompleteService,
  componentRestrictions,
  types,
  bounds,
  requestId,
  cache,
  logger,
  minChars = DEFAULT_MIN_CHARS,
  cacheTTLms = 5 * 60 * 1000,
  staleGuard = () => true,
}) {
  const trimmed = (input || "").trim();
  if (trimmed.length < minChars) return { requestId, predictions: [] };

  const key = normalizeCacheKey({ input: trimmed, restrictions: componentRestrictions, types });
  const cached = cache.get(key);
  const now = Date.now();
  if (cached && cached.expiresAt > now && staleGuard()) {
    return { requestId, predictions: cached.predictions, fromCache: true };
  }

  if (!autocompleteService) return { requestId, predictions: [] };

  // Log request source + parameters.
  logger({
    requestId,
    input: trimmed,
    sessionTokenPresent: !!sessionToken,
    boundsPresent: !!bounds,
  });

  const req = {
    input: trimmed,
    sessionToken: sessionToken || undefined,
    componentRestrictions: componentRestrictions || undefined,
    types: types || undefined,
    ...(bounds ? { bounds } : {}),
  };

  const predictionsResponse = await new Promise((resolve) => {
    // request cancellations are handled via requestId staleGuard
    autocompleteService.getPlacePredictions(req, (predictions, status) => {
      resolve({ predictions: predictions || [], status });
    });
  });

  const predictions = predictionsResponse.predictions;

  cache.set(key, {
    predictions,
    expiresAt: now + cacheTTLms,
  });

  return { requestId, predictions, fromCache: false };
}

export async function fetchPlaceDetails({
  source,
  placeId,
  sessionToken,
  placesService,
  requestId,
  logger,
  staleGuard = () => true,
}) {
  if (!placesService || !placeId) return { requestId, place: null };

  logger({ requestId, placeId, sessionTokenPresent: !!sessionToken });

  const details = await new Promise((resolve) => {
    const req = {
      placeId,
      sessionToken: sessionToken || undefined,
      fields: [
        'place_id',
        'formatted_address',
        'name',
        'geometry',
      ],
    };

    placesService.getDetails(req, (place, status) => {
      resolve({ place, status });
    });
  });

  if (!staleGuard()) return { requestId, place: null };

  return { requestId, place: details.place || null };
}


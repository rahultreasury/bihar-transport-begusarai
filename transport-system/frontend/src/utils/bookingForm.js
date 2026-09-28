/**
 * bookingForm.js
 *
 * Shared utilities for the Book Transport booking flow.
 *
 * Single source of truth for:
 *   - Price formatting (Indian currency, ranges)
 *   - Distance formatting (comma-separated km)
 *   - Weight conversion (Ton / Quintal / Metric Ton / KG → kg)
 *   - Vehicle capacity checking & recommendation
 *   - Form validation (inline, field-level)
 *   - Form data persistence (localStorage draft)
 *   - Date / time defaults & validation
 *   - "Rate As Per" option catalogue (stable values + display labels)
 *
 * Reuses the 18-vehicle fleet catalogue (src/data/vehicleCatalogue.js)
 * which mirrors the backend vehiclePricing.js source of truth.
 *
 * NOTE ON TERMINOLOGY — "rate" means two different things in this codebase:
 *   - `RATE_AS_PER_OPTIONS[].value` below is the CUSTOMER-ENTERED rate basis.
 *   - `vehicle.price / priceMin / priceMax` (catalogue) and
 *     `rate / min / max` (backend services/vehiclePricing.js) are the
 *     VEHICLE PER-KM catalogue constants. They are unrelated and must not be
 *     merged — the per-km estimate keeps using the catalogue values.
 *
 * NOTE ON SCOPE — `calculateFreight()` below is a pure, standalone calculator
 * for the client's Rate As Per model. It is NOT wired into the booking form,
 * the Review screen, or any API. The existing distance × per-km estimated fare
 * (calculatePriceRange + the /api/calculate-price route) is a separate system
 * and is deliberately left untouched.
 */

import { getVehicleById, vehicleTypes } from '../data/vehicleCatalogue';

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'btb_booking_draft_v2';

// ─────────────────────────────────────────────────────────────────────────────
// Price formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number as Indian Rupees with the ₹ symbol and thousands separators.
 * @param {number|string} amount
 * @returns {string} e.g. "₹83,250"
 */
export const formatPrice = (amount) => {
  const num = Number(amount);
  if (!Number.isFinite(num) || num <= 0) return '₹0';
  return `₹${num.toLocaleString('en-IN')}`;
};

/**
 * Format a price range using the vehicle's min/max per-km rates.
 * @param {number} distanceKm
 * @param {number} rateMin  – lower per-km rate
 * @param {number} rateMax  – upper per-km rate
 * @returns {{ min: number, max: number, label: string }}
 */
export const calculatePriceRange = (distanceKm, rateMin, rateMax) => {
  const min = Math.round(distanceKm * rateMin);
  const max = Math.round(distanceKm * rateMax);
  return {
    min,
    max,
    label: `${formatPrice(min)} – ${formatPrice(max)}`,
  };
};

/**
 * Format a price range string for display.
 * @param {number} distanceKm
 * @param {number} rateMin
 * @param {number} rateMax
 * @returns {string} e.g. "₹83,250 – ₹1,01,750"
 */
export const formatPriceRange = (distanceKm, rateMin, rateMax) => {
  const range = calculatePriceRange(distanceKm, rateMin, rateMax);
  return range.label;
};

// ─────────────────────────────────────────────────────────────────────────────
// Distance formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a distance in km with thousands separators.
 * @param {number} km
 * @returns {string} e.g. "1,850 km"
 */
export const formatDistance = (km) => {
  const num = Number(km);
  if (!Number.isFinite(num) || num <= 0) return '—';
  return `${num.toLocaleString('en-IN')} km`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Weight conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a weight value + unit into kilograms.
 * Supports: KG, Tons, Quintal, Metric Ton, Tonne.
 * @param {number|string} value
 * @param {string} unit
 * @returns {number|null} weight in kg, or null if invalid
 */
export const weightToKg = (value, unit) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  if (!unit) return null;

  const u = unit.toUpperCase().trim();
  switch (u) {
    case 'KG':
      return num;
    case 'TONS':
    case 'TON':
    case 'METRIC TON':
    case 'TONNE':
    case 'TONNES':
      return num * 1000;
    case 'QUINTAL':
    case 'QUINTALS':
      return num * 100;
    default:
      return null;
  }
};

/**
 * Format a weight value + unit for display.
 * @param {number|string} value
 * @param {string} unit
 * @returns {string} e.g. "8 Ton" or "—"
 */
export const formatWeight = (value, unit) => {
  if (!value || !unit) return '—';
  if (unit === 'FTL') return 'FTL';
  return `${value} ${unit}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Schedule formatting (pickup date + time)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD date string as a LOCAL calendar date.
 * `new Date('2026-09-26')` is parsed as UTC midnight, which renders as the
 * previous day in any negative-offset timezone — so the parts are read
 * directly instead.
 * @param {string} dateStr
 * @returns {{day:number, month:number, year:number}|null}
 */
const parseLocalDate = (dateStr) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  return { day, month, year };
};

/**
 * Format a YYYY-MM-DD pickup date for customers, e.g. "26 September 2026".
 * This is the single date format used across the app — raw ISO dates are
 * never shown to a customer.
 * @param {string} dateStr
 * @returns {string} e.g. "26 September 2026", or '' when unparseable.
 */
export const formatPickupDate = (dateStr) => {
  const parts = parseLocalDate(dateStr);
  if (!parts) return '';
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthName = months[parts.month - 1];
  if (!monthName) return '';
  return `${parts.day} ${monthName} ${parts.year}`;
};

/**
 * Pick the clock emoji that matches the hour, so the WhatsApp message reads
 * naturally ("🕙 10:00 AM", "🕞 3:30 PM").
 *
 * The clock faces advance through the day and then wrap, so the hour is taken
 * modulo 12 — otherwise every afternoon hour would fall through to the last
 * face (15:30 would wrongly read 🕚 instead of 🕞).
 * @param {number} hour24
 * @returns {string}
 */
const clockEmojiForHour = (hour24) => {
  const h = ((hour24 % 12) + 12) % 12;
  if (h === 0) return '🕛';
  if (h <= 2) return '🕐';
  if (h <= 4) return '🕞';
  if (h <= 6) return '🕟';
  if (h <= 8) return '🕠';
  if (h <= 10) return '🕙';
  return '🕚';
};

/**
 * Format a 24-hour pickup time as 12-hour with a matching clock emoji.
 * Handles both "15:30" and an already-12-hour "3:30 PM".
 * @param {string} timeStr
 * @returns {{text:string, emoji:string}|null} null when unparseable/empty.
 */
export const formatPickupTime = (timeStr) => {
  const raw = String(timeStr || '').trim();
  if (!raw) return null;

  // Already 12-hour (e.g. from a <input type="time"> in some locales, or a
  // pre-formatted value) — normalise it rather than re-parsing.
  const twelveHour = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(raw);
  if (twelveHour) {
    const h = Number(twelveHour[1]);
    const m = twelveHour[2];
    const hour24 = (twelveHour[3].toLowerCase() === 'pm' && h !== 12 ? h + 12 : (twelveHour[3].toLowerCase() === 'am' && h === 12 ? 0 : h));
    const suffix = twelveHour[3].toUpperCase();
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return {
      text: `${h12}:${m} ${suffix}`,
      emoji: clockEmojiForHour(hour24)
    };
  }

  const twentyFour = /^(\d{1,2}):(\d{2})/.exec(raw);
  if (!twentyFour) return null;
  const hour24 = Number(twentyFour[1]);
  const minute = twentyFour[2];
  if (hour24 > 23 || Number(minute) > 59) return null;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    text: `${h12}:${minute} ${suffix}`,
    emoji: clockEmojiForHour(hour24)
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Rate As Per (customer-entered rate basis)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stable, backend-friendly values for each rate basis. Kept as named constants
 * because the option catalogue, the validation rules, the UI and
 * `calculateFreight()` all branch on them — a magic string repeated in four
 * places is exactly how pricing modes drift apart.
 */
export const RATE_AS_PER_FIXED = 'FIXED';
export const RATE_AS_PER_PER_TON = 'PER_TON';
export const RATE_AS_PER_PER_KG = 'PER_KG';
export const RATE_AS_PER_PER_DAY = 'PER_DAY';
export const RATE_AS_PER_MONTHLY = 'MONTHLY';

/**
 * The one canonical Rate As Per catalogue. `value` is what lives in
 * formData.rate_as_per (and will eventually be persisted); `label` is the only
 * thing shown to the customer. Both the Shipment select and the Review screen
 * read from this list so the two can never disagree.
 */
export const RATE_AS_PER_OPTIONS = [
  { value: RATE_AS_PER_FIXED, label: 'Fixed' },
  { value: RATE_AS_PER_PER_TON, label: 'Per Ton' },
  { value: RATE_AS_PER_PER_KG, label: 'Per KG' },
  { value: RATE_AS_PER_PER_DAY, label: 'Per Day' },
  { value: RATE_AS_PER_MONTHLY, label: 'Monthly' },
];

/**
 * Resolve the customer-facing label for a stored rate_as_per value.
 * @param {string} value
 * @returns {string} e.g. "Per Ton" — or "—" for a missing/unknown value.
 */
export const getRateAsPerLabel = (value) => {
  const match = RATE_AS_PER_OPTIONS.find((option) => option.value === value);
  return match ? match.label : '—';
};

/**
 * Whether a rate value is required for the given rate basis.
 * "Fixed" quotes the whole trip, so there is nothing extra to type — every
 * other basis is a multiplier and needs the number.
 * @param {string} rateAsPer
 * @returns {boolean}
 */
export const isRateRequired = (rateAsPer) =>
  !!rateAsPer && rateAsPer !== RATE_AS_PER_FIXED;

// ─────────────────────────────────────────────────────────────────────────────
// Freight calculation (Rate As Per × basis quantity)
// ─────────────────────────────────────────────────────────────────────────────

const KG_PER_TON = 1000;

/**
 * Coerce an input to a usable positive number, or null when it is absent,
 * blank, non-numeric, or not greater than zero.
 *
 * Returning null rather than 0 is deliberate: "no rate entered" and
 * "a rate of zero" are different facts, and callers must be able to tell
 * them apart. A zero or negative rate is never treated as a real quote.
 */
const toPositiveNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
};

/**
 * Round to paise, absorbing binary-float drift (e.g. 4.1 * 3 * 100 = 1230.0000000000002).
 * This is a numeric correction only — currency formatting belongs to the UI.
 */
const roundMoney = (amount) => Math.round((amount + Number.EPSILON) * 100) / 100;

/**
 * Calculate the freight charge for a customer-entered rate basis.
 *
 * The five pricing rules, verbatim from the client specification:
 *   Fixed    → rate × 1
 *   Per Ton  → rate × (weight in tons)
 *   Per KG   → rate × (weight in kg)
 *   Per Day  → rate × days
 *   Monthly  → rate × months
 *
 * Weight is always normalised through the existing `weightToKg()` so the
 * unit semantics stay defined in exactly one place. FTL carries no numeric
 * weight and therefore yields null — it is never guessed at.
 *
 * @param {Object}  input
 * @param {string}  input.rateAsPer   – one of the RATE_AS_PER_* values.
 * @param {number|string} [input.rate]        – the rate itself. Required for every mode.
 * @param {number|string} [input.weightValue] – required for Per Ton / Per KG.
 * @param {string}  [input.weightUnit] – KG | Tons | Metric Ton | Quintal | FTL.
 * @param {number|string} [input.days]        – required for Per Day.
 * @param {number|string} [input.months]      – required for Monthly.
 * @returns {number|null} the freight as a plain number (never a formatted
 *   string), or null when a required input is missing or not calculable.
 *   null and 0 are deliberately distinct: 0 is never returned.
 */
export const calculateFreight = ({
  rateAsPer,
  rate,
  weightValue,
  weightUnit,
  days,
  months,
} = {}) => {
  const rateNum = toPositiveNumber(rate);
  if (rateNum === null) return null;

  switch (rateAsPer) {
    case RATE_AS_PER_FIXED:
      return roundMoney(rateNum);

    case RATE_AS_PER_PER_TON: {
      const weightKg = weightToKg(weightValue, weightUnit);
      if (weightKg === null) return null;
      return roundMoney(rateNum * (weightKg / KG_PER_TON));
    }

    case RATE_AS_PER_PER_KG: {
      const weightKg = weightToKg(weightValue, weightUnit);
      if (weightKg === null) return null;
      return roundMoney(rateNum * weightKg);
    }

    case RATE_AS_PER_PER_DAY: {
      const daysNum = toPositiveNumber(days);
      if (daysNum === null) return null;
      return roundMoney(rateNum * daysNum);
    }

    case RATE_AS_PER_MONTHLY: {
      const monthsNum = toPositiveNumber(months);
      if (monthsNum === null) return null;
      return roundMoney(rateNum * monthsNum);
    }

    // Unknown / missing basis — never guess a price.
    default:
      return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle capacity & recommendation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a vehicle's capacity (in kg) can carry the given weight.
 * @param {Object} vehicle – from vehicleCatalogue
 * @param {number} weightKg
 * @returns {boolean}
 */
export const isVehicleSuitable = (vehicle, weightKg) => {
  if (!vehicle || !weightKg || weightKg <= 0) return true; // no weight → assume ok
  return vehicle.capacityKg >= weightKg;
};

/**
 * Find the smallest vehicle that can carry the given weight.
 * @param {number} weightKg
 * @returns {Object|undefined} vehicle from catalogue
 */
export const getRecommendedVehicle = (weightKg) => {
  if (!weightKg || weightKg <= 0) return undefined;
  // Sort by capacity ascending so we get the smallest suitable vehicle
  const sorted = [...vehicleTypes].sort((a, b) => a.capacityKg - b.capacityKg);
  return sorted.find((v) => v.capacityKg >= weightKg);
};

/**
 * Get all vehicles that can carry the given weight, sorted by capacity.
 * @param {number} weightKg
 * @returns {Object[]}
 */
export const getSuitableVehicles = (weightKg) => {
  if (!weightKg || weightKg <= 0) return [];
  return [...vehicleTypes]
    .filter((v) => v.capacityKg >= weightKg)
    .sort((a, b) => a.capacityKg - b.capacityKg);
};

// ─────────────────────────────────────────────────────────────────────────────
// Form validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * True when an optional numeric field holds nothing meaningful.
 *
 * Optional shipment fields arrive from `<input type="number">`, so an untouched
 * field is '' and a cleared field is ''. null/undefined come from older saved
 * drafts. All three mean "the customer has not answered this yet" — NOT
 * "the customer answered zero" — and must never be coerced into a number.
 *
 * @param {*} value
 * @returns {boolean}
 */
const isBlankNumberInput = (value) =>
  value === null || value === undefined || String(value).trim() === '';

/**
 * Validate the booking form fields.
 * Returns an object mapping field names to error messages.
 * Empty object = all valid.
 *
 * SHIPMENT FIELDS ARE NOT REQUIRED
 * A customer very often books a vehicle before they know exactly what is
 * going into it. Material, quantity and weight are therefore deliberately NOT
 * part of what makes a booking valid: an empty value is a legitimate answer
 * and travels to the API as null, never as 0 and never as a made-up string.
 * The only rule that survives is data hygiene — if the customer DID type a
 * value, it has to be a usable positive number, so a typo is caught on the
 * field they are looking at instead of being silently persisted.
 *
 * @param {Object} formData
 * @param {Object} options
 * @param {number} options.distanceKm
 * @param {boolean} options.hasRouteError
 * @returns {Object<string, string>}
 */
export const validateBookingForm = (formData, options = {}) => {
  const errors = {};
  const { distanceKm = 0, hasRouteError = false } = options;

  // Pickup location
  if (!formData.pickup_location || formData.pickup_location.trim() === '') {
    errors.pickup_location = 'Please select a pickup location.';
  }

  // Drop location
  if (!formData.drop_location || formData.drop_location.trim() === '') {
    errors.drop_location = 'Please select a drop location.';
  }

  // Same pickup/drop
  if (
    formData.pickup_location &&
    formData.drop_location &&
    formData.pickup_location.trim().toLowerCase() === formData.drop_location.trim().toLowerCase()
  ) {
    errors.drop_location = 'Pickup and drop locations must be different.';
  }

  // Vehicle
  if (!formData.vehicle_type_required) {
    errors.vehicle_type_required = 'Please select a vehicle.';
  }

  // ── Material / Goods ────────────────────────────────────────────────
  // Intentionally unvalidated. The customer may simply not know yet, and
  // asking twice does not produce an answer — it produces a blocked form.
  // `formData.material` is submitted as-is (empty string → null downstream).

  // ── Quantity ────────────────────────────────────────────────────────
  // Empty is fine. Only a value the customer DID type has to be usable.
  if (!isBlankNumberInput(formData.quantity)) {
    const qty = Number(formData.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.quantity = 'Please enter a valid quantity.';
    }
  }

  // ── Weight ──────────────────────────────────────────────────────────
  // Same rule as quantity: empty is a valid answer, mistyped is not.
  if (!isBlankNumberInput(formData.weight_value)) {
    const wt = Number(formData.weight_value);
    if (!Number.isFinite(wt) || wt <= 0) {
      errors.weight_value = 'Please enter a valid approximate weight.';
    }
  }

  // Rate — only validated when a rate basis is actually selected. An older
  // saved draft with no rate_as_per at all stays valid, and "Fixed" never
  // asks for a number (the client's own rule: rate is shown when Rate As Per
  // is not Fixed).
  if (isRateRequired(formData.rate_as_per)) {
    const rate = Number(formData.rate);
    if (formData.rate === '' || formData.rate === null || isNaN(rate) || rate <= 0) {
      errors.rate = 'Please enter the rate.';
    }
  }

  // Pickup date
  if (!formData.pickup_date) {
    errors.pickup_date = 'Please select a pickup date.';
  } else if (isPastDate(formData.pickup_date)) {
    errors.pickup_date = 'Pickup date cannot be in the past.';
  }

  // Pickup time
  if (!formData.pickup_time) {
    errors.pickup_time = 'Please select a pickup time.';
  }

  // Route error
  if (hasRouteError) {
    errors.route = 'Unable to calculate route. Please verify your locations.';
  }

  return errors;
};

/**
 * Check if a date string (YYYY-MM-DD) is in the past.
 * @param {string} dateStr
 * @returns {boolean}
 */
export const isPastDate = (dateStr) => {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const input = new Date(dateStr);
  input.setHours(0, 0, 0, 0);
  return input < today;
};

/**
 * Get today's date as YYYY-MM-DD.
 * @returns {string}
 */
export const getDefaultPickupDate = () => {
  return new Date().toISOString().split('T')[0];
};

/**
 * Get a reasonable default pickup time (10:00 AM).
 * @returns {string}
 */
export const getDefaultPickupTime = () => {
  return '10:00';
};

// ─────────────────────────────────────────────────────────────────────────────
// Form persistence (localStorage draft)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Save the booking form data to localStorage as a draft.
 * Only persists non-sensitive form fields — never auth tokens.
 * @param {Object} formData
 */
export const saveBookingDraft = (formData) => {
  try {
    const draft = {
      ...formData,
      _savedAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* storage unavailable — ignore */
  }
};

/**
 * Load the booking form draft from localStorage.
 * @returns {Object|null}
 */
export const loadBookingDraft = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Don't restore _savedAt into form state
    const { _savedAt, ...formData } = draft;
    return formData;
  } catch {
    return null;
  }
};

/**
 * Clear the booking form draft from localStorage.
 * Called after successful submission.
 */
export const clearBookingDraft = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Route cache (dedupe identical requests)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple in-memory cache for route calculations.
 * Keyed by "pickupLat,pickupLng|dropLat,dropLng|vehicleId".
 * Prevents duplicate API calls for the same pickup/drop pair.
 */
const routeCache = new Map();

/**
 * Get a cached route result if available.
 * @param {string} cacheKey
 * @returns {Object|null}
 */
export const getCachedRoute = (cacheKey) => {
  const cached = routeCache.get(cacheKey);
  if (!cached) return null;
  // Expire after 5 minutes
  if (Date.now() - cached.timestamp > 300000) {
    routeCache.delete(cacheKey);
    return null;
  }
  return cached.data;
};

/**
 * Store a route result in the cache.
 * @param {string} cacheKey
 * @param {Object} data
 */
export const setCachedRoute = (cacheKey, data) => {
  routeCache.set(cacheKey, { data, timestamp: Date.now() });
};

/**
 * Build a cache key from pickup/drop coordinates and vehicle id.
 * @param {Object} pickup
 * @param {Object} drop
 * @param {string} vehicleId
 * @returns {string}
 */
export const buildRouteCacheKey = (pickup, drop, vehicleId) => {
  if (!pickup?.lat || !drop?.lat) return '';
  return `${pickup.lat},${pickup.lng}|${drop.lat},${drop.lng}|${vehicleId || ''}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Quantity formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format quantity for display.
 * @param {number|string} value
 * @param {string} unit
 * @returns {string} e.g. "100 Bags" or "LOOSE" or "—"
 */
export const formatQuantity = (value, unit) => {
  if (!unit) return '—';
  if (unit === 'LOOSE') return 'LOOSE';
  if (!value) return '—';
  return `${value} ${unit}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Vehicle helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the display name for a vehicle id.
 * @param {string} id
 * @returns {string}
 */
export const getVehicleDisplayName = (id) => {
  const v = getVehicleById(id);
  return v ? v.name : '17 ft Truck';
};

/**
 * Get the capacity string for a vehicle id.
 * @param {string} id
 * @returns {string}
 */
export const getVehicleCapacity = (id) => {
  const v = getVehicleById(id);
  return v ? v.capacity : '—';
};

/**
 * Get the price label for a vehicle id.
 * @param {string} id
 * @returns {string}
 */
export const getVehiclePriceLabel = (id) => {
  const v = getVehicleById(id);
  return v ? v.priceLabel : '—';
};

/**
 * Get the capacity in kg for a vehicle id.
 * @param {string} id
 * @returns {number}
 */
export const getVehicleCapacityKg = (id) => {
  const v = getVehicleById(id);
  return v ? v.capacityKg : 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// Debounce utility
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a debounced version of a function.
 * @param {Function} fn
 * @param {number} delay – milliseconds
 * @returns {Function}
 */
export const debounce = (fn, delay) => {
  let timeoutId;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

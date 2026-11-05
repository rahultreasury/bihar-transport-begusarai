/**
 * Vehicle RC lookup — Parse "CarInfo API" integration.
 *
 * The admin Vehicle / Resource Registration form needs a registration-certificate
 * (RC) lookup: the admin types e.g. `BR09AB1234` and the matching RC fields are
 * fetched and auto-populated.
 *
 * SECURITY CONTRACT (do not relax):
 *   - The Parse API key is read ONLY from the backend env var `PARSE_API_KEY`
 *     (transport-system/backend/.env, which is git-ignored).
 *   - It is NEVER hard-coded, NEVER logged, NEVER placed in an error message,
 *     NEVER persisted, and NEVER returned to the browser. The React client calls
 *     our own backend (`GET /api/vehicles/lookup`), never Parse directly.
 *   - RC owner identity is deliberately NOT returned to the client. Our
 *     `TransportVehicle` has no owner-name column, and the RC registered owner
 *     is not the same entity as a Bihar Transport "transport owner".
 *   - The module is defensive: an unavailable/slow/broken Parse API must never
 *     crash the backend.
 *
 * Docs: https://parse.bot/marketplace/c0734829-6687-4880-87cd-ae717137fc92/carinfo-app-api
 * Canonical docs: https://docs.parse.bot
 */

const axios = require('axios');
const { logger } = require('../utils/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/AppError');

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

// Documented endpoint (Parse marketplace app `carinfo-app-api`):
//   GET https://api.parse.bot/scraper/<scraper-id>/get_vehicle_details
//   Header: X-API-Key: ${PARSE_API_KEY}
//   Query : vehicle_number
const DEFAULT_BASE_URL = 'https://api.parse.bot';
const DEFAULT_LOOKUP_PATH = '/scraper/ee7a3855-c293-4068-a7e7-30b2d941aa9d/get_vehicle_details';
const DEFAULT_TIMEOUT_MS = 10000;

// Parse bills per successful call, so identical lookups are served from a
// short-lived in-process cache. Only normalised RC data is cached.
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 250;

const getConfig = () => ({
  baseUrl: (process.env.PARSE_CARINFO_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  lookupPath: process.env.PARSE_CARINFO_LOOKUP_PATH || DEFAULT_LOOKUP_PATH,
  apiKey: process.env.PARSE_API_KEY || '',
  timeoutMs: Number.parseInt(process.env.PARSE_CARINFO_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS,
});

/* -------------------------------------------------------------------------- */
/* Normalisation + validation                                                 */
/* -------------------------------------------------------------------------- */

// Indian RC format: SS NN SSSS NNNN  (e.g. BR09AB1234, MH01CL3390, BH01AA1234).
const VEHICLE_NUMBER_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/;

/** Upper-case and strip every non-alphanumeric character. */
function normalizeVehicleNumber(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isValidVehicleNumber(value) {
  return VEHICLE_NUMBER_PATTERN.test(value);
}

/** Lower-case and strip everything non-alphanumeric (so `RTO.code` === `rtocode`). */
const normKey = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

/* -------------------------------------------------------------------------- */
/* Payload index                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Index an arbitrary Parse payload by BOTH full dotted path and bare leaf name.
 *
 * Both keys are built by CONCATENATING normalised segments with NO separator, so
 * `rto.registered_rto`, `rto_registered_rto` and `rtoRegisteredRto` all collapse
 * to the single key `rtoregisteredrto`. (The previous implementation joined path
 * segments with `_` while its lookup candidates were fully stripped, so every
 * nested field silently failed to match.)
 *
 * `false` is a meaningful value here (e.g. `is_two_wheeler: false`), so booleans
 * are stored as-is rather than being dropped as falsy.
 */
function indexPayload(payload) {
  const byPath = new Map();
  const byLeaf = new Map();

  const walk = (node, prefix, depth) => {
    if (!node || typeof node !== 'object' || depth > 5) return;

    for (const [key, value] of Object.entries(node)) {
      const leaf = normKey(key);
      if (!leaf) continue;

      if (Array.isArray(value)) continue; // `notices`, `action_types`, ... are noise

      const path = prefix ? `${prefix}${leaf}` : leaf;

      if (value && typeof value === 'object') {
        walk(value, path, depth + 1);
        continue;
      }

      if (!byPath.has(path)) byPath.set(path, value);
      if (!byLeaf.has(leaf)) byLeaf.set(leaf, value);
    }
  };

  walk(payload, '', 0);
  return { byPath, byLeaf };
}

const EMPTY_TOKENS = new Set(['na', 'n/a', 'nil', 'none', 'null', 'undefined', '-', '--', 'notavailable', 'unknown']);

function isUsable(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true; // `false` is real data
  if (typeof value === 'number') return Number.isFinite(value);
  const text = String(value).trim();
  return Boolean(text) && !EMPTY_TOKENS.has(text.toLowerCase());
}

/**
 * Read a value by explicit path, then by bare leaf name (the fallback keeps
 * older/alternative Parse payload shapes working).
 */
function read(index, paths = [], leaves = []) {
  for (const path of paths) {
    const value = index.byPath.get(path);
    if (isUsable(value)) return value;
  }
  for (const leaf of leaves) {
    const value = index.byLeaf.get(leaf);
    if (isUsable(value)) return value;
  }
  return null;
}

const readString = (index, paths, leaves) => {
  const value = read(index, paths, leaves);
  return value === null ? null : String(value).trim();
};

const readBoolean = (index, paths, leaves) => {
  const value = read(index, paths, leaves);
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim().toLowerCase();
  if (['true', 'yes', '1'].includes(text)) return true;
  if (['false', 'no', '0'].includes(text)) return false;
  return null;
};

/* -------------------------------------------------------------------------- */
/* Date helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `2020-05-15` | `15/05/2020` | `15-May-2020` | `26-Nov-2020` | ISO datetime
 *   -> `2020-05-15`
 */
function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text || EMPTY_TOKENS.has(text.toLowerCase())) return null;

  // YYYY-MM-DD / YYYY/MM/DD (Parse's native ISO form)
  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;

  // DD-MM-YYYY / DD/MM/YYYY
  const dmy = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;

  // 26-Nov-2020 / 15 May 2020 / 15-May-2020
  const named = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})/);
  if (named) {
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = months[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${named[3]}-${month}-${String(named[1]).padStart(2, '0')}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function toYear(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).match(/(\d{4})/);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  if (!Number.isFinite(year) || year < 1900 || year > new Date().getFullYear() + 1) return null;
  return year;
}

/* -------------------------------------------------------------------------- */
/* make_model -> make / model                                                  */
/* -------------------------------------------------------------------------- */

// CarInfo returns ONE combined `make_model` string (e.g. "ONE TATA ACE"). To
// populate the form's separate Make and Model inputs we split on a known
// manufacturer token. Nothing is invented: the casing comes from the RC itself
// and both outputs are editable by the admin before saving.
const MANUFACTURERS = new Set([
  'tata', 'mahindra', 'ashokleyland', 'ashok', 'leyland', 'eicher', 'bharatbenz',
  'bharat', 'benz', 'sml', 'isuzu', 'jbm', 'bajaj', 'piaggio', 'force', 'atul',
  'maruti', 'suzuki', 'hyundai', 'toyota', 'kia', 'nissan', 'volvo', 'renault',
  'skoda', 'jeep', 'mercedes', 'bmw', 'audi', 'mitsubishi', 'honda', 'hero',
  'tvsmotor', 'tvs', 'royalenfield', 'royal', 'enfield', 'swaraj', 'mazda',
  'eicherpro', 'vehicletrailers', 'viking', 'oscar', 'pmt', 'bajajauto',
]);

function splitMakeModel(makeModel) {
  const text = String(makeModel || '').trim();
  if (!text) return { make: null, model: null, leadIsManufacturer: false };

  const tokens = text.split(/\s+/).filter(Boolean);
  const hit = tokens.findIndex((token) => MANUFACTURERS.has(normKey(token)));

  if (hit === -1) {
    // No known manufacturer in the string — do not guess a make.
    return { make: null, model: null, leadIsManufacturer: false };
  }

  const make = tokens[hit];
  const model = [...tokens.slice(0, hit), ...tokens.slice(hit + 1)].join(' ').trim();
  // A genuine RC make_model reads "<MANUFACTURER> <model...>". When the
  // manufacturer is the FIRST token the string is a well-formed designation;
  // a leading non-manufacturer token means the string is malformed/sample data
  // (e.g. the live UP14ET4166 "ONE TATA ACE" for a real Tata LPT 14 FT).
  return { make, model: model || null, leadIsManufacturer: hit === 0 };
}

/** `is_two_wheeler` is the only vehicle-class signal CarInfo exposes. */
function vehicleTypeFromTwoWheeler(isTwoWheeler) {
  if (isTwoWheeler === true) return 'Two Wheeler';
  if (isTwoWheeler === false) return 'Four Wheeler';
  return null;
}

/* -------------------------------------------------------------------------- */
/* CarInfo payload -> application contract                                    */
/* -------------------------------------------------------------------------- */

// Stable response shape. Keys absent from the upstream payload stay `null` so
// the frontend never has to guess.
const CONTRACT_FIELDS = [
  'vehicleName',
  'make',
  'model',
  'vehicleType',
  'isTwoWheeler',
  'registrationDate',
  'manufacturingYear',
  'insuranceExpiry',
  'insuranceExpired',
  'insuranceExpiringSoon',
  'pollutionExpiry',
  'pollutionCertificateExpired',
  'rto',
  'rtoCode',
  'rtoState',
  // Raw upstream identity string, surfaced for AUDIT ONLY. It is never
  // auto-filled into the form (see isVehicleIdentityTrusted).
  'rcMakeModel',
];

/**
 * Vehicle-identity trust gate.
 *
 * The CarInfo plan returns exactly 9 fields and NEVER includes a chassis number,
 * engine number, manufacturing year or registration date, so there is no
 * cross-checkable identity evidence on this plan. Two live responses show why a
 * quality gate is still required:
 *
 *   UP14ET4166 (a real Tata LPT 14 FT) -> "ONE TATA ACE"              MALFORMED
 *   JH05DG3670 (an Eicher Pro)         -> "EICHER PRO 2114XP S L HSD BS6"  GOOD
 *
 * Both carry the identical generic demo image (March27th2020/Bus.png), so the
 * image proves nothing. The discriminator is that a genuine RC make_model reads
 * "<MANUFACTURER> <model...>": a recognised manufacturer as the FIRST token is a
 * well-formed designation, whereas a leading non-manufacturer token ("ONE ...")
 * marks sample/corrupt data.
 *
 * When an RTO code is present its state prefix must also agree with the
 * registration number's state prefix. Untrusted identity stays `null` so the
 * admin types it — we never invent a model from a malformed string.
 */
function registrationStatePrefix(vehicleNumber) {
  return vehicleNumber ? String(vehicleNumber).slice(0, 2).toUpperCase() : null;
}

function rtoStatePrefix(rtoCode) {
  return rtoCode ? String(rtoCode).replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() : null;
}

function isVehicleIdentityTrusted({ explicitMake, leadIsManufacturer, vehicleNumber, rtoCode }) {
  // The API named the manufacturer outright — the strongest signal available.
  if (explicitMake) return true;

  // Otherwise require a well-formed "<MANUFACTURER> <model>" designation.
  if (!leadIsManufacturer) return false;

  const rtoPrefix = rtoStatePrefix(rtoCode);
  if (!rtoPrefix) return true; // no RTO code to cross-check

  const regPrefix = registrationStatePrefix(vehicleNumber);
  if (!regPrefix) return false;
  return regPrefix === rtoPrefix;
}

/**
 * Map the real CarInfo response onto our vehicle contract.
 *
 * Verified against a live UP14ET4166 response (single call):
 *   data.vehicle_number | data.make_model | data.is_two_wheeler
 *   data.rto.code | data.rto.registered_rto | data.rto.state
 *   data.insurance.expiry_date | data.insurance.expired | data.insurance.expiring_soon
 *   data.pollution_certificate_expired
 *   (data.notices and data.vehicle_image_url are deliberately ignored)
 *
 * The leaf fallbacks preserve support for alternative/legacy payload shapes.
 *
 * NOTE: CarInfo does NOT provide capacity, permit, manufacturing-year or rate
 * data. Those contract fields therefore stay `null` — they are never invented.
 */
function mapCarInfoPayload(rawPayload, requestedVehicleNumber) {
  const index = indexPayload(rawPayload);
  const empty = () => Object.fromEntries(CONTRACT_FIELDS.map((f) => [f, null]));

  // A body that is not a vehicle object (e.g. an error envelope) yields nothing.
  if (!rawPayload || typeof rawPayload !== 'object') {
    return { data: empty(), fieldsFound: [], vehicleIdentityVerified: false, warnings: [] };
  }

  const rcMakeModel = readString(index, ['makemodel'], ['makemodel', 'makeandmodel', 'brandmodel']);
  const discreteMake = readString(index, ['make', 'manufacturer'], ['make', 'manufacturer', 'oem', 'brand']);
  const discreteModel = readString(index, ['model'], ['model', 'modelname', 'variant']);
  const derived = splitMakeModel(rcMakeModel);

  const isTwoWheeler = readBoolean(index, ['istwowheeler'], ['istwowheeler']);
  const registrationDate = toIsoDate(
    read(index, ['registrationdate', 'regdate'], ['registrationdate', 'regdate', 'registeredon'])
  );
  const manufacturingYear = toYear(
    read(index, ['manufacturingyear', 'mfgyear'], ['manufacturingyear', 'manufactureyear', 'mfgyear', 'yearofmanufacture'])
  ) || toYear(registrationDate);

  // Explicit identity fields, if this plan ever starts returning them.
  const hasExplicitIdentity = Boolean(
    readString(index, ['chassisnumber', 'chassisno'], ['chassisnumber', 'chassisno', 'vin'])
    || readString(index, ['enginenumber', 'engineno'], ['enginenumber', 'engineno'])
    || readString(index, ['modelcode', 'series'], ['modelcode', 'series', 'variantcode'])
    || manufacturingYear
    || registrationDate
  );

  const rtoCode = readString(index, ['rtocode'], ['rtocode']);
  const identityTrusted = isVehicleIdentityTrusted({
    explicitMake: discreteMake || (hasExplicitIdentity ? derived.make : null),
    leadIsManufacturer: derived.leadIsManufacturer,
    vehicleNumber: requestedVehicleNumber,
    rtoCode,
  });

  const warnings = [];
  if (rcMakeModel && !identityTrusted) {
    warnings.push({
      code: 'VEHICLE_MODEL_UNVERIFIED',
      message: 'CarInfo did not return verifiable vehicle model details for this registration. Enter the vehicle name, make and model manually.',
    });
  }

  const data = {
    // Identity fields are trust-gated: an unverified make_model must never be
    // presented to the admin as this vehicle's real identity.
    vehicleName: identityTrusted ? rcMakeModel : null,
    make: identityTrusted ? (discreteMake || derived.make) : null,
    model: identityTrusted ? (discreteModel || derived.model) : null,
    vehicleType: vehicleTypeFromTwoWheeler(isTwoWheeler),
    isTwoWheeler,
    registrationDate,
    manufacturingYear,
    insuranceExpiry: toIsoDate(
      read(index, ['insuranceexpirydate', 'insuranceexpiry'], ['insuranceexpirydate', 'insuranceexpiry', 'insurancevalidupto', 'policyexpiry'])
    ),
    insuranceExpired: readBoolean(index, ['insuranceexpired'], ['insuranceexpired']),
    insuranceExpiringSoon: readBoolean(index, ['insuranceexpiringsoon'], ['insuranceexpiringsoon']),
    pollutionExpiry: toIsoDate(
      read(index, ['pollutionexpirydate', 'pollutionexpiry'], ['pollutionexpirydate', 'pollutionexpiry', 'pollutionvalidupto', 'pucexpiry'])
    ),
    pollutionCertificateExpired: readBoolean(index, ['pollutioncertificateexpired'], ['pollutioncertificateexpired']),
    rto: readString(index, ['rtoregisteredrto', 'rto'], ['registeredrto', 'registeringoffice', 'rtooffice', 'rtoname']),
    rtoCode,
    rtoState: readString(index, ['rtostate'], ['rto', 'state']),
    rcMakeModel,
  };

  const fieldsFound = CONTRACT_FIELDS.filter((field) => data[field] !== null && data[field] !== undefined);
  return { data, fieldsFound, vehicleIdentityVerified: identityTrusted, warnings };
}

const countPopulated = (data) => CONTRACT_FIELDS.filter((f) => data[f] !== null && data[f] !== undefined).length;

/* -------------------------------------------------------------------------- */
/* Error classification                                                       */
/* -------------------------------------------------------------------------- */

const AUTH_ERROR_PATTERN = /api[\s_-]?key|unauthori[sz]ed|forbidden|authenticat|invalid[\s_-]?key|missing[\s_-]?key|permission|subscription|credit|plan/i;
const NOT_FOUND_PATTERN = /not[\s_-]?found|no[\s_-]?record|no[\s_-]?data|does[\s_-]?not[\s_-]?exist|invalid[\s_-]?vehicle|vehicle[\s_-]?not|unable[\s_-]?to[\s_-]?find|no[\s_-]?result|unknown[\s_-]?vehicle/i;

function extractUpstreamMessage(data) {
  if (!data) return '';
  const candidate = data.error?.message || data.error || data.message || data.detail || data.errors?.[0];
  if (typeof candidate === 'string') return candidate;
  if (candidate && typeof candidate === 'object') return String(candidate.message || '');
  return '';
}

/** Map a Parse response onto one of our operational errors. Never leaks the key. */
function classifyUpstreamError(status, data) {
  const upstreamMessage = extractUpstreamMessage(data);

  if (status === 401 || status === 403 || (status >= 400 && AUTH_ERROR_PATTERN.test(upstreamMessage))) {
    return new AppError({
      message: 'Vehicle lookup is temporarily unavailable. Please try again later.',
      errorCode: 'VEHICLE_LOOKUP_UNAVAILABLE',
      statusCode: 503,
    });
  }

  if (status === 404 || (upstreamMessage && !AUTH_ERROR_PATTERN.test(upstreamMessage) && NOT_FOUND_PATTERN.test(upstreamMessage))) {
    return new NotFoundError({ message: 'No vehicle record found for this registration number.' });
  }

  if (status === 429) {
    return new AppError({
      message: 'Vehicle lookup is rate limited. Please try again in a moment.',
      errorCode: 'VEHICLE_LOOKUP_RATE_LIMITED',
      statusCode: 503,
    });
  }

  return new AppError({
    message: 'Vehicle lookup failed. Please try again or enter the details manually.',
    errorCode: 'VEHICLE_LOOKUP_FAILED',
    statusCode: 502,
  });
}

/* -------------------------------------------------------------------------- */
/* In-process cache                                                           */
/* -------------------------------------------------------------------------- */

const cache = new Map();

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value); // evict oldest
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

function clearCache() {
  cache.clear();
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Look up an Indian vehicle registration number via the Parse CarInfo API.
 *
 * @param {string} rawVehicleNumber e.g. 'BR09AB1234' / 'br 09 ab 1234'
 * @param {object} [options]
 * @param {boolean} [options.bypassCache=false]
 * @returns {Promise<{vehicleNumber: string, data: object, fieldsFound: string[],
 *                    vehicleIdentityVerified: boolean, warnings: object[],
 *                    source: string, cached: boolean}>}
 * @throws {BadRequestError} invalid or missing registration number
 * @throws {NotFoundError}  upstream has no usable record for that number
 * @throws {AppError}       lookup unconfigured / rate limited / upstream failure
 */
async function lookupVehicleByRegistration(rawVehicleNumber, options = {}) {
  const { bypassCache = false } = options;

  const vehicleNumber = normalizeVehicleNumber(rawVehicleNumber);

  if (!vehicleNumber) throw new BadRequestError({ message: 'Vehicle number is required.' });
  if (!isValidVehicleNumber(vehicleNumber)) {
    throw new BadRequestError({ message: 'Enter a valid vehicle registration number, e.g. BR09AB1234.' });
  }

  const { baseUrl, lookupPath, apiKey, timeoutMs } = getConfig();

  if (!apiKey) {
    logger.warn('vehicleLookup.apiKeyMissing', { vehicleNumber });
    throw new AppError({
      message: 'Vehicle lookup is not configured on the server.',
      errorCode: 'VEHICLE_LOOKUP_NOT_CONFIGURED',
      statusCode: 503,
    });
  }

  if (!bypassCache) {
    const cached = readCache(vehicleNumber);
    if (cached) {
      logger.info('vehicleLookup.cacheHit', { vehicleNumber });
      return { ...cached, cached: true };
    }
  }

  let response;
  try {
    response = await axios.get(`${baseUrl}${lookupPath}`, {
      params: { vehicle_number: vehicleNumber },
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      timeout: timeoutMs,
      maxRedirects: 3,
      // We classify the upstream status ourselves (see classifyUpstreamError).
      validateStatus: () => true,
    });
  } catch (error) {
    const timedOut = error?.code === 'ECONNABORTED' || error?.code === 'ETIMEDOUT';
    logger.error('vehicleLookup.requestFailed', {
      vehicleNumber,
      reason: error?.code || 'NETWORK_ERROR',
      timedOut,
      // NOTE: `error.config.headers` is deliberately NOT logged — it carries X-API-Key.
    });

    throw new AppError({
      message: timedOut
        ? 'Vehicle lookup timed out. Please try again.'
        : 'Vehicle lookup is temporarily unavailable. Please try again.',
      errorCode: timedOut ? 'VEHICLE_LOOKUP_TIMEOUT' : 'VEHICLE_LOOKUP_UNAVAILABLE',
      statusCode: timedOut ? 504 : 502,
    });
  }

  const { status, data } = response;

  if (status < 200 || status >= 300) {
    logger.warn('vehicleLookup.upstreamError', {
      vehicleNumber,
      status,
      upstreamMessage: extractUpstreamMessage(data),
    });
    throw classifyUpstreamError(status, data);
  }

  // Parse wraps vehicle data in `{ status, data: {...} }`; tolerate a flat body.
  const payload = (data && typeof data === 'object' && data.data && typeof data.data === 'object' && !Array.isArray(data.data))
    ? data.data
    : data;

  // A 200 that reports its own failure status is an upstream error, not a hit.
  if (data && typeof data === 'object' && typeof data.status === 'string' && !/^(success|ok)$/i.test(data.status)) {
    logger.warn('vehicleLookup.upstreamError', { vehicleNumber, status, upstreamStatus: data.status });
    throw classifyUpstreamError(200, data);
  }

  const { data: contract, fieldsFound, vehicleIdentityVerified, warnings } = mapCarInfoPayload(payload, vehicleNumber);
  const populated = countPopulated(contract);

  if (populated === 0) {
    logger.warn('vehicleLookup.emptyResult', { vehicleNumber });
    throw new NotFoundError({ message: 'No vehicle record found for this registration number.' });
  }

  const result = {
    vehicleNumber,
    data: contract,
    fieldsFound,
    vehicleIdentityVerified,
    warnings,
    source: 'parse_carinfo',
    cached: false,
  };

  writeCache(vehicleNumber, result);
  // Safe production diagnostic: field NAMES only — no values, no owner, no key.
  logger.info('vehicleLookup.success', { vehicleNumber, populated, fieldsFound });

  return result;
}

/** Whether RC lookup is operational (key present). Safe to expose to the admin UI. */
function isVehicleLookupConfigured() {
  return Boolean(getConfig().apiKey);
}

module.exports = {
  lookupVehicleByRegistration,
  isVehicleLookupConfigured,
  // exported for tests / reuse
  normalizeVehicleNumber,
  isValidVehicleNumber,
  mapCarInfoPayload,
  toIsoDate,
  splitMakeModel,
  indexPayload,
  clearCache,
  CONTRACT_FIELDS,
  VEHICLE_NUMBER_PATTERN,
};

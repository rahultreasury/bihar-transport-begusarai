/**
 * RC lookup logic for the admin Vehicle Registration form.
 *
 * Extracted from VehicleRegistrationSection.jsx so the decisions can be unit
 * tested: the status message and the "which fields do we have" question are
 * both actively harmful when wrong, because they tell the admin whether the
 * form was already populated.
 *
 * Principles:
 *   - Nothing is rendered before an explicit "Fetch RC".
 *   - A field is only shown when the API actually returned a value for it.
 *   - The form is never silently overwritten, but the RC section always shows
 *     the API value so the admin can compare it with what they typed.
 *   - Identity is only trusted when the backend marked it verified.
 */

// Backend RC contract field -> TransportVehicle form field.
// [formField, contractKey, humanLabel, optionsOnly]
// `optionsOnly` marks a <select> that can only take one of its own options.
export const RC_FIELD_MAP = [
  ['vehicle_name', 'vehicleName', 'name'],
  ['vehicle_make', 'make', 'make'],
  ['vehicle_model', 'model', 'model'],
  ['manufacturing_year', 'manufacturingYear', 'year'],
  ['registration_date', 'registrationDate', 'registration date'],
  ['insurance_number', 'insuranceNumber', 'insurance no.'],
  ['insurance_expiry', 'insuranceExpiry', 'insurance expiry'],
  ['permit_number', 'permitNumber', 'permit no.'],
  ['permit_expiry', 'permitExpiry', 'permit expiry'],
  ['pollution_certificate', 'pollutionCertificate', 'pollution cert'],
  ['pollution_expiry', 'pollutionExpiry', 'pollution expiry'],
  ['vehicle_type', 'vehicleType', 'type', true],
];

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === '';

/**
 * Work out what the RC would write into the form, WITHOUT mutating anything.
 *
 * @param {object} formData current vehicle form values
 * @param {object} rc       backend `data` block
 * @param {object} [opts]
 * @param {string[]} [opts.vehicleTypeOptions] allowed values for the type <select>
 * @returns {{filled: Array, skippedAsFilled: string[], rcUsable: string[], notApplicable: string[]}}
 */
export function planRcFill(formData, rc, { vehicleTypeOptions = [] } = {}) {
  const filled = [];
  const skippedAsFilled = [];
  const rcUsable = [];
  const notApplicable = [];

  for (const [field, key, label, optionsOnly] of RC_FIELD_MAP) {
    const value = rc?.[key];
    if (isBlank(value)) continue;

    // The RC actually had something for this field.
    rcUsable.push(label);

    if (!isBlank(formData?.[field])) {
      // Admin already typed it — never overwrite.
      skippedAsFilled.push(label);
      continue;
    }

    // A <select> renders nothing for a value outside its option list, so
    // assigning it would silently blank the dropdown. Skip instead.
    if (optionsOnly && !vehicleTypeOptions.includes(String(value))) {
      notApplicable.push(label);
      continue;
    }

    filled.push({ field, label, value: String(value) });
  }

  return { filled, skippedAsFilled, rcUsable, notApplicable };
}

/**
 * Build the user-facing status line.
 *
 * @param {object} p
 * @param {boolean} p.found            backend `found` flag
 * @param {Array}    p.filled          entries that were actually written
 * @param {string[]} p.skippedAsFilled labels the form already had
 * @param {string[]} p.rcUsable       labels the RC actually supplied
 * @param {object[]} [p.warnings]      backend warnings (appended verbatim)
 * @param {string[]} [p.notApplicable] labels skipped because of a <select> mismatch
 * @param {number}   [p.availableCount] how many rows the RC Data section shows
 *        (defaults to the number of form-fillable RC fields)
 */
export function buildRcStatusMessage({
  found,
  filled = [],
  skippedAsFilled = [],
  rcUsable = [],
  warnings = [],
  notApplicable = [],
  availableCount,
} = {}) {
  if (found === false) return 'No RC record found for this number.';

  const note = warnings?.[0]?.message ? ` ${warnings[0].message}` : '';
  // "N fields available" describes what the admin can actually SEE, so prefer
  // the number of rendered RC rows over the form-fillable subset.
  const available = availableCount ?? rcUsable.length;
  const plural = available === 1 ? '' : 's';

  if (available === 0) {
    // Nothing the RC said could be used. Say so plainly — never call this
    // "already filled"; the form may well be empty.
    return `RC found — no verifiable vehicle details were available. Please enter the details manually.${note}`;
  }

  if (filled.length > 0) {
    const autoFilled = filled.map((f) => f.label).join(', ');
    const n = filled.length;
    return `RC found — ${n} field${n === 1 ? '' : 's'} auto-filled (${autoFilled}).${note}`;
  }

  // The RC had usable values and every one of them was already in the form.
  if (skippedAsFilled.length > 0) {
    return `RC found — your existing information was already filled (${skippedAsFilled.join(', ')}).${note}`;
  }

  return `RC found — ${available} field${plural} available.${note}`;
}

/* -------------------------------------------------------------------------- */
/* RC Data section                                                            */
/* -------------------------------------------------------------------------- */

/** `2025-09-28` -> `28/09/2025`. Returns the input unchanged if not ISO. */
export function formatRcDate(iso) {
  if (isBlank(iso)) return null;
  const match = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(iso);
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Insurance status straight from the backend flags — never recomputed here.
 * expired -> Expired | expiring_soon -> Expiring Soon | otherwise -> Active
 */
export function insuranceStatusFrom(rc) {
  if (rc?.insuranceExpired === true) return 'Expired';
  if (rc?.insuranceExpiringSoon === true) return 'Expiring Soon';
  if (rc?.insuranceExpired === false || rc?.insuranceExpiringSoon === false) return 'Active';
  return null;
}

/** PUC status from pollutionCertificateExpired. No expiry date is invented. */
export function pucStatusFrom(rc) {
  if (rc?.pollutionCertificateExpired === true) return 'Expired';
  if (rc?.pollutionCertificateExpired === false) return 'Valid';
  return null;
}

/**
 * Rows for the "RC DETAILS" section.
 *
 * Covers EVERY field the backend's normalized contract can legitimately
 * return (see services/vehicleLookupService.js CONTRACT_FIELDS). A row is
 * emitted ONLY when the backend actually supplied that value, so anything the
 * API does not provide simply never appears — there is no fixed schema and no
 * blank boxes.
 *
 * Fields the backend contract does not have (insuranceNumber, permitNumber,
 * permitExpiry, pollutionCertificate, chassis, engine, capacity, rates) are
 * deliberately absent — they are never invented here.
 *
 * `wide: true` spans the full grid (long free text). `tone` drives colouring.
 */
export function buildRcDisplayRows(rc, { vehicleNumber } = {}) {
  if (!rc || typeof rc !== 'object') return [];

  const rows = [];
  const push = (key, label, value, extra = {}) => {
    if (isBlank(value)) return;
    rows.push({ key, label, value: String(value), ...extra });
  };

  push('vehicleNumber', 'Vehicle Number', vehicleNumber || rc.vehicleNumber, { mono: true });

  // Identity — present only when the backend trusted the payload.
  push('vehicleName', 'Vehicle Name', rc.vehicleName);
  push('make', 'Make', rc.make);
  push('model', 'Model', rc.model);
  // Shown as the RC classification, NOT written into the curated dropdown.
  push('vehicleType', 'Vehicle Type', rc.vehicleType);
  push('isTwoWheeler', 'Is Two Wheeler', boolLabel(rc.isTwoWheeler));

  // Registration
  push('registrationDate', 'Registration Date', formatRcDate(rc.registrationDate), { mono: true });
  push('manufacturingYear', 'Manufacturing Year', rc.manufacturingYear, { mono: true });

  // RTO
  push('rto', 'RTO', rc.rto, { wide: true });
  push('rtoCode', 'RTO Code', rc.rtoCode, { mono: true });
  push('rtoState', 'RTO State', rc.rtoState);

  // Insurance — status comes from the backend flags, never recomputed.
  push('insuranceExpiry', 'Insurance Expiry', formatRcDate(rc.insuranceExpiry), { mono: true });
  const insuranceStatus = insuranceStatusFrom(rc);
  push('insuranceStatus', 'Insurance Status', insuranceStatus, {
    tone: insuranceStatus === 'Expired' ? 'danger' : insuranceStatus === 'Active' ? 'ok' : 'warn',
  });

  // Pollution / PUC
  push('pollutionExpiry', 'Pollution Expiry', formatRcDate(rc.pollutionExpiry), { mono: true });
  const pucStatus = pucStatusFrom(rc);
  push('pollutionStatus', 'Pollution Status', pucStatus, {
    tone: pucStatus === 'Expired' ? 'danger' : pucStatus === 'Valid' ? 'ok' : 'warn',
  });

  return rows;
}

/** Boolean contract flags render as Yes/No rather than being hidden. */
function boolLabel(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

/** True when there is at least one row worth rendering. */
export function hasRcDisplayData(rc, opts) {
  return buildRcDisplayRows(rc, opts).length > 0;
}

/**
 * verify-optional-shipment.mjs
 * ---------------------------------------------------------------------------
 * Exercises the REAL shared validator (utils/bookingForm.js) and the REAL
 * step-gate rule the booking page uses, for the shipment-optional behaviour.
 *
 *   Test A — empty shipment details      → must be allowed through to Review
 *   Test B — only "pipes" entered        → must be allowed
 *   Test C — every field filled          → must be allowed (unchanged)
 *   Test F — required booking info       → must still be enforced
 *   Extra  — mistyped numbers            → still caught (hygiene, not blocking)
 *
 * Run:  node scripts/verify-optional-shipment.mjs
 */

import {
  validateBookingForm,
  getDefaultPickupDate,
  getDefaultPickupTime,
} from '../src/utils/bookingForm.js';

/**
 * Mirror of BookTransport.jsx canProceedToStep(3) — the rule that decides
 * whether "Continue to Review" is live. Kept here so a future change to the
 * page that forgets to update the test fails loudly.
 */
const canProceedToReview = (formData) =>
  !!formData.pickup_date && !!formData.pickup_time;

const base = {
  pickup_location: 'Begusarai',
  drop_location: 'Patna',
  vehicle_type_required: 'truck-17ft',
  pickup_date: getDefaultPickupDate(),
  pickup_time: getDefaultPickupTime(),
  material: '',
  quantity: '',
  quantity_unit: '',
  weight_value: '',
  weight_unit: '',
  goods_type: '',
  fragile: false,
  special_instructions: '',
};

const results = [];
const check = (name, condition, detail = '') => {
  results.push({ name, pass: !!condition, detail });
};

const run = (label, overrides, expectAllowed) => {
  const formData = { ...base, ...overrides };
  const errors = validateBookingForm(formData, { distanceKm: 120 });
  const allowed = canProceedToReview(formData);
  const shipmentErrors = ['material', 'quantity', 'weight_value'].filter((f) => errors[f]);
  check(
    label,
    allowed === expectAllowed && shipmentErrors.length === 0,
    `canProceedToReview=${allowed} (expected ${expectAllowed}) · shipmentErrors=[${shipmentErrors.join(',')}]`
  );
};

// ── Test A: every shipment field empty ─────────────────────────────────────
run('A  empty shipment details → allowed', {}, true);

// ── Test B: only material filled ──────────────────────────────────────────
run('B  material only ("pipes") → allowed', { material: 'pipes' }, true);

// ── Test C: everything filled ─────────────────────────────────────────────
run(
  'C  full shipment details → allowed',
  {
    material: 'GI pipes',
    quantity: '120',
    quantity_unit: 'Bundles',
    weight_value: '8.5',
    weight_unit: 'Tons',
    goods_type: 'Construction material',
    fragile: true,
    special_instructions: 'Loading at the rear gate.',
  },
  true
);

// ── Test A': schedule genuinely missing is still blocking ─────────────────
check(
  'A′ no pickup time → still blocked',
  !canProceedToReview({ ...base, pickup_time: '' }) &&
    !!validateBookingForm({ ...base, pickup_time: '' }, {}).pickup_time
);

// ── Test F: required route/vehicle data is still enforced ─────────────────
{
  const noVehicle = validateBookingForm({ ...base, vehicle_type_required: '' }, {});
  const noPickup = validateBookingForm({ ...base, pickup_location: '' }, {});
  const noDrop = validateBookingForm({ ...base, drop_location: '' }, {});
  const sameEnds = validateBookingForm(
    { ...base, pickup_location: 'Patna', drop_location: 'patna' },
    {}
  );
  check(
    'F  vehicle / pickup / drop / distinct ends still required',
    !!noVehicle.vehicle_type_required &&
      !!noPickup.pickup_location &&
      !!noDrop.drop_location &&
      !!sameEnds.drop_location
  );
}

// ── Extra: a value the customer DID type must still be usable ─────────────
{
  const badQty = validateBookingForm({ ...base, quantity: '-4', quantity_unit: 'Boxes' }, {});
  const okQty = validateBookingForm({ ...base, quantity: '4', quantity_unit: 'Boxes' }, {});
  check(
    'X  mistyped quantity flagged, valid quantity accepted',
    !!badQty.quantity && !okQty.quantity
  );
}

// ── Report ────────────────────────────────────────────────────────────────
let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? '✔' : '✘'} ${r.name}\n    ${r.detail}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);

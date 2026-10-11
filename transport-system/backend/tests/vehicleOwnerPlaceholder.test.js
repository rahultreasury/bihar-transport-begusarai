/**
 * §11 — the owner shown is a real business, never a placeholder string.
 * ---------------------------------------------------------------------------
 * Live finding that motivated this:
 *
 *   VehicleOwner #1 is genuinely named "Orphan Driver Owner". Drivers 1-3 and
 *   vehicles 1/3/4 all point at it, so an assignment reads
 *   `vendor.owner_name === "Orphan Driver Owner"` — a string that tells an
 *   operator nothing and, worse, looks like a real party to a customer.
 *
 *   Two things are being tested here, and the difference matters:
 *
 *     1. The placeholder is RECOGNISED and LABELLED, so the UI can say
 *        "Owner not recorded" instead of printing scaffolding.
 *     2. The `owner_id` is NEVER changed. `transport_owner_id` is where vendor
 *        payouts are routed. Substituting "a better-looking" owner would send one
 *        company's money to another, so this module is recognition-only by
 *        design.
 *
 * Run with: npm test
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPlaceholderOwner,
  displayOwnerName,
  presentOwner,
} = require('../utils/vehicleOwnerPlaceholder');

/** The row that actually exists in the live database. */
const LIVE_PLACEHOLDER = {
  owner_id: 1,
  owner_name: 'Orphan Driver Owner',
  company_name: null,
  owner_type: 'TRANSPORT_COMPANY',
};

test('§11 the live "Orphan Driver Owner" row IS recognised as a placeholder', () => {
  assert.equal(isPlaceholderOwner(LIVE_PLACEHOLDER), true);
});

test('§11 a real business is never mistaken for a placeholder', () => {
  for (const owner of [
    { owner_id: 7, owner_name: 'Partner B Owner' },
    { owner_id: 4, owner_name: 'E2E TestPartner', company_name: 'E2E Transport Co' },
    { owner_id: 766, owner_name: 'P7 Owner INV1' },
    { owner_id: 12, owner_name: 'Bihar Transport Works' },
  ]) {
    assert.equal(isPlaceholderOwner(owner), false, owner.owner_name);
  }
});

test('§11 a real company whose name merely CONTAINS the word is kept', () => {
  // Whole-phrase matching only: "Orphan" inside a real name must not sweep it up.
  assert.equal(
    isPlaceholderOwner({ owner_id: 90, owner_name: 'Orphan Trucking Solutions Pvt Ltd' }),
    false,
  );
});

test('§11 an owner with no name at all is treated as unrecorded, not invented', () => {
  assert.equal(isPlaceholderOwner({ owner_id: 99, owner_name: null, company_name: null }), true);
  assert.equal(displayOwnerName({ owner_id: 99 }), null);
});

test('§11 a placeholder has nothing truthful to display', () => {
  assert.equal(displayOwnerName(LIVE_PLACEHOLDER), null);
  // …but its identity is still intact, because payouts route on the id.
  assert.strictEqual(LIVE_PLACEHOLDER.owner_id, 1);
});

test('§11 the response keeps the id and flags the placeholder', () => {
  const p = presentOwner(LIVE_PLACEHOLDER);
  assert.equal(p.owner_id, 1, 'the id MUST survive — payouts route on it');
  assert.equal(p.owner_name, 'Orphan Driver Owner', 'the stored value is preserved verbatim');
  assert.equal(p.display_name, null, 'nothing meaningless is offered for display');
  assert.equal(p.placeholder, true);
});

test('§11 a real owner is presented unchanged', () => {
  const p = presentOwner({
    owner_id: 7,
    owner_name: 'Partner B Owner',
    company_name: null,
    owner_type: 'TRANSPORT_COMPANY',
  });
  assert.deepStrictEqual(p, {
    owner_id: 7,
    owner_name: 'Partner B Owner',
    owner_type: 'TRANSPORT_COMPANY',
    display_name: 'Partner B Owner',
    placeholder: false,
  });
});

test('§11 company_name is preferred as the display name when present', () => {
  const p = presentOwner({ owner_id: 4, owner_name: 'short', company_name: 'Full Co Ltd' });
  assert.equal(p.display_name, 'Full Co Ltd');
  assert.equal(p.placeholder, false);
});

test('§11 no owner at all still projects as null, never a fake row', () => {
  assert.equal(presentOwner(null), null);
  assert.equal(isPlaceholderOwner(null), false);
});
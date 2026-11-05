/**
 * vehicleOwnerPlaceholder.js
 * ---------------------------------------------------------------------------
 * Recognising a PLACEHOLDER Transport Owner.
 *
 * THE PROBLEM
 *   When a driver is registered without a real business owner, the system has
 *   to give them *something* to point at, so a row is created with a name like
 *   "Orphan Driver Owner". That row is a genuine `VehicleOwner` with a real
 *   `owner_id`, and vehicles legitimately point at it — which is why it is
 *   useful. But it is not a business. Printing its name on an operator screen,
 *   or in a customer offer, tells the reader nothing and hides a master-data gap
 *   that somebody has to close.
 *
 * WHAT THIS DOES AND DOES NOT DO
 *   It only RECOGNISES and LABELS. It never rewrites data, never renames a row
 *   and never substitutes a different owner.
 *
 *   That restraint is a financial safety property, not caution for its own sake:
 *   `transport_owner_id` is where vendor payouts are routed. Swapping in "a
 *   better-looking" owner would silently send one company's money to another.
 *   So the id is always preserved and only the PRESENTATION changes.
 *
 * WHAT THE UI SHOULD DO
 *   Say "Owner not recorded" and keep the assignment usable, because the vehicle
 *   and driver are genuinely reserved and the consignment is genuinely going
 *   ahead. The missing piece is the owner's own paperwork, not the booking.
 */

'use strict';

/**
 * Owner names that are system scaffolding rather than a business.
 *
 * Matched case-insensitively as a whole phrase, so a real company that happens
 * to contain the word "orphan" somewhere in a longer name is not swept up.
 */
const PLACEHOLDER_OWNER_NAMES = [
  'orphan driver owner',
  'orphan owner',
  'unknown owner',
  'no owner',
  'na',
  'n/a',
  'unnamed owner',
  'test owner',
];

/**
 * Is this owner record a placeholder rather than a business?
 *
 * @param {{owner_name?:string|null, company_name?:string|null}} owner
 * @returns {boolean}
 */
function isPlaceholderOwner(owner) {
  if (!owner) return false;

  const names = [owner.owner_name, owner.company_name]
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());

  if (names.length === 0) return true; // no name at all is not a name we can trust

  return names.every((n) => PLACEHOLDER_OWNER_NAMES.includes(n));
}

/**
 * The name to SHOW for an owner, or null when there is nothing truthful to
 * show.
 *
 * A real name is returned unchanged. A placeholder returns null, and the caller
 * renders an explicit "not recorded" state rather than a meaningless string.
 *
 * @param {{owner_name?:string|null, company_name?:string|null}} owner
 * @returns {string|null}
 */
function displayOwnerName(owner) {
  if (isPlaceholderOwner(owner)) return null;
  return owner.company_name || owner.owner_name || null;
}

/**
 * Project an owner for an API response: the ID is ALWAYS preserved so payouts
 * still route correctly, and a `placeholder` flag tells the UI what to say.
 *
 * @param {object|null} owner
 * @returns {object|null}
 */
function presentOwner(owner) {
  if (!owner) return null;
  const placeholder = isPlaceholderOwner(owner);
  return {
    owner_id: owner.owner_id,
    // Kept as the raw stored value, not the display value: this is the record's
    // identity, and code that routes money or writes history must keep it.
    owner_name: owner.owner_name ?? null,
    owner_type: owner.owner_type ?? null,
    // Null means "there is no business name to show", which is different from
    // "the owner is unknown" — see `placeholder`.
    display_name: displayOwnerName(owner),
    placeholder,
  };
}

module.exports = {
  PLACEHOLDER_OWNER_NAMES,
  isPlaceholderOwner,
  displayOwnerName,
  presentOwner,
};
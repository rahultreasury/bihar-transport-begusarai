/**
 * tests/vehicleHireOrderLink.test.js
 * ---------------------------------------------------------------------------
 * THE VEHICLE HIRE TRIP / ORDER ID MUST OPEN THE RIGHT DETAIL PAGE.
 *
 * THE BUG THIS PINS
 *   On /admin/vehicle-hire the "Trip / Order" cell rendered the trip number as
 *   inert text. The first attempt made it a button but resolved the destination
 *   from `booking_number || booking_id` ONLY — and the REAL data shows most
 *   Vehicle Hire rows are enquiry-reservation trips with NO booking
 *   (e.g. BTBT-2026-00030 → trips.enquiry_id set, booking_id/booking_number
 *   null). Those rows therefore stayed non-clickable, which is exactly what the
 *   operator reported.
 *
 * THE FIX
 *   The cell now resolves the correct destination from the row's OWN data:
 *     • booking_number present → Order / Trip Master  /admin/bookings/:number
 *     • else booking_id present → Order / Trip Master  /admin/bookings/:id
 *     • else trip_id present    → Trip Workspace       /admin/trips/:tripId
 *     • else                    → plain, non-clickable text
 *   No id is hardcoded or constructed; every value comes from the row.
 *
 * WHY booking_number AND NOT booking_id FOR ORDERS
 *   /admin/bookings/:bookingNumber resolves through
 *   GET /api/admin/bookings/by-number/:n, whose canonical lookup matches only
 *   booking_number / booking_reference. Passing the numeric booking_id is the
 *   defect already documented in AdminEnquiryWorkspace and
 *   AdminVehicleOwnerProfile. AdminOrders — the list that owns this route —
 *   navigates with `booking_number || booking_reference`; this cell matches it.
 *
 * These are wiring assertions against the real source file, so the link cannot
 * silently regress to plain text or point at an invalid route again.
 *
 * LOCAL ONLY.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

const list = read('pages/AdminVehicleHireList.jsx');
const appJsx = read('App.jsx');

test('the Order / Trip Master and Trip Workspace detail routes both exist', () => {
  assert.match(appJsx, /path="\/admin\/bookings\/:bookingNumber"/, 'order master route must exist');
  assert.match(appJsx, /<AdminOrderMaster\s*\/>/, 'order master route renders AdminOrderMaster');
  assert.match(appJsx, /path="\/admin\/trips\/:tripId"/, 'trip workspace route must exist');
  assert.match(appJsx, /<AdminTripWorkspace\s*\/>/, 'trip workspace route renders AdminTripWorkspace');
});

test('the cell resolves the destination from the row, preferring the order master', () => {
  // booking_number first (canonical), then booking_id, then the trip itself.
  assert.match(list, /if \(r\.booking_number\)/, 'a booking_number must open the order master');
  assert.match(list, /\/admin\/bookings\/\$\{r\.booking_number\}/, 'order master uses the canonical booking_number');
  assert.match(list, /else if \(r\.booking_id\)/, 'booking_id is the order-master fallback');
  assert.match(list, /\/admin\/bookings\/\$\{r\.booking_id\}/, 'booking_id fallback targets the order master');
  assert.match(
    list,
    /else if \(r\.trip_id\)/,
    'an enquiry-reservation trip (no booking) must still resolve a destination',
  );
  assert.match(list, /\/admin\/trips\/\$\{r\.trip_id\}/, 'the no-booking fallback is the trip workspace');
  assert.ok(!/BTB-2026-01766/.test(list), 'no example booking number may be hardcoded into the page');
  assert.ok(!/BTBT-2026-00030/.test(list), 'no example trip number may be hardcoded into the page');
});

test('the Trip / Order id is a real button that navigates to the resolved href', () => {
  assert.match(list, /navigate\(href,/, 'the button navigates to the per-row resolved href');
  assert.match(list, /type="button"/, 'the control must be an explicit button');
});

test('the clickable id carries hover, focus and transition states', () => {
  assert.match(list, /hover:text-bt-orange/, 'a hover colour change is required');
  assert.match(list, /hover:underline/, 'a hover underline affordance is required');
  assert.match(
    list,
    /focus-visible:ring-2 focus-visible:ring-bt-orange\/40/,
    'a visible keyboard focus ring is required',
  );
  assert.match(list, /transition-colors duration-150/, 'a smooth 150ms transition is required');
});

test('a row with no destination identifier stays plain text (never an invalid route)', () => {
  assert.match(list, /href \? \(/, 'the button is only rendered when a destination was resolved');
  assert.match(
    list,
    /: \(\s*<p className="truncate text-\[13px\] font-semibold text-bt-navy">\{r\.trip_number\}<\/p>/,
    'the no-destination fallback must render the trip number as plain text',
  );
});

test('the existing Vehicle Hire list behaviour is preserved', () => {
  assert.match(list, /vehicleHireAPI\.listTrips\(/, 'the list API call is unchanged');
  assert.match(list, /navigate\(`\/admin\/trips\/\$\{r\.trip_id\}\/vehicle-hire`\)/, 'Hire Vehicle is unchanged');
  assert.match(list, /navigate\(`\/admin\/trips\/\$\{r\.trip_id\}`, \{ state: \{ from: '\/admin\/vehicle-hire' \} \}\)/, 'View Trip is unchanged');
});

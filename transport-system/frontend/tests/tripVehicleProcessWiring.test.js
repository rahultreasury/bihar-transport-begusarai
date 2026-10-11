/**
 * tests/tripVehicleProcessWiring.test.js
 * ---------------------------------------------------------------------------
 * THE VEHICLE PROCESS MUST REACH THE VEHICLE HIRE WORKSPACE.
 *
 * THE BUG THIS PINS
 *   `AdminTripProcess` renders Loading and Dispatch. `vehicle` was registered in
 *   the process registry and `VehicleWorkspace.jsx` existed on disk, but nothing
 *   ever imported or rendered it — so `/admin/trips/2133/vehicle` showed an empty
 *   shell. Meanwhile `pages/AdminVehicleHire.jsx` — the whole hire form — was
 *   never registered in App.jsx at all, so it was unreachable from the app.
 *
 *   Worse, `VehicleWorkspace` linked to `/admin/trips/:id/hire`, and `hire`
 *   normalises to the `vehicle` process, so the link pointed back at ITSELF and
 *   could never open the hire form.
 *
 * These are wiring assertions against the real source files, so the page cannot
 * silently go blank again.
 *
 * LOCAL ONLY.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  TRIP_PROCESSES,
  isKnownProcess,
  normalizeProcess,
  LOADING_AND_DISPATCH_ONLY,
} from '../src/components/admin-premium/trips/process/tripProcessModel.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

const appJsx = read('App.jsx');
const tripProcess = read('pages/AdminTripProcess.jsx');
const vehicleWorkspace = read('components/admin-premium/trips/process/VehicleWorkspace.jsx');

test('the registry knows the vehicle process', () => {
  assert.ok(TRIP_PROCESSES.some((p) => p.key === 'vehicle'));
  assert.equal(isKnownProcess('vehicle'), true);
});

test('the vehicle process is one this deployment renders', () => {
  assert.ok(
    LOADING_AND_DISPATCH_ONLY.has('vehicle'),
    'vehicle must not be filtered out as unbuilt',
  );
});

test('the old "hire" segment still resolves to the vehicle process', () => {
  assert.equal(normalizeProcess('hire'), 'vehicle');
  assert.equal(normalizeProcess('vehicle_hire'), 'vehicle');
  assert.equal(normalizeProcess('vehicle-hire'), 'vehicle');
});

test('AdminTripProcess actually renders VehicleWorkspace', () => {
  assert.match(
    tripProcess,
    /import VehicleWorkspace from/,
    'VehicleWorkspace must be imported, not left orphaned on disk',
  );
  assert.match(
    tripProcess,
    /vehicle:\s*\(\)\s*=>\s*\(\s*<VehicleWorkspace/,
    'the workspace map must route the "vehicle" process to VehicleWorkspace',
  );
});

test('the vehicle stage reads the canonical assignment, not a second source', () => {
  assert.match(tripProcess, /vehicleHireAPI\.getAssignment\(tripId\)/);
});

test('the hire FORM is registered as its own route', () => {
  assert.match(
    appJsx,
    /const AdminVehicleHire = lazy\(\(\)\s*=>\s*import\('\.\/pages\/AdminVehicleHire'\)\)/,
    'the hire form page must be lazy-loaded',
  );
  assert.match(
    appJsx,
    /path="\/admin\/trips\/:tripId\/vehicle-hire"/,
    'the hire workspace must have a real route',
  );
});

test('the hire route is declared BEFORE the generic :process route', () => {
  const hire = appJsx.indexOf('path="/admin/trips/:tripId/vehicle-hire"');
  const generic = appJsx.indexOf('path="/admin/trips/:tripId/:process"');
  assert.ok(hire !== -1 && generic !== -1, 'both routes must exist');
  assert.ok(
    hire < generic,
    'React Router matches in order — :process would otherwise swallow "vehicle-hire"',
  );
});

test('VehicleWorkspace links into the hire form, never back into itself', () => {
  // `/hire` normalises to `vehicle`, which renders VehicleWorkspace — so a link
  // to `/hire` from inside VehicleWorkspace is a loop that can never reach the
  // form.
  assert.ok(
    !/\/admin\/trips\/\$\{[^}]+\}\/hire`/.test(vehicleWorkspace),
    'must not link to the /hire segment that resolves back to this page',
  );
  assert.match(vehicleWorkspace, /vehicle-hire/);
});

test('editing an existing hire reuses the same form with ?edit=1', () => {
  assert.match(vehicleWorkspace, /vehicle-hire\?edit=1/);
});

test('vendor payment is NOT inside the vehicle form', () => {
  // A hire establishes gross / commission / net payable. Money moving is a Trip
  // advance or settlement, so the stage must not offer a payment form here.
  assert.match(vehicleWorkspace, /to="\/admin\/settlements"/);
});

test('the stage summary shows the three money values separately', () => {
  assert.match(vehicleWorkspace, /Gross Hire/);
  assert.match(vehicleWorkspace, /Commission/);
  assert.match(vehicleWorkspace, /Net Vendor Payable/);
});

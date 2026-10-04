/**
 * Trip process workspaces — routing and per-process rendering.
 * ---------------------------------------------------------------------------
 * THE BUG THIS LOCKS DOWN
 *
 *   The stepper wrote `/admin/trips/:id?tab=loading`, `?tab=dispatch`, `?tab=pod`
 *   into the URL — and `AdminTripWorkspace` contained no reference to `tab` at
 *   all. So the URL changed and the screen did not: every process rendered the
 *   identical overview, which is why clicking a step looked like doing nothing.
 *
 *   Changing the URL alone could never have fixed it. A process has to be a ROUTE
 *   SEGMENT that selects a DIFFERENT COMPONENT. These tests assert that mapping
 *   exists, and that each workspace is its own component with its own actions —
 *   so the two failures (same page, and URL-only change) cannot both come back.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  TRIP_PROCESSES,
  STAGE_STATE,
  isKnownProcess,
  normalizeProcess,
  processMeta,
  locateStage,
  buildRail,
  isProcessComplete,
  describeProcessState,
  blockedReason,
  processPath,
} from '../src/components/admin-premium/trips/process/tripProcessModel.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8');
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** The rail the server sends for a trip that is ASSIGNED / at the vehicle stage. */
const RAIL = [
  { key: 'ENQUIRY', state: 'done' },
  { key: 'QUOTATION', state: 'done' },
  { key: 'ORDER_CONFIRMED', state: 'done' },
  { key: 'VEHICLE_HIRED', state: 'current' },
  { key: 'LOADING', state: 'upcoming' },
  { key: 'DISPATCH', state: 'upcoming' },
  { key: 'TRANSIT', state: 'upcoming' },
  { key: 'DELIVERY', state: 'upcoming' },
  { key: 'POD', state: 'upcoming' },
  { key: 'COMPLETED', state: 'upcoming' },
];

describe('26. every process is a REAL route, not the same page', () => {
  test('the app declares /admin/trips/:tripId/:process', () => {
    const app = read('App.jsx');
    assert.match(app, /path="\/admin\/trips\/:tripId\/:process"/);
    // And the overview is still its own route, at :tripId.
    assert.match(app, /path="\/admin\/trips\/:tripId"/);
  });

  test('the process route renders a DIFFERENT page component', () => {
    const app = read('App.jsx');
    assert.match(app, /<AdminTripProcess \/>/);
    // The overview is NOT what the process route renders.
    const processRoute = app.slice(app.indexOf('path="/admin/trips/:tripId/:process"'));
    assert.ok(
      !processRoute.slice(0, 220).includes('AdminTripWorkspace'),
      'the process route must not render the overview component',
    );
  });

  test('the process page maps LOADING and DISPATCH to their own components', () => {
    const page = withoutComments(read('pages/AdminTripProcess.jsx'));
    for (const key of ['loading', 'dispatch']) {
      assert.match(
        page,
        new RegExp(`${key}:\\s*\\(\\)\\s*=>`),
        `no workspace is selected for "${key}"`,
      );
    }
    for (const component of ['LoadingWorkspace', 'DispatchWorkspace']) {
      assert.match(page, new RegExp(`<${component}`), `${component} is never rendered`);
    }
  });

  test('the process page does NOT render the excluded workspaces', () => {
    // Vehicle Hire, Transit, Delivery, POD and Completion ship with their own
    // phases. Rendering them here would render screens whose endpoints and
    // tables do not exist in this deployment.
    const page = withoutComments(read('pages/AdminTripProcess.jsx'));
    for (const component of [
      'VehicleWorkspace',
      'TransitWorkspace',
      'DeliveryWorkspace',
      'PodWorkspace',
      'CompletionWorkspace',
    ]) {
      assert.doesNotMatch(page, new RegExp(`<${component}`), `${component} must not be in the L/D boundary`);
    }
    // The process page must not read the Vehicle Hire API at all.
    assert.doesNotMatch(page, /vehicleHireAPI/, 'the Loading -> Dispatch page must not depend on Vehicle Hire');
  });

  test('the two workspaces exist as separate files', () => {
    for (const f of ['LoadingWorkspace.jsx', 'DispatchWorkspace.jsx']) {
      assert.doesNotThrow(
        () => read(`components/admin-premium/trips/process/${f}`),
        `${f} is missing`,
      );
    }
  });

  test('each workspace is genuinely different, not a copy', () => {
    const bodies = ['LoadingWorkspace', 'DispatchWorkspace']
      .map((f) => withoutComments(read(`components/admin-premium/trips/process/${f}.jsx`)));
    assert.strictEqual(new Set(bodies).size, bodies.length, 'two workspaces are identical');
  });
});

describe('22. the stepper no longer points everything at one page', () => {
  const order = withoutComments(read('pages/AdminOrderMaster.jsx'));

  test('the ?tab= destination is gone', () => {
    assert.doesNotMatch(
      order,
      /`\/admin\/trips\/\$\{tripId\}\?tab=/,
      'the ignored ?tab= link must not survive',
    );
  });

  test('a process tab now navigates to a real process route', () => {
    assert.match(order, /normalizeProcess/);
    assert.match(order, /navigate\(`\/admin\/trips\/\$\{tripId\}\/\$\{process\}`\)/);
  });

  test('the vehicle stage opens the VEHICLE workspace, not the hire form', () => {
    assert.match(order, /case 'vehicle_hire':[\s\S]{0,400}?\/admin\/trips\/\$\{tripId\}\/vehicle/);
  });

  test('the old stepper really did read nothing — that was the defect', () => {
    const before = read('pages/AdminTripWorkspace.jsx');
    assert.doesNotMatch(
      before,
      /useSearchParams|searchParams/,
      'the overview must still be tab-free; processes now live on their own route',
    );
  });
});

describe('the process model', () => {
  test('all seven processes are known', () => {
    assert.deepStrictEqual(
      TRIP_PROCESSES.map((p) => p.key),
      ['vehicle', 'loading', 'dispatch', 'transit', 'delivery', 'pod', 'completed'],
    );
    for (const p of TRIP_PROCESSES) assert.equal(isKnownProcess(p.key), true);
    assert.equal(isKnownProcess('nonsense'), false);
  });

  test('legacy stepper values resolve to their process instead of 404', () => {
    assert.equal(normalizeProcess('tracking'), 'transit');
    assert.equal(normalizeProcess('summary'), 'completed');
    assert.equal(normalizeProcess('vehicle_hire'), 'vehicle');
    assert.equal(normalizeProcess('LOADING'), 'loading');
  });

  test('each process has a label and a title', () => {
    for (const p of TRIP_PROCESSES) {
      assert.ok(p.label && p.short && p.title, `${p.key} is missing display copy`);
    }
  });

  test('processPath builds /admin/trips/:id/:process', () => {
    assert.strictEqual(processPath(1094, 'loading'), '/admin/trips/1094/loading');
    assert.strictEqual(processPath(1094, 'tracking'), '/admin/trips/1094/transit');
  });
});

describe('11. stage states come from the server rail', () => {
  test('the current stage is reported as current, not assumed', () => {
    const at = locateStage(RAIL, 'vehicle');
    assert.equal(at.state, STAGE_STATE.CURRENT);
    assert.equal(locateStage(RAIL, 'loading').state, STAGE_STATE.UPCOMING);
  });

  test('buildRail marks the selected process and keeps every process clickable', () => {
    const rail = buildRail(RAIL, 'delivery');
    assert.equal(rail.length, 7);
    // EVERY node is present and clickable — a future stage is never dropped.
    assert.ok(rail.every((n) => n.key && n.state));
    const selected = rail.find((n) => n.isSelected);
    assert.equal(selected.key, 'delivery');
  });

  test('a completed trip reports its finished stages as done', () => {
    const doneRail = RAIL.map((s) => ({ ...s, state: 'done' }));
    assert.equal(locateStage(doneRail, 'pod').state, STAGE_STATE.DONE);
    assert.equal(isProcessComplete('COMPLETED', doneRail, 'pod'), true);
  });
});

describe('12-13. a future stage opens ITSELF and says so', () => {
  test('a future process reports NOT STARTED and names what it waits on', () => {
    const d = describeProcessState({ processKey: 'delivery', tripStatus: 'LOADED', stages: RAIL });
    assert.equal(d.started, false);
    assert.match(d.headline, /DELIVERY NOT STARTED/);
    assert.equal(d.waitingFor, 'Vehicle', 'the current stage is what it waits on');
  });

  test('a completed process reports COMPLETED and is inspectable', () => {
    // The SERVER rail decides this — a trip in transit has loading behind it,
    // so loading is `done` and the workspace must offer its record, not "not started".
    const rail = RAIL.map((s) => ({ ...s, state: 'done' }));
    const d = describeProcessState({ processKey: 'loading', tripStatus: 'IN_TRANSIT', stages: rail });
    assert.equal(d.started, true);
    assert.match(d.headline, /LOADING COMPLETED/);
    assert.equal(d.waitingFor, null);
  });

  test('each process produces its OWN headline, never another process’s', () => {
    const seen = new Set();
    for (const p of TRIP_PROCESSES) {
      const d = describeProcessState({ processKey: p.key, tripStatus: 'PENDING', stages: RAIL });
      assert.ok(!seen.has(d.headline), `${p.key} produced a duplicate headline`);
      seen.add(d.headline);
      assert.match(d.headline, new RegExp(p.label.toUpperCase()));
    }
  });
});

describe('14. process-specific actions only', () => {
  const opsOf = (file) => {
    const src = withoutComments(read(`components/admin-premium/trips/process/${file}`));
    return [...src.matchAll(/ops\.(\w+)\(/g)].map((m) => m[1]);
  };

  test('LOADING calls only loading actions', () => {
    const ops = opsOf('LoadingWorkspace.jsx');
    assert.ok(ops.length > 0);
    for (const op of ops) assert.match(op, /^(sendToLoading|arriveAtLoading|saveLoadingFacts|completeLoading)$/, op);
  });

  test('DISPATCH calls only dispatch actions, and no billing action', () => {
    const ops = [...new Set(opsOf('DispatchWorkspace.jsx'))].sort();
    // The dispatch paperwork that has to exist before the vehicle may leave…
    assert.deepStrictEqual(ops, [
      'dispatchVehicle',
      'documentFileUrl',
      'saveDeliveryInfo',
      'saveEwayBill',
      'saveInsurance',
      'saveLrGr',
      'uploadDocument',
    ]);
    // …and NOTHING from the customer-billing lifecycle, which ships separately.
    for (const billingOp of [
      'createInvoice',
      'recordCustomerPayment',
      'invoicePdfUrl',
      'moneyReceiptUrl',
      'getInvoice',
    ]) {
      assert.ok(!ops.includes(billingOp), `${billingOp} must not be in the dispatch workspace`);
    }
  });

  test('no workspace mutates by hand-writing a URL', () => {
    for (const f of ['LoadingWorkspace.jsx', 'DispatchWorkspace.jsx']) {
      const src = withoutComments(read(`components/admin-premium/trips/process/${f}`));
      assert.doesNotMatch(src, /api\.(post|put|patch)\(/, `${f} bypasses the named operations`);
    }
  });
});

describe('5. dispatch is blocked when the server says so', () => {
  test('a not-ready readiness produces a message naming the blocker', () => {
    const reason = blockedReason({
      ready: false,
      blockers: [{ code: 'E_WAY_BILL', message: 'E-Way Bill pending' }],
    });
    assert.match(reason, /E-Way Bill pending/);
  });

  test('a ready readiness produces no block', () => {
    assert.equal(blockedReason({ ready: true, blockers: [] }), null);
    assert.equal(blockedReason(null), null);
  });

  test('the dispatch workspace disables the button when the server says not ready', () => {
    const src = withoutComments(read('components/admin-premium/trips/process/DispatchWorkspace.jsx'));
    // `canDispatch` is derived from the SERVER's readiness, never from local state.
    assert.match(src, /const canDispatch = Boolean\(readiness\?\.ready\)/);
    // The button is disabled whenever that is false, and while a call is in flight.
    assert.match(src, /disabled=\{!canDispatch \|\| busy === 'dispatch'\}/);
  });

  test('a refusal from the server is surfaced, never swallowed', () => {
    const page = withoutComments(read('pages/AdminTripProcess.jsx'));
    // The action runner re-reads from the backend after every call and returns
    // false on refusal, so a workspace can tell a refusal from a success.
    assert.match(page, /await fn\(\);\s*\n\s*await load\(\);/);
    assert.match(page, /return false;/);
  });
});

describe('15/19/23. the shared shell carries the context', () => {
  const shell = withoutComments(read('components/admin-premium/trips/process/TripProcessShell.jsx'));

  test('every process nav node points at its own process route', () => {
    assert.match(shell, /`\/admin\/trips\/\$\{tripId\}\/\$\{node\.key\}`/);
  });

  test('there is a Back to Trip breadcrumb (§19)', () => {
    assert.match(shell, /Back to Trip/);
    assert.match(shell, /`\/admin\/trips\/\$\{tripId\}`/);
  });

  test('the header names the PROCESS, not just "Trips" (§20)', () => {
    assert.match(shell, /meta\?\.title/);
    assert.match(shell, /Current Vehicle/);
    assert.match(shell, /Current Driver/);
    assert.match(shell, /Current Status/);
  });

  test('the rail scrolls on a narrow screen (§24)', () => {
    assert.match(shell, /overflow-x-auto/);
    assert.match(shell, /min-w-max/);
  });

  test('it exposes the not-started and completed-record blocks (§12/§13)', () => {
    assert.match(shell, /export function NotStarted/);
    assert.match(shell, /export function CompletedRecord/);
  });
});

/**
 * These two tests exist because the page was quietly broken in exactly these ways:
 * the assignment was read with `booking_id: undefined`, so the Vehicle stage could
 * never show a vehicle no matter what the database held; and movement history was
 * passed as `trip.timeline`, a field the trip endpoint does not return.
 */
describe('9/16. the process page reads REAL state, not placeholders', () => {
  const page = withoutComments(read('pages/AdminTripProcess.jsx'));

  test('the page reads Loading and Dispatch state from real endpoints', () => {
    // Documents come from the server, not from the trip payload.
    assert.match(page, /tripOperations\.getDocuments\(tripId\)/);
    // Dispatch readiness comes from the server on every visit, so a reload can
    // never show a stale "ready".
    assert.match(page, /tripOperations\.getDispatchReadiness\(tripId\)/);
    assert.match(page, /tripOperations\.getDispatchWorkspace\(tripId\)/);
  });

  test('movement history is read from the timeline endpoint, not a missing field', () => {
    assert.match(page, /tripOperations\.getTimeline\(tripId\)/);
    assert.doesNotMatch(page, /trip\?\.timeline/, 'the trip payload has no timeline field');
    assert.match(page, /Movement History/);
  });
});
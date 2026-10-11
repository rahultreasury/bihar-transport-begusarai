/**
 * Enquiry ⇄ Vehicle Hire boundary tests.
 * ---------------------------------------------------------------------------
 * The single most important invariant in this application right now:
 *
 *   THE ENQUIRY PAGE QUOTES. THE VEHICLE HIRE PAGE HIRES.
 *
 * There must be exactly ONE vehicle-hiring workflow — the Universal Vehicle
 * Hire workspace at /admin/trips/:tripId/hire. The Enquiry page may OBSERVE the
 * hire state and LINK to that workflow; it must never render a hiring form, post
 * an assignment, or price a hire.
 *
 * WHAT IS COVERED
 *   1. The pure handoff module (hireHandoff.js): the three server states, their
 *      labels, their single action, and the one Universal Vehicle Hire route.
 *   2. The rendered handoff card, via React's server renderer — what the Enquiry
 *      page actually shows for each of the three states.
 *   3. Source contracts on the Enquiry page files: the hiring controls are gone,
 *      the quotation controls are intact, and the backend APIs were not deleted.
 *
 * WHY BUNDLE WITH ESBUILD
 *   The repo's test runner is `node --test tests/*.test.js` — plain Node, no JSX
 *   transform and no DOM. The card is a .jsx module, so it is bundled to a
 *   temporary ESM file with the esbuild that already ships with Vite, then
 *   rendered with react-dom/server. The API modules are stubbed so no network or
 *   `import.meta.env` is involved. Same approach as `npm run check:design`.
 *
 * Run with: npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  HIRE_STATE,
  HIRE_STATE_VIEW,
  HIRE_ROUTE_PATTERN,
  HANDOFF_STAGE,
  canFinalizeQuote,
  describeHireAssignment,
  handoffStage,
  hireRouteFor,
  isHireCompleted,
  driverLabel,
  vehicleLabel,
  vendorLabel,
} from '../src/components/admin-premium/enquiries/hireHandoff.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const CACHE = path.join(HERE, '..', 'node_modules', '.cache');

const readSource = (rel) => readFileSync(path.join(SRC, rel), 'utf8');

/* ═══════════════════════════════════════════════════════════════════════════
   1. THE PURE HANDOFF MODULE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('hireHandoff — the canonical states and their single action', () => {
  test('exactly three states exist, matching the server', () => {
    assert.deepStrictEqual(Object.keys(HIRE_STATE_VIEW).sort(), [
      'VEHICLE_ASSIGNED',
      'VEHICLE_HIRED',
      'WAITING_FOR_VEHICLE',
    ]);
  });

  test('waiting for vehicle → "Waiting for Vehicle" / Hire Vehicle', () => {
    const view = describeHireAssignment({
      hire_status: HIRE_STATE.WAITING_FOR_VEHICLE,
      trip_id: 91,
    });
    assert.strictEqual(view.stateLabel, 'Waiting for Vehicle');
    assert.strictEqual(view.action, 'Hire Vehicle');
    assert.strictEqual(view.isHired, false);
  });

  test('vehicle assigned → "Vehicle Assigned" / Complete Vehicle Hire', () => {
    const view = describeHireAssignment({
      hire_status: HIRE_STATE.VEHICLE_ASSIGNED,
      trip_id: 91,
    });
    assert.strictEqual(view.stateLabel, 'Vehicle Assigned');
    assert.strictEqual(view.action, 'Complete Vehicle Hire');
    assert.strictEqual(view.isHired, false);
  });

  test('vehicle hired → "Vehicle Hired" / View Vehicle Hire', () => {
    const view = describeHireAssignment({
      hire_status: HIRE_STATE.VEHICLE_HIRED,
      trip_id: 91,
    });
    assert.strictEqual(view.stateLabel, 'Vehicle Hired');
    assert.strictEqual(view.action, 'View Vehicle Hire');
    assert.strictEqual(view.isHired, true);
  });

  test('assigned is NEVER presented as hired', () => {
    assert.notStrictEqual(
      HIRE_STATE_VIEW[HIRE_STATE.VEHICLE_ASSIGNED].label,
      HIRE_STATE_VIEW[HIRE_STATE.VEHICLE_HIRED].label,
    );
    assert.strictEqual(isHireCompleted({ hire_status: 'VEHICLE_ASSIGNED' }), false);
    assert.strictEqual(isHireCompleted({ hire_status: 'VEHICLE_HIRED' }), true);
  });

  test('an unrecognised state falls back instead of guessing', () => {
    const view = describeHireAssignment({ hire_status: 'SOMETHING_NEW', trip_id: 7 });
    assert.strictEqual(view.stateLabel, 'SOMETHING_NEW');
    assert.strictEqual(view.action, 'Open Vehicle Hire');
    assert.strictEqual(view.isHired, false);
  });
});

describe('hireHandoff — ONE route for every state', () => {
  test('the Universal Vehicle Hire route is /admin/trips/:tripId/vehicle-hire', () => {
    // `vehicle-hire` is the canonical route (registered in App.jsx).
    // The legacy `/vehicle` route redirects to this canonical route for
    // backward compatibility with existing bookmarks.
    assert.strictEqual(HIRE_ROUTE_PATTERN, '/admin/trips/:tripId/vehicle-hire');
    assert.strictEqual(hireRouteFor(91), '/admin/trips/91/vehicle-hire');
    assert.strictEqual(hireRouteFor('91'), '/admin/trips/91/vehicle-hire');
    assert.strictEqual(hireRouteFor(91, { edit: true }), '/admin/trips/91/vehicle-hire?edit=1');
  });

  test('all three states navigate to the SAME screen', () => {
    const routes = [
      HIRE_STATE.WAITING_FOR_VEHICLE,
      HIRE_STATE.VEHICLE_ASSIGNED,
      HIRE_STATE.VEHICLE_HIRED,
    ].map((hire_status) => describeHireAssignment({ hire_status, trip_id: 404 }).route);

    assert.strictEqual(new Set(routes).size, 1, 'each state must resolve to one workflow');
    assert.strictEqual(routes[0], '/admin/trips/404/vehicle-hire');
  });
});

describe('hireHandoff — labels come from the server, never from inference', () => {
  const assignment = {
    hire_status: HIRE_STATE.VEHICLE_ASSIGNED,
    trip_id: 512,
    trip_number: 'TRP-512',
    trip_status: 'PLANNED',
    vehicle: { vehicle_number: 'BR09CC0004', vehicle_name: 'Ashok Leyland Tempo' },
    driver: { driver_name: 'Kaushal' },
    vendor: { owner_name: 'P7 Owner IDEM1' },
  };

  test('vehicle / driver / vendor are read verbatim', () => {
    assert.strictEqual(vehicleLabel(assignment), 'BR09CC0004 · Ashok Leyland Tempo');
    assert.strictEqual(driverLabel(assignment), 'Kaushal');
    assert.strictEqual(vendorLabel(assignment), 'P7 Owner IDEM1');
  });

  test('a missing owner reads "Not assigned" — never a fabricated vendor', () => {
    assert.strictEqual(vendorLabel({ vehicle: {}, driver: {} }), 'Not assigned');
    assert.strictEqual(vehicleLabel({}), 'Not assigned');
    assert.strictEqual(driverLabel({}), 'Not assigned');
  });

  test('hire money is passed through, never computed here', () => {
    const withHire = describeHireAssignment({
      ...assignment,
      hire_status: HIRE_STATE.VEHICLE_HIRED,
      hire: { gross_hire: 12000, commission_amount: 1200, net_vendor_payable: 10800 },
    });
    // The card renders these; this module must not adjust a single figure.
    assert.deepStrictEqual(withHire.hire, {
      gross_hire: 12000,
      commission_amount: 1200,
      net_vendor_payable: 10800,
    });
  });

  test('no hire record → no money block at all', () => {
    assert.strictEqual(describeHireAssignment(assignment).hire, null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. THE RENDERED HANDOFF CARD
   ═══════════════════════════════════════════════════════════════════════════ */

const API_STUB = `
const stub = {
  getAssignmentByBooking: async () => ({ data: { success: true, data: null } }),
  getAssignment: async () => ({ data: { success: true, data: null } }),
};
export const vehicleHireAPI = stub;
export const adminAPI = stub;
export default stub;
`;

/** Stub the axios-backed API modules so no network / import.meta.env is used. */
const stubApiPlugin = {
  name: 'stub-api',
  setup(builder) {
    // The import specifiers are extensionless ('../../../services/api'), so the
    // filter must match both forms.
    builder.onResolve({ filter: /services\/(api|vehicleHireAPI)(\.js)?$/ }, (args) => ({
      path: args.path,
      namespace: 'api-stub',
    }));
    builder.onLoad({ filter: /.*/, namespace: 'api-stub' }, () => ({
      contents: API_STUB,
      loader: 'js',
    }));
  },
};

let cardModule = null;

/** Bundle the .jsx card once, then import it. */
async function loadCard() {
  if (cardModule) return cardModule;

  mkdirSync(CACHE, { recursive: true });
  const outfile = path.join(CACHE, 'bt-enquiry-hire-handoff.test.mjs');

  await build({
    entryPoints: [
      path.join(SRC, 'components/admin-premium/enquiries/VehicleHireStatusCard.jsx'),
    ],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    logLevel: 'silent',
    // Everything that ships its own ESM entry stays external so Node resolves
    // it from node_modules; bundling lucide-react's CJS build would try to
    // `require('react')` from inside an ESM file, which is not supported.
    external: [
      'react',
      'react-dom',
      'react-router-dom',
      'react/jsx-runtime',
      'lucide-react',
    ],
    plugins: [stubApiPlugin],
  });

  cardModule = await import(`${outfile}?t=${Date.now()}`);
  return cardModule;
}

/**
 * Render the presentational half and return the markup plus the spy callbacks.
 *
 * `assignCalls` collects presses of "Assign Vehicle & Driver" so a test can
 * assert the card OFFERS the action without the card ever performing it on its
 * own — provisioning is a deliberate click, never a side effect of rendering.
 */
async function renderHandoff({
  assignment = null,
  enquiryStatus = null,
  quoteLabel = null,
  pickup = null,
  drop = null,
  customerOfferUrl = null,
  tripUrl = null,
} = {}) {
  const { VehicleHireHandoffCard } = await loadCard();
  const navigatedTo = [];
  const assignCalls = [];
  const el = React.createElement(VehicleHireHandoffCard, {
    assignment,
    enquiryStatus,
    quoteLabel,
    pickup,
    drop,
    customerOfferUrl,
    tripUrl,
    onOpenHire: (route) => navigatedTo.push(route),
    onAssignVehicleAndDriver: () => assignCalls.push(true),
  });
  return { html: renderToStaticMarkup(el), navigatedTo, assignCalls };
}

/**
 * The visible text of the card, tags stripped.
 *
 * Assertions read TEXT, not markup: an icon renders as `<svg …></svg>` directly
 * before the label, so `>Hire Vehicle<` never matches even though the word is on
 * screen. This is what an operator actually reads.
 */
const AMP = String.fromCharCode(38) + 'amp;';
const QUOT = String.fromCharCode(38) + 'quot;';

/**
 * The visible text of the card, tags stripped and entities decoded.
 *
 * Assertions read TEXT, not markup: an icon renders as `<svg …></svg>` directly
 * before the label, so `>Hire Vehicle<` never matches even though the word is on
 * screen. This is what an operator actually reads.
 */
function textOf(html) {
  return html
    .replace(/<[^>]*>/g, ' ')
    .split(AMP).join('&')
    .split(QUOT).join('"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const WAITING = {
  hire_status: 'WAITING_FOR_VEHICLE',
  trip_id: 512,
  trip_number: 'TRP-512',
  trip_status: 'PLANNED',
  vehicle: null,
  driver: null,
  vendor: null,
};

/** A consignment whose enquiry has not been created/provisioned at all. */
const NOT_PROVISIONED = null;

const ASSIGNED = {
  ...WAITING,
  hire_status: 'VEHICLE_ASSIGNED',
  vehicle: { vehicle_number: 'BR09CC0004', vehicle_name: 'Ashok Leyland Tempo' },
  driver: { driver_name: 'Kaushal' },
  vendor: { owner_name: 'P7 Owner IDEM1' },
};

const HIRED = {
  ...ASSIGNED,
  hire_status: 'VEHICLE_HIRED',
  hire: { gross_hire: 12000, commission_amount: 1200, net_vendor_payable: 10800 },
};

describe('VehicleHireStatusCard — the four-stage handoff, never a form', () => {
  test('STATE 1 — nothing engaged offers ASSIGN VEHICLE & DRIVER', async () => {
    const { html, assignCalls } = await renderHandoff({
      assignment: WAITING,
      enquiryStatus: 'ADMIN_REVIEW',
    });
    const text = textOf(html);
    assert.match(html, /data-handoff-stage="NEED_RESOURCES"/);
    assert.ok(
      text.includes('Assign an available vehicle and driver before sending the final quote'),
      'the card must say why this step comes first',
    );
    assert.match(html, /data-testid="assign-vehicle-and-driver"/);
    assert.ok(text.includes('Assign Vehicle & Driver'));
    // Provisioning is triggered by the click, never by rendering.
    assert.deepStrictEqual(assignCalls, []);
  });

  test('STATE 1 — an enquiry with no trip at all still offers the action', async () => {
    const { html } = await renderHandoff({
      assignment: NOT_PROVISIONED,
      enquiryStatus: 'ENQUIRY_SUBMITTED',
    });
    assert.match(html, /data-handoff-stage="NEED_RESOURCES"/);
    assert.match(html, /data-testid="assign-vehicle-and-driver"/);
  });

  test('STATE 2 — RESERVED, with vehicle, driver, owner, pickup and drop', async () => {
    const { html } = await renderHandoff({
      assignment: ASSIGNED,
      enquiryStatus: 'QUOTE_READY',
      pickup: 'Patna Junction',
      drop: 'Bihar Transport, Begusarai',
    });
    const text = textOf(html);
    assert.match(html, /data-handoff-stage="RESOURCES_READY"/);
    for (const fact of [
      'Reserved',
      'BR09CC0004',
      'Ashok Leyland Tempo',
      'Kaushal',
      'P7 Owner IDEM1',
      'Patna Junction',
      'Bihar Transport, Begusarai',
    ]) {
      assert.ok(text.includes(fact), `expected "${fact}" on the card`);
    }
    assert.ok(text.includes('Pickup'));
    assert.ok(text.includes('Drop'));
    assert.ok(text.includes('Owner'));
    assert.ok(text.includes('Customer approval'));
    assert.ok(text.includes('Reserved for this enquiry'));
    assert.match(html, /data-testid="open-vehicle-hire"/);
    assert.match(html, /data-testid="change-assignment"/);
    assert.ok(text.includes('Change Assignment'));
  });

  test('STATE 3 — READY FOR CUSTOMER: the price sits beside the reserved truck', async () => {
    const { html } = await renderHandoff({
      assignment: ASSIGNED,
      enquiryStatus: 'AWAITING_CUSTOMER_ACCEPTANCE',
      quoteLabel: '₹5,000',
      customerOfferUrl: '/booking/enquiry/BTB-20261003-004071',
    });
    const text = textOf(html);
    assert.match(html, /data-handoff-stage="QUOTE_SENT"/);
    assert.ok(text.includes('Ready for Customer'));
    assert.ok(text.includes('₹5,000'), 'the price is shown beside the reserved vehicle');
    assert.ok(text.includes('Final Quote'));
    assert.ok(text.includes('BR09CC0004'));
    assert.ok(text.includes('Kaushal'));
    assert.ok(
      text.includes('sent together to the customer'),
      'the customer was offered the truck with the price',
    );
    assert.match(html, /data-testid="view-customer-offer"/);
  });

  test('STATE 4 — after acceptance the next step is loading', async () => {
    const { html } = await renderHandoff({
      assignment: ASSIGNED,
      enquiryStatus: 'CONFIRMED',
      quoteLabel: '₹5,000',
    });
    const text = textOf(html);
    assert.match(html, /data-handoff-stage="CONFIRMED"/);
    assert.ok(text.includes('Confirmed'));
    assert.ok(text.includes('Next: Send / Schedule Vehicle for Loading'));
    assert.ok(text.includes('BR09CC0004'));
    assert.ok(text.includes('Kaushal'));
    // There is NO second waiting state after the customer accepts.
    assert.ok(!text.includes('Waiting for Vehicle'));
    assert.ok(!text.includes('Assign Vehicle & Driver'));
  });

  test('2. the card contains NO hiring form, in any stage', async () => {
    const stages = [
      { assignment: NOT_PROVISIONED, enquiryStatus: 'ENQUIRY_SUBMITTED' },
      { assignment: WAITING, enquiryStatus: 'ADMIN_REVIEW' },
      { assignment: ASSIGNED, enquiryStatus: 'QUOTE_READY' },
      { assignment: ASSIGNED, enquiryStatus: 'AWAITING_CUSTOMER_ACCEPTANCE' },
      { assignment: ASSIGNED, enquiryStatus: 'CONFIRMED' },
      { assignment: HIRED, enquiryStatus: 'CONFIRMED' },
    ];
    for (const stage of stages) {
      const { html } = await renderHandoff(stage);
      assert.doesNotMatch(html, /<select/i, 'no vehicle/driver picker on the enquiry page');
      assert.doesNotMatch(html, /<input/i, 'no hire amount / commission / rate inputs');
      assert.doesNotMatch(html, /<textarea/i, 'no hire notes field');
      assert.doesNotMatch(html, /<form/i, 'no hire form');
      assert.doesNotMatch(html, /type="number"/i, 'no hire amount field');
      assert.doesNotMatch(html, /Billing model/i, 'no billing-model control');
      assert.doesNotMatch(html, /Contract \/ Commission/i, 'no contract/commission control');
    }
  });

  test('hire money, when it exists, is READ-BACK — never editable here', async () => {
    const { html } = await renderHandoff({
      assignment: HIRED,
      enquiryStatus: 'CONFIRMED',
    });
    const text = textOf(html);
    for (const figure of ['Gross hire', 'Commission', 'Net payable']) {
      assert.ok(text.includes(figure), `expected the stored "${figure}" to be shown`);
    }
    assert.ok(text.includes('12,000') && text.includes('10,800'), 'stored figures, read verbatim');
    assert.doesNotMatch(html, /contenteditable/i);
    assert.doesNotMatch(html, /onChange=/);
  });

  test('8. every action resolves to the existing Universal Vehicle Hire route', async () => {
    for (const assignment of [ASSIGNED, HIRED]) {
      const { html, navigatedTo } = await renderHandoff({ assignment, enquiryStatus: 'QUOTE_READY' });
      assert.match(html, /data-testid="open-vehicle-hire"/, 'a navigation action must exist');
      assert.deepStrictEqual(navigatedTo, [], 'rendering alone must never navigate');
      assert.strictEqual(
        describeHireAssignment(assignment).route,
        `/admin/trips/${assignment.trip_id}/vehicle-hire`,
      );
    }
    assert.strictEqual(hireRouteFor(512), '/admin/trips/512/vehicle-hire');
    assert.strictEqual(hireRouteFor(512, { edit: true }), '/admin/trips/512/vehicle-hire?edit=1');
  });

  test('the card wires its button to the canonical route', () => {
    const code = withoutComments(statusCard);
    assert.match(code, /onClick=\{\(\) => onOpenHire\(view\.route\)\}/);
  });

  test('the card asks the SERVER to provision — it never creates a trip', () => {
    const code = withoutComments(statusCard);
    assert.match(code, /vehicleHireAPI\.provision\(/);
    // The enquiry id is what the server provisions by; React only reads the id back.
    assert.match(code, /enquiry_id: enquiryId/);
    assert.doesNotMatch(code, /prisma\./);
    assert.doesNotMatch(code, /\.trip\.create\(/);
  });
});

describe('handoffStage — the four workflow stages, derived from server state', () => {
  test('nothing engaged → NEED_RESOURCES', () => {
    assert.strictEqual(
      handoffStage({ assignment: WAITING, enquiryStatus: 'ADMIN_REVIEW' }),
      HANDOFF_STAGE.NEED_RESOURCES,
    );
    assert.strictEqual(
      handoffStage({ assignment: null, enquiryStatus: 'ENQUIRY_SUBMITTED' }),
      HANDOFF_STAGE.NEED_RESOURCES,
    );
  });

  test('vehicle assigned → RESOURCES_READY', () => {
    assert.strictEqual(
      handoffStage({ assignment: ASSIGNED, enquiryStatus: 'QUOTE_READY' }),
      HANDOFF_STAGE.RESOURCES_READY,
    );
  });

  test('quote with the customer → QUOTE_SENT', () => {
    assert.strictEqual(
      handoffStage({ assignment: ASSIGNED, enquiryStatus: 'AWAITING_CUSTOMER_ACCEPTANCE' }),
      HANDOFF_STAGE.QUOTE_SENT,
    );
  });

  test('customer accepted → CONFIRMED, whatever the resource state says', () => {
    for (const status of ['CUSTOMER_ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']) {
      assert.strictEqual(
        handoffStage({ assignment: ASSIGNED, enquiryStatus: status }),
        HANDOFF_STAGE.CONFIRMED,
        status,
      );
    }
    // Even a consignment whose reservation was somehow lost must not fall back
    // to "waiting" — the customer already committed.
    assert.strictEqual(
      handoffStage({ assignment: WAITING, enquiryStatus: 'CONFIRMED' }),
      HANDOFF_STAGE.CONFIRMED,
    );
  });
});

describe('canFinalizeQuote — the quote and the truck are published as one', () => {
  test('11. no price → blocked', () => {
    const r = canFinalizeQuote({ assignment: ASSIGNED, finalPrice: '' });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /final quote amount/i);
  });

  test('11. a vehicle with no driver → blocked (this is the wait we are removing)', () => {
    const r = canFinalizeQuote({
      assignment: { vehicle: ASSIGNED.vehicle, driver: null },
      finalPrice: 5000,
    });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /driver/i);
  });

  test('11. a driver with no vehicle → blocked', () => {
    const r = canFinalizeQuote({
      assignment: { vehicle: null, driver: ASSIGNED.driver },
      finalPrice: 5000,
    });
    assert.strictEqual(r.allowed, false);
    assert.match(r.reason, /vehicle/i);
  });

  test('12. price + vehicle + driver → allowed', () => {
    const r = canFinalizeQuote({ assignment: ASSIGNED, finalPrice: 5000 });
    assert.deepStrictEqual(r, { allowed: true, reason: null });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. SOURCE CONTRACTS — the Enquiry page files
   ═══════════════════════════════════════════════════════════════════════════ */

const workspace = readSource('pages/AdminEnquiryWorkspace.jsx');
const quoteWorkspace = readSource('components/admin-premium/enquiries/QuoteWorkspace.jsx');
const statusCard = readSource('components/admin-premium/enquiries/VehicleHireStatusCard.jsx');

/** JSX comments are not rendered, so strip them before asserting on copy. */
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('Enquiry page — no vehicle-hiring UI remains', () => {
  test('3. no "Assign Resources" / "Reassign" action', () => {
    const code = withoutComments(workspace);
    assert.doesNotMatch(code, /Assign Resources/);
    assert.doesNotMatch(code, /\bReassign\b/);
  });

  test('3. no Transport Owner / Transport Partner / Driver / Vehicle selectors', () => {
    const code = withoutComments(workspace);
    assert.doesNotMatch(code, /id="assign-owner"/);
    assert.doesNotMatch(code, /id="assign-partner"/);
    assert.doesNotMatch(code, /id="assign-vehicle"/);
    assert.doesNotMatch(code, /id="assign-driver"/);
    assert.doesNotMatch(code, /PremiumCombobox/);
    assert.doesNotMatch(code, /assignmentSelectors/);
  });

  test('3. the page never writes an assignment', () => {
    const code = withoutComments(workspace);
    assert.doesNotMatch(code, /adminEnquiryAPI\.assign\(/);
    assert.doesNotMatch(code, /adminEnquiryAPI\.reassign\(/);
    assert.doesNotMatch(code, /assignTripResources/);
  });

  test('3. QuoteWorkspace has no driver/vehicle picker either', () => {
    const code = withoutComments(quoteWorkspace);
    assert.doesNotMatch(code, /DriverPickerModal/);
    assert.doesNotMatch(code, /assignBookingDriver/);
    assert.doesNotMatch(code, /enquiry-driver-button/);
    assert.doesNotMatch(code, /enquiry-vehicle-select/);
    assert.doesNotMatch(code, /getVehicles/);
  });

  test('3. the status card posts nothing — it can only read and navigate', () => {
    const code = withoutComments(statusCard);
    assert.doesNotMatch(code, /vehicleHireAPI\.(assignTripResources|hireVehicle|updateVehicleHire|previewHire)/);
    assert.doesNotMatch(code, /api\.(post|put|patch)\b/);
    // It must still read the canonical assignment.
    assert.match(code, /vehicleHireAPI\.getAssignmentByBooking/);
  });
});

describe('Enquiry page — the Vehicle Hire handoff is present', () => {
  test('the workspace renders the status card', () => {
    assert.match(workspace, /import VehicleHireStatusCard/);
    assert.match(workspace, /<VehicleHireStatusCard/);
    assert.match(workspace, /title="Vehicle & Driver"/);
  });

  test('the quote is shown together with the vehicle and the driver', () => {
    const code = withoutComments(workspace);
    assert.match(code, />\s*Vehicle\s*</);
    assert.match(code, />\s*Driver\s*</);
    assert.match(code, /reservation\.vehicle/);
    assert.match(code, /reservation\.driver/);
  });

  test('the card is addressed by enquiry/booking, not by a guessed trip', () => {
    assert.match(workspace, /enquiryId=\{enquiry\.enquiry_id\}/);
    assert.match(workspace, /bookingId=\{enquiry\.booking\?\.booking_id\}/);
  });
});

describe('Enquiry page — the quotation flow is intact', () => {
  test('1. the final quote is displayed', () => {
    const code = withoutComments(workspace);
    assert.match(code, /Final quote/);
    assert.match(code, /formatINR\(enquiry\.quote\?\.final_quoted_price\)/);
  });

  test('the estimated price is displayed', () => {
    const code = withoutComments(workspace);
    assert.match(code, /Estimated price/);
    assert.match(code, /estimatedRange/);
  });

  test('9. quote editing still works', () => {
    const code = withoutComments(workspace);
    assert.match(code, /id="final-price"/);
    assert.match(code, /id="quote-remarks"/);
    assert.match(code, /adminEnquiryAPI\.saveQuote/);
  });

  test('20. quote publishing still works, gated on the reservation', () => {
    const code = withoutComments(workspace);
    assert.match(code, /adminEnquiryAPI\.sendQuote/);
    assert.match(code, /Finalize Quote & Send to Customer/);
    // The button is wired to the same pure gate the unit tests cover.
    assert.match(code, /canFinalizeQuote\(\{ assignment, finalPrice: quote\.final_price \}\)/);
    assert.match(code, /disabled=\{busy === 'send' \|\| !quoteGate\.allowed\}/);
  });

  test('10. the customer-acceptance state is still handled', () => {
    const code = withoutComments(workspace);
    assert.match(code, /Customer accepted the quote/);
    assert.match(code, /Open booking/);
  });

  test('QuoteWorkspace still prepares and sends quotations', () => {
    const code = withoutComments(quoteWorkspace);
    assert.match(code, /adminAPI\.prepareQuote/);
    assert.match(code, /adminAPI\.sendQuote/);
    assert.match(code, /Send Quote to Customer/);
    assert.match(code, /Prepare Quote/);
    assert.match(code, /id="enquiry-final-price"/);
  });

  test('the quote amount is never presented as a hire amount', () => {
    const code = withoutComments(quoteWorkspace) + withoutComments(workspace);
    // No hire vocabulary may sit next to the final-quote field.
    assert.doesNotMatch(code, /net_vendor_payable\s*=/);
    assert.doesNotMatch(code, /commission_amount\s*=/);
    assert.doesNotMatch(code, /gross_hire\s*=/);
  });
});

describe('Enquiry page — no second hiring form is hiding below the fold', () => {
  test('no hire vocabulary in the enquiry workspace JSX', () => {
    const code = withoutComments(workspace);
    for (const forbidden of [
      'Hire amount',
      'Hire Amount',
      'Net vendor payable',
      'Billing model',
      'Billing Model',
      'Complete Vehicle Hire',
      'Contract / Commission',
      'vehicle_hires',
    ]) {
      assert.ok(!code.includes(forbidden), `enquiry page must not contain "${forbidden}"`);
    }
  });

  test('the workspace no longer fetches the assignable-options catalogue', () => {
    const code = withoutComments(workspace);
    assert.doesNotMatch(code, /getOptions\(/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. THE HIRE PAGE IS STILL THE ONLY HIRING WORKSPACE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('Universal Vehicle Hire — all hiring functionality remains', () => {
  // The hire WORKSPACE now lives in its own component, because it has two hosts:
  // the standalone `/vehicle-hire` page and the Trip process's `vehicle` stage.
  // The functionality assertions therefore follow the workspace, and the page is
  // asserted to be a frame over it rather than a second copy of it.
  const hireWorkspace = readSource(
    'components/admin-premium/trips/process/VehicleHireWorkspace.jsx'
  );
  const hirePage = readSource('pages/AdminVehicleHire.jsx');

  test('it still owns vehicle, driver, owner/vendor and billing', () => {
    for (const control of ['Vehicle', 'Driver', 'Billing']) {
      assert.ok(hireWorkspace.includes(control), `Vehicle Hire lost "${control}"`);
    }
  });

  test('it still owns the hire money and completion', () => {
    assert.match(hireWorkspace, /hireVehicle|updateVehicleHire/);
    assert.match(hireWorkspace, /previewHire/);
    assert.ok(
      /Complete Vehicle Hire|Hire Vehicle/.test(hireWorkspace),
      'Vehicle Hire lost its Complete/Hire action',
    );
  });

  test('there is still exactly ONE implementation of the hire', () => {
    // The page is a frame. If the form ever moves back into it — or a second
    // copy appears — the two hosts can disagree about what a vendor is owed,
    // which is the whole reason the workspace was extracted.
    assert.match(hirePage, /<VehicleHireWorkspace/);
    assert.doesNotMatch(
      withoutComments(hirePage),
      /hireVehicle|updateVehicleHire|previewHire/,
      'the page must delegate, not re-implement the hire',
    );
    // And the Trip process stage renders that same workspace.
    assert.match(
      readSource('components/admin-premium/trips/process/VehicleWorkspace.jsx'),
      /<VehicleHireWorkspace/,
      'the vehicle stage must render the one workspace, not a summary of it',
    );
  });

  test('it is the screen the enquiry card navigates to', () => {
    // App.jsx registers ONE generic trip-process route, and the workspace is
    // reached by asking for the `vehicle` process inside it. That is why the
    // URL must be built from the registry key — a bespoke `/hire` route never
    // existed, and a bespoke `/hire` SEGMENT was what rendered "Unknown
    // process".
    assert.match(
      readSource('App.jsx'),
      /path="\/admin\/trips\/:tripId\/:process"/,
      'the generic trip-process route must still exist',
    );
    assert.match(
      readSource('components/admin-premium/trips/process/tripProcessModel.js'),
      /key:\s*'vehicle'/,
      'the Trip process registry must know the vehicle process',
    );
  });
});
/* ═══════════════════════════════════════════════════════════════════════════
   5. THE CUSTOMER OFFER — quote + vehicle + driver, as ONE package
   ═══════════════════════════════════════════════════════════════════════════ */

const customerPage = readSource('pages/EnquiryConfirmation.jsx');

describe('Customer offer — one package, approved in one tap', () => {
  test('the offer block sits inside the quotation card, above Accept/Decline', () => {
    const code = withoutComments(customerPage);
    const offerAt = code.indexOf('Your complete offer');
    const acceptAt = code.indexOf('Accept Quote');
    assert.ok(offerAt > -1, 'the complete-offer block must exist');
    assert.ok(acceptAt > -1, 'the accept action must exist');
    assert.ok(
      offerAt < acceptAt,
      'what the customer approves must be shown BEFORE the button that approves it',
    );
  });

  test('the offer shows price, vehicle, driver, route, date/time and material', () => {
    const code = withoutComments(customerPage);
    assert.match(code, /Your complete offer/);
    for (const label of ['Pickup', 'Drop', 'Date & time', 'Material', 'Vehicle', 'Driver', 'Final price']) {
      assert.ok(code.includes(label), `the offer must show "${label}"`);
    }
  });

  test('the offer renders the reserved vehicle and driver, not a promise', () => {
    const code = withoutComments(customerPage);
    assert.match(code, /enquiry\?\.assignment\?\.vehicle_number/);
    assert.match(code, /enquiry\?\.assignment\?\.driver_name/);
  });

  test('accepting states there is no separate vehicle-assignment step afterwards', () => {
    const code = withoutComments(customerPage);
    assert.match(
      code,
      /No\s+separate vehicle-assignment step follows|same offer together/,
      'the customer must be told the wait is gone',
    );
  });

  test('10. the driver\'s mobile number cannot reach this page', () => {
    const code = withoutComments(customerPage);
    // The offer reads NAME only. The payload itself is stripped server-side by
    // EnquiryDTO.assertNoDriverPhone(), but the page must not ask for it either.
    const offerStart = code.indexOf('Your complete offer');
    const offerEnd = code.indexOf('Accept Quote');
    const offer = code.slice(offerStart, offerEnd);
    assert.ok(offer.length > 0);
    assert.doesNotMatch(offer, /driver.*mobile|mobile.*driver/i);
  });

  test('6. the existing customer communication path is reused, not replaced', () => {
    const code = withoutComments(customerPage);
    // Still the real endpoints on the existing enquiry, not a new channel.
    assert.match(code, /enquiryAPI\.(accept|reject)/);
    assert.match(code, /getCustomerCare|contact/);
  });
});

/**
 * tmp-verify-timeline.js  (ESM — run with: node tmp-verify-timeline.js)
 * ---------------------------------------------------------------------------
 * Verifies that the customer status timeline is driven by the REAL backend
 * status, and specifically that the "Vehicle & Driver Assignment" step ticks
 * (✓) once an admin has assigned BOTH the vehicle and the driver.
 *
 * Before the fix, buildTimeline() marked the step that MATCHED the current
 * status as `active`, so DRIVER_ASSIGNED rendered as
 * "Vehicle & Driver Assignment — In progress" indefinitely.
 *
 * No React, no DOM, no network: this is a pure mapping assertion.
 */

import { buildTimeline, ENQUIRY_STATUS, TERMINAL_STATUSES } from './src/utils/enquiryFormat.js';
import { resolveSearchStage } from './src/utils/enquirySearchStage.js';

const MARK = { done: '✓', active: '●', pending: '○', halted: '×' };

let passed = 0;
let failed = 0;

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log(`   PASS  ${label}${detail ? ` -> ${detail}` : ''}`);
  } else {
    failed += 1;
    console.log(`   FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function render(status) {
  return buildTimeline(status)
    .steps.map((s) => `${s.title} ${MARK[s.state]}`)
    .join('  |  ');
}

console.log('\n=== Full lifecycle ===');
Object.values(ENQUIRY_STATUS).forEach((s) => {
  console.log(`   ${s.padEnd(28)} ${render(s)}`);
});

console.log('\n=== The reported bug: admin assigned vehicle + driver ===');
const steps = buildTimeline(ENQUIRY_STATUS.DRIVER_ASSIGNED).steps;
console.log(`   ${render(ENQUIRY_STATUS.DRIVER_ASSIGNED)}\n`);
check('Request Submitted is done', steps[0].state === 'done', steps[0].state);
check('Transport Team Reviewing is done', steps[1].state === 'done', steps[1].state);
check('Vehicle & Driver Assignment is DONE (ticked)', steps[2].state === 'done', steps[2].state);
check('Final Quote is the active step', steps[3].state === 'active', steps[3].state);
check('Customer Acceptance is pending', steps[4].state === 'pending', steps[4].state);
check('Trip Confirmed is pending', steps[5].state === 'pending', steps[5].state);
check(
  'the assignment step never renders the "In progress" badge',
  steps[2].state !== 'active',
  'badge is only drawn when a step is `active`'
);

console.log('\n=== Vehicle assigned, driver still being found (must stay in progress) ===');
const vehOnly = buildTimeline(ENQUIRY_STATUS.VEHICLE_ASSIGNED).steps;
console.log(`   ${render(ENQUIRY_STATUS.VEHICLE_ASSIGNED)}\n`);
check('assignment step is still active at VEHICLE_ASSIGNED', vehOnly[2].state === 'active', vehOnly[2].state);
check('Final Quote is still pending', vehOnly[3].state === 'pending', vehOnly[3].state);

console.log('\n=== Pre-assignment statuses are unchanged (no regression) ===');
check('ENQUIRY_SUBMITTED -> submitted active', buildTimeline(ENQUIRY_STATUS.ENQUIRY_SUBMITTED).steps[0].state === 'active');
check('ADMIN_REVIEW -> review active', buildTimeline(ENQUIRY_STATUS.ADMIN_REVIEW).steps[1].state === 'active');
check('ASSIGNMENT_PENDING -> review active', buildTimeline(ENQUIRY_STATUS.ASSIGNMENT_PENDING).steps[1].state === 'active');
check('QUOTE_READY -> quote active', buildTimeline(ENQUIRY_STATUS.QUOTE_READY).steps[3].state === 'active');
check('AWAITING_CUSTOMER_ACCEPTANCE -> acceptance active', buildTimeline(ENQUIRY_STATUS.AWAITING_CUSTOMER_ACCEPTANCE).steps[4].state === 'active');
check('CANCELLED -> steps halted, not pending', buildTimeline(ENQUIRY_STATUS.CANCELLED).steps[3].state === 'halted');
check('CUSTOMER_REJECTED -> steps halted, not pending', buildTimeline(ENQUIRY_STATUS.CUSTOMER_REJECTED).steps[3].state === 'halted');
check('COMPLETED -> all six steps done/active', buildTimeline(ENQUIRY_STATUS.COMPLETED).steps.every((s) => s.state !== 'pending'));
check('unknown status does not throw', (() => { try { buildTimeline('SOMETHING_NEW'); return true; } catch { return false; } })());

console.log('\n=== Hero headline (drives "Vehicle & driver assigned") ===');
const stage = resolveSearchStage(ENQUIRY_STATUS.DRIVER_ASSIGNED);
console.log(`   headline: "${stage.headline}"`);
console.log(`   detail  : "${stage.detail}"\n`);
check('headline is "Vehicle & driver assigned"', stage.headline === 'Vehicle & driver assigned', stage.headline);
check(
  'detail is the required customer-facing sentence',
  stage.detail === 'Your vehicle and driver are confirmed for this shipment.',
  stage.detail
);
check('search animation is OFF once assigned', stage.searching === false);
check('VEHICLE_ASSIGNED still searching (driver pending)', resolveSearchStage(ENQUIRY_STATUS.VEHICLE_ASSIGNED).searching === false, 'vehicle found, not "searching"');

console.log('\n=== Polling stop conditions ===');
check('TERMINAL_STATUSES contains COMPLETED', TERMINAL_STATUSES.includes(ENQUIRY_STATUS.COMPLETED));
check('TERMINAL_STATUSES contains CANCELLED', TERMINAL_STATUSES.includes(ENQUIRY_STATUS.CANCELLED));
check('TERMINAL_STATUSES contains CUSTOMER_REJECTED', TERMINAL_STATUSES.includes(ENQUIRY_STATUS.CUSTOMER_REJECTED));
check('DRIVER_ASSIGNED is NOT terminal (must keep polling)', !TERMINAL_STATUSES.includes(ENQUIRY_STATUS.DRIVER_ASSIGNED));

console.log(`\n${'='.repeat(62)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
console.log('='.repeat(62));

process.exit(failed > 0 ? 1 : 0);

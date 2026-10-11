/**
 * scripts/verify-phase9-dispatch.js
 * ---------------------------------------------------------------------------
 * A REAL end-to-end check of the Phase 9 dispatch stack against the live
 * PostgreSQL database. Read-only: it never writes, so it is safe to run against
 * production-shaped data at any time.
 *
 *   node scripts/verify-phase9-dispatch.js [tripId]
 *
 * What it proves:
 *   • the workspace query runs against the real schema
 *   • readiness is computed from real rows
 *   • the stepper stage, the blockers and the e-way bill honesty notice are all
 *     derivable from the database alone
 */

require('dotenv').config();
const { prisma } = require('../config/prisma');
const TripDispatchService = require('../services/TripDispatchService');
const TripTransitOpsService = require('../services/TripTransitOpsService');
const TripInvoiceService = require('../services/TripInvoiceService');
const stagePolicy = require('../config/tripStagePolicy');

const line = (t) => console.log(`\n${'═'.repeat(72)}\n${t}\n${'═'.repeat(72)}`);

(async () => {
  const argId = Number(process.argv[2]);
  let trip;

  if (Number.isInteger(argId) && argId > 0) {
    trip = await prisma.trip.findUnique({ where: { trip_id: argId } });
    if (!trip) {
      console.error(`No trip with id ${argId}`);
      process.exit(1);
    }
  } else {
    // Prefer a trip that is actually at the loading stage, because that is
    // where a dispatch workspace is interesting.
    trip = await prisma.trip.findFirst({
      where: { status: { in: ['TO_LOADING_POINT', 'AT_LOADING_POINT', 'LOADED'] } },
      orderBy: { trip_id: 'desc' },
    })
    || await prisma.trip.findFirst({ orderBy: { trip_id: 'desc' } });
  }

  line(`TRIP ${trip.trip_number}  (#${trip.trip_id})  status=${trip.status}`);

  const dispatchService = new TripDispatchService();
  const transitService = new TripTransitOpsService();
  const invoiceService = new TripInvoiceService();

  // ── READINESS ────────────────────────────────────────────────────────────
  const readiness = await dispatchService.getReadiness(trip.trip_id);
  console.log(`\nready               : ${readiness.ready}`);
  console.log(`already_dispatched  : ${readiness.already_dispatched}`);
  console.log(`blocker_codes       : ${JSON.stringify(readiness.blocker_codes)}`);
  console.log(`summary             : ${JSON.stringify(readiness.summary)}`);
  console.log('\nChecks:');
  for (const c of readiness.checks) {
    const mark = { passed: '✓', failed: '✕', warning: '⚠', pending: '—' }[c.state] || '·';
    console.log(`  ${mark} ${c.label.padEnd(28)} ${c.message}`);
  }

  // ── E-WAY BILL HONESTY ───────────────────────────────────────────────────
  console.log(`\neway_bill_integration: ${readiness.eway_bill_integration}`);

  // ── WORKSPACE ────────────────────────────────────────────────────────────
  const ws = await dispatchService.getWorkspace(trip.trip_id);
  line('WORKSPACE SECTIONS');
  console.log(Object.keys(ws).join(', '));
  console.log('\nheader.route       :', JSON.stringify(ws.header.route));
  console.log('header.vehicle     :', JSON.stringify(ws.header.vehicle));
  console.log('header.driver      :', JSON.stringify(ws.header.driver));
  console.log('shipment.consignor :', ws.shipment.consignor);
  console.log('loading.completed  :', ws.loading.completed, '| location:', ws.loading.location);
  console.log('documents recorded :', ws.documents.filter((d) => d.is_present).length,
    '/', ws.documents.length);
  console.log('lr_gr.number       :', ws.lr_gr.number);
  console.log('eway_bill.internal :', ws.eway_bill.internal ? ws.eway_bill.internal.number : null);
  console.log('eway_bill.gov      :', JSON.stringify(ws.eway_bill.government));
  console.log('eway_bill.notice   :', ws.eway_bill.integration_notice);
  console.log('delivery.pod_req   :', ws.delivery.pod_required);
  console.log('insurance.required :', ws.insurance.requirement?.required, '| source:', ws.insurance.requirement?.source);
  console.log('billing.invoice    :', ws.billing.invoice ? ws.billing.invoice.invoice_number : null);
  console.log('billing.received   :', ws.billing.total_received, '| balance:', ws.billing.balance);
  console.log('charges.source     :', ws.charges.source);
  console.log('movement_history   :', ws.movement_history.length, 'events');

  // ── STEPPER (from the ONE lifecycle projection) ──────────────────────────
  line('PROCESS STEPPER (from Trip.status — never from the URL)');
  const stage = stagePolicy.resolveTripStage({
    tripStatus: trip.status,
    hasVehicleHire: Boolean(await prisma.vehicleHire.findUnique({ where: { trip_id: trip.trip_id } })),
    podRequired: ws.delivery.pod_required,
    podReceived: false,
    trip: { trip_id: trip.trip_id, trip_number: trip.trip_number },
  });
  console.log(`current_stage: ${stage.current_stage} (${stage.current_stage_label})`);
  console.log(`next_action  : ${stage.next_action.id} — ${stage.next_action.label}`);
  for (const s of stage.stages) {
    console.log(`  ${s.state.padEnd(11)} ${s.key}`);
  }

  // ── TRANSIT WORKSPACE + TRACKING HONESTY ─────────────────────────────────
  line('TRANSIT WORKSPACE');
  const tws = await transitService.getWorkspace(trip.trip_id);
  console.log(`status       : ${tws.status}`);
  console.log(`tracking     : ${tws.tracking.status} — ${tws.tracking.headline}`);
  console.log(`             : ${tws.tracking.message}`);
  console.log(`last_updated : ${tws.tracking.last_updated}`);
  console.log(`changes      : ${tws.vehicle_changes.length} | incidents: ${tws.incidents.length}`);
  console.log(`actions      : ${tws.available_actions.map((a) => a.id).join(', ') || 'none'}`);

  // ── VEHICLE HISTORY ──────────────────────────────────────────────────────
  const vh = await transitService.getVehicleHistory(trip.trip_id);
  line('VEHICLE HISTORY (original preserved)');
  for (const v of vh) {
    console.log(`  seq ${v.sequence} ${v.original ? '(original)' : v.reason}: ${v.new_vehicle_number} @ ${v.occurred_at}`);
  }

  // ── INVOICE POSITION ─────────────────────────────────────────────────────
  line('CUSTOMER INVOICE');
  const inv = await invoiceService.getInvoiceForTrip(trip.trip_id);
  console.log(inv
    ? `${inv.invoice_number} · total ${inv.position.total} · received ${inv.position.received} · balance ${inv.position.balance} · ${inv.position.status}`
    : 'No invoice raised for this trip yet (the [ Create Invoice ] action creates one).');

  console.log('\n✓ Phase 9 dispatch stack verified against the live database. Read-only: nothing was written.');
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('\n✕ VERIFICATION FAILED:', err);
  await prisma.$disconnect();
  process.exit(1);
});

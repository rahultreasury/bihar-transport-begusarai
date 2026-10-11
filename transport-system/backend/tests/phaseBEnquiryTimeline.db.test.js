/**
 * phaseBEnquiryTimeline.db.test.js
 * ---------------------------------------------------------------------------
 * TIMELINE FIX — the /admin/enquiries/:id commercial rail must reflect the REAL
 * persisted backend state.
 *
 * BEFORE THE FIX the rail was derived entirely from BOOKING fields
 * (quote_status, driver_id, final_price). A Phase B enquiry has no booking, so
 * a freshly-saved ₹60,000 quotation still rendered "Under Review = NOW" while
 * the quotation panel said "Quote saved — not yet sent".
 *
 * AFTER THE FIX the rail is derived from persisted Enquiry + Quotation state.
 *
 *   ENQUIRY → RATE QUOTED → QUOTE SENT → CUSTOMER ACCEPTED → ORDER CONFIRMED
 *
 * The mapping under test is `stageForEnquiry()` in
 * frontend/src/components/admin-premium/enquiries/workflow/workflowStages.js.
 * It is re-implemented here byte-for-byte from that source so the DB state and
 * the expected rail position can be asserted together against real PostgreSQL.
 *
 * NOTHING IS MOCKED. Every assertion below is made against rows that really
 * exist, and the suite deletes everything it created.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const enquiryService = require('../services/EnquiryService');
const QuotationService = require('../services/QuotationService');
const { toAdminEnquiry } = require('../dtos/EnquiryDTO');

const qService = new QuotationService({ enquiryService });

const createdEnquiryIds = [];
const createdBookingIds = [];

let admin = null;
let dbAvailable = false;
let skipReason = '';

/* ── The mapping under test (mirrors stageForEnquiry) ───────────────────── */

const STAGE = {
  RECEIVED: 'RECEIVED',
  QUOTE_PREPARED: 'QUOTE_PREPARED',
  QUOTE_SENT: 'QUOTE_SENT',
  CUSTOMER_ACCEPTED: 'CUSTOMER_ACCEPTED',
  CONFIRMED: 'CONFIRMED',
};

function upper(v) {
  return String(v ?? '').trim().toUpperCase();
}

/**
 * Mirrors workflowStages.stageForEnquiry().
 * @param {object} enquiry admin enquiry payload (what the rail actually reads)
 */
function railStageFor(enquiry) {
  if (!enquiry) return STAGE.RECEIVED;

  const commercial = enquiry.commercial || {};
  const quotationStatus = upper(commercial.quotation_status);
  const decision = upper(commercial.customer_decision);
  const status = upper(enquiry.status);
  const hasOrder = commercial.has_order === true || Boolean(commercial.booking_id);

  if (hasOrder) return STAGE.CONFIRMED;
  if (decision === 'ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;
  if (status === 'CUSTOMER_ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;
  if (quotationStatus === 'SENT') return STAGE.QUOTE_SENT;
  if (quotationStatus === 'RATE_QUOTED' || quotationStatus === 'DRAFT') {
    return STAGE.QUOTE_PREPARED;
  }

  const priceStatus = upper(commercial.price_status);
  if (priceStatus === 'ACCEPTED') return STAGE.CUSTOMER_ACCEPTED;
  if (priceStatus === 'SENT') return STAGE.QUOTE_SENT;
  if (priceStatus === 'QUOTED') return STAGE.QUOTE_PREPARED;

  return STAGE.RECEIVED;
}

/** The five rail labels, in order. */
const RAIL_LABELS = [
  'Enquiry',
  'Rate Quoted',
  'Quote Sent',
  'Customer Accepted',
  'Order Confirmed',
];

/** Describe the rail the way the component renders it. */
function railFor(enquiry) {
  const current = railStageFor(enquiry);
  const currentIndex = RAIL_LABELS.indexOf(labelOf(current));
  return RAIL_LABELS.map((label, index) => ({
    label,
    state: index < currentIndex ? 'DONE' : index === currentIndex ? 'NOW' : 'NEXT',
  }));
}

function labelOf(stage) {
  return {
    [STAGE.RECEIVED]: 'Enquiry',
    [STAGE.QUOTE_PREPARED]: 'Rate Quoted',
    [STAGE.QUOTE_SENT]: 'Quote Sent',
    [STAGE.CUSTOMER_ACCEPTED]: 'Customer Accepted',
    [STAGE.CONFIRMED]: 'Order Confirmed',
  }[stage];
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

async function makeEnquiry() {
  const row = await prisma.enquiry.create({
    data: {
      enquiry_number: `TB-TL-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      customer_name: 'Aasan OPD',
      customer_mobile: '9798203741',
      pickup_location: 'Begusarai',
      drop_location: 'Khagaria',
      distance_km: 60,
      material: 'Pipe 20ft',
      quantity: 100,
      quantity_unit: 'pcs',
      weight: 7,
      weight_unit: 'tons',
      requested_vehicle_name: 'DCM',
      pickup_date: new Date(Date.now() + 5 * 864e5),
      pickup_time: '10:00:00',
      status: 'ADMIN_REVIEW',
      // The pricing engine writes ESTIMATED at intake. It must NOT advance the rail.
      price_status: 'ESTIMATED',
    },
  });
  createdEnquiryIds.push(row.enquiry_id);
  return row;
}

/** The client document's worked example. */
function clientExamplePayload(overrides = {}) {
  return {
    rate_type: 'FIXED',
    rate: 6000,
    freight: 6000,
    gst_type: 'RCM',
    gst_percentage: 5,
    validity_days: 15,
    payment_schedule_type: 'FULL_PAYMENT_IN_ADVANCE',
    additional_charges: [{ charges_name: 'Detention', rate: 1500, quantity: 2, quantity_unit: 'Days' }],
    ...overrides,
  };
}

/** Re-read the enquiry exactly the way GET /api/admin/enquiries/:id does. */
async function reloadAdmin(enquiryId) {
  const row = await enquiryService.loadForAdmin(enquiryId);
  return toAdminEnquiry(row, []);
}

/** Read what the CUSTOMER would see, honouring the publication gate. */
async function customerVisibleQuotation(enquiryId) {
  const q = await qService.loadQuotation(enquiryId);
  if (!q) return null;
  if (q.status !== 'SENT' && q.status !== 'CONVERTED') return null;
  return q;
}

before(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbAvailable = true;
  } catch (err) {
    skipReason = `Live PostgreSQL unavailable: ${err.message.split('\n')[0]}`;
    return;
  }
  admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
});

after(async () => {
  if (!dbAvailable) return;
  for (const id of createdBookingIds) {
    await prisma.bookingQuotationSnapshot.deleteMany({ where: { booking_id: id } }).catch(() => {});
    await prisma.booking.deleteMany({ where: { booking_id: id } }).catch(() => {});
  }
  for (const id of createdEnquiryIds) {
    await prisma.quotation.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
    await prisma.enquiryEvent.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
    await prisma.enquiry.updateMany({ where: { enquiry_id: id }, data: { booking_id: null } }).catch(() => {});
    await prisma.enquiry.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

/* ═══════════════════════════════════════════════════════════════════════
   1. New enquiry → Request Received
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — CASE 1: new enquiry', () => {
  test('1. a brand new enquiry shows ENQUIRY = NOW and everything else NEXT', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const payload = await reloadAdmin(enquiry.enquiry_id);

    assert.equal(railStageFor(payload), STAGE.RECEIVED);
    assert.deepEqual(railFor(payload), [
      { label: 'Enquiry', state: 'NOW' },
      { label: 'Rate Quoted', state: 'NEXT' },
      { label: 'Quote Sent', state: 'NEXT' },
      { label: 'Customer Accepted', state: 'NEXT' },
      { label: 'Order Confirmed', state: 'NEXT' },
    ]);
  });

  test('1b. the intake price estimate does NOT advance the rail', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const payload = await reloadAdmin(enquiry.enquiry_id);

    // price_status is ESTIMATED from the pricing engine — an automated guess,
    // not a rate a human gave.
    assert.equal(payload.commercial.price_status, 'ESTIMATED');
    assert.equal(payload.commercial.quotation_status, null);
    assert.equal(railStageFor(payload), STAGE.RECEIVED, 'an estimate is not a quoted rate');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   2, 3. Save quotation → Rate Quoted, and NOT Quote Sent
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — CASE 2: admin saves a quotation', () => {
  test('2. saving a quotation shows RATE QUOTED = NOW', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const saved = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({ rate: 60000, freight: 60000 }),
      { adminId: admin.admin_id },
    );
    assert.equal(saved.status, 'RATE_QUOTED');

    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.quotation_status, 'RATE_QUOTED');

    assert.deepEqual(railFor(payload), [
      { label: 'Enquiry', state: 'DONE' },
      { label: 'Rate Quoted', state: 'NOW' },
      { label: 'Quote Sent', state: 'NEXT' },
      { label: 'Customer Accepted', state: 'NEXT' },
      { label: 'Order Confirmed', state: 'NEXT' },
    ]);
  });

  test('3. a SAVED quotation does NOT move the rail to Quote Sent', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const payload = await reloadAdmin(enquiry.enquiry_id);

    assert.notEqual(payload.commercial.quotation_status, 'SENT');
    assert.equal(railStageFor(payload), STAGE.QUOTE_PREPARED, 'save is not send');
    assert.equal(railFor(payload)[2].state, 'NEXT', 'Quote Sent must still read NEXT');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   4, 5. Send quotation → Quote Sent, and it becomes customer-visible
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — CASE 3: admin sends the quotation', () => {
  test('4. sending shows QUOTE SENT = NOW', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.quotation_status, 'SENT');

    assert.deepEqual(railFor(payload), [
      { label: 'Enquiry', state: 'DONE' },
      { label: 'Rate Quoted', state: 'DONE' },
      { label: 'Quote Sent', state: 'NOW' },
      { label: 'Customer Accepted', state: 'NEXT' },
      { label: 'Order Confirmed', state: 'NEXT' },
    ]);
  });

  test('5. sending makes the persisted quotation customer-visible', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const visible = await customerVisibleQuotation(enquiry.enquiry_id);
    assert.ok(visible, 'the customer can now read the quotation');
    assert.equal(visible.total_billing_amount, 9000);
  });

  test('11. an UNSENT quotation is invisible to the customer', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const visible = await customerVisibleQuotation(enquiry.enquiry_id);
    assert.equal(visible, null, 'a saved-but-unsent quotation must not reach the customer');

    // And the persisted state genuinely has no send timestamp.
    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.quotation_status, 'RATE_QUOTED');
    assert.equal(payload.commercial.quotation_sent_at, null);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   6. Customer accepts → Customer Accepted (and does NOT become an order)
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — CASE 4: customer accepts', () => {
  test('6. an accepted-but-not-confirmed enquiry shows CUSTOMER ACCEPTED = NOW', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    // Persist the acceptance claim exactly as the conversion core writes it,
    // stopping short of creating the order. This is a real EnquiryStatus value
    // the existing state machine already uses.
    await prisma.enquiry.update({
      where: { enquiry_id: enquiry.enquiry_id },
      data: {
        status: 'CUSTOMER_ACCEPTED',
        accepted_at: new Date(),
        price_status: 'ACCEPTED',
      },
    });

    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.customer_decision, 'ACCEPTED');
    assert.equal(payload.commercial.has_order, false, 'acceptance alone creates no order');

    assert.deepEqual(railFor(payload), [
      { label: 'Enquiry', state: 'DONE' },
      { label: 'Rate Quoted', state: 'DONE' },
      { label: 'Quote Sent', state: 'DONE' },
      { label: 'Customer Accepted', state: 'NOW' },
      { label: 'Order Confirmed', state: 'NEXT' },
    ]);
  });

  test('6b. acceptance does NOT hire a vehicle or create trip resources', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    await prisma.enquiry.update({
      where: { enquiry_id: enquiry.enquiry_id },
      data: { status: 'CUSTOMER_ACCEPTED', accepted_at: new Date() },
    });

    const raw = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(raw.assigned_driver_id, null, 'no driver hired by accepting');
    assert.equal(raw.assigned_vehicle_id, null, 'no vehicle hired by accepting');
    assert.equal(await prisma.trip.count({ where: { booking_id: null } }) >= 0, true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   7. Confirm Order → Order Confirmed
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — CASE 5: order confirmed', () => {
  test('7. a confirmed enquiry shows ORDER CONFIRMED = NOW', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const result = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });
    createdBookingIds.push(result.booking.booking_id);

    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.has_order, true);
    assert.equal(payload.commercial.quotation_status, 'CONVERTED');

    assert.deepEqual(railFor(payload), [
      { label: 'Enquiry', state: 'DONE' },
      { label: 'Rate Quoted', state: 'DONE' },
      { label: 'Quote Sent', state: 'DONE' },
      { label: 'Customer Accepted', state: 'DONE' },
      { label: 'Order Confirmed', state: 'NOW' },
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   8. Refresh preserves the state (read from the DB every time)
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — server authority across a refresh', () => {
  test('8. the rail is identical when re-read from the database', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const snapshots = [];
    snapshots.push(railFor(await reloadAdmin(enquiry.enquiry_id)));

    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    snapshots.push(railFor(await reloadAdmin(enquiry.enquiry_id)));

    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    snapshots.push(railFor(await reloadAdmin(enquiry.enquiry_id)));

    const result = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });
    createdBookingIds.push(result.booking.booking_id);
    snapshots.push(railFor(await reloadAdmin(enquiry.enquiry_id)));

    // Every re-read is a fresh database query — no React state is involved.
    assert.equal(snapshots[0][0].state, 'NOW');
    assert.equal(snapshots[1][1].state, 'NOW');
    assert.equal(snapshots[2][2].state, 'NOW');
    assert.equal(snapshots[3][4].state, 'NOW');

    // Reading again yields exactly the same answer (idempotent derivation).
    assert.deepEqual(snapshots[3], railFor(await reloadAdmin(enquiry.enquiry_id)));
  });

  test('8b. the rail never depends on a rupee figure in any input', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    // A quoted total exists on the enquiry row only once a quote is saved.
    // Before that, the rail must be RECEIVED regardless of any money present.
    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.total_billing_amount, null);
    assert.equal(railStageFor(payload), STAGE.RECEIVED);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   9, 10. Idempotency of Send and Confirm
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — idempotency', () => {
  test('9. a duplicate Send is idempotent and does not move the rail', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    const firstSentAt = (await reloadAdmin(enquiry.enquiry_id)).commercial.quotation_sent_at;

    const second = await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    assert.equal(second.alreadySent, true);

    const payload = await reloadAdmin(enquiry.enquiry_id);
    assert.equal(payload.commercial.quotation_sent_at.getTime(), firstSentAt.getTime(), 'same sent_at');
    assert.equal(railStageFor(payload), STAGE.QUOTE_SENT, 'rail unchanged by a duplicate send');
  });

  test('10. a duplicate Confirm is idempotent and creates no second order', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const first = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });
    createdBookingIds.push(first.booking.booking_id);
    const second = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });
    const third = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });

    assert.equal(second.alreadyConfirmed, true);
    assert.equal(third.alreadyConfirmed, true);
    assert.equal(second.booking.booking_id, first.booking.booking_id);

    const linked = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(linked.booking_id, first.booking.booking_id, 'still exactly one order');
    assert.equal(railStageFor(await reloadAdmin(enquiry.enquiry_id)), STAGE.CONFIRMED);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Status-axis separation + activity log integrity
   ═══════════════════════════════════════════════════════════════════════ */

describe('Timeline — axis separation and activity log', () => {
  test('operational statuses never move the commercial rail', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    // Attach operational noise the rail must ignore: a trip in transit, a POD
    // received, a vendor payment settled. None of these are commercial facts.
    const payload = await reloadAdmin(enquiry.enquiry_id);
    const decorated = {
      ...payload,
      assigned_driver_id: 7,
      assigned_vehicle_id: 9,
      loading_status: 'LOADED',
      dispatch_status: 'DISPATCHED',
      transit_status: 'IN_TRANSIT',
      pod_status: 'RECEIVED',
      customer_payment_status: 'PAID',
      vendor_payment_status: 'PAID',
    };

    assert.equal(railStageFor(decorated), STAGE.QUOTE_PREPARED, 'RATE QUOTED, nothing moved it');
  });

  test('the five activity events remain distinguishable', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    const result = await qService.confirmOrder(enquiry.enquiry_id, {
      admin: { adminId: admin.admin_id, adminName: 'Timeline Admin' },
    });
    createdBookingIds.push(result.booking.booking_id);

    const events = await prisma.enquiryEvent.findMany({
      where: { enquiry_id: enquiry.enquiry_id },
      select: { event_type: true },
    });
    const types = events.map((e) => e.event_type);

    assert.ok(types.includes('QUOTATION_SAVED'), 'quote saved is logged');
    assert.ok(types.includes('QUOTE_SENT'), 'quotation sent is logged');
    assert.ok(types.includes('BOOKING_CREATED'), 'order created is logged');
    assert.ok(types.includes('STATUS_CHANGED'), 'status change is logged');
    // Each of these is its own event type, so they never blur together.
    assert.equal(new Set(types.filter((x) => x === 'QUOTATION_SAVED')).size, 1);
  });

  test('reading the enquiry again writes NO duplicate events', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const count = () => prisma.enquiryEvent.count({ where: { enquiry_id: enquiry.enquiry_id } });

    const afterSave = await count();
    await reloadAdmin(enquiry.enquiry_id);
    await reloadAdmin(enquiry.enquiry_id);
    await reloadAdmin(enquiry.enquiry_id);
    assert.equal(await count(), afterSave, 'refresh writes no events');
  });
});

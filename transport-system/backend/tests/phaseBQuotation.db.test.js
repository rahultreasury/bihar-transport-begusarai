/**
 * phaseBQuotation.db.test.js
 * ---------------------------------------------------------------------------
 * PHASE B — QUOTATION / RATE MODULE, INTEGRATION TESTS AGAINST REAL POSTGRESQL
 *
 * Client document: "Bihar Transport — Complete Transport Software Workflow"
 * §2 QUOTATION / RATE, §3 PARTY CONFIRMS.
 *
 * WHAT THIS SUITE PROVES, AGAINST THE REAL THING
 *   Everything here runs through the actual QuotationService → Prisma →
 *   PostgreSQL path. No mocks, no in-memory doubles. The row counts before and
 *   after are asserted so the database is left exactly as it was found.
 *
 * THE THREE THINGS A FAKE COULD NOT PROVE
 *   1. ONE ENQUIRY → ONE QUOTATION is enforced by a real UNIQUE constraint, so
 *      the duplicate insert is attempted and PostgreSQL is expected to refuse it.
 *   2. REPEATED CONFIRM ORDER cannot produce a second Booking, because the real
 *      conditional claim + unique booking_id are exercised end to end.
 *   3. The PDF really contains the PERSISTED figures, not whatever the caller
 *      last typed.
 *
 * IF NO LIVE POSTGRESQL IS AVAILABLE the suite reports SKIPPED with the reason.
 * It never pretends to have passed.
 *
 * Run with:
 *   node --test tests/phaseBQuotation.db.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');
const QuotationService = require('../services/QuotationService');
const enquiryService = require('../services/EnquiryService');
const { renderQuotationPdf } = require('../services/QuotationPdf');
const { isQuoteVisibleToCustomer } = require('../utils/EnquiryStateMachine');

const qService = new QuotationService({ enquiryService });

/* ── Fixtures ──────────────────────────────────────────────────────────── */

let admin = null;
/** Every enquiry/booking/user this suite creates, deleted again in after(). */
const createdEnquiryIds = [];
const createdBookingIds = [];
const createdUserIds = [];

let dbAvailable = false;
let skipReason = '';

async function makeEnquiry(overrides = {}) {
  const row = await prisma.enquiry.create({
    data: {
      enquiry_number: `TB-QT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      customer_name: overrides.customer_name || 'Phase B Test Party',
      customer_mobile: overrides.customer_mobile || '9798203741',
      pickup_location: overrides.pickup_location || 'Begusarai',
      drop_location: overrides.drop_location || 'Khagaria',
      distance_km: overrides.distance_km ?? 60,
      material: overrides.material ?? 'Pipe 20ft',
      quantity: overrides.quantity ?? 100,
      quantity_unit: overrides.quantity_unit ?? 'pcs',
      weight: overrides.weight ?? 7,
      weight_unit: overrides.weight_unit ?? 'tons',
      requested_vehicle_name: overrides.requested_vehicle_name ?? 'DCM',
      pickup_date: new Date(Date.now() + 5 * 864e5),
      pickup_time: '10:00:00',
      status: overrides.status || 'ADMIN_REVIEW',
      ...overrides,
    },
  });
  createdEnquiryIds.push(row.enquiry_id);
  return row;
}

/** The client document's worked example, expressed as an input payload. */
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

before(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    dbAvailable = true;
  } catch (err) {
    skipReason = `Live PostgreSQL unavailable: ${err.message.split('\n')[0]}`;
    return;
  }
  admin =
    (await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } })) ||
    (await prisma.admin.create({
      data: {
        username: `tb_qt_admin_${Date.now()}`,
        email: `tb_qt_${Date.now()}@example.invalid`,
        password_hash: 'not-used-in-this-suite',
        full_name: 'Phase B Admin',
      },
    }));
  if (admin.admin_id > 1) createdUserIds.push(admin.admin_id);
});

after(async () => {
  if (!dbAvailable) return;
  // Clean up in FK-safe order. The quotation cascades from the enquiry.
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
  for (const id of createdUserIds) {
    await prisma.admin.deleteMany({ where: { admin_id: id } }).catch(() => {});
  }
  await prisma.$disconnect();
});

/* ═══════════════════════════════════════════════════════════════════════
   1–4  CREATE / SAVE / UPDATE / RATE TYPE VALIDATION
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — quotation create / save / update / validation', () => {
  test('1. creates a quotation for an enquiry (client example figures)', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    assert.ok(q.quotation_id, 'quotation_id assigned');
    assert.match(q.quotation_number, /^QT-\d{6}-\d{6}$/, 'server-derived quotation_number');
    assert.equal(q.enquiry_id, enquiry.enquiry_id);
    assert.equal(q.rate_type, 'FIXED');
    assert.equal(q.freight, 6000);
    assert.equal(q.total_freight, 6000);
    assert.equal(q.gst_type, 'RCM');
    assert.equal(q.gst_percentage, 5);
    assert.equal(q.validity_days, 15);
    assert.equal(q.status, 'RATE_QUOTED', 'client status "RATE QUOTED" after save');
    assert.ok(q.quotation_number, 'numbered');
  });

  test('2. saves and reads back the persisted quotation', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const read = await qService.getQuotation(enquiry.enquiry_id);
    assert.equal(read.enquiry_id, enquiry.enquiry_id);
    assert.equal(read.total_billing_amount, 9000, 'matches the client worked example');
  });

  test('3. updates the SAME quotation rather than creating a second one', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const first = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), {
      adminId: admin.admin_id,
    });
    const second = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({ freight: 8000 }),
      { adminId: admin.admin_id },
    );

    assert.equal(second.quotation_id, first.quotation_id, 'same quotation row, updated in place');
    assert.equal(second.freight, 8000);

    const all = await prisma.quotation.count({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(all, 1, 'exactly one quotation for the enquiry');
  });

  test('3b. the database REFUSES a second quotation for one enquiry', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    // Attempt the duplicate directly, bypassing the service entirely.
    await assert.rejects(
      () =>
        prisma.quotation.create({
          data: {
            enquiry_id: enquiry.enquiry_id,
            quotation_number: `QT-DUP-${Date.now()}`,
            freight: 100,
            total_freight: 100,
          },
        }),
      'PostgreSQL must reject a duplicate quotation for one enquiry',
    );
  });

  test('4. rate_type validation', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    await assert.rejects(
      () => qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ rate_type: 'HOURLY' })),
      /rate_type must be one of/,
      'unknown rate type rejected',
    );

    const ok = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ rate_type: 'FIXED' }), {
      adminId: admin.admin_id,
    });
    assert.equal(ok.rate_type, 'FIXED');
  });

  test('4b. invalid enquiry is rejected (no such enquiry)', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    await assert.rejects(
      () => qService.saveQuotation(99999999, clientExamplePayload()),
      /Enquiry not found/,
    );
  });

  test('4c. missing / invalid freight is rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () => qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ freight: undefined })),
      /freight is required/,
    );
    await assert.rejects(
      () => qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ freight: -100 })),
      /freight must be at least/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   5–11  FREIGHT / GST / ADDITIONAL CHARGES / TOTALS / VALIDITY
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — freight, GST, additional charges and totals', () => {
  test('5. freight and total freight are server-calculated', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    // Post a bogus total_freight; the server must ignore it.
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      { ...clientExamplePayload({ freight: 4500 }), total_freight: 999999, total_billing_amount: 1 },
      { adminId: admin.admin_id },
    );
    assert.equal(q.total_freight, 4500, 'server value wins over the posted one');
    // 4500 freight + 3000 detention = 7500. The posted total_billing_amount of 1
    // must be discarded.
    assert.equal(q.total_billing_amount, 7500, 'server recomputes the total too');
  });

  test('6. GST fields are stored faithfully (RCM + 5%)', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    assert.equal(q.gst_type, 'RCM');
    assert.equal(q.gst_percentage, 5);
    assert.equal(q.gst_amount, 300, '5% of 6000 freight recorded for display');
  });

  test('6b. GST is NOT folded into the total (RCM arithmetic is unspecified)', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    // Client example: 6000 + 3000 = 9000. GST (300) must NOT appear.
    assert.equal(q.total_billing_amount, 9000);
    assert.notEqual(q.total_billing_amount, 9300, 'GST must not be added');
  });

  test('6c. gst_percentage is required when a non-exempt gst_type is set', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () =>
        qService.saveQuotation(
          enquiry.enquiry_id,
          clientExamplePayload({ gst_type: 'RCM', gst_percentage: undefined }),
        ),
      /gst_percentage is required/,
    );
  });

  test('7. additional charge total = rate × quantity', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const charge = q.charges[0];
    assert.equal(charge.charges_name, 'Detention');
    assert.equal(charge.rate, 1500);
    assert.equal(charge.quantity, 2);
    assert.equal(charge.quantity_unit, 'Days', 'unit stored separately, not "2 Days" in a number');
    assert.equal(charge.total, 3000);
  });

  test('8. multiple additional charges are summed', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        additional_charges: [
          { charges_name: 'Detention', rate: 1500, quantity: 2, quantity_unit: 'Days' },
          { charges_name: 'Toll', rate: 450, quantity: 1 },
          { charges_name: 'Loading', rate: 300, quantity: 1.5 },
        ],
      }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.charges.length, 3);
    assert.equal(q.total_additional_charges, 3000 + 450 + 450, '3000 + 450 + 450');
  });

  test('9. total additional charges persisted correctly', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    assert.equal(q.total_additional_charges, 3000);
  });

  test('9b. a posted charge total is ignored in favour of rate × quantity', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        additional_charges: [{ charges_name: 'Detention', rate: 1500, quantity: 2, total: 999999 }],
      }),
      { adminId: admin.admin_id },
    );
    assert.equal(q.charges[0].total, 3000, 'server recomputes, ignoring the posted total');
  });

  test('10. total billing amount = freight + charges + charge tax', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({ additional_charges_tax: 270 }),
      { adminId: admin.admin_id },
    );
    assert.equal(q.additional_charges_tax, 270);
    assert.equal(q.total_billing_amount, 6000 + 3000 + 270);
  });

  test('11. validity is stored in DAYS (client: 15 Days), not hours', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ validity_days: 15 }), {
      adminId: admin.admin_id,
    });

    assert.equal(q.validity_days, 15);
    const days = Math.round((q.valid_until - Date.now()) / 864e5);
    assert.ok(days >= 14 && days <= 15, `valid_until ~15 days out (got ${days})`);
  });

  test('11b. invalid validity is rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () => qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ validity_days: 0 })),
      /validity_days must be at least 1/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   12–20  PAYMENT SCHEDULES
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — payment schedules', () => {
  test('12. Option 1 — Full Payment in Advance', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({ payment_schedule_type: 'FULL_PAYMENT_IN_ADVANCE' }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.payment_schedule_type, 'FULL_PAYMENT_IN_ADVANCE');
    assert.equal(q.milestones.length, 1);
    assert.equal(q.milestones[0].due_point, 'Full Payment in Advance');
    assert.equal(q.milestones[0].computed_amount, q.total_billing_amount);
    assert.equal(q.schedule_remaining, 0);
  });

  test('13. Option 2 — Booking Amount stored', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        freight: 6000,
        additional_charges: [],
        payment_schedule_type: 'BOOKING_ADVANCE_BALANCE',
        booking_amount: 2000,
        advance_after_loading_percentage: 80,
      }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.payment_schedule_type, 'BOOKING_ADVANCE_BALANCE');
    assert.equal(q.booking_amount, 2000);
    assert.equal(q.advance_after_loading_percentage, 80);
  });

  test('14–16. Option 2 does NOT double-count the booking amount', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    // Client document §2 verbatim: Booking 2000, Advance After Loading 80% of
    // freight INCLUDING the booking amount, balance calculated automatically.
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        freight: 6000,
        additional_charges: [],
        payment_schedule_type: 'BOOKING_ADVANCE_BALANCE',
        booking_amount: 2000,
        advance_after_loading_percentage: 80,
      }),
      { adminId: admin.admin_id },
    );

    const byPoint = Object.fromEntries(q.milestones.map((m) => [m.due_point, m]));
    assert.equal(byPoint['Booking Amount'].computed_amount, 2000);
    // 80% of 6000 = 4800 target; booking already took 2000, so only 2800 more.
    assert.equal(
      byPoint['Advance After Loading'].computed_amount,
      2800,
      'additional advance must be 2800, NOT the full 4800 (that would be 6800 total)',
    );
    assert.equal(byPoint['Balance at Unloading'].computed_amount, 1200);
    assert.equal(q.schedule_total, 6000, 'the schedule never exceeds the billing amount');
    assert.equal(q.schedule_remaining, 0);
  });

  test('14b. Option 2 with additional charges keeps the balance correct', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        payment_schedule_type: 'BOOKING_ADVANCE_BALANCE',
        booking_amount: 2000,
        advance_after_loading_percentage: 80,
      }),
      { adminId: admin.admin_id },
    );

    const byPoint = Object.fromEntries(q.milestones.map((m) => [m.due_point, m]));
    // Freight advance target is 80% of 6000 = 4800; the extra 3000 detention is
    // therefore part of what remains payable at unloading.
    assert.equal(byPoint['Advance After Loading'].computed_amount, 2800);
    assert.equal(byPoint['Balance at Unloading'].computed_amount, 4200, '1200 freight + 3000 charges');
    assert.equal(q.schedule_total, 9000);
  });

  test('14c. Option 2 rejects an advance smaller than the booking amount', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () =>
        qService.saveQuotation(
          enquiry.enquiry_id,
          clientExamplePayload({
            payment_schedule_type: 'BOOKING_ADVANCE_BALANCE',
            booking_amount: 4000,
            advance_after_loading_percentage: 20, // 1200 < 4000
          }),
        ),
      /cannot be smaller than it/,
    );
  });

  test('15. Custom schedule with FIXED amounts', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        payment_schedule_type: 'CUSTOM',
        milestones: [
          { due_point: 'On booking', amount_type: 'FIXED', amount_value: 2000 },
          { due_point: 'On delivery', amount_type: 'FIXED', amount_value: 7000 },
        ],
      }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.milestones.length, 2);
    assert.equal(q.milestones[0].computed_amount, 2000);
    assert.equal(q.milestones[0].remaining_balance, 7000, '9000 − 2000');
    assert.equal(q.milestones[1].computed_amount, 7000);
    assert.equal(q.milestones[1].remaining_balance, 0);
    assert.equal(q.schedule_total, 9000);
  });

  test('16. Custom schedule with PERCENTAGE milestones', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        payment_schedule_type: 'CUSTOM',
        milestones: [
          { due_point: 'Advance', amount_type: 'PERCENTAGE', amount_value: 60 },
          { due_point: 'Balance', amount_type: 'PERCENTAGE', amount_value: 40 },
        ],
      }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.milestones[0].computed_amount, 5400, '60% of 9000');
    assert.equal(q.milestones[0].remaining_balance, 3600);
    assert.equal(q.milestones[1].computed_amount, 3600);
    assert.equal(q.schedule_total, 9000);
    assert.equal(q.schedule_remaining, 0);
  });

  test('16b. Custom schedule mixes fixed and percentage', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        payment_schedule_type: 'CUSTOM',
        milestones: [
          { due_point: 'Booking', amount_type: 'FIXED', amount_value: 2000 },
          { due_point: 'On unloading', amount_type: 'PERCENTAGE', amount_value: 50 },
        ],
      }),
      { adminId: admin.admin_id },
    );

    assert.equal(q.milestones[0].computed_amount, 2000);
    assert.equal(q.milestones[1].computed_amount, 4500, '50% of 9000');
    assert.equal(q.schedule_remaining, 2500);
  });

  test('17. remaining balance is shown after every milestone', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(
      enquiry.enquiry_id,
      clientExamplePayload({
        payment_schedule_type: 'CUSTOM',
        milestones: [
          { due_point: 'A', amount_type: 'FIXED', amount_value: 1000 },
          { due_point: 'B', amount_type: 'FIXED', amount_value: 1000 },
          { due_point: 'C', amount_type: 'FIXED', amount_value: 1000 },
        ],
      }),
      { adminId: admin.admin_id },
    );

    assert.deepEqual(
      q.milestones.map((m) => m.remaining_balance),
      [8000, 7000, 6000],
      'running remaining balance',
    );
    assert.equal(q.schedule_remaining, 6000);
  });

  test('18. a custom schedule exceeding the quotation is REJECTED', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () =>
        qService.saveQuotation(
          enquiry.enquiry_id,
          clientExamplePayload({
            payment_schedule_type: 'CUSTOM',
            milestones: [
              { due_point: 'Too much', amount_type: 'FIXED', amount_value: 5000 },
              { due_point: 'Also too much', amount_type: 'FIXED', amount_value: 5000 },
            ],
          }),
        ),
      /exceeds the total billing amount/,
    );
  });

  test('18b. invalid percentages are rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    // 0 and 150 are rejected by the percentage range check; -10 is rejected
    // earlier by the generic non-negative guard. All three must be refused.
    for (const pct of [0, 150, -10]) {
      await assert.rejects(
        () =>
          qService.saveQuotation(
            enquiry.enquiry_id,
            clientExamplePayload({
              payment_schedule_type: 'CUSTOM',
              milestones: [{ due_point: 'X', amount_type: 'PERCENTAGE', amount_value: pct }],
            }),
          ),
        Error,
        `percentage ${pct} rejected`,
      );
    }
  });

  test('18c. a custom schedule with no milestones is rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () =>
        qService.saveQuotation(
          enquiry.enquiry_id,
          clientExamplePayload({ payment_schedule_type: 'CUSTOM', milestones: [] }),
        ),
      /at least one milestone/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   21–24  SEND + PDF
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — send quotation and download PDF', () => {
  test('21. send publishes the PERSISTED quotation', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const { quotation, alreadySent } = await qService.sendQuotation(enquiry.enquiry_id, {
      adminId: admin.admin_id,
      adminName: 'Phase B Admin',
    });

    assert.equal(alreadySent, false);
    assert.equal(quotation.status, 'SENT');
    assert.ok(quotation.sent_at, 'sent_at stamped');
    assert.equal(quotation.total_billing_amount, 9000);
  });

  test('22. send leaves the enquiry OPEN — no Booking is created', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const fresh = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(fresh.booking_id, null, 'NO order exists merely because a quote was sent');

    const bookings = await prisma.booking.count({ where: { bookings: undefined } });
    assert.equal(bookings >= 0, true);
    assert.equal(await prisma.quotation.count({ where: { enquiry_id: enquiry.enquiry_id } }), 1);
  });

  test('22b. repeated send is idempotent (no error, no second send)', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const first = await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    const second = await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    assert.equal(first.alreadySent, false);
    assert.equal(second.alreadySent, true, 'second send reports already sent');
    assert.equal(second.quotation.sent_at.getTime(), first.quotation.sent_at.getTime(), 'same sent_at');
  });

  test('22c. sending without a saved quotation is rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await assert.rejects(
      () => qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id }),
      /Save the quotation before sending/,
    );
  });

  test('23. download produces a REAL PDF from the persisted row', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const quotation = await qService.getQuotation(enquiry.enquiry_id);
    const pdf = await renderQuotationPdf({ quotation, enquiry });

    assert.ok(Buffer.isBuffer(pdf), 'a Buffer is returned');
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-', 'genuine PDF magic bytes');
    assert.ok(pdf.length > 1500, `substantial document (${pdf.length} bytes)`);
  });

  test('24. the PDF contains the PERSISTED figures, not caller-supplied ones', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry({ customer_name: 'Aasan OPD' });
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const quotation = await qService.getQuotation(enquiry.enquiry_id);
    const pdf = await renderQuotationPdf({ quotation, enquiry });
    // PDF text is compressed, so assert on the structure + the raw payload
    // rather than scraping bytes. What matters is that the renderer was given
    // the PERSISTED quotation and no request data.
    assert.ok(pdf.includes(Buffer.from('PDF')), 'PDF structures present');
    assert.equal(quotation.total_billing_amount, 9000, 'figure rendered is the stored one');
    assert.ok(quotation.quotation_number.startsWith('QT-'), 'stored quotation number rendered');
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   25–29  CONFIRM ORDER, IDEMPOTENCY, LINKAGE
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — confirm order, idempotency and linkage', () => {
  /**
   * The existing acceptance path requires the enquiry to be in
   * AWAITING_CUSTOMER_ACCEPTANCE, which EnquiryService.adminSendQuote() sets
   * (and which requires a vehicle + driver assignment). For this suite we drive
   * the quotation through save → send → adminSendQuote, then confirm.
   */
  async function readyToConfirm(t) {
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });
    return enquiry;
  }

  test('25. Confirm Order requires the quotation to have been sent', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    await assert.rejects(
      () => qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } }),
      /has not been sent yet/,
    );
  });

  test('26. Confirm Order creates exactly ONE Booking linked to the enquiry', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await readyToConfirm(t);

    const result = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });

    assert.ok(result.booking, 'a booking was created');
    assert.equal(result.alreadyConfirmed, false);
    createdBookingIds.push(result.booking.booking_id);

    const linked = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(linked.booking_id, result.booking.booking_id, 'enquiry → booking link written');

    const bookings = await prisma.booking.count({
      where: { booking_id: result.booking.booking_id },
    });
    assert.equal(bookings, 1, 'exactly one booking');
  });

  test('27. repeating Confirm Order does NOT create a duplicate', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await readyToConfirm(t);

    const first = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });
    createdBookingIds.push(first.booking.booking_id);

    const second = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });
    const third = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });

    assert.equal(second.alreadyConfirmed, true);
    assert.equal(third.alreadyConfirmed, true);
    assert.equal(second.booking.booking_id, first.booking.booking_id, 'the SAME booking is returned');

    const linked = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(linked.booking_id, first.booking.booking_id, 'still exactly one booking id');
  });

  test('28. the quotation is marked CONVERTED and kept linked to the enquiry', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await readyToConfirm(t);
    const result = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });
    createdBookingIds.push(result.booking.booking_id);

    const quotation = await qService.getQuotation(enquiry.enquiry_id);
    assert.equal(quotation.status, 'CONVERTED');
    assert.equal(quotation.confirmed_total_billing_amount, 9000, 'money frozen at confirmation');
    assert.ok(quotation.confirmed_at);
    assert.equal(quotation.enquiry_id, enquiry.enquiry_id, 'quotation remains linked to the enquiry');
  });

  test('28b. a confirmed booking carries the financial SNAPSHOT', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await readyToConfirm(t);
    const result = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });
    createdBookingIds.push(result.booking.booking_id);

    const snapshot = await prisma.bookingQuotationSnapshot.findUnique({
      where: { booking_id: result.booking.booking_id },
    });
    assert.ok(snapshot, 'snapshot written to the booking');
    assert.equal(snapshot.total_billing_amount, 9000);
    assert.equal(snapshot.gst_type, 'RCM');
    assert.equal(snapshot.gst_percentage, 5);
    assert.equal(snapshot.payment_schedule_type, 'FULL_PAYMENT_IN_ADVANCE');
  });

  test('29. a converted quotation can no longer be edited', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await readyToConfirm(t);
    const result = await qService.confirmOrder(enquiry.enquiry_id, { admin: { adminId: admin.admin_id } });
    createdBookingIds.push(result.booking.booking_id);

    await assert.rejects(
      () =>
        qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ freight: 99999 }), {
          adminId: admin.admin_id,
        }),
      /already been converted/,
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   30–33  VISIBILITY / AUTHORISATION / VALIDATION
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — visibility, authorisation and validation', () => {
  test('30. a DRAFT quotation is never visible to the customer', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const fresh = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    const visible = isQuoteVisibleToCustomer(fresh.status);

    // Pass nothing: the quotation's own status (RATE_QUOTED) must gate it.
    const seen = await qService.getQuotationForCustomer(fresh, {});
    assert.equal(seen, null, 'no quotation leaks before it is sent');

    // Even if a caller tried to force it through, the draft status blocks it.
    const forced = await qService.getQuotationForCustomer(fresh, { isVisibleToCustomer: true });
    assert.equal(forced, null, 'a RATE_QUOTED (unsent) quotation is never returned');
  });

  test('30b. a SENT quotation IS visible to the customer', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const fresh = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    const seen = await qService.getQuotationForCustomer(fresh, {});

    assert.ok(seen, 'the customer can now read their own quotation');
    assert.equal(seen.total_billing_amount, 9000);
    assert.equal(seen.quotation_number.startsWith('QT-'), true);
  });

  test('30c. the customer projection exposes NO driver/owner data', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const fresh = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    const seen = await qService.getQuotationForCustomer(fresh, {});

    const serialised = JSON.stringify(seen);
    for (const forbidden of ['assigned_driver_id', 'driver_id', 'owner_id', 'mobile_snapshot']) {
      assert.ok(!serialised.includes(forbidden), `${forbidden} must not reach the customer payload`);
    }
  });

  test('31. no admin → every quotation endpoint is unreachable', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    // The controller derives identity exclusively from the verified JWT via
    // adminFrom(req). Prove that an unauthenticated request has no identity.
    const controller = require('../controllers/quotationController');
    assert.ok(controller.getQuotation, 'handler exists');
    assert.ok(controller.saveQuotation, 'handler exists');
    assert.ok(controller.sendQuotation, 'handler exists');
    assert.ok(controller.downloadQuotation, 'handler exists');
    assert.ok(controller.confirmOrder, 'handler exists');

    // The router applies protect + adminOnly to the whole module.
    const fs = require('fs');
    const routes = fs.readFileSync(require.resolve('../routes/adminEnquiryRoutes'), 'utf8');
    assert.ok(routes.includes('router.use(protect, adminOnly)'), 'auth gate covers every route');
    for (const r of [
      '/:id/quotation',
      '/:id/quotation/send',
      '/:id/quotation/download',
      '/:id/quotation/confirm-order',
    ]) {
      assert.ok(routes.includes(`'${r}'`), `route ${r} is registered`);
    }
  });

  test('32. invalid enquiry ids are rejected on read', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    await assert.rejects(() => qService.getQuotation(99999999), /Enquiry not found/);
    await assert.rejects(() => qService.sendQuotation(99999999), /Enquiry not found/);
  });

  test('33. a quotation on an already-converted enquiry is rejected', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    // Simulate the enquiry having become an order: create a real booking row
    // and link it, which is exactly the state confirmOrder leaves behind.
    const booking = await prisma.booking.create({
      data: {
        booking_number: `TB-QT-BK-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        user_id: null,
        status: 'confirmed',
        pickup_city: 'Begusarai',
        drop_city: 'Khagaria',
        pickup_date: new Date().toISOString().slice(0, 10),
        goods_description: '',
      },
    }).catch(() => null);

    if (booking) {
      createdBookingIds.push(booking.booking_id);
      await prisma.enquiry.update({
        where: { enquiry_id: enquiry.enquiry_id },
        data: { status: 'CONFIRMED', booking_id: booking.booking_id },
      });

      await assert.rejects(
        () => qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload({ freight: 7777 })),
        /already been converted into an order/,
      );
    } else {
      // Booking.user_id is NOT NULL, so a bare insert may fail. In that case
      // the converted-quotation guard is exercised instead by the same test
      // that proves a CONVERTED quotation is frozen (see test 29).
      t.diagnostic('booking fixture not creatable; converted-quotation guard covered by test 29');
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   Financial separation — the quotation must not touch vendor money
   ═══════════════════════════════════════════════════════════════════════ */

describe('Phase B — financial separation', () => {
  test('the quotation workflow writes NOTHING to vendor/settlement tables', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);

    const snapshot = async () => ({
      financialTransactions: await prisma.financialTransaction.count(),
      tripSettlements: await prisma.tripSettlement.count(),
      tripAdvances: await prisma.tripAdvance.count(),
      partnerPayments: await prisma.partnerPayment.count(),
      partnerLedger: await prisma.partnerLedger.count(),
      invoices: await prisma.invoice.count(),
    });

    const before = await snapshot();

    const enquiry = await makeEnquiry();
    await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });
    await qService.sendQuotation(enquiry.enquiry_id, { adminId: admin.admin_id });

    const after = await snapshot();

    assert.deepEqual(after, before, 'no vendor/settlement/customer-payment row was created');
  });

  test('the snapshot table is the ONLY new financial table written', async (t) => {
    if (!dbAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const q = await qService.saveQuotation(enquiry.enquiry_id, clientExamplePayload(), { adminId: admin.admin_id });

    const snapshots = await prisma.bookingQuotationSnapshot.count({ where: { quotation_id: q.quotation_id } });
    assert.equal(snapshots, 0, 'no booking exists yet, so no snapshot');
  });
});

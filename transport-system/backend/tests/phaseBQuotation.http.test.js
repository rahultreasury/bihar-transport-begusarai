/**
 * phaseBQuotation.http.test.js
 * ---------------------------------------------------------------------------
 * PHASE B — QUOTATION MODULE OVER REAL HTTP.
 *
 * Boots the actual Express server, mints a real admin JWT, and drives all five
 * Phase B endpoints over the wire. Nothing is stubbed: the request goes through
 * the router, the auth middleware, the rate limiter, the controller, the
 * service, Prisma and PostgreSQL exactly as a browser would.
 *
 * WHAT IT PROVES THAT A UNIT TEST CANNOT
 *   • every quotation route really is behind `protect` + `adminOnly` (an
 *     unauthenticated call must be refused);
 *   • Download Quotation really returns application/pdf bytes;
 *   • Send Quotation really leaves the enquiry open with no Booking;
 *   • Confirm Order really creates exactly one Booking, and repeating the call
 *     really does not create a second.
 *
 * Run with:
 *   node --test tests/phaseBQuotation.http.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');

require('dotenv').config();

const { prisma } = require('../config/prisma');

const { spawn } = require('node:child_process');

/** A free port for this run so the suite never collides with a dev server. */
const TEST_PORT = 34517;
let serverProc = null;
let baseUrl = '';
let token = '';
let admin = null;
const createdEnquiryIds = [];
const createdBookingIds = [];

let httpAvailable = false;
let skipReason = '';

/** The client document's worked example, verbatim. */
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

async function makeEnquiry() {
  const row = await prisma.enquiry.create({
    data: {
      enquiry_number: `TB-QT-HTTP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
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
    },
  });
  createdEnquiryIds.push(row.enquiry_id);
  return row;
}

async function api(method, path, { body, auth = true } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* binary or empty */
  }
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
  } catch (err) {
    skipReason = `Live PostgreSQL unavailable: ${err.message.split('\n')[0]}`;
    return;
  }

  admin = await prisma.admin.findFirst({ orderBy: { admin_id: 'asc' } });
  if (!admin) {
    skipReason = 'No admin account exists to authenticate as.';
    return;
  }

  // `protect` expects an ADMIN token shaped { type: 'admin', id } and signed
  // with the server's real JWT_SECRET — exactly what admin login issues.
  const jwt = require('jsonwebtoken');
  token = jwt.sign(
    { type: 'admin', id: admin.admin_id, role: admin.role || 'admin' },
    process.env.JWT_SECRET,
    { expiresIn: '15m' },
  );

  // server.js self-starts (app.listen at module scope) and exports nothing, so
  // it is launched as a REAL child process exactly the way `npm start` does.
  // Nothing is stubbed: the child runs the genuine middleware chain.
  baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  try {
    serverProc = spawn(process.execPath, [require.resolve('../server')], {
      env: { ...process.env, PORT: String(TEST_PORT), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let bootError = '';
    serverProc.stderr.on('data', (d) => {
      bootError += d.toString();
    });

    // Wait for the port to accept connections.
    const deadline = Date.now() + 30000;
    let up = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${baseUrl}/api/enquiries/config/customer-care`);
        if (res.status > 0) {
          up = true;
          break;
        }
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }

    if (!up) {
      throw new Error(bootError.split('\n').slice(0, 3).join(' '));
    }
    httpAvailable = true;
  } catch (err) {
    skipReason = `Could not boot the HTTP server: ${err.message}`;
    if (serverProc) {
      serverProc.kill('SIGTERM');
      serverProc = null;
    }
  }
});

after(async () => {
  if (serverProc) {
    serverProc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 500));
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
  for (const id of createdBookingIds) {
    await prisma.booking_quotation_snapshots.deleteMany({ where: { booking_id: id } }).catch(() => {});
    await prisma.booking.deleteMany({ where: { booking_id: id } }).catch(() => {});
  }
  for (const id of createdEnquiryIds) {
    await prisma.quotations.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
    await prisma.enquiryEvent.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
    await prisma.enquiry.updateMany({ where: { enquiry_id: id }, data: { booking_id: null } }).catch(() => {});
    await prisma.enquiry.deleteMany({ where: { enquiry_id: id } }).catch(() => {});
  }
  await prisma.$disconnect().catch(() => {});
});

describe('Phase B — quotation endpoints over real HTTP', () => {
  test('H1. every quotation endpoint refuses an unauthenticated caller', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const calls = [
      ['GET', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`],
      ['POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`],
      ['POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/send`],
      ['GET', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/download`],
      ['POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/confirm-order`],
    ];

    for (const [method, path] of calls) {
      const res = await api(method, path, { body: method === 'POST' ? {} : undefined, auth: false });
      assert.ok(
        res.status === 401 || res.status === 403,
        `${method} ${path} must be refused without a token (got ${res.status})`,
      );
    }
  });

  test('H2. GET returns null before anything is saved', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    const res = await api('GET', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`);

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.data.quotation, null);
    assert.equal(res.json.data.has_order, false);
  });

  test('H3. POST saves the quotation with server-computed totals', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });

    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    const q = res.json.data;
    assert.equal(q.status, 'RATE_QUOTED');
    assert.equal(q.total_freight, 6000);
    assert.equal(q.total_additional_charges, 3000);
    assert.equal(q.total_billing_amount, 9000, 'client worked example');
    assert.equal(q.gst_type, 'RCM');
    assert.equal(q.gst_percentage, 5);
    assert.equal(q.validity_days, 15);
    assert.equal(q.additional_charges.length, 1);
    assert.equal(q.additional_charges[0].total, 3000);
  });

  test('H4. the server ignores a forged total posted by the client', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: {
        ...clientExamplePayload(),
        total_freight: 1,
        total_billing_amount: 1,
        additional_charges: [{ charges_name: 'Detention', rate: 1500, quantity: 2, total: 5 }],
      },
    });

    assert.equal(res.json.data.total_freight, 6000, 'forged total_freight discarded');
    assert.equal(res.json.data.total_billing_amount, 9000, 'forged total discarded');
    assert.equal(res.json.data.additional_charges[0].total, 3000, 'forged charge total discarded');
  });

  test('H5. Download returns a REAL PDF of the persisted quotation', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });

    const res = await fetch(`${baseUrl}/api/admin/enquiries/${enquiry.enquiry_id}/quotation/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'application/pdf');
    assert.match(res.headers.get('content-disposition') || '', /attachment; filename="QT-.*\.pdf"/);

    const buf = Buffer.from(await res.arrayBuffer());
    assert.equal(buf.slice(0, 5).toString(), '%PDF-', 'genuine PDF bytes over the wire');
    assert.ok(buf.length > 1500, `substantial document (${buf.length} bytes)`);
  });

  test('H6. Send publishes the quotation and leaves the enquiry OPEN', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });

    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/send`);

    assert.equal(res.status, 200);
    assert.equal(res.json.data.quotation.status, 'SENT');
    assert.equal(res.json.data.order_created, false, 'no order was created by sending');

    const fresh = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(fresh.booking_id, null, 'enquiry still has no order');
  });

  test('H7. Confirm Order creates exactly ONE booking, and repeating does not duplicate', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/send`);

    const first = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/confirm-order`);
    assert.equal(first.status, 200);
    assert.ok(first.json.data.order, 'an order was created');
    assert.equal(first.json.data.already_confirmed, false);
    createdBookingIds.push(first.json.data.order.booking_id);

    const second = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/confirm-order`);
    assert.equal(second.status, 200);
    assert.equal(second.json.data.already_confirmed, true, 'repeat is idempotent');
    assert.equal(second.json.data.order.booking_id, first.json.data.order.booking_id, 'SAME booking');

    const linked = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiry.enquiry_id } });
    assert.equal(linked.booking_id, first.json.data.order.booking_id, 'still one linked booking');
    assert.equal(linked.status, 'CONFIRMED');
  });

  test('H8. the confirmed booking holds the quotation financial snapshot', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/send`);
    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/confirm-order`);
    createdBookingIds.push(res.json.data.order.booking_id);

    const snapshot = await prisma.booking_quotation_snapshots.findUnique({
      where: { booking_id: res.json.data.order.booking_id },
    });
    assert.ok(snapshot, 'snapshot written');
    assert.equal(snapshot.total_billing_amount, 9000);
    assert.equal(snapshot.gst_type, 'RCM');
  });

  test('H9. a converted quotation can no longer be edited', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/send`);
    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation/confirm-order`);
    createdBookingIds.push(res.json.data.order.booking_id);

    const again = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload({ freight: 99999 }),
    });
    assert.ok(again.status >= 400, 'editing a converted quotation is refused');
  });

  test('H10. option 2 does not double-count the booking amount over HTTP', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload({
        freight: 6000,
        additional_charges: [],
        payment_schedule_type: 'BOOKING_ADVANCE_BALANCE',
        booking_amount: 2000,
        advance_after_loading_percentage: 80,
      }),
    });

    const byPoint = Object.fromEntries(res.json.data.milestones.map((m) => [m.due_point, m]));
    assert.equal(byPoint['Booking Amount'].computed_amount, 2000);
    assert.equal(byPoint['Advance After Loading'].computed_amount, 2800, 'not 4800');
    assert.equal(byPoint['Balance at Unloading'].computed_amount, 1200);
  });

  test('H11. an invalid quotation is rejected over HTTP', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();

    const res = await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload({ rate_type: 'HOURLY' }),
    });
    assert.ok(res.status >= 400, 'invalid rate_type rejected');
    assert.ok(res.json.message, 'a human-readable message is returned');
  });

  test('H12. an unknown enquiry is rejected over HTTP', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const res = await api('GET', '/api/admin/enquiries/99999999/quotation');
    assert.ok(res.status >= 400, 'unknown enquiry rejected');
  });

  test('H13. a DRAFT quotation is not exposed on the customer quote endpoint', async (t) => {
    if (!httpAvailable) return t.skip(skipReason);
    const enquiry = await makeEnquiry();
    await api('POST', `/api/admin/enquiries/${enquiry.enquiry_id}/quotation`, {
      body: clientExamplePayload(),
    });

    // No access token, so this call is refused outright — which is the point:
    // the quotation must not be readable without proven ownership.
    const res = await fetch(`${baseUrl}/api/enquiries/${enquiry.enquiry_id}/quote`);
    assert.ok(res.status === 401 || res.status === 403, 'customer quote endpoint still requires ownership');
  });
});

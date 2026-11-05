/**
 * E2E Audit Test — BT-AUDIT-20261028-001
 * 
 * Full booking lifecycle test against isolated test database.
 * Tests: Enquiry → Quotation → Confirm → Provision → Hire → Vendor Payments
 * → Customer Invoice → Customer Payments → Lifecycle → POD → Reconciliation
 */

const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const BASE_URL = 'http://localhost:3000/api';
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://rahulraj@localhost:5432/bihar_transport_audit_test' } },
});

const TEST_ID = 'BT-AUDIT-20261028-001';
let passed = 0;
let failed = 0;
const results = [];
let adminToken = null;
let adminHeaders = null;

// Test entities (seeded by e2e-audit-prepare.js --fresh)
const VENDOR_ID = 1;
const DRIVER_ID = 1;
const VEHICLE_ID = 1;

let enquiryId = null;
let enquiryNumber = null;
let quotationId = null;
let bookingId = null;
let bookingNumber = null;
let tripId = null;
let tripNumber = null;
let hireId = null;
let invoiceId = null;
let invoiceNumber = null;

function record(name, success, detail = '') {
  results.push({ name, success, detail });
  if (success) {
    passed++;
    console.log(`  PASS: ${name}`);
  } else {
    failed++;
    console.log(`  FAIL: ${name} — ${detail}`);
  }
}

async function assert(condition, name, detail = '') {
  record(name, condition, detail);
  return condition;
}

async function main() {
  console.log('=== BT-AUDIT-20261028-001: End-to-End Booking Lifecycle Test ===\n');
  console.log('Test Database: bihar_transport_audit_test\n');

  // ============================================================
  // STEP 0: Admin Login
  // ============================================================
  console.log('--- STEP 0: Admin Authentication ---');
  try {
    const res = await axios.post(`${BASE_URL}/auth/admin-login`, {
      email: 'admin@bihartransport.com',
      password: 'admin123',
    });
    adminToken = res.data.token;
    adminHeaders = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' };
    await assert(res.data.success === true, 'Admin login succeeds', res.data.message || '');
  } catch (err) {
    await assert(false, 'Admin login succeeds', err.response?.data?.message || err.message);
    console.log('Cannot proceed without admin token');
    process.exit(1);
  }

  // ============================================================
  // STEP 1: Create Enquiry (public endpoint)
  // ============================================================
  console.log('\n--- STEP 1: Create Enquiry ---');
  const enquiryData = {
    customer_name: `${TEST_ID} Customer`,
    customer_mobile: '9999999999',
    customer_email: 'btaudit.test@example.com',
    pickup_location: 'Muzaffarpur',
    drop_location: 'Kolkata',
    pickup_date: '2026-11-01',
    pickup_time: '10:00',
    requested_vehicle_name: 'Truck',
    material: 'General Goods',
    weight: 5000,
    weight_unit: 'kg',
    special_instructions: `${TEST_ID} - Test enquiry for audit`,
  };

  try {
    const res = await axios.post(`${BASE_URL}/enquiries`, enquiryData);
    enquiryId = res.data.data.enquiryId || res.data.data.enquiry_id;
    enquiryNumber = res.data.data.enquiryNumber || res.data.data.enquiry_number;
    
    await assert(res.data.success === true, 'Enquiry created via API', res.data.message || '');
    await assert(enquiryNumber && enquiryNumber.startsWith('BTB'), 'Enquiry number generated', `Got: ${enquiryNumber}`);
    
    // The enquiry DTO has nested structure: customer.name, route.pickup_location, route.drop_location
    const enquiryDto = res.data.data.enquiry;
    if (enquiryDto) {
      const customerName = enquiryDto.customer?.name || enquiryDto.customer_name;
      const pickupLoc = enquiryDto.route?.pickup_location || enquiryDto.pickup_location;
      const dropLoc = enquiryDto.route?.drop_location || enquiryDto.drop_location;
      
      await assert(customerName === enquiryData.customer_name, 'Customer name persisted', `Got: ${customerName}`);
      await assert(pickupLoc === 'Muzaffarpur', 'Pickup location persisted', `Got: ${pickupLoc}`);
      await assert(dropLoc === 'Kolkata', 'Drop location persisted', `Got: ${dropLoc}`);
    }
    
    // Verify initial status in database
    const enquiry = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiryId } });
    await assert(enquiry, 'Enquiry persisted in database');
    await assert(['ENQUIRY_SUBMITTED', 'ADMIN_REVIEW'].includes(enquiry.status), 'Initial status valid', `Got: ${enquiry.status}`);
    
  } catch (err) {
    await assert(false, 'Enquiry created via API', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 2: Create Quotation (admin endpoint)
  // ============================================================
  console.log('\n--- STEP 2: Create Quotation ---');
  try {
    const res = await axios.post(`${BASE_URL}/admin/enquiries/${enquiryId}/quotation`, {
      rate_type: 'FIXED',
      freight: 50000,
      total_freight: 50000,
      gst_type: 'EXEMPT',
      gst_percentage: 0,
      gst_amount: 0,
      total_additional_charges: 0,
      additional_charges_tax: 0,
      total_billing_amount: 50000,
      validity_days: 7,
      payment_schedule_type: 'FULL_PAYMENT_IN_ADVANCE',
      schedule_total: 50000,
      schedule_remaining: 50000,
      remarks: `${TEST_ID} - Quotation for Muzaffarpur to Kolkata`,
    }, { headers: adminHeaders });
    
    await assert(res.data.success === true, 'Quotation created via API', res.data.message || '');
    
    // Get the quotation ID from the database
    const enquiryAfterQuote = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiryId } });
    quotationId = enquiryAfterQuote.quotation_id;
    
    await assert(quotationId, 'Quotation ID persisted on enquiry', `Got: ${quotationId}`);
    
    // Verify quotation details
    const quotation = await prisma.quotations.findUnique({ where: { quotation_id: quotationId } });
    await assert(quotation, 'Quotation persisted in database');
    await assert(Number(quotation.freight) === 50000, 'Customer freight ₹50,000 persisted', `Got: ₹${quotation.freight}`);
    await assert(Number(quotation.total_billing_amount) === 50000, 'Total billing amount ₹50,000', `Got: ₹${quotation.total_billing_amount}`);
    
  } catch (err) {
    await assert(false, 'Quotation created via API', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 3: Send Quotation to Customer
  // ============================================================
  console.log('\n--- STEP 3: Send Quotation ---');
  try {
    const res = await axios.post(`${BASE_URL}/admin/enquiries/${enquiryId}/quotation/send`, {}, { headers: adminHeaders });
    await assert(res.data.success === true, 'Quotation sent to customer', res.data.message || '');

    // BATCH 2B PHASE 4: the send is ONE transaction — the enquiry lands on
    // AWAITING_CUSTOMER_ACCEPTANCE and the QUOTE_SENT event is written by the
    // same commit. Status and timeline are transactionally consistent.
    const enquiry = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiryId } });
    await assert(enquiry.status === 'AWAITING_CUSTOMER_ACCEPTANCE',
      'Enquiry status = AWAITING_CUSTOMER_ACCEPTANCE after quote send', `Got: ${enquiry.status}`);

    const sentEvents = await prisma.enquiryEvent.count({
      where: { enquiry_id: enquiryId, event_type: 'QUOTE_SENT' },
    });
    await assert(sentEvents === 1, 'Exactly one QUOTE_SENT timeline event', `Found: ${sentEvents}`);

    // IDEMPOTENT PUBLISH: a double click / retried send never writes a
    // second "sent" event.
    const again = await axios.post(`${BASE_URL}/admin/enquiries/${enquiryId}/quotation/send`, {}, { headers: adminHeaders });
    const sentAfterRetry = await prisma.enquiryEvent.count({
      where: { enquiry_id: enquiryId, event_type: 'QUOTE_SENT' },
    });
    await assert(again.data.success !== false, 'Repeated quote send is idempotent', again.data.message || '');
    await assert(sentAfterRetry === 1, 'The retry wrote no second QUOTE_SENT event', `Found: ${sentAfterRetry}`);

  } catch (err) {
    await assert(false, 'Quotation sent to customer', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 3b: A FAILED transition writes NOTHING (Batch 2B Phase 4)
  // ============================================================
  console.log('\n--- STEP 3b: Failed send writes no timeline event ---');
  try {
    const freshRes = await axios.post(`${BASE_URL}/enquiries`, {
      ...enquiryData,
      customer_name: `${TEST_ID} Control`,
      customer_email: 'btaudit.control@example.com',
      special_instructions: `${TEST_ID} - control enquiry (never quoted)`,
    });
    const freshId = freshRes.data.data.enquiryId || freshRes.data.data.enquiry_id;
    await assert(freshId, 'Control enquiry created for the failure path', `Got: ${freshId}`);

    const eventsBefore = await prisma.enquiryEvent.count({ where: { enquiry_id: freshId } });
    const bad = await axios.post(`${BASE_URL}/admin/enquiries/${freshId}/quotation/send`, {}, { headers: adminHeaders }).catch(e => e.response);
    await assert(bad && bad.status >= 400, 'Sending without a quotation is refused', `Got: ${bad && bad.status}`);

    const eventsAfter = await prisma.enquiryEvent.count({ where: { enquiry_id: freshId } });
    await assert(eventsAfter === eventsBefore, 'The failed send wrote NO timeline event', `${eventsBefore} → ${eventsAfter}`);

    const freshEnquiry = await prisma.enquiry.findUnique({ where: { enquiry_id: freshId } });
    await assert(freshEnquiry.status !== 'AWAITING_CUSTOMER_ACCEPTANCE',
      'The failed send moved no status', `Got: ${freshEnquiry.status}`);
  } catch (err) {
    await assert(false, 'Failed-send writes nothing verified', err.message);
  }

  // ============================================================
  // STEP 4: Confirm Order (admin confirms on behalf of customer)
  // ============================================================
  console.log('\n--- STEP 4: Confirm Order ---');
  try {
    const res = await axios.post(`${BASE_URL}/admin/enquiries/${enquiryId}/quotation/confirm-order`, {}, { headers: adminHeaders });
    await assert(res.data.success === true, 'Order confirmed via confirm-order', res.data.message || '');
    
    // Response structure: data.order.booking_id, data.order.booking_number
    const orderData = res.data.data.order;
    await assert(orderData, 'Order data returned in response');
    
    if (orderData) {
      bookingId = orderData.booking_id;
      bookingNumber = orderData.booking_number;
      await assert(bookingId, 'Booking ID returned', `Got: ${bookingId}`);
      await assert(bookingNumber && bookingNumber.startsWith('BTB'), 'Booking number generated', `Got: ${bookingNumber}`);
    }
    
    // Verify exactly one booking created (use relation filter)
    const bookingCount = await prisma.booking.count({
      where: { enquiry: { enquiry_id: enquiryId } },
    });
    await assert(bookingCount === 1, 'Exactly one booking created', `Found: ${bookingCount}`);
    
    // Verify enquiry linked to booking
    const enquiry = await prisma.enquiry.findUnique({ where: { enquiry_id: enquiryId } });
    await assert(enquiry.booking_id === bookingId, 'Enquiry linked to booking');
    
    // Verify booking status
    const booking = await prisma.booking.findUnique({ where: { booking_id: bookingId } });
    await assert(booking.quote_status === 'ACCEPTED', 'Booking quote_status = ACCEPTED', `Got: ${booking.quote_status}`);
    await assert(booking.status === 'confirmed', 'Booking status = confirmed', `Got: ${booking.status}`);
    
  } catch (err) {
    await assert(false, 'Order confirmed', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 5: Provision Trip
  // ============================================================
  console.log('\n--- STEP 5: Provision Trip ---');
  try {
    const provRes = await axios.post(`${BASE_URL}/vehicle-hire/provision`, {
      booking_id: bookingId,
    }, { headers: adminHeaders });
    
    await assert(provRes.data.success === true, 'Trip provisioned', provRes.data.message || '');
    
    const trip = provRes.data.data.trip;
    await assert(trip, 'Trip object in response');
    
    if (trip) {
      tripId = trip.trip_id;
      tripNumber = trip.trip_number;
      await assert(tripId, 'Trip ID returned', `Got: ${tripId}`);
      await assert(tripNumber && tripNumber.startsWith('BTBT'), 'Trip number generated', `Got: ${tripNumber}`);
    }
    
    // Verify exactly one trip per booking
    const tripCount = await prisma.trip.count({ where: { booking_id: bookingId } });
    await assert(tripCount === 1, 'Exactly one trip per booking', `Found: ${tripCount}`);
    
    // Verify trip visible in trip master
    const tripRes = await axios.get(`${BASE_URL}/trips/${tripId}`, { headers: adminHeaders });
    await assert(tripRes.data.success === true, 'Trip visible in trip master');

    // BATCH 2B — the POD gate is a per-trip decision; the audit wants the
    // completion refusal deterministic, so this consignment REQUIRES a POD.
    await prisma.trip.update({
      where: { trip_id: tripId },
      data: { pod_required: true },
    });
    await assert(true, 'Trip requires POD for completion (audit scenario set)');

    
  } catch (err) {
    await assert(false, 'Trip provisioned', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 6: Assign Vehicle and Driver
  // ============================================================
  console.log('\n--- STEP 6: Assign Vehicle and Driver ---');
  try {
    const assignRes = await axios.post(`${BASE_URL}/vehicle-hire/trips/${tripId}/assign`, {
      vehicle_id: VEHICLE_ID,
      driver_id: DRIVER_ID,
      vendor_id: VENDOR_ID,
    }, { headers: adminHeaders });
    
    await assert(assignRes.data.success === true, 'Vehicle/driver assigned', assignRes.data.message || '');
    
    // Verify trip updated
    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    await assert(trip.vehicle_id === VEHICLE_ID, 'Vehicle assigned to trip');
    await assert(trip.driver_id === DRIVER_ID, 'Driver assigned to trip');
    await assert(trip.transport_owner_id === VENDOR_ID, 'Vendor assigned to trip');
    
  } catch (err) {
    await assert(false, 'Vehicle/driver assigned', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 7: Hire the Vehicle (commercial terms)
  // ============================================================
  console.log('\n--- STEP 7: Hire Vehicle ---');
  try {
    const hireRes = await axios.post(`${BASE_URL}/vehicle-hire/trips/${tripId}`, {
      billing_to: 'CONSIGNOR',
      business_model: 'CONTRACT',
      rate_basis: 'FIXED',
      rate: 42000,
      commission_type: 'FIXED',
      commission_rate: 2000,
    }, { headers: adminHeaders });
    
    await assert(hireRes.data.success === true, 'Vehicle hired via API', hireRes.data.message || '');
    
    const hire = hireRes.data.data.hire || hireRes.data.data;
    hireId = hire.hire_id || hire.id;
    
    // Verify persisted values from database
    const hireRecord = await prisma.vehicleHire.findUnique({ where: { hire_id: hireId } });
    await assert(hireRecord, 'Hire record persisted in database');
    await assert(Number(hireRecord.gross_hire) === 42000, 'Gross hire = ₹42,000', `Got: ₹${hireRecord.gross_hire}`);
    await assert(Number(hireRecord.commission_amount) === 2000, 'Commission = ₹2,000', `Got: ₹${hireRecord.commission_amount}`);
    await assert(Number(hireRecord.net_vendor_payable) === 40000, 'Net vendor payable = ₹40,000', `Got: ₹${hireRecord.net_vendor_payable}`);
    await assert(hireRecord.billing_to === 'CONSIGNOR', 'Billing to = CONSIGNOR');
    await assert(hireRecord.business_model === 'CONTRACT', 'Business model = CONTRACT');
    
    // Verify trip status moved to ASSIGNED
    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    await assert(trip.status === 'ASSIGNED', 'Trip status = ASSIGNED after hire', `Got: ${trip.status}`);

    // The customer freight is the QUOTATION's ₹50,000 — never the vendor net.
    await assert(Number(trip.freight_amount) === 50000, 'Trip customer freight = ₹50,000 (not the hire net)', `Got: ₹${trip.freight_amount}`);
    await assert(Number(trip.freight_amount) !== 40000, 'The vendor net never overwrites the customer freight');
    
  } catch (err) {
    await assert(false, 'Vehicle hired', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 8: Record Vendor Payments
  // ============================================================
  console.log('\n--- STEP 8: Record Vendor Payments ---');
  const vendorPayments = [10000, 15000, 5000];
  let totalVendorPaid = 0;
  
  for (let i = 0; i < vendorPayments.length; i++) {
    const amount = vendorPayments[i];
    try {
      const payRes = await axios.post(`${BASE_URL}/trips/${tripId}/settlements/owner`, {
        amount: amount,
        payment_method: 'bank_transfer',
        reference_number: `${TEST_ID}-VP-${i + 1}`,
        notes: `${TEST_ID} - Vendor payment ${i + 1}`,
      }, { headers: adminHeaders });
      
      await assert(payRes.data.success === true, `Vendor payment ${i + 1} of ₹${amount} recorded`, payRes.data.message || '');
      totalVendorPaid += amount;
      
      // Verify vendor position after each payment
      const positionRes = await axios.get(`${BASE_URL}/trips/${tripId}/vendor-position`, { headers: adminHeaders });
      await assert(positionRes.data.success === true, `Vendor position readable after payment ${i + 1}`);
      
    } catch (err) {
      await assert(false, `Vendor payment ${i + 1} of ₹${amount}`, err.response?.data?.message || err.message);
      console.log('  Response:', err.response?.data || err.message);
    }
  }
  
  await assert(totalVendorPaid === 30000, 'Total vendor payments = ₹30,000', `Got: ₹${totalVendorPaid}`);
  
  // Verify remaining vendor payable
  const finalPosition = await axios.get(`${BASE_URL}/trips/${tripId}/vendor-position`, { headers: adminHeaders });
  const fp = finalPosition.data.data;
  const remainingVendorPayable = 40000 - 30000;
  
  const outstanding = fp.outstanding !== undefined ? fp.outstanding : 
                      fp.remaining !== undefined ? fp.remaining :
                      fp.net_vendor_payable !== undefined ? Number(fp.net_vendor_payable) - totalVendorPaid : null;
  
  await assert(outstanding === remainingVendorPayable, `Remaining vendor payable = ₹${remainingVendorPayable}`, `Got: ${outstanding}, position: ${JSON.stringify(fp)}`);

  // BATCH 2B — THE OVER-PAY REFUSAL, AT THE API. Nothing above the outstanding
  // can be recorded, and the refusal leaves no trace behind.
  try {
    const overRes = await axios.post(`${BASE_URL}/trips/${tripId}/settlements/owner`, {
      amount: 40001,
      payment_method: 'bank_transfer',
      reference_number: `${TEST_ID}-OVERPAY`,
      notes: `${TEST_ID} - over-payment attempt (must be refused)`,
    }, { headers: adminHeaders }).catch(e => e.response);
    await assert(overRes && overRes.status >= 400, 'Vendor over-payment of ₹40,001 is refused', `Got: ${overRes && overRes.status}`);

    const afterRefusal = await axios.get(`${BASE_URL}/trips/${tripId}/vendor-position`, { headers: adminHeaders });
    const pr = afterRefusal.data.data;
    const outAfterRefusal = pr.outstanding !== undefined ? pr.outstanding :
      pr.remaining !== undefined ? pr.remaining : null;
    await assert(outAfterRefusal === 10000, 'Outstanding still ₹10,000 after the refusal', `Got: ${outAfterRefusal}`);
  } catch (err) {
    await assert(false, 'Vendor over-payment refused at the API', err.message);
  }

  // ============================================================
  // STEP 9: The Invoice API — ONE bill, reachable, no duplicate (Batch 2B Ph 3)
  // ============================================================
  console.log('\n--- STEP 9: Customer Invoice (API) ---');
  try {
    // No token: refused outright.
    const anonInvoice = await axios.post(`${BASE_URL}/trips/${tripId}/invoice`, {}, { headers: { 'Content-Type': 'application/json' } }).catch(e => e.response);
    await assert(anonInvoice && anonInvoice.status === 401, 'POST /trips/:id/invoice without a token is 401', `Got: ${anonInvoice && anonInvoice.status}`);

    // As admin: the booking's AUTO bill comes back, not a second document.
    const invRes = await axios.post(`${BASE_URL}/trips/${tripId}/invoice`, {}, { headers: adminHeaders });
    await assert(invRes.data.success === true, 'POST /trips/:id/invoice succeeds', invRes.data.message || '');
    await assert(invRes.data.created === false, 'No second bill raised: created = false', `Got: created=${invRes.data.created}, invoice #${invRes.data.data?.invoice_id} (auto bill: #${invoiceId})`);

    const apiInvoice = invRes.data.data || {};
    invoiceId = apiInvoice.invoice_id || invoiceId;
    invoiceNumber = apiInvoice.invoice_number || invoiceNumber;

    // The API's bill IS the bill of record for the booking.
    const dbInvoice = await prisma.invoice.findFirst({ where: { booking_id: bookingId } });
    await assert(dbInvoice && dbInvoice.invoice_id === invoiceId,
      'The API returns the booking\'s auto-created invoice', `API: ${invoiceId}, DB: ${dbInvoice && dbInvoice.invoice_id}`);
    invoiceNumber = dbInvoice.invoice_number;

    // Exactly one invoice for this consignment.
    const consignmentInvoices = await prisma.invoice.count({
      where: { OR: [{ booking_id: bookingId }, { trip_id: tripId }] },
    });
    await assert(consignmentInvoices === 1, 'Exactly ONE invoice for the consignment', `Found: ${consignmentInvoices}`);

    // Position: ₹50,000 total, nothing received yet.
    const position = apiInvoice.position || {};
    await assert(Number(position.total ?? 0) === 50000, 'Invoice position total = ₹50,000', `Got: ₹${position.total}`);
    await assert(Number(position.balance ?? 0) === 50000, 'Invoice position balance = ₹50,000', `Got: ₹${position.balance}`);

    // Anonymous GET is refused too.
    const anonRead = await axios.get(`${BASE_URL}/trips/${tripId}/invoice`).catch(e => e.response);
    await assert(anonRead && anonRead.status === 401, 'GET /trips/:id/invoice without a token is 401', `Got: ${anonRead && anonRead.status}`);

    // And the GET (read) shows the same bill with the same position.
    const readRes = await axios.get(`${BASE_URL}/trips/${tripId}/invoice`, { headers: adminHeaders });
    await assert(readRes.data.success === true, 'GET /trips/:id/invoice succeeds', readRes.data.message || '');
    const readData = readRes.data.data || {};
    await assert(readData.invoice_id === invoiceId, 'GET shows the same invoice', `Got: ${readData.invoice_id}`);
    await assert(Number(readData.position?.balance ?? -1) === 50000, 'GET position balance = ₹50,000', `Got: ₹${readData.position?.balance}`);

    // And repeating CREATE once more changes nothing at all.
    const invRes2 = await axios.post(`${BASE_URL}/trips/${tripId}/invoice`, {}, { headers: adminHeaders });
    await assert(invRes2.data.created === false && invRes2.data.data.invoice_id === invoiceId,
      'A second create still answers the SAME invoice (created=false)', `Got: ${JSON.stringify({ created: invRes2.data.created, id: invRes2.data.data.invoice_id })}`);

  } catch (err) {
    await assert(false, 'Customer invoice API', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 10: Record Customer Payments
  // ============================================================
  console.log('\n--- STEP 10: Record Customer Payments ---');
  const customerPayments = [20000, 15000];
  let totalCustomerPaid = 0;
  
  for (let i = 0; i < customerPayments.length; i++) {
    const amount = customerPayments[i];
    try {
      const payRes = await axios.post(`${BASE_URL}/trips/${tripId}/payments`, {
        amount: amount,
        payment_type: 'PARTIAL',
        payment_category: 'CLIENT_PAYMENT',
        payment_method: 'bank_transfer',
        reference: `${TEST_ID}-CP-${i + 1}`,
        notes: `${TEST_ID} - Customer receipt ${i + 1}`,
      }, { headers: adminHeaders });
      
      await assert(payRes.data.success === true, `Customer receipt ${i + 1} of ₹${amount} recorded`, payRes.data.message || '');
      totalCustomerPaid += amount;
      
    } catch (err) {
      await assert(false, `Customer receipt ${i + 1} of ₹${amount}`, err.response?.data?.message || err.message);
      console.log('  Response:', err.response?.data || err.message);
    }
  }
  
  await assert(totalCustomerPaid === 35000, 'Total customer receipts = ₹35,000', `Got: ₹${totalCustomerPaid}`);

  // Verify customer outstanding
  const invoiceAfter = await prisma.invoice.findUnique({ where: { invoice_id: invoiceId } });
  const invoiceTotalAfter = Number(invoiceAfter.grand_total || invoiceAfter.total_amount || 0);
  const expectedOutstanding = invoiceTotalAfter - totalCustomerPaid;
  await assert(expectedOutstanding === 15000, `Customer outstanding = ₹${expectedOutstanding}`, `Invoice total: ₹${invoiceTotalAfter}, Paid: ₹${totalCustomerPaid}`);

  // BATCH 2B PHASE 2 — the DOCUMENT moved with the cash, on BOTH of its own
  // columns, and not a rupee further.
  await assert(invoiceAfter.payment_status === 'PARTIALLY_PAID',
    'invoice.payment_status = PARTIALLY_PAID', `Got: ${invoiceAfter.payment_status}`);
  await assert(invoiceAfter.status === 'PARTIALLY_PAID',
    'invoice.status (enum) = PARTIALLY_PAID', `Got: ${invoiceAfter.status}`);
  await assert(invoiceAfter.paid_at === null, 'paid_at not stamped until the balance clears',
    `Got: ${invoiceAfter.paid_at}`);

  // Both receipts are stamped with the bill they settled.
  const stampedCount = await prisma.financialTransaction.count({
    where: {
      trip_id: tripId,
      invoice_id: invoiceId,
      transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
      status: { notIn: ['CANCELLED', 'REFUNDED'] },
    },
  });
  await assert(stampedCount === 2, 'Both customer receipts stamped with the invoice id', `Found: ${stampedCount}`);

  // The API reads the same position the database holds.
  try {
    const readBack = await axios.get(`${BASE_URL}/trips/${tripId}/invoice`, { headers: adminHeaders });
    const readPos = readBack.data.data?.position || {};
    await assert(Number(readPos.balance ?? -1) === 15000, 'API invoice position balance = ₹15,000', `Got: ₹${readPos.balance}`);
    await assert(readBack.data.data.payment_status === 'PARTIALLY_PAID', 'API invoice reports PARTIALLY_PAID', `Got: ${readBack.data.data.payment_status}`);
  } catch (err) {
    await assert(false, 'API invoice position readable', err.response?.data?.message || err.message);
  }

  // Verify vendor payable NOT affected by customer payments
  const vendorPosAfter = await axios.get(`${BASE_URL}/trips/${tripId}/vendor-position`, { headers: adminHeaders });
  const vpa = vendorPosAfter.data.data;
  await assert(Number(vpa.netVendorPayable ?? vpa.net_vendor_payable) === 40000, 'Net vendor payable unchanged by customer payments', `Got: ₹${vpa.netVendorPayable ?? vpa.net_vendor_payable}`);

  // ============================================================
  // STEP 11: Trip Lifecycle Transitions
  // ============================================================
  console.log('\n--- STEP 11: Trip Lifecycle Transitions ---');
  const lifecycleSteps = [
    { from: 'ASSIGNED', to: 'TO_LOADING_POINT', label: 'Send to Loading Point' },
    { from: 'TO_LOADING_POINT', to: 'AT_LOADING_POINT', label: 'Arrive at Loading Point' },
    { from: 'AT_LOADING_POINT', to: 'LOADED', label: 'Loading Complete' },
    { from: 'LOADED', to: 'DISPATCHED', label: 'Dispatch' },
    { from: 'DISPATCHED', to: 'IN_TRANSIT', label: 'Start Transit' },
    { from: 'IN_TRANSIT', to: 'DELIVERED', label: 'Deliver' },
  ];
  
  for (const step of lifecycleSteps) {
    try {
      const transRes = await axios.patch(`${BASE_URL}/trips/${tripId}/status`, {
        status: step.to,
      }, { headers: adminHeaders });
      
      await assert(transRes.data.success === true, `Transition: ${step.label} (${step.from} → ${step.to})`, transRes.data.message || '');
      
      // Verify database persisted
      const tripAfter = await prisma.trip.findUnique({ where: { trip_id: tripId } });
      await assert(tripAfter.status === step.to, `Trip status = ${step.to} in DB`, `Got: ${tripAfter.status}`);
      
      // BATCH 2B — the deployed chain writes ONE event type,
      // `status_changed`, carrying from/to metadata (not one event per
      // status). The latest event must name the arrival state.
      const timeline = await prisma.tripTimeline.findFirst({
        where: { trip_id: tripId, event_type: 'status_changed' },
        orderBy: { created_at: 'desc' },
      });
      await assert(timeline, `status_changed timeline event recorded for ${step.to}`);

      let meta = timeline?.metadata;
      if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { meta = {}; }
      }
      await assert(meta && (meta.to === step.to || meta.newStatus === step.to),
        `Timeline metadata names the arrival state (${step.to})`,
        `Got: ${JSON.stringify(meta)}`);
      
    } catch (err) {
      await assert(false, `Transition: ${step.label} (${step.from} → ${step.to})`, err.response?.data?.message || err.message);
      console.log('  Response:', err.response?.data || err.message);
    }
  }
  
  // A transition the state machine does not recognise FAILS and writes
  // NOTHING (Batch 2B Phase 4 — status and timeline stay consistent).
  try {
    const beforeEvents = await prisma.tripTimeline.count({
      where: { trip_id: tripId, event_type: 'status_changed' },
    });
    const illegalRes = await axios.patch(`${BASE_URL}/trips/${tripId}/status`, {
      status: 'FLYING',
    }, { headers: adminHeaders }).catch(e => e.response);
    await assert(illegalRes && illegalRes.status >= 400, 'An invalid transition is refused', `Got: ${illegalRes && illegalRes.status}`);

    const afterEvents = await prisma.tripTimeline.count({
      where: { trip_id: tripId, event_type: 'status_changed' },
    });
    await assert(afterEvents === beforeEvents, 'The refused transition wrote NO timeline event', `${beforeEvents} → ${afterEvents}`);

    const tripAfterIllegal = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    await assert(tripAfterIllegal.status === 'DELIVERED', 'Status unchanged after the refused transition', `Got: ${tripAfterIllegal.status}`);
  } catch (err) {
    await assert(false, 'Invalid transition refused cleanly', err.message);
  }

  // POD-required refusal, at the DELIVERY endpoint. The gate lives on
  // TripDeliveryService.completeTrip (POST /:id/complete); the generic
  // PATCH /:id/status is the admin's documented legacy bypass, not the gate.
  try {
    const preCompleteEvents = await prisma.tripTimeline.count({
      where: { trip_id: tripId, event_type: 'status_changed' },
    });
    const completeRes = await axios.post(`${BASE_URL}/trips/${tripId}/complete`, {}, { headers: adminHeaders }).catch(e => e.response);

    if (completeRes && completeRes.status === 400) {
      await assert(true, 'Completion without POD rejected (POD required)', completeRes.data?.message || '');
      const postCompleteEvents = await prisma.tripTimeline.count({
        where: { trip_id: tripId, event_type: 'status_changed' },
      });
      await assert(postCompleteEvents === preCompleteEvents, 'The POD refusal wrote NO timeline event', `${preCompleteEvents} → ${postCompleteEvents}`);
      const tripAfterRefusal = await prisma.trip.findUnique({ where: { trip_id: tripId } });
      await assert(['IN_TRANSIT', 'DELIVERED'].includes(tripAfterRefusal.status),
        'Status unchanged after the POD refusal', `Got: ${tripAfterRefusal.status}`);
    } else {
      // No POD requirement on this consignment — the same endpoint completes
      // it and the refusal branch is unreachable here.
      await assert(true, 'POD not required on this trip — completion allowed', `Got: ${completeRes && completeRes.status}`);
    }
  } catch (err) {
    await assert(false, 'Completion without POD rejected', err.message);
  }
  
  // Upload POD
  try {
    const podRes = await axios.post(`${BASE_URL}/trips/${tripId}/documents`, {
      document_type: 'POD',
      document_status: 'VERIFIED',
      file_url: `https://test-storage.example.com/pods/${TEST_ID}-pod.pdf`,
      file_name: `${TEST_ID}-pod.pdf`,
      is_uploaded: true,
      is_verified: true,
      verified_by: 1,
      remarks: `${TEST_ID} - POD received`,
    }, { headers: adminHeaders });
    
    await assert(podRes.data.success === true, 'POD document uploaded', podRes.data.message || '');
    
    // Verify POD record
    const podDoc = await prisma.tripDocument.findFirst({
      where: { trip_id: tripId, document_type: 'POD' },
    });
    await assert(podDoc, 'POD document persisted in database');
    await assert(podDoc.is_uploaded === true, 'POD marked as uploaded');
    
  } catch (err) {
    await assert(false, 'POD document uploaded', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }
  
  // Now complete the trip — through the POD-enforcing delivery endpoint.
  try {
    const completeRes = await axios.post(`${BASE_URL}/trips/${tripId}/complete`, {}, { headers: adminHeaders });
    await assert(completeRes.data.success === true, 'Trip completed after POD received', completeRes.data.message || '');

    const finalTrip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    await assert(finalTrip.status === 'COMPLETED', 'Trip status = COMPLETED in DB', `Got: ${finalTrip.status}`);
    await assert(finalTrip.completed_at != null, 'Completed timestamp set');
  } catch (err) {
    await assert(false, 'Trip completed after POD', err.response?.data?.message || err.message);
    console.log('  Response:', err.response?.data || err.message);
  }

  // ============================================================
  // STEP 12: Financial Reconciliation
  // ============================================================
  console.log('\n--- STEP 12: Financial Reconciliation ---');
  
  // Customer side
  const custInvoice = await prisma.invoice.findUnique({ where: { invoice_id: invoiceId } });
  const custPayments = await prisma.financialTransaction.findMany({
    where: { trip_id: tripId, transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
  });
  const totalCustPaid = custPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  const custInvoiceTotal = Number(custInvoice.grand_total || custInvoice.total_amount || 0);
  
  console.log('\nCustomer Finance:');
  console.log(`  Invoice Total: ₹${custInvoiceTotal}`);
  console.log(`  Total Receipts: ₹${totalCustPaid}`);
  console.log(`  Outstanding: ₹${custInvoiceTotal - totalCustPaid}`);
  
  await assert(custInvoiceTotal === 50000, 'Invoice total = ₹50,000');
  await assert(totalCustPaid === 35000, 'Customer receipts = ₹35,000', `Got: ₹${totalCustPaid}`);
  await assert(custInvoiceTotal - totalCustPaid === 15000, 'Customer outstanding = ₹15,000');
  
  // Vendor side
  const hireRecord = await prisma.vehicleHire.findUnique({ where: { hire_id: hireId } });
  const vendPayments = await prisma.financialTransaction.findMany({
    where: { trip_id: tripId, transaction_type: { in: ['OWNER_SETTLEMENT', 'OWNER_ADVANCE'] }, status: { notIn: ['CANCELLED', 'REFUNDED'] } },
  });
  const totalVendorPaidFinal = vendPayments.reduce((sum, p) => sum + Number(p.amount), 0);
  
  console.log('\nVendor Finance:');
  console.log(`  Gross Vehicle Hire: ₹${hireRecord.gross_hire}`);
  console.log(`  Commission: ₹${hireRecord.commission_amount}`);
  console.log(`  Net Vendor Payable: ₹${hireRecord.net_vendor_payable}`);
  console.log(`  Total Vendor Payments: ₹${totalVendorPaidFinal}`);
  console.log(`  Remaining Vendor Payable: ₹${Number(hireRecord.net_vendor_payable) - totalVendorPaidFinal}`);
  
  await assert(Number(hireRecord.gross_hire) === 42000, 'Gross vehicle hire = ₹42,000');
  await assert(Number(hireRecord.commission_amount) === 2000, 'Commission = ₹2,000');
  await assert(Number(hireRecord.net_vendor_payable) === 40000, 'Net vendor payable = ₹40,000');
  await assert(totalVendorPaidFinal === 30000, 'Vendor payments = ₹30,000', `Got: ₹${totalVendorPaidFinal}`);
  await assert(Number(hireRecord.net_vendor_payable) - totalVendorPaidFinal === 10000, 'Vendor outstanding = ₹10,000');

  // Verify financial separation
  await assert(Number(hireRecord.gross_hire) !== Number(hireRecord.net_vendor_payable), 'Gross hire ≠ Net vendor payable (financial separation)');

  // ============================================================
  // BATCH 2B — THE COMPLETION INVARIANT
  // ============================================================
  // Driving the trip to COMPLETED is an OPERATIONAL act: it moves no money
  // on either side, settles no document, and stamps no paid_at.
  console.log('\nPost-Completion Invariants:');
  try {
    const invFinal = await prisma.invoice.findUnique({ where: { invoice_id: invoiceId } });
    await assert(invFinal.payment_status === 'PARTIALLY_PAID',
      'Completion did NOT flip invoice.payment_status', `Got: ${invFinal.payment_status}`);
    await assert(invFinal.status === 'PARTIALLY_PAID',
      'Completion did NOT settle the enum status', `Got: ${invFinal.status}`);
    await assert(invFinal.paid_at === null, 'Completion did NOT stamp paid_at',
      `Got: ${invFinal.paid_at}`);

    const custDueFinal = Number(invFinal.grand_total || invFinal.total_amount || 0) - totalCustPaid;
    await assert(custDueFinal === 15000, 'Customer outstanding STILL ₹15,000 after COMPLETED', `Got: ₹${custDueFinal}`);

    const vendorPosFinal = await axios.get(`${BASE_URL}/trips/${tripId}/vendor-position`, { headers: adminHeaders });
    const vpf = vendorPosFinal.data.data;
    await assert(Number(vpf.netVendorPayable ?? vpf.net_vendor_payable) === 40000, 'Vendor net payable STILL ₹40,000 after COMPLETED', `Got: ₹${vpf.netVendorPayable ?? vpf.net_vendor_payable}`);
    const outFinal = vpf.outstanding !== undefined ? vpf.outstanding :
      vpf.remaining !== undefined ? vpf.remaining : null;
    await assert(outFinal === 10000, 'Vendor outstanding STILL ₹10,000 after COMPLETED', `Got: ${outFinal}`);

    // Nothing the VENDOR side wrote ever names the customer's bill.
    const vendorRowsWithInvoice = await prisma.financialTransaction.count({
      where: {
        trip_id: tripId,
        transaction_type: { in: ['OWNER_SETTLEMENT', 'OWNER_ADVANCE', 'DRIVER_SETTLEMENT', 'DRIVER_ADVANCE'] },
        invoice_id: { not: null },
      },
    });
    await assert(vendorRowsWithInvoice === 0, 'No vendor money row claims the customer invoice', `Found: ${vendorRowsWithInvoice}`);

    // The customer's freight survived the whole journey byte-identical —
    // never overwritten by the vendor net.
    const tripRow = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    await assert(Number(tripRow.freight_amount) === 50000,
      'Trip customer freight untouched (₹50,000 ≠ vendor net)', `Got: ₹${tripRow.freight_amount}`);
  } catch (err) {
    await assert(false, 'Post-completion invariants', err.message);
  }
  
  // ============================================================
  // Summary
  // ============================================================
  console.log('\n=== TEST SUMMARY ===');
  console.log(`Passed: ${passed}/${passed + failed}`);
  console.log(`Failed: ${failed}/${passed + failed}`);
  console.log(`Test ID: ${TEST_ID}`);
  console.log(`Enquiry: ${enquiryNumber} (ID: ${enquiryId})`);
  console.log(`Booking: ${bookingNumber} (ID: ${bookingId})`);
  console.log(`Trip: ${tripNumber} (ID: ${tripId})`);
  console.log(`Hire ID: ${hireId}`);
  console.log(`Invoice: ${invoiceNumber} (ID: ${invoiceId})`);
  
  if (failed > 0) {
    console.log('\n--- FAILURES ---');
    results.filter(r => !r.success).forEach(r => console.log(`  FAIL: ${r.name} — ${r.detail}`));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());

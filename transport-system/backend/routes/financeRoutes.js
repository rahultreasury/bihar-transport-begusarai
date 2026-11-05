/**
 * financeRoutes
 * ---------------------------------------------------------------------------
 * HTTP surface for the Finance module. Mounted at `/api/admin/finance`.
 *
 * READ   every authenticated admin/operator may look at money.
 * WRITE  `FinancePostingService` independently requires admin/super_admin,
 *        so an operator who calls a POST gets a 403 even though `adminOnly`
 *        (which also admits operators) let the request reach the handler.
 *
 * RESPONSE SHAPE
 *   { success: true, data: … }
 *   Errors keep the project convention: { success: false, message } with the
 *   service's status code.
 */

const express = require('express');
const router = express.Router();
const { protect, adminOnly } = require('../middleware/auth');
const FinanceReportingService = require('../services/FinanceReportingService');
const FinancePostingService = require('../services/FinancePostingService');
const FinanceReconciliationService = require('../services/FinanceReconciliationService');

const reporting = new FinanceReportingService();
const posting = new FinancePostingService();
const reconciliation = new FinanceReconciliationService();

function fail(res, error, label) {
  console.error(`${label}:`, error);
  const status = error.statusCode || 500;
  return res.status(status).json({
    success: false,
    message: error.message || 'Server error',
    errorCode: error.errorCode || undefined,
    details: Array.isArray(error.details) && error.details.length ? error.details : undefined,
  });
}

const read = (handler, label) => async (req, res) => {
  try {
    return res.json({ success: true, data: await handler(req) });
  } catch (error) {
    return fail(res, error, label);
  }
};

const write = (handler, label) => async (req, res) => {
  try {
    return res.status(201).json({ success: true, data: await handler(req) });
  } catch (error) {
    return fail(res, error, label);
  }
};

// Every route requires an authenticated admin-area user.
router.use(protect, adminOnly);

// ===========================================================================
// LOOKUPS
// ===========================================================================

router.get('/lookups', read(async (req) => {
  const [vendors, clients, pumps, openInvoices, trips] = await Promise.all([
    reporting.prisma.vehicleOwner.findMany({
      where: { is_active: true },
      select: { owner_id: true, owner_name: true, company_name: true, mobile: true, city: true },
      orderBy: [{ company_name: 'asc' }, { owner_name: 'asc' }],
      take: 500,
    }),
    reporting.prisma.client.findMany({
      where: { is_active: true },
      select: { client_id: true, company_name: true, contact_person: true, phone: true },
      orderBy: { company_name: 'asc' },
      take: 500,
    }),
    reporting.prisma.petrolPump.findMany({
      where: { is_active: true },
      select: { pump_id: true, pump_name: true, pump_code: true, city: true, current_balance: true, credit_limit: true },
      orderBy: { pump_name: 'asc' },
      take: 500,
    }),
    reporting.prisma.invoice.findMany({
      where: { status: { notIn: ['CANCELLED', 'PAID'] } },
      select: {
        invoice_id: true,
        invoice_number: true,
        grand_total: true,
        total_amount: true,
        final_price: true,
        due_at: true,
        booking_id: true,
        trip_id: true,
        booking: { select: { booking_number: true, user: { select: { first_name: true, last_name: true } } } },
        trips: { select: { trip_number: true, client: { select: { company_name: true } } } },
      },
      orderBy: { created_at: 'desc' },
      take: 500,
    }),
    reporting.prisma.trip.findMany({
      where: { status: { notIn: ['CANCELLED', 'COMPLETED'] } },
      select: {
        trip_id: true,
        trip_number: true,
        pickup_city: true,
        freight_amount: true,
        transport_owner_id: true,
        booking_id: true,
        transportOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
        client: { select: { company_name: true } },
      },
      orderBy: { trip_id: 'desc' },
      take: 300,
    }),
  ]);

  return {
    vendors: vendors.map((v) => ({
      vendor_id: v.owner_id,
      name: v.company_name || v.owner_name,
      mobile: v.mobile,
      city: v.city,
    })),
    clients,
    pumps,
    invoices: openInvoices.map((i) => {
      const user = i.booking?.user;
      return {
        invoice_id: i.invoice_id,
        invoice_number: i.invoice_number,
        invoice_total: Number(i.grand_total ?? i.total_amount ?? i.final_price ?? 0),
        due_at: i.due_at,
        booking_id: i.booking_id,
        booking_number: i.booking?.booking_number || null,
        trip_id: i.trip_id,
        trip_number: i.trips?.trip_number || null,
        customer_name:
          i.trips?.client?.company_name ||
          (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Customer'),
      };
    }),
    trips: trips.map((t) => ({
      trip_id: t.trip_id,
      trip_number: t.trip_number,
      branch: t.pickup_city,
      freight_amount: Number(t.freight_amount || 0),
      vendor_id: t.transport_owner_id,
      vendor_name: t.transportOwner?.company_name || t.transportOwner?.owner_name || null,
      booking_id: t.booking_id,
      customer_name: t.client?.company_name || null,
    })),
  };
}, 'Finance lookups'));

// ===========================================================================
// READ ENDPOINTS
// ===========================================================================

router.get('/overview', read((req) => reporting.getOverview(req.query), 'Finance overview'));
router.get('/branches', read(() => reporting.getBranches(), 'Finance branches'));
router.get('/shipment-summary', read((req) => reporting.getShipmentSummary(req.query), 'Finance shipment summary'));
router.get('/reconciliation', read((req) => reconciliation.run(req.query), 'Finance reconciliation'));

router.get('/receivables', read((req) => reporting.getReceivables(req.query), 'Finance receivables'));
router.get('/client-due', read((req) => reporting.getClientDue(req.query), 'Finance client due'));

router.get('/payables', read((req) => reporting.getProviderPayables(req.query), 'Finance payables'));
router.get('/vendor-ledger/:vendorId', read(
  (req) => reporting.getVendorLedger(req.params.vendorId, req.query),
  'Finance vendor ledger',
));

router.get('/payments-received', read((req) => reporting.getPaymentsReceived(req.query), 'Finance receipts'));
router.get('/advances', read((req) => reporting.getAdvances(req.query), 'Finance advances'));
router.get('/commission', read((req) => reporting.getCommission(req.query), 'Finance commission'));
router.get('/settlements', read((req) => reporting.getSettlements(req.query), 'Finance settlements'));

router.get('/petrol-pumps', read((req) => reporting.getPetrolPump(req.query), 'Finance petrol pumps'));
router.get('/petrol-pumps/:pumpId/ledger', read(
  (req) => reporting.getPumpLedger(req.params.pumpId, req.query),
  'Finance pump ledger',
));

router.get('/transactions', read((req) => reporting.getTransactions(req.query), 'Finance transactions'));
router.get('/transactions/:id', read(
  async (req) => {
    const detail = await reporting.getTransactionDetail(req.params.id, String(req.query.kind || 'TRANSACTION').toUpperCase());
    if (!detail) {
      const error = new Error('Transaction not found');
      error.statusCode = 404;
      throw error;
    }
    return detail;
  },
  'Finance transaction detail',
));

router.get('/opening-balances', read((req) => posting.getOpeningBalances(req.query), 'Finance opening balances'));

router.get('/export/:section', read(
  (req) => reporting.exportSection(req.params.section, req.query),
  'Finance export',
));

// ===========================================================================
// WRITE ENDPOINTS
// ===========================================================================

router.post('/receipts', write((req) => posting.recordCustomerReceipt(req.body || {}, req.user), 'Post customer receipt'));
router.post('/vendor-payments', write((req) => posting.recordVendorPayment(req.body || {}, req.user), 'Post vendor payment'));
router.post('/commission-receipts', write((req) => posting.recordCommissionReceipt(req.body || {}, req.user), 'Post commission receipt'));

router.post('/advances', write((req) => posting.createAdvance(req.body || {}, req.user), 'Post advance'));
router.post('/advances/:advanceId/adjust', write(
  (req) => posting.adjustAdvance(req.params.advanceId, req.body || {}, req.user),
  'Adjust advance',
));

router.post('/settlements', write((req) => posting.createSettlement(req.body || {}, req.user), 'Post settlement'));

router.post('/petrol-pumps', write((req) => posting.createPump(req.body || {}, req.user), 'Create petrol pump'));
router.post('/petrol-pumps/fuel', write((req) => posting.recordFuel(req.body || {}, req.user), 'Post fuel transaction'));
router.post('/petrol-pumps/bills', write((req) => posting.createPumpBill(req.body || {}, req.user), 'Create pump bill'));
router.post('/petrol-pumps/payments', write((req) => posting.payPump(req.body || {}, req.user), 'Pay petrol pump'));

router.post('/opening-balances', write((req) => posting.setOpeningBalance(req.body || {}, req.user), 'Set opening balance'));

router.post('/transactions/:id/reverse', write(
  (req) => posting.reverseTransaction(req.params.id, req.body || {}, req.user),
  'Reverse transaction',
));

module.exports = router;
module.exports.reporting = reporting;
module.exports.posting = posting;

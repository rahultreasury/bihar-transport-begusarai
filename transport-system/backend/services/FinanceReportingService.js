/**
 * FinanceReportingService
 * ---------------------------------------------------------------------------
 * THE READ SIDE OF THE FINANCE MODULE.
 *
 * ONE SOURCE OF TRUTH PER QUESTION
 *   Customer money   → Invoice + FinancialTransaction (customer receipts)
 *   Vendor money     → VehicleHire (gross/commission/net) + FinancialTransaction
 *   Advances         → TripAdvance (+ adjustment columns)
 *   Settlements      → FinancialTransaction ADJUSTMENT legs (non-cash)
 *   Commission       → VehicleHire.commission_amount (the Phase 2 calculator's
 *                      stored output) + explicit COMMISSION receipts
 *   Petrol pump      → PetrolPump* tables maintained by PetrolPumpRepository
 *   Opening balances → PartyOpeningBalance
 *
 * Two different time semantics are deliberately kept apart:
 *
 *   POSITION  (receivables, payables, advances, pump outstanding, commission)
 *             = opening balance + every posted row with a date ON OR BEFORE
 *               the selected end date. The start date does not remove history.
 *
 *   MOVEMENT  (total received, net cash movement, cash-flow chart)
 *             = rows whose date falls INSIDE the selected range.
 *
 * Mixing the two is the classic finance-dashboard bug: a "receivable" that
 * silently excludes an invoice raised last month because it is outside this
 * month's range, or a cash-flow figure that includes a non-cash settlement.
 * Both are avoided here by construction.
 *
 * BRANCH
 *   The repository has no Branch model. The operating location that every
 *   Trip and Booking already carries is `pickup_city`, so that is the branch
 *   dimension. Rows that cannot be attributed to a pickup city (a pump
 *   payment with no trip) are included only when the filter is "All
 *   branches"; this is surfaced in the API response rather than guessed.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const money = require('./finance/money');
const {
  roundMoney,
  num,
  parseDate,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  addDays,
  addMonths,
  monthKey,
  monthLabel,
  parseMetadata,
  isCashMethod,
  methodLabel,
  invoiceTotal,
  invoiceCustomerName,
  defaultRange,
} = require('./finance/financeUtils');

const CUSTOMER_RECEIPT_TYPES = ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'];
const VENDOR_PAYMENT_TYPES = ['OWNER_ADVANCE', 'OWNER_SETTLEMENT'];
const CASH_OUT_TYPES = ['OWNER_ADVANCE', 'DRIVER_ADVANCE', 'FUEL_ADVANCE', 'OWNER_SETTLEMENT', 'DRIVER_SETTLEMENT', 'TRIP_EXPENSE'];
const SETTLEMENT_KINDS = new Set(['VENDOR_SETTLEMENT', 'CUSTOMER_SETTLEMENT']);

const TRANSACTION_LABELS = Object.freeze({
  CUSTOMER_PAYMENT: 'Customer Receipt',
  CLIENT_PAYMENT: 'Client Receipt',
  OWNER_ADVANCE: 'Vendor Payment',
  DRIVER_ADVANCE: 'Driver Advance',
  FUEL_ADVANCE: 'Fuel Advance',
  OWNER_SETTLEMENT: 'Vendor Settlement',
  DRIVER_SETTLEMENT: 'Driver Settlement',
  COMMISSION: 'Commission',
  ADJUSTMENT: 'Adjustment',
  REFUND: 'Refund',
  TRIP_EXPENSE: 'Trip Expense',
  EXPENSE_REIMBURSEMENT: 'Expense Reimbursement',
  REVERSAL: 'Reversal',
});

const MAX_SCAN = 5000;

function pctChange(current, previous) {
  const c = num(current);
  const p = num(previous);
  if (p === 0) return c === 0 ? 0 : null;
  return roundMoney(((c - p) / Math.abs(p)) * 100);
}

function dateLabel(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

class FinanceReportingService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
  }

  // =========================================================================
  // FILTERS
  // =========================================================================

  /**
   * Normalise the query string into a single filter object every public
   * method understands.
   */
  normalizeFilters(raw = {}) {
    const now = new Date();
    const fallback = defaultRange(now);

    // Accept both the HTTP query names and an already-normalised filter
    // object (internal callers pass `dateFrom`/`dateTo` Dates).
    let dateFrom = parseDate(raw.date_from || raw.from || raw.dateFrom) || fallback.from;
    let dateTo = parseDate(raw.date_to || raw.to || raw.dateTo) || fallback.to;
    dateFrom = startOfDay(dateFrom);
    dateTo = endOfDay(dateTo);
    if (dateFrom.getTime() > dateTo.getTime()) {
      const swap = dateFrom;
      dateFrom = startOfDay(dateTo);
      dateTo = endOfDay(swap);
    }

    const page = Math.max(1, parseInt(raw.page, 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(raw.limit, 10) || 25));

    return {
      dateFrom,
      dateTo,
      branch: raw.branch && String(raw.branch).trim() ? String(raw.branch).trim() : null,
      search: raw.search ? String(raw.search).trim() : '',
      status: raw.status ? String(raw.status).toUpperCase() : null,
      type: raw.type ? String(raw.type).toUpperCase() : null,
      mode: raw.mode ? String(raw.mode).toUpperCase() : null,
      page,
      limit,
      sort: raw.sort || null,
    };
  }

  /** Previous equivalent period: same duration immediately before `dateFrom`. */
  previousPeriod(filters) {
    const duration = filters.dateTo.getTime() - filters.dateFrom.getTime();
    const prevTo = new Date(filters.dateFrom.getTime() - 1);
    const prevFrom = new Date(prevTo.getTime() - duration);
    return {
      ...filters,
      dateFrom: startOfDay(prevFrom),
      dateTo: endOfDay(prevTo),
      page: 1,
      limit: filters.limit,
    };
  }

  // =========================================================================
  // QUERY PRIMITIVES
  // =========================================================================

  _branchTx(branch) {
    if (!branch) return null;
    return {
      OR: [
        { trip: { is: { pickup_city: branch } } },
        { booking: { is: { pickup_city: branch } } },
      ],
    };
  }

  _branchInvoice(branch) {
    if (!branch) return null;
    return {
      OR: [
        { trips: { is: { pickup_city: branch } } },
        { booking: { is: { pickup_city: branch } } },
      ],
    };
  }

  _branchHire(branch) {
    if (!branch) return null;
    return { trip: { is: { pickup_city: branch } } };
  }

  _branchAdvance(branch) {
    if (!branch) return null;
    return {
      OR: [
        { trip: { is: { pickup_city: branch } } },
        { booking: { is: { pickup_city: branch } } },
      ],
    };
  }

  /** Date window on a nullable timestamp column with a created_at fallback. */
  _asOf(date, field = 'transaction_date') {
    return {
      OR: [
        { [field]: { lte: date } },
        { AND: [{ [field]: null }, { created_at: { lte: date } }] },
      ],
    };
  }

  _within(from, to, field = 'transaction_date') {
    return {
      OR: [
        { [field]: { gte: from, lte: to } },
        {
          AND: [
            { [field]: null },
            { created_at: { gte: from, lte: to } },
          ],
        },
      ],
    };
  }

  async _searchPartyIds(search) {
    if (!search) return { vendors: [], clients: [], users: [] };
    const like = { contains: search, mode: 'insensitive' };
    const [vendors, clients, users] = await Promise.all([
      this.prisma.vehicleOwner.findMany({
        where: { OR: [{ owner_name: like }, { company_name: like }, { mobile: like }] },
        select: { owner_id: true },
        take: 100,
      }),
      this.prisma.client.findMany({
        where: { OR: [{ company_name: like }, { contact_person: like }, { phone: like }] },
        select: { client_id: true },
        take: 100,
      }),
      this.prisma.user.findMany({
        where: { OR: [{ first_name: like }, { last_name: like }, { phone: like }] },
        select: { user_id: true },
        take: 100,
      }),
    ]);
    return {
      vendors: vendors.map((v) => v.owner_id),
      clients: clients.map((c) => c.client_id),
      users: users.map((u) => u.user_id),
    };
  }

  // =========================================================================
  // RECEIVABLES
  // =========================================================================

  /**
   * Every invoice up to the end date, with customer receipts allocated to it.
   *
   * ALLOCATION
   *   1. A receipt explicitly stamped with `invoice_id` belongs to that bill.
   *   2. A receipt with no invoice but a trip/booking belongs to the oldest
   *      unpaid bill of the same trip, then the same booking (FIFO). This is
   *      what stops an unallocated payment from being counted twice — once as
   *      a receipt and once as an outstanding invoice.
   */
  async _loadReceivables(filters) {
    const { dateTo } = filters;
    const and = [{ created_at: { lte: dateTo } }];
    const branch = this._branchInvoice(filters.branch);
    if (branch) and.push(branch);

    const [invoices, payments, openings, unbilledTrips] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { AND: [{ status: { not: 'CANCELLED' } }, ...and] },
        select: {
          invoice_id: true,
          invoice_number: true,
          booking_id: true,
          trip_id: true,
          final_price: true,
          total_amount: true,
          grand_total: true,
          taxable_amount: true,
          tax_amount: true,
          cgst: true,
          sgst: true,
          igst: true,
          status: true,
          payment_status: true,
          created_at: true,
          issued_at: true,
          invoice_date: true,
          due_at: true,
          paid_at: true,
          gst_type: true,
          gst_percentage: true,
          booking: {
            select: {
              booking_id: true,
              booking_number: true,
              pickup_city: true,
              pickup_date: true,
              user: { select: { user_id: true, first_name: true, last_name: true, phone: true } },
            },
          },
          trips: {
            select: {
              trip_id: true,
              trip_number: true,
              pickup_city: true,
              client_id: true,
              client: { select: { client_id: true, company_name: true, contact_person: true, phone: true } },
            },
          },
        },
        orderBy: [{ created_at: 'desc' }, { invoice_id: 'desc' }],
      }),
      this.prisma.financialTransaction.findMany({
        where: {
          AND: [
            { status: { not: 'CANCELLED' } },
            this._asOfFilters(dateTo),
            ...(branch ? [branch] : []),
            {
              OR: [
                { transaction_type: { in: CUSTOMER_RECEIPT_TYPES } },
                { transaction_type: 'REFUND' },
                { transaction_type: 'ADJUSTMENT' },
                { AND: [{ transaction_type: 'REVERSAL' }, { invoice_id: { not: null } }] },
              ],
            },
          ],
        },
        select: {
          transaction_id: true,
          voucher_number: true,
          invoice_id: true,
          trip_id: true,
          booking_id: true,
          transaction_type: true,
          amount: true,
          direction: true,
          payment_method: true,
          reference_number: true,
          transaction_date: true,
          created_at: true,
          status: true,
          metadata: true,
          notes: true,
        },
      }),
      this.prisma.partyOpeningBalance.findMany({
        where: { party_type: 'CUSTOMER', as_of_date: { lte: dateTo } },
        select: { party_id: true, amount: true },
      }),
      this.prisma.trip.findMany({
        where: {
          AND: [
            { status: { notIn: ['CANCELLED'] } },
            { freight_amount: { gt: 0 } },
            { created_at: { lte: dateTo } },
            ...(filters.branch ? [{ pickup_city: filters.branch }] : []),
            {
              OR: [
                { AND: [{ booking_id: null }, { invoices: { none: {} } }] },
                { AND: [{ invoices: { none: {} } }, { booking: { is: { invoices: { is: null } } } }] },
              ],
            },
          ],
        },
        select: {
          trip_id: true,
          trip_number: true,
          freight_amount: true,
          pickup_city: true,
          status: true,
          created_at: true,
          trip_date: true,
          booking: { select: { booking_id: true, booking_number: true } },
          client: { select: { client_id: true, company_name: true } },
        },
        orderBy: [{ trip_date: 'desc' }, { trip_id: 'desc' }],
      }),
    ]);

    // ---- allocate receipts ------------------------------------------------
    const byInvoice = new Map();
    const unallocated = [];
    for (const p of payments) {
      const meta = parseMetadata(p.metadata);
      // A customer advance is cash received but NOT yet applied to a bill, so
      // it must not reduce receivables until an adjustment says it does.
      if (p.transaction_type === 'CUSTOMER_PAYMENT' && meta.kind === 'CUSTOMER_ADVANCE') continue;
      if (['CLIENT_PAYMENT'].includes(p.transaction_type) && meta.kind === 'CUSTOMER_ADVANCE') continue;
      const isCreditNote = p.transaction_type === 'ADJUSTMENT'
        && (meta.kind === 'CUSTOMER_SETTLEMENT' || meta.kind === 'CUSTOMER_ADVANCE_ADJUSTMENT');
      if (p.transaction_type === 'ADJUSTMENT' && !isCreditNote) continue;
      const signed = p.direction === 'CREDIT'
        ? money.fromPaise(money.toPaise(p.amount))
        : money.fromPaise(-money.toPaise(p.amount));
      const entry = { ...p, meta, signed };
      if (p.invoice_id) {
        const list = byInvoice.get(p.invoice_id) || [];
        list.push(entry);
        byInvoice.set(p.invoice_id, list);
      } else {
        unallocated.push(entry);
      }
    }

    const invoiceById = new Map(invoices.map((i) => [i.invoice_id, i]));
    const receivedByInvoice = new Map();
    for (const [invoiceId, list] of byInvoice.entries()) {
      if (invoiceById.has(invoiceId)) {
        receivedByInvoice.set(invoiceId, money.fromPaise(list.reduce((s, p) => s + money.toPaise(p.signed), 0)));
      }
    }

    // FIFO unallocated receipts onto the same trip / booking.
    const byTrip = new Map();
    const byBooking = new Map();
    for (const inv of invoices) {
      const total = invoiceTotal(inv);
      const already = receivedByInvoice.get(inv.invoice_id) || 0;
      const open = money.fromPaise(Math.max(0, money.toPaise(total) - money.toPaise(already)));
      if (inv.trip_id) {
        if (!byTrip.has(inv.trip_id)) byTrip.set(inv.trip_id, []);
        byTrip.get(inv.trip_id).push({ inv, open });
      }
      if (inv.booking_id) {
        if (!byBooking.has(inv.booking_id)) byBooking.set(inv.booking_id, []);
        byBooking.get(inv.booking_id).push({ inv, open });
      }
    }
    for (const list of [...byTrip.values(), ...byBooking.values()]) {
      list.sort((a, b) => new Date(a.inv.created_at) - new Date(b.inv.created_at));
    }

    for (const p of unallocated) {
      let remaining = p.signed;
      if (remaining === 0) continue;
      const buckets = [];
      if (p.trip_id && byTrip.has(p.trip_id)) buckets.push(...byTrip.get(p.trip_id));
      if (remaining > 0 && p.booking_id && byBooking.has(p.booking_id)) buckets.push(...byBooking.get(p.booking_id));

      for (const bucket of buckets) {
        if (remaining <= 0) break;
        const current = receivedByInvoice.get(bucket.inv.invoice_id) || 0;
        const open = money.fromPaise(Math.max(0, money.toPaise(invoiceTotal(bucket.inv)) - money.toPaise(current)));
        if (open <= 0) continue;
        const applied = Math.min(open, remaining);
        receivedByInvoice.set(bucket.inv.invoice_id, money.add(current, applied));
        remaining = money.sub(remaining, applied);
      }
    }

    // ---- rows -------------------------------------------------------------
    const now = new Date();
    const rows = invoices.map((inv) => {
      const total = invoiceTotal(inv);
      const received = money.fromPaise(money.toPaise(receivedByInvoice.get(inv.invoice_id) || 0));
      const applied = Math.min(Math.max(received, 0), total);
      const outstanding = money.max(0, money.sub(total, received));
      const dueAt = inv.due_at ? new Date(inv.due_at) : null;
      const overdueDays = dueAt && outstanding > 0 && dueAt < now
        ? Math.max(1, Math.floor((now - dueAt) / 86400000))
        : 0;

      let status;
      if (outstanding <= 0) status = 'PAID';
      else if (received > 0) status = 'PARTIALLY_PAID';
      else if (overdueDays > 0) status = 'OVERDUE';
      else status = 'UNPAID';

      const invoiceDate = inv.invoice_date || inv.issued_at || inv.created_at;
      return {
        invoice_id: inv.invoice_id,
        invoice_number: inv.invoice_number,
        invoice_date: dateLabel(invoiceDate),
        due_date: dateLabel(dueAt),
        booking_id: inv.booking_id,
        booking_number: inv.booking?.booking_number || null,
        trip_id: inv.trip_id || inv.trips?.trip_id || null,
        trip_number: inv.trips?.trip_number || null,
        customer_id: inv.trips?.client?.client_id || inv.booking?.user?.user_id || null,
        customer_name: invoiceCustomerName(inv),
        customer_phone: inv.trips?.client?.phone || inv.booking?.user?.phone || null,
        branch: inv.trips?.pickup_city || inv.booking?.pickup_city || null,
        taxable_amount: roundMoney(num(inv.taxable_amount) || num(inv.total_amount) || num(inv.final_price)),
        tax_amount: roundMoney(num(inv.tax_amount) || num(inv.cgst) + num(inv.sgst) + num(inv.igst)),
        gst_type: inv.gst_type || null,
        gst_percentage: inv.gst_percentage === null ? null : num(inv.gst_percentage),
        total_amount: total,
        received,
        applied,
        outstanding,
        overpaid: roundMoney(Math.max(0, received - total)),
        overdue_days: overdueDays,
        status,
        payment_status: inv.payment_status || (outstanding <= 0 ? 'PAID' : received > 0 ? 'PARTIALLY_PAID' : 'UNPAID'),
        db_status: inv.status,
      };
    });

    const openingTotal = roundMoney(openings.reduce((s, o) => s + num(o.amount), 0));
    const billed = roundMoney(rows.reduce((s, r) => s + r.total_amount, 0));
    const received = roundMoney(rows.reduce((s, r) => s + r.applied, 0));
    const outstanding = roundMoney(rows.reduce((s, r) => s + r.outstanding, 0));
    const overdue = roundMoney(rows.filter((r) => r.overdue_days > 0).reduce((s, r) => s + r.outstanding, 0));
    const paidCount = rows.filter((r) => r.outstanding <= 0).length;
    const openCount = rows.filter((r) => r.outstanding > 0).length;

    const unbilledValue = roundMoney(unbilledTrips.reduce((s, t) => s + num(t.freight_amount), 0));
    const unbilledRows = unbilledTrips.map((t) => ({
      trip_id: t.trip_id,
      trip_number: t.trip_number,
      booking_id: t.booking?.booking_id || null,
      booking_number: t.booking?.booking_number || null,
      customer_name: t.client?.company_name || '—',
      branch: t.pickup_city,
      trip_status: t.status,
      trip_date: dateLabel(t.trip_date || t.created_at),
      freight_amount: roundMoney(num(t.freight_amount)),
    }));

    return {
      rows,
      unbilled: unbilledRows,
      totals: {
        billed,
        received,
        outstanding: roundMoney(Math.max(0, outstanding + openingTotal)),
        overdue,
        opening: openingTotal,
        paidCount,
        openCount,
        invoiceCount: rows.length,
        unbilled: unbilledValue,
        unbilledCount: unbilledRows.length,
      },
    };
  }

  _asOfFilters(date) {
    return this._asOf(date);
  }

  async getReceivables(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadReceivables(filters);

    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.invoice_number, r.customer_name, r.customer_phone, r.booking_number, r.trip_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.status) {
      if (filters.status === 'DUE' || filters.status === 'OUTSTANDING') rows = rows.filter((r) => r.outstanding > 0);
      else if (filters.status === 'OVERDUE') rows = rows.filter((r) => r.overdue_days > 0);
      else if (filters.status === 'PAID') rows = rows.filter((r) => r.outstanding <= 0);
      else if (filters.status === 'PARTIAL' || filters.status === 'PARTIALLY_PAID') rows = rows.filter((r) => r.received > 0 && r.outstanding > 0);
      else if (filters.status === 'UNPAID') rows = rows.filter((r) => r.received <= 0 && r.outstanding > 0);
    }

    if (filters.sort === 'OUTSTANDING_ASC') rows = [...rows].sort((a, b) => a.outstanding - b.outstanding);
    else if (filters.sort === 'OUTSTANDING_DESC') rows = [...rows].sort((a, b) => b.outstanding - a.outstanding);
    else if (filters.sort === 'DUE_DATE') rows = [...rows].sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));

    return this._paginate(rows, filters, {
      summary: data.totals,
      unbilled: data.unbilled.slice(0, 25),
      unbilledSummary: { value: data.totals.unbilled, count: data.totals.unbilledCount },
      as_of: dateLabel(filters.dateTo),
    });
  }

  async getClientDue(rawFilters = {}) {
    const filters = this.normalizeFilters({ ...rawFilters, status: rawFilters.status || 'DUE' });
    const data = await this._loadReceivables(filters);
    let rows = data.rows.filter((r) => r.outstanding > 0);
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.invoice_number, r.customer_name, r.booking_number, r.trip_number].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }

    const buckets = { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, noDueDate: 0 };
    for (const r of rows) {
      if (!r.due_date) buckets.noDueDate = roundMoney(buckets.noDueDate + r.outstanding);
      else if (r.overdue_days <= 0) buckets.current = roundMoney(buckets.current + r.outstanding);
      else if (r.overdue_days <= 30) buckets.days1to30 = roundMoney(buckets.days1to30 + r.outstanding);
      else if (r.overdue_days <= 60) buckets.days31to60 = roundMoney(buckets.days31to60 + r.outstanding);
      else if (r.overdue_days <= 90) buckets.days61to90 = roundMoney(buckets.days61to90 + r.outstanding);
      else buckets.days90plus = roundMoney(buckets.days90plus + r.outstanding);
    }

    rows = [...rows].sort((a, b) => b.overdue_days - a.overdue_days || b.outstanding - a.outstanding);
    return this._paginate(rows, filters, {
      summary: {
        outstanding: roundMoney(rows.reduce((s, r) => s + r.outstanding, 0)),
        overdue: roundMoney(rows.filter((r) => r.overdue_days > 0).reduce((s, r) => s + r.outstanding, 0)),
        count: rows.length,
        aging: buckets,
      },
      as_of: dateLabel(filters.dateTo),
    });
  }

  // =========================================================================
  // VENDOR PAYABLES
  // =========================================================================

  async _loadVendorData(filters) {
    const { dateTo } = filters;
    const hireAnd = [{ status: { notIn: ['CANCELLED', 'CANCELED'] } }, { created_at: { lte: dateTo } }];
    const branch = this._branchHire(filters.branch);
    if (branch) hireAnd.push(branch);

    const txAnd = [
      { transport_owner_id: { not: null } },
      { status: { not: 'CANCELLED' } },
      this._asOf(dateTo),
    ];
    const txBranch = this._branchTx(filters.branch);
    if (txBranch) txAnd.push(txBranch);

    const [hires, transactions, openings] = await Promise.all([
      this.prisma.vehicleHire.findMany({
        where: { AND: hireAnd },
        select: {
          hire_id: true,
          trip_id: true,
          booking_id: true,
          vendor_id: true,
          vehicle_id: true,
          driver_id: true,
          business_model: true,
          billing_to: true,
          rate_basis: true,
          rate_value: true,
          rate_quantity: true,
          rate_unit: true,
          gross_hire: true,
          commission_type: true,
          commission_rate: true,
          commission_amount: true,
          net_vendor_payable: true,
          status: true,
          created_at: true,
          remarks: true,
          vendor: {
            select: { owner_id: true, owner_name: true, company_name: true, mobile: true, city: true, bank_name: true, bank_account: true },
          },
          vehicle: { select: { vehicle_id: true, vehicle_number: true, vehicle_type: true } },
          trip: {
            select: {
              trip_id: true,
              trip_number: true,
              pickup_city: true,
              status: true,
              client: { select: { company_name: true } },
              user: { select: { first_name: true, last_name: true } },
            },
          },
          booking: { select: { booking_id: true, booking_number: true } },
        },
        orderBy: [{ created_at: 'desc' }, { hire_id: 'desc' }],
      }),
      this.prisma.financialTransaction.findMany({
        where: { AND: txAnd },
        select: {
          transaction_id: true,
          voucher_number: true,
          trip_id: true,
          booking_id: true,
          transport_owner_id: true,
          transaction_type: true,
          amount: true,
          direction: true,
          payment_method: true,
          reference_number: true,
          transaction_date: true,
          created_at: true,
          status: true,
          metadata: true,
          purpose: true,
          notes: true,
        },
      }),
      this.prisma.partyOpeningBalance.findMany({
        where: { party_type: 'VENDOR', as_of_date: { lte: dateTo } },
        select: { party_id: true, amount: true, as_of_date: true },
      }),
    ]);

    const openingByVendor = new Map();
    for (const o of openings) {
      openingByVendor.set(o.party_id, roundMoney((openingByVendor.get(o.party_id) || 0) + num(o.amount)));
    }

    const vendors = new Map();
    const ensureVendor = (id, seed = {}) => {
      if (!vendors.has(id)) {
        vendors.set(id, {
          vendor_id: id,
          name: seed.name || `Vendor #${id}`,
          company_name: seed.company_name || null,
          mobile: seed.mobile || null,
          city: seed.city || null,
          bank_name: seed.bank_name || null,
          bank_account: seed.bank_account || null,
          gross_hire: 0,
          commission: 0,
          net_payable: 0,
          paid: 0,
          fuel_credits: 0,
          commission_received: 0,
          settlement_debit: 0,
          settlement_credit: 0,
          opening: openingByVendor.get(id) || 0,
          hires: [],
          transactions: [],
          vehicles: new Set(),
          last_payment_date: null,
        });
      }
      return vendors.get(id);
    };

    for (const h of hires) {
      const v = ensureVendor(h.vendor_id, {
        name: h.vendor?.company_name || h.vendor?.owner_name,
        company_name: h.vendor?.company_name,
        mobile: h.vendor?.mobile,
        city: h.vendor?.city,
        bank_name: h.vendor?.bank_name,
        bank_account: h.vendor?.bank_account,
      });
      v.gross_hire = roundMoney(v.gross_hire + num(h.gross_hire));
      v.commission = roundMoney(v.commission + num(h.commission_amount));
      v.net_payable = roundMoney(v.net_payable + num(h.net_vendor_payable));
      if (h.vehicle?.vehicle_number) v.vehicles.add(h.vehicle.vehicle_number);
      v.hires.push({
        hire_id: h.hire_id,
        trip_id: h.trip_id,
        trip_number: h.trip?.trip_number || null,
        booking_number: h.booking?.booking_number || null,
        branch: h.trip?.pickup_city || null,
        business_model: h.business_model,
        billing_to: h.billing_to,
        rate_basis: h.rate_basis,
        rate_value: roundMoney(num(h.rate_value)),
        rate_quantity: num(h.rate_quantity),
        rate_unit: h.rate_unit || null,
        vehicle_number: h.vehicle?.vehicle_number || null,
        vehicle_id: h.vehicle_id,
        driver_id: h.driver_id,
        gross_hire: roundMoney(num(h.gross_hire)),
        commission_type: h.commission_type,
        commission_rate: num(h.commission_rate),
        commission_amount: roundMoney(num(h.commission_amount)),
        net_vendor_payable: roundMoney(num(h.net_vendor_payable)),
        paid: 0,
        fuel_credits: 0,
        settlement: 0,
        outstanding: roundMoney(num(h.net_vendor_payable)),
        status: h.status,
        created_at: dateLabel(h.created_at),
        remarks: h.remarks,
      });
    }

    for (const t of transactions) {
      const v = ensureVendor(t.transport_owner_id);
      const meta = parseMetadata(t.metadata);
      const amount = num(t.amount);
      v.transactions.push({
        transaction_id: t.transaction_id,
        date: dateLabel(t.transaction_date || t.created_at),
        transaction_type: t.transaction_type,
        amount: roundMoney(amount),
        direction: t.direction,
        payment_method: t.payment_method,
        reference_number: t.reference_number,
        notes: t.notes || t.purpose,
        kind: meta.kind || null,
        trip_id: t.trip_id,
      });

      if (VENDOR_PAYMENT_TYPES.includes(t.transaction_type) && t.direction === 'DEBIT') {
        v.paid = roundMoney(v.paid + amount);
        if (!v.last_payment_date || new Date(t.transaction_date || t.created_at) > new Date(v.last_payment_date)) {
          v.last_payment_date = dateLabel(t.transaction_date || t.created_at);
        }
      } else if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'VENDOR_FUEL_CREDIT' && t.direction === 'DEBIT') {
        v.fuel_credits = roundMoney(v.fuel_credits + amount);
      } else if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'VENDOR_SETTLEMENT') {
        if (t.direction === 'DEBIT') v.settlement_debit = roundMoney(v.settlement_debit + amount);
        else v.settlement_credit = roundMoney(v.settlement_credit + amount);
      } else if (t.transaction_type === 'COMMISSION' && meta.kind === 'COMMISSION_RECEIPT' && t.direction === 'CREDIT') {
        v.commission_received = roundMoney(v.commission_received + amount);
      }

      // Trip-level allocation for the hire's own payment history.
      if (t.trip_id && t.direction === 'DEBIT') {
        const hire = v.hires.find((h) => h.trip_id === t.trip_id);
        if (hire) {
          if (VENDOR_PAYMENT_TYPES.includes(t.transaction_type)) hire.paid = roundMoney(hire.paid + amount);
          else if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'VENDOR_FUEL_CREDIT') hire.fuel_credits = roundMoney(hire.fuel_credits + amount);
          else if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'VENDOR_SETTLEMENT') hire.settlement = roundMoney(hire.settlement + amount);
          hire.outstanding = roundMoney(hire.net_vendor_payable - hire.paid - hire.fuel_credits - hire.settlement);
        }
      }
    }

    // Vendors that only have a payment/opening and no hire in the window.
    for (const [id, opening] of openingByVendor.entries()) {
      if (!vendors.has(id) && opening !== 0) ensureVendor(id);
    }

    const rows = [];
    for (const v of vendors.values()) {
      const balance = roundMoney(
        v.opening + v.net_payable - v.paid - v.fuel_credits - v.commission_received - v.settlement_debit + v.settlement_credit,
      );
      rows.push({
        vendor_id: v.vendor_id,
        vendor_code: null,
        vendor_name: v.name,
        company_name: v.company_name,
        mobile: v.mobile,
        city: v.city,
        bank_name: v.bank_name,
        bank_account: v.bank_account,
        vehicle_numbers: Array.from(v.vehicles).filter(Boolean),
        hire_count: v.hires.length,
        gross_hire: v.gross_hire,
        commission: v.commission,
        net_payable: v.net_payable,
        opening: v.opening,
        paid: v.paid,
        fuel_credits: v.fuel_credits,
        commission_received: v.commission_received,
        settlement_debit: v.settlement_debit,
        settlement_credit: v.settlement_credit,
        settlement: roundMoney(v.settlement_debit - v.settlement_credit),
        balance,
        direction: balance > 0 ? 'PAYABLE' : balance < 0 ? 'RECEIVABLE' : 'SETTLED',
        unpaid_hire: roundMoney(v.hires.reduce((s, h) => s + Math.max(0, h.outstanding), 0)),
        last_payment_date: v.last_payment_date,
        hires: v.hires.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
        transactions: v.transactions.sort((a, b) => String(b.date).localeCompare(String(a.date))),
      });
    }

    const payable = roundMoney(rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0));
    const receivable = roundMoney(rows.filter((r) => r.balance < 0).reduce((s, r) => s + Math.abs(r.balance), 0));

    return {
      rows,
      totals: {
        vendors: rows.length,
        payable,
        receivable,
        net: roundMoney(payable - receivable),
        gross_hire: roundMoney(rows.reduce((s, r) => s + r.gross_hire, 0)),
        commission: roundMoney(rows.reduce((s, r) => s + r.commission, 0)),
        net_payable: roundMoney(rows.reduce((s, r) => s + r.net_payable, 0)),
        paid: roundMoney(rows.reduce((s, r) => s + r.paid, 0)),
        fuel_credits: roundMoney(rows.reduce((s, r) => s + r.fuel_credits, 0)),
        unpaid_hire: roundMoney(rows.reduce((s, r) => s + r.unpaid_hire, 0)),
        pending_count: rows.filter((r) => r.balance > 0).length,
        hire_count: rows.reduce((s, r) => s + r.hire_count, 0),
      },
    };
  }

  async getProviderPayables(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadVendorData(filters);
    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.vendor_name, r.company_name, r.mobile, ...(r.vehicle_numbers || [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.status === 'PAYABLE') rows = rows.filter((r) => r.balance > 0);
    else if (filters.status === 'RECEIVABLE') rows = rows.filter((r) => r.balance < 0);
    else if (filters.status === 'SETTLED') rows = rows.filter((r) => r.balance === 0);
    rows = [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));

    return this._paginate(rows, filters, {
      summary: data.totals,
      as_of: dateLabel(filters.dateTo),
    });
  }

  async getVendorLedger(vendorId, rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadVendorData(filters);
    const vendor = data.rows.find((v) => v.vendor_id === Number(vendorId));
    if (!vendor) {
      return {
        vendor: null,
        entries: [],
        summary: { opening: 0, net_payable: 0, paid: 0, balance: 0 },
      };
    }

    const entries = [
      ...vendor.hires.map((h) => ({
        date: h.created_at,
        kind: 'HIRE',
        label: `Vehicle hire · ${h.trip_number || h.booking_number || `#${h.hire_id}`}`,
        reference: h.vehicle_number || `Hire #${h.hire_id}`,
        debit: 0,
        credit: h.net_vendor_payable,
        amount: h.net_vendor_payable,
        note: `Gross ₹${h.gross_hire.toLocaleString('en-IN')} − commission ₹${h.commission_amount.toLocaleString('en-IN')}`,
        trip_id: h.trip_id,
      })),
      ...vendor.transactions.map((t) => {
        let credit = 0;
        let debit = 0;
        if (t.kind === 'VENDOR_SETTLEMENT') {
          // The DEBIT leg pays the trip, the CREDIT leg applies the vendor's
          // previous receivable. Both legs move the signed balance in the
          // direction shown by the ledger sign convention.
          if (t.direction === 'DEBIT') debit = t.amount;
          else credit = t.amount;
        } else if (t.direction === 'DEBIT') {
          debit = t.amount;
        } else {
          credit = t.amount;
        }
        return {
          date: t.date,
          kind: t.kind || t.transaction_type,
          label: TRANSACTION_LABELS[t.transaction_type] || t.transaction_type,
          reference: t.reference_number || `TX-${t.transaction_id}`,
          debit,
          credit,
          amount: t.amount,
          note: t.notes,
          trip_id: t.trip_id,
          transaction_id: t.transaction_id,
        };
      }),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = vendor.opening;
    for (const e of entries) {
      running = roundMoney(running + e.credit - e.debit);
      e.balance = running;
    }

    return {
      vendor: {
        vendor_id: vendor.vendor_id,
        vendor_name: vendor.vendor_name,
        company_name: vendor.company_name,
        mobile: vendor.mobile,
        city: vendor.city,
        bank_name: vendor.bank_name,
        bank_account: vendor.bank_account,
        vehicle_numbers: vendor.vehicle_numbers,
      },
      entries,
      summary: {
        opening: vendor.opening,
        gross_hire: vendor.gross_hire,
        commission: vendor.commission,
        net_payable: vendor.net_payable,
        paid: vendor.paid,
        fuel_credits: vendor.fuel_credits,
        commission_received: vendor.commission_received,
        settlement: vendor.settlement,
        balance: vendor.balance,
        direction: vendor.direction,
      },
    };
  }

  // =========================================================================
  // PAYMENTS RECEIVED
  // =========================================================================

  async _loadReceipts(filters) {
    const and = [
      { transaction_type: { in: CUSTOMER_RECEIPT_TYPES } },
      { direction: 'CREDIT' },
      { status: { not: 'CANCELLED' } },
      this._within(filters.dateFrom, filters.dateTo),
    ];
    const branch = this._branchTx(filters.branch);
    if (branch) and.push(branch);

    const receipts = await this.prisma.financialTransaction.findMany({
      where: { AND: and },
      select: {
        transaction_id: true,
        voucher_number: true,
        amount: true,
        payment_method: true,
        reference_number: true,
        transaction_date: true,
        created_at: true,
        status: true,
        notes: true,
        metadata: true,
        invoice_id: true,
        trip_id: true,
        booking_id: true,
        client_id: true,
        trip: {
          select: {
            trip_number: true,
            pickup_city: true,
            client: { select: { company_name: true, contact_person: true, phone: true } },
            user: { select: { first_name: true, last_name: true, phone: true } },
          },
        },
        booking: {
          select: {
            booking_number: true,
            pickup_city: true,
            user: { select: { first_name: true, last_name: true, phone: true } },
          },
        },
        invoices: { select: { invoice_id: true, invoice_number: true, due_at: true, final_price: true, total_amount: true, grand_total: true } },
      },
      orderBy: [{ transaction_date: 'desc' }, { transaction_id: 'desc' }],
    });

    const rows = receipts.map((r) => {
      const meta = parseMetadata(r.metadata);
      const user = r.trip?.user || r.booking?.user;
      const customerName =
        r.trip?.client?.company_name ||
        (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '') ||
        'Customer';
      const method = String(r.payment_method || '').toUpperCase();
      return {
        transaction_id: r.transaction_id,
        receipt_number: r.voucher_number || meta.voucher_number || meta.receipt_number || r.reference_number || `MR-${r.transaction_id}`,
        date: dateLabel(r.transaction_date || r.created_at),
        amount: roundMoney(num(r.amount)),
        payment_method: r.payment_method,
        payment_mode: methodLabel(r.payment_method),
        reference_number: r.reference_number,
        cash: isCashMethod(method),
        customer_name: customerName,
        customer_phone: r.trip?.client?.phone || user?.phone || null,
        trip_id: r.trip_id,
        trip_number: r.trip?.trip_number || null,
        booking_number: r.booking?.booking_number || null,
        branch: r.trip?.pickup_city || r.booking?.pickup_city || null,
        invoice_id: r.invoice_id,
        invoice_number: r.invoices?.invoice_number || null,
        status: r.status,
        notes: r.notes,
        voucher_url: null,
      };
    });

    const cashRows = rows.filter((r) => r.cash);
    return {
      rows,
      totals: {
        total: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
        cash: roundMoney(cashRows.reduce((s, r) => s + r.amount, 0)),
        nonCash: roundMoney(rows.reduce((s, r) => s + r.amount, 0) - cashRows.reduce((s, r) => s + r.amount, 0)),
        count: rows.length,
        cashCount: cashRows.length,
      },
    };
  }

  async getPaymentsReceived(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadReceipts(filters);
    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.receipt_number, r.customer_name, r.customer_phone, r.trip_number, r.booking_number, r.invoice_number, r.reference_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.mode) rows = rows.filter((r) => String(r.payment_method || '').toUpperCase() === filters.mode);
    return this._paginate(rows, filters, { summary: data.totals });
  }

  // =========================================================================
  // ADVANCES
  // =========================================================================

  async _loadAdvances(filters) {
    const and = [
      this._asOf(filters.dateTo, 'given_at'),
    ];
    const branch = this._branchAdvance(filters.branch);
    if (branch) and.push(branch);

    const advances = await this.prisma.tripAdvance.findMany({
      where: { AND: and },
      select: {
        advance_id: true,
        amount: true,
        advance_type: true,
        payment_method: true,
        reference_number: true,
        given_at: true,
        created_at: true,
        notes: true,
        status: true,
        adjusted_amount: true,
        adjusted_at: true,
        adjustment_reference: true,
        trip_id: true,
        booking_id: true,
        driver_id: true,
        vehicle_id: true,
        transport_owner_id: true,
        trip: {
          select: {
            trip_number: true,
            pickup_city: true,
            status: true,
            transportOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
            driver: { select: { driver_id: true, driver_name: true } },
            vehicle: { select: { vehicle_id: true, vehicle_number: true } },
            client: { select: { company_name: true } },
          },
        },
        booking: {
          select: {
            booking_number: true,
            pickup_city: true,
            vehicleOwner: { select: { owner_id: true, owner_name: true, company_name: true } },
            vehicle: { select: { vehicle_id: true, vehicle_number: true } },
          },
        },
      },
      orderBy: [{ given_at: 'desc' }, { advance_id: 'desc' }],
    });

    const category = (type) => {
      if (type === 'OWNER_ADVANCE') return 'VENDOR';
      if (type === 'DRIVER_ADVANCE') return 'DRIVER';
      if (type === 'FUEL_ADVANCE') return 'FUEL';
      return 'OTHER';
    };

    const rows = advances.map((a) => {
      const amount = roundMoney(num(a.amount));
      const adjusted = roundMoney(num(a.adjusted_amount));
      const outstanding = roundMoney(Math.max(0, amount - adjusted));
      const owner = a.trip?.transportOwner || a.booking?.vehicleOwner;
      const partyName =
        owner?.company_name ||
        owner?.owner_name ||
        a.trip?.driver?.driver_name ||
        (a.driver_id ? `Driver #${a.driver_id}` : null) ||
        (a.transport_owner_id ? `Vendor #${a.transport_owner_id}` : null) ||
        '—';
      const type = category(a.advance_type);
      return {
        advance_id: a.advance_id,
        voucher_number: a.reference_number || `AV-${a.advance_id}`,
        date: dateLabel(a.given_at || a.created_at),
        party_name: partyName,
        party_id: owner?.owner_id || a.transport_owner_id || a.driver_id || null,
        party_type: type === 'DRIVER' ? 'DRIVER' : type === 'VENDOR' ? 'VENDOR' : type === 'FUEL' ? 'FUEL' : 'OTHER',
        category: type,
        advance_type: a.advance_type,
        amount,
        adjusted_amount: adjusted,
        outstanding,
        payment_method: a.payment_method,
        payment_mode: methodLabel(a.payment_method),
        reference_number: a.reference_number,
        trip_id: a.trip_id,
        trip_number: a.trip?.trip_number || null,
        booking_number: a.booking?.booking_number || null,
        branch: a.trip?.pickup_city || a.booking?.pickup_city || null,
        vehicle_number: a.trip?.vehicle?.vehicle_number || a.booking?.vehicle?.vehicle_number || null,
        status: outstanding <= 0 ? (adjusted > 0 ? 'ADJUSTED' : 'CLOSED') : adjusted > 0 ? 'PARTIALLY_ADJUSTED' : (a.status || 'OUTSTANDING'),
        adjusted_at: dateLabel(a.adjusted_at),
        adjustment_reference: a.adjustment_reference,
        notes: a.notes,
      };
    });

    const sum = (list) => roundMoney(list.reduce((s, r) => s + r.outstanding, 0));
    return {
      rows,
      totals: {
        total: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
        outstanding: sum(rows),
        vendor: sum(rows.filter((r) => r.category === 'VENDOR')),
        driver: sum(rows.filter((r) => r.category === 'DRIVER')),
        fuel: sum(rows.filter((r) => r.category === 'FUEL')),
        other: sum(rows.filter((r) => r.category === 'OTHER')),
        count: rows.length,
        outstandingCount: rows.filter((r) => r.outstanding > 0).length,
      },
    };
  }

  async getAdvances(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadAdvances(filters);
    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.voucher_number, r.party_name, r.trip_number, r.booking_number, r.reference_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.type) rows = rows.filter((r) => r.category === filters.type);
    if (filters.status === 'OUTSTANDING') rows = rows.filter((r) => r.outstanding > 0);
    return this._paginate(rows, filters, { summary: data.totals });
  }

  // =========================================================================
  // COMMISSION
  // =========================================================================

  async _loadCommission(filters) {
    const hireAnd = [
      { status: { notIn: ['CANCELLED', 'CANCELED'] } },
      { created_at: { lte: filters.dateTo } },
    ];
    const branch = this._branchHire(filters.branch);
    if (branch) hireAnd.push(branch);

    const [hires, receipts] = await Promise.all([
      this.prisma.vehicleHire.findMany({
        where: { AND: hireAnd },
        select: {
          hire_id: true,
          trip_id: true,
          vendor_id: true,
          vehicle_id: true,
          business_model: true,
          billing_to: true,
          gross_hire: true,
          commission_type: true,
          commission_rate: true,
          commission_amount: true,
          net_vendor_payable: true,
          status: true,
          created_at: true,
          vendor: { select: { owner_id: true, owner_name: true, company_name: true } },
          vehicle: { select: { vehicle_number: true } },
          trip: {
            select: {
              trip_number: true,
              pickup_city: true,
              client: { select: { company_name: true } },
              user: { select: { first_name: true, last_name: true } },
            },
          },
          booking: { select: { booking_number: true } },
        },
        orderBy: [{ created_at: 'desc' }, { hire_id: 'desc' }],
      }),
      this.prisma.financialTransaction.findMany({
        where: {
          AND: [
            { transaction_type: 'COMMISSION' },
            { direction: 'CREDIT' },
            { status: { not: 'CANCELLED' } },
            { metadata: { contains: 'COMMISSION_RECEIPT' } },
            this._asOf(filters.dateTo),
            ...(this._branchTx(filters.branch) ? [this._branchTx(filters.branch)] : []),
          ],
        },
        select: {
          transaction_id: true,
          voucher_number: true,
          amount: true,
          trip_id: true,
          transaction_date: true,
          created_at: true,
          payment_method: true,
          reference_number: true,
          metadata: true,
        },
      }),
    ]);

    const receiptsByTrip = new Map();
    for (const r of receipts) {
      if (!r.trip_id) continue;
      receiptsByTrip.set(r.trip_id, roundMoney((receiptsByTrip.get(r.trip_id) || 0) + num(r.amount)));
    }

    const inPeriod = (d) => {
      const t = new Date(d).getTime();
      return t >= filters.dateFrom.getTime() && t <= filters.dateTo.getTime();
    };

    const rows = hires.map((h) => {
      const commission = roundMoney(num(h.commission_amount));
      const received = roundMoney(receiptsByTrip.get(h.trip_id) || 0);
      const user = h.trip?.user;
      return {
        hire_id: h.hire_id,
        trip_id: h.trip_id,
        trip_number: h.trip?.trip_number || null,
        booking_number: h.booking?.booking_number || null,
        branch: h.trip?.pickup_city || null,
        customer_name: h.trip?.client?.company_name || (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '—'),
        vendor_id: h.vendor_id,
        vendor_name: h.vendor?.company_name || h.vendor?.owner_name || `Vendor #${h.vendor_id}`,
        vehicle_number: h.vehicle?.vehicle_number || null,
        business_model: h.business_model,
        billing_to: h.billing_to,
        gross_hire: roundMoney(num(h.gross_hire)),
        commission_type: h.commission_type,
        commission_rate: num(h.commission_rate),
        commission_amount: commission,
        net_vendor_payable: roundMoney(num(h.net_vendor_payable)),
        received,
        remaining: roundMoney(Math.max(0, commission - received)),
        status: h.status,
        date: dateLabel(h.created_at),
        in_period: inPeriod(h.created_at),
      };
    });

    const periodRows = rows.filter((r) => r.in_period);
    const percentage = roundMoney(rows.filter((r) => r.commission_type === 'percentage').reduce((s, r) => s + r.commission_amount, 0));
    const fixed = roundMoney(rows.filter((r) => r.commission_type === 'fixed').reduce((s, r) => s + r.commission_amount, 0));
    const receivedTotal = roundMoney(receipts.reduce((s, r) => s + num(r.amount), 0));

    return {
      rows,
      totals: {
        earned: roundMoney(rows.reduce((s, r) => s + r.commission_amount, 0)),
        periodEarned: roundMoney(periodRows.reduce((s, r) => s + r.commission_amount, 0)),
        percentage,
        fixed,
        trips: rows.filter((r) => r.commission_amount > 0).length,
        periodTrips: periodRows.filter((r) => r.commission_amount > 0).length,
        received: receivedTotal,
        remaining: roundMoney(rows.reduce((s, r) => s + r.remaining, 0)),
        gross: roundMoney(rows.reduce((s, r) => s + r.gross_hire, 0)),
      },
    };
  }

  async getCommission(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    filters.dateFrom = startOfMonth(filters.dateFrom);
    const data = await this._loadCommission(filters);
    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.trip_number, r.booking_number, r.customer_name, r.vendor_name, r.vehicle_number]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.status === 'EARNED') rows = rows.filter((r) => r.commission_amount > 0);
    return this._paginate(rows, filters, { summary: data.totals, as_of: dateLabel(filters.dateTo) });
  }

  // =========================================================================
  // SETTLEMENTS
  // =========================================================================

  async _loadSettlements(filters) {
    const and = [
      { status: { not: 'CANCELLED' } },
      this._within(filters.dateFrom, filters.dateTo),
    ];
    const branch = this._branchTx(filters.branch);
    if (branch) and.push(branch);

    const [legs, nonCash] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where: {
          AND: [
            ...and,
            { transaction_type: 'ADJUSTMENT' },
            { OR: [
              { metadata: { contains: 'VENDOR_SETTLEMENT' } },
              { metadata: { contains: 'CUSTOMER_SETTLEMENT' } },
            ] },
          ],
        },
        select: {
          transaction_id: true,
          voucher_number: true,
          amount: true,
          direction: true,
          payment_method: true,
          reference_number: true,
          transaction_date: true,
          created_at: true,
          metadata: true,
          notes: true,
          trip_id: true,
          transport_owner_id: true,
          client_id: true,
          trip: { select: { trip_number: true, pickup_city: true } },
          booking: { select: { booking_number: true } },
        },
        orderBy: [{ transaction_date: 'asc' }, { transaction_id: 'asc' }],
      }),
      // Non-cash clearances posted through the ordinary receipt / vendor
      // payment paths (method = SETTLEMENT). They move no money, so they
      // belong on the settlement tab, not on the cash-flow chart.
      this.prisma.financialTransaction.findMany({
        where: {
          AND: [
            ...and,
            { payment_method: { equals: 'SETTLEMENT', mode: 'insensitive' } },
            {
              OR: [
                { transaction_type: { in: CUSTOMER_RECEIPT_TYPES } },
                { transaction_type: { in: ['OWNER_SETTLEMENT', 'DRIVER_SETTLEMENT'] } },
                { transaction_type: 'ADJUSTMENT' },
              ],
            },
          ],
        },
        select: {
          transaction_id: true,
          voucher_number: true,
          amount: true,
          direction: true,
          payment_method: true,
          reference_number: true,
          transaction_date: true,
          created_at: true,
          metadata: true,
          notes: true,
          trip_id: true,
          transport_owner_id: true,
          client_id: true,
          trip: { select: { trip_number: true, pickup_city: true } },
          booking: { select: { booking_number: true } },
        },
        orderBy: [{ transaction_date: 'asc' }, { transaction_id: 'asc' }],
      }),
    ]);

    const allLegs = [...legs, ...nonCash];
    const seen = new Set();
    const groups = new Map();
    for (const leg of allLegs) {
      if (seen.has(leg.transaction_id)) continue;
      seen.add(leg.transaction_id);

      const meta = parseMetadata(leg.metadata);
      const isCustomer = CUSTOMER_RECEIPT_TYPES.includes(leg.transaction_type) || meta.kind === 'CUSTOMER_SETTLEMENT';
      const kind = meta.kind || (isCustomer ? 'CUSTOMER_SETTLEMENT' : 'VENDOR_SETTLEMENT');
      const key = meta.settlement_id || meta.reference || leg.reference_number || `${kind}-${leg.transaction_id}`;
      if (!groups.has(key)) {
        groups.set(key, {
          settlement_id: key,
          voucher_number: leg.voucher_number || meta.voucher_number || leg.reference_number || `SV-${key}`,
          date: dateLabel(leg.transaction_date || leg.created_at),
          kind,
          party_type: isCustomer ? 'CUSTOMER' : 'VENDOR',
          party_id: leg.transport_owner_id || leg.client_id || meta.party_id || null,
          party_name: meta.party_name || null,
          trip_id: leg.trip_id,
          trip_number: leg.trip?.trip_number || null,
          booking_number: leg.booking?.booking_number || null,
          branch: leg.trip?.pickup_city || null,
          debit: 0,
          credit: 0,
          amount: 0,
          payment_method: leg.payment_method,
          reference: meta.reference || leg.reference_number || null,
          notes: leg.notes,
          cash_impact: 0,
          status: 'POSTED',
          legs: [],
        });
      }
      const g = groups.get(key);
      g.debit = roundMoney(g.debit + (leg.direction === 'DEBIT' ? num(leg.amount) : 0));
      g.credit = roundMoney(g.credit + (leg.direction === 'CREDIT' ? num(leg.amount) : 0));
      g.legs.push({ direction: leg.direction, amount: roundMoney(num(leg.amount)), transaction_id: leg.transaction_id });
      if (!g.party_name) {
        g.party_name = leg.transport_owner_id ? `Vendor #${leg.transport_owner_id}` : leg.client_id ? `Customer #${leg.client_id}` : '—';
      }
    }

    const rows = [...groups.values()].map((g) => ({
      ...g,
      amount: roundMoney(Math.max(g.debit, g.credit)),
      cash_impact: 0,
    }));

    const tripSettlements = await this.prisma.tripSettlement.findMany({
      where: { OR: [{ driver_settlement_payment_method: { equals: 'SETTLEMENT', mode: 'insensitive' } }, { owner_settlement_payment_method: { equals: 'SETTLEMENT', mode: 'insensitive' } }] },
      select: {
        settlement_id: true,
        trip_id: true,
        driver_settlement_amount: true,
        owner_settlement_amount: true,
        driver_settlement_payment_method: true,
        owner_settlement_payment_method: true,
        created_at: true,
        trip: { select: { trip_number: true, pickup_city: true } },
        booking: { select: { booking_number: true } },
      },
      take: 200,
      orderBy: { settlement_id: 'desc' },
    });

    const tripRows = tripSettlements.map((s) => ({
      settlement_id: s.settlement_id,
      trip_id: s.trip_id,
      trip_number: s.trip?.trip_number || null,
      booking_number: s.booking?.booking_number || null,
      branch: s.trip?.pickup_city || null,
      amount: roundMoney(num(s.owner_settlement_amount) || num(s.driver_settlement_amount)),
      driver_amount: roundMoney(num(s.driver_settlement_amount)),
      owner_amount: roundMoney(num(s.owner_settlement_amount)),
      payment_method: s.owner_settlement_payment_method || s.driver_settlement_payment_method,
      date: dateLabel(s.created_at),
      non_cash: true,
    }));

    return {
      rows,
      tripSettlements: tripRows,
      totals: {
        count: rows.length,
        amount: roundMoney(rows.reduce((s, r) => s + r.amount, 0)),
        vendor: roundMoney(rows.filter((r) => r.party_type === 'VENDOR').reduce((s, r) => s + r.amount, 0)),
        customer: roundMoney(rows.filter((r) => r.party_type === 'CUSTOMER').reduce((s, r) => s + r.amount, 0)),
        cashImpact: 0,
        tripSettlementCount: tripRows.length,
      },
    };
  }

  async getSettlements(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadSettlements(filters);
    let rows = data.rows;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      rows = rows.filter((r) =>
        [r.voucher_number, r.party_name, r.trip_number, r.booking_number, r.reference].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.type === 'VENDOR') rows = rows.filter((r) => r.party_type === 'VENDOR');
    if (filters.type === 'CUSTOMER') rows = rows.filter((r) => r.party_type === 'CUSTOMER');
    return this._paginate(rows, filters, { summary: data.totals, tripSettlements: data.tripSettlements });
  }

  // =========================================================================
  // PETROL PUMP
  // =========================================================================

  async _loadPumpData(filters) {
    const { dateFrom, dateTo, branch } = filters;
    const monthStart = startOfMonth(dateTo);

    const [pumps, fuel, payments, bills] = await Promise.all([
      this.prisma.petrolPump.findMany({
        where: { is_active: true },
        orderBy: { pump_name: 'asc' },
      }),
      this.prisma.petrolPumpFuelTransaction.findMany({
        where: {
          fuel_date: { lte: dateTo },
          ...(branch ? { trip: { is: { pickup_city: branch } } } : {}),
        },
        select: {
          transaction_id: true,
          pump_id: true,
          trip_id: true,
          vehicle_id: true,
          driver_id: true,
          fuel_date: true,
          fuel_type: true,
          litres: true,
          rate_per_litre: true,
          total_amount: true,
          receipt_number: true,
          invoice_number: true,
          is_billed: true,
          bill_id: true,
          remarks: true,
          created_at: true,
          trip: { select: { trip_number: true, pickup_city: true } },
          vehicle: { select: { vehicle_number: true } },
        },
        orderBy: [{ fuel_date: 'desc' }, { transaction_id: 'desc' }],
      }),
      this.prisma.petrolPumpPayment.findMany({
        where: {
          payment_date: { lte: dateTo },
          ...(branch ? { pump: { is: { city: branch } } } : {}),
        },
        select: {
          payment_id: true,
          payment_number: true,
          pump_id: true,
          bill_id: true,
          amount: true,
          payment_date: true,
          payment_method: true,
          reference_number: true,
          bank_name: true,
          voucher_number: true,
          remarks: true,
          created_at: true,
        },
        orderBy: [{ payment_date: 'desc' }, { payment_id: 'desc' }],
      }),
      this.prisma.petrolPumpBill.findMany({
        where: { bill_date: { lte: dateTo } },
        select: {
          bill_id: true,
          bill_number: true,
          pump_id: true,
          bill_date: true,
          period_start: true,
          period_end: true,
          fuel_total: true,
          adjustment_amount: true,
          bill_amount: true,
          paid_amount: true,
          outstanding_amount: true,
          status: true,
          due_date: true,
          remarks: true,
        },
        orderBy: [{ bill_date: 'desc' }, { bill_id: 'desc' }],
      }),
    ]);

    const pumpRows = pumps.map((p) => {
      const pumpFuel = fuel.filter((f) => f.pump_id === p.pump_id);
      const pumpPayments = payments.filter((x) => x.pump_id === p.pump_id);
      const opening = num(p.opening_balance);
      const totalFuel = roundMoney(pumpFuel.reduce((s, f) => s + num(f.total_amount), 0));
      const totalPaid = roundMoney(pumpPayments.reduce((s, x) => s + num(x.amount), 0));
      const balance = roundMoney(opening + totalFuel - totalPaid);

      const beforeMonthFuel = roundMoney(
        pumpFuel.filter((f) => new Date(f.fuel_date) < monthStart).reduce((s, f) => s + num(f.total_amount), 0),
      );
      const beforeMonthPaid = roundMoney(
        pumpPayments.filter((x) => new Date(x.payment_date) < monthStart).reduce((s, x) => s + num(x.amount), 0),
      );
      const previousOutstanding = roundMoney(opening + beforeMonthFuel - beforeMonthPaid);
      const monthFuel = roundMoney(
        pumpFuel.filter((f) => new Date(f.fuel_date) >= monthStart && new Date(f.fuel_date) <= dateTo).reduce((s, f) => s + num(f.total_amount), 0),
      );
      const periodFuel = roundMoney(
        pumpFuel.filter((f) => new Date(f.fuel_date) >= dateFrom && new Date(f.fuel_date) <= dateTo).reduce((s, f) => s + num(f.total_amount), 0),
      );
      const lastTransaction = pumpFuel[0]?.fuel_date || pumpPayments[0]?.payment_date || null;
      const pumpBills = bills.filter((b) => b.pump_id === p.pump_id);

      return {
        pump_id: p.pump_id,
        pump_code: p.pump_code,
        pump_name: p.pump_name,
        owner_name: p.owner_name,
        contact_number: p.contact_number,
        city: p.city,
        state: p.state,
        credit_limit: roundMoney(num(p.credit_limit)),
        opening_balance: roundMoney(opening),
        current_balance: roundMoney(num(p.current_balance)),
        opening: roundMoney(opening),
        total_fuel: totalFuel,
        total_paid: totalPaid,
        outstanding: Math.max(0, balance),
        advance: Math.max(0, -balance),
        signed_balance: balance,
        previous_outstanding: Math.max(0, previousOutstanding),
        month_fuel: monthFuel,
        period_fuel: periodFuel,
        last_transaction_date: dateLabel(lastTransaction),
        bill_count: pumpBills.length,
        unpaid_bills: pumpBills.filter((b) => b.status !== 'PAID' && b.status !== 'CANCELLED').length,
        status: p.status,
        utilization: num(p.credit_limit) > 0 ? roundMoney((Math.max(0, balance) / num(p.credit_limit)) * 100) : null,
      };
    });

    const fuelRows = fuel.map((f) => ({
      transaction_id: f.transaction_id,
      date: dateLabel(f.fuel_date),
      pump_id: f.pump_id,
      pump_name: pumps.find((p) => p.pump_id === f.pump_id)?.pump_name || `Pump #${f.pump_id}`,
      trip_id: f.trip_id,
      trip_number: f.trip?.trip_number || null,
      branch: f.trip?.pickup_city || null,
      vehicle_id: f.vehicle_id,
      vehicle_number: f.vehicle?.vehicle_number || null,
      driver_id: f.driver_id,
      fuel_type: f.fuel_type,
      litres: roundMoney(num(f.litres)),
      rate_per_litre: roundMoney(num(f.rate_per_litre)),
      amount: roundMoney(num(f.total_amount)),
      receipt_number: f.receipt_number,
      invoice_number: f.invoice_number,
      is_billed: f.is_billed,
      bill_id: f.bill_id,
      remarks: f.remarks,
      cash: false,
      status: f.bill_id ? 'BILLED' : 'UNBILLED',
    }));

    const paymentRows = payments.map((p) => ({
      payment_id: p.payment_id,
      payment_number: p.payment_number,
      voucher_number: p.voucher_number || p.payment_number,
      date: dateLabel(p.payment_date),
      pump_id: p.pump_id,
      pump_name: pumps.find((x) => x.pump_id === p.pump_id)?.pump_name || `Pump #${p.pump_id}`,
      bill_id: p.bill_id,
      amount: roundMoney(num(p.amount)),
      payment_method: p.payment_method,
      payment_mode: methodLabel(p.payment_method),
      reference_number: p.reference_number,
      bank_name: p.bank_name,
      remarks: p.remarks,
      cash: isCashMethod(p.payment_method),
      status: 'POSTED',
    }));

    const billRows = bills.map((b) => ({
      bill_id: b.bill_id,
      bill_number: b.bill_number,
      pump_id: b.pump_id,
      pump_name: pumps.find((x) => x.pump_id === b.pump_id)?.pump_name || `Pump #${b.pump_id}`,
      bill_date: dateLabel(b.bill_date),
      period_start: dateLabel(b.period_start),
      period_end: dateLabel(b.period_end),
      fuel_total: roundMoney(num(b.fuel_total)),
      adjustment_amount: roundMoney(num(b.adjustment_amount)),
      bill_amount: roundMoney(num(b.bill_amount)),
      paid_amount: roundMoney(num(b.paid_amount)),
      outstanding_amount: roundMoney(num(b.outstanding_amount)),
      due_date: dateLabel(b.due_date),
      status: b.status,
      remarks: b.remarks,
    }));

    const totalOutstanding = roundMoney(pumpRows.reduce((s, p) => s + p.outstanding, 0));
    return {
      pumps: pumpRows,
      fuel: fuelRows,
      payments: paymentRows,
      bills: billRows,
      totals: {
        outstanding: totalOutstanding,
        monthFuel: roundMoney(pumpRows.reduce((s, p) => s + p.month_fuel, 0)),
        previousOutstanding: roundMoney(pumpRows.reduce((s, p) => s + p.previous_outstanding, 0)),
        periodFuel: roundMoney(pumpRows.reduce((s, p) => s + p.period_fuel, 0)),
        pumpsWithDues: pumpRows.filter((p) => p.outstanding > 0).length,
        pumpCount: pumpRows.length,
        totalPaid: roundMoney(pumpRows.reduce((s, p) => s + p.total_paid, 0)),
        creditLimit: roundMoney(pumpRows.reduce((s, p) => s + p.credit_limit, 0)),
        unbilledFuel: roundMoney(fuelRows.filter((f) => !f.is_billed).reduce((s, f) => s + f.amount, 0)),
      },
    };
  }

  async getPetrolPump(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadPumpData(filters);

    let pumps = data.pumps;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      pumps = pumps.filter((p) =>
        [p.pump_name, p.pump_code, p.owner_name, p.contact_number, p.city].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      );
    }

    return this._paginate(pumps, filters, {
      summary: data.totals,
      fuel: data.fuel.slice(0, filters.limit),
      payments: data.payments.slice(0, filters.limit),
      bills: data.bills.slice(0, filters.limit),
      counts: { fuel: data.fuel.length, payments: data.payments.length, bills: data.bills.length },
      as_of: dateLabel(filters.dateTo),
    });
  }

  async getPumpLedger(pumpId, rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const data = await this._loadPumpData(filters);
    const pump = data.pumps.find((p) => p.pump_id === Number(pumpId));
    if (!pump) return { pump: null, entries: [], summary: null };

    const entries = [
      ...data.fuel.filter((f) => f.pump_id === pump.pump_id).map((f) => ({
        date: f.date,
        kind: 'FUEL',
        label: `${f.fuel_type} · ${f.litres} L`,
        reference: f.receipt_number || `Fuel #${f.transaction_id}`,
        debit: f.amount,
        credit: 0,
        amount: f.amount,
        trip_id: f.trip_id,
        trip_number: f.trip_number,
        vehicle_number: f.vehicle_number,
        status: f.status,
      })),
      ...data.payments.filter((p) => p.pump_id === pump.pump_id).map((p) => ({
        date: p.date,
        kind: 'PAYMENT',
        label: `Payment · ${p.payment_mode}`,
        reference: p.voucher_number,
        debit: 0,
        credit: p.amount,
        amount: p.amount,
        status: 'POSTED',
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let running = pump.opening;
    for (const e of entries) {
      running = roundMoney(running + e.debit - e.credit);
      e.balance = running;
    }

    return { pump, entries, summary: { opening: pump.opening, outstanding: pump.outstanding, entries: entries.length } };
  }

  // =========================================================================
  // CASH FLOW
  // =========================================================================

  _cashFlowMonths(filters) {
    const endMonth = startOfMonth(filters.dateTo);
    const earliest = addMonths(endMonth, -5);
    const start = filters.dateFrom < earliest ? startOfMonth(filters.dateFrom) : earliest;
    const months = [];
    let cursor = start;
    while (cursor.getTime() <= endMonth.getTime()) {
      months.push(monthKey(cursor));
      cursor = addMonths(cursor, 1);
    }
    return months;
  }

  async _loadCashFlow(filters, months) {
    const start = new Date(`${months[0]}-01T00:00:00.000Z`);
    const end = endOfMonth(new Date(`${months[months.length - 1]}-01T00:00:00.000Z`));
    const effectiveEnd = end.getTime() > filters.dateTo.getTime() ? filters.dateTo : end;

    const and = [
      { status: { not: 'CANCELLED' } },
      this._within(start, effectiveEnd),
    ];
    const branch = this._branchTx(filters.branch);
    if (branch) and.push(branch);

    const [transactions, pumpPayments, pumpFuel] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where: { AND: and },
        select: {
          transaction_id: true,
          voucher_number: true,
          transaction_type: true,
          amount: true,
          direction: true,
          payment_method: true,
          transaction_date: true,
          created_at: true,
          status: true,
          metadata: true,
        },
      }),
      this.prisma.petrolPumpPayment.findMany({
        where: {
          payment_date: { gte: start, lte: effectiveEnd },
          ...(filters.branch ? { pump: { is: { city: filters.branch } } } : {}),
        },
        select: { payment_id: true, amount: true, payment_date: true, payment_method: true },
      }),
      this.prisma.petrolPumpFuelTransaction.findMany({
        where: {
          fuel_date: { gte: start, lte: effectiveEnd },
          ...(filters.branch ? { trip: { is: { pickup_city: filters.branch } } } : {}),
        },
        select: { transaction_id: true, total_amount: true, fuel_date: true },
      }),
    ]);

    const buckets = new Map(
      months.map((key) => [key, { month: key, label: monthLabel(key), collections: 0, payments: 0, net: 0, receipts: 0, outflows: 0 }]),
    );
    const add = (dateValue, field, amount) => {
      const d = new Date(dateValue || Date.now());
      const key = monthKey(d);
      const bucket = buckets.get(key);
      if (!bucket) return;
      bucket[field] = roundMoney(bucket[field] + amount);
    };

    for (const t of transactions) {
      const meta = parseMetadata(t.metadata);
      const method = String(t.payment_method || '').toUpperCase();
      const amount = num(t.amount);
      const date = t.transaction_date || t.created_at;

      if (CUSTOMER_RECEIPT_TYPES.includes(t.transaction_type) && t.direction === 'CREDIT' && isCashMethod(method)) {
        add(date, 'collections', amount);
        add(date, 'receipts', 1);
      } else if (t.transaction_type === 'COMMISSION' && t.direction === 'CREDIT' && meta.kind === 'COMMISSION_RECEIPT' && isCashMethod(method)) {
        add(date, 'collections', amount);
        add(date, 'receipts', 1);
      } else if (CASH_OUT_TYPES.includes(t.transaction_type) && t.direction === 'DEBIT' && isCashMethod(method)) {
        add(date, 'payments', amount);
        add(date, 'outflows', 1);
      } else if (t.transaction_type === 'REFUND' && t.direction === 'DEBIT' && isCashMethod(method)) {
        add(date, 'payments', amount);
        add(date, 'outflows', 1);
      } else if (t.transaction_type === 'REVERSAL' && isCashMethod(method)) {
        if (t.direction === 'DEBIT') add(date, 'payments', amount);
        else add(date, 'collections', amount);
      }
    }

    for (const p of pumpPayments) {
      if (!isCashMethod(p.payment_method)) continue;
      add(p.payment_date, 'payments', num(p.amount));
      add(p.payment_date, 'outflows', 1);
    }

    for (const f of pumpFuel) {
      // Credit fuel is a liability, never cash movement. It is deliberately
      // not added to `payments`; it is returned separately so the UI can
      // explain the difference between obligations and cash.
      const key = monthKey(new Date(f.fuel_date));
      const bucket = buckets.get(key);
      if (bucket) bucket.fuelCredit = roundMoney((bucket.fuelCredit || 0) + num(f.total_amount));
    }

    const series = [...buckets.values()].map((b) => ({
      ...b,
      net: roundMoney(b.collections - b.payments),
    }));

    return {
      series,
      totals: {
        inflow: roundMoney(series.reduce((s, b) => s + b.collections, 0)),
        outflow: roundMoney(series.reduce((s, b) => s + b.payments, 0)),
      },
    };
  }

  // =========================================================================
  // UNIFIED TRANSACTION REGISTER
  // =========================================================================

  async getTransactions(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const result = await this._transactionRegister(filters);
    return this._paginate(result.rows, filters, { summary: result.totals, counts: result.counts });
  }

  async _transactionRegister(filters) {
    const and = [
      { status: { not: 'CANCELLED' } },
      this._within(filters.dateFrom, filters.dateTo),
    ];
    const branch = this._branchTx(filters.branch);
    if (branch) and.push(branch);

    const [transactions, pumpPayments, pumpFuel, partyIds] = await Promise.all([
      this.prisma.financialTransaction.findMany({
        where: { AND: and },
        select: {
          transaction_id: true,
          voucher_number: true,
          transaction_type: true,
          amount: true,
          direction: true,
          payment_method: true,
          reference_number: true,
          transaction_date: true,
          created_at: true,
          status: true,
          metadata: true,
          notes: true,
          purpose: true,
          invoice_id: true,
          trip_id: true,
          booking_id: true,
          transport_owner_id: true,
          client_id: true,
          trip: {
            select: {
              trip_number: true,
              pickup_city: true,
              client: { select: { company_name: true, phone: true } },
              transportOwner: { select: { owner_name: true, company_name: true, mobile: true } },
              user: { select: { first_name: true, last_name: true, phone: true } },
            },
          },
          booking: { select: { booking_number: true, user: { select: { first_name: true, last_name: true, phone: true } } } },
          invoices: { select: { invoice_number: true } },
        },
        orderBy: [{ transaction_date: 'desc' }, { transaction_id: 'desc' }],
        take: MAX_SCAN,
      }),
      this.prisma.petrolPumpPayment.findMany({
        where: {
          payment_date: { gte: filters.dateFrom, lte: filters.dateTo },
          ...(filters.branch ? { pump: { is: { city: filters.branch } } } : {}),
        },
        select: {
          payment_id: true,
          payment_number: true,
          voucher_number: true,
          amount: true,
          payment_date: true,
          payment_method: true,
          reference_number: true,
          remarks: true,
          pump: { select: { pump_name: true } },
        },
        orderBy: [{ payment_date: 'desc' }, { payment_id: 'desc' }],
        take: MAX_SCAN,
      }),
      this.prisma.petrolPumpFuelTransaction.findMany({
        where: {
          fuel_date: { gte: filters.dateFrom, lte: filters.dateTo },
          ...(filters.branch ? { trip: { is: { pickup_city: filters.branch } } } : {}),
        },
        select: {
          transaction_id: true,
          total_amount: true,
          fuel_date: true,
          fuel_type: true,
          receipt_number: true,
          pump_id: true,
          trip_id: true,
          remarks: true,
          pump: { select: { pump_name: true } },
          trip: { select: { trip_number: true, pickup_city: true } },
          vehicle: { select: { vehicle_number: true } },
        },
        orderBy: [{ fuel_date: 'desc' }, { transaction_id: 'desc' }],
        take: MAX_SCAN,
      }),
      this._searchPartyIds(filters.search),
    ]);

    const ownerIds = [...new Set(transactions.map((t) => t.transport_owner_id).filter(Boolean))];
    const clientIds = [...new Set(transactions.map((t) => t.client_id).filter(Boolean))];
    const [owners, clients] = await Promise.all([
      ownerIds.length
        ? this.prisma.vehicleOwner.findMany({ where: { owner_id: { in: ownerIds } }, select: { owner_id: true, owner_name: true, company_name: true } })
        : [],
      clientIds.length
        ? this.prisma.client.findMany({ where: { client_id: { in: clientIds } }, select: { client_id: true, company_name: true, contact_person: true } })
        : [],
    ]);
    const ownerMap = new Map(owners.map((o) => [o.owner_id, o.company_name || o.owner_name]));
    const clientMap = new Map(clients.map((c) => [c.client_id, c.company_name || c.contact_person]));

    const rows = [];

    for (const t of transactions) {
      const meta = parseMetadata(t.metadata);
      const method = String(t.payment_method || '').toUpperCase();
      const isSettlementLeg = meta.kind === 'VENDOR_SETTLEMENT';
      const isFuelCredit = meta.kind === 'VENDOR_FUEL_CREDIT';
      const isCommissionReceipt = meta.kind === 'COMMISSION_RECEIPT';
      const direction = t.direction;
      const amount = roundMoney(num(t.amount));

      const user = t.trip?.user || t.booking?.user;
      const partyName =
        ownerMap.get(t.transport_owner_id) ||
        clientMap.get(t.client_id) ||
        t.trip?.client?.company_name ||
        t.trip?.transportOwner?.company_name ||
        t.trip?.transportOwner?.owner_name ||
        (user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : '') ||
        'Bihar Transport';

      let typeLabel = TRANSACTION_LABELS[t.transaction_type] || t.transaction_type;
      if (isSettlementLeg) typeLabel = 'Settlement';
      else if (isFuelCredit) typeLabel = 'Fuel Credit';
      else if (isCommissionReceipt) typeLabel = 'Commission Received';
      else if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'CUSTOMER_SETTLEMENT') typeLabel = 'Customer Settlement';

      const isCash = isCashMethod(method) && !isSettlementLeg && !isFuelCredit;

      let effectiveDirection = direction;
      if (t.transaction_type === 'ADJUSTMENT' && meta.kind === 'CUSTOMER_SETTLEMENT') effectiveDirection = 'CREDIT';

      rows.push({
        key: `tx-${t.transaction_id}`,
        id: t.transaction_id,
        kind: 'TRANSACTION',
        date: dateLabel(t.transaction_date || t.created_at),
        voucher_number: t.voucher_number || meta.voucher_number || t.reference_number || `TX-${t.transaction_id}`,
        party_name: partyName,
        party_type: t.transport_owner_id ? 'VENDOR' : t.client_id ? 'CLIENT' : 'CUSTOMER',
        party_id: t.transport_owner_id || t.client_id || null,
        trip_id: t.trip_id,
        trip_number: t.trip?.trip_number || null,
        booking_number: t.booking?.booking_number || null,
        branch: t.trip?.pickup_city || null,
        invoice_id: t.invoice_id,
        invoice_number: t.invoices?.invoice_number || null,
        type: t.transaction_type,
        type_label: typeLabel,
        mode: methodLabel(t.payment_method),
        payment_method: t.payment_method,
        reference_number: t.reference_number,
        debit: effectiveDirection === 'DEBIT' ? amount : 0,
        credit: effectiveDirection === 'CREDIT' ? amount : 0,
        amount,
        direction: effectiveDirection,
        cash: isCash,
        status: t.status,
        notes: t.notes || t.purpose,
        metadata: meta,
      });
    }

    for (const p of pumpPayments) {
      rows.push({
        key: `pp-${p.payment_id}`,
        id: p.payment_id,
        kind: 'PUMP_PAYMENT',
        date: dateLabel(p.payment_date),
        voucher_number: p.voucher_number || p.payment_number,
        party_name: p.pump?.pump_name || 'Petrol Pump',
        party_type: 'PETROL_PUMP',
        party_id: null,
        trip_id: null,
        trip_number: null,
        booking_number: null,
        branch: null,
        type: 'PETROL_PUMP_PAYMENT',
        type_label: 'Petrol Pump Payment',
        mode: methodLabel(p.payment_method),
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        debit: roundMoney(num(p.amount)),
        credit: 0,
        amount: roundMoney(num(p.amount)),
        direction: 'DEBIT',
        cash: isCashMethod(p.payment_method),
        status: 'PAID',
        notes: p.remarks,
        metadata: {},
      });
    }

    for (const f of pumpFuel) {
      rows.push({
        key: `pf-${f.transaction_id}`,
        id: f.transaction_id,
        kind: 'PUMP_FUEL',
        date: dateLabel(f.fuel_date),
        voucher_number: f.receipt_number || `FUEL-${f.transaction_id}`,
        party_name: f.pump?.pump_name || 'Petrol Pump',
        party_type: 'PETROL_PUMP',
        party_id: null,
        trip_id: f.trip_id,
        trip_number: f.trip?.trip_number || null,
        booking_number: null,
        branch: f.trip?.pickup_city || null,
        type: 'FUEL_TRANSACTION',
        type_label: 'Fuel Transaction',
        mode: 'Credit',
        payment_method: 'CREDIT',
        reference_number: f.receipt_number,
        debit: roundMoney(num(f.total_amount)),
        credit: 0,
        amount: roundMoney(num(f.total_amount)),
        direction: 'DEBIT',
        cash: false,
        status: 'POSTED',
        notes: f.remarks || (f.vehicle?.vehicle_number ? `${f.fuel_type} · ${f.vehicle.vehicle_number}` : f.fuel_type),
        metadata: {},
      });
    }

    let filtered = rows;

    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter((r) =>
        [r.voucher_number, r.party_name, r.trip_number, r.booking_number, r.invoice_number, r.reference_number, r.notes]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (filters.type) {
      filtered = filtered.filter((r) => r.type === filters.type || r.type_label.toUpperCase() === filters.type);
    }
    if (filters.mode) {
      filtered = filtered.filter((r) => String(r.payment_method || '').toUpperCase() === filters.mode);
    }
    if (filters.status) {
      filtered = filtered.filter((r) => String(r.status || '').toUpperCase() === filters.status);
    }
    // A search that matched a party id (vendor/client/user) but not a string
    // field still has to return its rows.
    if (filters.search && (partyIds.vendors.length || partyIds.clients.length || partyIds.users.length)) {
      const q = filters.search.toLowerCase();
      const extra = rows.filter((r) => {
        if (r.party_type === 'VENDOR' && partyIds.vendors.includes(r.party_id)) return true;
        return false;
      });
      const seen = new Set(filtered.map((r) => r.key));
      for (const r of extra) if (!seen.has(r.key)) filtered.push(r);
    }

    filtered = filtered.sort((a, b) => {
      const da = new Date(a.date || 0).getTime();
      const db = new Date(b.date || 0).getTime();
      if (da !== db) return db - da;
      return String(b.key).localeCompare(String(a.key));
    });

    const totals = {
      debit: roundMoney(filtered.reduce((s, r) => s + r.debit, 0)),
      credit: roundMoney(filtered.reduce((s, r) => s + r.credit, 0)),
      cashIn: roundMoney(filtered.filter((r) => r.cash && r.credit > 0).reduce((s, r) => s + r.credit, 0)),
      cashOut: roundMoney(filtered.filter((r) => r.cash && r.debit > 0).reduce((s, r) => s + r.debit, 0)),
      count: filtered.length,
    };

    const counts = filtered.reduce((acc, r) => {
      acc[r.type] = (acc[r.type] || 0) + 1;
      return acc;
    }, {});

    return { rows: filtered, totals, counts };
  }

  async getTransactionDetail(id, kind = 'TRANSACTION') {
    const numericId = Number(id);
    if (!Number.isInteger(numericId) || numericId <= 0) return null;

    if (kind === 'PUMP_PAYMENT') {
      return this.prisma.petrolPumpPayment.findUnique({
        where: { payment_id: numericId },
        include: { pump: true, bill: true },
      });
    }
    if (kind === 'PUMP_FUEL') {
      return this.prisma.petrolPumpFuelTransaction.findUnique({
        where: { transaction_id: numericId },
        include: { pump: true, trip: true, vehicle: true, driver: true, bill: true },
      });
    }

    const tx = await this.prisma.financialTransaction.findUnique({
      where: { transaction_id: numericId },
      include: {
        trip: { select: { trip_id: true, trip_number: true, pickup_city: true, status: true } },
        booking: { select: { booking_id: true, booking_number: true } },
        invoices: { select: { invoice_id: true, invoice_number: true } },
      },
    });
    if (!tx) return null;

    const [owner, client] = await Promise.all([
      tx.transport_owner_id
        ? this.prisma.vehicleOwner.findUnique({ where: { owner_id: tx.transport_owner_id }, select: { owner_id: true, owner_name: true, company_name: true, mobile: true } })
        : null,
      tx.client_id ? this.prisma.client.findUnique({ where: { client_id: tx.client_id }, select: { client_id: true, company_name: true, phone: true } }) : null,
    ]);

    return { ...tx, metadata_parsed: parseMetadata(tx.metadata), vendor: owner, client };
  }

  // =========================================================================
  // OVERVIEW / KPIs
  // =========================================================================

  async _kpis(filters) {
    const [receivables, vendors, advances, commission, receipts, pump, cashFlow] = await Promise.all([
      this._loadReceivables(filters),
      this._loadVendorData(filters),
      this._loadAdvances(filters),
      this._loadCommission(filters),
      this._loadReceipts(filters),
      this._loadPumpData(filters),
      this._loadCashFlow(filters, this._cashFlowMonths(filters)),
    ]);

    const obligations = roundMoney(
      receivables.totals.outstanding + vendors.totals.payable + pump.totals.outstanding,
    );
    const netCash = roundMoney(cashFlow.totals.inflow - cashFlow.totals.outflow);

    return {
      receivables,
      vendors,
      advances,
      commission,
      receipts,
      pump,
      cashFlow,
      unbilledTrips: receivables.unbilled.slice(0, 5),
      kpis: {
        customerReceivables: {
          value: receivables.totals.outstanding,
          billed: receivables.totals.billed,
          received: receivables.totals.received,
          invoiceCount: receivables.totals.invoiceCount,
          openCount: receivables.totals.openCount,
          overdue: receivables.totals.overdue,
          opening: receivables.totals.opening,
        },
        unbilledFreight: {
          value: receivables.totals.unbilled,
          trips: receivables.totals.unbilledCount,
        },
        totalReceived: {
          value: receipts.totals.cash,
          count: receipts.totals.cashCount,
          allReceipts: receipts.totals.total,
          nonCash: receipts.totals.nonCash,
        },
        vendorPayables: {
          value: vendors.totals.payable,
          receivable: vendors.totals.receivable,
          unpaidHire: vendors.totals.unpaid_hire,
          pendingCount: vendors.totals.pending_count,
        },
        advancesGiven: {
          value: advances.totals.outstanding,
          vendor: advances.totals.vendor,
          driver: advances.totals.driver,
          fuel: advances.totals.fuel,
          other: advances.totals.other,
          count: advances.totals.outstandingCount,
        },
        commissionEarned: {
          value: commission.totals.periodEarned,
          cumulative: commission.totals.earned,
          percentage: commission.totals.percentage,
          fixed: commission.totals.fixed,
          trips: commission.totals.periodTrips,
          received: commission.totals.received,
        },
        petrolPumpOutstanding: {
          value: pump.totals.outstanding,
          monthFuel: pump.totals.monthFuel,
          previousOutstanding: pump.totals.previousOutstanding,
          pumpsWithDues: pump.totals.pumpsWithDues,
        },
        netCashMovement: {
          value: netCash,
          inflow: cashFlow.totals.inflow,
          outflow: cashFlow.totals.outflow,
          obligations,
        },
      },
    };
  }

  async getOverview(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);
    const previous = this.previousPeriod(filters);

    const [current, prev] = await Promise.all([this._kpis(filters), this._kpis(previous)]);

    const withChange = (key, prevValue) => ({
      ...current.kpis[key],
      previous: prevValue,
      changePct: pctChange(current.kpis[key].value, prevValue),
    });

    const kpis = {
      customerReceivables: withChange('customerReceivables', prev.kpis.customerReceivables.value),
      unbilledFreight: withChange('unbilledFreight', prev.kpis.unbilledFreight.value),
      totalReceived: withChange('totalReceived', prev.kpis.totalReceived.value),
      vendorPayables: withChange('vendorPayables', prev.kpis.vendorPayables.value),
      advancesGiven: withChange('advancesGiven', prev.kpis.advancesGiven.value),
      commissionEarned: withChange('commissionEarned', prev.kpis.commissionEarned.value),
      petrolPumpOutstanding: withChange('petrolPumpOutstanding', prev.kpis.petrolPumpOutstanding.value),
      netCashMovement: withChange('netCashMovement', prev.kpis.netCashMovement.value),
    };
    kpis.customerReceivables.unbilled = current.kpis.unbilledFreight.value;
    kpis.customerReceivables.unbilledTrips = current.kpis.unbilledFreight.trips;

    const register = await this._transactionRegister({ ...filters, page: 1, limit: 10 });

    return {
      period: {
        from: dateLabel(filters.dateFrom),
        to: dateLabel(filters.dateTo),
        previous_from: dateLabel(previous.dateFrom),
        previous_to: dateLabel(previous.dateTo),
        branch: filters.branch,
        label: `${monthLabel(monthKey(filters.dateFrom))} – ${monthLabel(monthKey(filters.dateTo))}`,
      },
      kpis,
      cashFlow: current.cashFlow.series,
      unbilledTrips: current.unbilledTrips || [],
      cashFlowTotals: {
        ...current.cashFlow.totals,
        net: roundMoney(current.cashFlow.totals.inflow - current.cashFlow.totals.outflow),
      },
      comparison: {
        receivables: current.kpis.customerReceivables.value,
        payables: current.kpis.vendorPayables.value,
        advances: current.kpis.advancesGiven.value,
        pump: current.kpis.petrolPumpOutstanding.value,
        unbilled: current.kpis.unbilledFreight.value,
        periodReceipts: current.kpis.totalReceived.value,
        periodPayments: current.cashFlow.totals.outflow,
        netCash: current.kpis.netCashMovement.value,
        obligations: current.kpis.netCashMovement.obligations,
      },
      recentTransactions: register.rows.slice(0, 10),
      transactionCounts: register.counts,
      generated_at: new Date().toISOString(),
    };
  }

  // =========================================================================
  // BRANCHES & EXPORT
  // =========================================================================

  async getBranches() {
    const [trips, bookings] = await Promise.all([
      this.prisma.trip.groupBy({ by: ['pickup_city'], _count: { _all: true }, orderBy: { pickup_city: 'asc' } }),
      this.prisma.booking.groupBy({ by: ['pickup_city'], _count: { _all: true }, orderBy: { pickup_city: 'asc' } }),
    ]);
    const counts = new Map();
    for (const t of trips) {
      if (!t.pickup_city) continue;
      counts.set(t.pickup_city, (counts.get(t.pickup_city) || 0) + t._count._all);
    }
    for (const b of bookings) {
      if (!b.pickup_city) continue;
      counts.set(b.pickup_city, (counts.get(b.pickup_city) || 0) + b._count._all);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  async getShipmentSummary(rawFilters = {}) {
    const filters = this.normalizeFilters(rawFilters);

    const ordersWhere = {
      archived_at: null,
      created_at: { gte: filters.dateFrom, lte: filters.dateTo },
    };

    const completedWhere = {
      archived_at: null,
      delivered_at: { gte: filters.dateFrom, lte: filters.dateTo },
      status: { in: ['delivered', 'completed'] },
    };

    const inTransitWhere = {
      archived_at: null,
      pickup_completed_at: { gte: filters.dateFrom, lte: filters.dateTo },
      status: { in: ['confirmed', 'in_transit', 'pickup_completed'] },
    };

    const [orders, completed, inTransit] = await Promise.all([
      this.prisma.booking.count({ where: ordersWhere }),
      this.prisma.booking.count({ where: completedWhere }),
      this.prisma.booking.count({ where: inTransitWhere }),
    ]);

    const pendingPod = await this.prisma.tripDispatch.count({
      where: {
        pod_required: true,
        dispatched_at: { gte: filters.dateFrom, lte: filters.dateTo },
        trip: {
          status: { not: 'CANCELLED' },
          documents: {
            none: {
              document_type: 'POD',
              document_status: { in: ['PRESENT', 'VERIFIED'] },
            },
          },
        },
      },
    });

    return {
      orders,
      completed,
      inTransit,
      pendingPod,
      generated_at: new Date().toISOString(),
    };
  }

  async exportSection(section, rawFilters = {}) {
    const filters = this.normalizeFilters({ ...rawFilters, page: 1, limit: 500 });
    const generatedAt = new Date().toISOString();
    const heading = (columns, rows, totals = {}) => ({ columns, rows, totals, generated_at: generatedAt, filters });

    switch (section) {
      case 'overview': {
        const overview = await this.getOverview(filters);
        return heading(
          [
            { key: 'metric', label: 'Metric' },
            { key: 'value', label: 'Value (INR)' },
            { key: 'previous', label: 'Previous period (INR)' },
            { key: 'change', label: 'Change %' },
          ],
          Object.entries(overview.kpis).map(([key, kpi]) => ({
            metric: key,
            value: kpi.value,
            previous: kpi.previous ?? '',
            change: kpi.changePct ?? '',
          })),
          overview.kpis,
        );
      }
      case 'receivables':
      case 'client-due': {
        const data = await this.getReceivables({ ...filters, page: 1, limit: 500 });
        const rows = section === 'client-due'
          ? (await this.getClientDue({ ...filters, page: 1, limit: 500 })).rows
          : data.rows;
        return heading(
          [
            { key: 'invoice_number', label: 'Invoice' },
            { key: 'invoice_date', label: 'Date' },
            { key: 'due_date', label: 'Due date' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'trip_number', label: 'Trip' },
            { key: 'branch', label: 'Branch' },
            { key: 'total_amount', label: 'Invoice total' },
            { key: 'received', label: 'Received' },
            { key: 'outstanding', label: 'Outstanding' },
            { key: 'status', label: 'Status' },
          ],
          rows,
          data.summary,
        );
      }
      case 'payables': {
        const data = await this.getProviderPayables({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'mobile', label: 'Mobile' },
            { key: 'vehicle_numbers', label: 'Vehicles' },
            { key: 'gross_hire', label: 'Gross hire' },
            { key: 'commission', label: 'Commission' },
            { key: 'net_payable', label: 'Net payable' },
            { key: 'paid', label: 'Paid' },
            { key: 'fuel_credits', label: 'Fuel credit' },
            { key: 'balance', label: 'Balance' },
            { key: 'direction', label: 'Position' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'payments-received': {
        const data = await this.getPaymentsReceived({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'receipt_number', label: 'Receipt' },
            { key: 'date', label: 'Date' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'trip_number', label: 'Trip' },
            { key: 'invoice_number', label: 'Invoice' },
            { key: 'amount', label: 'Amount' },
            { key: 'payment_mode', label: 'Mode' },
            { key: 'reference_number', label: 'Reference' },
            { key: 'status', label: 'Status' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'advances': {
        const data = await this.getAdvances({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'voucher_number', label: 'Voucher' },
            { key: 'date', label: 'Date' },
            { key: 'party_name', label: 'Party' },
            { key: 'category', label: 'Category' },
            { key: 'amount', label: 'Amount' },
            { key: 'adjusted_amount', label: 'Adjusted' },
            { key: 'outstanding', label: 'Outstanding' },
            { key: 'payment_mode', label: 'Mode' },
            { key: 'trip_number', label: 'Trip' },
            { key: 'status', label: 'Status' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'commission': {
        const data = await this.getCommission({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'trip_number', label: 'Trip' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'vendor_name', label: 'Vendor' },
            { key: 'vehicle_number', label: 'Vehicle' },
            { key: 'gross_hire', label: 'Gross hire' },
            { key: 'commission_type', label: 'Type' },
            { key: 'commission_rate', label: 'Rate' },
            { key: 'commission_amount', label: 'Commission' },
            { key: 'received', label: 'Received' },
            { key: 'remaining', label: 'Remaining' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'settlements': {
        const data = await this.getSettlements({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'voucher_number', label: 'Voucher' },
            { key: 'date', label: 'Date' },
            { key: 'party_name', label: 'Party' },
            { key: 'party_type', label: 'Party type' },
            { key: 'trip_number', label: 'Trip' },
            { key: 'debit', label: 'Debit' },
            { key: 'credit', label: 'Credit' },
            { key: 'amount', label: 'Amount' },
            { key: 'reference', label: 'Reference' },
            { key: 'status', label: 'Status' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'petrol-pump': {
        const data = await this.getPetrolPump({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'pump_name', label: 'Pump' },
            { key: 'pump_code', label: 'Code' },
            { key: 'city', label: 'City' },
            { key: 'credit_limit', label: 'Credit limit' },
            { key: 'opening', label: 'Opening' },
            { key: 'month_fuel', label: 'This period fuel' },
            { key: 'previous_outstanding', label: 'Previous outstanding' },
            { key: 'total_paid', label: 'Paid' },
            { key: 'outstanding', label: 'Outstanding' },
          ],
          data.rows,
          data.summary,
        );
      }
      case 'transactions': {
        const data = await this.getTransactions({ ...filters, page: 1, limit: 500 });
        return heading(
          [
            { key: 'date', label: 'Date' },
            { key: 'voucher_number', label: 'Voucher' },
            { key: 'party_name', label: 'Party' },
            { key: 'trip_number', label: 'Trip' },
            { key: 'type_label', label: 'Type' },
            { key: 'mode', label: 'Mode' },
            { key: 'debit', label: 'Debit' },
            { key: 'credit', label: 'Credit' },
            { key: 'status', label: 'Status' },
          ],
          data.rows,
          data.summary,
        );
      }
      default:
        throw new Error(`Unknown finance export section "${section}"`);
    }
  }

  // =========================================================================
  // PAGINATION
  // =========================================================================

  _paginate(rows, filters, extra = {}) {
    const total = rows.length;
    const pages = Math.max(1, Math.ceil(total / filters.limit));
    const page = Math.min(Math.max(1, filters.page), pages);
    const start = (page - 1) * filters.limit;
    return {
      rows: rows.slice(start, start + filters.limit),
      pagination: { page, limit: filters.limit, total, pages },
      ...extra,
    };
  }
}

module.exports = FinanceReportingService;
module.exports.FinanceReportingService = FinanceReportingService;
module.exports.TRANSACTION_LABELS = TRANSACTION_LABELS;

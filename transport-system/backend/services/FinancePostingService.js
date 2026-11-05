/**
 * FinancePostingService
 * ---------------------------------------------------------------------------
 * THE WRITE SIDE OF THE FINANCE MODULE.
 *
 * Every method here is a POSTING: it writes the document, the canonical
 * FinancialTransaction row(s), the originating operational record (invoice
 * status, advance, pump ledger, vehicle-hire payment history) and the audit
 * entry inside ONE database transaction. If any step throws, all of it rolls
 * back — a half-posted financial event cannot be committed.
 *
 * SAFETY AGAINST DOUBLE POSTING
 *   1. `FinancialTransaction.idempotency_key` is a UNIQUE column. A retried
 *      request with the same key can never create a second ledger row.
 *   2. Every posting locks its Trip/Booking row (`SELECT … FOR UPDATE`) before
 *      writing, so two different idempotency keys racing on the same trip
 *      serialise rather than interleave.
 *   3. Voucher numbers come from DocumentNumberService's atomic counter, not
 *      from `count() + 1`.
 *
 * WHAT IS INTENTIONALLY REUSED
 *   • TripInvoiceService.reconcileInvoiceStatus — the one invoice reconciler
 *   • TripAdvanceService.createAdvance         — the one advance writer
 *   • PetrolPumpRepository                     — the one pump ledger writer
 *   • TripFinancial / FinancialTransaction     — the one money ledger
 *   No parallel accounting table is introduced.
 *
 * NON-CASH SETTLEMENTS
 *   A vendor settlement is TWO ADJUSTMENT legs: DEBIT against the trip payable
 *   and CREDIT against the vendor's previous balance. The two legs cancel in
 *   the signed vendor balance, so the net position is unchanged — only the
 *   classification moves. No cash row is written.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../utils/AppError');
const DocumentNumberService = require('./DocumentNumberService');
const TripInvoiceService = require('./TripInvoiceService');
const TripAdvanceService = require('./TripAdvanceService');
const TripFinancialRepository = require('../repositories/TripFinancialRepository');
const JournalService = require('./JournalService');
const PetrolPumpRepository = require('../repositories/PetrolPumpRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const { parseMetadata, roundMoney, num, invoiceTotal } = require('./finance/financeUtils');
const money = require('./finance/money');

const PAYMENT_METHODS = Object.freeze(['CASH', 'BANK', 'UPI', 'CHEQUE', 'SETTLEMENT']);
const WRITER_ROLES = new Set(['admin', 'super_admin']);

const METHOD_ALIASES = Object.freeze({
  BANK_TRANSFER: 'BANK',
  ONLINE: 'BANK',
  RAZORPAY: 'BANK',
  STRIPE: 'BANK',
});

function normalizeMethod(value) {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase().replace(/\s+/g, '_');
  return METHOD_ALIASES[raw] || raw;
}

function pumpMethod(value) {
  const method = normalizeMethod(value) || 'BANK_TRANSFER';
  if (method === 'BANK') return 'BANK_TRANSFER';
  if (['CASH', 'BANK_TRANSFER', 'UPI', 'CHEQUE', 'OTHER'].includes(method)) return method;
  return 'OTHER';
}

class FinancePostingService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.documentNumbers = deps.documentNumbers || new DocumentNumberService({ prisma: this.prisma });
    this.tripFinancialRepo = deps.tripFinancialRepo || new TripFinancialRepository();
    this.pumpRepo = deps.pumpRepo || new PetrolPumpRepository();
    this.auditRepo = deps.auditRepo || new AuditLogRepository({ prisma: this.prisma });
    this.tripAdvanceService = deps.tripAdvanceService || new TripAdvanceService({ prisma: this.prisma });
    this.journalService = deps.journalService || new JournalService({ prisma: this.prisma });
  }

  /**
   * Run a callback inside a Prisma interactive transaction with a longer
   * timeout than the default 5000ms. Finance postings perform multiple
   * queries, raw SQL, and cross-service calls against a remote Neon database;
   * the default timeout is too short and causes spurious
   * "Transaction already closed" errors.
   */
  async _tx(fn, options = {}) {
    return this.prisma.$transaction(fn, {
      max_wait: 15000,
      timeout: 15000,
      ...options,
    });
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  _actor(actor) {
    if (!actor || !WRITER_ROLES.has(String(actor.role))) {
      throw new ForbiddenError({ message: 'Only an admin or super admin may post financial transactions' });
    }
    return actor;
  }

  _positive(value, field = 'amount') {
    let paise;
    try {
      paise = money.toPaiseStrict(value, { allowNegative: false });
    } catch (e) {
      throw new ValidationError(`A positive ${field} is required (received "${value}")`);
    }
    if (paise <= 0) {
      throw new ValidationError(`A positive ${field} is required (received "${value}")`);
    }
    return money.fromPaise(paise);
  }

  _nonNegative(value, field = 'amount') {
    if (value === undefined || value === null || value === '') return 0;
    let paise;
    try {
      paise = money.toPaiseStrict(value, { allowNegative: false });
    } catch (e) {
      throw new ValidationError(`A non-negative ${field} is required (received "${value}")`);
    }
    if (paise < 0) {
      throw new ValidationError(`A non-negative ${field} is required (received "${value}")`);
    }
    return money.fromPaise(paise);
  }

  _method(value, { allowSettlement = true } = {}) {
    const method = normalizeMethod(value);
    if (!method) throw new ValidationError('A payment_method is required');
    const allowed = allowSettlement ? PAYMENT_METHODS : PAYMENT_METHODS.filter((m) => m !== 'SETTLEMENT');
    if (!allowed.includes(method)) {
      throw new ValidationError(`Invalid payment_method "${value}". Expected one of: ${allowed.join(', ')}`);
    }
    return method;
  }

  _date(value, field = 'transaction_date') {
    if (!value) return new Date();
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${field} "${value}"`);
    return d;
  }

  _reference(method, reference, label = 'reference') {
    if ((method === 'BANK' || method === 'SETTLEMENT') && !reference) {
      throw new ValidationError(`A ${method.toLowerCase()} posting requires the ${label} / UTR`);
    }
    return reference ? String(reference).trim() : null;
  }

  _idempotencyKey(value) {
    if (value === undefined || value === null || value === '') return null;
    const key = String(value).trim();
    if (key.length < 8 || key.length > 120) {
      throw new ValidationError('idempotency_key must be between 8 and 120 characters');
    }
    return key;
  }

  // =========================================================================
  // INTERNAL HELPERS
  // =========================================================================

  _isTransientError(error) {
    const code = error?.code;
    const metaCode = error?.meta?.code || error?.meta?.database_error_code;
    const message = String(error?.message || '');
    return (
      code === 'P2034' ||
      code === '40001' ||
      code === '40P01' ||
      metaCode === '40001' ||
      metaCode === '40P01' ||
      message.includes('P2034') ||
      message.includes('40001') ||
      message.includes('40P01') ||
      /serialization failure/i.test(message) ||
      /deadlock detected/i.test(message)
    );
  }

  async _lock(tx, { tripId = null, bookingId = null }) {
    if (tripId) {
      await tx.$queryRawUnsafe('SELECT trip_id FROM trips WHERE trip_id = $1 FOR UPDATE', Number(tripId));
    } else if (bookingId) {
      await tx.$queryRawUnsafe('SELECT booking_id FROM bookings WHERE booking_id = $1 FOR UPDATE', Number(bookingId));
    }
  }

  async _ensureTripFinancial(tx, { trip = null, bookingId = null, customerFare = 0 }) {
    if (trip) {
      const existing = await tx.tripFinancial.findFirst({
        where: { trip_id: trip.trip_id },
        orderBy: { trip_financial_id: 'desc' },
      });
      if (existing) return existing;

      // A booking-level TripFinancial may already exist (the invoice service
      // creates one when a booking is billed before a trip is assigned).
      // Reuse it rather than violating the unique booking_id constraint.
      if (trip.booking_id) {
        const byBooking = await tx.tripFinancial.findUnique({ where: { booking_id: trip.booking_id } });
        if (byBooking) {
          if (!byBooking.trip_id) {
            return await tx.tripFinancial.update({
              where: { trip_financial_id: byBooking.trip_financial_id },
              data: { trip_id: trip.trip_id, updated_at: new Date() },
            });
          }
          return byBooking;
        }
      }

      return tx.tripFinancial.create({
        data: {
          trip_id: trip.trip_id,
          booking_id: trip.booking_id || null,
          status: 'DRAFT',
          customer_fare: num(customerFare) || num(trip.freight_amount) || 0,
        },
      });
    }

    if (bookingId) {
      const existing = await tx.tripFinancial.findUnique({ where: { booking_id: Number(bookingId) } });
      if (existing) return existing;
      return tx.tripFinancial.create({
        data: {
          booking_id: Number(bookingId),
          status: 'DRAFT',
          customer_fare: num(customerFare) || 0,
        },
      });
    }

    throw new ValidationError('A trip or booking is required to anchor this financial posting');
  }

  async _audit(tx, actor, { action, entityType, entityId, previous = null, next = null, reason = null }) {
    return this.auditRepo.create(
      {
        user_id: actor?.user_id || actor?.admin_id || null,
        user_role: String(actor?.role || 'system'),
        action,
        entity_type: entityType,
        entity_id: Number(entityId),
        previous_value: previous ? JSON.stringify(previous) : null,
        new_value: next ? JSON.stringify(next) : null,
        reason: reason || null,
      },
      tx,
    );
  }

  async _existingByIdempotency(tx, key) {
    if (!key) return null;
    return tx.financialTransaction.findUnique({
      where: { idempotency_key: key },
      include: { invoices: { select: { invoice_number: true, invoice_id: true } } },
    });
  }

  async _resolveInvoice({ invoiceId = null, tripId = null, bookingId = null }) {
    if (invoiceId) {
      const invoice = await this.prisma.invoice.findUnique({ where: { invoice_id: Number(invoiceId) } });
      if (!invoice) throw new NotFoundError({ message: 'Invoice not found' });
      return invoice;
    }
    if (tripId) {
      const trip = await this.prisma.trip.findUnique({ where: { trip_id: Number(tripId) }, select: { booking_id: true } });
      let invoice = await this.prisma.invoice.findFirst({ where: { trip_id: Number(tripId) }, orderBy: { invoice_id: 'desc' } });
      if (!invoice && trip?.booking_id) {
        invoice = await this.prisma.invoice.findFirst({ where: { booking_id: trip.booking_id }, orderBy: { invoice_id: 'desc' } });
      }
      return invoice || null;
    }
    if (bookingId) {
      return this.prisma.invoice.findFirst({ where: { booking_id: Number(bookingId) }, orderBy: { invoice_id: 'desc' } });
    }
    return null;
  }

  async _resolveTrip({ tripId = null, invoice = null, bookingId = null }) {
    if (tripId) {
      const trip = await this.prisma.trip.findUnique({ where: { trip_id: Number(tripId) } });
      if (!trip) throw new NotFoundError({ message: 'Trip not found' });
      return trip;
    }
    if (invoice?.trip_id) {
      return this.prisma.trip.findUnique({ where: { trip_id: invoice.trip_id } });
    }
    const booking = invoice?.booking_id || bookingId;
    if (booking) {
      return this.prisma.trip.findFirst({ where: { booking_id: Number(booking) }, orderBy: { trip_id: 'desc' } });
    }
    return null;
  }

  _voucher(metadata, fallback) {
    const meta = parseMetadata(metadata);
    return meta.voucher_number || fallback;
  }

  // =========================================================================
  // CUSTOMER RECEIPTS
  // =========================================================================

  /**
   * POST a money receipt against an invoice (or a trip/booking whose invoice
   * is unambiguous). Supports partial payments; the invoice is reconciled
   * from the ledger in the same transaction.
   */
  async recordCustomerReceipt(input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'receipt amount');
    const method = this._method(input.payment_method);
    const reference = this._reference(method, input.reference_number);
    const transactionDate = this._date(input.transaction_date, 'transaction_date');
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const invoice = await this._resolveInvoice({
      invoiceId: input.invoice_id,
      tripId: input.trip_id,
      bookingId: input.booking_id,
    });
    if (!invoice) {
      throw new ValidationError('A customer receipt must be allocated to an invoice (or a trip/booking that has one)');
    }
    if (invoice.status === 'CANCELLED') throw new ValidationError('A cancelled invoice cannot receive payment');

    const trip = await this._resolveTrip({ tripId: input.trip_id, invoice });
    const bookingId = invoice.booking_id || trip?.booking_id || input.booking_id || null;

    const run = async () => this._tx(async (tx) => {
      const existing = await this._existingByIdempotency(tx, idempotencyKey);
      if (existing) {
        // Idempotency payload conflict: the same key may not be reused with a
        // different monetary target. Reject instead of silently returning the
        // original receipt.
        const sameAmount = money.eq(existing.amount, amount);
        const sameInvoice = Number(existing.invoice_id) === Number(invoice.invoice_id);
        const sameMethod = String(existing.payment_method || '').toUpperCase() === method;
        if (!sameAmount || !sameInvoice || !sameMethod) {
          throw new ConflictError({
            message: 'idempotency_key already used with a different receipt payload',
            details: [{ field: 'idempotency_key' }],
          });
        }
        const recon = await TripInvoiceService.reconcileInvoiceStatus({
          prisma: tx,
          invoiceId: invoice.invoice_id,
          now: new Date(),
        });
        return {
          transaction: existing,
          invoice: recon.invoice,
          already_recorded: true,
          voucher_number: existing.voucher_number,
          received: recon.received,
          balance: recon.balance,
          payment_status: recon.paymentStatus,
        };
      }

      await this._lock(tx, { tripId: trip?.trip_id, bookingId });

      // Lock the invoice row so concurrent receipts against the same invoice
      // cannot both read the same outstanding balance and over-allocate it.
      if (invoice?.invoice_id) {
        await tx.$queryRawUnsafe('SELECT invoice_id FROM invoices WHERE invoice_id = $1 FOR UPDATE', Number(invoice.invoice_id));
      }

      // Over-allocation guard: the combined posted receipts (including this
      // one) may not exceed the invoice total. The invoice row lock above makes
      // this check safe against concurrent receipts.
      const priorReceipts = await tx.financialTransaction.findMany({
        where: {
          invoice_id: invoice.invoice_id,
          transaction_type: { in: ['CUSTOMER_PAYMENT', 'CLIENT_PAYMENT'] },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
        select: { amount: true },
      });
      const priorPaise = priorReceipts.reduce((sum, r) => sum + money.toPaise(r.amount || 0), 0);
      const totalPaise = money.toPaise(invoiceTotal(invoice));
      if (priorPaise + money.toPaise(amount) > totalPaise) {
        throw new ValidationError(
          `Receipt (₹${amount}) would exceed the outstanding invoice balance (₹${money.fromPaise(Math.max(0, totalPaise - priorPaise))})`,
        );
      }

      const tripFinancial = await this._ensureTripFinancial(tx, {
        trip,
        bookingId,
        customerFare: invoiceTotal(invoice),
      });

      const voucher = await this.documentNumbers.next('MONEY_RECEIPT', { tx, date: transactionDate });
      const now = new Date();

      const transaction = await tx.financialTransaction.create({
        data: {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: bookingId ? Number(bookingId) : null,
          trip_id: trip?.trip_id || null,
          client_id: trip?.client_id || null,
          vehicle_id: trip?.vehicle_id || null,
          driver_id: trip?.driver_id || null,
          transaction_type: trip?.client_id ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT',
          amount,
          direction: 'CREDIT',
          from_party: trip?.client_id ? 'CLIENT' : 'CUSTOMER',
          to_party: 'BIHAR_TRANSPORT',
          purpose: `Customer receipt against ${invoice.invoice_number}`,
          payment_method: method,
          reference_number: reference,
          transaction_date: transactionDate,
          status: 'PAID',
          invoice_id: invoice.invoice_id,
          voucher_number: voucher.number,
          idempotency_key: idempotencyKey,
          notes: input.notes || null,
          created_by: actor?.user_id || actor?.admin_id || null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify({
            kind: 'CUSTOMER_RECEIPT',
            voucher_number: voucher.number,
            bank_name: input.bank_name || null,
            utr: reference,
            source: 'FINANCE_MODULE',
          }),
        },
      });

      const recon = await TripInvoiceService.reconcileInvoiceStatus({
        prisma: tx,
        invoiceId: invoice.invoice_id,
        now,
      });

      await this.journalService.postJournal({
        reference: `JRN-${voucher.number}`,
        posting_date: transactionDate,
        source_type: 'CUSTOMER_RECEIPT',
        source_id: transaction.transaction_id,
        created_by: actor?.user_id || actor?.admin_id || null,
        tx,
        lines: [
          { account_code: method === 'SETTLEMENT' ? 'SETTLEMENT_ADJUSTMENT' : (method === 'CASH' ? 'CASH' : 'BANK'), direction: 'DEBIT', amount },
          { account_code: 'ACCOUNTS_RECEIVABLE', direction: 'CREDIT', amount },
        ],
      });

      await this._audit(tx, actor, {
        action: 'customer_receipt_posted',
        entityType: 'FinancialTransaction',
        entityId: transaction.transaction_id,
        previous: { invoice_status: invoice.status, payment_status: invoice.payment_status },
        next: {
          voucher_number: voucher.number,
          amount,
          invoice_number: invoice.invoice_number,
          payment_status: recon.paymentStatus,
          balance: recon.balance,
        },
        reason: input.notes || null,
      });

      return {
        transaction,
        invoice: recon.invoice,
        voucher_number: voucher.number,
        received: recon.received,
        balance: recon.balance,
        payment_status: recon.paymentStatus,
      };
    });

    // Safe bounded retry for transient transaction failures. Validation and
    // business-rule conflicts are never retried.
    let attempt = 0;
    const maxAttempts = 3;
    while (true) {
      try {
        return await run();
      } catch (error) {
        attempt += 1;
        if (attempt >= maxAttempts || !this._isTransientError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }

  // =========================================================================
  // VENDOR PAYMENTS (cash + fuel component)
  // =========================================================================

  async recordVendorPayment(input = {}, actor = null) {
    this._actor(actor);
    const cashAmount = this._nonNegative(input.amount, 'cash amount');
    const fuelAmount = this._nonNegative(input.fuel_amount, 'fuel amount');
    const total = roundMoney(cashAmount + fuelAmount);
    if (total <= 0) throw new ValidationError('A vendor payment needs a cash amount, a fuel amount, or both');

    const method = cashAmount > 0 ? this._method(input.payment_method, { allowSettlement: false }) : 'FUEL_CREDIT';
    const reference = cashAmount > 0 ? this._reference(method, input.reference_number) : null;
    const transactionDate = this._date(input.transaction_date, 'transaction_date');
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const trip = input.trip_id
      ? await this.prisma.trip.findUnique({ where: { trip_id: Number(input.trip_id) } })
      : null;
    if (input.trip_id && !trip) throw new NotFoundError({ message: 'Trip not found' });

    const hire = trip
      ? await this.prisma.vehicleHire.findUnique({ where: { trip_id: trip.trip_id }, include: { vendor: true } })
      : null;

    const vendorId = Number(input.vendor_id || trip?.transport_owner_id || hire?.vendor_id || 0);
    if (!vendorId) throw new ValidationError('A vendor_id (or a trip with an assigned vendor) is required');

    const vendor = await this.prisma.vehicleOwner.findUnique({ where: { owner_id: vendorId } });
    if (!vendor) throw new NotFoundError({ message: 'Vendor not found' });

    let pump = null;
    if (fuelAmount > 0) {
      if (!input.petrol_pump_id) throw new ValidationError('petrol_pump_id is required when a fuel component is included');
      pump = await this.prisma.petrolPump.findUnique({ where: { pump_id: Number(input.petrol_pump_id) } });
      if (!pump) throw new NotFoundError({ message: 'Petrol pump not found' });
    }

    const result = await this._tx(async (tx) => {
      const existing = await this._existingByIdempotency(tx, idempotencyKey);
      if (existing) {
        const expectedAmount = cashAmount > 0 ? cashAmount : fuelAmount;
        if (!money.eq(existing.amount, expectedAmount) || Number(existing.transport_owner_id) !== vendorId) {
          throw new ConflictError({ message: 'idempotency_key already used with a different vendor payment payload' });
        }
        return { transaction: existing, voucher_number: existing.voucher_number, already_recorded: true };
      }

      await this._lock(tx, { tripId: trip?.trip_id, bookingId: trip?.booking_id });

      const tripFinancial = trip
        ? await this._ensureTripFinancial(tx, { trip })
        : await tx.tripFinancial.create({
          data: { status: 'DRAFT', customer_fare: 0, notes: 'FINANCE_PARTY_LEVEL' },
        });

      const voucher = await this.documentNumbers.next('PAYMENT_VOUCHER', { tx, date: transactionDate });
      const now = new Date();
      const baseMetadata = {
        kind: 'VENDOR_PAYMENT',
        voucher_number: voucher.number,
        vendor_id: vendorId,
        vendor_name: vendor.company_name || vendor.owner_name,
        cash_amount: cashAmount,
        fuel_amount: fuelAmount,
        total_benefit: total,
        utr: reference,
        bank_name: input.bank_name || null,
        is_advance: Boolean(input.is_advance),
        petrol_pump_id: pump?.pump_id || null,
      };

      const rows = [];

      if (cashAmount > 0) {
        const cashRow = await tx.financialTransaction.create({
          data: {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: trip?.booking_id || null,
            trip_id: trip?.trip_id || null,
            vehicle_id: trip?.vehicle_id || hire?.vehicle_id || null,
            driver_id: trip?.driver_id || hire?.driver_id || null,
            transport_owner_id: vendorId,
            transaction_type: input.is_advance ? 'OWNER_ADVANCE' : 'OWNER_SETTLEMENT',
            amount: cashAmount,
            direction: 'DEBIT',
            from_party: 'BIHAR_TRANSPORT',
            to_party: 'VENDOR',
            purpose: input.is_advance ? 'Vendor advance' : 'Vendor payment',
            payment_method: method,
            reference_number: reference,
            transaction_date: transactionDate,
            status: 'PAID',
            notes: input.notes || null,
            created_by: actor?.user_id || actor?.admin_id || null,
            created_at: now,
            updated_at: now,
            voucher_number: cashAmount === total ? voucher.number : null,
            idempotency_key: cashAmount === total ? idempotencyKey : null,
            metadata: JSON.stringify(baseMetadata),
          },
        });
        rows.push(cashRow);
      }

      let fuelAdjustment = null;
      let pumpFuel = null;
      if (fuelAmount > 0) {
        const fuelVoucher = cashAmount > 0 ? `${voucher.number}-F` : voucher.number;
        fuelAdjustment = await tx.financialTransaction.create({
          data: {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: trip?.booking_id || null,
            trip_id: trip?.trip_id || null,
            vehicle_id: trip?.vehicle_id || hire?.vehicle_id || null,
            driver_id: trip?.driver_id || hire?.driver_id || null,
            transport_owner_id: vendorId,
            transaction_type: 'ADJUSTMENT',
            amount: fuelAmount,
            direction: 'DEBIT',
            from_party: 'BIHAR_TRANSPORT',
            to_party: 'VENDOR',
            purpose: `Fuel credit on behalf of vendor · ${pump.pump_name}`,
            payment_method: 'FUEL_CREDIT',
            reference_number: fuelVoucher,
            transaction_date: transactionDate,
            status: 'PAID',
            notes: input.notes || null,
            created_by: actor?.user_id || actor?.admin_id || null,
            created_at: now,
            updated_at: now,
            voucher_number: cashAmount > 0 ? null : voucher.number,
            idempotency_key: cashAmount > 0 ? null : idempotencyKey,
            metadata: JSON.stringify({
              ...baseMetadata,
              kind: 'VENDOR_FUEL_CREDIT',
              voucher_number: voucher.number,
              fuel_voucher: fuelVoucher,
              pump_name: pump.pump_name,
            }),
          },
        });
        rows.push(fuelAdjustment);

        const litres = Number(input.fuel_litres);
        const rate = Number(input.fuel_rate);
        const safeLitres = Number.isFinite(litres) && litres > 0 ? litres : 1;
        const safeRate = Number.isFinite(rate) && rate > 0 ? rate : roundMoney(fuelAmount / safeLitres);

        pumpFuel = await this.pumpRepo.createFuelTransaction(
          {
            pump_id: pump.pump_id,
            trip_id: trip?.trip_id || null,
            vehicle_id: trip?.vehicle_id || hire?.vehicle_id || null,
            driver_id: trip?.driver_id || hire?.driver_id || null,
            fuel_date: transactionDate,
            fuel_type: input.fuel_type || 'DIESEL',
            litres: safeLitres,
            rate_per_litre: safeRate,
            total_amount: fuelAmount,
            receipt_number: input.fuel_receipt_number || `VC-${voucher.number}`,
            remarks: `Vendor fuel credit · ${vendor.company_name || vendor.owner_name}${input.notes ? ` · ${input.notes}` : ''}`,
            created_by: actor?.user_id || actor?.admin_id || null,
          },
          tx,
        );

        // Fuel supplied on credit increases what BT owes the pump. The
        // repository historically did not maintain this on the fuel write
        // path; the posting service does it atomically here.
        await tx.petrolPump.update({
          where: { pump_id: pump.pump_id },
          data: { current_balance: { increment: fuelAmount }, updated_at: now },
        });
      }

      const vendorJournalLines = [];
      if (cashAmount > 0) {
        vendorJournalLines.push({ account_code: 'VENDOR_PAYABLE', direction: 'DEBIT', amount: cashAmount });
        vendorJournalLines.push({ account_code: method === 'CASH' ? 'CASH' : 'BANK', direction: 'CREDIT', amount: cashAmount });
      }
      if (fuelAmount > 0) {
        vendorJournalLines.push({ account_code: 'VENDOR_PAYABLE', direction: 'DEBIT', amount: fuelAmount });
        vendorJournalLines.push({ account_code: 'PETROL_PUMP_PAYABLE', direction: 'CREDIT', amount: fuelAmount });
      }
      await this.journalService.postJournal({
        reference: `JRN-${voucher.number}`,
        posting_date: transactionDate,
        source_type: 'VENDOR_PAYMENT',
        source_id: rows[0].transaction_id,
        created_by: actor?.user_id || actor?.admin_id || null,
        tx,
        lines: vendorJournalLines,
      });

      await this._audit(tx, actor, {
        action: 'vendor_payment_posted',
        entityType: 'FinancialTransaction',
        entityId: rows[0].transaction_id,
        next: {
          voucher_number: voucher.number,
          vendor_id: vendorId,
          trip_id: trip?.trip_id || null,
          cash_amount: cashAmount,
          fuel_amount: fuelAmount,
          total_benefit: total,
          pump_id: pump?.pump_id || null,
        },
        reason: input.notes || null,
      });

      return {
        transaction: rows[0],
        transactions: rows,
        fuel_adjustment: fuelAdjustment,
        pump_fuel: pumpFuel,
        voucher_number: voucher.number,
        cash_amount: cashAmount,
        fuel_amount: fuelAmount,
        total_benefit: total,
      };
    });

    return result;
  }

  // =========================================================================
  // COMMISSION RECEIPTS
  // =========================================================================

  async recordCommissionReceipt(input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'commission amount');
    const method = this._method(input.payment_method);
    const reference = this._reference(method, input.reference_number);
    const transactionDate = this._date(input.transaction_date);
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const trip = input.trip_id
      ? await this.prisma.trip.findUnique({ where: { trip_id: Number(input.trip_id) } })
      : null;
    if (input.trip_id && !trip) throw new NotFoundError({ message: 'Trip not found' });

    const hire = trip
      ? await this.prisma.vehicleHire.findUnique({ where: { trip_id: trip.trip_id }, include: { vendor: true } })
      : null;

    const vendorId = Number(input.vendor_id || trip?.transport_owner_id || hire?.vendor_id || 0);
    if (!vendorId) throw new ValidationError('A vendor is required for a commission receipt');
    const vendor = await this.prisma.vehicleOwner.findUnique({ where: { owner_id: vendorId } });
    if (!vendor) throw new NotFoundError({ message: 'Vendor not found' });

    return this._tx(async (tx) => {
      const existing = await this._existingByIdempotency(tx, idempotencyKey);
      if (existing) return { transaction: existing, voucher_number: existing.voucher_number, already_recorded: true };

      await this._lock(tx, { tripId: trip?.trip_id, bookingId: trip?.booking_id });
      const tripFinancial = await this._ensureTripFinancial(tx, { trip });

      const voucher = await this.documentNumbers.next('MONEY_RECEIPT', { tx, date: transactionDate });
      const now = new Date();

      const transaction = await tx.financialTransaction.create({
        data: {
          trip_financial_id: tripFinancial.trip_financial_id,
          booking_id: trip?.booking_id || null,
          trip_id: trip?.trip_id || null,
          client_id: null,
          vehicle_id: trip?.vehicle_id || hire?.vehicle_id || null,
          driver_id: trip?.driver_id || hire?.driver_id || null,
          transport_owner_id: vendorId,
          transaction_type: 'COMMISSION',
          amount,
          direction: 'CREDIT',
          from_party: 'VENDOR',
          to_party: 'BIHAR_TRANSPORT',
          purpose: 'Commission received',
          payment_method: method,
          reference_number: reference,
          transaction_date: transactionDate,
          status: 'PAID',
          notes: input.notes || null,
          created_by: actor?.user_id || actor?.admin_id || null,
          created_at: now,
          updated_at: now,
          voucher_number: voucher.number,
          idempotency_key: idempotencyKey,
          metadata: JSON.stringify({
            kind: 'COMMISSION_RECEIPT',
            voucher_number: voucher.number,
            vendor_id: vendorId,
            vendor_name: vendor.company_name || vendor.owner_name,
            hire_id: hire?.hire_id || null,
          }),
        },
      });

      await this.journalService.postJournal({
        reference: `JRN-${voucher.number}`,
        posting_date: transactionDate,
        source_type: 'COMMISSION_RECEIPT',
        source_id: transaction.transaction_id,
        created_by: actor?.user_id || actor?.admin_id || null,
        tx,
        lines: [
          { account_code: method === 'CASH' ? 'CASH' : 'BANK', direction: 'DEBIT', amount },
          { account_code: 'COMMISSION_INCOME', direction: 'CREDIT', amount },
        ],
      });

      await this._audit(tx, actor, {
        action: 'commission_receipt_posted',
        entityType: 'FinancialTransaction',
        entityId: transaction.transaction_id,
        next: { voucher_number: voucher.number, amount, vendor_id: vendorId, trip_id: trip?.trip_id || null },
        reason: input.notes || null,
      });

      return { transaction, voucher_number: voucher.number, amount };
    });
  }

  // =========================================================================
  // ADVANCES
  // =========================================================================

  /**
   * Record an advance.
   *
   * VENDOR / DRIVER / FUEL advances are money OUT and are written through
   * TripAdvanceService (the existing canonical advance writer). CUSTOMER
   * advances are money IN and are written as a CUSTOMER_PAYMENT carrying an
   * explicit `CUSTOMER_ADVANCE` marker; the receivables allocator deliberately
   * does NOT apply them to an invoice until they are adjusted.
   */
  async createAdvance(input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'advance amount');
    const method = this._method(input.payment_method);
    const reference = this._reference(method, input.reference_number);
    const transactionDate = this._date(input.given_at || input.transaction_date, 'advance date');
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const partyType = String(input.party_type || input.category || 'VENDOR').toUpperCase();
    const trip = input.trip_id
      ? await this.prisma.trip.findUnique({ where: { trip_id: Number(input.trip_id) } })
      : null;
    if (input.trip_id && !trip) throw new NotFoundError({ message: 'Trip not found' });
    const bookingId = input.booking_id || trip?.booking_id || null;

    if (partyType === 'CUSTOMER') {
      if (!bookingId && !trip) throw new ValidationError('A customer advance requires a trip or booking');
      return this._tx(async (tx) => {
        const existing = await this._existingByIdempotency(tx, idempotencyKey);
        if (existing) return { transaction: existing, voucher_number: existing.voucher_number, already_recorded: true };

        await this._lock(tx, { tripId: trip?.trip_id, bookingId });
        const tripFinancial = await this._ensureTripFinancial(tx, { trip, bookingId });
        const voucher = await this.documentNumbers.next('ADVANCE_VOUCHER', { tx, date: transactionDate });
        const now = new Date();

        const transaction = await tx.financialTransaction.create({
          data: {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: bookingId ? Number(bookingId) : null,
            trip_id: trip?.trip_id || null,
            client_id: trip?.client_id || null,
            vehicle_id: trip?.vehicle_id || null,
            driver_id: trip?.driver_id || null,
            transaction_type: 'CUSTOMER_PAYMENT',
            amount,
            direction: 'CREDIT',
            from_party: 'CUSTOMER',
            to_party: 'BIHAR_TRANSPORT',
            purpose: 'Customer advance',
            payment_method: method,
            reference_number: reference,
            transaction_date: transactionDate,
            status: 'PAID',
            notes: input.notes || null,
            created_by: actor?.user_id || actor?.admin_id || null,
            created_at: now,
            updated_at: now,
            voucher_number: voucher.number,
            idempotency_key: idempotencyKey,
            metadata: JSON.stringify({ kind: 'CUSTOMER_ADVANCE', voucher_number: voucher.number }),
          },
        });

        await this.journalService.postJournal({
          reference: `JRN-${voucher.number}`,
          posting_date: transactionDate,
          source_type: 'CUSTOMER_ADVANCE',
          source_id: transaction.transaction_id,
          created_by: actor?.user_id || actor?.admin_id || null,
          tx,
          lines: [
            { account_code: method === 'CASH' ? 'CASH' : 'BANK', direction: 'DEBIT', amount },
            { account_code: 'CUSTOMER_ADVANCE_PAYABLE', direction: 'CREDIT', amount },
          ],
        });

        await this._audit(tx, actor, {
          action: 'customer_advance_posted',
          entityType: 'FinancialTransaction',
          entityId: transaction.transaction_id,
          next: { voucher_number: voucher.number, amount, booking_id: bookingId, trip_id: trip?.trip_id || null },
          reason: input.notes || null,
        });

        return { transaction, voucher_number: voucher.number, amount, party_type: 'CUSTOMER' };
      });
    }

    const advanceType =
      partyType === 'DRIVER' ? 'DRIVER_ADVANCE'
        : partyType === 'FUEL' ? 'FUEL_ADVANCE'
          : partyType === 'OTHER' ? 'OTHER'
            : 'OWNER_ADVANCE';

    if (advanceType === 'OTHER' && !bookingId && !trip) {
      throw new ValidationError('An advance requires a trip or booking');
    }

    // Double-click guard when the caller has no stable reference: the same
    // actor, party, amount and type within 60 seconds is treated as a retry.
    const recent = await this.prisma.tripAdvance.findFirst({
      where: {
        advance_type: advanceType,
        amount,
        given_by: actor?.user_id || null,
        ...(trip ? { trip_id: trip.trip_id } : { booking_id: Number(bookingId) }),
        created_at: { gte: new Date(Date.now() - 60 * 1000) },
      },
      orderBy: { advance_id: 'desc' },
    });
    if (recent && !reference) {
      return { advance: recent, already_recorded: true, voucher_number: recent.reference_number || `AV-${recent.advance_id}` };
    }

    let voucherNumber = reference;
    if (!voucherNumber) {
      voucherNumber = await this.documentNumbers.nextNumber('ADVANCE_VOUCHER', { date: transactionDate });
    }

    const advance = await this.tripAdvanceService.createAdvance(null, {
      trip_id: trip?.trip_id || null,
      amount,
      advance_type: advanceType,
      payment_method: method,
      reference_number: voucherNumber,
      given_at: transactionDate,
      notes: input.notes || null,
      driver_id: input.driver_id || null,
    }, actor);

    await this.journalService.postJournal({
      reference: `JRN-AV-${advance.advance_id}`,
      posting_date: transactionDate,
      source_type: 'ADVANCE_ISSUE',
      source_id: advance.advance_id,
      created_by: actor?.user_id || actor?.admin_id || null,
      lines: [
        { account_code: 'ADVANCE_ASSET', direction: 'DEBIT', amount },
        { account_code: method === 'CASH' ? 'CASH' : 'BANK', direction: 'CREDIT', amount },
      ],
    });

    await this._audit(this.prisma, actor, {
      action: 'advance_posted',
      entityType: 'TripAdvance',
      entityId: advance.advance_id,
      next: { voucher_number: voucherNumber, amount, advance_type: advanceType, trip_id: trip?.trip_id || null },
      reason: input.notes || null,
    });

    return { advance, voucher_number: voucherNumber, amount, party_type: partyType };
  }

  /**
   * Adjust an existing advance against a trip/invoice.
   *
   * NO new cash row is written: the advance already moved the money. This
   * method records utilisation so the outstanding balance falls, which is what
   * stops the same advance being counted twice.
   */
  async adjustAdvance(advanceId, input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'adjustment amount');

    return this._tx(async (tx) => {
      await tx.$queryRawUnsafe('SELECT advance_id FROM trip_advances WHERE advance_id = $1 FOR UPDATE', Number(advanceId));
      const advance = await tx.tripAdvance.findUnique({ where: { advance_id: Number(advanceId) } });
      if (!advance) throw new NotFoundError({ message: 'Advance not found' });

      const already = num(advance.adjusted_amount);
      const outstanding = roundMoney(num(advance.amount) - already);
      if (amount > outstanding) {
        throw new ValidationError(`Adjustment (₹${amount}) exceeds the unadjusted advance (₹${outstanding})`);
      }

      const updated = await tx.tripAdvance.update({
        where: { advance_id: advance.advance_id },
        data: {
          adjusted_amount: roundMoney(already + amount),
          adjusted_at: new Date(),
          adjustment_reference: input.reference_number || input.adjustment_reference || `ADJ-${advance.advance_id}`,
          status: roundMoney(already + amount) >= num(advance.amount) ? 'adjusted' : 'partially_adjusted',
          updated_at: new Date(),
        },
      });

      await this._audit(tx, actor, {
        action: 'advance_adjusted',
        entityType: 'TripAdvance',
        entityId: advance.advance_id,
        previous: { adjusted_amount: already, outstanding },
        next: { adjusted_amount: updated.adjusted_amount, reference: updated.adjustment_reference },
        reason: input.notes || null,
      });

      return updated;
    });
  }

  // =========================================================================
  // SETTLEMENTS (non-cash)
  // =========================================================================

  /**
   * Post a settlement.
   *
   * VENDOR: two ADJUSTMENT legs — DEBIT against the trip payable, CREDIT
   * against the previous balance. Net zero, no cash movement.
   *
   * CUSTOMER: a CUSTOMER_PAYMENT with method SETTLEMENT allocated to the
   * invoice. It reduces the receivable, updates the invoice status, and is
   * excluded from cash flow because SETTLEMENT is a non-cash method.
   */
  async createSettlement(input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'settlement amount');
    const partyType = String(input.party_type || 'VENDOR').toUpperCase();
    const transactionDate = this._date(input.settlement_date || input.transaction_date, 'settlement_date');
    const reference = input.reference_number || input.reference || `SET-${Date.now()}`;
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const trip = input.trip_id
      ? await this.prisma.trip.findUnique({ where: { trip_id: Number(input.trip_id) } })
      : null;
    if (input.trip_id && !trip) throw new NotFoundError({ message: 'Trip not found' });

    if (partyType === 'CUSTOMER') {
      const invoice = await this._resolveInvoice({ invoiceId: input.invoice_id, tripId: trip?.trip_id, bookingId: input.booking_id });
      if (!invoice) throw new ValidationError('A customer settlement must reference an invoice or a trip/booking with one');
      return this.recordCustomerReceipt(
        {
          amount,
          payment_method: 'SETTLEMENT',
          reference_number: reference,
          transaction_date: transactionDate,
          notes: input.notes || 'Customer settlement',
          invoice_id: invoice.invoice_id,
          trip_id: trip?.trip_id,
          idempotency_key: idempotencyKey,
        },
        actor,
      );
    }

    const vendorId = Number(input.vendor_id || trip?.transport_owner_id || 0);
    if (!vendorId) throw new ValidationError('A vendor_id (or a trip with an assigned vendor) is required');
    const vendor = await this.prisma.vehicleOwner.findUnique({ where: { owner_id: vendorId } });
    if (!vendor) throw new NotFoundError({ message: 'Vendor not found' });

    return this._tx(async (tx) => {
      const existing = await this._existingByIdempotency(tx, idempotencyKey);
      if (existing) return { transaction: existing, voucher_number: existing.voucher_number, already_recorded: true };

      await this._lock(tx, { tripId: trip?.trip_id, bookingId: trip?.booking_id });
      const tripFinancial = await this._ensureTripFinancial(tx, { trip });
      const voucher = await this.documentNumbers.next('SETTLEMENT_VOUCHER', { tx, date: transactionDate });
      const now = new Date();
      const settlementId = input.settlement_id || voucher.number;
      const common = {
        trip_financial_id: tripFinancial.trip_financial_id,
        booking_id: trip?.booking_id || null,
        trip_id: trip?.trip_id || null,
        vehicle_id: trip?.vehicle_id || null,
        driver_id: trip?.driver_id || null,
        transport_owner_id: vendorId,
        transaction_type: 'ADJUSTMENT',
        amount,
        payment_method: 'SETTLEMENT',
        reference_number: reference,
        transaction_date: transactionDate,
        status: 'PAID',
        notes: input.notes || null,
        created_by: actor?.user_id || actor?.admin_id || null,
        created_at: now,
        updated_at: now,
        metadata: JSON.stringify({
          kind: 'VENDOR_SETTLEMENT',
          settlement_id: settlementId,
          voucher_number: voucher.number,
          party_id: vendorId,
          party_name: vendor.company_name || vendor.owner_name,
          reference,
        }),
      };

      const debitLeg = await tx.financialTransaction.create({
        data: {
          ...common,
          direction: 'DEBIT',
          from_party: 'BIHAR_TRANSPORT',
          to_party: 'VENDOR',
          purpose: `Settlement · trip payable cleared · ${voucher.number}`,
          voucher_number: voucher.number,
          idempotency_key: idempotencyKey,
        },
      });

      const creditLeg = await tx.financialTransaction.create({
        data: {
          ...common,
          direction: 'CREDIT',
          from_party: 'VENDOR',
          to_party: 'BIHAR_TRANSPORT',
          purpose: `Settlement · previous vendor balance reduced · ${voucher.number}`,
          voucher_number: null,
          idempotency_key: null,
        },
      });

      await this._audit(tx, actor, {
        action: 'vendor_settlement_posted',
        entityType: 'FinancialTransaction',
        entityId: debitLeg.transaction_id,
        next: {
          voucher_number: voucher.number,
          vendor_id: vendorId,
          amount,
          trip_id: trip?.trip_id || null,
          cash_impact: 0,
          legs: [debitLeg.transaction_id, creditLeg.transaction_id],
        },
        reason: input.notes || null,
      });

      return {
        transaction: debitLeg,
        legs: [debitLeg, creditLeg],
        voucher_number: voucher.number,
        amount,
        cash_impact: 0,
        party_type: 'VENDOR',
      };
    });
  }

  // =========================================================================
  // PETROL PUMP
  // =========================================================================

  async createPump(input = {}, actor = null) {
    this._actor(actor);
    if (!input.pump_name) throw new ValidationError('pump_name is required');
    const pump = await this.pumpRepo.createPump({ ...input, created_by: undefined });

    await this._audit(this.prisma, actor, {
      action: 'petrol_pump_created',
      entityType: 'PetrolPump',
      entityId: pump.pump_id,
      next: { pump_name: pump.pump_name, pump_code: pump.pump_code, opening_balance: num(pump.opening_balance) },
    });
    return pump;
  }

  async recordFuel(input = {}, actor = null) {
    this._actor(actor);
    if (!input.pump_id) throw new ValidationError('pump_id is required');
    const fuelDate = this._date(input.fuel_date, 'fuel_date');
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);
    const voucher = await this.documentNumbers.next('PAYMENT_VOUCHER', { date: fuelDate });

    const trip = input.trip_id
      ? await this.prisma.trip.findUnique({ where: { trip_id: Number(input.trip_id) } })
      : null;
    if (input.trip_id && !trip) throw new NotFoundError({ message: 'Trip not found' });

    const result = await this._tx(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.petrolPumpFuelTransaction.findFirst({
          where: { receipt_number: input.receipt_number || idempotencyKey },
        });
        if (existing) return { fuel: existing, already_recorded: true };
      }

      const fuel = await this.pumpRepo.createFuelTransaction(
        {
          ...input,
          trip_id: trip?.trip_id || null,
          vehicle_id: input.vehicle_id || trip?.vehicle_id || null,
          driver_id: input.driver_id || trip?.driver_id || null,
          fuel_date: fuelDate,
          receipt_number: input.receipt_number || idempotencyKey || null,
          created_by: actor?.user_id || actor?.admin_id || null,
        },
        tx,
      );

      // Fuel is a credit purchase from the pump: the pump liability rises.
      await tx.petrolPump.update({
        where: { pump_id: Number(input.pump_id) },
        data: { current_balance: { increment: num(fuel.total_amount) }, updated_at: new Date() },
      });

      // Fuel supplied on behalf of a vendor is also a vendor-benefit row, so
      // the vendor payable falls by the same amount. One fuel transaction,
      // two ledgers — never two fuel rows.
      let vendorAdjustment = null;
      const vendorId = Number(input.vendor_id || trip?.transport_owner_id || 0);
      if (vendorId && trip) {
        const tripFinancial = await this._ensureTripFinancial(tx, { trip });
        vendorAdjustment = await tx.financialTransaction.create({
          data: {
            trip_financial_id: tripFinancial.trip_financial_id,
            booking_id: trip.booking_id || null,
            trip_id: trip.trip_id,
            vehicle_id: trip.vehicle_id || null,
            driver_id: trip.driver_id || null,
            transport_owner_id: vendorId,
            transaction_type: 'ADJUSTMENT',
            amount: roundMoney(num(fuel.total_amount)),
            direction: 'DEBIT',
            from_party: 'BIHAR_TRANSPORT',
            to_party: 'VENDOR',
            purpose: 'Fuel supplied on behalf of vendor',
            payment_method: 'FUEL_CREDIT',
            reference_number: input.receipt_number || null,
            transaction_date: fuelDate,
            status: 'PAID',
            notes: `Petrol pump ledger transaction #${fuel.transaction_id}`,
            created_by: actor?.user_id || actor?.admin_id || null,
            metadata: JSON.stringify({
              kind: 'VENDOR_FUEL_CREDIT',
              voucher_number: voucher.number,
              fuel_transaction_id: fuel.transaction_id,
              pump_id: Number(input.pump_id),
            }),
          },
        });
      }

      await this.journalService.postJournal({
        reference: `JRN-FUEL-${fuel.transaction_id}`,
        posting_date: fuelDate,
        source_type: 'FUEL_PURCHASE',
        source_id: fuel.transaction_id,
        created_by: actor?.user_id || actor?.admin_id || null,
        tx,
        lines: [
          { account_code: 'FUEL_EXPENSE', direction: 'DEBIT', amount: num(fuel.total_amount) },
          { account_code: 'PETROL_PUMP_PAYABLE', direction: 'CREDIT', amount: num(fuel.total_amount) },
        ],
      });

      if (vendorAdjustment) {
        await this.journalService.postJournal({
          reference: `JRN-VFC-${vendorAdjustment.transaction_id}`,
          posting_date: fuelDate,
          source_type: 'VENDOR_FUEL_CREDIT',
          source_id: vendorAdjustment.transaction_id,
          created_by: actor?.user_id || actor?.admin_id || null,
          tx,
          lines: [
            { account_code: 'VENDOR_PAYABLE', direction: 'DEBIT', amount: num(fuel.total_amount) },
            { account_code: 'FUEL_EXPENSE', direction: 'CREDIT', amount: num(fuel.total_amount) },
          ],
        });
      }

      await this._audit(tx, actor, {
        action: 'fuel_transaction_posted',
        entityType: 'PetrolPumpFuelTransaction',
        entityId: fuel.transaction_id,
        next: {
          voucher_number: voucher.number,
          pump_id: fuel.pump_id,
          amount: num(fuel.total_amount),
          litres: num(fuel.litres),
          vendor_adjustment: vendorAdjustment?.transaction_id || null,
        },
        reason: input.remarks || null,
      });

      return { fuel, vendor_adjustment: vendorAdjustment, voucher_number: voucher.number };
    });

    return result;
  }

  async createPumpBill(input = {}, actor = null) {
    this._actor(actor);
    if (!input.pump_id) throw new ValidationError('pump_id is required');
    if (!input.period_start || !input.period_end) throw new ValidationError('A billing period is required');

    const billNumber = input.bill_number || await this.documentNumbers.nextNumber('PUMP_BILL', { date: this._date(input.bill_date) });
    const bill = await this.pumpRepo.createBillWithTransaction({
      ...input,
      bill_number: billNumber,
      created_by: actor?.user_id || actor?.admin_id || null,
    });

    await this._audit(this.prisma, actor, {
      action: 'petrol_pump_bill_created',
      entityType: 'PetrolPumpBill',
      entityId: bill.bill_id,
      next: { bill_number: bill.bill_number, pump_id: bill.pump_id, bill_amount: num(bill.bill_amount) },
    });

    return bill;
  }

  async payPump(input = {}, actor = null) {
    this._actor(actor);
    const amount = this._positive(input.amount, 'payment amount');
    if (!input.pump_id) throw new ValidationError('pump_id is required');
    const paymentDate = this._date(input.payment_date, 'payment_date');
    const idempotencyKey = this._idempotencyKey(input.idempotency_key);

    const paymentNumber = await this.documentNumbers.nextNumber('PUMP_PAYMENT', { date: paymentDate });
    const voucher = await this.documentNumbers.next('PAYMENT_VOUCHER', { date: paymentDate });

    const existingPayment = idempotencyKey
      ? await this.prisma.petrolPumpPayment.findUnique({ where: { idempotency_key: idempotencyKey } })
      : null;

    const payment = await this.pumpRepo.recordPayment({
      pump_id: input.pump_id,
      bill_id: input.bill_id || null,
      amount,
      payment_date: paymentDate,
      payment_method: pumpMethod(input.payment_method),
      reference_number: input.reference_number || null,
      bank_name: input.bank_name || null,
      voucher_number: voucher.number,
      payment_number: paymentNumber,
      remarks: input.remarks || input.notes || null,
      idempotency_key: idempotencyKey,
      created_by: actor?.user_id || actor?.admin_id || null,
    });

    if (!existingPayment) {
      await this.journalService.postJournal({
        reference: `JRN-PP-${payment.payment_id}`,
        posting_date: paymentDate,
        source_type: 'PUMP_PAYMENT',
        source_id: payment.payment_id,
        created_by: actor?.user_id || actor?.admin_id || null,
        lines: [
          { account_code: 'PETROL_PUMP_PAYABLE', direction: 'DEBIT', amount },
          { account_code: (input.payment_method === 'CASH' ? 'CASH' : 'BANK'), direction: 'CREDIT', amount },
        ],
      });
    }

    await this._audit(this.prisma, actor, {
      action: 'petrol_pump_payment_posted',
      entityType: 'PetrolPumpPayment',
      entityId: payment.payment_id,
      next: { voucher_number: voucher.number, payment_number: paymentNumber, amount, pump_id: Number(input.pump_id) },
      reason: input.remarks || null,
    });

    return { payment, voucher_number: voucher.number, payment_number: paymentNumber };
  }

  // =========================================================================
  // OPENING BALANCES
  // =========================================================================

  async setOpeningBalance(input = {}, actor = null) {
    this._actor(actor);
    const partyType = String(input.party_type || '').toUpperCase();
    if (!['CUSTOMER', 'VENDOR', 'DRIVER', 'PETROL_PUMP'].includes(partyType)) {
      throw new ValidationError('party_type must be CUSTOMER, VENDOR, DRIVER or PETROL_PUMP');
    }
    const partyId = Number(input.party_id);
    if (!Number.isInteger(partyId) || partyId <= 0) throw new ValidationError('A valid party_id is required');
    const amount = Number(input.amount);
    if (!Number.isFinite(amount)) throw new ValidationError('A finite opening amount is required');
    const asOfDate = this._date(input.as_of_date || input.date, 'as_of_date');

    const record = await this.prisma.partyOpeningBalance.upsert({
      where: {
        party_type_party_id_as_of_date: {
          party_type: partyType,
          party_id: partyId,
          as_of_date: asOfDate,
        },
      },
      update: {
        amount: roundMoney(amount),
        notes: input.notes || null,
        created_by: actor?.user_id || actor?.admin_id || null,
        updated_at: new Date(),
      },
      create: {
        party_type: partyType,
        party_id: partyId,
        amount: roundMoney(amount),
        as_of_date: asOfDate,
        notes: input.notes || null,
        created_by: actor?.user_id || actor?.admin_id || null,
      },
    });

    await this._audit(this.prisma, actor, {
      action: 'opening_balance_set',
      entityType: 'PartyOpeningBalance',
      entityId: record.opening_id,
      next: { party_type: partyType, party_id: partyId, amount: roundMoney(amount), as_of_date: asOfDate },
      reason: input.notes || null,
    });

    return record;
  }

  async getOpeningBalances(raw = {}) {
    const where = {};
    if (raw.party_type) where.party_type = String(raw.party_type).toUpperCase();
    if (raw.party_id) where.party_id = Number(raw.party_id);
    if (raw.as_of_date) where.as_of_date = { lte: new Date(raw.as_of_date) };
    return this.prisma.partyOpeningBalance.findMany({ where, orderBy: [{ as_of_date: 'desc' }, { opening_id: 'desc' }] });
  }

  // =========================================================================
  // REVERSAL
  // =========================================================================

  /**
   * Reverse a posted transaction with an opposite-direction REVERSAL row.
   * The original row is never edited or deleted.
   */
  async reverseTransaction(transactionId, input = {}, actor = null) {
    this._actor(actor);
    if (!input.reason || String(input.reason).trim().length < 5) {
      throw new ValidationError('A reason of at least 5 characters is required to reverse a posted transaction');
    }

    return this._tx(async (tx) => {
      await tx.$queryRawUnsafe('SELECT transaction_id FROM financial_transactions WHERE transaction_id = $1 FOR UPDATE', Number(transactionId));
      const original = await tx.financialTransaction.findUnique({ where: { transaction_id: Number(transactionId) } });
      if (!original) throw new NotFoundError({ message: 'Transaction not found' });
      if (original.status === 'CANCELLED') throw new ValidationError('This transaction is already cancelled');

      const existingReversal = await tx.financialTransaction.findFirst({
        where: {
          transaction_type: 'REVERSAL',
          metadata: { contains: `"original_transaction_id":${original.transaction_id}` },
        },
      });
      if (existingReversal) {
        throw new ValidationError('This transaction has already been reversed');
      }

      const voucher = await this.documentNumbers.next('REVERSAL_VOUCHER', { tx });
      const now = new Date();

      const reversal = await tx.financialTransaction.create({
        data: {
          trip_financial_id: original.trip_financial_id,
          booking_id: original.booking_id,
          trip_id: original.trip_id,
          client_id: original.client_id,
          vehicle_id: original.vehicle_id,
          driver_id: original.driver_id,
          transport_owner_id: original.transport_owner_id,
          transaction_type: 'REVERSAL',
          amount: original.amount,
          direction: original.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
          from_party: original.to_party,
          to_party: original.from_party,
          purpose: `Reversal of ${original.voucher_number || `TX-${original.transaction_id}`}`,
          payment_method: original.payment_method,
          reference_number: original.reference_number,
          transaction_date: now,
          status: 'PAID',
          invoice_id: original.invoice_id,
          voucher_number: voucher.number,
          notes: input.reason,
          created_by: actor?.user_id || actor?.admin_id || null,
          created_at: now,
          updated_at: now,
          metadata: JSON.stringify({
            kind: 'REVERSAL',
            voucher_number: voucher.number,
            original_transaction_id: original.transaction_id,
            original_type: original.transaction_type,
            reason: input.reason,
          }),
        },
      });

      if (original.invoice_id) {
        await TripInvoiceService.reconcileInvoiceStatus({ prisma: tx, invoiceId: original.invoice_id, now });
      }

      const originalJournals = await tx.journalEntry.findMany({
        where: { source_id: original.transaction_id },
        include: { lines: { include: { account: true } } },
      });
      for (let i = 0; i < originalJournals.length; i++) {
        const j = originalJournals[i];
        await this.journalService.postJournal({
          reference: `JRN-REV-${reversal.transaction_id}${originalJournals.length > 1 ? `-${i + 1}` : ''}`,
          posting_date: now,
          source_type: 'REVERSAL',
          source_id: reversal.transaction_id,
          created_by: actor?.user_id || actor?.admin_id || null,
          tx,
          lines: j.lines.map((l) => ({
            account_code: l.account.account_code,
            direction: l.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT',
            amount: Number(l.amount),
          })),
        });
      }

      await this._audit(tx, actor, {
        action: 'transaction_reversed',
        entityType: 'FinancialTransaction',
        entityId: original.transaction_id,
        previous: { status: original.status, amount: original.amount, direction: original.direction },
        next: { reversal_transaction_id: reversal.transaction_id, voucher_number: voucher.number, direction: reversal.direction },
        reason: input.reason,
      });

      return { original, reversal, voucher_number: voucher.number };
    });
  }
}

module.exports = FinancePostingService;
module.exports.FinancePostingService = FinancePostingService;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;

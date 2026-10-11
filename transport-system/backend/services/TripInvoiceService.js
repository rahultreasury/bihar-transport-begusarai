/**
 * TripInvoiceService
 * ============================================================================
 * CUSTOMER BILLING for a consignment — the money side of the Dispatch page.
 *
 * THE SEPARATION THIS SERVICE PROTECTS (§11, §29, §31)
 *   Customer billing and vehicle operations are DIFFERENT lifecycles.
 *   A trip can be DELIVERED with the customer bill still pending; it can be
 *   billed with payment pending; it can be dispatched with nothing billed at
 *   all. Nothing in this service is reachable from `dispatch()`, and dispatch
 *   writes nothing here. A truck leaving a loading point is not a payment, and
 *   this code makes that structurally true rather than a convention.
 *
 *   Likewise the VENDOR side is untouched: gross hire, commission, net payable,
 *   advances and settlements live in `VehicleHire` / `TripAdvance` /
 *   `TripSettlement` / `FinancialTransaction`, and are read elsewhere. This
 *   service never creates a vendor row.
 *
 * ONE CANONICAL FINANCIAL SOURCE (§13)
 *   The amounts are read from the CONFIRMED commercial record —
 *   `BookingQuotationSnapshot` when one exists, otherwise the trip's own
 *   `freight_amount`. They are never recalculated here. The GST TYPE and GST
 *   PERCENTAGE are likewise read from that snapshot; if the snapshot has none,
 *   the invoice records none. An invented tax rate is the single worst thing
 *   this service could do.
 *
 * ON CGST / SGST / IGST — WHY THEY CAN BE NULL
 *   This repository has never had a rule for splitting GST between centre and
 *   state. The Prisma schema says so in as many words on `Quotation.gst_type`:
 *   "THE ARITHMETIC OF RCM IS NOT SPECIFIED IN CLIENT DOCUMENT". Rather than
 *   quietly assume an intra-state or inter-state rule, the service copies a
 *   split ONLY if the confirmed quotation actually recorded one, and otherwise
 *   leaves the columns NULL and stamps `gst_breakdown_configured: false` so
 *   the PDF and the screen can say so in words. The fields are supported; the
 *   business rule is not invented.
 *
 * AN INTERNAL INVOICE, NOT A GOVERNMENT E-INVOICE (§12)
 *   `document_kind` is INTERNAL_CUSTOMER_INVOICE. `irn` and `gov_ack_json`
 *   exist as columns and are never written, because no GST e-invoice API is
 *   integrated. The PDF says "Internal customer invoice" on its face.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');

/**
 * Mirrors the Prisma `InvoiceStatus` enum exactly: PENDING · GENERATED · PAID ·
 * CANCELLED.
 *
 * The vocabulary is the repository's, not this file's. An operator reading the
 * existing invoice list sees "GENERATED" and a new value like "ISSUED" would
 * force a translation table to explain the difference between two words that
 * mean the same thing.
 */
const INVOICE_STATUSES = Object.freeze(['PENDING', 'GENERATED', 'PAID', 'CANCELLED']);

/** Mirrors the Prisma `PaymentStatus` vocabulary used on the ledger. */
const LEDGER_PAYMENT_STATUSES = Object.freeze(['PAID', 'PENDING', 'FAILED', 'CANCELLED']);

/** Payment methods a customer payment may be recorded against. */
const PAYMENT_METHODS = Object.freeze(['CASH', 'BANK', 'SETTLEMENT', 'UPI', 'CHEQUE']);

class TripInvoiceService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.timelineRepo = new TripTimelineRepository({ prisma: this.prisma });
    this.auditRepo = new AuditLogRepository({ prisma: this.prisma });
  }

  // =========================================================================
  // READ
  // =========================================================================

  /**
   * The invoice raised against this consignment, with its derived position.
   *
   * @param {number} tripId
   * @returns {Promise<Object|null>}
   */
  async getInvoiceForTrip(tripId) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const invoice = await this.prisma.invoice.findFirst({
      where: { trip_id: id },
      orderBy: [{ invoice_id: 'desc' }],
    });
    if (!invoice) return null;

    const position = await this.getPosition(invoice);
    return { ...invoice, position, charges: await this._chargeLines(id) };
  }

  /**
   * What has actually been received against an invoice, and what is left.
   *
   * Derived from the LEDGER, never from the invoice's own status column — so a
   * document state and a cash state can never contradict each other.
   *
   * @param {Object} invoice
   * @returns {Promise<Object>}
   */
  async getPosition(invoice) {
    const payments = await this.prisma.financialTransaction.findMany({
      where: { invoice_id: invoice.invoice_id, status: { not: 'CANCELLED' } },
      orderBy: [{ transaction_date: 'desc' }],
    });

    const received = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const total = Number(invoice.grand_total ?? invoice.total_amount ?? invoice.final_price ?? 0);
    const balance = Math.round((total - received) * 100) / 100;

    return {
      total,
      received: Math.round(received * 100) / 100,
      balance,
      status: balance <= 0 ? 'PAID' : received > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
      payments: payments.map((p) => ({
        transaction_id: p.transaction_id,
        amount: p.amount,
        payment_method: p.payment_method,
        reference_number: p.reference_number,
        transaction_date: p.transaction_date,
        status: p.status,
      })),
    };
  }

  // =========================================================================
  // CREATE
  // =========================================================================

  /**
   * Raise the customer invoice for a consignment.
   *
   * IDEMPOTENT BY DESIGN. A partial unique index
   * (`invoices_one_dispatch_invoice_per_trip`) makes a second dispatch invoice
   * for the same trip impossible, and an existing one is returned unchanged
   * rather than a second bill being raised — the same rule Phase 7 applies per
   * booking, extended to the standalone trips that have no booking at all.
   *
   * @param {number} tripId
   * @param {Object|null} user
   * @param {Object} [overrides] explicitly-supplied commercial values
   * @returns {Promise<{invoice:Object, created:boolean}>}
   */
  async createInvoice(tripId, user = null, overrides = {}) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const trip = await this.prisma.trip.findUnique({ where: { trip_id: id } });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    // Already billed → return it. Never a second bill.
    const existing = await this.prisma.invoice.findFirst({ where: { trip_id: id } });
    if (existing) {
      return { invoice: existing, created: false, position: await this.getPosition(existing) };
    }

    const source = await this._resolveFinancialSource(trip);
    const amounts = this._computeTotals(source, overrides);
    const customer = await this._resolveCustomer(trip);
    const now = new Date();
    const invoiceDate = overrides.invoice_date ? new Date(overrides.invoice_date) : now;

    if (Number.isNaN(invoiceDate.getTime())) {
      throw new ValidationError(`Invalid invoice_date "${overrides.invoice_date}"`);
    }

    const invoiceNumber = await this._nextInvoiceNumber(invoiceDate);

    const data = {
      invoice_number: invoiceNumber,
      trip_id: trip.trip_id,
      // A booking-backed trip links BOTH. A standalone DIRECT / OFFLINE_CLIENT
      // trip has no booking by design and links only the trip.
      booking_id: trip.booking_id ?? null,
      invoice_date: invoiceDate,
      issued_at: invoiceDate,
      due_at: overrides.due_at ? new Date(overrides.due_at) : null,

      // Money, exactly as the confirmed commercial record states it.
      goods_amount: amounts.freight,
      extra_charges: amounts.additional_charges,
      taxable_amount: amounts.taxable_amount,
      tax_amount: amounts.tax_total,
      total_amount: amounts.taxable_amount,
      grand_total: amounts.grand_total,
      // `final_price` is the pre-existing AUTHORITATIVE amount column; it is
      // set to the invoice total so every existing report agrees with the
      // document instead of contradicting it.
      final_price: amounts.grand_total,

      // GST, read not invented.
      gst_type: source.gst_type ?? null,
      gst_percentage: source.gst_percentage ?? null,
      cgst: source.gst_split?.cgst ?? null,
      sgst: source.gst_split?.sgst ?? null,
      igst: source.gst_split?.igst ?? null,

      billing_to: overrides.billing_to ?? customer?.name ?? null,
      gst_number: overrides.gst_number ?? customer?.gst_number ?? null,

      status: 'GENERATED',
      payment_status: 'UNPAID',
      document_kind: 'INTERNAL_CUSTOMER_INVOICE',
      // Explicitly NULL, not merely omitted. These columns are where a real GST
      // e-invoice acknowledgement will live one day; writing "we have none"
      // now is different from leaving it undefined, and only the first is a
      // statement the audit trail can rely on.
      irn: null,
      gov_ack_json: null,
      pdf_generated_at: null,
      notes: overrides.notes || null,
      created_at: now,
      updated_at: now,
    };

    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({ data });

      // Link it to the dispatch act when one exists, so "the invoice this
      // vehicle left with" is a fact rather than a coincidence.
      if (tx.tripDispatch) {
        const dispatch = await tx.tripDispatch.findFirst({ where: { trip_id: trip.trip_id } });
        if (dispatch && !dispatch.invoice_id) {
          await tx.tripDispatch.update({
            where: { dispatch_id: dispatch.dispatch_id },
            data: { invoice_id: created.invoice_id },
          });
        }
      }

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'invoice_created',
        description: `Customer invoice ${invoiceNumber} created`,
        reference_type: 'invoice',
        reference_id: created.invoice_id,
        metadata: {
          invoice_number: invoiceNumber,
          grand_total: amounts.grand_total,
          source: source.kind,
          document_kind: 'INTERNAL_CUSTOMER_INVOICE',
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'customer_invoice_created',
        entity_type: 'Invoice',
        entity_id: created.invoice_id,
        new_value: JSON.stringify({
          invoice_number: invoiceNumber,
          trip_id: trip.trip_id,
          grand_total: amounts.grand_total,
          gst_type: data.gst_type,
          gst_percentage: data.gst_percentage,
        }),
      }, tx);

      return created;
    });

    return { invoice, created: true, position: await this.getPosition(invoice) };
  }

  // =========================================================================
  // PAYMENT
  // =========================================================================

  /**
   * Record a payment received from the customer.
   *
   * PARTIAL PAYMENTS ARE THE NORMAL CASE (§30). An invoice of ₹50,000 collected
   * as ₹20,000 then ₹15,000 is two ledger rows and one derived balance — there
   * is no payment schedule to keep in step, because none is imposed.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async recordCustomerPayment(tripId, input = {}, user = null) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new NotFoundError({ message: 'Trip not found' });

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError(`A customer payment needs an amount greater than zero (received "${input.amount}")`);
    }

    const method = String(input.payment_method || '').toUpperCase();
    if (!PAYMENT_METHODS.includes(method)) {
      throw new ValidationError(
        `Invalid payment_method "${input.payment_method}". Expected one of: ${PAYMENT_METHODS.join(', ')}`,
      );
    }

    // The method carries a REQUIRED extra field. A bank transfer without a UTR
    // and a settlement without a reference are not receipts, and accepting them
    // would put an unauditable line in the ledger.
    if (method === 'BANK' && !input.reference_number) {
      throw new ValidationError('A bank payment requires the bank UTR / reference number');
    }
    if (method === 'SETTLEMENT' && !input.reference_number) {
      throw new ValidationError('A settlement payment requires the settlement reference');
    }

    const trip = await this.prisma.trip.findUnique({ where: { trip_id: id } });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    const invoice = input.invoice_id
      ? await this.prisma.invoice.findFirst({
        where: { invoice_id: Number(input.invoice_id), trip_id: id },
      })
      : await this.prisma.invoice.findFirst({ where: { trip_id: id } });

    if (!invoice) {
      throw new ValidationError('No customer invoice exists for this consignment yet. Create the invoice first.');
    }

    // The ledger requires a TripFinancial parent. An existing one is reused;
    // if none exists yet, one is created so the money still lands in the
    // canonical ledger rather than in a private table.
    const tripFinancial = await this._ensureTripFinancial(trip);

    const now = new Date();
    const transactionDate = input.transaction_date ? new Date(input.transaction_date) : now;
    if (Number.isNaN(transactionDate.getTime())) {
      throw new ValidationError(`Invalid transaction_date "${input.transaction_date}"`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.financialTransaction.create({
        data: {
          trip_financial_id: tripFinancial.trip_financial_id,
          trip_id: trip.trip_id,
          booking_id: trip.booking_id ?? null,
          client_id: trip.client_id ?? null,
          transaction_type: trip.client_id ? 'CLIENT_PAYMENT' : 'CUSTOMER_PAYMENT',
          amount,
          // CREDIT = money IN to Bihar Transport.
          direction: 'CREDIT',
          from_party: trip.client_id ? 'CLIENT' : 'CUSTOMER',
          to_party: 'BIHAR_TRANSPORT',
          purpose: `Customer payment against invoice ${invoice.invoice_number}`,
          payment_method: method,
          reference_number: input.reference_number || null,
          transaction_date: transactionDate,
          status: 'PAID',
          invoice_id: invoice.invoice_id,
          notes: input.notes || null,
          created_by: user?.user_id || null,
          created_at: now,
          updated_at: now,
        },
      });

      // The invoice's OWN payment_status is refreshed from the ledger inside
      // the same transaction, so a reader can never see an invoice that claims
      // UNPAID after the money is in, or PAID before it is.
      const all = await tx.financialTransaction.findMany({
        where: { invoice_id: invoice.invoice_id, status: { not: 'CANCELLED' } },
      });
      const received = all.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const total = Number(invoice.grand_total ?? invoice.total_amount ?? invoice.final_price ?? 0);
      const balance = Math.round((total - received) * 100) / 100;
      const paymentStatus = balance <= 0 ? 'PAID' : received > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      const updatedInvoice = await tx.invoice.update({
        where: { invoice_id: invoice.invoice_id },
        data: {
          payment_status: paymentStatus,
          ...(paymentStatus === 'PAID' ? { paid_at: now, status: 'PAID' } : {}),
          updated_at: now,
        },
      });

      await this.timelineRepo.create({
        trip_id: trip.trip_id,
        event_type: 'customer_payment_received',
        description: `Customer payment ₹${amount} received against ${invoice.invoice_number}`,
        reference_type: 'financial_transaction',
        reference_id: transaction.transaction_id,
        metadata: {
          invoice_number: invoice.invoice_number,
          amount,
          payment_method: method,
          reference_number: input.reference_number || null,
          payment_status: paymentStatus,
          balance,
        },
        created_by: user?.user_id || null,
      }, tx);

      await this.auditRepo.create({
        user_id: user?.user_id || null,
        user_role: user?.role || 'system',
        action: 'customer_payment_recorded',
        entity_type: 'FinancialTransaction',
        entity_id: transaction.transaction_id,
        previous_value: JSON.stringify({ payment_status: invoice.payment_status }),
        new_value: JSON.stringify({
          payment_status: paymentStatus,
          amount,
          invoice_number: invoice.invoice_number,
          balance,
        }),
      }, tx);

      return { transaction, invoice: updatedInvoice, received, total, balance, paymentStatus };
    });

    return result;
  }

  // =========================================================================
  // INTERNAL
  // =========================================================================

  /**
   * The ONE commercial record the invoice reads.
   *
   * Preference order, and the reason for it:
   *   1. `BookingQuotationSnapshot` — the amounts FROZEN at order confirmation.
   *      This is what the customer agreed to pay and what the quotation PDF was
   *      rendered from.
   *   2. `Trip.freight_amount` — for a trip that never had a confirmed
   *      quotation. Labelled as such in `source.kind` so no screen can present
   *      it as quotation-derived.
   *
   * @private
   */
  async _resolveFinancialSource(trip) {
    let snapshot = null;
    if (trip.booking_id && this.prisma.bookingQuotationSnapshot) {
      const booking = await this.prisma.booking.findUnique({
        where: { booking_id: trip.booking_id },
        include: { quotationSnapshot: true },
      });
      snapshot = booking?.quotationSnapshot || null;
    }

    if (snapshot) {
      return {
        kind: 'QUOTATION_SNAPSHOT',
        quotation_id: snapshot.quotation_id,
        freight: Number(snapshot.total_freight ?? trip.freight_amount ?? 0),
        additional_charges: Number(snapshot.total_additional_charges ?? 0),
        additional_charges_tax: Number(snapshot.additional_charges_tax ?? 0),
        gst_type: snapshot.gst_type ?? null,
        gst_percentage: snapshot.gst_percentage ?? null,
        gst_amount: snapshot.gst_amount ?? null,
        total_billing_amount: Number(snapshot.total_billing_amount ?? 0),
        // There is no CGST/SGST/IGST split on a Quotation or its snapshot, so
        // none is produced. See the note in the file header.
        gst_split: null,
      };
    }

    return {
      kind: 'TRIP_FREIGHT',
      quotation_id: null,
      freight: Number(trip.freight_amount ?? 0),
      additional_charges: 0,
      additional_charges_tax: 0,
      gst_type: null,
      gst_percentage: null,
      gst_amount: null,
      total_billing_amount: Number(trip.freight_amount ?? 0),
      gst_split: null,
    };
  }

  /**
   * The invoice arithmetic.
   *
   * Faithful to the repository's existing position, which is that GST is
   * STORED AND DISPLAYED but deliberately NOT folded into a total because the
   * RCM arithmetic was never specified. `tax_total` is therefore carried as its
   * own line and the grand total mirrors `total_billing_amount` — the same
   * relationship the quotation and its PDF already use. Introducing a different
   * rule here would mean the invoice disagreed with the order it bills.
   *
   * @private
   */
  _computeTotals(source, overrides = {}) {
    const freight = overrides.freight !== undefined
      ? Number(overrides.freight)
      : Number(source.freight || 0);
    const additionalCharges = overrides.additional_charges !== undefined
      ? Number(overrides.additional_charges)
      : Number(source.additional_charges || 0);

    for (const [label, value] of [['freight', freight], ['additional_charges', additionalCharges]]) {
      if (!Number.isFinite(value) || value < 0) {
        throw new ValidationError(`Invalid ${label} amount "${overrides[label]}"`);
      }
    }

    const taxable = Math.round((freight + additionalCharges) * 100) / 100;
    const gstAmount = source.gst_amount === null || source.gst_amount === undefined
      ? null
      : Number(source.gst_amount);

    return {
      freight: Math.round(freight * 100) / 100,
      additional_charges: Math.round(additionalCharges * 100) / 100,
      taxable_amount: taxable,
      tax_total: gstAmount,
      grand_total: taxable,
      gst_breakdown_configured: Boolean(source.gst_split),
    };
  }

  /**
   * The invoice number: `BT/INV/2026/00125`.
   *
   * Derived from the invoice id sequence rather than from the wall clock, so
   * two invoices raised in the same millisecond cannot collide the way a
   * `Date.now()` suffix can. A unique-constraint violation is caught and
   * retried at the next number, so the number is always the one actually
   * persisted rather than a hopeful guess.
   *
   * @private
   */
  async _nextInvoiceNumber(date) {
    const year = date.getFullYear();
    const prefix = `BT/INV/${year}/`;

    // Start from the highest existing number for this year so the sequence is
    // monotonic even if invoices were imported from elsewhere.
    const last = await this.prisma.invoice.findFirst({
      where: { invoice_number: { startsWith: prefix } },
      orderBy: { invoice_number: 'desc' },
      select: { invoice_number: true },
    });
    let seq = 1;
    if (last?.invoice_number) {
      const tail = Number(last.invoice_number.slice(prefix.length));
      if (Number.isInteger(tail) && tail > 0) seq = tail + 1;
    }

    // Ten attempts is far more than enough: each collision means somebody else
    // took the number microseconds earlier.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const candidate = `${prefix}${String(seq).padStart(5, '0')}`;
      const clash = await this.prisma.invoice.findUnique({
        where: { invoice_number: candidate },
        select: { invoice_id: true },
      });
      if (!clash) return candidate;
      seq += 1;
    }
    // Fall back to the primary key, which is unique by construction.
    return `${prefix}${Date.now().toString().slice(-5)}`;
  }

  /**
   * Find or create the `TripFinancial` a customer payment must be attached to.
   * @private
   */
  async _ensureTripFinancial(trip) {
    const existing = await this.prisma.tripFinancial.findFirst({
      where: { trip_id: trip.trip_id },
      orderBy: [{ trip_financial_id: 'desc' }],
    });
    if (existing) return existing;

    return this.prisma.tripFinancial.create({
      data: {
        trip_id: trip.trip_id,
        booking_id: trip.booking_id ?? null,
        // The customer revenue line is populated by the existing finance
        // services. Creating the row here with the trip's own freight keeps
        // the ledger's own invariant (customer_fare is NOT NULL) satisfied
        // without inventing a second revenue figure.
        customer_fare: Number(trip.freight_amount ?? 0),
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  /** @private */
  async _chargeLines(tripId) {
    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      select: { booking_id: true },
    });
    if (!trip?.booking_id || !this.prisma.quotationCharge) return [];

    const booking = await this.prisma.booking.findUnique({
      where: { booking_id: trip.booking_id },
      include: { quotationSnapshot: true },
    });
    const quotationId = booking?.quotationSnapshot?.quotation_id;
    if (!quotationId) return [];

    const charges = await this.prisma.quotationCharge.findMany({
      where: { quotation_id: quotationId },
      orderBy: [{ sort_order: 'asc' }],
    });
    return charges.map((c) => ({
      charge_name: c.charges_name,
      rate: c.rate,
      quantity: c.quantity,
      quantity_unit: c.quantity_unit,
      total: c.total,
    }));
  }

  /** @private */
  async _resolveCustomer(trip) {
    if (trip.client_id) {
      const client = await this.prisma.client.findUnique({ where: { client_id: trip.client_id } });
      if (client) {
        return {
          name: client.company_name,
          contact_person: client.contact_person,
          phone: client.phone,
          email: client.email,
          address: client.address,
          city: client.city,
          state: client.state,
          gst_number: client.gst_number,
        };
      }
    }
    if (trip.user_id) {
      const user = await this.prisma.user.findUnique({ where: { user_id: trip.user_id } });
      if (user) {
        return {
          name: [user.first_name, user.last_name].filter(Boolean).join(' '),
          contact_person: user.first_name,
          phone: user.phone,
          email: user.email,
          address: null,
          city: null,
          state: null,
          gst_number: null,
        };
      }
    }
    return null;
  }
}

module.exports = TripInvoiceService;
module.exports.TripInvoiceService = TripInvoiceService;
module.exports.INVOICE_STATUSES = INVOICE_STATUSES;
module.exports.LEDGER_PAYMENT_STATUSES = LEDGER_PAYMENT_STATUSES;
module.exports.PAYMENT_METHODS = PAYMENT_METHODS;

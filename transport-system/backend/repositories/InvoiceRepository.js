/**
 * InvoiceRepository
 * Database-only repository for invoices. The invoice is the customer billing
 * document and is raised the moment a quote is accepted (atomic with booking
 * confirmation).
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 *
 * PHASE 7 — ONE BILL PER BOOKING
 *   `ensureForBooking()` is the ONLY creation entry point. It is idempotent:
 *   calling it twice for the same booking returns the invoice that already
 *   exists instead of writing a second one. That matters because two
 *   independent code paths can legitimately try to bill the same booking
 *   (BookingService.createBooking for a booking that arrives already
 *   ACCEPTED, and BookingService.acceptQuote for a booking that transitions
 *   into ACCEPTED later), and the client rule is that a booking bills once.
 *   The database enforces the same rule via invoices_booking_id_key.
 */

const { prisma } = require('../config/prisma');

class InvoiceRepository {
  /**
   * Build the canonical invoice number for a booking.
   *
   * WHY NOT `Date.now()`: the historical generator appended the last 6 digits
   * of the current millisecond clock, so two invoices raised for the same
   * booking inside the same second produced the SAME number and collided on
   * the `invoice_number` unique constraint. The booking number is already
   * unique and sequential, so keying the invoice off it alone is both
   * collision-free and human-readable, and it is deterministic — the same
   * booking always maps to the same invoice number, which is exactly what
   * makes `ensureForBooking` safe to retry.
   *
   * @param {string} bookingNumber canonical booking_number (BTB-YYYY-NNNNN)
   * @returns {string}
   */
  buildInvoiceNumber(bookingNumber) {
    return `INV-${bookingNumber}`;
  }

  /**
   * Idempotently ensure the booking has exactly one invoice.
   *
   * @param {Object} data
   * @param {number} data.booking_id
   * @param {string} data.booking_number canonical booking_number
   * @param {number} data.amount authoritative amount (Booking.final_price)
   * @param {string=} data.status
   * @param {string=} data.notes
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{invoice_id:number, invoice_number:string, created:boolean}>}
   */
  async ensureForBooking(data, tx = null) {
    const client = tx || prisma;
    const bookingId = Number(data.booking_id);
    if (!bookingId) throw new Error('ensureForBooking requires a booking_id');

    // Cheap read first: in the overwhelmingly common case (re-accept, retry,
    // double click) this short-circuits without attempting an insert.
    const existing = await client.invoice.findFirst({
      where: { booking_id: bookingId },
      orderBy: [{ created_at: 'desc' }, { invoice_id: 'desc' }],
    });
    if (existing) {
      return {
        invoice_id: existing.invoice_id,
        invoice_number: existing.invoice_number,
        created: false,
      };
    }

    const invoice = await client.invoice.create({
      data: {
        booking_id: bookingId,
        invoice_number: this.buildInvoiceNumber(data.booking_number || bookingId),
        final_price: Number(data.amount) || 0,
        status: data.status || 'PENDING',
        // `total_amount` mirrors the authoritative amount so the document is
        // internally consistent. It is NOT a second source of truth: the
        // outstanding balance is always derived from freight_amount minus the
        // canonical FinancialTransaction rows, never from this column.
        total_amount: Number(data.amount) || 0,
        notes: data.notes || null,
      },
    });

    return { invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number, created: true };
  }
  /**
   * Create an invoice.
   * @param {Object} data
   * @param {number} data.booking_id
   * @param {string} data.invoice_number
   * @param {number} data.amount
   * @param {string=} data.status
   * @param {number=} data.tax_amount
   * @param {number=} data.total_amount
   * @param {string=} data.notes
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{invoice_id:number}>}
   */
  async create(data, tx = null) {
    const client = tx || prisma;
    try {
      const invoice = await client.invoice.create({
        data: {
          booking_id: data.booking_id,
          invoice_number: data.invoice_number,
          final_price: Number(data.amount),
          status: data.status || 'PENDING',
          tax_amount: data.tax_amount != null ? Number(data.tax_amount) : null,
          total_amount: data.total_amount != null ? Number(data.total_amount) : null,
          notes: data.notes || null,
        },
      });
      return { invoice_id: invoice.invoice_id };
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get invoice by booking id (latest).
   * @param {number} bookingId
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<Object|null>}
   */
  async getByBooking(bookingId, tx = null) {
    const client = tx || prisma;
    try {
      return await client.invoice.findFirst({
        where: { booking_id: bookingId },
        orderBy: [
          { created_at: 'desc' },
          { invoice_id: 'desc' },
        ],
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Get invoice by invoice_number.
   * @param {string} invoiceNumber
   * @returns {Promise<Object|null>}
   */
  async findByNumber(invoiceNumber) {
    try {
      return await prisma.invoice.findUnique({
        where: { invoice_number: invoiceNumber },
      });
    } catch (err) {
      throw err;
    }
  }

  /**
   * Update invoice status.
   * @param {number} invoiceId
   * @param {Object} data
   * @param {string=} data.status
   * @param {string=} data.notes
   * @param {object=} tx - Prisma transaction client
   * @returns {Promise<{changes:number}>}
   */
  async update(invoiceId, data, tx = null) {
    const client = tx || prisma;
    const updateData = {};
    if (data.status != null) updateData.status = data.status;
    if (data.notes != null) updateData.notes = data.notes;
    if (data.paid_at != null) updateData.paid_at = data.paid_at;
    try {
      await client.invoice.update({
        where: { invoice_id: invoiceId },
        data: updateData,
      });
      return { changes: 1 };
    } catch (err) {
      throw err;
    }
  }
}

module.exports = InvoiceRepository;

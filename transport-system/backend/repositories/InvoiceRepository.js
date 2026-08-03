/**
 * InvoiceRepository
 * Database-only repository for invoices. Generated at the moment a customer
 * accepts a quote (atomic with booking confirmation).
 *
 * Uses Prisma Client for all database operations.
 * Accepts an optional Prisma transaction client (`tx`) for interactive transactions.
 */

const { prisma } = require('../config/prisma');

class InvoiceRepository {
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
          amount: Number(data.amount),
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

/**
 * DocumentNumberService
 * ---------------------------------------------------------------------------
 * Concurrency-safe document numbering for every financial document the
 * Finance module issues.
 *
 * WHY NOT `count() + 1`
 *   Every number the system prints is a legal reference a customer or vendor
 *   will quote back at us. Two administrators pressing "Save" in the same
 *   millisecond must not receive the same receipt number. Counting existing
 *   rows cannot guarantee that under concurrency, so the counter lives in
 *   `document_sequences` and is advanced with a single atomic
 *   `INSERT … ON CONFLICT DO UPDATE … RETURNING` statement. PostgreSQL locks
 *   the sequence row for the duration of the transaction, so a concurrent
 *   caller blocks and receives the next value.
 *
 * FORMAT
 *   MR-2026-00001   money receipt (customer / commission)
 *   PV-2026-00001   payment voucher (vendor / driver / pump)
 *   SV-2026-00001   settlement voucher
 *   AV-2026-00001   advance voucher
 *   PB-2026-00001   petrol pump bill
 *   PP-2026-00001   petrol pump payment
 *   CN-2026-00001   credit note
 *
 *   The year is the calendar year of the document date. The sequence is
 *   per document type and per year, so a new year restarts at 00001 without
 *   ever reusing a number from the old year.
 */

const { prisma: defaultPrisma } = require('../config/prisma');

const PREFIXES = Object.freeze({
  MONEY_RECEIPT: 'MR',
  PAYMENT_VOUCHER: 'PV',
  SETTLEMENT_VOUCHER: 'SV',
  ADVANCE_VOUCHER: 'AV',
  PUMP_BILL: 'PB',
  PUMP_PAYMENT: 'PP',
  CREDIT_NOTE: 'CN',
  REVERSAL_VOUCHER: 'RV',
});

const PAD = 5;

class DocumentNumberService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
  }

  /**
   * Allocate the next number for `documentType`.
   *
   * IMPORTANT: pass the caller's transaction client (`tx`) whenever the
   * document row is created inside a larger posting transaction. That way a
   * rollback also rolls the counter back, and no number is burned by a failed
   * post.
   *
   * @param {string} documentType key of PREFIXES
   * @param {Object} [options]
   * @param {Object} [options.tx] Prisma transaction client
   * @param {Date}   [options.date] document date (defaults to now)
   * @returns {Promise<{number: string, prefix: string, year: number, value: number}>}
   */
  async next(documentType, options = {}) {
    const prefix = PREFIXES[documentType];
    if (!prefix) {
      throw new Error(`Unknown financial document type "${documentType}"`);
    }

    const client = options.tx || this.prisma;
    const date = options.date instanceof Date ? options.date : new Date(options.date || Date.now());
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid document date "${options.date}"`);
    }
    const year = date.getFullYear();

    // One statement: insert the first value, or lock + increment the row.
    // The RETURNING expression yields the value the caller owns.
    const rows = await client.$queryRawUnsafe(
      `INSERT INTO document_sequences (document_type, year, next_value, updated_at)
       VALUES ($1, $2, 2, NOW())
       ON CONFLICT (document_type, year)
       DO UPDATE SET next_value = document_sequences.next_value + 1, updated_at = NOW()
       RETURNING (next_value - 1) AS value`,
      documentType,
      year,
    );

    const value = Number(rows?.[0]?.value);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Could not allocate a ${prefix} document number`);
    }

    return {
      number: `${prefix}-${year}-${String(value).padStart(PAD, '0')}`,
      prefix,
      year,
      value,
    };
  }

  /** Convenience wrapper returning only the formatted number. */
  async nextNumber(documentType, options = {}) {
    return (await this.next(documentType, options)).number;
  }
}

module.exports = DocumentNumberService;
module.exports.DocumentNumberService = DocumentNumberService;
module.exports.DOCUMENT_PREFIXES = PREFIXES;

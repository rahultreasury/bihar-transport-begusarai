/**
 * PaymentDocumentPdf.js
 * ============================================================================
 * §32 — "Generate Payment Voucher" / "Generate Money Receipt".
 *
 * TWO DOCUMENTS, ONE SOURCE OF TRUTH
 *   Both are rendered from a row that ALREADY EXISTS in
 *   `financial_transactions`. No new payment table is created, and a voucher
 *   can never exist for a payment that was not recorded — the reverse of the
 *   usual failure mode, where a printed receipt implies cash that never moved.
 *
 * THE TWO ARE NOT INTERCHANGEABLE
 *   A MONEY RECEIPT acknowledges money received by Bihar Transport (CREDIT,
 *   from a CUSTOMER or CLIENT). A PAYMENT VOUCHER authorises money paid out
 *   (DEBIT, to a DRIVER, TRANSPORT_OWNER or VENDOR). Rendering a "receipt" for
 *   an outgoing payment would be a false statement to whoever holds it, so the
 *   renderer refuses rather than guessing: `assertDocumentType()` throws unless
 *   the transaction's direction and parties agree with the document asked for.
 *
 * SETTLEMENT IS NOT CASH (§32)
 *   A `SETTLEMENT` payment prints its settlement reference on its face and is
 *   never described as cash. `TripInvoiceService.recordCustomerPayment` already
 *   requires that reference; this renderer prints it, so the two halves cannot
 *   disagree.
 */

const PDFDocument = require('pdfkit');
const { ValidationError } = require('../utils/AppError');

function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(value) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** The payment methods this renderer knows how to word. */
const METHOD_LABEL = {
  CASH: 'Cash',
  BANK: 'Bank Transfer',
  UPI: 'UPI',
  CHEQUE: 'Cheque',
  SETTLEMENT: 'Settlement',
};

/** Which party types may legitimately receive money FROM Bihar Transport. */
const OUTGOING_PARTIES = new Set(['DRIVER', 'TRANSPORT_OWNER', 'VENDOR', 'PARTNER']);

/**
 * Refuse to render the wrong kind of document for a given ledger row.
 *
 * @param {Object} transaction a FinancialTransaction row
 * @param {'RECEIPT'|'VOUCHER'} kind
 * @throws {ValidationError}
 */
function assertDocumentType(transaction, kind) {
  if (kind === 'RECEIPT') {
    if (transaction.direction !== 'CREDIT') {
      throw new ValidationError(
        'A money receipt can only be issued for money received by Bihar Transport. '
        + `This transaction is a ${transaction.direction} — use a payment voucher instead.`,
      );
    }
    return;
  }

  if (transaction.direction !== 'DEBIT') {
    throw new ValidationError(
      'A payment voucher can only be issued for money paid out by Bihar Transport. '
      + `This transaction is a ${transaction.direction} — use a money receipt instead.`,
    );
  }
  if (transaction.to_party && !OUTGOING_PARTIES.has(transaction.to_party)) {
    throw new ValidationError(
      `A payment voucher pays a driver, an owner or a vendor. This transaction is payable to `
      + `"${transaction.to_party}", which is not one of them.`,
    );
  }
}

/**
 * Render a money receipt or a payment voucher.
 *
 * @param {Object} args
 * @param {Object} args.transaction the persisted FinancialTransaction row
 * @param {'RECEIPT'|'VOUCHER'} args.kind
 * @param {Object} [args.trip]      the Trip it belongs to
 * @param {Object} [args.invoice]   the Invoice a receipt settles
 * @param {Object} [args.counterparty] name of the customer / driver / owner
 * @returns {Promise<Buffer>}
 */
async function renderPaymentDocument({ transaction, kind, trip = null, invoice = null, counterparty = null }) {
  assertDocumentType(transaction, kind);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 44 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PAGE_W = doc.page.width;
    const LEFT = doc.page.margins.left;
    const RIGHT = PAGE_W - doc.page.margins.right;
    const INK = '#0f172a';
    const MUTED = '#64748b';
    const LINE = '#cbd5e1';
    const BRAND = '#b45309';

    const isReceipt = kind === 'RECEIPT';
    const title = isReceipt ? 'MONEY RECEIPT' : 'PAYMENT VOUCHER';

    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text('Bihar Transport');
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Road Freight Services · Begusarai, Bihar');
    doc.moveDown(1);

    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text(title, { align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`Ref: ${transaction.reference_number || `TXN-${transaction.transaction_id}`}`, { align: 'right' });

    doc.moveDown(1);
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).stroke();
    doc.moveDown(1);

    // ── The amount, stated first and largest ────────────────────────────────
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
      .text(isReceipt ? 'AMOUNT RECEIVED' : 'AMOUNT PAID', LEFT, doc.y, { characterSpacing: 0.8 });
    doc.moveDown(0.4);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(30)
      .text(inr(transaction.amount), LEFT, doc.y);
    doc.moveDown(0.8);

    // ── Detail rows ────────────────────────────────────────────────────────
    const rows = [
      ['Date', fmtDate(transaction.transaction_date || transaction.created_at)],
      [
        isReceipt ? 'Received From' : 'Paid To',
        counterparty
        || (isReceipt
          ? (transaction.from_party === 'CLIENT' ? 'Client' : 'Customer')
          : (transaction.to_party === 'DRIVER' ? 'Driver' : (transaction.to_party === 'TRANSPORT_OWNER' ? 'Transport Owner' : 'Vendor'))),
      ],
      ['Payment Method', METHOD_LABEL[String(transaction.payment_method || '').toUpperCase()] || transaction.payment_method || '—'],
      ['Reference', transaction.reference_number || '—'],
      ['Transaction Type', transaction.transaction_type],
      ['Direction', isReceipt ? 'Received by Bihar Transport' : 'Paid by Bihar Transport'],
      ['Trip', trip?.trip_number ? `${trip.trip_number}${trip.booking_id ? '' : ' (standalone)'}` : (transaction.trip_id ? `#${transaction.trip_id}` : '—')],
      ['Route', trip ? `${trip.pickup_city || trip.pickup_location} → ${trip.drop_city || trip.drop_location}` : '—'],
      ['Invoice', invoice ? `${invoice.invoice_number} (${invoice.payment_status})` : '—'],
      ['Purpose', transaction.purpose || '—'],
      ['Status', transaction.status],
      ['Ledger Entry', `financial_transactions #${transaction.transaction_id}`],
    ];

    if (String(transaction.payment_method || '').toUpperCase() === 'SETTLEMENT') {
      rows.push(['Settlement Note', 'This is a settlement adjustment, not a cash receipt. No cash was collected.']);
    }

    const labelX = LEFT;
    const valueX = LEFT + 150;
    let y = doc.y + 4;

    for (const [label, value] of rows) {
      if (y > doc.page.height - 150) break;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9)
        .text(label, labelX, y, { width: 140 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text(String(value ?? '—'), valueX, y, { width: RIGHT - valueX });
      y = Math.max(doc.y, y + 14) + 1;
    }

    // ── Signatures ─────────────────────────────────────────────────────────
    const signY = doc.page.height - 130;
    doc.moveTo(LEFT, signY).lineTo(RIGHT, signY).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('For Bihar Transport', LEFT, signY + 12)
      .text(isReceipt ? 'Received by' : 'Authorised by', RIGHT - 200, signY + 12, { width: 200, align: 'right' });

    doc.fillColor(MUTED).font('Helvetica').fontSize(7.5)
      .text(
        'This document is generated from the Bihar Transport financial ledger. It is valid only for the '
        + 'ledger entry named above and carries no separate authority.',
        LEFT,
        doc.page.height - 62,
        { width: RIGHT - LEFT },
      );

    doc.end();
  });
}

module.exports = {
  renderPaymentDocument,
  assertDocumentType,
  METHOD_LABEL,
};

/**
 * InvoicePdf.js
 * ============================================================================
 * "[Download PDF]" for the CUSTOMER INVOICE — a REAL pdfkit document rendered
 * from the PERSISTED invoice row.
 *
 * WHAT MAKES IT REAL, AND WHAT WOULD NOT
 *   There is no placeholder page and no "coming soon". Every figure printed
 *   here is read out of the `invoices` row by `TripInvoiceService`, and every
 *   figure is one that row received from the CONFIRMED commercial record. The
 *   renderer performs no arithmetic of its own beyond formatting.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM (§12)
 *   The face of the document says "INTERNAL CUSTOMER INVOICE". There is no GST
 *   e-invoice API in this system, so there is no IRN and no government
 *   acknowledgement, and the PDF does not pretend otherwise. If a real e-invoice
 *   integration is added later, `invoice.irn` / `invoice.gov_ack_json` exist to
 *   hold the acknowledgement and this renderer can print them — but until then
 *   it prints nothing that would imply the tax department has seen this
 *   document.
 *
 * GST HONESTY (§13)
 *   The confirmed quotation stores a GST TYPE and PERCENTAGE but never a
 *   CGST/SGST/IGST split, because that rule was never specified for this
 *   business. So the invoice prints GST as ONE line. When those columns are
 *   null the document says so explicitly instead of showing a fabricated
 *   half-and-half that a customer would later query.
 *
 * PRIVACY
 *   A customer invoice is addressed to the CUSTOMER. It prints no driver name,
 *   no driver mobile, no vendor name and no internal margin — exactly the rule
 *   `QuotationPdf` already follows.
 */

const PDFDocument = require('pdfkit');

/** Rupee formatting matching the UI's en-IN grouping. */
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

/**
 * Render the customer invoice to a PDF buffer.
 *
 * @param {Object} args
 * @param {Object} args.invoice   the persisted Invoice row
 * @param {Object} [args.trip]    the Trip it bills
 * @param {Object} [args.customer] the billing identity
 * @param {Object} [args.position]  the derived received/balance
 * @param {Array}  [args.charges]   additional-charge lines from the quotation
 * @returns {Promise<Buffer>}
 */
async function renderInvoicePdf({ invoice, trip = null, customer = null, position = null, charges = [] }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
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

    // ── Header ──────────────────────────────────────────────────────────────
    doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(20).text('Bihar Transport');
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text('Road Freight Services · Begusarai, Bihar', { continued: false });

    doc.moveDown(0.8);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('INVOICE', { align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(invoice.invoice_number, { align: 'right' });

    doc.moveDown(1);
    const headerTop = doc.y;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8)
      .text('INTERNAL CUSTOMER INVOICE', LEFT, headerTop, { width: RIGHT - LEFT, characterSpacing: 0.6 });

    // Stated on the face of the document, not buried in a footnote.
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(
        'This is an invoice raised by Bihar Transport. It is not a GST e-invoice: no IRN has been '
        + 'generated and no government e-invoice system has been contacted.',
        LEFT,
        doc.y + 2,
        { width: RIGHT - LEFT },
      );

    doc.moveDown(1);

    // ── Bill to / Invoice meta ──────────────────────────────────────────────
    const colW = (RIGHT - LEFT) / 2 - 10;
    const metaTop = doc.y;

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('BILL TO', LEFT, metaTop);
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(10)
      .text(customer?.name || invoice.billing_to || '—', LEFT, doc.y + 2, { width: colW });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    if (customer?.contact_person) doc.text(customer.contact_person, { width: colW });
    if (customer?.address) doc.text(customer.address, { width: colW });
    if (customer?.city) doc.text([customer.city, customer.state].filter(Boolean).join(', '), { width: colW });
    if (customer?.phone) doc.text(`Phone: ${customer.phone}`, { width: colW });
    if (customer?.gst_number) doc.text(`GSTIN: ${customer.gst_number}`, { width: colW });

    const metaLeft = LEFT + colW + 20;
    let metaY = metaTop;
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('INVOICE DETAILS', metaLeft, metaY);
    metaY = doc.y + 3;
    doc.font('Helvetica').fontSize(9).fillColor(INK);
    const metaRows = [
      ['Invoice Number', invoice.invoice_number],
      ['Invoice Date', fmtDate(invoice.invoice_date || invoice.issued_at || invoice.created_at)],
      ['LR Number', trip?.trip_number || '—'],
      ['Consignment', trip?.trip_number ? `${trip.trip_number}` : '—'],
      ['Route', trip ? `${trip.pickup_city || trip.pickup_location} → ${trip.drop_city || trip.drop_location}` : '—'],
      ['Invoice Status', invoice.status],
      ['Payment Status', invoice.payment_status],
      ['Due Date', fmtDate(invoice.due_at)],
    ];
    for (const [label, value] of metaRows) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, metaLeft, metaY, { width: 70 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text(String(value ?? '—'), metaLeft + 72, metaY, { width: colW - 72 });
      metaY = Math.max(doc.y, metaY + 12) + 1;
    }

    doc.y = Math.max(doc.y, metaY) + 10;

    // ── Charges table ───────────────────────────────────────────────────────
    doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).stroke();
    doc.moveDown(0.6);

    const drawTableHeader = () => {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8);
      doc.text('DESCRIPTION', LEFT, y, { width: RIGHT - LEFT - 220 });
      doc.text('QTY', RIGHT - 215, y, { width: 60 });
      doc.text('RATE', RIGHT - 150, y, { width: 80, align: 'right' });
      doc.text('AMOUNT', RIGHT - 65, y, { width: 65, align: 'right' });
      doc.y = y + 13;
      doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(LINE).stroke();
      doc.moveDown(0.4);
    };

    drawTableHeader();

    const row = (description, qty, rate, amount) => {
      if (doc.y > doc.page.height - 140) {
        doc.addPage();
        drawTableHeader();
      }
      const y = doc.y;
      doc.fillColor(INK).font('Helvetica').fontSize(9)
        .text(description, LEFT, y, { width: RIGHT - LEFT - 220 });
      doc.text(String(qty), RIGHT - 215, y, { width: 60 });
      doc.text(String(rate), RIGHT - 150, y, { width: 80, align: 'right' });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(9)
        .text(String(amount), RIGHT - 65, y, { width: 65, align: 'right' });
      doc.y = y + 15;
    };

    row('Freight charges', '1', inr(invoice.goods_amount), inr(invoice.goods_amount));

    for (const charge of charges || []) {
      const qty = charge.quantity_unit
        ? `${charge.quantity} ${charge.quantity_unit}`
        : String(charge.quantity ?? 1);
      row(charge.charge_name || 'Additional charge', qty, inr(charge.rate), inr(charge.total));
    }

    const extra = Number(invoice.extra_charges || 0);
    const hasLines = (charges || []).length > 0;
    if (!hasLines && extra > 0) row('Additional charges', '1', inr(extra), inr(extra));

    // ── Totals ──────────────────────────────────────────────────────────────
    doc.moveDown(0.5);
    const totalsTop = Math.max(doc.y, 80);

    const totals = [];
    totals.push(['Taxable Amount', inr(invoice.taxable_amount ?? invoice.goods_amount)]);

    // GST is printed as ONE line, because the confirmed quotation records a
    // type and a percentage but never a centre/state split. Nothing is invented.
    const gstLabel = invoice.gst_type
      ? `GST (${invoice.gst_type}${invoice.gst_percentage ? ` @ ${invoice.gst_percentage}%` : ''})`
      : 'GST';
    if (invoice.tax_amount !== null && invoice.tax_amount !== undefined) {
      totals.push([gstLabel, inr(invoice.tax_amount)]);
    } else {
      totals.push([gstLabel, 'Not configured']);
    }

    totals.push(['Invoice Total', inr(invoice.grand_total ?? invoice.total_amount ?? invoice.final_price)]);

    if (position) {
      totals.push(['Received', inr(position.received)]);
      totals.push(['Balance Due', inr(position.balance)]);
    }

    const labelX = RIGHT - 240;
    const valueX = RIGHT - 130;
    let ty = totalsTop;

    for (const [label, value] of totals) {
      const emphasise = label === 'Invoice Total' || label === 'Balance Due';
      doc.fillColor(emphasise ? INK : MUTED).font(emphasise ? 'Helvetica-Bold' : 'Helvetica').fontSize(emphasise ? 10 : 9)
        .text(label, labelX, ty, { width: 110 });
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(emphasise ? 10 : 9)
        .text(value, valueX, ty, { width: 130, align: 'right' });
      ty += emphasise ? 18 : 14;
    }

    // ── GST split disclosure ────────────────────────────────────────────────
    doc.y = Math.max(doc.y, ty) + 6;
    if (invoice.cgst === null && invoice.sgst === null && invoice.igst === null) {
      doc.fillColor(MUTED).font('Helvetica').fontSize(8)
        .text(
          'No CGST / SGST / IGST split is shown because the confirmed quotation for this consignment '
          + 'does not record one. The GST above is stated as a single line exactly as it was agreed.',
          LEFT,
          doc.y,
          { width: RIGHT - LEFT },
        );
    }

    // ── Footer ──────────────────────────────────────────────────────────────
    const footerY = doc.page.height - 90;
    doc.moveTo(LEFT, footerY).lineTo(RIGHT, footerY).strokeColor(LINE).stroke();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8)
      .text(
        `Generated by Bihar Transport on ${fmtDate(new Date())}. `
        + 'Customer payments are recorded separately against this invoice; the balance above is derived '
        + 'from the payment ledger, not from the invoice status.',
        LEFT,
        footerY + 8,
        { width: RIGHT - LEFT },
      );

    doc.end();
  });
}

module.exports = { renderInvoicePdf };

/**
 * QuotationPdf.js
 * ---------------------------------------------------------------------------
 * PHASE B — "[Download Quotation]" (client document §2).
 *
 * A REAL PDF, generated with pdfkit, from the PERSISTED quotation row.
 *
 * RULES THIS RENDERER FOLLOWS
 *   • It reads only what QuotationService has already written to PostgreSQL.
 *     Nothing is recalculated here and nothing is passed in from the request,
 *     so the document can never disagree with the database.
 *   • It NEVER prints private operational data. No driver name, no driver
 *     mobile, no vehicle-owner name or mobile, no internal notes. The client
 *     document's quotation is a customer-facing commercial document.
 *   • Customer contact details are printed because the customer is the
 *     intended recipient of their own quotation.
 *   • It carries the SAME additional-charge disclosure as the customer page.
 *     This PDF is the complete customer-facing quotation, so a disclosure that
 *     lived only on the web page would disappear the moment the customer saves
 *     or forwards the file. The wording is chosen from the persisted quotation —
 *     never invented, and never naming a charge category that is not on file.
 *   • GST is shown exactly as stored. Because the RCM arithmetic is
 *     "NOT SPECIFIED IN CLIENT DOCUMENT", the PDF prints the GST type,
 *     percentage and amount as informational lines and does NOT alter the total.
 *
 * The visual language deliberately stays plain and functional — this is a
 * business document, and the application's UI identity is not being extended
 * into it.
 */

const PDFDocument = require('pdfkit');

/** Rupee formatting used throughout. Matches the UI's en-IN grouping. */
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

/** Human label for a stored enum value, using the client's own wording. */
const RATE_TYPE_LABEL = { FIXED: 'FIXED', PER_UNIT: 'PER_UNIT' };

/**
 * The conditional per-day retention / detention rate disclosed on the customer
 * quotation. It is a DISCLOSED RATE ONLY — it is never added to the freight,
 * never added to GST, and never written to the Quotation or its charges. The
 * client document's own term for this charge is "Detention", so both the client's
 * wording and the plainer "retention" reading are printed.
 */
const RETENTION_RATE_PER_DAY = 1000;
const RETENTION_RATE_PER_DAY_LABEL = `₹${RETENTION_RATE_PER_DAY.toLocaleString('en-IN')}`;
const GST_TYPE_LABEL = { RCM: 'RCM', FORWARD_CHARGE: 'FORWARD_CHARGE', EXEMPT: 'EXEMPT' };
const SCHEDULE_LABEL = {
  FULL_PAYMENT_IN_ADVANCE: 'Full Payment in Advance',
  BOOKING_ADVANCE_BALANCE: 'Booking Amount + Advance After Loading + Balance at Unloading',
  CUSTOM: 'Custom Schedule',
};

/**
 * Render the quotation to a PDF buffer.
 *
 * @param {object} args
 * @param {object} args.quotation  the persisted Quotation (with charges + milestones)
 * @param {object} args.enquiry    the persisted Enquiry it belongs to
 * @returns {Promise<Buffer>}
 */
async function renderQuotationPdf({ quotation, enquiry }) {
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

    /* ── Header: existing "BIHAR TRANSPORT" wordmark from the client doc ── */
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('BIHAR TRANSPORT', LEFT, 40);
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('converting loads into trust since 1998', LEFT, doc.y + 1);

    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(16)
      .text('QUOTATION', RIGHT - 160, 40, { width: 160, align: 'right' });

    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(9)
      .text(`Quotation No.: ${quotation.quotation_number}`, RIGHT - 200, 62, {
        width: 200,
        align: 'right',
      })
      .text(`Enquiry No.: ${enquiry.enquiry_number}`, RIGHT - 200, 74, { width: 200, align: 'right' })
      .text(`Date: ${fmtDate(quotation.quoted_at || enquiry.created_at)}`, RIGHT - 200, 86, {
        width: 200,
        align: 'right',
      });

    /* ── Status ─────────────────────────────────────────────────────────── */
    const statusLabel = {
      DRAFT: 'DRAFT',
      RATE_QUOTED: 'RATE QUOTED',
      SENT: 'SENT',
      CONVERTED: 'CONVERTED',
    }[quotation.status] || quotation.status;

    let y = 110;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(1).strokeColor(LINE).stroke();
    y += 10;

    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('STATUS', LEFT, y);
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(statusLabel, LEFT, y + 11);
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('VALIDITY', LEFT + 140, y);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(10)
      .text(
        quotation.validity_days ? `${quotation.validity_days} Days` : 'Not specified',
        LEFT + 140,
        y + 11,
      );
    doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(8).text('VALID UNTIL', LEFT + 280, y);
    doc
      .fillColor(INK)
      .font('Helvetica')
      .fontSize(10)
      .text(fmtDate(quotation.valid_until), LEFT + 280, y + 11);

    y += 34;

    /* ── Section: party & shipment (client document §1 field list) ─────── */
    const section = (title) => {
      y += 6;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 6;
      doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(9).text(title.toUpperCase(), LEFT, y);
      y += 14;
    };

    const pair = (label, value, col = 0) => {
      const colW = (RIGHT - LEFT) / 2;
      const x = LEFT + col * colW;
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, x, y);
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(value === null || value === undefined || value === '' ? '—' : String(value), x, y + 10, {
          width: colW - 10,
        });
      if (col === 1) y += 26;
    };

    section('Enquiry / Shipment');
    pair('Party', enquiry.customer_name);
    pair('Contact Person', enquiry.contact_person || enquiry.customer_name);
    pair('Mobile', enquiry.customer_mobile);
    pair('Date', fmtDate(enquiry.created_at));
    pair('Pickup City', enquiry.pickup_city || enquiry.pickup_location);
    pair('Drop City', enquiry.drop_city || enquiry.drop_location);
    pair('Pickup Location', enquiry.pickup_address || enquiry.pickup_location);
    pair('Drop Location', enquiry.drop_address || enquiry.drop_location);
    pair('Goods', enquiry.material);
    pair(
      'Quantity',
      enquiry.quantity !== null && enquiry.quantity !== undefined
        ? `${enquiry.quantity}${enquiry.quantity_unit ? ` ${enquiry.quantity_unit}` : ''}`
        : null,
    );
    pair(
      'Weight',
      enquiry.weight !== null && enquiry.weight !== undefined
        ? `${enquiry.weight}${enquiry.weight_unit ? ` ${enquiry.weight_unit}` : ''}`
        : null,
    );
    pair('Distance', enquiry.distance_km ? `${enquiry.distance_km} Km` : null);

    /* ── Money table ────────────────────────────────────────────────────── */
    section('Rate / Freight / GST');

    const moneyRow = (label, value, { bold = false, accent = false } = {}) => {
      doc
        .fillColor(bold ? INK : '#334155')
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(bold ? 10 : 9.5)
        .text(label, LEFT, y, { width: RIGHT - LEFT - 140 });
      doc
        .fillColor(accent ? BRAND : INK)
        .font('Helvetica-Bold')
        .fontSize(bold ? 11 : 9.5)
        .text(value, RIGHT - 140, y, { width: 140, align: 'right' });
      y += bold ? 20 : 16;
    };

    moneyRow('Rate Type', RATE_TYPE_LABEL[quotation.rate_type] || quotation.rate_type);
    moneyRow('Rate', quotation.rate !== null && quotation.rate !== undefined ? inr(quotation.rate) : '—');
    moneyRow('Freight', inr(quotation.freight));
    moneyRow('Total Freight', inr(quotation.total_freight));
    if (quotation.gst_type) {
      moneyRow('GST Type', GST_TYPE_LABEL[quotation.gst_type] || quotation.gst_type);
    }
    if (quotation.gst_percentage !== null && quotation.gst_percentage !== undefined) {
      moneyRow('GST %', `${quotation.gst_percentage}%`);
    }
    // Informational only — GST is never folded into any total because the RCM
    // arithmetic is NOT SPECIFIED IN CLIENT DOCUMENT.
    if (Number(quotation.gst_amount) > 0) {
      moneyRow('GST Amount', `${inr(quotation.gst_amount)} (informational)`);
    }

    /* ── Additional charges ─────────────────────────────────────────────── */
    if (quotation.charges && quotation.charges.length) {
      section('Additional Charges');
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('CHARGES NAME', LEFT, y, { width: 200 })
        .text('RATE', RIGHT - 230, y, { width: 70, align: 'right' })
        .text('QUANTITY', RIGHT - 150, y, { width: 70, align: 'right' })
        .text('TOTAL', RIGHT - 70, y, { width: 70, align: 'right' });
      y += 13;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 5;

      for (const c of quotation.charges) {
        doc
          .fillColor(INK)
          .font('Helvetica')
          .fontSize(9.5)
          .text(c.charges_name, LEFT, y, { width: 200 })
          .text(inr(c.rate), RIGHT - 230, y, { width: 70, align: 'right' })
          .text(
            `${c.quantity}${c.quantity_unit ? ` ${c.quantity_unit}` : ''}`,
            RIGHT - 150,
            y,
            { width: 70, align: 'right' },
          )
          .text(inr(c.total), RIGHT - 70, y, { width: 70, align: 'right' });
        y += 15;
      }
      moneyRow('Total Additional Charges', inr(quotation.total_additional_charges), { bold: true });
      moneyRow('Additional Charges Tax', inr(quotation.additional_charges_tax));
    }

    /* ── Grand total ────────────────────────────────────────────────────── */
    y += 4;
    doc.rect(LEFT, y, RIGHT - LEFT, 26).fill('#fef3c7');
    doc
      .fillColor(INK)
      .font('Helvetica-Bold')
      .fontSize(12)
      .text('Total Billing Amount', LEFT + 10, y + 8);
    doc
      .fillColor(BRAND)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(inr(quotation.total_billing_amount), RIGHT - 160, y + 7, { width: 150, align: 'right' });
    y += 36;

    /* ── Additional-charge + retention disclosure ────────────────────────────
       Printed directly under the Total Billing Amount, because that is the
       figure the disclosure is about and the reader will still be looking at
       it.

       WHY THE WORDING IS SELECTED RATHER THAN FIXED: it has to match what this
       quotation actually says.
         • the quotation itemises additional charges → those charges are already
           inside the Total Billing Amount, so the sentence says so explicitly
           and repeats that anything outside this quotation must be communicated
           first;
         • it itemises none → the Total Billing Amount is stated as covering the
           charges included in this quotation, with anything else conditional on
           prior disclosure.

       It is a statement of a possibility that must be communicated before it is
       applied. It never alleges that anything is being withheld — the total on
       this document is the total they are being asked to pay for what it lists.

       NO charge category is named in EITHER of those two sentences. Toll,
       parking, loading and unloading are deliberately absent: none of them is
       defined by the quotation or the client document, so naming them would be
       inventing a charge the company has never quoted.

       THE RETENTION / DETENTION PARAGRAPH IS THE ONE EXCEPTION, and it is a
       named charge because the client document names it: its example
       additional-charge line reads "Detention rate × N Days" for exactly this
       situation — the truck is held / sits vacant for a day. That existing term is
       preserved rather than replaced with a new name.

       IT IS COPY, NOT ARITHMETIC. ₹1,000/day is NOT added to the Total Billing
       Amount, NOT added to GST, and no detention row is written to the database
       to justify the sentence. It applies only if a real retention event occurs,
       which is then raised through the normal financial workflow. */
    const chargesTotal = Number(quotation.total_additional_charges);
    const hasCharges =
      (Array.isArray(quotation.charges) && quotation.charges.length > 0) ||
      (Number.isFinite(chargesTotal) && chargesTotal > 0);

    const additionalChargeNote = hasCharges
      ? `${inr(quotation.total_billing_amount)} is the final quoted amount for the charges included in this quotation, including ${inr(
          chargesTotal,
        )} of additional charges already applied. Any additional charge that may apply for services or circumstances not included in this quotation will be communicated by Bihar Transport before it is applied.`
      : `${inr(quotation.total_billing_amount)} is the final quoted amount for the charges included in this quotation. Additional charges may apply only if separately applicable and will be communicated by Bihar Transport before being applied.`;

    const retentionNote = `Retention (detention): ${RETENTION_RATE_PER_DAY_LABEL}/day may apply if the vehicle is retained/vacant. Retention (detention) charges of ${RETENTION_RATE_PER_DAY_LABEL} per day may apply if the assigned vehicle is retained/vacant beyond the agreed schedule. Any applicable retention charge will be communicated by Bihar Transport before being applied. This is not part of the Total Billing Amount above.`;

    const disclosure = `${additionalChargeNote}\n\n${retentionNote}`;

    y += 2;
    const disclosureWidth = RIGHT - LEFT - 16;
    const disclosureHeight = doc.font('Helvetica').fontSize(8).heightOfString(disclosure, {
      width: disclosureWidth,
    });
    doc.rect(LEFT, y, RIGHT - LEFT, disclosureHeight + 14).fill('#f8fafc');
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(disclosure, LEFT + 8, y + 7, { width: disclosureWidth });
    y += disclosureHeight + 26;

    /* ── Payment schedule (client document §2) ──────────────────────────── */
    section('Payment Schedule');
    doc.fillColor(INK).font('Helvetica').fontSize(9.5).text(SCHEDULE_LABEL[quotation.payment_schedule_type] || '—', LEFT, y);
    y += 16;

    const milestones = quotation.milestones || [];
    if (milestones.length) {
      doc
        .fillColor(MUTED)
        .font('Helvetica-Bold')
        .fontSize(8)
        .text('DUE POINT', LEFT, y, { width: 220 })
        .text('TYPE', LEFT + 220, y, { width: 90 })
        .text('AMOUNT', RIGHT - 160, y, { width: 160, align: 'right' });
      y += 13;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.5).strokeColor(LINE).stroke();
      y += 5;

      for (const m of milestones) {
        doc
          .fillColor(INK)
          .font('Helvetica')
          .fontSize(9.5)
          .text(m.due_point, LEFT, y, { width: 220 })
          .text(m.amount_type === 'PERCENTAGE' ? 'PERCENTAGE' : 'FIXED', LEFT + 220, y, { width: 90 })
          .text(inr(m.computed_amount), RIGHT - 160, y, { width: 160, align: 'right' });
        y += 15;
      }
    }
    moneyRow('Total Scheduled', inr(quotation.schedule_total));
    moneyRow('Remaining Balance', inr(quotation.schedule_remaining), { bold: true });

    /* ── Remarks / vehicle ──────────────────────────────────────────────── */
    const vehicle =
      enquiry.assigned_vehicle_type || enquiry.requested_vehicle_name || null;
    if (vehicle || enquiry.special_instructions || quotation.remarks) {
      section('Remarks');
      if (vehicle) pair('Vehicle Type', vehicle);
      if (enquiry.special_instructions) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('ENQUIRY REMARKS', LEFT, y);
        doc.fillColor(INK).font('Helvetica').fontSize(9).text(enquiry.special_instructions, LEFT, y + 10, {
          width: RIGHT - LEFT,
        });
        y += 26;
      }
      if (quotation.remarks) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(8).text('QUOTATION REMARKS', LEFT, y);
        doc.fillColor(INK).font('Helvetica').fontSize(9).text(quotation.remarks, LEFT, y + 10, {
          width: RIGHT - LEFT,
        });
        y += 26;
      }
    }

    /* ── Footer ─────────────────────────────────────────────────────────── */
    const footY = doc.page.height - 62;
    doc.moveTo(LEFT, footY).lineTo(RIGHT, footY).lineWidth(0.5).strokeColor(LINE).stroke();
    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `This is a computer-generated quotation from Bihar Transport. Quotation ${quotation.quotation_number} · Enquiry ${enquiry.enquiry_number}`,
        LEFT,
        footY + 8,
        { width: RIGHT - LEFT, align: 'center' },
      );

    doc.end();
  });
}

module.exports = { renderQuotationPdf };

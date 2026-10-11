/**
 * VehicleHireChallanPdf.js
 * ---------------------------------------------------------------------------
 * "[ Download Challan ]" for a completed vehicle hire.
 *
 * THE SAME PDF INFRASTRUCTURE, NOT A SECOND ONE
 *   This renders with `pdfkit` — the identical dependency and the identical
 *   Promise/Buffer contract services/QuotationPdf.js already uses, so the two
 *   documents are produced by one pipeline and one file-serving code path. No
 *   new PDF library, no new renderer framework, no second download route.
 *
 * WHAT IT READS
 *   Only the PERSISTED `vehicle_hires` row and the Trip it belongs to. Nothing
 *   is recalculated here and nothing is passed in from the request, so the
 *   document can never disagree with the database. `challan_number` is derived
 *   once at hire time, so downloading twice produces the same challan.
 *
 * THE THREE MONEY FIGURES ARE PRINTED SEPARATELY
 *       GROSS VEHICLE HIRE
 *     − COMMISSION
 *     ───────────────────────────────────────────
 *     = NET VENDOR PAYABLE
 *   The gross is never replaced by the net on the document. An operator reading
 *   this challan, and an accountant reading the database, must see the same
 *   three numbers in the same order.
 *
 * IT IS NOT A RECEIPT
 *   Nothing on this document states that money was paid. A hire is an
 *   obligation; settlement happens later through the existing payment system.
 *   The footer says so, so the challan cannot be mistaken for a paid receipt.
 *
 * The visual language stays plain and functional — this is a business document,
 * matching the deliberate restraint of the quotation PDF.
 */

const PDFDocument = require('pdfkit');
const policy = require('../config/vehicleHirePolicy');

/** Rupee formatting. Matches the UI's en-IN grouping and the quotation PDF. */
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

/** Human label for a stored rate-basis enum, from the single policy module. */
function rateBasisLabel(basis) {
  const descriptor = policy.getRateBasis(basis);
  return descriptor ? descriptor.label : String(basis || '—');
}

/** Human label for a stored billing party. */
function billingToLabel(value) {
  const match = policy.BILLING_TO_OPTIONS.find((o) => o.value === value);
  return match ? match.label : String(value || '—');
}

/**
 * Render the vehicle-hire challan to a PDF buffer.
 *
 * @param {object} args
 * @param {object} args.hire - the persisted VehicleHire row, with `trip`,
 *                            `vehicle`, `vendor` and `driver` relations loaded
 * @returns {Promise<Buffer>}
 */
async function renderVehicleHireChallanPdf({ hire }) {
  if (!hire) throw new Error('A hire is required to render a challan');

  const trip = hire.trip || {};
  const vehicle = hire.vehicle || {};
  const vendor = hire.vendor || {};
  const driver = hire.driver || {};

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

    // ── Header ────────────────────────────────────────────────────────────
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(20).text('VEHICLE HIRE CHALLAN', LEFT);
    doc.moveDown(0.15);
    doc
      .fillColor(BRAND)
      .font('Helvetica')
      .fontSize(10)
      .text('Bihar Transport — Vehicle Hiring Module', LEFT);

    doc
      .fillColor(MUTED)
      .fontSize(9)
      .text(`Challan No: ${hire.challan_number || '—'}`, LEFT, doc.y, { align: 'right', width: PAGE_W - 2 * 40 });

    doc.moveDown(0.6);
    const headerTop = doc.y;
    doc.moveTo(LEFT, headerTop).lineTo(RIGHT, headerTop).lineWidth(1).strokeColor(LINE).stroke();
    doc.moveDown(0.9);

    // ── A labelled value row helper ───────────────────────────────────────
    const row = (label, value, opts = {}) => {
      const y = doc.y;
      doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(label, LEFT, y, { width: 150 });
      doc
        .fillColor(opts.muted ? MUTED : INK)
        .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(opts.bold ? 11 : 10)
        .text(value === null || value === undefined || value === '' ? '—' : String(value), LEFT + 155, y, {
        width: RIGHT - LEFT - 155,
      });
      doc.moveDown(0.28);
    };

    const sectionTitle = (title) => {
      doc.moveDown(0.6);
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(10).text(title.toUpperCase(), LEFT);
      doc.moveDown(0.2);
      const y = doc.y;
      doc.moveTo(LEFT, y).lineTo(RIGHT, y).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.moveDown(0.55);
    };

    // ── Consignment ────────────────────────────────────────────────────────
    sectionTitle('Consignment');
    row('Order / Trip No.', trip.trip_number || '—', { bold: true });
    row('Booking No.', trip.booking_number || (trip.booking_id ? `#${trip.booking_id}` : '—'));
    row('Trip Date', fmtDate(trip.trip_date || trip.created_at));
    row('From', [trip.pickup_location, trip.pickup_city].filter(Boolean).join(', '));
    row('To', [trip.drop_location, trip.drop_city].filter(Boolean).join(', '));
    row('Distance', trip.distance_km ? `${trip.distance_km} km` : '—');

    // ── Vehicle ───────────────────────────────────────────────────────────
    sectionTitle('Vehicle & Crew');
    row('Vehicle Number', vehicle.vehicle_number || '—', { bold: true });
    row('Vehicle Type', [vehicle.vehicle_type, vehicle.vehicle_name].filter(Boolean).join(' · ') || '—');
    row('Vehicle Vendor', vendor.owner_name || '—');
    row('Vendor Mobile', vendor.mobile || '—');
    row('Driver', driver.driver_name || '—', { bold: true });
    row('Driver Mobile', driver.mobile || '—');
    row('Driver Licence', driver.license_number || '—');

    // ── Commercial terms ──────────────────────────────────────────────────
    sectionTitle('Commercial Terms');
    row('Billing To', billingToLabel(hire.billing_to));
    row('Business Model', hire.business_model || '—', {
      bold: true,
    });
    if (hire.business_model_overridden) {
      doc
        .fillColor(BRAND)
        .font('Helvetica-Oblique')
        .fontSize(8)
        .text('(authorised override — differs from the model derived from Billing To)', LEFT, doc.y);
      doc.moveDown(0.3);
    }
    row('Rate As Per', rateBasisLabel(hire.rate_basis));

    const quantityText =
      hire.rate_quantity === null || hire.rate_quantity === undefined
        ? null
        : `${Number(hire.rate_quantity)}${hire.rate_unit ? ` ${hire.rate_unit}` : ''}`;

    row(
      'Agreed Rate',
      `${inr(Number(hire.rate_value))}${
        hire.rate_basis === 'NET_FREIGHT' ? ' (net payable)' : quantityText ? ` × ${quantityText}` : ''
      }`
    );

    // ── The money block: three separate figures, always ───────────────────
    sectionTitle('Amounts');

    const moneyRow = (label, value, emphasis = false) => {
      const y = doc.y;
      doc
        .fillColor(emphasis ? INK : MUTED)
        .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(emphasis ? 12 : 10)
        .text(label, LEFT, y, { width: 330 });
      doc
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(emphasis ? 13 : 11)
        .text(value, RIGHT - 150, y, { width: 150, align: 'right' });
      doc.moveDown(emphasis ? 0.42 : 0.3);
    };

    moneyRow('Gross Vehicle Hire', inr(hire.gross_hire));

    const commissionTypeLabel =
      String(hire.commission_type).toLowerCase() === 'fixed'
        ? `Commission (Fixed ${inr(Number(hire.commission_rate))})`
        : Number(hire.commission_rate) === 0
          ? 'Commission (No Commission)'
          : `Commission (${Number(hire.commission_rate)}%)`;
    moneyRow(commissionTypeLabel, `- ${inr(hire.commission_amount)}`);

    const ruleY = doc.y + 0.05;
    doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).lineWidth(0.8).strokeColor(INK).stroke();
    doc.moveDown(0.45);

    moneyRow('NET VENDOR PAYABLE', inr(hire.net_vendor_payable), true);

    doc.moveDown(0.15);
    doc
      .fillColor(MUTED)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .text(
        'This challan records the hiring of a vehicle. It is NOT a payment receipt. '
          + 'Net Vendor Payable above becomes payable through the vendor payment ledger separately.',
        LEFT,
        doc.y,
        { width: RIGHT - LEFT }
      );

    // ── Remarks ───────────────────────────────────────────────────────────
    if (hire.remarks) {
      sectionTitle('Remarks');
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(hire.remarks, LEFT, doc.y, {
        width: RIGHT - LEFT,
      });
      doc.moveDown(0.3);
    }

    // ── Document compliance snapshot ──────────────────────────────────────
    // Printed as it stood at the moment of hiring — the snapshot stored on the
    // hire, not the live master, so the document always matches the paperwork
    // the operator actually saw.
    const snapshot = hire.documents_snapshot;
    if (snapshot && Array.isArray(snapshot.documents)) {
      sectionTitle('Vehicle Document Status (at time of hiring)');
      doc.font('Helvetica').fontSize(8.5);
      snapshot.documents.forEach((d) => {
        const y = doc.y;
        doc.fillColor(MUTED).text(d.label, LEFT, y, { width: 190 });
        doc
          .fillColor(d.status === 'EXPIRED' ? '#b91c1c' : d.status === 'EXPIRING_SOON' ? '#b45309' : INK)
          .text(
            `${d.status}${d.expiry_date ? ` · ${fmtDate(d.expiry_date)}` : ''}`,
            LEFT + 195,
            y,
            { width: RIGHT - LEFT - 195 }
          );
        doc.moveDown(0.16);
      });
    }

    // ── Signatures ────────────────────────────────────────────────────────
    doc.moveDown(1.4);
    const sigY = doc.y;
    const half = (RIGHT - LEFT) / 2;
    doc.moveTo(LEFT, sigY).lineTo(LEFT + half - 20, sigY).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.moveTo(LEFT + half + 20, sigY).lineTo(RIGHT, sigY).lineWidth(0.6).strokeColor(LINE).stroke();

    doc
      .fillColor(MUTED)
      .font('Helvetica')
      .fontSize(9)
      .text('For Bihar Transport', LEFT, sigY + 6, { width: half - 20 });
    doc.text("Vehicle Vendor's Signature", LEFT + half + 20, sigY + 6, { width: half - 20 });

    // ── Footer ────────────────────────────────────────────────────────────
    doc
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Hired on ${fmtDate(hire.created_at)} · Hire ID ${hire.hire_id} · Generated by the Bihar Transport Vehicle Hiring module.`,
        LEFT,
        doc.page.height - 60,
        { width: RIGHT - LEFT, align: 'center' }
      );

    doc.end();
  });
}

module.exports = { renderVehicleHireChallanPdf };
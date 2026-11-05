/**
 * Trip Billing Routes — Batch 2B, Phase 3
 * ===========================================================================
 * THE CUSTOMER-INVOICE API for a consignment.
 *
 * WHY THIS FILE EXISTS
 *   `services/TripInvoiceService.js` has always been the ONE writer of an
 *   invoice (idempotent, transactional, timeline + audit) — but nothing was
 *   ever ROUTED to it, so the Dispatch page's "Create Invoice" button hit a
 *   404 and the only path to raise a customer bill was a manual database
 *   write. This file simply publishes the service that already existed,
 *   following the repository's route conventions.
 *
 * ROUTES
 *   POST /api/trips/:id/invoice             create (idempotent: second call is
 *                                           200 { created:false }, same bill)
 *   GET  /api/trips/:id/invoice             the invoice + its ledger position
 *   GET  /api/trips/:id/invoice/pdf         the real PDF rendered from the row
 *   POST /api/trips/:id/invoice/payments    a customer receipt (BANK needs the
 *                                           UTR; the invoice reconciles INSIDE
 *                                           the payment transaction)
 *
 * SECURITY
 *   All four are `protect, adminOnly` — customer billing is back-office money,
 *   the same gate `/:tripId/payments/client` and the owner settlements sit
 *   behind. Authorization is NOT loosened anywhere here.
 *
 * NO SECOND BILLING PATH
 *   Every write goes through `TripInvoiceService` — creation, receipts, the
 *   status reconciliation (`reconcileInvoiceStatus`) — so the duplicate-prevention
 *   partial index, the ledger stamping and the reconciled status are invariants
 *   of one code path, not of four.
 */

const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const {
  ValidationError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} = require('../utils/AppError');

const TripInvoiceService = require('../services/TripInvoiceService');
const { renderInvoicePdf } = require('../services/InvoicePdf');

const invoiceService = new TripInvoiceService();

// ===========================================================================
// HELPERS
// ===========================================================================

/** Map a service error onto the right status code, keeping the wording intact. */
function sendError(res, error, logLabel) {
  console.error(logLabel, error);
  if (error instanceof ValidationError) {
    return res.status(400).json({ success: false, message: error.message });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: error.message });
  }
  if (error instanceof ConflictError) {
    return res.status(409).json({ success: false, message: error.message });
  }
  if (error instanceof ForbiddenError) {
    return res.status(403).json({ success: false, message: error.message });
  }
  return res.status(500).json({ success: false, message: error.message || 'Server error' });
}

function readId(req, res) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id) || id <= 0) {
    res.status(400).json({ success: false, message: 'Invalid trip ID' });
    return null;
  }
  return id;
}

// ===========================================================================
// CREATE / READ
// ===========================================================================

/**
 * POST /api/trips/:id/invoice
 *
 * Raise the customer invoice for this consignment. Idempotent BY THE SERVICE'S
 * DESIGN: the first call answers 201 with the created document; a repeat
 * answers 200 with `{ created: false }` and the SAME invoice, and the partial
 * unique index (`invoices_one_dispatch_invoice_per_trip`) makes a second
 * bill impossible at the database layer as well.
 */
router.post('/:id/invoice', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const { invoice, created, position } = await invoiceService.createInvoice(
      tripId,
      req.user,
      req.body || {},
    );
    if (created) {
      return res.status(201).json({
        success: true,
        created: true,
        message: 'Customer invoice created',
        data: { ...invoice, position },
      });
    }
    return res.status(200).json({
      success: true,
      created: false,
      message: 'A customer invoice already exists for this consignment — returning it unchanged',
      data: { ...invoice, position },
    });
  } catch (error) {
    sendError(res, error, 'Create trip invoice error:');
  }
});

/**
 * GET /api/trips/:id/invoice
 *
 * The invoice plus everything the billing screen renders: its ledger position
 * (received / balance / status) and its charge lines. It also states, on the
 * data, that this is NOT a government GST e-invoice — the same honest negative
 * the document itself carries (`irn` is NULL by design).
 */
router.get('/:id/invoice', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const invoice = await invoiceService.getInvoiceForTrip(tripId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'No customer invoice exists for this consignment yet',
      });
    }
    return res.json({
      success: true,
      data: {
        ...invoice,
        is_government_e_invoice: false,
        note: 'This is an internal customer invoice. Bihar Transport does not integrate '
          + 'with the government GST e-invoice (IRN) system, so no GST e-invoice is '
          + 'generated and none is claimed here.',
      },
    });
  } catch (error) {
    sendError(res, error, 'Get trip invoice error:');
  }
});

// ===========================================================================
// THE PDF
// ===========================================================================

/**
 * GET /api/trips/:id/invoice/pdf
 *
 * The real invoice PDF, rendered from the STORED row (not from whatever the
 * browser last sent). The render is recorded on the invoice (`pdf_generated_at`)
 * so the document trail answers "was this ever printed".
 */
router.get('/:id/invoice/pdf', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const invoice = await invoiceService.getInvoiceForTrip(tripId);
    if (!invoice) {
      return res.status(404).json({
        success: false,
        message: 'No customer invoice exists for this consignment yet',
      });
    }
    const { prisma } = require('../config/prisma');
    const trip = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: { client: true, user: true },
    });
    if (!trip) throw new NotFoundError({ message: 'Trip not found' });

    const customer = await invoiceService.customerContext(trip);

    const buffer = await renderInvoicePdf({
      invoice,
      trip,
      customer,
      position: invoice.position,
      charges: invoice.charges || [],
    });

    // The render is a FACT about the document — persisted, not implied.
    await prisma.invoice.update({
      where: { invoice_id: invoice.invoice_id },
      data: { pdf_generated_at: new Date(), updated_at: new Date() },
    });

    const fileName = `${invoice.invoice_number.replace(/\//g, '-')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    return res.send(buffer);
  } catch (error) {
    sendError(res, error, 'Trip invoice PDF error:');
  }
});

// ===========================================================================
// RECEIPTS
// ===========================================================================

/**
 * POST /api/trips/:id/invoice/payments
 *
 * Record money RECEIVED against this consignment's invoice. The ledger row is
 * a CREDIT stamped with `invoice_id`, and the invoice's own state
 * (`payment_status` AND the InvoiceStatus enum) is reconciled inside the SAME
 * transaction — ₹35,000 of a ₹50,000 bill is PARTIALLY_PAID the moment the
 * receipt lands, not when somebody remembers to edit the document.
 *
 * A BANK transfer without its UTR is refused: a receipt that cannot be traced
 * is not a receipt.
 */
router.post('/:id/invoice/payments', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const result = await invoiceService.recordCustomerPayment(tripId, req.body, req.user);
    return res.status(201).json({
      success: true,
      message: 'Customer payment recorded',
      data: {
        transaction_id: result.transaction.transaction_id,
        invoice_id: result.invoice.invoice_id,
        invoice_number: result.invoice.invoice_number,
        payment_status: result.paymentStatus,
        invoice_status: result.invoice.status,
        received: result.received,
        total: result.total,
        balance: result.balance,
      },
    });
  } catch (error) {
    sendError(res, error, 'Record trip invoice payment error:');
  }
});

module.exports = router;

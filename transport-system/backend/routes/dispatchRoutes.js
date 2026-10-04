/**
 * dispatchRoutes.js
 * ============================================================================
 * PHASE 9 — THE DISPATCH WORKSPACE API.
 *
 * SCOPE: the dispatch act itself and the paperwork that has to exist before a
 * vehicle may leave — LR/GR, the e-way bill, transit insurance, delivery
 * information, and document upload/download. The customer invoice, the transit
 * workspace, incidents and vehicle changes are NOT here; they ship with the
 * Financial and Transit phases.
 *
 * MOUNTED AFTER `tripRoutes` and `tripFinancialRoutes` in server.js, at the same
 * `/api/trips` prefix. Every path here is NEW, so nothing shadows an existing
 * endpoint; the two Phase 4 dispatch endpoints that already existed
 * (`GET /:id/dispatch/readiness` and `POST /:id/dispatch`) were UPDATED IN PLACE
 * in tripRoutes.js rather than duplicated here.
 *
 * NO BUSINESS LOGIC IN THIS FILE (§37)
 *   Every handler is: parse the id, call ONE service method, shape the
 *   response. Readiness is computed in `TripDispatchService`, the document
 *   checklist in `TripDocumentService`, and the bytes in `TripDocumentStorage`.
 *   The rules live in services, the rules that are business POLICY live in
 *   `config/dispatchPolicy.js`.
 *
 * USER-FACING ERRORS (§36)
 *   A refusal never returns "Cannot move trip from LOADED to DISPATCHED". The
 *   services word every refusal as what is missing and what to do about it, and
 *   `sendError` passes that message straight through with the blocker list
 *   attached. The technical error still goes to the server log.
 */

const express = require('express');
const router = express.Router();

const { protect, adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/prisma');
const { ValidationError, NotFoundError, ForbiddenError } = require('../utils/AppError');

const TripDispatchService = require('../services/TripDispatchService');
const TripDocumentService = require('../services/TripDocumentService');
const TripDocumentStorage = require('../services/TripDocumentStorage');
const { EWAY_BILL_INTEGRATION_NOTICE } = require('../services/TripDispatchService');

const dispatchService = new TripDispatchService();
const documentService = new TripDocumentService();
const documentStorage = new TripDocumentStorage();

// ===========================================================================
// HELPERS
// ===========================================================================

/**
 * Map a service error onto the right status code, keeping the OPERATOR's
 * wording intact.
 */
function sendError(res, error, logLabel) {
  console.error(logLabel, error);
  if (error instanceof ValidationError) {
    return res.status(400).json({
      success: false,
      message: error.message,
      ...(error.details?.length ? { blockers: error.details } : {}),
    });
  }
  if (error instanceof NotFoundError) {
    return res.status(404).json({ success: false, message: error.message });
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

/** Stream a generated PDF to the browser. */
function sendPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);
  return res.send(buffer);
}

/**
 * Accept either an already-stored reference or raw bytes.
 *
 * Two shapes are supported on purpose: a client that has its own storage passes
 * `file_url` straight through (the repository's pre-existing convention), and a
 * browser that picked a file passes `file_content` + `file_name`, which
 * `TripDocumentStorage` writes to disk. Both end up in the SAME `file_url`
 * column; there is no second place a document can live.
 *
 * @returns {Promise<{file_url: string|null, uploaded: Object|null}>}
 */
async function resolveUpload(req, tripId, documentType) {
  if (req.body?.file_content) {
    const stored = await documentStorage.store({
      tripId,
      documentType,
      fileName: req.body.file_name,
      contentBase64: req.body.file_content,
    });
    return { file_url: stored.file_url, uploaded: stored };
  }
  return { file_url: req.body?.file_url || null, uploaded: null };
}

// ===========================================================================
// THE DISPATCH WORKSPACE
// ===========================================================================

/**
 * GET /api/trips/:id/dispatch
 *
 * EVERYTHING the Dispatch page renders, in one response: the header, the
 * readiness report with every blocker, the shipment facts, the vehicle and its
 * documents, the loading record, the document checklist, LR/GR, the e-way bill,
 * delivery, insurance, billing, additional charges, the dispatch record and the
 * movement history.
 *
 * The stepper's current stage is NOT sent from here — it comes from
 * `GET /:id/workflow`, which is the one lifecycle projection in this system.
 */
router.get('/:id/dispatch', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const workspace = await dispatchService.getWorkspace(tripId);
    res.json({ success: true, data: workspace });
  } catch (error) {
    sendError(res, error, 'Get dispatch workspace error:');
  }
});

/**
 * PATCH /api/trips/:id/dispatch
 *
 * Save the dispatch paperwork WITHOUT dispatching. This is how an operator
 * records the LR number, the e-way bill, the delivery contact and the POD
 * decision while the truck is still at the loading point, and it is what makes
 * the readiness blockers fixable from the page.
 */
router.patch('/:id/dispatch', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const sections = [];

    if (req.body.delivery || req.body.pod_required !== undefined || req.body.value_of_goods !== undefined) {
      sections.push(await dispatchService.saveDeliveryInfo(tripId, {
        ...(req.body.delivery || {}),
        pod_required: req.body.pod_required ?? req.body.delivery?.pod_required,
        value_of_goods: req.body.value_of_goods ?? req.body.delivery?.value_of_goods,
      }, req.user));
    }

    if (req.body.lr_gr) {
      sections.push(await dispatchService.saveLrGr(tripId, req.body.lr_gr, req.user));
    }
    if (req.body.eway_bill) {
      sections.push(await dispatchService.saveEwayBill(tripId, req.body.eway_bill, req.user));
    }
    if (req.body.insurance) {
      sections.push(await dispatchService.saveInsurance(tripId, req.body.insurance, req.user));
    }

    const readiness = await dispatchService.getReadiness(tripId);
    return res.json({
      success: true,
      message: sections.length
        ? 'Dispatch details saved'
        : 'Nothing to save — send delivery, lr_gr, eway_bill or insurance',
      saved: sections.length,
      readiness,
    });
  } catch (error) {
    sendError(res, error, 'Save dispatch details error:');
  }
});

// ── LR / GR ────────────────────────────────────────────────────────────────

/**
 * GET /api/trips/:id/dispatch/lr-gr
 * POST /api/trips/:id/dispatch/lr-gr
 *
 * The EXISTING `trip_documents` module, not a second LR system. The document
 * type is LR or GR, the row is the same one the checklist, verification and
 * deletion endpoints already use, and `TripDocumentService` owns the write.
 */
router.get('/:id/dispatch/lr-gr', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const trip = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: { documents: { orderBy: { document_id: 'asc' } } },
    });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const docs = trip.documents.filter((d) => d.document_type === 'LR' || d.document_type === 'GR');
    const dispatch = await prisma.tripDispatch.findFirst({ where: { trip_id: tripId } });
    const policy = require('../config/dispatchPolicy');

    return res.json({
      success: true,
      data: {
        required: policy.LR_GR_REQUIRED_DEFAULT,
        number: dispatch?.lr_gr_number || docs[0]?.reference_number || null,
        remarks: dispatch?.lr_gr_remarks || docs[0]?.remarks || null,
        document: docs[0] || null,
        all_documents: docs,
      },
    });
  } catch (error) {
    sendError(res, error, 'Get LR/GR error:');
  }
});

router.post('/:id/dispatch/lr-gr', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const upload = await resolveUpload(req, tripId, req.body.document_type || 'LR');
    const result = await dispatchService.saveLrGr(tripId, {
      ...req.body,
      file_url: upload.file_url,
    }, req.user);
    const readiness = await dispatchService.getReadiness(tripId);
    return res.status(201).json({
      success: true,
      message: upload.uploaded ? 'LR/GR recorded and file stored' : 'LR/GR recorded',
      data: { ...result, uploaded: upload.uploaded },
      readiness,
    });
  } catch (error) {
    sendError(res, error, 'Save LR/GR error:');
  }
});

// ── E-WAY BILL ─────────────────────────────────────────────────────────────

/**
 * GET /api/trips/:id/dispatch/eway-bill
 *
 * The internal record and the government confirmation are returned as SEPARATE
 * objects, always. The government object reports `NOT_CONNECTED` and carries no
 * number, because no government e-way bill API exists in this system. A client
 * cannot read this response and conclude that the NIC portal was contacted.
 */
router.get('/:id/dispatch/eway-bill', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const ewayBill = await prisma.ewayBill.findFirst({ where: { trip_id: tripId } });
    const trip = await prisma.trip.findUnique({
      where: { trip_id: tripId },
      include: { vehicle: true, documents: { where: { document_type: 'E_WAY_BILL' } } },
    });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    return res.json({
      success: true,
      data: {
        internal: ewayBill,
        government: ewayBill
          ? {
            sync_status: ewayBill.gov_sync_status,
            eway_bill_number: ewayBill.gov_eway_bill_number,
            synced_at: ewayBill.gov_synced_at,
          }
          : { sync_status: 'NOT_CONNECTED', eway_bill_number: null, synced_at: null },
        api_connected: false,
        integration_notice: EWAY_BILL_INTEGRATION_NOTICE,
        current_vehicle_number: trip.vehicle?.vehicle_number || null,
        document: trip.documents[0] || null,
      },
    });
  } catch (error) {
    sendError(res, error, 'Get E-Way Bill error:');
  }
});

/**
 * POST /api/trips/:id/dispatch/eway-bill
 *
 * [ Add E-Way Bill ] and [ Update Vehicle on E-Way Bill ] both land here.
 *
 * When the vehicle changes, the PREVIOUS vehicle is kept and an
 * `UPDATE REQUIRED` state is reported. That state means exactly one thing: an
 * operator must amend the paper we hold. It never means the government record
 * was updated, because it was not and this code has no way to do it.
 */
router.post('/:id/dispatch/eway-bill', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const upload = await resolveUpload(req, tripId, 'E_WAY_BILL');
    const result = await dispatchService.saveEwayBill(tripId, {
      ...req.body,
      file_url: upload.file_url,
    }, req.user);
    const readiness = await dispatchService.getReadiness(tripId);
    return res.status(201).json({
      success: true,
      message: upload.uploaded ? 'E-Way Bill recorded and file stored' : 'E-Way Bill recorded',
      data: { ...result, uploaded: upload.uploaded },
      readiness,
    });
  } catch (error) {
    sendError(res, error, 'Save E-Way Bill error:');
  }
});

// ── TRANSIT INSURANCE ──────────────────────────────────────────────────────

router.get('/:id/dispatch/insurance', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const insurance = await prisma.tripInsurance.findFirst({ where: { trip_id: tripId } });
    const trip = await prisma.trip.findUnique({ where: { trip_id: tripId } });
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const policy = require('../config/dispatchPolicy');
    const readiness = await dispatchService.getReadiness(tripId);

    return res.json({
      success: true,
      data: insurance || { trip_id: tripId, insured: false },
      requirement: policy.resolveInsuranceRequirement(trip),
      check: readiness.checks.find((c) => c.key === 'insurance') || null,
    });
  } catch (error) {
    sendError(res, error, 'Get transit insurance error:');
  }
});

router.post('/:id/dispatch/insurance', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const upload = await resolveUpload(req, tripId, 'INSURANCE');
    const result = await dispatchService.saveInsurance(tripId, {
      ...req.body,
      file_url: upload.file_url,
    }, req.user);
    const readiness = await dispatchService.getReadiness(tripId);
    return res.status(201).json({
      success: true,
      message: upload.uploaded ? 'Insurance recorded and certificate stored' : 'Insurance recorded',
      data: { ...result, uploaded: upload.uploaded },
      readiness,
    });
  } catch (error) {
    sendError(res, error, 'Save transit insurance error:');
  }
});

// ── DELIVERY INFORMATION ───────────────────────────────────────────────────

/**
 * POST /api/trips/:id/dispatch/delivery-info
 *
 * Captured before the vehicle leaves, because it cannot be recovered from a
 * truck that has already gone. `pod_required` here is what governs the whole
 * downstream workflow: YES gives DELIVERED → POD PENDING → POD RECEIVED →
 * COMPLETED, and NO lets DELIVERED → COMPLETED be a single step.
 */
router.post('/:id/dispatch/delivery-info', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const dispatch = await dispatchService.saveDeliveryInfo(tripId, req.body, req.user);
    const readiness = await dispatchService.getReadiness(tripId);
    return res.json({ success: true, message: 'Delivery information saved', data: dispatch, readiness });
  } catch (error) {
    sendError(res, error, 'Save delivery information error:');
  }
});

// ===========================================================================
// DOCUMENTS
// ===========================================================================

/**
 * POST /api/trips/:id/documents/upload
 *
 * [ Upload LR/GR ], [ Upload E-Way Bill ], [ Upload Certificate ] and the
 * generic "Other Document" all come through here. The bytes are written to disk
 * by `TripDocumentStorage` and the resulting reference is stored on the SAME
 * `trip_documents` row the rest of the module uses.
 */
router.post('/:id/documents/upload', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    const type = String(req.body.document_type || '').toUpperCase();
    if (!type) {
      return res.status(400).json({ success: false, message: 'A document type is required' });
    }

    let fileUrl = req.body.file_url || null;
    let uploaded = null;
    if (req.body.file_content) {
      uploaded = await documentStorage.store({
        tripId,
        documentType: type,
        fileName: req.body.file_name,
        contentBase64: req.body.file_content,
      });
      fileUrl = uploaded.file_url;
    }
    if (!fileUrl) {
      return res.status(400).json({
        success: false,
        message: 'No document was supplied. Send the file as file_content, or a stored reference as file_url.',
      });
    }

    const doc = await documentService.recordDocument(tripId, {
      document_type: type,
      document_status: req.body.document_status || 'PRESENT',
      reference_number: req.body.reference_number || null,
      issued_at: req.body.issued_at || null,
      expires_at: req.body.expires_at || null,
      file_url: fileUrl,
      remarks: req.body.remarks || null,
    }, req.user);

    return res.status(201).json({
      success: true,
      message: uploaded ? 'Document uploaded and stored' : 'Document recorded',
      data: { ...doc, uploaded },
    });
  } catch (error) {
    sendError(res, error, 'Upload trip document error:');
  }
});

/**
 * GET /api/trips/:id/documents/:documentId/file
 *
 * View / download a stored document. Admin-gated, like the rest of the trip
 * module: a consignment's paperwork is never a public asset.
 */
router.get('/:id/documents/:documentId/file', protect, adminOnly, async (req, res) => {
  const tripId = readId(req, res);
  if (tripId === null) return;
  try {
    // Scoped by trip_id in the QUERY, not by comparing after the fetch — this
    // is what stops a document id from one trip being read through another
    // trip's URL.
    const doc = await prisma.tripDocument.findFirst({
      where: { document_id: Number(req.params.documentId), trip_id: tripId },
    });
    if (!doc) return res.status(404).json({ success: false, message: 'Document not found for this trip' });
    if (!doc.file_url) {
      return res.status(404).json({ success: false, message: 'No file has been attached to this document yet' });
    }

    const { buffer, content_type, file_name } = await documentStorage.read(doc.file_url);
    res.setHeader('Content-Type', content_type);
    res.setHeader('Content-Disposition', `inline; filename="${file_name}"`);
    return res.send(buffer);
  } catch (error) {
    sendError(res, error, 'Download trip document error:');
  }
});

module.exports = router;

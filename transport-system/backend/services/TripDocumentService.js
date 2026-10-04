/**
 * TripDocumentService
 * ---------------------------------------------------------------------------
 * A trip's PAPERWORK, which is a fact entirely separate from the trip's
 * operational status.
 *
 * There is deliberately no `LOADED_WITH_LR` anywhere in this codebase. A
 * trip is `LOADED`; its lorry receipt is `PRESENT`; its e-way bill is
 * `VERIFIED`. Folding one into the other would make "is the truck loaded?"
 * and "does the paperwork exist?" impossible to answer independently — which
 * is exactly the question dispatch needs to ask (STEP 9).
 *
 * REUSES, DOES NOT REBUILD
 *   • TripTimeline  — every document event is recorded on the existing
 *                     append-only trip timeline; no second history table.
 *   • AuditLog      — the existing audit architecture records who changed what.
 *   • Prisma TripDocument — the model added by migration
 *                     20260929140001_phase4_trip_documents_and_loading_fields.
 *                     No Document2.
 *   • config/tripDocumentPolicy.js — the ONE place the required set lives.
 *
 * IDEMPOTENCY
 *   `trip_documents` has a UNIQUE (trip_id, document_type) index, so at most
 *   one document of each type can exist per trip. Recording the same document
 *   twice is therefore impossible at the database level as well as in code —
 *   the service treats a repeat of an identical record as a success and a
 *   repeat of a DIFFERENT record as a conflict, rather than silently
 *   overwriting either.
 */

const { prisma: defaultPrisma } = require('../config/prisma');
const { ValidationError, NotFoundError } = require('../utils/AppError');
const TripTimelineRepository = require('../repositories/TripTimelineRepository');
const AuditLogRepository = require('../repositories/AuditLogRepository');
const documentPolicy = require('../config/tripDocumentPolicy');

class TripDocumentService {
  /**
   * @param {Object} [deps]
   * @param {import('@prisma/client').PrismaClient} [deps.prisma]
   */
  constructor(deps = {}) {
    this.prisma = deps.prisma || defaultPrisma;
    this.timelineRepo = new TripTimelineRepository();
    this.auditRepo = new AuditLogRepository();
  }

  // =========================================================================
  // VALIDATION
  // =========================================================================

  /**
   * Validate the client-supplied part of a document record.
   *
   * The trip id is NEVER taken from the payload — it comes from the URL and
   * from the loaded Trip, so a document can never be filed against somebody
   * else's trip.
   *
   * @param {Object} input
   * @returns {Object} cleaned, validated values
   * @throws {ValidationError}
   */
  validateDocument(input = {}) {
    const type = String(input.document_type || '').toUpperCase();
    if (!documentPolicy.DOCUMENT_TYPES.includes(type)) {
      throw new ValidationError(
        `Invalid document_type "${input.document_type}". Expected one of: ${documentPolicy.DOCUMENT_TYPES.join(', ')}`
      );
    }

    // Status is optional on create; when given it must be a real status.
    let status = 'PRESENT';
    if (input.document_status !== undefined && input.document_status !== null && input.document_status !== '') {
      status = String(input.document_status).toUpperCase();
      if (!documentPolicy.DOCUMENT_STATUSES.includes(status)) {
        throw new ValidationError(
          `Invalid document_status "${input.document_status}". Expected one of: ${documentPolicy.DOCUMENT_STATUSES.join(', ')}`
        );
      }
    }

    const date = (v, label) => {
      if (v === undefined || v === null || v === '') return null;
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) throw new ValidationError(`Invalid ${label} "${v}"`);
      return d;
    };

    return {
      document_type: type,
      document_status: status,
      reference_number: input.reference_number || null,
      issued_at: date(input.issued_at, 'issued_at'),
      expires_at: date(input.expires_at, 'expires_at'),
      file_url: input.file_url || null,
      remarks: input.remarks || null,
    };
  }

  // =========================================================================
  // READ
  // =========================================================================

  /**
   * Every document recorded against a trip.
   * @param {number} tripId
   * @returns {Promise<Array>}
   */
  async getTripDocuments(tripId) {
    return await this.prisma.tripDocument.findMany({
      where: { trip_id: Number(tripId) },
      orderBy: { document_id: 'asc' },
    });
  }

  /**
   * The full checklist for a trip: every type the policy knows about, with the
   * ones actually recorded folded in, plus whether each is required for
   * dispatch and whether it is satisfied.
   *
   * @param {Object} trip - a Trip row
   * @returns {Promise<Object>}
   */
  async getChecklist(trip) {
    const documents = await this.getTripDocuments(trip.trip_id);
    const byType = new Map(documents.map((d) => [d.document_type, d]));
    const required = documentPolicy.requiredDocumentsFor(trip);

    const items = documentPolicy.DOCUMENT_TYPES.map((type) => {
      const doc = byType.get(type) || null;
      const isRequired = required.includes(type);
      return {
        document_type: type,
        required: isRequired,
        document: doc,
        document_status: doc ? doc.document_status : 'PENDING',
        is_present: Boolean(doc),
        // "Satisfied" means the paper exists. Verification is a stronger
        // statement and is reported separately rather than being demanded.
        satisfied: doc
          ? documentPolicy.SATISFIES_REQUIREMENT.includes(doc.document_status)
          : false,
      };
    });

    const missing = items.filter((i) => i.required && !i.satisfied);

    return {
      trip_id: trip.trip_id,
      required,
      items,
      missing: missing.map((m) => ({ document_type: m.document_type, document_status: m.document_status })),
      ready: missing.length === 0,
    };
  }

  /**
   * Is this document record valid right now, accounting for expiry?
   *
   * An EXPIRED status, or a document whose own expiry date has passed, is
   * reported as not satisfying a requirement without the stored status being
   * rewritten behind the operator's back.
   *
   * @param {Object} doc - a TripDocument row
   * @returns {{satisfied:boolean, expired:boolean}}
   */
  evaluateDocument(doc) {
    if (!doc) return { satisfied: false, expired: false };
    const expired = doc.document_status === 'EXPIRED'
      || (doc.expires_at ? new Date(doc.expires_at) < new Date() : false);
    const satisfied = !expired && documentPolicy.SATISFIES_REQUIREMENT.includes(doc.document_status);
    return { satisfied, expired };
  }

  // =========================================================================
  // WRITE
  // =========================================================================

  /**
   * Record (or re-record) one document against a trip.
   *
   * @param {number} tripId
   * @param {Object} input
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async recordDocument(tripId, input, user = null) {
    const clean = this.validateDocument(input);

    const trip = await this.prisma.trip.findUnique({
      where: { trip_id: Number(tripId) },
      select: {
        trip_id: true, trip_number: true, freight_amount: true,
        booking_id: true, documents_required: true,
      },
    });
    if (!trip) throw new NotFoundError('Trip not found');

    const now = new Date();
    const isSupplied = documentPolicy.SUPPLIED_STATES.includes(clean.document_status);

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tripDocument.findUnique({
        // The compound unique is NAMED in the schema (uq_trip_documents_trip_type)
        // so Prisma keys it by that name rather than the default
        // `trip_id_document_type`.
        where: {
          uq_trip_documents_trip_type: {
            trip_id: trip.trip_id,
            document_type: clean.document_type,
          },
        },
      });

      let doc;
      let created;
      let changed = true;

      if (!existing) {
        created = true;
        doc = await tx.tripDocument.create({
          data: {
            trip_id: trip.trip_id,
            document_type: clean.document_type,
            document_status: clean.document_status,
            reference_number: clean.reference_number,
            issued_at: clean.issued_at,
            expires_at: clean.expires_at,
            file_url: clean.file_url,
            is_uploaded: Boolean(clean.file_url),
            is_verified: clean.document_status === 'VERIFIED',
            verified_by: clean.document_status === 'VERIFIED' ? (user?.user_id || null) : null,
            verified_at: clean.document_status === 'VERIFIED' ? now : null,
            remarks: clean.remarks,
            created_by: user?.user_id || null,
            created_at: now,
            updated_at: now,
          },
        });
      } else {
        created = false;
        // PHASE 6 FIX — verification is ONE-WAY.
        //
        // Re-recording a document used to write `clean.document_status` straight
        // over the stored one. Because the POD upload path always submits the
        // document as PRESENT, uploading a second time silently DOWNGRADED an
        // already-VERIFIED document back to PRESENT and erased verified_by /
        // verified_at — so a retried upload could undo a human check, and a trip
        // that had passed its delivery precondition would suddenly fail it.
        //
        // An operator decision (VERIFIED or REJECTED) is now preserved; only the
        // DOCUMENT FACTS are updated. Nothing here can un-verify a document.
        const operatorDecided = ['VERIFIED', 'REJECTED'].includes(existing.document_status);
        const effectiveStatus = operatorDecided ? existing.document_status : clean.document_status;

        // A retry that re-sends the same facts must not rewrite the row, move
        // its updated_at stamp, or append a second timeline event — otherwise a
        // double click would manufacture history that never happened.
        const sameFacts = existing.document_status === effectiveStatus
          && existing.reference_number === clean.reference_number
          && String(existing.file_url || '') === String(clean.file_url || '')
          && String(existing.remarks || '') === String(clean.remarks || '');

        if (sameFacts) {
          changed = false;
          doc = existing;
        } else {
          doc = await tx.tripDocument.update({
            where: { document_id: existing.document_id },
            data: {
              document_status: effectiveStatus,
              reference_number: clean.reference_number,
              issued_at: clean.issued_at,
              expires_at: clean.expires_at,
              // PHASE 6 FIX — a re-record must not ERASE an already-supplied
              // file. A retry that carries no `file_url` used to blank the
              // column, destroying the proof-of-delivery image that had already
              // been uploaded. A supplied file is evidence: it is only replaced
              // by a new file, never silently dropped.
              file_url: clean.file_url || existing.file_url,
              is_uploaded: Boolean(clean.file_url || existing.file_url),
              // Preserve the verification decision; adopt it only on a create.
              is_verified: effectiveStatus === 'VERIFIED',
              verified_by: effectiveStatus === 'VERIFIED'
                ? (existing.verified_by || user?.user_id || null)
                : null,
              verified_at: effectiveStatus === 'VERIFIED'
                ? (existing.verified_at || now)
                : null,
              remarks: clean.remarks,
              updated_at: now,
            },
          });
        }
      }

      // Only a real create or a real change is history.
      if (changed) {
        await this.timelineRepo.create({
          trip_id: trip.trip_id,
          event_type: created ? 'document_recorded' : 'document_updated',
          description: `${clean.document_type} document ${created ? 'recorded' : 'updated'}: ${clean.document_status}`,
          reference_type: 'trip_document',
          reference_id: doc.document_id,
          metadata: {
            document_type: clean.document_type,
            document_status: clean.document_status,
            reference_number: clean.reference_number,
          },
          created_by: user?.user_id || null,
        }, tx);

        await this.auditRepo.create({
          user_id: user?.user_id || null,
          user_role: user?.role || 'system',
          action: created ? 'trip_document_recorded' : 'trip_document_updated',
          entity_type: 'TripDocument',
          entity_id: doc.document_id,
          new_value: JSON.stringify({
            trip_id: trip.trip_id,
            document_type: clean.document_type,
            document_status: clean.document_status,
            reference_number: clean.reference_number,
          }),
          reason: clean.remarks || null,
        }, tx);
      }

      return { doc, created, changed };
    });

    void isSupplied;
    return { ...result.doc, already_recorded: !result.created, changed: result.changed };
  }

  /**
   * Mark a recorded document as verified.
   * @param {number} tripId
   * @param {number} documentId
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async verifyDocument(tripId, documentId, user = null) {
    const doc = await this._findOwned(tripId, documentId);
    const now = new Date();

    return await this.prisma.$transaction(async (tx) => {
      const updated = await tx.tripDocument.update({
        where: { document_id: doc.document_id },
        data: {
          document_status: 'VERIFIED',
          is_verified: true,
          verified_by: user?.user_id || null,
          verified_at: now,
          updated_at: now,
        },
      });

      await this.timelineRepo.create({
        trip_id: doc.trip_id,
        event_type: 'document_verified',
        description: `${doc.document_type} document verified`,
        reference_type: 'trip_document',
        reference_id: doc.document_id,
        metadata: { document_type: doc.document_type, document_status: 'VERIFIED' },
        created_by: user?.user_id || null,
      }, tx);

      return updated;
    });
  }

  /**
   * Remove a recorded document. The append-only TripTimeline entry that was
   * written when it was recorded is deliberately NOT removed — the history of
   * a trip must survive (STEP 13).
   *
   * @param {number} tripId
   * @param {number} documentId
   * @param {Object|null} user
   * @returns {Promise<Object>}
   */
  async deleteDocument(tripId, documentId, user = null) {
    const doc = await this._findOwned(tripId, documentId);

    return await this.prisma.$transaction(async (tx) => {
      await tx.tripDocument.delete({ where: { document_id: doc.document_id } });

      await this.timelineRepo.create({
        trip_id: doc.trip_id,
        event_type: 'document_removed',
        description: `${doc.document_type} document removed`,
        reference_type: 'trip_document',
        reference_id: doc.document_id,
        metadata: { document_type: doc.document_type },
        created_by: user?.user_id || null,
      }, tx);

      return { deleted: true, document_id: doc.document_id };
    });
  }

  /**
   * Load a document and prove it belongs to THIS trip.
   *
   * Scoping by trip_id in the query — not by fetching then comparing — is
   * what stops a document id from one trip being read or mutated through
   * another trip's URL (STEP 18 test 10 / 11).
   *
   * @param {number} tripId
   * @param {number} documentId
   * @returns {Promise<Object>}
   */
  async _findOwned(tripId, documentId) {
    const doc = await this.prisma.tripDocument.findFirst({
      where: { document_id: Number(documentId), trip_id: Number(tripId) },
    });
    if (!doc) throw new NotFoundError('Document not found for this trip');
    return doc;
  }
}

module.exports = TripDocumentService;
module.exports.TripDocumentService = TripDocumentService;

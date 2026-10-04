/**
 * TripDocumentStorage.js
 * ============================================================================
 * PERSISTENT FILES for a consignment's paperwork (§21).
 *
 * THE EXISTING ARCHITECTURE THIS EXTENDS
 *   Before Phase 9 the repository stored a document as a `trip_documents` row
 *   whose `file_url` column held a reference — there was no code anywhere that
 *   put a BYTE on a disk. That is enough metadata to render a checklist and not
 *   enough to keep an LR that a lorry driver handed over at a loading gate at
 *   midnight.
 *
 *   This service adds the missing half WITHOUT introducing a second document
 *   model or a second file store: it writes the bytes to disk and returns a
 *   `/uploads/...` reference that is written into the SAME `file_url` column
 *   the repository already uses. Nothing else changes shape.
 *
 * WHY BASE64 AND NOT multer
 *   `multer` is not a dependency of this project and adding one is not
 *   necessary. The API contract is JSON, the payload is small (a scanned LR is
 *   a few hundred KB), and accepting base64 keeps the whole document lifecycle
 *   — record, view, download, delete — inside the existing admin-gated JSON
 *   routes rather than introducing a parallel multipart surface that would need
 *   its own auth story.
 *
 * THE FILES ARE NOT PUBLIC
 *   `store()` writes to disk; `resolve()` refuses anything that would escape
 *   the upload root. The bytes are only reachable through
 *   `GET /api/trips/:id/documents/:documentId/file`, which sits behind the same
 *   `protect` + `adminOnly` pair as the rest of the trip module. A consignment
 *   document is not a public asset.
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { ValidationError, NotFoundError } = require('../utils/AppError');

/** Where the bytes live, relative to the backend root. */
const UPLOAD_ROOT = path.join(__dirname, '..', 'uploads');

/** The public reference prefix, matching the `/uploads/...` convention in use. */
const URL_PREFIX = '/uploads';

/**
 * Extensions accepted for a transport document. An allow-list, not a block-list:
 * an uploaded file is served back to a browser, so the only safe policy is to
 * name what is permitted.
 */
const ALLOWED_EXTENSIONS = Object.freeze([
  '.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic',
  '.txt', '.csv',
]);

/** Refuse anything larger than this. A scanned LR is a few hundred KB. */
const MAX_BYTES = 8 * 1024 * 1024;

/** Strip every path separator and traversal token from a client filename. */
function safeFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned || 'document';
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

/** Map a stored extension to a content type we are willing to serve. */
function contentTypeFor(fileName) {
  const ext = extensionOf(fileName);
  const TYPES = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.heic': 'image/heic',
    '.txt': 'text/plain; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
  };
  return TYPES[ext] || 'application/octet-stream';
}

class TripDocumentStorage {
  /**
   * Persist a document's bytes and return the reference to store in `file_url`.
   *
   * @param {Object} args
   * @param {number} args.tripId
   * @param {string} args.documentType  a TripDocumentType, used as the folder
   * @param {string} args.fileName      the client's original filename
   * @param {string} args.contentBase64 the bytes, base64-encoded
   * @returns {Promise<{file_url:string, file_name:string, bytes:number,
   *                    content_type:string, stored_path:string}>}
   */
  async store({ tripId, documentType, fileName, contentBase64 }) {
    const id = Number(tripId);
    if (!Number.isInteger(id) || id <= 0) throw new ValidationError('A document must belong to a valid trip');

    if (typeof contentBase64 !== 'string' || contentBase64.trim() === '') {
      throw new ValidationError('No file content was supplied for this document');
    }

    const cleanName = safeFileName(fileName);
    const ext = extensionOf(cleanName);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new ValidationError(
        `Unsupported document type "${ext || 'unknown'}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
      );
    }

    let buffer;
    try {
      // Tolerate a data URL prefix; browsers send one by habit.
      buffer = Buffer.from(String(contentBase64).replace(/^data:[^;]+;base64,/, ''), 'base64');
    } catch {
      throw new ValidationError('The file content could not be decoded as base64');
    }
    if (buffer.length === 0) throw new ValidationError('The uploaded file is empty');
    if (buffer.length > MAX_BYTES) {
      throw new ValidationError(
        `The uploaded file is ${(buffer.length / 1048576).toFixed(1)} MB. The limit is ${MAX_BYTES / 1048576} MB.`,
      );
    }

    const folder = path.join(
      String(id),
      String(documentType || 'OTHER').toUpperCase().replace(/[^A-Z_]/g, ''),
    );
    const dir = path.join(UPLOAD_ROOT, folder);
    await fs.mkdir(dir, { recursive: true });

    // The timestamp keeps a re-upload from silently overwriting the previous
    // scan; the trip folder keeps one consignment's papers together.
    const storedName = `${Date.now()}-${cleanName}`;
    const absolute = path.join(dir, storedName);

    await fs.writeFile(absolute, buffer);

    return {
      file_url: `${URL_PREFIX}/${folder}/${storedName}`,
      file_name: cleanName,
      bytes: buffer.length,
      content_type: contentTypeFor(cleanName),
      stored_path: absolute,
    };
  }

  /**
   * Resolve a stored `file_url` to an absolute path, refusing anything outside
   * the upload root.
   *
   * @param {string} fileUrl
   * @returns {string} an absolute path
   */
  resolve(fileUrl) {
    let relative = String(fileUrl || '').replace(/^\/+/, '');
    if (!relative) throw new NotFoundError({ message: 'This document has no file attached' });

    // `file_url` is stored with the `/uploads` prefix (that is the convention
    // the repository already used), but UPLOAD_ROOT already IS the uploads
    // directory. Stripping the prefix here is what stops the resolved path from
    // becoming `<root>/uploads/...` — and, more importantly, it is what makes
    // the traversal check below meaningful: `/uploads/../etc/passwd` collapses
    // to `<root>/../etc/passwd`, which is genuinely outside the root and is
    // refused, rather than to `<root>/etc/passwd`, which would look safe.
    relative = relative.replace(/^uploads\//, '');

    const absolute = path.resolve(UPLOAD_ROOT, relative);
    const root = path.resolve(UPLOAD_ROOT);
    // `path.resolve` collapses `../` before this runs, so a URL that escapes
    // the root produces an absolute path outside it.
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new NotFoundError({ message: 'This document file could not be located' });
    }
    return absolute;
  }

  /**
   * Read a stored document back.
   *
   * @param {string} fileUrl
   * @returns {Promise<{buffer:Buffer, content_type:string, file_name:string}>}
   */
  async read(fileUrl) {
    const absolute = this.resolve(fileUrl);
    try {
      const buffer = await fs.readFile(absolute);
      return {
        buffer,
        content_type: contentTypeFor(absolute),
        file_name: path.basename(absolute),
      };
    } catch {
      throw new NotFoundError({ message: 'This document file could not be located' });
    }
  }

  /**
   * Remove a stored file. The `trip_documents` row and its timeline entry are
   * removed by `TripDocumentService`; this only discards the bytes, and it
   * treats an already-absent file as success so a retried delete is safe.
   *
   * @param {string} fileUrl
   * @returns {Promise<boolean>}
   */
  async remove(fileUrl) {
    try {
      const absolute = this.resolve(fileUrl);
      await fs.unlink(absolute);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = TripDocumentStorage;
module.exports.TripDocumentStorage = TripDocumentStorage;
module.exports.ALLOWED_EXTENSIONS = ALLOWED_EXTENSIONS;
module.exports.MAX_BYTES = MAX_BYTES;
module.exports.UPLOAD_ROOT = UPLOAD_ROOT;

/**
 * EnquiryAccessToken
 * ---------------------------------------------------------------------------
 * Replaces the "Submit Booking → forced login" wall.
 *
 * THE PROBLEM
 * Requiring a JWT login immediately after "Submit Booking" loses the request:
 * the customer has already filled a 12-field form, and a login redirect throws
 * that state away. The enquiry must be created FIRST, and access to it proven
 * afterwards.
 *
 * THE SOLUTION
 * On successful enquiry creation the server issues a short-lived, signed
 * "enquiry access token" scoped to exactly one enquiry. The customer lands
 * directly on the confirmation page already authorised for that enquiry. No
 * account, no password, no redirect.
 *
 * The token is a normal JWT (same JWT_SECRET, so no new secret to rotate):
 *
 *   { type: 'enquiry_access', enquiryId, enquiryNumber, jti, exp }
 *
 * SECURITY NOTES
 *   - `jti` (JWT id) is persisted as the token's own audience so a token can be
 *     revoked server-side (see EnquiryService.revokeGuestAccess) and so replay
 *     is detectable.
 *   - The token carries NO customer mobile and NO customer PII — only opaque
 *     ids. Reading the token reveals nothing about the customer.
 *   - A guest token authorises READ + the four customer actions (accept, reject,
 *     cancel). It never authorises admin or driver endpoints; those still
 *     require their own role middleware.
 *   - Short TTL (default 30 days) bounds the exposure of a token pasted into a
 *     chat or a shared browser profile.
 *
 * A logged-in customer never needs one: their normal user JWT is checked first
 * and takes precedence, and the enquiry is additionally bound to customer_id.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const TOKEN_TYPE = 'enquiry_access';
const DEFAULT_TTL_DAYS = 30;

/** @returns {number} TTL in seconds */
function getTtlSeconds() {
  const raw = Number(process.env.ENQUIRY_ACCESS_TOKEN_TTL_DAYS || DEFAULT_TTL_DAYS);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 365) : DEFAULT_TTL_DAYS;
  return Math.floor(days * 24 * 60 * 60);
}

/** @returns {string} a fresh random token id */
function newTokenId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Mint an enquiry access token.
 *
 * @param {{enquiryId:number, enquiryNumber:string, ttlSeconds?:number}} params
 * @returns {{token:string, jti:string, expiresAt:Date, expiresIn:number}}
 */
function issueEnquiryAccessToken({ enquiryId, enquiryNumber, ttlSeconds } = {}) {
  if (!enquiryId || !Number.isFinite(Number(enquiryId))) {
    throw new Error('enquiryId is required to issue an enquiry access token');
  }
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  const jti = newTokenId();
  const expiresIn = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : getTtlSeconds();
  const nowSeconds = Math.floor(Date.now() / 1000);

  const token = jwt.sign(
    {
      type: TOKEN_TYPE,
      enquiryId: Number(enquiryId),
      enquiryNumber: enquiryNumber || null,
      jti,
    },
    process.env.JWT_SECRET,
    { expiresIn }
  );

  return {
    token,
    jti,
    expiresAt: new Date((nowSeconds + expiresIn) * 1000),
    expiresIn,
  };
}

/**
 * Verify an enquiry access token.
 *
 * @param {string} token
 * @returns {{valid:boolean, payload?:object, reason?:string}}
 */
function verifyEnquiryAccessToken(token) {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'missing' };
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== TOKEN_TYPE) {
      return { valid: false, reason: 'wrong_type' };
    }
    if (!payload.enquiryId) {
      return { valid: false, reason: 'no_subject' };
    }
    return { valid: true, payload };
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return { valid: false, reason: 'expired' };
    }
    return { valid: false, reason: 'invalid' };
  }
}

/**
 * Extract a bearer token from an Express request, accepting it either in the
 * standard Authorization header or in an X-Enquiry-Token header (the frontend
 * uses the latter for guest requests so it does not have to overwrite the
 * customer's real user JWT).
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractEnquiryToken(req) {
  const custom = req.headers['x-enquiry-token'];
  if (typeof custom === 'string' && custom.trim()) return custom.trim();

  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }

  // Also accept a query token for the initial page-load handshake only.
  if (req.query && typeof req.query.enquiry_token === 'string' && req.query.enquiry_token.trim()) {
    return req.query.enquiry_token.trim();
  }

  return null;
}

module.exports = {
  TOKEN_TYPE,
  DEFAULT_TTL_DAYS,
  getTtlSeconds,
  newTokenId,
  issueEnquiryAccessToken,
  verifyEnquiryAccessToken,
  extractEnquiryToken,
};

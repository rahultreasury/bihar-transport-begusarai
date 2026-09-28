/**
 * optionalAuth.js
 * ---------------------------------------------------------------------------
 * Attaches `req.user` when a VALID JWT is present, but never rejects the
 * request when it is absent or invalid.
 *
 * WHY THIS EXISTS
 * `protect` is correct for endpoints that MUST be authenticated. But
 * POST /api/enquiries must work for a customer who has never logged in — that
 * is the whole point of removing the login wall. This middleware lets the
 * route read "am I a known customer?" and, if so, attach the enquiry to
 * customer_id, while still accepting a guest submission.
 *
 * It also exposes `req.enquiryToken` (a scoped enquiry-access token), so the
 * controller can prove ownership of an enquiry without a full login.
 *
 * A malformed/expired token is treated as "anonymous", not as an error: the
 * route's own authorisation (EnquiryService.assertCustomerAccess) decides what
 * the caller may actually do.
 */

const jwt = require('jsonwebtoken');
const { prisma } = require('../config/prisma');
const { extractEnquiryToken } = require('../utils/EnquiryAccessToken');

const ADMIN_ROLES = ['admin', 'super_admin', 'operator'];

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
async function optionalAuth(req, res, next) {
  // The scoped guest token is always surfaced, even without a user JWT.
  req.enquiryToken = extractEnquiryToken(req) || null;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type === 'admin') {
      const admin = await prisma.admin.findUnique({
        where: { admin_id: decoded.id },
        select: { admin_id: true, full_name: true, email: true, role: true, is_active: true },
      });
      if (admin && admin.is_active !== false) {
        req.user = {
          user_id: admin.admin_id,
          first_name: admin.full_name,
          email: admin.email,
          role: admin.role,
        };
      }
      return next();
    }

    // An enquiry_access token is not a user session — leave req.user unset.
    if (decoded.type === 'enquiry_access') {
      return next();
    }

    if (decoded.id) {
      const user = await prisma.user.findUnique({
        where: { user_id: decoded.id },
        select: {
          user_id: true,
          first_name: true,
          last_name: true,
          email: true,
          phone: true,
          role: true,
          is_active: true,
        },
      });
      if (user && user.is_active !== false) {
        req.user = user;
      }
    }
  } catch {
    // Invalid or expired token → anonymous. Never 401 here.
  }

  return next();
}

/**
 * Gate that allows admins, drivers, partners and customers through but rejects
 * anyone else. Used by endpoints where more than one authenticated role is
 * valid (e.g. reading an enquiry the caller is party to).
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function anyAuthenticated(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided',
    });
  }
  return next();
}

module.exports = { optionalAuth, anyAuthenticated, ADMIN_ROLES };

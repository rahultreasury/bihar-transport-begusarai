/**
 * otpRepository.js
 * Data access layer for OTP verification records.
 * Uses Prisma client for database operations.
 */

const { prisma } = require('../config/prisma');
const crypto = require('crypto');

/**
 * Normalize phone number to 10-digit Indian format
 * Strips country code (+91, 91), spaces, dashes, parentheses
 * @param {string} phone - Raw phone number
 * @returns {string} - Normalized 10-digit phone
 */
function normalizePhone(phone) {
  if (!phone) return '';
  // Remove all non-digits
  const digits = String(phone).replace(/\D/g, '');
  // Remove leading 91 or +91
  if (digits.startsWith('91') && digits.length === 12) {
    return digits.slice(2);
  }
  if (digits.startsWith('0') && digits.length === 11) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Hash OTP using SHA-256 (same pattern as password reset tokens)
 * @param {string} otp - Plaintext OTP
 * @returns {string} - Hex encoded SHA-256 hash
 */
function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

/**
 * Generate cryptographically secure 6-digit OTP
 * @returns {string} - 6-digit OTP string
 */
function generateOtp() {
  // crypto.randomInt is available in Node.js 14.17.0+
  // Generates uniform random integer in [min, max)
  const otp = crypto.randomInt(100000, 1000000);
  return String(otp);
}

/**
 * Create a new OTP verification record
 * @param {Object} params
 * @param {string} params.phone - Normalized 10-digit phone
 * @param {string} params.otpHash - SHA-256 hash of OTP
 * @param {Date} params.expiresAt - Expiration timestamp
 * @param {number} [params.userId] - Optional user ID if phone is linked to user
 * @param {number} [params.maxAttempts=3] - Maximum verification attempts
 * @returns {Promise<Object>} Created OTP record
 */
async function createOtp({ phone, otpHash, expiresAt, userId, maxAttempts = 3 }) {
  return prisma.otpVerification.create({
    data: {
      phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
      user_id: userId || null,
      max_attempts: maxAttempts,
      attempts: 0,
      consumed: false,
    },
  });
}

/**
 * Find the most recent active (unconsumed, unexpired) OTP for a phone
 * @param {string} phone - Normalized 10-digit phone
 * @returns {Promise<Object|null>} OTP record or null
 */
async function findActiveOtpByPhone(phone) {
  return prisma.otpVerification.findFirst({
    where: {
      phone,
      consumed: false,
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * Find OTP by ID
 * @param {number} id - OTP record ID
 * @returns {Promise<Object|null>} OTP record or null
 */
async function findOtpById(id) {
  return prisma.otpVerification.findUnique({
    where: { id },
  });
}

/**
 * Increment attempt counter on OTP record
 * @param {number} id - OTP record ID
 * @returns {Promise<Object>} Updated OTP record
 */
async function incrementAttempts(id) {
  return prisma.otpVerification.update({
    where: { id },
    data: {
      attempts: { increment: 1 },
      updated_at: new Date(),
    },
  });
}

/**
 * Mark OTP as consumed (verified successfully)
 * @param {number} id - OTP record ID
 * @returns {Promise<Object>} Updated OTP record
 */
async function markOtpConsumed(id) {
  return prisma.otpVerification.update({
    where: { id },
    data: {
      consumed: true,
      verified_at: new Date(),
      updated_at: new Date(),
    },
  });
}

/**
 * Mark OTP as failed (max attempts exceeded)
 * @param {number} id - OTP record ID
 * @returns {Promise<Object>} Updated OTP record
 */
async function markOtpFailed(id) {
  return prisma.otpVerification.update({
    where: { id },
    data: {
      consumed: true, // Prevent further attempts
      updated_at: new Date(),
    },
  });
}

/**
 * Delete expired OTP records (cleanup)
 * @param {Date} [before] - Delete records expired before this date (default: now)
 * @returns {Promise<number>} Number of deleted records
 */
async function deleteExpiredOtps(before = new Date()) {
  const result = await prisma.otpVerification.deleteMany({
    where: {
      expires_at: { lt: before },
    },
  });
  return result.count;
}

/**
 * Delete all OTP records for a phone (e.g., on new OTP request)
 * @param {string} phone - Normalized 10-digit phone
 * @returns {Promise<number>} Number of deleted records
 */
async function deleteOtpsByPhone(phone) {
  const result = await prisma.otpVerification.deleteMany({
    where: { phone },
  });
  return result.count;
}

/**
 * Check if there's a recent OTP request for rate limiting
 * @param {string} phone - Normalized 10-digit phone
 * @param {number} windowMs - Time window in milliseconds (default: 60 seconds)
 * @returns {Promise<boolean>} True if recent OTP exists
 */
async function hasRecentOtpRequest(phone, windowMs = 60000) {
  const since = new Date(Date.now() - windowMs);
  const count = await prisma.otpVerification.count({
    where: {
      phone,
      created_at: { gte: since },
    },
  });
  return count > 0;
}

/**
 * Get OTP statistics for a phone (for monitoring/debugging)
 * @param {string} phone - Normalized 10-digit phone
 * @returns {Promise<Object>} Stats object
 */
async function getOtpStats(phone) {
  const [total, active, consumed, expired] = await Promise.all([
    prisma.otpVerification.count({ where: { phone } }),
    prisma.otpVerification.count({
      where: { phone, consumed: false, expires_at: { gt: new Date() } },
    }),
    prisma.otpVerification.count({ where: { phone, consumed: true, verified_at: { not: null } } }),
    prisma.otpVerification.count({ where: { phone, expires_at: { lt: new Date() } } }),
  ]);

  return { total, active, consumed, expired };
}

module.exports = {
  normalizePhone,
  hashOtp,
  generateOtp,
  createOtp,
  findActiveOtpByPhone,
  findOtpById,
  incrementAttempts,
  markOtpConsumed,
  markOtpFailed,
  deleteExpiredOtps,
  deleteOtpsByPhone,
  hasRecentOtpRequest,
  getOtpStats,
};
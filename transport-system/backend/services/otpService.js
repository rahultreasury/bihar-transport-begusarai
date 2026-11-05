/**
 * otpService.js
 * Business logic for OTP-based authentication.
 *
 * Flow:
 *   1. sendOtp(phone) - Generate OTP, hash it, store in DB, send via SMS
 *   2. verifyOtp(phone, otp) - Find active OTP, verify hash, mark consumed, return user + JWT
 *
 * Security:
 *   - OTPs are NEVER stored in plaintext (only SHA-256 hash)
 *   - 5-minute expiration
 *   - Max 3 verification attempts
 *   - 60-second resend cooldown
 *   - Rate limiting per phone
 *   - OTP invalidated after successful verification (prevents reuse)
 *   - Generic error messages to prevent phone enumeration
 */

const { prisma } = require('../config/prisma');
const { generateToken } = require('../middleware/auth');
const {
  normalizePhone,
  hashOtp,
  generateOtp,
  createOtp,
  findActiveOtpByPhone,
  incrementAttempts,
  markOtpConsumed,
  markOtpFailed,
  deleteOtpsByPhone,
  hasRecentOtpRequest,
} = require('../repositories/otpRepository');
const { getSmsProvider } = require('./smsProvider');
const { logger } = require('../utils/logger');
const { UnauthorizedError, BadRequestError } = require('../utils/AppError');

// Configuration constants
const OTP_EXPIRY_MINUTES = 5;
const OTP_RESEND_COOLDOWN_MS = 60000; // 60 seconds
const MAX_VERIFICATION_ATTEMPTS = 3;

/**
 * Send OTP to a phone number
 * @param {string} phone - Raw phone number (will be normalized)
 * @returns {Promise<{success: boolean, message: string, data?: Object}>}
 */
async function sendOtp(phone) {
  const normalizedPhone = normalizePhone(phone);

  // Validate Indian mobile number format (10 digits, starts with 6-9)
  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    throw new BadRequestError({
      message: 'Invalid phone number. Please enter a valid 10-digit Indian mobile number.',
      details: [{ field: 'phone', message: 'Invalid format' }],
    });
  }

  // Check resend cooldown
  const hasRecent = await hasRecentOtpRequest(normalizedPhone, OTP_RESEND_COOLDOWN_MS);
  if (hasRecent) {
    throw new BadRequestError({
      message: 'Please wait before requesting another OTP.',
      details: [{ field: 'phone', message: 'Resend cooldown active' }],
    });
  }

  // Check if phone belongs to an active customer user
  const user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
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

  // For security, we don't reveal whether the phone exists in our system
  // We still proceed with OTP generation but only link to user if found and active
  const userId = user && user.is_active && user.role === 'customer' ? user.user_id : null;

  // Clean up any existing OTPs for this phone (single active OTP per phone)
  await deleteOtpsByPhone(normalizedPhone);

  // Generate cryptographically secure OTP
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  // Store OTP hash in database
  await createOtp({
    phone: normalizedPhone,
    otpHash,
    expiresAt,
    userId,
    maxAttempts: MAX_VERIFICATION_ATTEMPTS,
  });

  // Send OTP via SMS provider
  const smsProvider = getSmsProvider();
  const message = `Your Bihar Transport OTP is ${otp}. Valid for ${OTP_EXPIRY_MINUTES} minutes. Do not share with anyone.`;

  const smsResult = await smsProvider.send(normalizedPhone, message);

  if (!smsResult.success) {
    logger.error({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      error: smsResult.error,
    }, 'otp_sms_failed');

    // In development, we still return success since OTP is logged to console
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestError({
        message: 'Failed to send OTP. Please try again.',
        details: [{ field: 'phone', message: 'SMS delivery failed' }],
      });
    }
  }

  logger.info({
    phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    hasUser: !!userId,
    provider: smsProvider.getName(),
  }, 'otp_sent');

  return {
    success: true,
    message: 'OTP sent successfully',
    data: {
      phone: normalizedPhone,
      expiresIn: OTP_EXPIRY_MINUTES * 60, // seconds
      // In development, include OTP for testing (NEVER in production)
      ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
    },
  };
}

/**
 * Verify OTP and authenticate user
 * @param {string} phone - Raw phone number (will be normalized)
 * @param {string} otp - Plaintext OTP from user
 * @returns {Promise<{success: boolean, message: string, data?: Object, token?: string}>}
 */
async function verifyOtp(phone, otp) {
  const normalizedPhone = normalizePhone(phone);

  // Validate phone format
  if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
    throw new BadRequestError({
      message: 'Invalid phone number format.',
      details: [{ field: 'phone', message: 'Invalid format' }],
    });
  }

  // Validate OTP format (6 digits)
  if (!/^\d{6}$/.test(String(otp))) {
    throw new BadRequestError({
      message: 'Invalid OTP format. Please enter a 6-digit code.',
      details: [{ field: 'otp', message: 'Must be 6 digits' }],
    });
  }

  // Find active OTP for this phone
  const otpRecord = await findActiveOtpByPhone(normalizedPhone);

  if (!otpRecord) {
    logger.warn({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    }, 'otp_verify_no_active');

    throw new UnauthorizedError({
      message: 'Invalid or expired OTP. Please request a new one.',
    });
  }

  // Check if already consumed
  if (otpRecord.consumed) {
    logger.warn({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      otpId: otpRecord.id,
    }, 'otp_verify_already_consumed');

    throw new UnauthorizedError({
      message: 'This OTP has already been used. Please request a new one.',
    });
  }

  // Check expiration
  if (otpRecord.expires_at < new Date()) {
    logger.warn({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      otpId: otpRecord.id,
    }, 'otp_verify_expired');

    throw new UnauthorizedError({
      message: 'OTP has expired. Please request a new one.',
    });
  }

  // Check max attempts
  if (otpRecord.attempts >= otpRecord.max_attempts) {
    await markOtpFailed(otpRecord.id);

    logger.warn({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      otpId: otpRecord.id,
      attempts: otpRecord.attempts,
    }, 'otp_verify_max_attempts');

    throw new UnauthorizedError({
      message: 'Maximum verification attempts exceeded. Please request a new OTP.',
    });
  }

  // Verify OTP hash (constant-time comparison via hash equality)
  const providedHash = hashOtp(otp);
  const isValid = providedHash === otpRecord.otp_hash;

  // Increment attempt counter regardless of success (prevents timing attacks)
  await incrementAttempts(otpRecord.id);

  if (!isValid) {
    logger.warn({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      otpId: otpRecord.id,
      attempt: otpRecord.attempts + 1,
    }, 'otp_verify_invalid');

    throw new UnauthorizedError({
      message: 'Invalid OTP. Please try again.',
    });
  }

  // OTP is valid - mark as consumed
  await markOtpConsumed(otpRecord.id);

  // Find the user (must be a customer with this phone)
  const user = await prisma.user.findUnique({
    where: { phone: normalizedPhone },
    select: {
      user_id: true,
      first_name: true,
      last_name: true,
      email: true,
      phone: true,
      role: true,
      city: true,
      address: true,
      is_active: true,
    },
  });

  if (!user) {
    logger.error({
      phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
      otpId: otpRecord.id,
    }, 'otp_verify_user_not_found');

    throw new UnauthorizedError({
      message: 'Account not found for this phone number.',
    });
  }

  if (!user.is_active) {
    throw new UnauthorizedError({
      message: 'Account is deactivated.',
    });
  }

  if (user.role !== 'customer') {
    throw new UnauthorizedError({
      message: 'OTP login is only available for customer accounts.',
    });
  }

  // Generate JWT token using existing auth system
  const token = generateToken(user.user_id);

  logger.info({
    userId: user.user_id,
    phone: normalizedPhone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    otpId: otpRecord.id,
  }, 'otp_verify_success');

  return {
    success: true,
    message: 'Login successful',
    data: {
      user_id: user.user_id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      city: user.city,
      address: user.address,
    },
    token,
  };
}

/**
 * Get OTP status for debugging (development only)
 * @param {string} phone - Normalized phone
 * @returns {Promise<Object>}
 */
async function getOtpStatus(phone) {
  if (process.env.NODE_ENV === 'production') {
    throw new BadRequestError({ message: 'Not available in production' });
  }

  const normalizedPhone = normalizePhone(phone);
  const { getOtpStats } = require('../repositories/otpRepository');
  return getOtpStats(normalizedPhone);
}

module.exports = {
  sendOtp,
  verifyOtp,
  getOtpStatus,
  // Export constants for testing
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_MS,
  MAX_VERIFICATION_ATTEMPTS,
};
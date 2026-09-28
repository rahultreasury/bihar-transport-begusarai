/**
 * otpController.js
 * HTTP controllers for OTP authentication endpoints.
 *
 * Endpoints:
 *   POST /api/auth/send-otp - Send OTP to phone
 *   POST /api/auth/verify-otp - Verify OTP and login
 */

const asyncHandler = require('../middleware/asyncHandler');
const { sendOtp, verifyOtp, getOtpStatus } = require('../services/otpService');
const { logger } = require('../utils/logger');

/**
 * POST /api/auth/send-otp
 * Send OTP to customer's phone number
 *
 * Request body:
 *   { "phone": "9709907415" }
 *
 * Response (success):
 *   {
 *     "success": true,
 *     "message": "OTP sent successfully",
 *     "data": {
 *       "phone": "9709907415",
 *       "expiresIn": 300
 *     }
 *   }
 *
 * Response (error):
 *   {
 *     "success": false,
 *     "message": "Please wait before requesting another OTP.",
 *     "errorCode": "BAD_REQUEST",
 *     "details": [...],
 *     "timestamp": "...",
 *     "requestId": "..."
 *   }
 */
const sendOtpController = asyncHandler(async (req, res) => {
  const { phone } = req.body;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required',
      errorCode: 'VALIDATION_ERROR',
      details: [{ field: 'phone', message: 'Phone number is required' }],
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }

  const result = await sendOtp(phone);

  // Log for audit (phone masked in production)
  logger.info({
    requestId: req.id,
    phone: String(phone).replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    result: result.success ? 'sent' : 'failed',
  }, 'auth_send_otp');

  res.json({
    success: result.success,
    message: result.message,
    data: result.data,
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

/**
 * POST /api/auth/verify-otp
 * Verify OTP and authenticate customer
 *
 * Request body:
 *   { "phone": "9709907415", "otp": "123456" }
 *
 * Response (success):
 *   {
 *     "success": true,
 *     "message": "Login successful",
 *     "data": {
 *       "user_id": 1,
 *       "first_name": "John",
 *       "last_name": "Doe",
 *       "email": "john@example.com",
 *       "phone": "9709907415",
 *       "role": "customer",
 *       "city": "Begusarai",
 *       "address": "..."
 *     },
 *     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *   }
 *
 * Response (error):
 *   {
 *     "success": false,
 *     "message": "Invalid or expired OTP. Please request a new one.",
 *     "errorCode": "UNAUTHORIZED",
 *     "timestamp": "...",
 *     "requestId": "..."
 *   }
 */
const verifyOtpController = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    return res.status(400).json({
      success: false,
      message: 'Phone number and OTP are required',
      errorCode: 'VALIDATION_ERROR',
      details: [
        ...(!phone ? [{ field: 'phone', message: 'Phone number is required' }] : []),
        ...(!otp ? [{ field: 'otp', message: 'OTP is required' }] : []),
      ],
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }

  const result = await verifyOtp(phone, otp);

  // Log for audit
  logger.info({
    requestId: req.id,
    phone: String(phone).replace(/(\d{3})\d{4}(\d{3})/, '$1****$2'),
    userId: result.data?.user_id,
    result: result.success ? 'success' : 'failed',
  }, 'auth_verify_otp');

  res.json({
    success: result.success,
    message: result.message,
    data: result.data,
    token: result.token,
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

/**
 * GET /api/auth/otp-status (development only)
 * Get OTP statistics for a phone number
 */
const getOtpStatusController = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({
      success: false,
      message: 'Not found',
      errorCode: 'NOT_FOUND',
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }

  const { phone } = req.query;

  if (!phone) {
    return res.status(400).json({
      success: false,
      message: 'Phone query parameter is required',
      errorCode: 'VALIDATION_ERROR',
      details: [{ field: 'phone', message: 'Phone is required' }],
      timestamp: new Date().toISOString(),
      requestId: req.id,
    });
  }

  const stats = await getOtpStatus(phone);

  res.json({
    success: true,
    data: stats,
    timestamp: new Date().toISOString(),
    requestId: req.id,
  });
});

module.exports = {
  sendOtpController,
  verifyOtpController,
  getOtpStatusController,
};
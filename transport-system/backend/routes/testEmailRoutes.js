/**
 * testEmailRoutes.js
 * GET /api/test/email — sends a test email using emailService and returns SMTP response.
 */

const express = require('express');
const { sendTestEmail } = require('../services/emailService');

const router = express.Router();

/**
 * GET /test/email
 * Sends a test email to OWNER_EMAIL and returns the SMTP response.
 * Response on success:
 *   { success: true, smtpResponse: "Test email sent successfully — messageId=<id>" }
 * Response on failure:
 *   { success: false, smtpResponse: null, error: "<Nodemailer error message>", details: "<full error>" }
 */
router.get('/test/email', async (req, res) => {
  try {
    const result = await sendTestEmail();

    if (result.success) {
      return res.json({
        success: true,
        smtpResponse: `Test email sent successfully — messageId=${result.messageId || 'unknown'}`,
        message: result.message,
      });
    }

    // Failure from sendTestEmail (e.g. missing env vars or SMTP error)
    return res.status(500).json({
      success: false,
      smtpResponse: null,
      error: result.message || 'Unknown error',
      details: result.error || result.message || null,
    });
  } catch (err) {
    // Unexpected error (shouldn't happen since sendTestEmail catches internally)
    return res.status(500).json({
      success: false,
      smtpResponse: null,
      error: err.message,
      details: err.stack,
    });
  }
});

module.exports = router;


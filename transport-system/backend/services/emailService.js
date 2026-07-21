/**
 * emailService.js
 * Brevo SMTP email integration using Nodemailer.
 * 
 * Environment Variables (from .env):
 *   BREVO_SMTP_HOST       — smtp-relay.brevo.com
 *   BREVO_SMTP_PORT       — 587
 *   BREVO_SMTP_USER       — Brevo SMTP login
 *   BREVO_SMTP_PASSWORD   — Brevo SMTP key
 *   FROM_EMAIL            — Verified sender email in Brevo
 *   OWNER_EMAIL           — Where booking notifications are sent
 */

const nodemailer = require('nodemailer');

// ---- SMTP Transporter ----
function createTransporter() {
  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
  const user = process.env.BREVO_SMTP_USER || '';
  const pass = process.env.BREVO_SMTP_PASSWORD || '';

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * verifyConnection — verifies SMTP connection using transporter.verify().
 * Returns { success: boolean, message: string, smtpResponse?: string, error?: string }
 */
async function verifyConnection() {
  const transporter = createTransporter();
  try {
    const success = await transporter.verify();
    if (success) {
      console.log('[email] SMTP connection verified successfully');
      return { success: true, message: 'SMTP connection verified' };
    }
    return { success: false, message: 'SMTP verification returned false' };
  } catch (err) {
    console.error(`[email] SMTP verification failed: ${err.message}`);
    return { success: false, message: `SMTP verification failed: ${err.message}`, error: err.message };
  }
}

/**
 * sendTestEmail — sends a test email to OWNER_EMAIL.
 * Returns { success: boolean, message: string, smtpResponse?: string, error?: string }
 */
async function sendTestEmail() {
  const transporter = createTransporter();
  const fromEmail = process.env.FROM_EMAIL;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!fromEmail) {
    return { success: false, message: 'FROM_EMAIL environment variable not set' };
  }
  if (!ownerEmail) {
    return { success: false, message: 'OWNER_EMAIL environment variable not set' };
  }
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASSWORD) {
    return { success: false, message: 'BREVO_SMTP_USER or BREVO_SMTP_PASSWORD not configured' };
  }

  try {
    const info = await transporter.sendMail({
      from: `"Bihar Transport" <${fromEmail}>`,
      to: ownerEmail,
      subject: '🧪 Test Email — Bihar Transport SMTP Working',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 20px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">✅ SMTP Test Passed</h1>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 15px; color: #374151;">This is a test email from <strong>Bihar Transport Begusarai</strong>.</p>
            <p style="font-size: 14px; color: #6b7280;">If you received this, Brevo SMTP is configured correctly and working.</p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="font-size: 12px; color: #9ca3af; text-align: center;">
              Sent at: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </p>
          </div>
        </div>
      `,
    });

    console.log(`[email] Test email sent successfully — messageId=${info.messageId}`);
    return { success: true, message: 'Test email sent successfully', messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Test email failed: ${err.message}`);
    return { success: false, message: `SMTP error: ${err.message}`, error: err.message };
  }
}

/**
 * sendBookingNotification — sends a booking notification to the owner.
 * Booking is saved first; this is fire-and-forget and never blocks.
 * 
 * @param {Object} booking — Must contain:
 *   booking_reference, customerName, mobile, pickup, drop,
 *   vehicle, goodsType, price, [pickupDate], [pickupTime]
 * 
 * Returns { success: boolean, message: string }
 */
async function sendBookingNotification(booking) {
  const fromEmail = process.env.FROM_EMAIL;
  const ownerEmail = process.env.OWNER_EMAIL;

  if (!fromEmail) {
    console.warn('[email] FROM_EMAIL not set — skipping booking notification');
    return { success: false, message: 'FROM_EMAIL not configured' };
  }
  if (!ownerEmail) {
    console.warn('[email] OWNER_EMAIL not set — skipping booking notification');
    return { success: false, message: 'OWNER_EMAIL not configured' };
  }
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASSWORD) {
    console.warn('[email] SMTP credentials not set — skipping booking notification');
    return { success: false, message: 'SMTP not configured' };
  }

  const {
    booking_reference = '—',
    customerName = '—',
    mobile = '—',
    pickup = '—',
    drop = '—',
    vehicle = '—',
    goodsType = '—',
    price = '—',
    pickupDate = '—',
    pickupTime = '—',
  } = booking;

  const bookingTime = pickupDate !== '—' && pickupTime !== '—'
    ? `${pickupDate} at ${pickupTime}`
    : pickupDate !== '—' ? pickupDate : '—';

  const subject = `🚚 New Booking Received - ${booking_reference}`;

  // Professional HTML email template
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; background: #f3f4f6; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); padding: 28px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0 0 4px; font-size: 24px; font-weight: 700; letter-spacing: -0.5px; }
    .header p { color: rgba(255,255,255,0.85); margin: 0; font-size: 15px; }
    .badge { display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 20px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; background: rgba(255,255,255,0.2); color: #fff; }
    .body { padding: 24px; }
    .greeting { font-size: 15px; color: #374151; margin-bottom: 20px; }
    .card { background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #e5e7eb; }
    .card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 12px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 13px; color: #6b7280; }
    .value { font-size: 13px; font-weight: 600; color: #111827; text-align: right; }
    .status { display: inline-block; padding: 3px 12px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #fef3c7; color: #92400e; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .footer a { color: #f59e0b; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚚 New Booking Received</h1>
      <p>Booking #${escapeHtml(booking_reference)}</p>
      <div class="badge">Pending</div>
    </div>
    <div class="body">
      <p class="greeting">A new booking has been placed. Review the details below.</p>

      <div class="card">
        <div class="card-title">Customer Details</div>
        <div class="row"><span class="label">Name</span><span class="value">${escapeHtml(customerName)}</span></div>
        <div class="row"><span class="label">Phone</span><span class="value">${escapeHtml(mobile)}</span></div>
      </div>

      <div class="card">
        <div class="card-title">Route</div>
        <div class="row"><span class="label">Pickup</span><span class="value">${escapeHtml(pickup)}</span></div>
        <div class="row"><span class="label">Drop</span><span class="value">${escapeHtml(drop)}</span></div>
        <div class="row"><span class="label">Booking Time</span><span class="value">${escapeHtml(bookingTime)}</span></div>
      </div>

      <div class="card">
        <div class="card-title">Shipment Details</div>
        <div class="row"><span class="label">Vehicle</span><span class="value">${escapeHtml(vehicle)}</span></div>
        <div class="row"><span class="label">Goods Type</span><span class="value">${escapeHtml(goodsType)}</span></div>
        <div class="row"><span class="label">Est. Price</span><span class="value">₹${escapeHtml(String(price))}</span></div>
      </div>

      <p style="text-align: center; margin-top: 24px;">
        <a href="${escapeHtml(process.env.ADMIN_URL || 'http://localhost:3000/admin')}"
           style="display: inline-block; padding: 12px 28px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px;">
          View in Admin Dashboard →
        </a>
      </p>
    </div>
    <div class="footer">
      <p>Bihar Transport Begusarai &bull; Enterprise Logistics</p>
      <p>📍 Begusarai, Bihar</p>
      <p style="margin-top: 8px;">
        <a href="${escapeHtml(process.env.ADMIN_URL || 'http://localhost:3000/admin')}">Admin Dashboard</a>
      </p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"Bihar Transport" <${fromEmail}>`,
      to: ownerEmail,
      subject,
      html,
    });

    console.log(`[email] Booking notification sent — booking=${booking_reference} to=${ownerEmail} messageId=${info.messageId}`);
    return { success: true, message: 'Booking notification sent' };
  } catch (err) {
    console.error(`[email] Booking notification failed — booking=${booking_reference} to=${ownerEmail} error="${err.message}"`);
    return { success: false, message: `SMTP error: ${err.message}`, error: err.message };
  }
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

module.exports = {
  verifyConnection,
  sendTestEmail,
  sendBookingNotification,
};


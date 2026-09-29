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
const fs = require('fs');
const path = require('path');

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
 * sendPasswordResetEmail — sends a password reset email to the user.
 *
 * @param {Object} params
 * @param {string} params.email — Recipient email
 * @param {string} params.resetUrl — Full reset URL with token
 * @param {string} params.userName — User's name for personalization
 * @returns {Promise<{success: boolean, message: string, messageId?: string, error?: string}>}
 */
async function sendPasswordResetEmail({ email, resetUrl, userName }) {
  const fromEmail = process.env.FROM_EMAIL;

  if (!fromEmail) {
    console.warn('[email] FROM_EMAIL not set — skipping password reset email');
    return { success: false, message: 'FROM_EMAIL not configured' };
  }
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASSWORD) {
    console.warn('[email] SMTP credentials not set — skipping password reset email');
    return { success: false, message: 'SMTP not configured' };
  }

  const subject = 'Reset your Bihar Transport password';

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
    .body { padding: 24px; }
    .greeting { font-size: 15px; color: #374151; margin-bottom: 20px; }
    .card { background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #e5e7eb; }
    .card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #9ca3af; margin-bottom: 12px; }
    .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #f3f4f6; }
    .row:last-child { border-bottom: none; }
    .label { font-size: 13px; color: #6b7280; }
    .value { font-size: 13px; font-weight: 600; color: #111827; text-align: right; }
    .button { display: inline-block; padding: 14px 28px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; text-align: center; }
    .button:hover { background: #d97706; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; background: #f9fafb; border-top: 1px solid #e5e7eb; }
    .footer a { color: #f59e0b; text-decoration: none; font-weight: 600; }
    .security-note { font-size: 13px; color: #6b7280; background: #fef3c7; border: 1px solid #fcd34d; border-radius: 8px; padding: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Password Reset Request</h1>
      <p>Bihar Transport Begusarai</p>
    </div>
    <div class="body">
      <p class="greeting">Hello ${escapeHtml(userName || 'there')},</p>
      <p style="font-size: 15px; color: #374151; margin-bottom: 20px;">
        We received a request to reset the password for your Bihar Transport account.
        If you didn't make this request, you can safely ignore this email.
      </p>

      <div class="card">
        <div class="card-title">Reset Details</div>
        <div class="row"><span class="label">Account</span><span class="value">${escapeHtml(email)}</span></div>
        <div class="row"><span class="label">Expires</span><span class="value">30 minutes</span></div>
      </div>

      <p style="text-align: center; margin-top: 24px;">
        <a href="${escapeHtml(resetUrl)}" class="button">Reset Password</a>
      </p>

      <p style="font-size: 13px; color: #6b7280; text-align: center; margin-top: 16px;">
        Or copy this link into your browser:<br>
        <span style="word-break: break-all; color: #9ca3af;">${escapeHtml(resetUrl)}</span>
      </p>

      <div class="security-note">
        <strong>Security Note:</strong> This link will expire in 30 minutes and can only be used once.
        If you didn't request a password reset, please contact support immediately.
      </div>
    </div>
    <div class="footer">
      <p>Bihar Transport Begusarai &bull; Enterprise Logistics</p>
      <p>📍 Begusarai, Bihar</p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransporter();

  try {
    const info = await transporter.sendMail({
      from: `"Bihar Transport" <${fromEmail}>`,
      to: email,
      subject,
      html,
    });

    console.log(`[email] Password reset email sent — to=${email} messageId=${info.messageId}`);
    return { success: true, message: 'Password reset email sent', messageId: info.messageId };
  } catch (err) {
    console.error(`[email] Password reset email failed — to=${email} error="${err.message}"`);
    return { success: false, message: `SMTP error: ${err.message}`, error: err.message };
  }
}

/**
 * sendNewInquiryNotificationEmail — notifies the transport OWNER that a new
 * customer enquiry has been submitted.
 *
 * The recipient is ALWAYS process.env.OWNER_EMAIL. The customer is never
 * emailed: neither the enquiry's own address nor the customer's User.email is
 * ever used as a recipient. This system sends no customer confirmation email.
 *
 * Call this only AFTER the enquiry row is committed. It THROWS on SMTP failure
 * so the caller can log it; callers must wrap it in try/catch so a delivery
 * failure can never roll back or fail the enquiry itself.
 *
 * @param {Object} enquiry  Persisted Enquiry row
 * @returns {Promise<{success: boolean, messageId?: string, accepted?: string[], rejected?: string[]}>}
 */
async function sendNewInquiryNotificationEmail(enquiry) {
  console.log('[email] New inquiry notification triggered');

  const fromEmail = process.env.FROM_EMAIL;
  const ownerEmail = process.env.OWNER_EMAIL;
  const enquiryRef = enquiry?.enquiry_number || (enquiry?.enquiry_id ? `#${enquiry.enquiry_id}` : '—');

  if (!fromEmail) {
    console.warn('[email] Inquiry notification skipped: FROM_EMAIL not set');
    return { success: false, message: 'FROM_EMAIL not configured' };
  }
  if (!ownerEmail) {
    console.warn('[email] Inquiry notification skipped: OWNER_EMAIL not set');
    return { success: false, message: 'OWNER_EMAIL not configured' };
  }
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASSWORD) {
    console.warn('[email] Inquiry notification skipped: SMTP credentials not set');
    return { success: false, message: 'SMTP not configured' };
  }

  console.log(`[email] Inquiry ID: ${enquiryRef}`);
  console.log(`[email] Recipient: ${ownerEmail}`);

  const logo = brandLogoAttachment();
  const { subject, html, text } = buildNewInquiryEmail({
    enquiry,
    enquiryRef,
    hasLogo: Boolean(logo),
  });

  const transporter = createTransporter();
  console.log('[email] Sending inquiry notification...');
  console.log(`[email] Brand logo embedded: ${logo ? 'yes' : 'no (text wordmark used)'}`);

  try {
    const info = await transporter.sendMail({
      from: `"Bihar Transport" <${fromEmail}>`,
      to: ownerEmail,
      subject,
      text,
      html,
      // Embedded CID part — the logo travels inside the message, so it needs no
      // public URL and no client can fail to load it.
      ...(logo ? { attachments: [logo] } : {}),
    });

    console.log('[email] SMTP accepted message');
    console.log(`[email] Message ID: ${info?.messageId}`);
    console.log(`[email] Accepted: ${JSON.stringify(info?.accepted || [])}`);
    console.log(`[email] Rejected: ${JSON.stringify(info?.rejected || [])}`);

    return {
      success: true,
      messageId: info?.messageId,
      accepted: info?.accepted || [],
      rejected: info?.rejected || [],
    };
  } catch (error) {
    console.error('[email] Inquiry notification FAILED', {
      enquiry: enquiryRef,
      recipient: ownerEmail,
      message: error?.message,
      code: error?.code,
      response: error?.response,
      responseCode: error?.responseCode,
      command: error?.command,
      rejected: error?.rejected,
    });
    // Rethrow so the caller records the failure. Never swallow silently.
    throw error;
  }
}

/**
 * The official Bihar Transport logo, embedded as a CID attachment.
 *
 * CID is used deliberately: an <img src="https://..."> needs a publicly
 * reachable host this project does not define, and "localhost" never resolves
 * inside an email client. A CID part travels inside the message itself, so the
 * logo renders in Zoho/Gmail/Outlook with no external dependency and no
 * filesystem path ever exposed in the HTML.
 */
const BRAND_LOGO_CID = 'bihar-transport-logo';

function resolveBrandLogoPath() {
  const candidates = [
    process.env.BRAND_LOGO_PATH,
    // backend/services -> repo frontend public assets
    path.join(__dirname, '..', '..', 'frontend', 'public', 'assets', 'logo.png'),
    path.join(__dirname, '..', '..', 'frontend', 'public', 'logo.jpeg'),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** null when no logo asset is available, so no broken image is ever emitted. */
function brandLogoAttachment() {
  const logoPath = resolveBrandLogoPath();
  if (!logoPath) return null;
  return {
    filename: 'bihar-transport-logo.jpg',
    path: logoPath,
    cid: BRAND_LOGO_CID,
    // The asset is a JPEG despite its .png extension, so state the type
    // explicitly instead of letting the extension guess.
    contentType: 'image/jpeg',
  };
}

// Label -> section heading. Grouping keeps the email short and scannable
// instead of one long undifferentiated list of rows.
const INQUIRY_SECTIONS = [
  { title: 'Customer', labels: ['Customer Name', 'Customer Mobile', 'Source'], highlight: ['Customer Name', 'Customer Mobile'] },
  { title: 'Transport', labels: ['Pickup Location', 'Drop Location', 'Vehicle Type', 'Goods / Material', 'Quantity', 'Weight'], highlight: ['Pickup Location', 'Drop Location', 'Vehicle Type'] },
  { title: 'Trip', labels: ['Pickup Date', 'Pickup Time', 'Distance'] },
  { title: 'Inquiry', labels: ['Inquiry Number', 'Special Instructions', 'Created', 'Inquiry Status'] },
];

/** Only fields that genuinely exist on the Enquiry row. */
function newInquiryRows(e) {  const b = e || {};
  const num = (v, unit) => {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return null;
    return unit ? `${v} ${unit}` : String(v);
  };
  const fmtDate = (d) =>
    (d ? new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : null);

  return [
    ['Inquiry Number', b.enquiry_number],
    ['Customer Name', b.customer_name],
    ['Customer Mobile', b.customer_mobile],
    ['Pickup Location', b.pickup_location],
    ['Drop Location', b.drop_location],
    ['Vehicle Type', b.requested_vehicle_name],
    ['Goods / Material', b.material || b.goods_category],
    ['Quantity', num(b.quantity, b.quantity_unit)],
    ['Weight', num(b.weight, b.weight_unit)],
    ['Pickup Date', fmtDate(b.pickup_date)],
    ['Pickup Time', b.pickup_time],
    ['Distance', num(b.distance_km, 'km')],
    ['Source', b.customer_id ? 'Registered customer' : 'Guest (website)'],
    ['Special Instructions', b.special_instructions],
    ['Created', b.created_at
      ? new Date(b.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
      : null],
    ['Inquiry Status', b.status],
  ]
    // Drop rows the enquiry genuinely has no value for — an absent field is
    // never rendered as a blank line, and nothing is invented to fill it.
    .filter(([, value]) => value !== null && value !== undefined && value !== '');
}

/**
 * Group the flat rows into CUSTOMER / TRANSPORT / TRIP / INQUIRY blocks so the
 * owner can scan the email in seconds instead of reading one long list.
 * A section with no real values is omitted entirely.
 */
function newInquirySections(enquiry) {
  const rows = newInquiryRows(enquiry);
  const byLabel = new Map(rows.map(([label, value]) => [label, value]));

  return INQUIRY_SECTIONS
    .map((section) => ({
      ...section,
      rows: section.labels
        .filter((label) => byLabel.has(label))
        .map((label) => [label, byLabel.get(label)]),
    }))
    .filter((section) => section.rows.length > 0);
}

/**
 * Build one responsive, table-based, inline-styled HTML email.
 *
 * Table layout + inline CSS is used because desktop mail clients have limited
 * CSS support: flexbox/grid and external stylesheets are unreliable. The media
 * query below is progressive enhancement only — the inline styles already stack
 * correctly when it is ignored.
 */
function buildNewInquiryEmail({ enquiry, enquiryRef, hasLogo = false }) {
  const sections = newInquirySections(enquiry);
  const valueOf = (label) => {
    for (const section of sections) {
      const hit = section.rows.find(([l]) => l === label);
      if (hit) return hit[1];
    }
    return null;
  };

  // The dashboard link appears ONLY when the deployment already configures a
  // URL. No production URL is invented here.
  const adminUrl = (process.env.ADMIN_URL || '').trim();
  const dashboardHref = adminUrl ? `${adminUrl.replace(/\/+$/, '')}/admin/enquiries` : '';

  // ---- plain-text alternative (kept in sync with the HTML) ----------------
  const textLines = [
    'Bihar Transport',
    '================',
    '',
    'NEW TRANSPORT INQUIRY',
    `Inquiry ${enquiryRef}`,
    '',
  ];
  for (const section of sections) {
    textLines.push(section.title.toUpperCase());
    for (const [label, value] of section.rows) textLines.push(`  ${label}: ${value}`);
    textLines.push('');
  }
  if (dashboardHref) textLines.push(`View Inquiry in Dashboard: ${dashboardHref}`, '');
  textLines.push('Bihar Transport Begusarai • Enterprise Logistics');

  // ---- HTML ---------------------------------------------------------------
  const logoCell = hasLogo
    ? `<img src="cid:${BRAND_LOGO_CID}" width="250" alt="Bihar Transport"
             style="display:block;width:250px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;">`
    : `<span style="font-size:19px;font-weight:700;letter-spacing:1.5px;color:#15345B;">BIHAR TRANSPORT</span>`;

  const badge = `<span style="display:inline-block;padding:5px 14px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;letter-spacing:1px;">NEW</span>`;

  const sectionHtml = sections.map((section) => {
    const rowHtml = section.rows.map(([label, value]) => {
      const isKey = (section.highlight || []).includes(label);
      return `
                  <tr>
                    <td class="lbl" style="padding:9px 12px 9px 0;border-bottom:1px solid #eef1f5;font-size:13px;color:#64748B;vertical-align:top;width:38%;word-break:normal;overflow-wrap:break-word;">${escapeHtml(label)}</td>
                    <td class="val" style="padding:9px 0;border-bottom:1px solid #eef1f5;font-size:${isKey ? '15px' : '14px'};font-weight:600;color:#0F2747;word-break:break-word;overflow-wrap:anywhere;max-width:62%;">${escapeHtml(value)}</td>
                  </tr>`;
    }).join('');

    return `
              <tr><td colspan="2" style="padding:0 0 8px;">
                <span style="font-size:11px;font-weight:700;letter-spacing:1.2px;color:#B45309;text-transform:uppercase;">${escapeHtml(section.title)}</span>
              </td></tr>
              <tr><td colspan="2" style="padding:0;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;table-layout:fixed;">${rowHtml}
                </table>
              </td></tr>
              <tr><td colspan="2" style="height:18px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
  }).join('');

  const ctaButton = dashboardHref
    ? `<a href="${escapeHtml(dashboardHref)}" style="display:inline-block;background:#F59E0B;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;padding:13px 30px;border-radius:8px;">View Inquiry in Dashboard</a>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>New Transport Inquiry</title>
</head>
<body style="margin:0;padding:0;background:#EEF1F5;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;background:#EEF1F5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #E2E8F0;">

          <!-- Header: logo, title, enquiry number, status badge -->
          <tr>
            <td style="padding:26px 28px 22px;background:#ffffff;border-bottom:3px solid #F59E0B;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
                <tr>
                  <td align="left" style="padding-bottom:16px;">${logoCell}</td>
                </tr>
                <tr>
                  <td style="font-size:20px;font-weight:700;letter-spacing:-0.2px;color:#0F2747;padding-bottom:4px;">New Transport Inquiry</td>
                </tr>
                <tr>
                  <td style="padding-bottom:12px;">
                    <span style="font-family:Menlo,Consolas,monospace;font-size:14px;color:#475569;">Inquiry ${escapeHtml(enquiryRef)}</span>
                  </td>
                </tr>
                <tr><td align="left">${badge}</td></tr>
              </table>
            </td>
          </tr>

          <!-- Headline summary so the key facts read in a second -->
          <tr>
            <td style="padding:20px 28px 4px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;">
                <tr>
                  <td style="padding:14px 16px;font-size:13px;color:#78350F;">
                    A new transport enquiry has been submitted. Please follow up with the customer.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 14px;font-size:20px;font-weight:700;color:#0F2747;">
                    ${escapeHtml(valueOf('Pickup Location') || '—')}
                    <span style="font-size:13px;font-weight:600;color:#B45309;">&nbsp;&rarr;&nbsp;</span>
                    ${escapeHtml(valueOf('Drop Location') || '—')}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Grouped detail sections -->
          <tr>
            <td style="padding:20px 28px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${sectionHtml}
              </table>
            </td>
          </tr>

          <!-- Dashboard CTA -->
          ${ctaButton ? `
          <tr>
            <td align="center" style="padding:14px 28px 26px;">
              ${ctaButton}
            </td>
          </tr>` : ''}

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:18px 28px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#94A3B8;">
              Bihar Transport Begusarai &bull; Enterprise Logistics
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `New Transport Inquiry — ${enquiryRef}`,
    html,
    text: textLines.join('\n'),
  };
}

/**
 * Escape HTML special characters to prevent injection.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  verifyConnection,
  sendTestEmail,
  sendBookingNotification,
  sendNewInquiryNotificationEmail,
  sendPasswordResetEmail,
  // exported for tests
  buildNewInquiryEmail,
  newInquiryRows,
};


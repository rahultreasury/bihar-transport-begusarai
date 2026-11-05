/**
 * customerCare.js
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for Bihar Transport customer-care contact details.
 *
 * WHY THIS FILE EXISTS
 * The customer's ONLY phone contact for a transport enquiry is the fixed
 * Bihar Transport customer-care line. Driver mobile numbers are a hard privacy
 * boundary and are never exposed to customers (see dtos/EnquiryDTO.js).
 *
 * Because that number and the representative details are rendered on several
 * pages (enquiry confirmation, quote card, sticky mobile action bar, WhatsApp
 * deep links), they must live in ONE place and be read from environment /
 * configuration — never hardcoded in React components.
 *
 * ENVIRONMENT VARIABLES (all optional, sane defaults provided):
 *   CUSTOMER_CARE_NAME       Display name of the support executive
 *   CUSTOMER_CARE_PHONE      Dialable phone number (raw digits, no +91 prefix)
 *   CUSTOMER_CARE_WHATSAPP   WhatsApp-enabled number (falls back to PHONE)
 *   CUSTOMER_CARE_PHOTO      Absolute or public-relative photo URL
 *   CUSTOMER_CARE_DESIGNATION Job title shown under the name
 *   CUSTOMER_CARE_HOURS      Support hours text
 *   CUSTOMER_CARE_EMAIL      Optional support mailbox
 *   BRAND_NAME               Brand name used in generated messages
 */

const BRAND_NAME = (process.env.BRAND_NAME || 'Bihar Transport').trim();

/**
 * Normalize a phone-ish value to bare international digits usable by wa.me and
 * tel:. Accepts "+91 98765 43210", "91-98765-43210", "9876543210".
 *
 * @param {string|null|undefined} value
 * @returns {string} digits only (e.g. "919876543210") or '' when unusable
 */
function toDialableDigits(value) {
  if (value === null || value === undefined) return '';
  const raw = String(value).trim();
  if (!raw) return '';

  // Take the leading "+" and every digit, ignoring spaces, dashes, dots, parens.
  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  if (!digits) return '';

  // A bare 10-digit Indian number becomes 91XXXXXXXXXX for wa.me / tel:.
  if (!hasPlus && digits.length === 10 && /^[6-9]/.test(digits)) {
    return `91${digits}`;
  }

  return digits;
}

/**
 * Format digits into a human-readable international grouping for display,
 * e.g. "919876543210" -> "+91 98765 43210".
 *
 * @param {string} digits
 * @returns {string}
 */
function formatPhoneForDisplay(digits) {
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) {
    const national = digits.slice(2);
    return `+91 ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  return `+${digits}`;
}

const RAW_PHONE = process.env.CUSTOMER_CARE_PHONE || process.env.WHATSAPP_BUSINESS_NUMBER || '';
const RAW_WHATSAPP = process.env.CUSTOMER_CARE_WHATSAPP || RAW_PHONE;

const PHONE_DIGITS = toDialableDigits(RAW_PHONE);
const WHATSAPP_DIGITS = toDialableDigits(RAW_WHATSAPP) || PHONE_DIGITS;

/**
 * Build the canonical wa.me deep link. The message is always URL-encoded so a
 * multi-line enquiry body can never break the link, and the number is always
 * digits-only so WhatsApp resolves it correctly.
 *
 * @param {string} message - plain-text (may be multi-line)
 * @returns {string} https://wa.me/<number>?text=<encoded>
 */
function buildWhatsAppLink(message) {
  if (!WHATSAPP_DIGITS) return '';
  const text = message ? String(message) : '';
  return `https://wa.me/${WHATSAPP_DIGITS}?text=${encodeURIComponent(text)}`;
}

/**
 * Build a tel: deep link for the "Call Customer Care" action.
 * @returns {string}
 */
function buildCallLink() {
  if (!PHONE_DIGITS) return '';
  return `tel:+${PHONE_DIGITS}`;
}

/**
 * The immutable customer-care profile. Returned as-is (a fresh object per call
 * so a caller can never mutate the shared config).
 *
 * @returns {{
 *   brandName: string,
 *   name: string,
 *   designation: string,
 *   photo: string|null,
 *   phoneDisplay: string,
 *   phoneDigits: string,
 *   whatsappUrl: string,
 *   callUrl: string,
 *   hours: string,
 *   email: string|null,
 *   isConfigured: boolean
 * }}
 */
function getCustomerCare() {
  return {
    brandName: BRAND_NAME,
    name: (process.env.CUSTOMER_CARE_NAME || `${BRAND_NAME} Customer Care`).trim(),
    designation: (process.env.CUSTOMER_CARE_DESIGNATION || 'Customer Care Executive').trim(),
    photo: process.env.CUSTOMER_CARE_PHOTO || null,
    phoneDisplay: formatPhoneForDisplay(PHONE_DIGITS),
    phoneDigits: PHONE_DIGITS,
    whatsappUrl: buildWhatsAppLink(''),
    callUrl: buildCallLink(),
    hours: (process.env.CUSTOMER_CARE_HOURS || 'Mon – Sat, 8:00 AM – 8:00 PM').trim(),
    email: process.env.CUSTOMER_CARE_EMAIL || null,
    // When false the UI hides the call/WhatsApp buttons rather than rendering
    // a dead link — a misconfigured deployment must fail visibly, not silently
    // send customers to a broken contact.
    isConfigured: Boolean(WHATSAPP_DIGITS),
  };
}

module.exports = {
  BRAND_NAME,
  getCustomerCare,
  buildWhatsAppLink,
  buildCallLink,
  toDialableDigits,
  formatPhoneForDisplay,
};

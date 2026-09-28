/**
 * customerCare.js
 * ---------------------------------------------------------------------------
 * The frontend's single source of truth for Bihar Transport customer-care
 * contact details.
 *
 * WHY THIS EXISTS
 * The support number was previously hardcoded in three React files
 * (BookTransport.jsx, Home.jsx, components/tracking/SupportCard.jsx), in two
 * different formats. That is how a support number silently diverges between
 * the booking page, the home page and the enquiry confirmation page — and it
 * makes "change the customer-care number" a multi-file code edit instead of a
 * deployment setting.
 *
 * THE RULE
 * The backend owns the value. It is read from
 *   GET /api/enquiries/config/customer-care
 * which serves config/customerCare.js on the server, populated from
 * environment variables (CUSTOMER_CARE_NAME / _PHONE / _WHATSAPP / _PHOTO / …).
 *
 * The fallback below exists ONLY so a page can render a button before (or
 * without) that first fetch. It is not an independent source of truth — it is
 * the same number, kept here purely so the very first paint is never empty. Set
 * VITE_CUSTOMER_CARE_WHATSAPP at build time to change it without a backend
 * round trip.
 *
 * THE PHOTO
 * The representative's portrait ships with the frontend as a static asset
 * (public/assets/customer-care.png) and is referenced by an ordinary
 * same-origin path, so it is served by the CDN in exactly the same way as the
 * rest of public/ — no backend redeploy, no environment variable, no import.
 * That default is deliberately NOT conditional on configuration: the Support
 * card is the one place on the confirmation page that answers "is this safe,
 * and who do I call?", and it must never degrade to a "BC" monogram because
 * one environment variable on one host was left unset. The env var below only
 * exists to point at a DIFFERENT photograph (e.g. a future team member) — it
 * is never required for the real portrait to render.
 */

import { enquiryAPI } from '../services/enquiryAPI';

/**
 * The representative portrait that ships with the app.
 *
 * A transparent-background cutout, served from public/ so the browser requests
 * it from the same origin as the page. Keep this in sync with the file in
 * public/assets/ — if the file is renamed, this constant must be too, or the
 * Support card silently falls back to its monogram.
 */
export const DEFAULT_CUSTOMER_CARE_PHOTO = '/assets/customer-care.png';

/** Alt text for the portrait. Carries no personal information. */
export const CUSTOMER_CARE_PHOTO_ALT = 'Bihar Transport Customer Care Executive';

/** Build-time fallback. Override with VITE_CUSTOMER_CARE_WHATSAPP. */
const FALLBACK_DIGITS = (
  import.meta.env.VITE_CUSTOMER_CARE_WHATSAPP || '8210931799'
)
  .replace(/\D/g, '')
  // A bare 10-digit number becomes the 91… form wa.me expects.
  .replace(/^(\d{10})$/, '91$1');

const FALLBACK_PHONE = (
  import.meta.env.VITE_CUSTOMER_CARE_PHONE || '8210931799'
).replace(/\D/g, '');

/** Normalise a 10-digit Indian number to "+91 98765 43210". */
function formatPhoneDisplay(digits) {
  if (!digits) return '';
  if (digits.length === 10) {
    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    const nat = digits.slice(2);
    return `+91 ${nat.slice(0, 5)} ${nat.slice(5)}`;
  }
  return `+${digits}`;
}

/** The profile used before the API responds (and if it is unreachable). */
export const FALLBACK_CUSTOMER_CARE = {
  brandName: 'Bihar Transport',
  name: 'Bihar Transport Customer Care',
  designation: 'Customer Care Executive',
  photo: import.meta.env.VITE_CUSTOMER_CARE_PHOTO || DEFAULT_CUSTOMER_CARE_PHOTO,
  photoAlt: CUSTOMER_CARE_PHOTO_ALT,
  phoneDisplay: formatPhoneDisplay(FALLBACK_PHONE),
  phoneDigits: FALLBACK_PHONE,
  hours: 'Mon – Sat, 8:00 AM – 8:00 PM',
  email: null,
  isConfigured: true,
  whatsappUrl: `https://wa.me/${FALLBACK_DIGITS}`,
  callUrl: FALLBACK_PHONE ? `tel:+${FALLBACK_PHONE}` : '',
};

/**
 * Fetch the authoritative customer-care profile.
 *
 * Returns the server profile on success and the build-time fallback on failure,
 * so a support button is never dead. The number itself is never constructed
 * here when the server responds — the server returns a fully-formed wa.me URL
 * with the enquiry context already encoded.
 *
 * @param {string} [enquiryNumber] - pre-fills the WhatsApp message
 * @returns {Promise<object>}
 */
export async function fetchCustomerCare(enquiryNumber) {
  try {
    const { data } = await enquiryAPI.getCustomerCare(enquiryNumber);
    const care = data?.data;
    if (care && care.isConfigured) return care;
    return { ...FALLBACK_CUSTOMER_CARE, ...care };
  } catch {
    return FALLBACK_CUSTOMER_CARE;
  }
}

export default FALLBACK_CUSTOMER_CARE;

/* ── Shared link builders ──────────────────────────────────────────────
   Every surface that offers "contact Bihar Transport" — the support card, its
   inline variant, and the sticky mobile bar — calls THESE functions. That is
   what guarantees the displayed number, the WhatsApp deep link and the tel:
   link can never disagree, and that no component ever rebuilds a number of its
   own. */

/** Does a server-built wa.me URL actually carry a prefilled message? */
function hasPrefilledText(url) {
  if (!url) return false;
  const match = url.match(/[?&]text=([^&]*)/);
  return Boolean(match && decodeURIComponent(match[1]).trim());
}

/**
 * The canonical WhatsApp deep link for an enquiry.
 *
 * The backend already builds a rich, server-side message from the LIVE enquiry
 * (route, material, pickup slot) and returns it as `whatsappUrl` — that link is
 * preferred, because the message is generated from authoritative data, never
 * from client-supplied text. We only build the link locally when the server has
 * no prefilled message, and the enquiry number is always interpolated from the
 * real route parameter, never hardcoded.
 *
 * @param {object} profile  a customer-care profile (server or fallback)
 * @param {string} [enquiryNumber]
 * @returns {string} an https://wa.me/… URL, or '' when no number is configured
 */
export function buildWhatsAppUrl(profile, enquiryNumber) {
  const digits = (profile?.phoneDigits || '').replace(/\D/g, '');

  if (hasPrefilledText(profile?.whatsappUrl)) return profile.whatsappUrl;
  if (!digits) return '';

  // A bare 10-digit number becomes the 91… form wa.me expects.
  const waDigits = digits.length === 10 ? `91${digits}` : digits;
  const message = `Hello Bihar Transport, I need help regarding my transport request${
    enquiryNumber ? ` ${enquiryNumber}` : ''
  }.`;

  return `https://wa.me/${waDigits}?text=${encodeURIComponent(message)}`;
}

/**
 * The canonical `tel:` link. Built from the SAME digits as the WhatsApp link,
 * so the number a customer dials is the number they were shown.
 *
 * @param {object} profile
 * @returns {string}
 */
export function buildCallUrl(profile) {
  if (profile?.callUrl) return profile.callUrl;
  const digits = (profile?.phoneDigits || '').replace(/\D/g, '');
  return digits ? `tel:+${digits}` : '';
}

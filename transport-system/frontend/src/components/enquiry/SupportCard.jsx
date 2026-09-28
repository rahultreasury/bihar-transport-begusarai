/**
 * SupportCard.jsx
 * ---------------------------------------------------------------------------
 * The human-support hero of the enquiry confirmation page.
 *
 * WHY IT IS THIS IMPORTANT
 * A customer who has just submitted a transport request is not asking for a
 * status report — they are asking "is this safe, and who do I call?". This card
 * answers both in one glance, and it sits directly beside the Request ID so the
 * reassurance and the identifier are read as one thing.
 *
 * SINGLE SOURCE OF TRUTH FOR CONTACT
 * Every contact detail comes from the backend customer-care profile
 * (GET /api/enquiries/config/customer-care → config/customerCare.js on the
 * server → CUSTOMER_CARE_NAME / _PHONE / _WHATSAPP / _PHOTO / _HOURS env vars),
 * falling back to config/customerCare.js in the browser. No number is hardcoded
 * in this file, and the WhatsApp link, the tel: link and the displayed number
 * all come from the SAME profile object, so they can never disagree.
 *
 * THE PHOTO
 * The representative portrait is a real, configured image
 * (CUSTOMER_CARE_PHOTO / VITE_CUSTOMER_CARE_PHOTO → /assets/customer-care.jpg)
 * and it fills the rounded frame ON ITS OWN. There is no second tile, no
 * initials, no avatar badge and no fallback text beneath or beside it while
 * that photo is available — a duplicate placeholder stacked under a real
 * portrait is exactly what this card used to render, and it read as a bug.
 *
 * PRIVACY
 * This card links ONLY to Bihar Transport customer care. The assigned driver's
 * number is never rendered here (nor anywhere else on this page) — see
 * dtos/EnquiryDTO.js, which omits driver contact fields from the customer DTO.
 */

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Phone, Clock, ShieldCheck, Headset } from 'lucide-react';
import { enquiryAPI } from '../../services/enquiryAPI';
import { FALLBACK_CUSTOMER_CARE, buildWhatsAppUrl, buildCallUrl } from '../../config/customerCare';

/** Derive up to two initials from a name, for the monogram fallback. */
function initialsOf(name) {
  if (!name) return 'BT';
  const words = String(name)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'BT';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * The representative portrait.
 *
 * The photo IS the tile: rounded corners, object-fit: cover so it never
 * distorts, object-position centred so the face stays in frame. It is a single
 * <img> — the previous version also rendered a "hidden" monogram sibling that
 * carried Tailwind's `flex` class, which overrode the [hidden] attribute and
 * painted a second blue BC box directly underneath the photo. That sibling is
 * gone; there is now nothing to show but the photograph.
 *
 * The monogram is a last resort only. It is swapped IN for the <img> — never
 * rendered beside it — so the profile area can never stack two boxes. It is
 * reached only when no photo is configured at all, or when a configured URL
 * fails to load (a torn-image icon in the most important card on the page would
 * be worse than branded initials).
 */
function Representative({ photo, name, size = 'lg' }) {
  // Remember WHICH url failed rather than a boolean, so a later profile refresh
  // that publishes a different (working) photo renders the real image again.
  const [brokenPhoto, setBrokenPhoto] = useState(null);

  const dims = size === 'lg' ? 'h-[72px] w-[72px] sm:h-20 sm:w-20' : 'h-12 w-12';
  const textSize = size === 'lg' ? 'text-xl sm:text-2xl' : 'text-sm';

  const shell =
    'shrink-0 overflow-hidden rounded-2xl ring-4 ring-white shadow-[0_10px_26px_-8px_rgba(23,43,77,0.35)]';
  const label = name ? `${name} — Bihar Transport` : 'Bihar Transport customer care';

  if (photo && photo !== brokenPhoto) {
    return (
      <img
        src={photo}
        alt={label}
        className={`${shell} ${dims} block object-cover object-center`}
        loading="eager"
        decoding="async"
        onError={() => setBrokenPhoto(photo)}
      />
    );
  }

  return (
    <div
      className={`${shell} ${dims} flex items-center justify-center bg-gradient-to-br from-[#172B4D] to-[#2C4A7C]`}
      role="img"
      aria-label={label}
    >
      <span className={`${textSize} font-bold tracking-wide text-white`}>{initialsOf(name)}</span>
    </div>
  );
}

/** Block a dead link without removing the (still informative) phone number. */
function guardLink(canContact) {
  return (e) => {
    if (!canContact) e.preventDefault();
  };
}

export default function SupportCard({ enquiryNumber, className = '' }) {
  const [care, setCare] = useState(null);

  // One fetch, shared shape with the rest of the page. The enquiry number makes
  // the backend pre-fill the WhatsApp message with this request's context.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await enquiryAPI.getCustomerCare(enquiryNumber);
        if (!cancelled) setCare(data?.data || null);
      } catch {
        if (!cancelled) setCare(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enquiryNumber]);

  const profile = useMemo(() => {
    if (!care) return FALLBACK_CUSTOMER_CARE;
    // Prefer the server value, but keep the build-time fallback's links if the
    // server has nothing configured, so the buttons still work.
    return {
      ...FALLBACK_CUSTOMER_CARE,
      ...care,
      phoneDigits: care.phoneDigits || FALLBACK_CUSTOMER_CARE.phoneDigits,
      // Never let a server response with no photo published knock the real
      // portrait out — the representative is a person, not a placeholder.
      photo: care.photo || FALLBACK_CUSTOMER_CARE.photo,
    };
  }, [care]);

  const digits = (profile.phoneDigits || '').replace(/\D/g, '');
  const canContact = Boolean(digits);

  /* Both links come from the shared customer-care builders, so the WhatsApp
     deep link, the tel: link and the displayed number can never disagree. */
  const whatsappUrl = buildWhatsAppUrl(profile, enquiryNumber);
  const callUrl = buildCallUrl(profile);

  const hours = profile.hours || 'Mon – Sat · 8:00 AM – 8:00 PM';
  const designation = profile.designation || 'Customer Care Executive';

  return (
    <section
      className={`relative overflow-hidden rounded-3xl border border-[#172B4D]/10 bg-white shadow-[0_2px_6px_rgba(23,43,77,0.05),0_24px_56px_-30px_rgba(11,27,51,0.45)] ${className}`}
      aria-labelledby="support-card-heading"
    >
      {/* A single restrained navy wash keeps the card distinct without the
          cheap "gradient everywhere" look. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#172B4D]/[0.05] to-transparent"
      />

      <div className="relative p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#172B4D]">
              <Headset className="h-3.5 w-3.5 text-white" aria-hidden="true" />
            </span>
            <p
              id="support-card-heading"
              className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#172B4D]"
            >
              Bihar Transport Support
            </p>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Available now
          </span>
        </div>

        <div className="mt-4 flex items-center gap-4">
          <Representative photo={profile.photo} name={profile.name} />

          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-bold leading-tight text-[#172B4D] sm:text-lg">
              {profile.name || 'Bihar Transport Customer Care'}
            </p>
            <p className="mt-0.5 text-[13px] font-semibold text-[#F5A623]">{designation}</p>
            <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-slate-500">
              <Clock className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Available {hours}</span>
            </p>
          </div>
        </div>

        {/* Phone number: prominent, and a real tel: link built from the same
            configured digits that drive the WhatsApp button. */}
        {profile.phoneDisplay && (
          <a
            href={callUrl || undefined}
            aria-disabled={!canContact}
            onClick={guardLink(canContact)}
            className="mt-4 flex items-center gap-3 rounded-2xl border border-[#172B4D]/10 bg-[#172B4D]/[0.035] px-4 py-3 transition hover:border-[#172B4D]/25 hover:bg-[#172B4D]/[0.06]"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#172B4D] shadow-sm">
              <Phone className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                Customer care
              </span>
              <span className="block text-[17px] font-bold leading-tight text-[#172B4D]">
                {profile.phoneDisplay}
              </span>
            </span>
          </a>
        )}

        {/* Two actions, same colours, same size. From `lg` the card sits in the
            narrow right-hand column, so the columns stop being equal: WhatsApp
            is sized to its own content and "Call Customer Care" — the longer
            label — takes the remaining width. It is given the room it needs
            instead of being wrapped onto two lines, and the type size is left
            alone at 15px. */}
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)]">
          <a
            href={whatsappUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!canContact}
            onClick={guardLink(canContact)}
            className={`inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-3 text-[15px] font-semibold transition ${
              canContact
                ? 'bg-[#25D366] text-white shadow-[0_8px_20px_-8px_rgba(37,211,102,0.8)] hover:bg-[#1eb85a]'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
            WhatsApp
          </a>

          <a
            href={callUrl || undefined}
            aria-disabled={!canContact}
            onClick={guardLink(canContact)}
            className={`inline-flex min-h-[48px] items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 py-3 text-[15px] font-semibold transition ${
              canContact
                ? 'border-[#172B4D]/20 bg-white text-[#172B4D] hover:border-[#172B4D]/40 hover:bg-[#172B4D]/[0.03]'
                : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
            }`}
          >
            <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
            Call Customer Care
          </a>
        </div>

        {/* Stated once, explicitly. It is a business rule, not a UI nicety. */}
        <p className="mt-4 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#25D366]" aria-hidden="true" />
          <span>
            For your privacy, driver and owner contact details are never shared. All
            coordination happens through Bihar Transport Customer Care.
          </span>
        </p>

        {/* Announced to screen readers: what the two buttons will actually do. */}
        <span role="status" aria-live="polite" className="sr-only">
          {`WhatsApp and call use the Bihar Transport customer-care number ${
            profile.phoneDisplay || ''
          }${enquiryNumber ? ` for request ${enquiryNumber}` : ''}.`}
        </span>
      </div>
    </section>
  );
}

/** Small inline variant for secondary placements (not the hero). */
export function SupportInline({ enquiryNumber, className = '' }) {
  const [care, setCare] = useState(null);

  useEffect(() => {
    let cancelled = false;
    enquiryAPI
      .getCustomerCare(enquiryNumber)
      .then(({ data }) => {
        if (!cancelled) setCare(data?.data || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enquiryNumber]);

  const profile = care || FALLBACK_CUSTOMER_CARE;
  const whatsappUrl = buildWhatsAppUrl(profile, enquiryNumber);
  const callUrl = buildCallUrl(profile);

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Representative photo={profile.photo} name={profile.name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[#172B4D]">{profile.name}</p>
        <p className="truncate text-xs text-slate-500">
          {profile.phoneDisplay || profile.designation}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        {callUrl && (
          <a
            href={callUrl}
            aria-label="Call Bihar Transport customer care"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#172B4D]/15 text-[#172B4D] transition hover:bg-[#172B4D]/5"
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
        {whatsappUrl && (
          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="WhatsApp Bihar Transport customer care"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#25D366] text-white transition hover:bg-[#1eb85a]"
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

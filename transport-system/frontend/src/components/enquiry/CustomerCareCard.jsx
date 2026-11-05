/**
 * CustomerCareCard.jsx
 * ---------------------------------------------------------------------------
 * The customer's only route to a human.
 *
 * WHY THIS COMPONENT IS DELIBERATELY DUMB
 * It renders whatever the backend published in the customer-care profile. It
 * holds no phone number, no name and no photo of its own — those all come from
 * GET /api/enquiries/config/customer-care, which reads config/customerCare.js on
 * the server. Changing the support number is a deployment concern, not a code
 * edit, and there is exactly one place in the UI where a customer-care number
 * can be rendered.
 *
 * PRIVACY
 * The driver is never contacted directly. The two actions here — WhatsApp and
 * call — both point at the fixed Bihar Transport customer-care line, which is
 * what keeps the driver/customer relationship inside the company.
 */

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Phone, Clock, UserCircle2 } from 'lucide-react';
import { enquiryAPI } from '../../services/enquiryAPI';

/** Inline placeholder so the card still looks complete before config loads. */
function CareAvatar({ photo, name }) {
  if (photo) {
    return (
      <img
        src={photo}
        alt={name ? `${name}, Customer Care` : 'Bihar Transport Customer Care'}
        className="h-16 w-16 rounded-full object-cover ring-4 ring-white shadow-md"
        loading="lazy"
      />
    );
  }
  return (
    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#172B4D] ring-4 ring-white shadow-md">
      <UserCircle2 className="h-9 w-9 text-white" aria-hidden="true" />
    </div>
  );
}

/**
 * @param {Object} props
 * @param {string} [props.enquiryNumber] - pre-fills the WhatsApp message
 * @param {'card'|'inline'|'sticky'} [props.variant='card']
 * @param {string} [props.heading='Need help?']
 * @param {string} [props.subheading]
 * @param {string} [props.className]
 */
export default function CustomerCareCard({
  enquiryNumber,
  variant = 'card',
  heading = 'Need help?',
  subheading = 'Our transport specialist is reviewing your request.',
  className = '',
}) {
  const [care, setCare] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await enquiryAPI.getCustomerCare(enquiryNumber);
        if (!cancelled) setCare(data?.data || null);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enquiryNumber]);

  // The backend returns a fully-formed wa.me URL with the enquiry context
  // already encoded, so the frontend never assembles a WhatsApp link itself.
  const whatsappUrl = care?.whatsappUrl || '';
  const callUrl = care?.callUrl || '';
  const canContact = Boolean(care?.isConfigured && (whatsappUrl || callUrl));

  const hours = useMemo(() => (care?.hours ? care.hours : null), [care]);

  if (variant === 'inline') {
    return (
      <div className={`flex flex-wrap items-center gap-3 ${className}`}>
        <CareAvatar photo={care?.photo} name={care?.name} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#172B4D]">
            {care?.name || 'Bihar Transport Customer Care'}
          </p>
          <p className="text-xs text-slate-500">{care?.designation || 'Customer Care Executive'}</p>
        </div>
        <div className="ml-auto flex gap-2">
          {canContact && callUrl && (
            <a
              href={callUrl}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#172B4D]/15 px-3 py-2 text-sm font-medium text-[#172B4D] transition hover:bg-[#172B4D]/5"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              Call
            </a>
          )}
          {canContact && whatsappUrl && (
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] px-3 py-2 text-sm font-semibold text-white transition hover:bg-[#1EBE5A]"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp
            </a>
          )}
        </div>
      </div>
    );
  }

  if (variant === 'sticky') {
    if (!canContact) return null;
    return (
      <div
        className={`sticky bottom-0 z-30 -mx-4 border-t border-[#172B4D]/10 bg-white/95 px-4 py-3 shadow-[0_-4px_16px_rgba(23,43,77,0.08)] backdrop-blur md:hidden ${className}`}
      >
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#25D366] px-4 py-3 text-base font-semibold text-white transition hover:bg-[#1EBE5A]"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          Chat with Customer Care
        </a>
      </div>
    );
  }

  return (
    <section
      className={`overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-gradient-to-br from-white to-[#172B4D]/[0.03] shadow-sm ${className}`}
    >
      <div className="p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A623]">
          Bihar Transport Support
        </p>
        <h2 className="mt-1 text-lg font-bold text-[#172B4D]">{heading}</h2>
        {subheading && <p className="mt-1 text-sm text-slate-600">{subheading}</p>}

        <div className="mt-4 flex items-center gap-3">
          <CareAvatar photo={care?.photo} name={care?.name} />
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-[#172B4D]">
              {care?.name || 'Bihar Transport Customer Care'}
            </p>
            <p className="text-sm text-slate-500">
              {care?.designation || 'Customer Care Executive'}
            </p>
            {hours && (
              <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-slate-400">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {hours}
              </p>
            )}
          </div>
        </div>

        {care?.phoneDisplay && (
          <p className="mt-3 text-sm font-medium text-[#172B4D]">
            📞 {care.phoneDisplay}
          </p>
        )}

        {failed && (
          <p className="mt-3 text-xs text-slate-500">
            Customer care details are temporarily unavailable. Please try again in a moment.
          </p>
        )}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <a
            href={canContact ? whatsappUrl : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!canContact}
            onClick={(e) => {
              if (!canContact) e.preventDefault();
            }}
            className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
              canContact
                ? 'bg-[#25D366] text-white hover:bg-[#1EBE5A]'
                : 'cursor-not-allowed bg-slate-100 text-slate-400'
            }`}
          >
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
            Chat on WhatsApp
          </a>

          <a
            href={canContact ? callUrl : undefined}
            aria-disabled={!canContact}
            onClick={(e) => {
              if (!canContact) e.preventDefault();
            }}
            className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
              canContact
                ? 'border-[#172B4D]/20 text-[#172B4D] hover:bg-[#172B4D]/5'
                : 'cursor-not-allowed border-slate-200 text-slate-400'
            }`}
          >
            <Phone className="h-4 w-4" aria-hidden="true" />
            Call Customer Care
          </a>
        </div>

        {care?.phoneDisplay && (
          <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
            For your privacy, driver contact details are never shared. Bihar Transport
            customer care will coordinate on your behalf.
          </p>
        )}
      </div>
    </section>
  );
}

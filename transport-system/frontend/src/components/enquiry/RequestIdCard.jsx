/**
 * RequestIdCard.jsx
 * ---------------------------------------------------------------------------
 * The customer's request identifier, designed to be read aloud to support and
 * to be copied into a chat.
 *
 * The value is ALWAYS the number returned by the API. Nothing here is a
 * placeholder or a hardcoded sample — a wrong ID on a support screen costs more
 * than a missing one.
 */

import { useEffect, useRef, useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function RequestIdCard({ enquiryNumber, className = '' }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  // Clear the timer if the component unmounts while the "Copied" state is up.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    if (!enquiryNumber) return;

    const text = String(enquiryNumber);

    try {
      // The async Clipboard API is the primary path; it is unavailable on
      // insecure origins (plain http on a LAN IP), which is exactly the local
      // dev case, so the legacy path below is a real requirement, not a
      // compatibility relic.
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    } catch {
      return; // A failed copy must not break the page; the number stays selectable.
    }

    setCopied(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      id="request-id"
      className={`relative overflow-hidden rounded-2xl border border-[#172B4D]/10 bg-[#172B4D] p-4 shadow-[0_16px_40px_-22px_rgba(11,27,51,0.8)] sm:p-5 ${className}`}
    >
      {/* A single restrained wash so the block reads as a premium card rather
          than a flat rectangle of navy. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_100%_at_0%_0%,rgba(245,166,35,0.16),transparent_55%)]"
      />

      <div className="relative">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/55">
            Request ID
          </p>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#F5A623]">
            Quote this to support
          </p>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <p
            className="min-w-0 flex-1 select-all break-all font-mono text-xl font-bold tracking-wider text-white sm:text-[26px] sm:leading-tight"
            title={enquiryNumber || undefined}
          >
            {enquiryNumber || '—'}
          </p>

          <button
            type="button"
            onClick={copy}
            disabled={!enquiryNumber}
            aria-label={copied ? 'Request ID copied' : 'Copy request ID'}
            className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                Copy
              </>
            )}
          </button>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-white/55">
          Quote this ID when contacting Bihar Transport Support.
        </p>

        {/* Announced to screen readers when the copy succeeds. */}
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? 'Request ID copied to clipboard' : ''}
        </span>
      </div>
    </div>
  );
}

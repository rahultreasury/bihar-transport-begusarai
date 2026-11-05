/**
 * EnquiryActivityFeed.jsx
 * ---------------------------------------------------------------------------
 * The real audit trail for one enquiry, rendered from `enquiry.events`.
 *
 * NEVER FABRICATED
 *   Every row is an `EnquiryEvent` the backend actually wrote inside the same
 *   transaction as the state change it describes. There is no synthetic
 *   "quote sent" row: if the quote was never sent, the list simply stops at the
 *   last thing that really happened. The event type is read from `ev.type`
 *   (the admin DTO's key — `backend/dtos/EnquiryDTO.js`, toAdminEnquiry), NOT
 *   from `ev.event_type`, which that DTO does not emit and which is why the
 *   previous version of this panel rendered a blank type on every row.
 *
 *   Internal-only events (customer_visible: false) are marked rather than
 *   hidden — an operator needs to know a note exists even if the customer
 *   never saw it.
 */

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Eye,
  FileText,
  Inbox,
  MessageSquare,
  PlayCircle,
  Send,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { formatTimestamp } from '../../../utils/enquiryFormat';

/**
 * Real event types written by EnquiryService / EnquiryEventService.
 * Anything unrecognised falls through to the humanised type rather than being
 * dropped — a new backend event shows up immediately instead of vanishing.
 */
const EVENT_META = {
  ENQUIRY_CREATED: { icon: Inbox, tone: 'sky' },
  ADMIN_VIEWED: { icon: Eye, tone: 'slate' },
  STATUS_CHANGED: { icon: FileText, tone: 'slate' },
  NOTE_ADDED: { icon: MessageSquare, tone: 'slate' },
  PARTNER_ASSIGNED: { icon: Truck, tone: 'violet' },
  QUOTE_SENT: { icon: Send, tone: 'amber' },
  CUSTOMER_ACCEPTED: { icon: CheckCircle2, tone: 'emerald' },
  CUSTOMER_REJECTED: { icon: XCircle, tone: 'rose' },
  CUSTOMER_CANCELLED: { icon: XCircle, tone: 'rose' },
  BOOKING_CREATED: { icon: CheckCircle2, tone: 'emerald' },
  DRIVER_REASSIGNMENT_REQUESTED: { icon: AlertTriangle, tone: 'amber' },
  DRIVER_ISSUE_REPORTED: { icon: AlertTriangle, tone: 'rose' },
  VEHICLE_ASSIGNED: { icon: Truck, tone: 'violet' },
  DRIVER_ASSIGNED: { icon: UserRound, tone: 'violet' },
  QUOTE_PREPARED: { icon: ClipboardCheck, tone: 'violet' },
};

const TONES = {
  sky: 'border-sky-200 bg-sky-50 text-sky-600',
  violet: 'border-violet-200 bg-violet-50 text-violet-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-600',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  rose: 'border-rose-200 bg-rose-50 text-rose-600',
  slate: 'border-slate-200 bg-slate-50 text-slate-500',
};

/** Turn an event type into a readable heading. */
function titleFor(type) {
  return String(type || 'Update')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * @param {{events: Array}} props
 */
export default function EnquiryActivityFeed({ events = [] }) {
  const [expanded, setExpanded] = useState(false);

  /**
   * Newest first, then collapse CONSECUTIVE duplicates.
   *
   * Every page load writes an ADMIN_VIEWED event, so a busy enquiry accumulates
   * dozens of identical "Admin viewed" rows and the feed becomes useless at the
   * top — exactly where an operator looks first. Collapsing a run into one row
   * with a "×N" badge keeps every event (nothing is hidden or invented, the
   * count is shown) while making the meaningful transitions visible.
   */
  const rows = useMemo(() => {
    const sorted = [...events]
      .filter((ev) => ev && (ev.message || ev.type))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

    return sorted.reduce((acc, ev) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.type === ev.type && prev.message === ev.message) {
        prev.count += 1;
        return acc;
      }
      acc.push({ ...ev, count: 1 });
      return acc;
    }, []);
  }, [events]);

  const visible = expanded ? rows : rows.slice(0, 5);

  return (
    <section className="rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.08em] text-text">
            Activity
          </h2>
          {rows.length > 0 ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-bold text-muted">
              {rows.length}
            </span>
          ) : null}
        </div>
        {rows.length > 5 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="inline-flex shrink-0 items-center gap-1 text-[11.5px] font-semibold text-[#1e3a5f] transition hover:text-amber-600"
          >
            {expanded ? 'Show less' : `Show all ${rows.length}`}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
              strokeWidth={2.5}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </header>

      <div className="p-4">
        {rows.length === 0 ? (
          <p className="py-4 text-center text-[12.5px] text-muted">
            No activity recorded yet.
          </p>
        ) : (
          <ol className="space-y-3.5">
            {visible.map((ev, i) => {
              const meta = EVENT_META[ev.type] || { icon: FileText, tone: 'slate' };
              const Icon = meta.icon;
              const last = i === visible.length - 1;
              return (
                <li key={ev.id ?? `${ev.type}-${i}`} className="flex gap-3">
                  <div className="flex shrink-0 flex-col items-center">
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border ${
                        TONES[meta.tone] || TONES.slate
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
                    </span>
                    {!last ? <span className="mt-1 w-px flex-1 bg-slate-200" aria-hidden="true" /> : null}
                  </div>

                  <div className="min-w-0 flex-1 pb-0.5">
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold leading-snug text-text">
                      {titleFor(ev.type)}
                      {ev.count > 1 ? (
                        <span className="rounded bg-slate-100 px-1.5 py-px text-[10.5px] font-bold text-slate-500">
                          ×{ev.count}
                        </span>
                      ) : null}
                    </p>
                    {ev.message ? (
                      <p className="mt-0.5 text-[12.5px] leading-relaxed text-slate-600">{ev.message}</p>
                    ) : null}
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-slate-400">
                      {ev.created_at ? <span>{formatTimestamp(ev.created_at)}</span> : null}
                      {ev.actor_name ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span>{ev.actor_name}</span>
                        </>
                      ) : ev.actor_type ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="capitalize">{String(ev.actor_type).toLowerCase()}</span>
                        </>
                      ) : null}
                      {!ev.customer_visible ? (
                        <span className="ml-1 rounded bg-slate-100 px-1.5 py-px font-semibold text-slate-500">
                          internal
                        </span>
                      ) : null}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

/**
 * ActivityTimeline.jsx
 * ---------------------------------------------------------------------------
 * The real audit trail for one enquiry.
 *
 * WHERE THE ROWS COME FROM
 *   1. GET /api/admin/bookings/:id/workflow-timeline
 *      → booking_events, the table the backend writes inside the SAME
 *        transaction as every state change. These are real commits with real
 *        timestamps — a row appears only once it has actually been written.
 *   2. `booking.created_at`
 *      The customer submission predates the event log, so it is added as the
 *      first entry from the booking row's own timestamp.
 *
 * NEVER FABRICATED
 *   There is no synthetic "quote sent" row. If the quote has not been sent,
 *   the timeline simply stops at the last thing that really happened. The
 *   `system` audit rows (GET /api/admin/audit-logs/entity/booking/:id) are
 *   still appended when the backend actually has them.
 */

import React, { useMemo } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  ClipboardCheck,
  FileSearch,
  Inbox,
  PlayCircle,
  Send,
  Truck,
  UserRound,
  XCircle,
} from 'lucide-react';
import { EmptyBlock } from './EnquiryUI';
import { fmtDateTime, inr } from './enquiryStatus';

const EVENT_META = {
  enquiry_review_started: { icon: PlayCircle, title: 'Request moved to Under Review', tone: 'sky' },
  quote_prepared: { icon: ClipboardCheck, title: 'Quote prepared', tone: 'violet' },
  quote_sent: { icon: Send, title: 'Quote sent to customer', tone: 'amber' },
  quote_accepted: { icon: CheckCircle2, title: 'Customer accepted the quote', tone: 'emerald' },
  QUOTE_ACCEPTED_BY_CUSTOMER: { icon: CheckCircle2, title: 'Customer accepted the quote', tone: 'emerald' },
  quote_rejected: { icon: XCircle, title: 'Customer rejected the quote', tone: 'rose' },
  booking_confirmed: { icon: BadgeCheck, title: 'Booking confirmed', tone: 'emerald' },
  booking_confirmed_by_admin: { icon: BadgeCheck, title: 'Booking confirmed by admin', tone: 'emerald' },
  booking_status_changed: { icon: FileSearch, title: 'Booking status changed', tone: 'slate' },
  driver_assigned: { icon: UserRound, title: 'Driver assigned', tone: 'violet' },
};

const FALLBACK_META = { icon: FileSearch, title: null, tone: 'slate' };

const TONES = {
  sky: 'border-sky-200 bg-sky-50 text-sky-600',
  violet: 'border-violet-200 bg-violet-50 text-violet-600',
  amber: 'border-amber-200 bg-amber-50 text-amber-600',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-600',
  rose: 'border-rose-200 bg-rose-50 text-rose-600',
  slate: 'border-slate-200 bg-slate-100 text-slate-500',
};

function titleFor(event) {
  const meta = EVENT_META[event.event_type];
  if (meta?.title) return meta.title;
  return String(event.event_type || 'Update')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** One line of context from the event payload — real values only. */
function detailFor(event) {
  const p = event.payload;
  if (!p || typeof p !== 'object') return null;
  const parts = [];
  if (p.final_price != null) parts.push(inr(p.final_price));
  if (p.driver_name) parts.push(`Driver: ${p.driver_name}`);
  else if (p.driver_id) parts.push(`Driver #${p.driver_id}`);
  if (p.vehicle_number) parts.push(`Vehicle: ${p.vehicle_number}`);
  else if (p.vehicle_id) parts.push(`Vehicle #${p.vehicle_id}`);
  if (p.quote_valid_until) parts.push(`Valid until ${fmtDateTime(p.quote_valid_until)}`);
  if (p.remarks) parts.push(p.remarks);
  if (p.to) parts.push(`→ ${String(p.to).replace(/_/g, ' ')}`);
  return parts.length ? parts.join(' · ') : null;
}

export default function ActivityTimeline({ booking, timeline = [], auditLogs = [] }) {
  const events = useMemo(() => {
    const rows = [];

    // The customer's submission predates the event log.
    if (booking?.created_at) {
      rows.push({
        key: 'created',
        at: booking.created_at,
        icon: Inbox,
        tone: 'slate',
        title: 'Request received',
        detail: `Booking ${booking.booking_number || booking.booking_reference || ''}`.trim(),
      });
    }

    (timeline || []).forEach((event) => {
      const meta = EVENT_META[event.event_type] || FALLBACK_META;
      rows.push({
        key: `evt-${event.booking_event_id}`,
        at: event.created_at,
        icon: meta.icon,
        tone: meta.tone,
        title: titleFor(event),
        detail: detailFor(event),
      });
    });

    // Real audit rows, only when the backend has any for this booking.
    (auditLogs || []).forEach((log) => {
      rows.push({
        key: `audit-${log.audit_id}`,
        at: log.created_at,
        icon: FileSearch,
        tone: 'slate',
        title: String(log.action || 'Update').replace(/_/g, ' '),
        detail: log.reason || log.entity_type || null,
      });
    });

    // Newest first — the operator cares about what just happened.
    rows.sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());
    return rows;
  }, [booking, timeline, auditLogs]);

  if (events.length === 0) {
    return (
      <EmptyBlock
        title="No activity recorded yet"
        subtitle="Real transitions appear here the moment the backend commits them."
      />
    );
  }

  return (
    <ol className="space-y-0">
      {events.map((ev, idx) => {
        const Icon = ev.icon;
        const last = idx === events.length - 1;
        return (
          <li key={ev.key} className="relative flex gap-3 pb-4 last:pb-0">
            {!last ? <span className="absolute left-[13px] top-7 bottom-0 w-px bg-border" aria-hidden="true" /> : null}
            <span
              className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                TONES[ev.tone] || TONES.slate
              }`}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                <p className="text-[12.5px] font-semibold text-text">{ev.title}</p>
                <p className="whitespace-nowrap text-[11px] text-muted">{fmtDateTime(ev.at)}</p>
              </div>
              {ev.detail ? <p className="mt-0.5 text-[11.5px] text-muted">{ev.detail}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

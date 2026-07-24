import React, { useMemo } from 'react';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';

const EVENT_ICONS = {
  driver_created: '🚀',
  vehicle_assigned: '🚛',
  vehicle_unassigned: '🚛',
  trip_started: '▶️',
  trip_completed: '✅',
  trip_cancelled: '❌',
  advance_given: '💰',
  payment_recorded: '💵',
  fuel_added: '⛽',
  expense_recorded: '📋',
  status_changed: '🔀'
};

const DEFAULT_ICON = '📌';

function TimelineEvent({ event, index }) {
  const icon = EVENT_ICONS[event.event_type] || DEFAULT_ICON;
  const dateStr = event.created_at
    ? new Date(event.created_at).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';

  return (
    <div className="relative flex items-start gap-4 pb-6 last:pb-0">
      {/* Timeline line */}
      {index > 0 && (
        <div className="absolute left-[17px] top-0 bottom-6 w-0.5 bg-border/60 -translate-x-1/2" aria-hidden="true" />
      )}

      {/* Icon circle */}
      <div className="relative z-10 flex items-center justify-center w-9 h-9 rounded-full border border-border/60 bg-card/40 backdrop-blur-xl shrink-0 text-sm">
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1">
        <div className="text-sm font-medium text-text">{event.description}</div>
        <div className="text-[11px] text-muted mt-0.5">{dateStr}</div>
      </div>
    </div>
  );
}

const DriverTimeline = React.memo(function DriverTimeline({ events = [], loading = false }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4">
            <LoadingSkeleton className="w-9 h-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <LoadingSkeleton className="h-4 w-48" />
              <LoadingSkeleton className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border/70 p-8 text-center">
        <div className="text-2xl mb-2">📋</div>
        <div className="text-sm font-semibold">No activity recorded yet</div>
        <div className="text-xs text-muted mt-1">Timeline events will appear here automatically.</div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {events.map((event, index) => (
        <TimelineEvent key={event.event_id || index} event={event} index={index} />
      ))}
    </div>
  );
});

export default DriverTimeline;


import React from 'react';

const EVENT_META = {
  booking_created: { label: 'Booking Received', icon: '📋' },
  quote_sent: { label: 'Quote Ready', icon: '💬' },
  quote_accepted: { label: 'Quote Accepted', icon: '✅' },
  quote_rejected: { label: 'Quote Rejected', icon: '❌' },
  quote_expired: { label: 'Quote Expired', icon: '⏰' },
  booking_confirmed: { label: 'Booking Confirmed', icon: '✅' },
  booking_status_changed: { label: 'Status Updated', icon: '🔄' },
  driver_assigned: { label: 'Driver Assigned', icon: '👨‍🏭' },
  pickup_completed: { label: 'Pickup Completed', icon: '📦' },
  in_transit: { label: 'In Transit', icon: '🚚' },
  delivered: { label: 'Delivered', icon: '🏁' },
  cancelled: { label: 'Cancelled', icon: '❌' },
  completed: { label: 'Completed', icon: '✅' },
};

const DEFAULT_ICON = '📌';

/**
 * ActivityFeed — Chronological timeline of backend events for the booking.
 *
 * IMPORTANT: This component renders ONLY backend timeline events (from
 * `booking.events` / `booking.bookingEvents`). It does NOT generate events
 * in React. If no events are provided, it renders an empty state.
 *
* @param {{ events?: Array<{event_type?: string, type?: string, label?: string, description?: string, created_at?: string, timestamp?: string}>, status?: string }} props
 */
const ActivityFeed = React.memo(function ActivityFeed({ events: propEvents }) {
  const events = Array.isArray(propEvents) && propEvents.length > 0 ? propEvents : null;

  // Map backend event_payload (JSON string) into a human-readable description.
  const parseDescription = (event) => {
    if (event.description) return event.description;
    if (!event.event_payload) return '';
    try {
      const payload = JSON.parse(event.event_payload);
      if (typeof payload === 'string') return payload;
      if (payload && typeof payload === 'object') {
        const parts = [];
        if (payload.final_price != null) parts.push(`Final price: ₹${Number(payload.final_price).toLocaleString('en-IN')}`);
        if (payload.remarks) parts.push(payload.remarks);
        if (payload.booking_reference) parts.push(payload.booking_reference);
        if (parts.length) return parts.join(' · ');
      }
      return '';
    } catch {
      return '';
    }
  };

  if (!events) {
    return (
      <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 md:p-6">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
          Live Activity
        </h3>
        <p className="text-sm text-gray-400 text-center py-6">
          No activity recorded yet.
        </p>
      </div>
    );
  }

  const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return '';
    }
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    try {
      return new Date(ts).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return '';
    }
  };

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 md:p-6">
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-4">
        Live Activity
      </h3>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-4 top-1 bottom-1 w-0.5 bg-gray-100" />

        <ul className="relative space-y-0" role="list">
{events.map((event, idx) => {
            const type = event.event_type || event.type || '';
            const meta = EVENT_META[type] || {};
            const label = event.label || meta.label || 'Event';
            const description = parseDescription(event);
            const timestamp = event.created_at || event.timestamp;

            return (
              <li key={idx} className="relative flex items-start gap-4 py-3 animate-fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                {/* Icon */}
                <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm border border-amber-100">
                  {meta.icon || DEFAULT_ICON}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">{label}</p>
                    <time className="shrink-0 text-xs text-gray-400 font-medium">
                      {formatTimestamp(timestamp)}
                    </time>
                  </div>
                  {description && (
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{description}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(timestamp)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
});

export default ActivityFeed;

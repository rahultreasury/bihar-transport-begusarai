import React from 'react';

const ACTIVITY_ICONS = {
  booking_created: '📋',
  booking_confirmed: '✅',
  booking_status_changed: '🔄',
  driver_assigned: '👨‍🏭',
  pickup_completed: '📦',
  in_transit: '🚚',
  delivered: '🏁',
  cancelled: '❌',
  completed: '✅',
};

const DEFAULT_ICON = '📌';

/**
 * ActivityFeed — Chronological timeline of events for the booking.
 *
 * NOTE: Backend does not currently expose a public activity/timeline endpoint.
 * This component renders static entries derived from the booking status.
 * When the backend provides a GET /api/bookings/:id/timeline endpoint,
 * replace `events` prop with real data.
 *
 * @param {{ events?: Array<{type: string, label: string, timestamp: string, description?: string}>, status?: string, createdAt?: string, updatedAt?: string }} props
 */
const ActivityFeed = React.memo(function ActivityFeed({
  events: propEvents,
  status,
  createdAt,
  updatedAt,
}) {
  // Build default events from booking data if no events array provided
  const defaultEvents = [];
  if (createdAt) {
    defaultEvents.push({
      type: 'booking_created',
      label: 'Booking Received',
      timestamp: createdAt,
      description: 'Your booking request has been received.',
    });
  }

  if (status && status !== 'pending') {
    defaultEvents.push({
      type: 'booking_confirmed',
      label: 'Booking Verified',
      timestamp: updatedAt || createdAt,
      description: 'Your booking has been verified and confirmed.',
    });
  }

  if (status === 'driver_assigned' || ['pickup_completed', 'in_transit', 'delivered', 'completed'].includes(status)) {
    defaultEvents.push({
      type: 'driver_assigned',
      label: 'Searching Nearby Vehicle',
      timestamp: updatedAt || createdAt,
      description: 'We are looking for available vehicles near you.',
    });
  }

  if (['in_transit', 'delivered', 'completed'].includes(status)) {
    defaultEvents.push({
      type: 'in_transit',
      label: 'Journey Started',
      timestamp: updatedAt || createdAt,
      description: 'Your goods are on the way to the destination.',
    });
  }

  if (status === 'delivered' || status === 'completed') {
    defaultEvents.push({
      type: 'delivered',
      label: 'Delivered',
      timestamp: updatedAt || createdAt,
      description: 'Your goods have been delivered successfully.',
    });
  }

  const events = propEvents && propEvents.length > 0 ? propEvents : defaultEvents;

  if (!events || events.length === 0) {
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
          {events.map((event, idx) => (
            <li key={idx} className="relative flex items-start gap-4 py-3 animate-fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
              {/* Icon */}
              <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-sm border border-amber-100">
                {ACTIVITY_ICONS[event.type] || DEFAULT_ICON}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">
                    {event.label}
                  </p>
                  <time className="shrink-0 text-xs text-gray-400 font-medium">
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
                {event.description && (
                  <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                    {event.description}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  {formatDate(event.timestamp)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});

export default ActivityFeed;


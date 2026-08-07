import React, { useMemo } from 'react';
import { getStatusColor, getStatusLabel } from './StatusBadge';

const TIMELINE_STEPS = [
  { key: 'pending', icon: '📋', label: 'Booking Created' },
  { key: 'confirmed', icon: '✅', label: 'Confirmed' },
  { key: 'driver_assigned', icon: '👤', label: 'Driver Assigned' },
  { key: 'pickup_completed', icon: '📦', label: 'Pickup Completed' },
  { key: 'in_transit', icon: '🚚', label: 'In Transit' },
  { key: 'delivered', icon: '📍', label: 'Delivered' },
  { key: 'completed', icon: '🎉', label: 'Completed' }
];

function getRelativeTime(dateString) {
  if (!dateString) return null;
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function formatDateTime(dateString) {
  if (!dateString) return '';
  return new Date(dateString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const TimelineStep = React.memo(function TimelineStep({ step, isActive, isCompleted, timestamp, isLast }) {
  const statusColor = getStatusColor(isCompleted ? step.key : 'pending');
  const iconBg = isCompleted
    ? 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/20'
    : isActive
      ? 'bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20'
      : 'bg-gray-200 dark:bg-gray-700';

  const iconText = isActive && !isCompleted ? '⏳' : step.icon;

  return (
    <div className="relative flex gap-4 pb-8 last:pb-0">
      {/* Connector Line */}
      {!isLast && (
        <div
          className={`absolute left-[19px] top-10 w-0.5 h-full -translate-x-1/2 rounded-full ${
            isCompleted ? 'bg-green-400 dark:bg-green-500/50' : 'bg-gray-200 dark:bg-gray-700'
          }`}
          aria-hidden="true"
        />
      )}

      {/* Icon Circle */}
      <div className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-sm transition-all duration-500 ${iconBg}`}>
        {isCompleted ? '✓' : iconText}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={`text-sm font-semibold ${isCompleted || isActive ? 'text-text' : 'text-gray-400 dark:text-gray-500'}`}>
            {step.label}
          </span>
          {timestamp && (
            <span className="text-[11px] text-muted shrink-0" title={formatDateTime(timestamp)}>
              {getRelativeTime(timestamp)}
            </span>
          )}
        </div>
        {timestamp && (
          <div className="text-[11px] text-muted mt-0.5">
            {formatDateTime(timestamp)}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * BookingTimeline
 * Professional vertical timeline showing booking status progression.
 * Uses actual timestamp fields from booking data — never fake data.
 */
function BookingTimeline({ booking }) {
  const steps = useMemo(() => {
    if (!booking) return [];

return TIMELINE_STEPS.map((step, idx) => {
      // SINGLE SOURCE OF TRUTH: quote_status === ACCEPTED means the booking is
      // confirmed. If the booking.status string hasn't yet advanced past
      // 'pending' but the quote was accepted, treat it as 'confirmed'.
      const quote = (booking.quote_status || 'PENDING').toUpperCase();
      let statusValue = booking.status;
      if (
        quote === 'ACCEPTED' &&
        !['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'completed', 'cancelled'].includes(statusValue)
      ) {
        statusValue = 'confirmed';
      }
      const statusOrder = TIMELINE_STEPS.findIndex(s => s.key === statusValue);

      // Map status to the appropriate timestamp field
      const timestampFieldMap = {
        pending: booking.created_at,
        confirmed: booking.confirmed_at,
        driver_assigned: booking.driver_assigned_at,
        pickup_completed: booking.pickup_completed_at,
        in_transit: booking.in_transit_at,
        delivered: booking.delivered_at,
        completed: booking.delivered_at || booking.completed_at
      };

      const timestamp = timestampFieldMap[step.key] || null;

      return {
        ...step,
        isCompleted: idx < statusOrder,
        isActive: idx === statusOrder,
        timestamp,
        isLast: idx === TIMELINE_STEPS.length - 1
      };
    });
  }, [booking]);

  if (!booking) {
    return (
      <div className="text-center py-8">
        <div className="text-sm text-muted">No booking data available for timeline.</div>
      </div>
    );
  }

  return (
    <div className="py-4" role="list" aria-label="Booking Timeline">
      {steps.map((step) => (
        <TimelineStep key={step.key} {...step} />
      ))}
    </div>
  );
}

export default BookingTimeline;


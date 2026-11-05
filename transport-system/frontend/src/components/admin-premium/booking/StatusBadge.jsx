import React, { useMemo } from 'react';

const STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400 dark:border-amber-500/25',
    dot: 'bg-amber-500'
  },
  confirmed: {
    label: 'Confirmed',
    className: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25',
    dot: 'bg-blue-500'
  },
  driver_assigned: {
    label: 'Assigned',
    className: 'bg-violet-500/10 text-violet-600 border-violet-500/20 dark:bg-violet-500/15 dark:text-violet-400 dark:border-violet-500/25',
    dot: 'bg-violet-500'
  },
  pickup_completed: {
    label: 'Pickup',
    className: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:bg-sky-500/15 dark:text-sky-400 dark:border-sky-500/25',
    dot: 'bg-sky-500'
  },
  in_transit: {
    label: 'In Transit',
    className: 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20 dark:bg-indigo-500/15 dark:text-indigo-400 dark:border-indigo-500/25',
    dot: 'bg-indigo-500'
  },
  delivered: {
    label: 'Delivered',
    className: 'bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25',
    dot: 'bg-green-500'
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-red-500/10 text-red-600 border-red-500/20 dark:bg-red-500/15 dark:text-red-400 dark:border-red-500/25',
    dot: 'bg-red-500'
  },
  completed: {
    label: 'Completed',
    className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:border-emerald-500/25',
    dot: 'bg-emerald-500'
  }
};

const StatusBadge = React.memo(function StatusBadge({ status, quoteStatus, size = 'md', showDot = true }) {
  // SINGLE SOURCE OF TRUTH: quote_status === ACCEPTED means confirmed. If the
  // status string hasn't advanced past 'pending' but the quote was accepted,
  // show the Confirmed badge (mirrors the backend gate for driver assignment).
  const quote = (quoteStatus || 'PENDING').toUpperCase();
  let effectiveStatus = status;
  if (
    quote === 'ACCEPTED' &&
    !['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'completed', 'cancelled'].includes(status)
  ) {
    effectiveStatus = 'confirmed';
  }
  const config = STATUS_CONFIG[effectiveStatus] || STATUS_CONFIG.pending;

  const sizeClasses = useMemo(() => {
    switch (size) {
      case 'sm': return 'px-2 py-0.5 text-[10px]';
      case 'lg': return 'px-3.5 py-1.5 text-sm';
      default: return 'px-2.5 py-1 text-xs';
    }
  }, [size]);

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium leading-none ${sizeClasses} ${config.className}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showDot && (
        <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      )}
      {config.label}
    </span>
  );
});

/** Get status color class for icons/borders */
export function getStatusColor(status) {
  const colorMap = {
    pending: 'text-amber-500',
    confirmed: 'text-blue-500',
    driver_assigned: 'text-violet-500',
    pickup_completed: 'text-sky-500',
    in_transit: 'text-indigo-500',
    delivered: 'text-green-500',
    cancelled: 'text-red-500',
    completed: 'text-emerald-500'
  };
  return colorMap[status] || 'text-gray-500';
}

/** Get human-readable label */
export function getStatusLabel(status) {
  return STATUS_CONFIG[status]?.label || status || 'Unknown';
}

/** Get all valid booking statuses */
export function getAllStatuses() {
  return Object.keys(STATUS_CONFIG);
}

export default StatusBadge;


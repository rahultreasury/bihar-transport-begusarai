import React, { useMemo } from 'react';

const STATUS_CONFIG = {
  available: {
    label: 'Available',
    className: 'bg-green-500/10 text-green-600 border-green-500/20 dark:bg-green-500/15 dark:text-green-400 dark:border-green-500/25',
    dot: 'bg-green-500'
  },
  on_trip: {
    label: 'On Trip',
    className: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400 dark:border-blue-500/25',
    dot: 'bg-blue-500'
  },
  inactive: {
    label: 'Inactive',
    className: 'bg-gray-500/10 text-gray-600 border-gray-500/20 dark:bg-gray-500/15 dark:text-gray-400 dark:border-gray-500/25',
    dot: 'bg-gray-500'
  }
};

const DriverStatusBadge = React.memo(function DriverStatusBadge({ status, size = 'md', showDot = true }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.inactive;

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
export function getDriverStatusColor(status) {
  const colorMap = {
    available: 'text-green-500',
    on_trip: 'text-blue-500',
    inactive: 'text-gray-500'
  };
  return colorMap[status] || 'text-gray-500';
}

/** Get human-readable label */
export function getDriverStatusLabel(status) {
  return STATUS_CONFIG[status]?.label || status || 'Unknown';
}

/** Get all valid driver statuses */
export function getAllDriverStatuses() {
  return Object.keys(STATUS_CONFIG);
}

export default DriverStatusBadge;


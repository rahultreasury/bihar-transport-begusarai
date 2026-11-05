import React from 'react';

const STATUS_CONFIG = {
  available: {
    label: 'Available',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
    ),
    className: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400',
    dot: 'bg-emerald-500'
  },
  waiting: {
    label: 'Waiting',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    className: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-500/15 dark:text-amber-400',
    dot: 'bg-amber-500'
  },
  on_trip: {
    label: 'On Trip',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    className: 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-500/15 dark:text-blue-400',
    dot: 'bg-blue-500'
  },
  busy: {
    label: 'Busy',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    className: 'bg-orange-500/10 text-orange-600 border-orange-500/20 dark:bg-orange-500/15 dark:text-orange-400',
    dot: 'bg-orange-500'
  },
  inactive: {
    label: 'Inactive',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
      </svg>
    ),
    className: 'bg-gray-500/10 text-gray-600 border-gray-500/20 dark:bg-gray-500/15 dark:text-gray-400',
    dot: 'bg-gray-500'
  },
  offline: {
    label: 'Offline',
    icon: (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0" />
      </svg>
    ),
    className: 'bg-slate-500/10 text-slate-600 border-slate-500/20 dark:bg-slate-500/15 dark:text-slate-400',
    dot: 'bg-slate-500'
  }
};

const DriverStatusBadge = React.memo(function DriverStatusBadge({ status, size = 'md', showDot = true, showIcon = true }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.inactive;

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3.5 py-1.5 text-sm'
  }[size] || 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium leading-none ${sizeClasses} ${config.className}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && config.icon}
      {showDot && !showIcon && (
        <span className={`h-1.5 w-1.5 rounded-full ${config.dot}`} aria-hidden="true" />
      )}
      {config.label}
    </span>
  );
});

export function getDriverStatusColor(status) {
  const colorMap = {
    available: 'text-emerald-500',
    waiting: 'text-amber-500',
    on_trip: 'text-blue-500',
    busy: 'text-orange-500',
    inactive: 'text-gray-500',
    offline: 'text-slate-500'
  };
  return colorMap[status] || 'text-gray-500';
}

export function getDriverStatusLabel(status) {
  return STATUS_CONFIG[status]?.label || status || 'Unknown';
}

export function getAllDriverStatuses() {
  return Object.keys(STATUS_CONFIG);
}

export default DriverStatusBadge;


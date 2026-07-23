import React from 'react';

const STATUS_META = {
  pending: {
    emoji: '📋',
    label: 'Booking Received',
    description: 'Your booking has been received and is awaiting verification.',
    color: 'bg-amber-500',
    textColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  confirmed: {
    emoji: '✅',
    label: 'Booking Confirmed',
    description: 'Your booking has been confirmed. We are searching for a suitable vehicle.',
    color: 'bg-blue-500',
    textColor: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  driver_assigned: {
    emoji: '👨‍🏭',
    label: 'Driver Assigned',
    description: 'A driver has been assigned to your booking. The driver will contact you shortly.',
    color: 'bg-violet-500',
    textColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
  },
  pickup_completed: {
    emoji: '📦',
    label: 'Pickup Completed',
    description: 'Goods have been picked up and are ready for transit.',
    color: 'bg-sky-500',
    textColor: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
  },
  in_transit: {
    emoji: '🚚',
    label: 'In Transit',
    description: 'Your goods are on the move and heading to the destination.',
    color: 'bg-indigo-500',
    textColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
  delivered: {
    emoji: '🏁',
    label: 'Delivered',
    description: 'Your goods have been delivered successfully.',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  cancelled: {
    emoji: '❌',
    label: 'Cancelled',
    description: 'This booking has been cancelled.',
    color: 'bg-red-500',
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
  },
  completed: {
    emoji: '✅',
    label: 'Completed',
    description: 'This booking has been completed successfully.',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
  },
};

/**
 * StatusCard — Large current status indicator with emoji, description, and timestamps.
 * @param {{ status: string, pickupDate?: string, updatedAt?: string }} props
 */
const StatusCard = React.memo(function StatusCard({ status, pickupDate, updatedAt }) {
  const meta = STATUS_META[status] || STATUS_META.pending;

  const formatTime = (dateStr) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        day: 'numeric',
        month: 'short',
      });
    } catch {
      return null;
    }
  };

  return (
    <div className={`rounded-2xl border-2 p-5 md:p-6 transition-all duration-300 ${meta.bgColor} ${meta.borderColor}`}>
      <div className="flex items-start gap-4">
        {/* Large emoji indicator */}
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl ${meta.color} bg-opacity-20 shadow-sm`}
          style={{ background: `${meta.color}20` }}
        >
          <span role="img" aria-label={meta.label}>{meta.emoji}</span>
        </div>

        <div className="flex-1 min-w-0">
          <h3 className={`text-lg md:text-xl font-bold ${meta.textColor}`}>
            {meta.label}
          </h3>
          <p className="text-gray-600 text-sm mt-1 leading-relaxed">
            {meta.description}
          </p>

          <div className="flex flex-wrap items-center gap-4 mt-3 text-xs text-gray-500">
            {pickupDate && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                Pickup: {formatTime(pickupDate) || pickupDate}
              </span>
            )}
            {updatedAt && (
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                Last updated: {formatTime(updatedAt) || updatedAt}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Animated pulse bar */}
      <div className="mt-4 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
        <div
          className={`h-full rounded-full ${meta.color} transition-all duration-1000`}
          style={{
            width: status === 'completed' || status === 'delivered' ? '100%' : '60%',
            animation: status !== 'completed' && status !== 'delivered' && status !== 'cancelled'
              ? 'pulse 2s ease-in-out infinite'
              : 'none',
          }}
        />
      </div>
    </div>
  );
});

export default StatusCard;


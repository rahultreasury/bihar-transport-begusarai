import React from 'react';

const STATUS_META = {
  pending: {
    emoji: '📋',
    label: 'Booking Received',
    description: 'Your booking request has been received. Our logistics team is finding the best transport price for you.',
    color: 'bg-amber-500',
    textColor: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    pulse: true,
  },
  quote_sent: {
    emoji: '💬',
    label: 'Waiting for Your Approval',
    description: 'We have prepared your final quote. Please review the price and accept or reject it to proceed.',
    color: 'bg-orange-500',
    textColor: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    pulse: true,
  },
  confirmed: {
    emoji: '✅',
    label: 'Booking Confirmed',
    description: 'Your transport is confirmed. Driver and vehicle are assigned.',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    pulse: false,
  },
  driver_assigned: {
    emoji: '👨‍🏭',
    label: 'Driver Assigned',
    description: 'A driver has been assigned to your booking. The driver will contact you shortly.',
    color: 'bg-violet-500',
    textColor: 'text-violet-600',
    bgColor: 'bg-violet-50',
    borderColor: 'border-violet-200',
    pulse: false,
  },
  pickup_completed: {
    emoji: '📦',
    label: 'Pickup Completed',
    description: 'Goods have been picked up and are ready for transit.',
    color: 'bg-sky-500',
    textColor: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    pulse: false,
  },
  in_transit: {
    emoji: '🚚',
    label: 'In Transit',
    description: 'Your goods are on the move and heading to the destination.',
    color: 'bg-indigo-500',
    textColor: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    pulse: false,
  },
  delivered: {
    emoji: '🏁',
    label: 'Delivered',
    description: 'Your goods have been delivered successfully.',
    color: 'bg-green-500',
    textColor: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    pulse: false,
  },
  cancelled: {
    emoji: '❌',
    label: 'Cancelled',
    description: 'This booking has been cancelled.',
    color: 'bg-red-500',
    textColor: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    pulse: false,
  },
  completed: {
    emoji: '✅',
    label: 'Completed',
    description: 'This booking has been completed successfully.',
    color: 'bg-emerald-500',
    textColor: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    pulse: false,
  },
};

/**
 * StatusCard — Large current status indicator with emoji, description, and timestamps.
 * Quote-aware: when status is pending, shows "Finding Best Market Price…" helper.
 * @param {{ status: string, quoteStatus?: string, pickupDate?: string, updatedAt?: string }} props
 */
const StatusCard = React.memo(function StatusCard({ status, quoteStatus, pickupDate, updatedAt }) {
  const quote = (quoteStatus || 'PENDING').toUpperCase();
  // SINGLE SOURCE OF TRUTH: once the quote is ACCEPTED the booking is
  // confirmed. If the status string hasn't yet advanced past 'pending' but the
  // quote was accepted, show the Confirmed card (mirrors the header/timeline).
  // Also, when quote is SENT, show the quote_sent status card.
  const effectiveStatus =
    quote === 'ACCEPTED' && !['confirmed', 'driver_assigned', 'pickup_completed', 'in_transit', 'delivered', 'completed', 'cancelled'].includes(status)
      ? 'confirmed'
      : quote === 'SENT'
        ? 'quote_sent'
        : status;
  const meta = STATUS_META[effectiveStatus] || STATUS_META.pending;
  const isWaitingForQuote = quote === 'PENDING' || quote === 'QUOTE_REQUESTED' || quote === 'QUOTE_PREPARING';
  const isWaitingForApproval = quote === 'SENT';

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
        <div
          className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-3xl shadow-sm`}
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

          {/* Finding best price indicator */}
          {isWaitingForQuote && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/70 border border-amber-200 px-3 py-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
              </span>
              <span className="text-xs font-semibold text-amber-700">
                Finding Best Market Price…
              </span>
            </div>
          )}

          {/* Waiting for customer approval indicator */}
          {isWaitingForApproval && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-lg bg-white/70 border border-orange-200 px-3 py-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
              </span>
              <span className="text-xs font-semibold text-orange-700">
                Waiting for Your Approval
              </span>
            </div>
          )}

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
            animation: meta.pulse && status !== 'cancelled' ? 'pulse 2s ease-in-out infinite' : 'none',
          }}
        />
      </div>
    </div>
  );
});

export default StatusCard;

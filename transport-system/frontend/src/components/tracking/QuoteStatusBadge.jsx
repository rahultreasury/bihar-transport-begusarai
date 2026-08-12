import React from 'react';

const QUOTE_META = {
  PENDING: { label: 'Finding Best Price', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  QUOTE_REQUESTED: { label: 'Finding Best Price', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  QUOTE_PREPARING: { label: 'Preparing Quote', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  DRIVER_RESERVED: { label: 'Reserving Driver', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  VEHICLE_RESERVED: { label: 'Reserving Vehicle', dot: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
  SENT: { label: 'Quote Ready', dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  WAITING_CUSTOMER_APPROVAL: { label: 'Awaiting Your Approval', dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  ACCEPTED: { label: 'Quote Accepted', dot: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  REJECTED: { label: 'Quote Rejected', dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200' },
  EXPIRED: { label: 'Quote Expired', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600 border-gray-200' },
};

/**
 * QuoteStatusBadge — Small pill that reflects the current quote_status.
 * @param {{ quoteStatus?: string, size?: 'sm'|'md' }} props
 */
const QuoteStatusBadge = React.memo(function QuoteStatusBadge({ quoteStatus, size = 'md' }) {
  const key = (quoteStatus || 'PENDING').toUpperCase();
  const meta = QUOTE_META[key] || QUOTE_META.PENDING;
  const sizeCls = size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${meta.badge} ${sizeCls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot} ${key === 'SENT' ? 'animate-pulse' : ''}`} />
      {meta.label}
    </span>
  );
});

export default QuoteStatusBadge;

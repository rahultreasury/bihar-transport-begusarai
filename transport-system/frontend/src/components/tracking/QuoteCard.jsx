import React, { useState } from 'react';
import QuoteCountdown from './QuoteCountdown';
import QuoteStatusBadge from './QuoteStatusBadge';

/**
 * QuoteCard — Premium "Final Quote Ready" card.
 * Shows the final transport price, a live expiry countdown, and
 * Accept / Reject actions. Handles loading + error states internally.
 *
 * @param {{
 *   booking: Object,
 *   onAccept: () => Promise<void>,
 *   onReject: () => Promise<void>,
 *   onExpired?: () => void,
 * }} props
 */
const QuoteCard = React.memo(function QuoteCard({
  booking,
  onAccept,
  onReject,
  onExpired,
}) {
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');

const price = booking.final_price != null ? Number(booking.final_price) : null;
  const expiresAt = booking.quote_valid_until;
  // Spec-compliant message: prefer quote_message, fall back to quote_remarks.
  const message = booking.quote_message || booking.quote_remarks || null;
  const sentAt = booking.sent_quote_at || booking.quote_sent_at || null;

  // Driver/vehicle info from the reservation (driver_quote) or booking snapshots.
  const driverQuote = booking.driver_quote || null;
  const driverName = driverQuote?.driver_name || booking.snapshot_driver?.driver_name || null;
  const driverPhone = driverQuote?.driver_phone || booking.snapshot_driver?.phone || null;
  const vehicleNumber = driverQuote?.vehicle_number || booking.vehicle_number || booking.snapshot_driver?.vehicle_number || null;
  const vehicleType = driverQuote?.vehicle_type || booking.vehicle_type || booking.snapshot_driver?.vehicle_type || null;

  const formatSentAt = (ts) => {
    if (!ts) return null;
    try {
      return new Date(ts).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return null;
    }
  };

  const handleAccept = async () => {
    if (accepting || rejecting) return;
    setAccepting(true);
    setError('');
    try {
      await onAccept();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not accept the quote. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  const handleReject = async () => {
    if (accepting || rejecting) return;
    setRejecting(true);
    setError('');
    try {
      await onReject();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Could not reject the quote. Please try again.');
    } finally {
      setRejecting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-white">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="text-sm font-bold uppercase tracking-wider">Final Quote Ready</span>
        </div>
        <QuoteStatusBadge quoteStatus="SENT" size="sm" />
      </div>

      <div className="p-5 md:p-6 space-y-5">
        {/* Price */}
        <div>
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
            Final Transport Price
          </p>
          <p className="text-3xl md:text-4xl font-extrabold text-gray-900 tracking-tight">
            {price != null ? `₹${price.toLocaleString('en-IN')}` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            This is the final price for your transport. Please review before accepting.
          </p>
        </div>

        {/* Countdown */}
        <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
          <span className="text-sm font-semibold text-gray-700">Quote expires in</span>
          <QuoteCountdown
            expiresAt={expiresAt}
            onExpire={onExpired}
            size="lg"
          />
        </div>

{/* Quote message */}
        {message && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs text-amber-700 leading-relaxed">{message}</p>
          </div>
        )}

        {/* Driver & Vehicle info (from reservation) */}
        {(driverName || vehicleNumber) && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3 space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {driverName && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Driver</div>
                  <div className="text-sm font-bold text-gray-900">{driverName}</div>
                  {driverPhone && (
                    <div className="text-xs text-gray-500">{driverPhone}</div>
                  )}
                </div>
              )}
              {vehicleNumber && (
                <div>
                  <div className="text-[10px] text-gray-400 uppercase tracking-wider">Vehicle</div>
                  <div className="text-sm font-bold text-gray-900 font-mono">{vehicleNumber}</div>
                  {vehicleType && (
                    <div className="text-xs text-gray-500 capitalize">{String(vehicleType).replace(/_/g, ' ')}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quote sent timestamp */}
        {sentAt && (
          <p className="text-xs text-gray-400 text-center">
            Final quote sent on {formatSentAt(sentAt)}
          </p>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={handleAccept}
            disabled={accepting || rejecting}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
          >
            {accepting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Confirming...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Accept Quote
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={accepting || rejecting}
            className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rejecting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Rejecting...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                Reject Quote
              </>
            )}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          By accepting, your booking will be confirmed and driver &amp; vehicle will be assigned.
        </p>
      </div>
    </div>
  );
});

export default QuoteCard;

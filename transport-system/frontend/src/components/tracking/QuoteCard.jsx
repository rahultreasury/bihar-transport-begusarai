import React, { useState } from 'react';
import QuoteCountdown from './QuoteCountdown';
import QuoteStatusBadge from './QuoteStatusBadge';

/**
 * QuoteCard — Premium "Final Quote Ready" card.
 * Shows the final transport price, a live expiry countdown, and
 * Accept / Reject actions with confirmation dialogs. Handles loading + error states internally.
 *
 * @param {{
 *   booking: Object,
 *   onAccept: () => Promise<void>,
 *   onReject: () => Promise<void>,
 *   onExpired?: () => void,
 *   isEdgeCase?: boolean,
 * }} props
 */
const QuoteCard = React.memo(function QuoteCard({
  booking,
  onAccept,
  onReject,
  onExpired,
  isEdgeCase = false,
}) {
  const [accepting, setAccepting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState('');
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [showRejectConfirm, setShowRejectConfirm] = useState(false);

  const price = booking.final_price != null ? Number(booking.final_price) : null;
  const expiresAt = booking.quote_valid_until;
  // Spec-compliant message: prefer quote_message, fall back to quote_remarks.
  const message = booking.quote_message || booking.quote_remarks || null;
  const sentAt = booking.sent_quote_at || booking.quote_sent_at || null;

  // DEBUG: confirm the card mounted and show key props
  console.log('[QUOTE CARD MOUNTED]', {
    bookingId: booking?.booking_id,
    quoteStatus: booking?.quote_status,
    status: booking?.status,
    finalPrice: booking?.final_price,
    isEdgeCase,
  });

  // Driver reservation info from the backend (driver_quote is populated when
  // an active reservation exists). We only show a generic "reserved" message
  // to avoid exposing personal driver details before acceptance.
  const hasDriverReservation = !!booking.driver_quote;

  // Vehicle type is a non-sensitive, pre-booking attribute (the type of truck
  // the customer originally requested). It is NOT the reserved vehicle number,
  // so it is safe to show before the customer accepts the quote.
  const vehicleType =
    booking.vehicle_type_required ||
    booking.vehicle_type ||
    null;

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

  const handleAcceptClick = () => {
    if (accepting || rejecting) return;
    setShowAcceptConfirm(true);
    setError('');
  };

  const handleAcceptConfirm = async () => {
    setShowAcceptConfirm(false);
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

  const handleRejectClick = () => {
    if (accepting || rejecting) return;
    setShowRejectConfirm(true);
    setError('');
  };

  const handleRejectConfirm = async () => {
    setShowRejectConfirm(false);
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
          <span className="text-sm font-bold uppercase tracking-wider">
            {isEdgeCase ? 'Final Quote Ready' : 'Final Quote Ready'}
          </span>
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

        {/* Driver reservation notice — generic, no personal details */}
        {hasDriverReservation && (
          <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <p className="text-xs font-semibold text-blue-800">
                Driver reserved for your booking.
              </p>
            </div>
          </div>
        )}

        {/* Quote message */}
        {message && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
            <p className="text-xs text-amber-700 leading-relaxed">{message}</p>
          </div>
        )}

        {/* Vehicle type (non-sensitive pre-booking attribute) */}
        {vehicleType && (
          <div className="flex items-center justify-between rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-700">Vehicle Type</span>
            <span className="text-sm font-bold text-gray-900 capitalize">
              {String(vehicleType).replace(/_/g, ' ')}
            </span>
          </div>
        )}

        {/* What happens after accepting the quote */}
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3.5">
          <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-2">
            After accepting this quotation you will receive
          </p>
          <ul className="space-y-1.5">
            {[
              'Driver details',
              'Driver contact number',
              'Vehicle number',
              'Pickup confirmation',
            ].map((item) => (
              <li key={item} className="flex items-center gap-2 text-sm text-emerald-900">
                <svg className="h-4 w-4 text-emerald-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>

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
            onClick={handleAcceptClick}
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
            onClick={handleRejectClick}
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
          By accepting, your booking will be confirmed and driver & vehicle will be assigned.
        </p>
      </div>

      {/* Accept Confirmation Modal */}
      {showAcceptConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowAcceptConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Confirm Your Booking</h3>
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">Final Transport Price</p>
                <p className="text-2xl font-extrabold text-gray-900">
                  {price != null ? `₹${price.toLocaleString('en-IN')}` : '—'}
                </p>
              </div>
              <p className="text-sm text-gray-600">
                By accepting this quote, you confirm your transport booking. The reserved driver and vehicle will be confirmed for your shipment.
              </p>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowAcceptConfirm(false)}
                disabled={accepting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAcceptConfirm}
                disabled={accepting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600 transition disabled:opacity-50 shadow-lg shadow-emerald-500/20"
              >
                {accepting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Confirming...
                  </span>
                ) : (
                  'Accept & Confirm'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject Confirmation Modal */}
      {showRejectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowRejectConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="h-5 w-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">Reject This Quote?</h3>
            </div>

            <p className="text-sm text-gray-600">
              Are you sure you want to reject this transport quote? The reserved driver and vehicle will be released.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowRejectConfirm(false)}
                disabled={rejecting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50"
              >
                Keep Quote
              </button>
              <button
                type="button"
                onClick={handleRejectConfirm}
                disabled={rejecting}
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 text-white font-semibold text-sm hover:bg-red-600 transition disabled:opacity-50 shadow-lg shadow-red-500/20"
              >
                {rejecting ? (
                  <span className="inline-flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Rejecting...
                  </span>
                ) : (
                  'Reject Quote'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default QuoteCard;

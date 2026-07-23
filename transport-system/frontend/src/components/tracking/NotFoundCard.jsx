import React from 'react';

/**
 * NotFoundCard — Beautiful empty state shown when booking reference is not found.
 * @param {{ bookingRef?: string, onRetry?: () => void }} props
 */
const NotFoundCard = React.memo(function NotFoundCard({ bookingRef, onRetry }) {
  return (
    <div className="max-w-md mx-auto text-center py-12 md:py-20">
      {/* Illustration */}
      <div className="mb-6 flex justify-center">
        <div className="relative">
          <svg className="w-32 h-32 md:w-40 md:h-40" viewBox="0 0 160 160" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Search circle */}
            <circle cx="70" cy="70" r="40" stroke="#E5E7EB" strokeWidth="4" fill="#F9FAFB" />
            <circle cx="70" cy="70" r="15" stroke="#D1D5DB" strokeWidth="3" fill="none" strokeDasharray="4 4" />
            {/* Search handle */}
            <line x1="98" y1="98" x2="118" y2="118" stroke="#D1D5DB" strokeWidth="4" strokeLinecap="round" />
            {/* Question mark */}
            <text x="70" y="76" textAnchor="middle" fill="#9CA3AF" fontSize="28" fontWeight="bold" fontFamily="system-ui">?</text>
            {/* Small dots */}
            <circle cx="30" cy="40" r="3" fill="#E5E7EB" />
            <circle cx="120" cy="30" r="2" fill="#E5E7EB" />
            <circle cx="130" cy="100" r="2.5" fill="#E5E7EB" />
            <circle cx="20" cy="110" r="2" fill="#E5E7EB" />
          </svg>
        </div>
      </div>

      {/* Heading */}
      <h2 className="text-xl md:text-2xl font-bold text-gray-900 mb-2">
        Booking Not Found
      </h2>

      {/* Description */}
      <p className="text-sm md:text-base text-gray-500 mb-2 leading-relaxed">
        We couldn&apos;t find a booking with the reference you provided.
      </p>
      {bookingRef && (
        <p className="text-xs text-gray-400 font-mono bg-gray-50 rounded-lg px-3 py-1.5 inline-block mb-4">
          {bookingRef}
        </p>
      )}

      <p className="text-sm text-gray-400 mb-6">
        Please verify your booking reference and try again. If you need assistance, contact our support team.
      </p>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors shadow-sm cursor-pointer"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Try Again
          </button>
        )}
        <a
          href="/track"
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          New Search
        </a>
      </div>
    </div>
  );
});

export default NotFoundCard;


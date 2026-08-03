import React from 'react';

const TIMELINE_STEPS = [
  { key: 'booking_received', label: 'Booking Received' },
  { key: 'finding_price', label: 'Finding Best Price' },
  { key: 'waiting_approval', label: 'Waiting for Your Approval' },
  { key: 'confirmed', label: 'Booking Confirmation' },
  { key: 'pickup', label: 'Pickup' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'delivered', label: 'Delivered' },
];

/**
 * Map a booking status + quote_status to a timeline index.
 * The timeline is DRIVEN BY BACKEND STATE — we only map it here.
 *
 * @param {string} status
 * @param {string} quoteStatus
 */
function getCurrentIndex(status, quoteStatus) {
  const q = (quoteStatus || 'PENDING').toUpperCase();

  if (['delivered', 'completed'].includes(status)) return 6;
  if (status === 'in_transit') return 5;
  if (status === 'pickup_completed') return 4;
  if (status === 'driver_assigned' || status === 'confirmed' || q === 'ACCEPTED') return 3;
  if (q === 'REJECTED' || q === 'EXPIRED') return 0;
  if (q === 'SENT') return 2;
  if (q === 'DRIVER_RESERVED' || q === 'VEHICLE_RESERVED' || q === 'QUOTE_PREPARING' || q === 'QUOTE_REQUESTED') return 1;
  return 0; // PENDING
}

/**
 * ProgressTimeline — Vertical timeline showing booking progress.
 * The timeline steps reflect the enterprise quote→approval→confirmation lifecycle.
 * @param {{ status: string, quoteStatus?: string, className?: string }} props
 */
const ProgressTimeline = React.memo(function ProgressTimeline({ status, quoteStatus, className = '' }) {
  const currentIndex = getCurrentIndex(status, quoteStatus);
  const q = (quoteStatus || 'PENDING').toUpperCase();

  // Waiting for approval is "current" while SENT (quote waiting for customer action)
  const isAwaitingApproval = q === 'SENT';

  return (
    <div className={`rounded-2xl bg-white border border-gray-100 shadow-sm p-5 md:p-6 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider mb-6">
        Progress Timeline
      </h3>

      <div className="relative">
        {/* Vertical connecting line */}
        <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200" />

        {/* Animated progress line */}
        <div
          className="absolute left-4 top-2 w-0.5 bg-amber-500 transition-all duration-700 ease-out"
          style={{
            height: `${((currentIndex + 1) / TIMELINE_STEPS.length) * 100}%`,
            maxHeight: currentIndex >= 0 ? `${((currentIndex + 1) / TIMELINE_STEPS.length) * 100}%` : '0%',
          }}
        />

        <ul className="relative space-y-1" role="list">
          {TIMELINE_STEPS.map((step, idx) => {
            const isCompleted = idx < currentIndex;
            const isCurrent = idx === currentIndex;
            const isPending = idx > currentIndex;

            // Customise "Waiting for Your Approval" step when quote is sent
            const isApprovalStep = step.key === 'waiting_approval';

            return (
              <li key={`${step.key}-${idx}`} className="relative flex items-start gap-4 py-2">
                {/* Status dot */}
                <div className="relative z-10 flex shrink-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                      isCompleted
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : isCurrent
                        ? 'border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-200'
                        : 'border-gray-300 bg-white text-gray-400'
                    }`}
                  >
                    {isCompleted ? (
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isCurrent ? (
                      isApprovalStep && isAwaitingApproval ? (
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ) : (
                        <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
                      )
                    ) : (
                      <span className="h-2 w-2 rounded-full bg-gray-300" />
                    )}
                  </div>
                </div>

                {/* Step label */}
                <div className="flex-1 min-w-0 pt-1">
                  <p
                    className={`text-sm font-medium transition-colors duration-300 ${
                      isCompleted
                        ? 'text-emerald-700'
                        : isCurrent
                        ? 'text-amber-700 font-semibold'
                        : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </p>
                  {isCurrent && (
                    <p className="text-xs text-amber-600 mt-0.5 font-medium">
                      {isApprovalStep && isAwaitingApproval
                        ? 'Please review the final quote'
                        : step.key === 'finding_price'
                        ? 'Our team is comparing market rates…'
                        : 'In progress'}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
});

export default ProgressTimeline;

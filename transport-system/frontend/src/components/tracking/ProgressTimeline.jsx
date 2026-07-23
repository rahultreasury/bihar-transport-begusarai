import React from 'react';

const TIMELINE_STEPS = [
  { key: 'pending', label: 'Booking Received', icon: '📋' },
  { key: 'confirmed', label: 'Order Verified', icon: '✅' },
  { key: 'driver_assigned', label: 'Vehicle Searching', icon: '🔍' },
  { key: 'driver_assigned', label: 'Driver Assigned', icon: '👨‍🏭', depends: true },
  { key: 'pickup_completed', label: 'Vehicle Dispatched', icon: '🚀' },
  { key: 'pickup_completed', label: 'Driver Arrived', icon: '📍', depends: true },
  { key: 'pickup_completed', label: 'Loading Started', icon: '📦', depends: true },
  { key: 'in_transit', label: 'Journey Started', icon: '🚚' },
  { key: 'delivered', label: 'Delivered', icon: '🏁' },
];

const STATUS_ORDER = [
  'pending',
  'confirmed',
  'driver_assigned',
  'pickup_completed',
  'in_transit',
  'delivered',
  'completed',
];

const STATUS_ICONS = {
  pending: '📋',
  confirmed: '✅',
  driver_assigned: '👨‍🏭',
  pickup_completed: '📦',
  in_transit: '🚚',
  delivered: '🏁',
  completed: '✅',
  cancelled: '❌',
};

/**
 * ProgressTimeline — Vertical or horizontal timeline showing booking progress.
 * @param {{ status: string, className?: string }} props
 */
const ProgressTimeline = React.memo(function ProgressTimeline({ status, className = '' }) {
  const currentIndex = STATUS_ORDER.indexOf(status);

  const steps = [
    { key: 'pending', label: 'Booking Received' },
    { key: 'confirmed', label: 'Order Verified' },
    { key: 'driver_assigned', label: 'Vehicle Searching' },
    { key: 'driver_assigned', label: 'Driver Assigned' },
    { key: 'pickup_completed', label: 'Pickup Completed' },
    { key: 'in_transit', label: 'Journey Started' },
    { key: 'delivered', label: 'Delivered' },
  ];

  // Adjust step mapping based on status order
  const getStepStatus = (stepKey, stepIndex) => {
    // For driver_assigned, if current status is >= driver_assigned, mark as completed
    // If current status is exactly driver_assigned and it's "Vehicle Searching", it's current
    // "Driver Assigned" comes after

    const stepOrder = STATUS_ORDER.indexOf(stepKey);
    if (stepOrder < currentIndex) return 'completed';
    if (stepOrder === currentIndex) {
      // Vehicle Searching (first driver_assigned step) is current when status is driver_assigned
      // Driver Assigned (second) is also current when status is driver_assigned
      return 'current';
    }
    return 'pending';
  };

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
            height: `${(currentIndex + 1) / steps.length * 100}%`,
            maxHeight: currentIndex >= 0 ? `${(currentIndex + 1) / steps.length * 100}%` : '0%',
          }}
        />

        <ul className="relative space-y-1" role="list">
          {steps.map((step, idx) => {
            const stepOrder = STATUS_ORDER.indexOf(step.key);
            const isCompleted = stepOrder < currentIndex;
            const isCurrent = stepOrder === currentIndex;
            const isPending = stepOrder > currentIndex;

            return (
              <li key={`${step.key}-${idx}`} className="relative flex items-start gap-4 py-2">
                {/* Status dot */}
                <div className="relative z-10 flex shrink-0">
                  <div
                    className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-all duration-300 ${
                      isCompleted
                        ? 'border-green-500 bg-green-500 text-white'
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
                      <span className="h-2.5 w-2.5 rounded-full bg-white animate-pulse" />
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
                        ? 'text-green-700'
                        : isCurrent
                        ? 'text-amber-700 font-semibold'
                        : 'text-gray-400'
                    }`}
                  >
                    {step.label}
                  </p>
                  {isCurrent && (
                    <p className="text-xs text-amber-600 mt-0.5 font-medium">
                      {status === 'driver_assigned' && step.label === 'Vehicle Searching'
                        ? 'Searching nearby vehicles...'
                        : status === 'driver_assigned' && step.label === 'Driver Assigned'
                        ? 'Driver assigned ✓'
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


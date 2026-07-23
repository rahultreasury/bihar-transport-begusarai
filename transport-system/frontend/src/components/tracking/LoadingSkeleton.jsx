import React from 'react';

/**
 * SkeletonBlock — A single skeleton loading block.
 */
const SkeletonBlock = React.memo(function SkeletonBlock({ className = '' }) {
  return (
    <div
      className={`rounded-xl bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%] animate-pulse ${className}`}
      style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
    />
  );
});

/**
 * LoadingSkeleton — Full dashboard skeleton with no layout shift.
 * Matches the exact structure of the tracking dashboard.
 */
const LoadingSkeleton = React.memo(function LoadingSkeleton() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Booking Header Skeleton */}
      <div className="rounded-2xl bg-gradient-to-br from-amber-100 to-amber-50 p-5 md:p-7">
        <SkeletonBlock className="h-5 w-36 mb-4" />
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-7 w-48" />
            <SkeletonBlock className="h-4 w-32" />
          </div>
          <SkeletonBlock className="h-4 w-28" />
        </div>
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl bg-white/50 p-3 space-y-2">
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>

      {/* Status Card Skeleton */}
      <div className="rounded-2xl border-2 border-gray-100 bg-gray-50 p-5 md:p-6">
        <div className="flex items-start gap-4">
          <SkeletonBlock className="h-16 w-16 rounded-2xl shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBlock className="h-6 w-44" />
            <SkeletonBlock className="h-4 w-full max-w-md" />
            <SkeletonBlock className="h-3 w-32 mt-2" />
          </div>
        </div>
        <SkeletonBlock className="h-1.5 w-full mt-4 rounded-full" />
      </div>

      {/* Two column layout skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Progress Timeline Skeleton */}
        <div className="rounded-2xl bg-white border border-gray-100 p-5 md:p-6 space-y-4">
          <SkeletonBlock className="h-4 w-36" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-start gap-4">
              <SkeletonBlock className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1 pt-1">
                <SkeletonBlock className="h-4 w-32" />
              </div>
            </div>
          ))}
        </div>

        {/* Activity Feed Skeleton */}
        <div className="rounded-2xl bg-white border border-gray-100 p-5 md:p-6 space-y-4">
          <SkeletonBlock className="h-4 w-28" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-4">
              <SkeletonBlock className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1 pt-1">
                <SkeletonBlock className="h-4 w-36" />
                <SkeletonBlock className="h-3 w-full max-w-xs" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Booking Details Skeleton */}
      <div className="rounded-2xl bg-white border border-gray-100 p-5 md:p-6 space-y-3">
        <SkeletonBlock className="h-4 w-28 mb-4" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 py-2">
            <SkeletonBlock className="h-3 w-24" />
            <SkeletonBlock className="h-4 w-40" />
          </div>
        ))}
      </div>

      {/* Support Card Skeleton */}
      <div className="rounded-2xl bg-gradient-to-br from-gray-50 to-gray-100 border border-gray-200 p-5 md:p-6 space-y-3">
        <SkeletonBlock className="h-4 w-20 mb-2" />
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl bg-white p-4 border border-gray-100">
            <SkeletonBlock className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-1">
              <SkeletonBlock className="h-4 w-36" />
              <SkeletonBlock className="h-3 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default LoadingSkeleton;


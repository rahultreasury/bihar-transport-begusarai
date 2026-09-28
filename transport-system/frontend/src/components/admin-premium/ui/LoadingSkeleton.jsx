/**
 * LoadingSkeleton.jsx
 * ---------------------------------------------------------------------------
 * The console's loading primitive. A slow, single-pass shimmer — the console
 * should feel fast and operational, so loading states stay quiet rather than
 * animated or decorative.
 *
 * `LoadingSkeleton` is the primitive and keeps its original single-prop API
 * (used by 20+ pages). The named exports below compose it into the shapes
 * sections actually need.
 */

export function LoadingSkeleton({ className = '' }) {
  return <div className={`bt-skeleton rounded-xl ${className}`} aria-hidden="true" />;
}

/** A block of shimmering text lines — good for a paragraph or a detail panel. */
export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }).map((_, i) => (
        <LoadingSkeleton
          key={i}
          className="h-3.5"
          // Ragged widths read as text rather than as stacked bars.
        />
      ))}
    </div>
  );
}

/** A row of stat tiles that mirrors KpiCard's footprint. */
export function SkeletonKpis({ count = 4, className = '' }) {
  return (
    <div className={`grid grid-cols-2 gap-4 lg:grid-cols-4 ${className}`} role="status" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bt-card p-5">
          <LoadingSkeleton className="h-2.5 w-24" />
          <LoadingSkeleton className="mt-3 h-7 w-16" />
          <LoadingSkeleton className="mt-2 h-2.5 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Table-shaped placeholder: heading row plus body rows. */
export function SkeletonTable({ rows = 6, className = '' }) {
  return (
    <div className={`bt-table-wrap p-5 ${className}`} role="status" aria-busy="true" aria-label="Loading records">
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <LoadingSkeleton className="h-3.5 flex-1" />
            <LoadingSkeleton className="h-3.5 w-24" />
            <LoadingSkeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default LoadingSkeleton;

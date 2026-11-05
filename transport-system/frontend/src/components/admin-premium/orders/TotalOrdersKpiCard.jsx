import React from 'react';
import { ChevronRight } from 'lucide-react';
import { inr } from '../../../utils/orderFormat';

/**
 * TotalOrdersKpiCard — Premium, dedicated KPI card for "Total Orders".
 *
 * This component is intentionally NOT a generic replacement for PremiumKpiCard.
 * It exists solely to give the Total Orders metric a refined, enterprise-grade
 * presentation while the other seven summary cards continue using the shared
 * PremiumKpiCard. No shared styles are modified.
 *
 * Design intent (per Card 1 spec):
 *   • White premium surface, hairline border, subtle shadow
 *   • Compact navy icon chip (no oversized watermark)
 *   • Clear typographic hierarchy: title → description → large metric → helper
 *   • Sophisticated navy/blue accent (top hairline + icon chip)
 *   • Full-card click target with accessible hover/focus states
 *   • Preserves existing grid dimensions (compact 152px row height)
 */
export function TotalOrdersKpiCard({
  // Core props (supplied by AdminOrders)
  value,
  // Interaction
  onClick,
  // State
  loading = false,
  error = false,
  // Accessibility
  ariaLabel = 'View all orders',
}) {
  // Format value without clipping or rounding real data
  const displayValue = (value ?? 0).toLocaleString('en-IN');

  const disabled = false; // Total Orders is always enabled
  const isInteractive = onClick && !disabled && !loading && !error;

  // Base card classes — match compact grid dimensions exactly
  const baseClasses = `
    group relative flex h-full min-h-[152px] flex-col overflow-hidden
    rounded-[12px] border border-slate-200/80 bg-white
    px-4 py-3.5 text-left
    transition-all duration-200 ease-out
    shadow-[0_1px_2px_rgba(15,23,42,0.04)]
    before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:rounded-t-[12px] before:bg-[#15345B]
    ${isInteractive ? 'cursor-pointer hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_8px_24px_-16px_rgba(21,52,91,0.18)]' : 'cursor-default'}
    ${loading ? 'pointer-events-none' : ''}
  `;

  const focusClasses = `
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15345B]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white
  `;

  const motionClasses = 'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:shadow-none';

  const cardClasses = `${baseClasses} ${focusClasses} ${motionClasses}`;

  const handleClick = (e) => {
    if (disabled || loading || error) return;
    if (onClick) {
      e.preventDefault();
      onClick();
    }
  };

  const handleKeyDown = (e) => {
    if (disabled || loading || error) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (onClick) onClick();
    }
  };

  // Render as button when interactive for proper semantics
  if (isInteractive) {
    return (
      <button
        type="button"
        className={cardClasses}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        aria-busy={loading}
      >
        <div className="relative flex h-full flex-col">
          {/* ── Header: icon chip + title/description ────────────────────── */}
          <div className="flex items-start gap-3">
            {/* Compact navy icon chip — replaces oversized watermark */}
            <span
              className="flex shrink-0 items-center justify-center h-10 w-10 rounded-xl bg-[#15345B]/[0.06] text-[#15345B]"
              aria-hidden="true"
            >
              <svg
                className="h-5 w-5"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[14px] font-bold leading-[1.3] tracking-[-0.01em] text-slate-900 truncate">
                Total Orders
              </p>
              <p className="mt-0.5 text-[11px] font-medium leading-[1.4] text-slate-500 truncate">
                All shipment orders
              </p>
            </div>
          </div>

          {/* ── Metric + chevron ────────────────────────────────────────── */}
          <div className="relative mt-auto flex items-end justify-between gap-2 pt-2">
            {loading ? (
              <div className="h-10 w-28 animate-pulse rounded bg-slate-100" aria-hidden="true" />
            ) : error ? (
              <span className="text-lg font-semibold text-amber-600">Error</span>
            ) : (
              <>
                <p
                  title={displayValue}
                  className="text-[32px] leading-none font-bold tabular-nums tracking-[-0.03em] whitespace-nowrap text-[#15345B]"
                >
                  {displayValue}
                </p>

                {/* Subtle click affordance */}
                <span
                  className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition-transform duration-200 group-hover:translate-x-0.5 group-focus-visible:translate-x-0.5"
                  aria-hidden="true"
                >
                  <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
                </span>
              </>
            )}

            {/* ── Subtle bottom helper text ─────────────────────────────── */}
            <p className="absolute left-4 right-4 bottom-2.5 text-[10.5px] font-medium text-slate-400 text-right opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200">
              Click to view listing
            </p>
          </div>
        </div>
      </button>
    );
  }

  // Non-interactive fallback (should not occur for Total Orders, but safe)
  return (
    <div
      className={`${baseClasses} ${disabled ? 'opacity-60' : ''}`}
      aria-label={ariaLabel}
      aria-busy={loading}
    >
      <div className="relative flex h-full flex-col">
        <div className="flex items-start gap-3">
          <span
            className="flex shrink-0 items-center justify-center h-10 w-10 rounded-xl bg-[#15345B]/[0.06] text-[#15345B]"
            aria-hidden="true"
          >
            <svg
              className="h-5 w-5"
              strokeWidth={1.8}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
              />
            </svg>
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[14px] font-bold leading-[1.3] tracking-[-0.01em] text-slate-900 truncate">
              Total Orders
            </p>
            <p className="mt-0.5 text-[11px] font-medium leading-[1.4] text-slate-500 truncate">
              All shipment orders
            </p>
          </div>
        </div>

        <div className="relative mt-auto flex items-end justify-between gap-2 pt-2">
          {loading ? (
            <div className="h-10 w-28 animate-pulse rounded bg-slate-100" aria-hidden="true" />
          ) : error ? (
            <span className="text-lg font-semibold text-amber-600">Error</span>
          ) : (
            <p
              title={displayValue}
              className="text-[32px] leading-none font-bold tabular-nums tracking-[-0.03em] whitespace-nowrap text-[#15345B]"
            >
              {displayValue}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default TotalOrdersKpiCard;
import React from 'react';
import { ChevronRight } from 'lucide-react';
import { inr } from '../../../utils/orderFormat';

/**
 * PremiumKpiCard - premium enterprise KPI card for logistics dashboards.
 *
 * The default presentation is unchanged for existing callers. Pass
 * `compact` for dense operational dashboards (Order / Trip Master), where two
 * rows of four cards must leave room for the order table.
 *
 * Every value is supplied by the caller. This component never invents,
 * truncates, or recalculates a metric.
 */
export function PremiumKpiCard({
  // Core props
  label,
  subtitle = '',
  value,
  icon: Icon,
  tone = 'blue',
  isMoney = false,
  // Presentation
  compact = false,
  // Interaction props
  onClick,
  disabled = false,
  // State props
  loading = false,
  error = false,
  hasData = true,
  // Navigation props
  href,
  // Accessibility
  ariaLabel,
  // Custom styling
  className = '',
  // Custom value formatter
  formatValue,
}) {
  // Tone-based styling matching the Bihar Transport brand. Colour is used on
  // the icon, the hairline top accent and the affordance — never as a loud card
  // wash. Outstanding money is the one intentionally warmer value.
  const TONE_STYLES = {
    blue: {
      icon: 'bg-blue-50 text-blue-600',
      accent: 'before:bg-blue-500/80',
      chevron: 'border-blue-100 bg-blue-50 text-blue-600',
      value: 'text-[#15345B]',
      spark: 'text-blue-500',
    },
    green: {
      icon: 'bg-emerald-50 text-emerald-600',
      accent: 'before:bg-emerald-500/80',
      chevron: 'border-emerald-100 bg-emerald-50 text-emerald-600',
      value: 'text-[#15345B]',
      spark: 'text-emerald-500',
    },
    orange: {
      icon: 'bg-amber-50 text-amber-600',
      accent: 'before:bg-amber-500/80',
      chevron: 'border-amber-100 bg-amber-50 text-amber-600',
      value: 'text-[#15345B]',
      spark: 'text-amber-500',
    },
    coral: {
      icon: 'bg-orange-50 text-orange-600',
      accent: 'before:bg-orange-500/80',
      chevron: 'border-orange-100 bg-orange-50 text-orange-600',
      value: 'text-[#15345B]',
      spark: 'text-orange-500',
    },
    navy: {
      icon: 'bg-[#15345B]/[0.07] text-[#15345B]',
      accent: 'before:bg-[#15345B]',
      chevron: 'border-[#15345B]/10 bg-[#15345B]/[0.06] text-[#15345B]',
      value: 'text-[#15345B]',
      spark: 'text-[#15345B]',
    },
    purple: {
      icon: 'bg-violet-50 text-violet-600',
      accent: 'before:bg-violet-500/80',
      chevron: 'border-violet-100 bg-violet-50 text-violet-600',
      value: 'text-[#15345B]',
      spark: 'text-violet-500',
    },
    red: {
      icon: 'bg-rose-50 text-rose-600',
      accent: 'before:bg-rose-500/80',
      chevron: 'border-rose-100 bg-rose-50 text-rose-600',
      value: 'text-[#D9364B]',
      spark: 'text-rose-500',
    },
    slate: {
      icon: 'bg-slate-100 text-slate-600',
      accent: 'before:bg-slate-400/80',
      chevron: 'border-slate-200 bg-slate-100 text-slate-600',
      value: 'text-[#15345B]',
      spark: 'text-slate-400',
    },
  };

  const toneStyle = TONE_STYLES[tone] || TONE_STYLES.blue;

  // Format value without clipping or rounding real data.
  const displayValue = formatValue
    ? formatValue(value)
    : isMoney
      ? inr(value)
      : (value ?? 0).toLocaleString('en-IN');

  const isInteractive = (onClick || href) && !disabled && !loading && !error;

  const baseClasses = compact
    ? `
      group relative flex h-full min-h-[150px] flex-col overflow-hidden
      rounded-[12px] border border-slate-200/80 bg-white
      px-3.5 py-3 text-left
      transition-all duration-200 ease-out
      shadow-[0_1px_2px_rgba(15,23,42,0.04)]
      before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:rounded-t-[12px] ${toneStyle.accent}
      ${isInteractive ? 'cursor-pointer hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_16px_34px_-24px_rgba(21,52,91,0.85)]' : 'cursor-default'}
      ${disabled && !isMoney ? 'opacity-70 cursor-not-allowed' : ''}
      ${loading ? 'pointer-events-none' : ''}
      ${className}
    `
    : `
      group relative flex h-full min-h-[130px] flex-col justify-between overflow-hidden
      rounded-[16px] border border-slate-200/80 bg-white
      px-[18px] py-[16px] text-left
      transition-all duration-200 ease-out
      shadow-[0_1px_1px_rgba(15,23,42,0.01)]
      before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:rounded-t-[16px] ${toneStyle.accent}
      ${isInteractive ? 'cursor-pointer hover:-translate-y-[1px] hover:border-slate-300 hover:shadow-[0_18px_40px_-24px_rgba(21,52,91,0.9)] focus-visible:-translate-y-[1px]' : 'cursor-default'}
      ${disabled && !isMoney ? 'opacity-70 cursor-not-allowed' : ''}
      ${loading ? 'pointer-events-none' : ''}
      ${className}
    `;

  const focusClasses = `
    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white
  `;

  const motionClasses = 'motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:shadow-none';

  const cardClasses = `${baseClasses} ${focusClasses} ${motionClasses}`;

  const renderIcon = () => (
    <span
      className={`flex shrink-0 items-center justify-center ${compact ? 'h-11 w-11 rounded-xl' : 'h-[38px] w-[38px] rounded-[10px]'} ${toneStyle.icon}`}
      aria-hidden="true"
    >
      {Icon ? <Icon className={compact ? 'h-5 w-5' : 'h-[18px] w-[18px]'} strokeWidth={1.9} /> : null}
    </span>
  );

  const renderContent = () => {
    if (compact) {
      return (
        <div className="relative flex h-full flex-col">
          {Icon ? (
            <Icon
              className="pointer-events-none absolute -right-1.5 -top-2.5 h-[82px] w-[82px] text-[#15345B] opacity-[0.045]"
              strokeWidth={1.1}
              aria-hidden="true"
            />
          ) : null}

          <div className="relative flex items-start gap-3">
            {Icon ? renderIcon() : null}
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[15px] font-bold leading-[1.3] tracking-[-0.012em] text-slate-900 whitespace-normal break-words">
                {label}
              </p>
              {subtitle ? (
                <p className="mt-0.5 text-[11.5px] font-medium leading-[1.35] text-slate-500 whitespace-normal break-words">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="relative mt-auto flex items-end justify-between gap-2 pt-2">
            {loading ? (
              <div className="h-8 w-24 animate-pulse rounded bg-slate-100" aria-hidden="true" />
            ) : error ? (
              <span className="text-lg font-semibold text-amber-600">Error</span>
            ) : !hasData ? (
              <span className="text-[28px] font-semibold tracking-tight text-slate-300">—</span>
            ) : (
              <p
                title={String(displayValue)}
                className={`text-[30px] leading-none font-bold tabular-nums tracking-[-0.03em] whitespace-nowrap xl:text-[34px] ${toneStyle.value}`}
              >
                {displayValue}
              </p>
            )}

            {!loading && !error && hasData && Icon ? (
              <svg
                viewBox="0 0 120 32"
                preserveAspectRatio="none"
                className={`pointer-events-none absolute bottom-0 right-9 hidden h-7 w-28 min-[1440px]:block ${toneStyle.spark}`}
                aria-hidden="true"
              >
                <path
                  d="M2 25 C 14 12 25 27 39 19 S 61 7 73 17 S 97 27 118 8 L118 32 L2 32 Z"
                  fill="currentColor"
                  opacity="0.10"
                />
                <path
                  d="M2 25 C 14 12 25 27 39 19 S 61 7 73 17 S 97 27 118 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  opacity="0.7"
                />
              </svg>
            ) : null}

            {isInteractive ? (
              <span
                className={`mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border transition-transform duration-200 group-hover:translate-x-0.5 ${toneStyle.chevron}`}
                aria-hidden="true"
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
              </span>
            ) : null}
          </div>

          {error && !loading && typeof error === 'string' && error.length > 0 ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-600">
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              {error}
            </p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="relative flex h-full flex-col justify-between gap-2">
        <div className="relative flex items-start gap-2.5">
          {Icon ? renderIcon() : null}
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium leading-snug tracking-[0.005em] text-slate-600 whitespace-normal break-words">
              {label}
            </p>
            {subtitle ? (
              <p className="mt-0.5 text-[11px] font-medium leading-snug text-slate-400 whitespace-normal break-words">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex items-end justify-between gap-2">
          {loading ? (
            <div className="h-9 w-28 animate-pulse rounded bg-slate-100" aria-hidden="true" />
          ) : error ? (
            <span className="text-lg font-semibold text-amber-600">Error</span>
          ) : !hasData ? (
            <span className="text-3xl font-semibold tracking-tight text-slate-300">—</span>
          ) : (
            <p
              title={String(displayValue)}
              className={`text-[32px] leading-none font-bold tabular-nums tracking-tight whitespace-nowrap sm:text-[34px] ${toneStyle.value}`}
            >
              {displayValue}
            </p>
          )}
        </div>

        {error && !loading && typeof error === 'string' && error.length > 0 ? (
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            {error}
          </p>
        ) : null}
      </div>
    );
  };

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
      if (href) window.location.href = href;
    }
  };

  if (href && !disabled) {
    return (
      <a
        href={href}
        className={cardClasses}
        aria-label={ariaLabel || (isInteractive ? `View ${label} details` : label)}
        aria-disabled={disabled}
        aria-busy={loading}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
      >
        {renderContent()}
      </a>
    );
  }

  if (onClick && !disabled && !loading) {
    return (
      <button
        type="button"
        className={cardClasses}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel || `View ${label} details`}
        aria-busy={loading}
      >
        {renderContent()}
      </button>
    );
  }

  return (
    <div
      className={`${baseClasses} ${disabled && !isMoney ? 'opacity-60' : ''} ${className}`}
      aria-label={ariaLabel || label}
      aria-busy={loading}
    >
      {renderContent()}
    </div>
  );
}

export default PremiumKpiCard;

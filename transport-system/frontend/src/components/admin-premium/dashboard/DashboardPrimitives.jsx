/**
 * DashboardPrimitives.jsx
 * ---------------------------------------------------------------------------
 * The Dashboard's presentation layer: hero, section shell and KPI card.
 *
 * These components are deliberately local to the Dashboard. Every figure they
 * render is supplied by the page from the existing admin APIs; nothing here
 * invents a metric. The sparklines are decorative (see DashboardSparkline) and
 * are hidden from assistive technology.
 */

import { ArrowRight, ChevronRight } from 'lucide-react';

const TONES = {
  emerald: {
    accent: 'bg-emerald-500',
    iconBg: 'bg-[#EAF9F1]',
    iconColor: 'text-[#0E8A57]',
    pillBg: 'bg-[#EAF9F1]',
    pillText: 'text-[#0E8A57]',
    dot: 'bg-emerald-500',
    spark: '#16A36A',
    watermark: 'text-[#CFE8DB]',
  },
  green: {
    accent: 'bg-emerald-500',
    iconBg: 'bg-[#EAF9F1]',
    iconColor: 'text-[#0E8A57]',
    pillBg: 'bg-[#EAF9F1]',
    pillText: 'text-[#0E8A57]',
    dot: 'bg-emerald-500',
    spark: '#16A36A',
    watermark: 'text-[#CFE8DB]',
  },
  amber: {
    accent: 'bg-[#F5A000]',
    iconBg: 'bg-[#FFF4DD]',
    iconColor: 'text-[#D98900]',
    pillBg: 'bg-[#FFF6E5]',
    pillText: 'text-[#B77900]',
    dot: 'bg-[#F5A000]',
    spark: '#F5A000',
    watermark: 'text-[#F3DFB8]',
  },
  orange: {
    accent: 'bg-[#F5A000]',
    iconBg: 'bg-[#FFF4DD]',
    iconColor: 'text-[#D98900]',
    pillBg: 'bg-[#FFF6E5]',
    pillText: 'text-[#B77900]',
    dot: 'bg-[#F5A000]',
    spark: '#F5A000',
    watermark: 'text-[#F3DFB8]',
  },
  blue: {
    accent: 'bg-[#2563EB]',
    iconBg: 'bg-[#EAF2FF]',
    iconColor: 'text-[#1764E8]',
    pillBg: 'bg-[#EAF2FF]',
    pillText: 'text-[#1764E8]',
    dot: 'bg-[#2563EB]',
    spark: '#2563EB',
    watermark: 'text-[#CFE0F6]',
  },
  sky: {
    accent: 'bg-[#1683C7]',
    iconBg: 'bg-[#EAF6FF]',
    iconColor: 'text-[#1683C7]',
    pillBg: 'bg-[#EAF6FF]',
    pillText: 'text-[#12689F]',
    dot: 'bg-[#1683C7]',
    spark: '#1683C7',
    watermark: 'text-[#CFE6F4]',
  },
  red: {
    accent: 'bg-[#E5484D]',
    iconBg: 'bg-[#FFF1F2]',
    iconColor: 'text-[#C93A3F]',
    pillBg: 'bg-[#FFF1F2]',
    pillText: 'text-[#C93A3F]',
    dot: 'bg-[#E5484D]',
    spark: '#E5484D',
    watermark: 'text-[#F1D2D4]',
  },
  danger: {
    accent: 'bg-[#E5484D]',
    iconBg: 'bg-[#FFF1F2]',
    iconColor: 'text-[#C93A3F]',
    pillBg: 'bg-[#FFF1F2]',
    pillText: 'text-[#C93A3F]',
    dot: 'bg-[#E5484D]',
    spark: '#E5484D',
    watermark: 'text-[#F1D2D4]',
  },
};

const SPARK_PATHS = [
  'M2 21 C 10 20 14 12 22 14 C 30 16 34 22 42 17 C 50 12 54 8 62 13 C 70 18 76 20 84 13 C 88 10 91 9 94 10',
  'M2 18 C 10 24 16 20 24 15 C 32 10 38 8 46 14 C 54 20 60 22 68 16 C 76 10 82 9 90 13 C 92 14 93 14 94 13',
  'M2 22 C 12 22 14 10 24 12 C 34 14 38 22 48 18 C 58 14 62 7 72 10 C 80 12 86 20 94 12',
  'M2 20 C 10 12 18 22 26 18 C 34 14 40 8 48 12 C 56 16 64 22 72 17 C 80 12 88 14 94 9',
];

const VALUE_SIZE = {
  operations: 'text-[40px] xl:text-[42px]',
  financial: 'text-[30px] xl:text-[32px]',
  resources: 'text-[26px] sm:text-[28px] xl:text-[30px]',
};

const CARD_HEIGHT = {
  operations: 'min-h-[152px]',
  financial: 'min-h-[144px]',
  resources: 'min-h-[88px]',
};

/**
 * A decorative line, NOT a measured trend.
 *
 * The backend exposes no historical KPI series, so the target's sparkline is
 * reproduced as a static illustration. It is aria-hidden, has no labels or
 * endpoints, and carries a data-decorative marker so it can never be mistaken
 * for an analytical chart.
 */
export function DashboardSparkline({ tone = 'blue', variant = 0, className = '' }) {
  const palette = TONES[tone] || TONES.blue;
  const path = SPARK_PATHS[variant % SPARK_PATHS.length];

  return (
    <svg
      viewBox="0 0 96 30"
      className={className}
      aria-hidden="true"
      focusable="false"
      data-decorative="true"
      preserveAspectRatio="none"
    >
      <path d={`${path} L94 30 L2 30 Z`} fill={palette.spark} opacity="0.07" />
      <path
        d={path}
        fill="none"
        stroke={palette.spark}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * The Dashboard KPI card. Three layouts share one anatomy:
 *   operations  label + caption at the top, value + status pill at the bottom
 *   financial   label at the top, value + caption at the bottom
 *   resources   label + caption at the top, value at the bottom
 *
 * A failed request renders an explicit "Unable to load" state. A missing value
 * renders an em dash; it is never replaced with a fabricated zero.
 */
export function DashboardMetricCard({
  label,
  value,
  caption,
  status,
  tone = 'blue',
  icon: Icon,
  watermark,
  watermarkClass,
  layout = 'operations',
  onClick,
  loading = false,
  error,
  sparkVariant = 0,
  ariaLabel,
}) {
  const palette = TONES[tone] || TONES.blue;
  const isTextWatermark = typeof watermark === 'string';
  const Watermark = !isTextWatermark && watermark ? watermark : null;
  const resolvedWatermarkClass = watermarkClass || palette.watermark;
  const sparkVisibility = layout === 'financial' ? 'hidden min-[1560px]:block' : 'hidden xl:block';
  const displayValue = value ?? '—';
  const compact = layout === 'resources';

  const cardPadding = compact
    ? 'px-4 pb-1 pt-1 sm:pl-4 sm:pr-5'
    : layout === 'financial'
      ? 'px-4 pb-[17px] pt-4 sm:pl-4 sm:pr-5'
      : 'px-4 pb-4 pt-4 sm:pl-4 sm:pr-5';
  const iconBox =
    layout === 'financial'
      ? 'h-11 w-11 rounded-[12px] sm:h-12 sm:w-12 sm:rounded-[13px]'
      : 'h-11 w-11 rounded-[12px] sm:h-14 sm:w-14 sm:rounded-[14px]';
  const iconSize =
    layout === 'financial' ? 'h-5 w-5 sm:h-[22px] sm:w-[22px]' : 'h-5 w-5 sm:h-6 sm:w-6';
  const labelSize = compact
    ? 'text-[12px] sm:text-[13px] xl:text-[13.5px]'
    : layout === 'financial'
      ? 'text-[12px] sm:text-[13px] xl:text-[13.5px]'
      : 'text-[12.5px] sm:text-[14px] xl:text-[14.5px]';
  const bottomPadding = compact ? 'pt-1.5' : layout === 'financial' ? 'pt-2.5' : 'pt-3.5';
  const sparkSize = compact
    ? 'h-[24px] w-[74px] xl:w-[110px]'
    : layout === 'financial'
      ? 'h-[28px] w-[70px] min-[1560px]:w-[90px]'
      : 'h-[30px] w-[80px] xl:w-[150px]';
  const arrowMargin =
    layout === 'financial' ? 'ml-auto min-[1560px]:ml-0' : 'ml-auto xl:ml-0';

  const accessibleLabel = ariaLabel || (
    error
      ? `${label}: unable to load`
      : `${label}: ${displayValue}${caption ? `, ${caption}` : ''}`
  );

  const cardClass = [
    'group relative flex w-full min-w-0 flex-col overflow-hidden rounded-[12px] border border-[#E6EDF6] bg-white text-left',
    'shadow-[0_1px_2px_rgba(16,43,76,0.03)] transition-all duration-200',
    'hover:-translate-y-0.5 hover:border-[#CDDCEC] hover:shadow-[0_12px_28px_-20px_rgba(16,43,76,0.45)]',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/25',
    CARD_HEIGHT[layout] || CARD_HEIGHT.operations,
    cardPadding,
  ].join(' ');

  // Resource cards are deliberately one compact horizontal band: a large icon
  // chip beside a label / caption / value column. Stacking a full-width value
  // row underneath would push the card past the reference height.
  if (compact) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={accessibleLabel}
        title={error || undefined}
        className={cardClass}
      >
        <span className={`absolute inset-x-0 top-0 h-[3px] ${palette.accent}`} aria-hidden="true" />

        <span
          className={`pointer-events-none absolute -right-1 -top-1 select-none opacity-90 ${resolvedWatermarkClass}`}
          aria-hidden="true"
        >
          {Watermark ? (
            <Watermark className="h-[50px] w-[50px]" strokeWidth={1.15} />
          ) : (
            <span className="block text-[46px] font-extrabold leading-none">{watermark}</span>
          )}
        </span>

        <div className="relative flex min-w-0 items-start gap-3">
          {Icon ? (
            <span
              className={`flex shrink-0 items-center justify-center ${iconBox} ${palette.iconBg} ${palette.iconColor}`}
            >
              <Icon className={iconSize} strokeWidth={2} aria-hidden="true" />
            </span>
          ) : null}

          <div className="flex min-w-0 flex-1 flex-col pt-1.5">
            <p
              className={`font-extrabold uppercase leading-tight tracking-[0.015em] text-[#0B2B52] ${labelSize}`}
            >
              {label}
            </p>
            {caption ? (
              <p className="mt-0 text-[11px] leading-tight text-[#718096] sm:text-[11.5px]">
                {caption}
              </p>
            ) : null}

            <div className="mt-auto flex min-w-0 items-end gap-2 pt-0.5">
              <div className="min-w-0">
                {loading ? (
                  <span className="block h-6 w-16 rounded-lg bt-skeleton" aria-hidden="true" />
                ) : error ? (
                  <>
                    <span className="block text-[12px] font-semibold leading-tight text-[#C93A3F]">
                      Unable to load
                    </span>
                    <span className="mt-0.5 block text-[10.5px] leading-tight text-[#8A98AB]">
                      Open module
                    </span>
                  </>
                ) : (
                  <span
                    className={`block whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] text-[#0B2B52] ${
                      VALUE_SIZE[layout] || VALUE_SIZE.resources
                    }`}
                  >
                    {displayValue}
                  </span>
                )}
              </div>

              <DashboardSparkline
                tone={tone}
                variant={sparkVariant}
                className={`mb-1 ml-auto shrink-0 xl:mx-auto ${sparkSize} ${sparkVisibility}`}
              />

              <span
                className={`mb-0.5 ${arrowMargin} flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E1E8F2] bg-white text-[#64748B] transition-colors group-hover:border-[#B9CEE8] group-hover:bg-[#F5F9FF] group-hover:text-[#1764E8]`}
              >
                <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={accessibleLabel}
      title={error || undefined}
      className={cardClass}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${palette.accent}`} aria-hidden="true" />

      <span
        className={`pointer-events-none absolute -right-1 -top-1 select-none opacity-90 ${resolvedWatermarkClass}`}
        aria-hidden="true"
      >
        {Watermark ? (
          <Watermark
            className={compact ? 'h-[50px] w-[50px]' : 'h-[62px] w-[62px]'}
            strokeWidth={1.15}
          />
        ) : (
          <span
            className={`block font-extrabold leading-none ${compact ? 'text-[46px]' : 'text-[58px]'}`}
          >
            {watermark}
          </span>
        )}
      </span>

      <div
        className={`relative flex min-w-0 items-start ${
          compact ? 'gap-3' : 'gap-3 sm:gap-4'
        }`}
      >
        {Icon ? (
          <span
            className={`flex shrink-0 items-center justify-center ${iconBox} ${palette.iconBg} ${palette.iconColor}`}
          >
            <Icon className={iconSize} strokeWidth={2} aria-hidden="true" />
          </span>
        ) : null}

        <div className={`min-w-0 ${compact ? 'pt-1.5' : 'pt-0.5 sm:pt-2.5'}`}>
          <p
            className={`font-extrabold uppercase leading-tight tracking-[0.015em] text-[#0B2B52] ${labelSize}`}
          >
            {label}
          </p>
          {layout !== 'financial' && caption ? (
            <p
              className={`text-[#718096] ${
                compact
                  ? 'mt-0 text-[11px] leading-tight sm:text-[11.5px]'
                  : 'mt-0.5 text-[11.5px] leading-snug sm:text-[12px]'
              }`}
            >
              {caption}
            </p>
          ) : null}
        </div>
      </div>

      <div
        className={`relative mt-auto flex min-w-0 items-end gap-2 ${bottomPadding}`}
      >
        <div
          className={`flex min-w-0 items-end gap-2 xl:gap-8 ${
            compact ? 'pl-[56px] sm:pl-[68px]' : ''
          }`}
        >
          <div className="min-w-0">
            {loading ? (
              <span
                className={`block rounded-lg bt-skeleton ${
                  compact ? 'h-6 w-16' : layout === 'financial' ? 'h-7 w-32' : 'h-8 w-20'
                }`}
                aria-hidden="true"
              />
            ) : error ? (
              <>
                <span className="block text-[12px] font-semibold leading-tight text-[#C93A3F]">
                  Unable to load
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-tight text-[#8A98AB]">
                  Open module
                </span>
              </>
            ) : (
              <>
                <span
                  className={`block whitespace-nowrap font-extrabold leading-none tracking-[-0.03em] text-[#0B2B52] ${
                    VALUE_SIZE[layout] || VALUE_SIZE.operations
                  }`}
                >
                  {displayValue}
                </span>
                {layout === 'financial' && caption ? (
                  <span className="mt-1 block text-[11.5px] leading-tight text-[#718096] sm:text-[12px]">
                    {caption}
                  </span>
                ) : null}
              </>
            )}
          </div>

          {status && !loading && !error ? (
            <span
              className={`mb-1 inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${palette.pillBg} ${palette.pillText}`}
            >
              <span className={`h-[7px] w-[7px] rounded-full ${palette.dot}`} aria-hidden="true" />
              {status}
            </span>
          ) : null}
        </div>

        <DashboardSparkline
          tone={tone}
          variant={sparkVariant}
          className={`mb-1 ml-auto shrink-0 xl:mx-auto ${sparkSize} ${sparkVisibility}`}
        />

        <span
          className={`mb-0.5 ${arrowMargin} flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E1E8F2] bg-white text-[#64748B] transition-colors group-hover:border-[#B9CEE8] group-hover:bg-[#F5F9FF] group-hover:text-[#1764E8]`}
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
        </span>
      </div>
    </button>
  );
}

/**
 * A full-width Dashboard section: pale amber icon chip, uppercase title,
 * one-line explanation and a right-aligned destination.
 */
export function DashboardSection({
  title,
  subtitle,
  icon: Icon,
  actionLabel,
  onAction,
  children,
  bodyClassName = 'px-4 pb-4 sm:px-5',
  className = '',
}) {
  return (
    <section
      className={`overflow-hidden rounded-[18px] border border-[#E4ECF7] bg-white shadow-[0_2px_18px_rgba(16,43,76,0.045)] ${className}`}
    >
      <header className="flex flex-col gap-2.5 px-4 pb-3.5 pt-4 sm:flex-row sm:items-start sm:justify-between sm:py-2.5 sm:pl-3 sm:pr-5">
        <div className="flex min-w-0 items-start gap-3 sm:gap-5">
          {Icon ? (
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#FFF4DD] text-[#D98900] sm:h-14 sm:w-14 sm:rounded-[14px]">
              <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={2.1} aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0 sm:pt-2.5">
            <h2 className="text-[19px] font-extrabold uppercase leading-tight tracking-[0.01em] text-[#0B2B52] sm:text-[22px]">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-0.5 text-[12.5px] leading-snug text-[#6B7C93] sm:text-[13.5px]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {actionLabel ? (
          <button
            type="button"
            onClick={onAction}
            className="group inline-flex shrink-0 items-center gap-1.5 self-start rounded-md text-[12.5px] font-semibold text-[#0B2B52] transition-colors hover:text-[#1764E8] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/30 sm:mt-1.5 sm:text-[13.5px]"
          >
            {actionLabel}
            <ArrowRight
              className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
              strokeWidth={2}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </header>

      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Full-width Dashboard hero. Reuses the Order / Trip Master artwork; the text
 * column is protected by a left-to-right scrim at every desktop width.
 */
export function DashboardHero({
  dateLabel,
  dateChip,
  lastUpdatedLabel,
  liveLabel,
  liveTone = 'emerald',
  onViewReports,
  onRefresh,
  refreshing = false,
}) {
  const liveDot =
    liveTone === 'danger'
      ? 'bg-[#E5484D]'
      : liveTone === 'amber'
        ? 'bg-[#F5A000]'
        : 'bg-emerald-500';

  return (
    <section
      aria-labelledby="dashboard-hero-title"
      className="relative -mx-4 -mt-4 min-h-[214px] overflow-hidden bg-[#F7FBFF] px-4 py-5 sm:-mx-6 sm:px-6 lg:-mx-8 lg:-mt-5 lg:min-h-[207px] lg:px-10 lg:pb-6"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,#FFFFFF_0%,#F5FAFF_48%,#EAF4FF_100%)]" />

      {/* Desktop artwork: right-anchored, width capped so the truck stays clear
          of the heading column while the bridge and skyline reach the edge. */}
      <div className="pointer-events-none absolute inset-0 hidden xl:block">
        <img
          src="/assets/bihar-transport-operations-hero.webp"
          srcSet="/assets/bihar-transport-operations-hero.webp 1x, /assets/bihar-transport-operations-hero@2x.webp 2x"
          width="1166"
          height="198"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          className="absolute bottom-0 right-0 h-auto w-[min(1166px,calc(100%_-_610px))] max-w-none"
        />
      </div>

      {/* Tablet / mobile: softly cropped artwork behind a readable scrim. */}
      <div className="pointer-events-none absolute inset-0 xl:hidden">
        <img
          src="/assets/bihar-transport-operations-hero.webp"
          srcSet="/assets/bihar-transport-operations-hero.webp 1x, /assets/bihar-transport-operations-hero@2x.webp 2x"
          alt=""
          aria-hidden="true"
          loading="eager"
          decoding="async"
          className="h-full w-full object-cover object-[72%_55%] opacity-20"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#F8FBFF] via-[#F8FBFF]/94 to-[#F8FBFF]/55" />
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[640px] max-w-[60%] bg-gradient-to-r from-[#F8FBFF] via-[#F8FBFF]/80 to-transparent xl:block" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#F7FAFE] to-transparent" />

      <div className="relative z-10 flex min-h-[174px] flex-col justify-between gap-3 lg:min-h-[162px]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2F6FE4]">
              OPERATIONS CONSOLE
            </p>
            <h1
              id="dashboard-hero-title"
              className="mt-1 text-[40px] font-extrabold leading-[1.02] tracking-[-0.04em] text-[#0B2B52] sm:text-[46px] xl:text-[52px]"
            >
              Dashboard
            </h1>
            <p className="mt-1.5 max-w-[620px] text-[14px] leading-snug text-[#44546A] sm:text-[16px] xl:text-[17px]">
              Live operational and financial overview for {dateLabel}.
            </p>
          </div>

          <button
            type="button"
            onClick={onViewReports}
            className="inline-flex h-9 shrink-0 items-center gap-2 self-start rounded-[10px] border border-[#E1E8F2] bg-white/95 px-3.5 text-[13px] font-semibold text-[#0B2B52] shadow-[0_2px_8px_rgba(16,43,76,0.05)] transition-colors hover:border-[#C7D6E8] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/30 sm:mt-1 sm:gap-2.5 sm:px-5"
          >
            <span className="flex h-4 w-4 items-end gap-[2px]" aria-hidden="true">
              <span className="h-[7px] w-[3px] rounded-[1px] bg-[#1764E8]" />
              <span className="h-[11px] w-[3px] rounded-[1px] bg-[#1764E8]" />
              <span className="h-[15px] w-[3px] rounded-[1px] bg-[#1764E8]" />
            </span>
            View Reports
            <ChevronRight className="h-3.5 w-3.5 text-[#64748B]" strokeWidth={2.1} aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-[#E1E9F3] bg-white/95 px-3.5 text-[12.5px] font-semibold text-[#33465F] shadow-[0_1px_3px_rgba(16,43,76,0.04)]">
            <span className={`h-[8px] w-[8px] rounded-full ${liveDot}`} aria-hidden="true" />
            {liveLabel}
          </span>

          <span className="inline-flex h-9 items-center gap-2 rounded-full border border-[#E1E9F3] bg-white/95 px-3.5 text-[12.5px] font-semibold text-[#33465F] shadow-[0_1px_3px_rgba(16,43,76,0.04)]">
            <CalendarIcon />
            {dateChip}
          </span>

          <button
            type="button"
            onClick={onRefresh}
            aria-label="Refresh dashboard data"
            title="Refresh dashboard data"
            className="inline-flex h-9 items-center gap-2 rounded-full border border-[#E1E9F3] bg-white/95 px-3.5 text-[12.5px] font-semibold text-[#33465F] shadow-[0_1px_3px_rgba(16,43,76,0.04)] transition-colors hover:border-[#C7D6E8] hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1764E8]/30"
          >
            {refreshing ? <RefreshIcon /> : <ClockIcon />}
            {refreshing ? 'Refreshing…' : lastUpdatedLabel}
          </button>
        </div>
      </div>
    </section>
  );
}

/* Small inline glyphs keep the hero's icon weight consistent without pulling
   another module's icon component into the page. */
function CalendarIcon() {
  return (
    <svg className="h-[15px] w-[15px] text-[#64748B]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="3" strokeWidth="1.8" />
      <path d="M8 3v4M16 3v4M3 10h18" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-[15px] w-[15px] text-[#64748B]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
      <path d="M12 7v5l3 2" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg className="h-[15px] w-[15px] animate-spin text-[#1764E8]" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 6.1" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M20 5v6h-6" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

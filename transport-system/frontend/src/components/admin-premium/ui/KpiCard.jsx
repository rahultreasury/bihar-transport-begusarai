/**
 * KpiCard.jsx
 * ---------------------------------------------------------------------------
 * The console's one KPI tile. Shared by Dashboard, Drivers, Vehicles, Trips,
 * Financials, Clients and every partner page, so the summary row looks
 * identical wherever an operator meets it.
 *
 * THE SHAPE (identical on every module)
 *   ┌────────────────────────────────┐
 *   │ ▍ TOTAL BOOKINGS               │   ← muted uppercase label + accent rule
 *   │                                │
 *   │ 128                            │   ← large navy number
 *   │                                │
 *   │ +12.4% this month              │   ← muted secondary line
 *   └────────────────────────────────┘
 *
 * A tile is NEVER a different colour from its neighbours. The only colour is a
 * thin semantic accent on the left edge and the matching dot beside the label.
 *
 * PROPS
 *   title    string   label
 *   value    node     the big number (or a formatted string)
 *   sub      string   secondary line under the number
 *   subtitle string   alias for `sub` — the name most call sites already use
 *   accent   string   semantic key: navy | orange | success | info | warning |
 *                      danger  (legacy colour names are still accepted)
 *   icon     Lucide   optional icon chip in the top-right
 *   loading  bool     render a skeleton instead of a number
 *   onClick  fn       makes the whole tile an activatable control
 *   active   bool     selected/pressed state (orange ring)
 */

const ACCENT = {
  // Semantic keys — the ones new code should use.
  navy: { dot: 'bg-bt-navy', text: 'text-bt-navy' },
  orange: { dot: 'bg-bt-orange', text: 'text-bt-orange' },
  success: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  info: { dot: 'bg-sky-500', text: 'text-sky-600' },
  warning: { dot: 'bg-amber-500', text: 'text-amber-600' },
  danger: { dot: 'bg-red-500', text: 'text-red-600' },

  // Legacy accent names kept so existing call sites are unchanged.
  amber: { dot: 'bg-amber-500', text: 'text-amber-600' },
  emerald: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  green: { dot: 'bg-emerald-500', text: 'text-emerald-600' },
  blue: { dot: 'bg-bt-navy', text: 'text-bt-navy' },
  sky: { dot: 'bg-sky-500', text: 'text-sky-600' },
  red: { dot: 'bg-red-500', text: 'text-red-600' },
  rose: { dot: 'bg-red-500', text: 'text-red-600' },
  purple: { dot: 'bg-bt-navy', text: 'text-bt-navy' },
  slate: { dot: 'bg-slate-400', text: 'text-slate-500' },
};

export default function KpiCard({
  title,
  value,
  sub,
  subtitle,
  accent = 'orange',
  icon: Icon,
  loading,
  onClick,
  active = false,
  ariaLabel,
}) {
  const tone = ACCENT[accent] || ACCENT.orange;
  // Call sites are split between `sub` and `subtitle`; both are honoured so
  // no existing page silently loses its secondary line.
  const caption = sub ?? subtitle;

  const handleKeyDown = (e) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      onClick={onClick}
      onKeyDown={onClick ? handleKeyDown : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={ariaLabel}
      aria-pressed={onClick ? active : undefined}
      className={[
        'bt-kpi group',
        onClick ? 'cursor-pointer' : '',
        active ? 'border-bt-orange ring-2 ring-amber-500/20' : '',
      ].join(' ')}
    >
      {/* The single accent: a 3px semantic edge, never a coloured card. */}
      <span
        className={`absolute inset-y-0 left-0 w-[3px] ${tone.dot} opacity-80`}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-3 pl-1.5">
        <div className="min-w-0 flex-1">
          <div className="bt-kpi-label">
            <span className={`bt-kpi-dot ${tone.dot}`} aria-hidden="true" />
            <span className="truncate">{title}</span>
          </div>

          {loading ? (
            <span className="bt-kpi-value block h-8 w-24 bt-skeleton rounded-lg" aria-hidden="true" />
          ) : (
            <span className="bt-kpi-value">{value}</span>
          )}

          {caption ? <span className="bt-kpi-sub">{caption}</span> : null}
        </div>

        {Icon ? (
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bt-orange-light text-bt-orange-dark transition-transform duration-200 group-hover:scale-105"
            aria-hidden="true"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
          </span>
        ) : onClick ? (
          <svg
            className={`mt-0.5 h-4 w-4 shrink-0 ${tone.text} opacity-0 transition-opacity duration-200 group-hover:opacity-70`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        ) : null}
      </div>
    </div>
  );
}

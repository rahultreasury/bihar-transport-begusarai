/**
 * AdminUI.jsx
 * ---------------------------------------------------------------------------
 * The shared component vocabulary of the Bihar Transport admin console.
 *
 * Every module renders from this file so that a KPI tile, a page title, a
 * primary button or a status badge look and behave the same in Enquiry,
 * Bookings, Financials, Drivers and Settings. The Enquiry workspace is the
 * visual reference these were extracted from.
 *
 * WHAT IS HERE
 *   PageHeader   title + description + actions, one hierarchy for every page
 *   Button       one geometry, five intents (primary/accent/secondary/ghost/danger)
 *   StatusBadge  one badge, semantic colour, resolved from any status string
 *   SearchBar    the search field used on every list page
 *   FilterBar    the filter/search row that sits between KPIs and content
 *   FormField    label + control + hint + error
 *   AdminModal   the one dialog treatment (white, 20px, soft shadow)
 *   ErrorState   a failure that offers a retry, never a dead screen
 *   IconTile     the consistent rounded icon container
 *
 * COLOUR DISCIPLINE
 *   Navy carries structure, white carries content, soft grey carries space.
 *   Orange marks the one thing you can act on: a primary action, the active
 *   control, a focus ring, a key number. It is never used to fill a surface.
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Search, X, AlertTriangle, Inbox } from 'lucide-react';

/* ══════════════════════════════════════════════════════════════════════════
   CHART THEME
   ---------------------------------------------------------------------------
   Recharts takes colours as literal strings, not class names, so a chart can
   silently drift back to a generic palette even when the CSS tokens are
   perfect. These constants are the design system for anything drawn on a
   canvas: Analytics, Reports, Financials and the trip dashboards all read from
   here, so every chart in the console looks like it was made by one team.
   ══════════════════════════════════════════════════════════════════════════ */

/** The brand ramp, in the order a categorical series should consume it. */
export const CHART_COLORS = {
  navy: '#15345B',
  orange: '#F5A000',
  success: '#16A36A',
  info: '#1683C7',
  warning: '#F59E0B',
  danger: '#E5484D',
  muted: '#94A3B8',
};

/**
 * A categorical series palette built from the brand: navy leads, orange is the
 * accent, and the rest are semantic. Deliberately not a rainbow — a colourful
 * pie chart is the fastest way to make an operations console look like a
 * template.
 */
export const CHART_SERIES = [
  '#15345B',
  '#F5A000',
  '#16A36A',
  '#1683C7',
  '#66758C',
  '#D98900',
  '#2E4F7C',
  '#9DB3D0',
];

/** Grid + axis treatment shared by every chart. */
export const CHART_GRID = {
  stroke: '#E3E8EF',
  strokeDasharray: '3 3',
  vertical: false,
};

/** The tooltip every chart shares: white surface, hairline border, navy text. */
export const CHART_TOOLTIP = {
  background: '#FFFFFF',
  border: '1px solid #E3E8EF',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(16, 43, 76, 0.12)',
  fontSize: 12,
  color: '#172033',
};

/** Axis label colour — muted, never competing with the data. */
export const CHART_AXIS = {
  stroke: '#94A3B8',
  fontSize: 12,
  tick: { fill: '#94A3B8' },
};

/* ══════════════════════════════════════════════════════════════════════════
   PAGE HEADER
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The top of every admin page. One hierarchy, so no two modules disagree
 * about how a title should look.
 */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className = '',
}) {
  return (
    <header className={`mb-6 flex flex-col gap-4 sm:mb-7 ${className}`}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? <p className="bt-eyebrow mb-2">{eyebrow}</p> : null}
          <h1 className="bt-page-title">{title}</h1>
          {description ? <p className="bt-page-desc">{description}</p> : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   BUTTONS
   ══════════════════════════════════════════════════════════════════════════ */

const BUTTON_VARIANTS = {
  /** Important operational action — Assign Resources, Save Changes. */
  primary: 'bt-btn-primary',
  /** The brand action, used sparingly — Create Booking, Prepare Quote. */
  accent: 'bt-btn-accent',
  /** Neutral action with a hairline border — Cancel, Reset. */
  secondary: 'bt-btn-secondary',
  /** No fill until hover — tertiary links and toolbars. */
  ghost: 'bt-btn-ghost',
  /** Destructive operations only — Delete, Cancel booking. */
  danger: 'bt-btn-danger',
  /** Destructive but secondary in weight — outlined. */
  'danger-outline': 'bt-btn-danger-outline',
};

const BUTTON_SIZES = {
  sm: 'bt-btn-sm',
  md: '',
  lg: 'bt-btn-lg',
};

export const Button = React.forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconRight: IconRight,
    loading = false,
    fullWidth = false,
    className = '',
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={[
        'bt-btn',
        BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.primary,
        BUTTON_SIZES[size] || '',
        fullWidth ? 'w-full' : '',
        !children ? 'bt-btn-icon' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {loading ? (
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      ) : Icon ? (
        <Icon className="h-4 w-4 shrink-0" strokeWidth={2.1} aria-hidden="true" />
      ) : null}

      {children ? <span className="truncate">{children}</span> : null}

      {IconRight && !loading ? (
        <IconRight className="h-4 w-4 shrink-0" strokeWidth={2.1} aria-hidden="true" />
      ) : null}
    </button>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
   STATUS BADGE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Status → tone. Matching is done on a normalised, lower-cased string so a
 * status arriving as `VEHICLE_ASSIGNED`, `vehicle assigned` or `VehicleAssigned`
 * all land on the same badge.
 */
const STATUS_TONES = [
  [/rejected|refused|declined|failed|error|overdue/i, 'danger'],
  [/cancelled|canceled|void|closed|deleted|archived|expired/i, 'neutral'],
  [/outstanding|unpaid|due|negative/i, 'danger'],
  [/partial/i, 'info'],
  [/awaiting|pending|review|\bnew\b|inquiry|unassigned|todo|initiated|hold/i, 'warning'],
  [/quote[\s_-]*sent|sent[\s_-]*quote|quoted/i, 'accent'],
  [/assign/i, 'info'],
  [/paid|settled|credited|received/i, 'success'],
  [/confirm|complete|completed|delivered|active|available|approved|success|ongoing|in[_\s-]?transit|dispatched|started/i, 'success'],
];

const TONE_CLASS = {
  success: 'bt-badge-success',
  info: 'bt-badge-info',
  warning: 'bt-badge-warning',
  danger: 'bt-badge-danger',
  accent: 'bt-badge-accent',
  neutral: 'bt-badge-neutral',
  navy: 'bt-badge-navy',
};

/**
 * Resolve any status string to one of six semantic tones.
 * Exported so tables can colour a legend or a filter chip the same way.
 */
export function resolveStatusTone(status) {
  if (!status) return 'neutral';
  const raw = String(status);
  for (const [pattern, tone] of STATUS_TONES) {
    if (pattern.test(raw)) return tone;
  }
  return 'neutral';
}

/** Turn `VEHICLE_ASSIGNED` / `awaiting-quote` into `Vehicle Assigned`. */
export function humanizeStatus(status) {
  if (status === null || status === undefined || status === '') return '—';
  const text = String(status)
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '—';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * The one status badge. A tinted pill, a semantic dot, a 12px label —
 * identical on every page of the console.
 *
 * `tone` may be passed explicitly (by a custom `statusTone` mapper); otherwise
 * it is resolved from the status text.
 */
export function StatusBadge({ status, tone, label, className = '', plain = false }) {
  const resolved = tone || resolveStatusTone(status);
  return (
    <span className={`bt-badge ${TONE_CLASS[resolved] || TONE_CLASS.neutral} ${plain ? 'bt-badge-plain' : ''} ${className}`}>
      {label ?? humanizeStatus(status)}
    </span>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SEARCH + FILTERS
   ══════════════════════════════════════════════════════════════════════════ */

/** The search field used on every list page. */
export function SearchBar({ value, onChange, placeholder = 'Search…', className = '', ...rest }) {
  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-bt-ink-3"
        strokeWidth={2}
        aria-hidden="true"
      />
      <input
        type="search"
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="bt-input pl-10 pr-10 [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange?.('')}
          className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-bt-ink-3 transition-colors hover:bg-bt-orange-light hover:text-bt-navy"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The strip that sits between a page's KPIs and its main content: search on
 * the left, filters and actions on the right, wrapping to a single column on
 * small screens rather than shrinking to unreadable widths.
 */
export function FilterBar({ children, className = '', ...rest }) {
  return (
    <div
      className={`mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** A labelled dropdown filter that matches the input system exactly. */
export function FilterSelect({ label, value, onChange, options = [], className = '', ...rest }) {
  return (
    <label className={`block ${className}`}>
      {label ? <span className="bt-label">{label}</span> : null}
      <select value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} className="bt-select" {...rest}>
        {options.map((opt) => (
          <option key={opt.value ?? opt} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   FORMS
   ══════════════════════════════════════════════════════════════════════════ */

let fieldSeq = 0;

/**
 * Label + control + hint + error. The control is passed as `children` so the
 * same wrapper serves a text input, a select, a textarea or a custom picker.
 */
export function FormField({ label, hint, error, required, children, className = '', htmlFor }) {
  const generatedId = useRef(null);
  if (generatedId.current === null) {
    fieldSeq += 1;
    generatedId.current = `bt-field-${fieldSeq}`;
  }
  const id = htmlFor || generatedId.current;

  return (
    <div className={className}>
      {label ? (
        <label className="bt-label" htmlFor={id}>
          {label}
          {required ? <span className="ml-0.5 text-bt-orange">*</span> : null}
        </label>
      ) : null}

      {children}

      {error ? (
        <p className="mt-1.5 text-[12px] font-medium text-bt-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-bt-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   MODAL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * The one dialog treatment: a dimmed navy backdrop, a white 20px-radius panel,
 * a navy heading, muted secondary text and an orange primary action.
 *
 * Escape closes, the body does not scroll behind it, and it is a real modal
 * dialog to assistive technology.
 */
export function AdminModal({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
}) {
  const panelRef = useRef(null);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Escape') onClose?.();
    },
    [onClose]
  );

  useEffect(() => {
    if (!open) return undefined;

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  const width = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' }[size];

  return (
    <div
      className="bt-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div ref={panelRef} className={`bt-modal-panel ${width} my-auto`}>
        {/* Header */}
        <header className="flex items-start justify-between gap-4 border-b border-bt-border px-6 py-5">
          <div className="flex min-w-0 items-start gap-3.5">
            {Icon ? (
              <span className="bt-icon-chip" aria-hidden="true">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2.1} />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className="text-[19px] font-bold leading-snug text-bt-navy">{title}</h2>
              {description ? <p className="mt-1 text-[13.5px] leading-relaxed text-bt-ink-2">{description}</p> : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-bt-ink-3 transition-colors hover:bg-bt-orange-light hover:text-bt-navy"
            aria-label="Close dialog"
          >
            <X className="h-[18px] w-[18px]" strokeWidth={2.1} />
          </button>
        </header>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>

        {/* Footer */}
        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-bt-border bg-bt-surface-soft px-6 py-4">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   STATES
   ══════════════════════════════════════════════════════════════════════════ */

/** A failure that offers a way out. Never a dead screen. */
export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  retryLabel = 'Try again',
  className = '',
}) {
  return (
    <div className={`bt-error ${className}`} role="alert">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bt-danger" strokeWidth={2} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-bt-navy">{title}</p>
        {message ? <p className="mt-1 text-[13px] leading-relaxed text-bt-ink-2">{message}</p> : null}
        {onRetry ? (
          <Button variant="secondary" size="sm" onClick={onRetry} className="mt-3">
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** A neutral "there is nothing here" that can also be inlined into a card. */
export function BlankState({ title = 'No data', subtitle, action, className = '' }) {
  return (
    <div className={`bt-empty ${className}`}>
      <span
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-bt-orange-light text-bt-orange-dark"
        aria-hidden="true"
      >
        <Inbox className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <p className="text-[15px] font-semibold text-bt-navy">{title}</p>
      {subtitle ? (
        <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-bt-ink-2">{subtitle}</p>
      ) : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   SMALL PIECES
   ══════════════════════════════════════════════════════════════════════════ */

/** The consistent rounded icon container used in cards, lists and rows. */
export function IconTile({ icon: Icon, tone = 'orange', size = 'md', className = '' }) {
  const tones = {
    orange: 'bg-bt-orange-light text-bt-orange-dark',
    navy: 'bg-bt-navy/[0.06] text-bt-navy',
    success: 'bg-emerald-50 text-emerald-600',
    info: 'bg-sky-50 text-sky-600',
    warning: 'bg-amber-50 text-amber-600',
    danger: 'bg-red-50 text-red-600',
    muted: 'bg-slate-100 text-slate-500',
  };
  const sizes = { sm: 'h-8 w-8 rounded-lg', md: 'h-9 w-9 rounded-[10px]', lg: 'h-11 w-11 rounded-xl' };

  return (
    <span className={`flex shrink-0 items-center justify-center ${sizes[size]} ${tones[tone] || tones.orange} ${className}`} aria-hidden="true">
      {Icon ? <Icon className={size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]'} strokeWidth={2.1} /> : null}
    </span>
  );
}

/** label / value pair used in detail panels. */
export function DetailRow({ label, value, className = '' }) {
  return (
    <div className={`flex items-start justify-between gap-4 border-b border-bt-border/70 py-2.5 last:border-b-0 ${className}`}>
      <dt className="shrink-0 text-[12px] font-semibold uppercase tracking-wider text-bt-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[14px] font-medium text-bt-navy">
        {value === null || value === undefined || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

export default {
  PageHeader,
  Button,
  StatusBadge,
  resolveStatusTone,
  humanizeStatus,
  SearchBar,
  FilterBar,
  FilterSelect,
  FormField,
  AdminModal,
  ErrorState,
  BlankState,
  IconTile,
  DetailRow,
};

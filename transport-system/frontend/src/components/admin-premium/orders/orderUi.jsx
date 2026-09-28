/**
 * orderUi.jsx — shared presentational primitives for the Order / Trip Master.
 *
 * Bihar Transport brand tokens live here (navy + orange) so the Order screens
 * match the admin sidebar instead of inventing a second palette.
 *
 * NOTHING in this file fetches data or knows about the backend. It renders what
 * `utils/orderStatus.js` resolved.
 */

import React from 'react';

/** Brand palette — mirrors AdminSidebar's navy/amber. */
export const BRAND = {
  navy: '#15345B',
  navyDeep: '#102B4C',
  navySoft: '#172B4D',
  orange: '#F5A000',
  orangeDark: '#D98C0B',
};

export const CARD_BASE =
  'rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,43,85,0.04)]';

/** Section heading used by every ORDER / SHIPMENT / COMMERCIAL block. */
export function SectionCard({ title, subtitle, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`${CARD_BASE} overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon ? (
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.08em] text-slate-700">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p> : null}
          </div>
        </div>
        {action}
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/** Label/value pair for the information grids. */
export function Field({ label, value, mono = false, className = '' }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
      <dd
        className={`mt-1 truncate text-sm font-medium text-slate-800 ${mono ? 'font-mono tabular-nums' : ''}`}
        title={typeof value === 'string' ? value : undefined}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

const TONE = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  danger: 'bg-red-50 text-red-700 ring-red-600/20',
  info: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  brand: 'bg-[#15345B] text-white ring-[#15345B]/20',
};

/** Compact status badge. `tone` picks the semantic colour. */
export function Badge({ children, tone = 'neutral', className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${TONE[tone] || TONE.neutral} ${className}`}
    >
      {children}
    </span>
  );
}

/** Maps a lifecycle stage state to a badge tone. */
export function stateTone(state) {
  return { done: 'success', current: 'warning', blocked: 'danger', upcoming: 'neutral' }[state] || 'neutral';
}

/**
 * Large status card used by the OPERATIONAL STATUS grid (§11).
 * `meta` lines are the timestamp / responsible person / note the backend gave us.
 */
export function StatusCard({ title, status, tone = 'neutral', meta = [], action, icon: Icon }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</p>
        {Icon ? <Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" /> : null}
      </div>
      <div className="mt-2">
        <Badge tone={tone}>{status}</Badge>
      </div>
      {meta.length ? (
        <ul className="mt-2 space-y-0.5">
          {meta.filter(Boolean).map((line, i) => (
            <li key={i} className="truncate text-xs text-slate-500" title={String(line)}>
              {line}
            </li>
          ))}
        </ul>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Right-aligned money row; `emphasis` renders the total in large navy type. */
export function MoneyRow({ label, value, sub, emphasis = false }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        emphasis ? 'border-t border-slate-200 pt-2.5 mt-2.5' : ''
      }`}
    >
      <span className={`text-sm ${emphasis ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
        {label}
        {sub ? <span className="ml-1.5 text-xs text-slate-400">{sub}</span> : null}
      </span>
      <span
        className={`tabular-nums ${
          emphasis ? 'text-lg font-bold text-[#15345B]' : 'text-sm font-semibold text-slate-800'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/** Primary / secondary / ghost action buttons. */
export function ActionButton({ children, icon: Icon, variant = 'secondary', ...rest }) {
  const styles = {
    primary: 'bg-[#15345B] text-white hover:bg-[#102B4C] shadow-sm',
    accent: 'bg-[#F5A000] text-[#15345B] hover:bg-[#D98C0B] shadow-sm',
    secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
    ghost: 'text-slate-600 hover:bg-slate-100',
  };
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant] || styles.secondary}`}
      {...rest}
    >
      {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

/** Small muted helper line for empty states and footnotes. */
export function EmptyNote({ children }) {
  return <p className="py-4 text-center text-sm text-slate-400">{children}</p>;
}

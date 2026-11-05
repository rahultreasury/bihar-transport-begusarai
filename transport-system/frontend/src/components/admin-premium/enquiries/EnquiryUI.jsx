/**
 * EnquiryUI.jsx
 * ---------------------------------------------------------------------------
 * The compact enterprise primitives used by the admin ENQUIRY workspace.
 *
 * DESIGN LANGUAGE (Bihar Transport admin)
 *   Primary  : amber-500 (#f59e0b)
 *   Secondary: dark navy (#1e3a5f)
 *   Surface  : light neutral (the AdminShell `bg-surface`)
 *   Radius   : 8px (rounded-lg) / 12px (rounded-xl) — never pill-shaped walls
 *   Borders  : subtle, low-contrast; shadows are hairline, never heavy
 *
 * Every API-driven surface in this module can render one of three honest
 * states — `LoadingBlock` (skeleton), `EmptyBlock` ("nothing here yet") and
 * `ErrorBlock` (message + Retry) — so no section is ever left blank white.
 */

import React from 'react';
import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';

/* ── Panel ──────────────────────────────────────────────────────────────── */

export function Panel({ title, subtitle, icon: Icon, action, children, className = '', bodyClassName = '', dense = false }) {
  return (
    <section
      className={`rounded-xl border border-border bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${className}`}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {Icon ? <Icon className="h-4 w-4 shrink-0 text-amber-500" strokeWidth={2} aria-hidden="true" /> : null}
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.08em] text-text">{title}</h2>
              {subtitle ? <p className="mt-0.5 truncate text-[11px] text-muted">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}
      <div className={dense ? 'p-3' : 'p-4'}>{children}</div>
      {bodyClassName ? <div className={bodyClassName} /> : null}
    </section>
  );
}

/* ── Information rows ───────────────────────────────────────────────────── */

export function InfoRow({ label, value, icon: Icon, mono = false, tone = 'default' }) {
  const valueTone =
    tone === 'strong' ? 'text-text font-semibold' : tone === 'muted' ? 'text-muted' : 'text-text';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/60 py-2 last:border-b-0">
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
        {Icon ? <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> : null}
        {label}
      </span>
      <span className={`min-w-0 break-words text-right text-[13px] ${mono ? 'font-mono text-[12.5px]' : ''} ${valueTone}`}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

/** Compact key/value grid used for dense fact lists. */
export function FactGrid({ items, columns = 2 }) {
  return (
    <dl
      className={`grid gap-x-5 gap-y-2.5 ${columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2'}`}
    >
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
            {item.icon ? <item.icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /> : null}
            {item.label}
          </dt>
          <dd className="mt-0.5 truncate text-[13px] font-medium text-text" title={typeof item.value === 'string' ? item.value : undefined}>
            {item.value === null || item.value === undefined || item.value === '' ? '—' : item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Honest API states ──────────────────────────────────────────────────── */

export function LoadingBlock({ label = 'Loading…', rows = 3, className = '' }) {
  return (
    <div className={`space-y-2.5 ${className}`} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-3.5 w-3.5 rounded bg-skeleton animate-pulse" />
          <div className="h-3.5 flex-1 rounded bg-skeleton animate-pulse" style={{ maxWidth: `${100 - i * 12}%` }} />
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyBlock({ title = 'Nothing here yet', subtitle, action }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-slate-50/60 px-4 py-6 text-center">
      <Inbox className="mx-auto h-5 w-5 text-slate-300" strokeWidth={1.75} aria-hidden="true" />
      <p className="mt-2 text-[13px] font-semibold text-text">{title}</p>
      {subtitle ? <p className="mt-1 text-[12px] text-muted">{subtitle}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function ErrorBlock({ message = 'Unable to load enquiry details.', onRetry, retryLabel = 'Retry' }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4" role="alert">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" strokeWidth={2} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-rose-800">{message}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-100"
            >
              <RotateCw className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Form primitives ────────────────────────────────────────────────────── */

export function Field({ label, hint, required = false, htmlFor, children, className = '' }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-text">
        {label}
        {required ? <span className="text-amber-600">*</span> : null}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  'w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] font-medium text-text outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 disabled:bg-slate-50 disabled:text-muted';

/* ── Buttons ────────────────────────────────────────────────────────────── */

export function PrimaryButton({ children, className = '', ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_1px_2px_rgba(245,158,11,0.35)] transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, className = '', ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-white px-3 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function NavyButton({ children, className = '', ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-2 text-[12.5px] font-semibold text-white transition hover:bg-[#16294a] focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/* ── Inline notices ─────────────────────────────────────────────────────── */

export function Notice({ tone = 'info', children, className = '' }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    neutral: 'border-border bg-slate-50 text-slate-700',
  };
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[12.5px] ${tones[tone] || tones.info} ${className}`}>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export default Panel;

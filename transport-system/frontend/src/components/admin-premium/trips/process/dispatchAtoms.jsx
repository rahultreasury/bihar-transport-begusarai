/**
 * dispatchAtoms.jsx
 * ---------------------------------------------------------------------------
 * The small pieces the Dispatch and Transit workspaces are built from.
 *
 * DESIGN-SYSTEM CONTRACT (§35)
 *   These are NOT a new visual language. Every colour, radius and type size
 *   here is already in use elsewhere in the admin console: `emerald-*` for
 *   done/valid, `amber-*` for active/warning (and the brand), `red-*` for
 *   blocked/expired, `slate-*` for pending. Nothing new is introduced, so the
 *   Dispatch workspace looks like the Loading workspace with more detail rather
 *   than like a different product.
 *
 * STATUS COLOUR IS A FUNCTION OF STATE, NOT OF A STRING
 *   `toneFor()` maps a backend state to a tone. A component that guesses a tone
 *   from a status name would render "EXPIRING_SOON" as grey when it must be
 *   orange, so the mapping lives here once and is used by every badge.
 */

import React, { useEffect, useRef } from 'react';
import { AlertTriangle, Check, Info, X } from 'lucide-react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/**
 * The ONE place a state becomes a colour.
 *
 * green  = completed / valid
 * orange = active / attention (expiring, warning, partial)
 * red    = blocked / expired / missing
 * grey   = pending / not recorded
 * blue   = informational
 */
export function toneFor(state) {
  const s = String(state || '').toUpperCase();
  if (['PASSED', 'VALID', 'PRESENT', 'VERIFIED', 'DONE', 'PAID', 'COMPLETED', 'DISPATCHED', 'OK'].includes(s)) {
    return 'green';
  }
  if (['WARNING', 'EXPIRING', 'EXPIRING_SOON', 'PARTIALLY_PAID', 'PENDING_REVIEW', 'STALE', 'PENDING'].includes(s)) {
    return 'orange';
  }
  if (['FAILED', 'EXPIRED', 'REJECTED', 'BLOCKED', 'MISSING', 'CANCELLED', 'NOT_AVAILABLE'].includes(s)) {
    return 'red';
  }
  if (['PENDING', 'NOT_RECORDED', 'NOT_APPLICABLE', 'NOT_CONNECTED', 'UNPAID', 'UNBILLED', 'ONGOING'].includes(s)) {
    return 'grey';
  }
  return 'grey';
}

const TONE = {
  green: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  orange: 'border-amber-200 bg-amber-50 text-amber-800',
  red: 'border-red-200 bg-red-50 text-red-800',
  grey: 'border-slate-200 bg-slate-50 text-slate-600',
  blue: 'border-sky-200 bg-sky-50 text-sky-800',
};

/** A status badge. `state` is any backend state string; `label` overrides the text. */
export function Badge({ state, label, tone, className = '' }) {
  const t = tone || toneFor(state);
  return (
    <span className={cx(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide',
      TONE[t] || TONE.grey,
      className,
    )}
    >
      {label || String(state || '—').replace(/_/g, ' ')}
    </span>
  );
}

/**
 * The traffic light the specification asks for:
 *   🟢 Valid · 🟠 Expiring Soon · 🔴 Expired
 * A missing document is grey — "not recorded" is not the same as "expired".
 */
export function ExpiryBadge({ state, expiry }) {
  const map = {
    VALID: { tone: 'green', label: '🟢 Valid' },
    EXPIRING_SOON: { tone: 'orange', label: '🟠 Expiring Soon' },
    EXPIRED: { tone: 'red', label: '🔴 Expired' },
    NOT_RECORDED: { tone: 'grey', label: '— Not recorded' },
    UNKNOWN: { tone: 'orange', label: '⚠ Unreadable date' },
  };
  const cfg = map[String(state || '').toUpperCase()] || map.NOT_RECORDED;
  return (
    <Badge
      tone={cfg.tone}
      label={cfg.label}
      className={expiry ? 'font-semibold normal-case tracking-normal' : ''}
    />
  );
}

/**
 * One row of the readiness checklist.
 *
 * The MESSAGE is the point. The old screen said "The server has not cleared this
 * step yet", which told an operator nothing they could act on; every row here
 * carries the server's own sentence, which names what is missing and (where one
 * exists) what to do about it.
 */
export function CheckRow({ check }) {
  if (!check) return null;
  const state = String(check.state || 'pending').toLowerCase();
  const mark = { passed: '✓', failed: '✕', warning: '⚠', pending: '—' }[state] || '—';
  const color = {
    passed: 'text-emerald-600',
    failed: 'text-red-600',
    warning: 'text-amber-600',
    pending: 'text-muted',
  }[state] || 'text-muted';

  return (
    <li className="flex items-start gap-2 border-b border-border/60 py-2 last:border-b-0">
      <span className={cx('mt-0.5 w-4 shrink-0 text-center text-[13px] font-bold', color)} aria-hidden="true">
        {mark}
      </span>
      <div className="min-w-0 flex-1">
        <p className={cx('text-[12.5px] font-semibold', state === 'passed' ? 'text-text' : 'text-text')}>
          {check.label}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{check.message}</p>
        {check.action ? (
          <p className="mt-0.5 text-[11.5px] font-semibold text-amber-700">{check.action}</p>
        ) : null}
        {check.detail && state !== 'passed' ? (
          <p className="mt-0.5 text-[11px] leading-snug text-muted/80">{check.detail}</p>
        ) : null}
      </div>
    </li>
  );
}

/** A labelled input. Every form on this page uses it, so the page is uniform. */
export function Field({ label, hint, error, children, required }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted">
        {label}
        {required ? <span className="ml-0.5 text-red-500">*</span> : null}
      </span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[11px] text-muted">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[11px] font-semibold text-red-600">{error}</span> : null}
    </label>
  );
}

export const inputClass =
  'mt-1 w-full rounded-lg border border-border bg-white px-2.5 py-2 text-[13px] font-normal text-text outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-200';

/** A two-option Yes / No selector — used for POD Required and Insured. */
export function YesNo({ value, onChange, name, disabled }) {
  const current = value === true ? 'yes' : value === false ? 'no' : '';
  const option = (key, label) => (
    <label
      key={key}
      className={cx(
        'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition',
        disabled && 'cursor-not-allowed opacity-50',
        current === key
          ? 'border-amber-500 bg-amber-50 text-amber-800'
          : 'border-border bg-white text-muted hover:bg-slate-50',
      )}
    >
      <input
        type="radio"
        name={name}
        value={key}
        checked={current === key}
        onChange={() => onChange(key === 'yes')}
        disabled={disabled}
        className="sr-only"
      />
      {label}
    </label>
  );
  return (
    <div className="mt-1 flex gap-2">
      {option('yes', 'Yes')}
      {option('no', 'No')}
    </div>
  );
}

/**
 * A banner that says something the operator must not miss.
 *
 * `tone` is 'info' | 'warn' | 'danger' | 'success'. This is the one place the
 * e-way bill's honesty notice and the "not a government e-invoice" statement are
 * rendered, so those sentences cannot drift between screens.
 */
export function Notice({ tone = 'info', title, children, icon }) {
  const styles = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-300 bg-amber-50 text-amber-900',
    danger: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  };
  const Icon = icon || (tone === 'warn' || tone === 'danger' ? AlertTriangle : Info);
  return (
    <div className={cx('flex items-start gap-2 rounded-lg border px-3 py-2', styles[tone])} role="status">
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 text-[12px] leading-snug">
        {title ? <p className="font-bold uppercase tracking-wide">{title}</p> : null}
        <div className={title ? 'mt-0.5' : ''}>{children}</div>
      </div>
    </div>
  );
}

/**
 * THE CONFIRMATION MODAL.
 *
 * Opening it is not enough to dispatch — nothing is sent until
 * "Confirm Dispatch" is pressed. It restates the facts the operator is about to
 * commit, all of them read from the workspace payload, so the numbers in the
 * modal and the numbers in the record that gets written are the same numbers.
 */
export function ConfirmModal({ open, title, onCancel, onConfirm, busy, children, confirmLabel = 'Confirm Dispatch' }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-white shadow-xl"
        tabIndex={-1}
        ref={ref}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-bold uppercase tracking-[0.14em] text-amber-700">{title}</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-muted transition hover:bg-slate-100 hover:text-text"
            aria-label="Close"
          >
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 py-3">{children}</div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded-lg bg-amber-600 px-4 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Dispatching…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A labelled row inside the confirmation modal. */
export function ConfirmRow({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border/60 py-1.5 last:border-b-0">
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-muted">{label}</span>
      <span className="text-right text-[13px] font-semibold text-text">{value ?? '—'}</span>
    </div>
  );
}

/** The green "this has happened" panel, reused after a successful dispatch. */
export function DoneBanner({ title, children }) {
  return (
    <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Check size={16} className="text-emerald-700" aria-hidden="true" />
        <p className="text-[13px] font-bold uppercase tracking-[0.14em] text-emerald-800">
          {title || 'Recorded'}
        </p>
      </div>
      {children}
    </section>
  );
}

/** ₹ formatting matching the backend's en-IN grouping. */
export function inr(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A date, or an explicit dash. Never "Invalid Date". */
export function fmtDate(value, withTime = false) {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', withTime
    ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A compact definition list used by the read-only fact panels. */
export function Facts({ items, columns = 3 }) {
  const cols = columns === 2 ? 'sm:grid-cols-2' : columns === 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3';
  return (
    <dl className={cx('grid grid-cols-2 gap-x-4 gap-y-3', cols)}>
      {items.filter(Boolean).map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{f.label}</dt>
          <dd className="break-words text-[13px] font-semibold text-text">{f.value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export { cx };

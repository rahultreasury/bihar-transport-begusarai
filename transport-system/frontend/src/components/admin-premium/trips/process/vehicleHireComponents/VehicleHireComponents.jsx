import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Percent, Building2, Truck, AlertTriangle, FileText, ShieldAlert, Download, Share2, ArrowLeft } from 'lucide-react';

import { FormField } from '../../../ui';

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATTING
   ─────────────────────────────────────────────────────────────────────────
   Currency formatting matches the rest of the console (en-IN grouping). Paise
   are shown only when they are non-zero, so a round rupee figure reads cleanly
   to an operator while a fractional rupee is never silently rounded away.
   ═══════════════════════════════════════════════════════════════════════════ */

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});

export function inr(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '₹0';
  return rupees.format(n);
}

/** Money as a bare number, for placing inside a ₹ prefix. */
export function amount(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value).replace(/[_-]+/g, ' ').trim();
  if (!text) return '—';
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPACT SEGMENTED CONTROL
   ─────────────────────────────────────────────────────────────────────────
   Replaces the giant radio-card layout with a compact segmented control that
   reads as one family. Built from the same tokens the shared Button and
   FormField use, so it needs no new styling to look native.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SegmentedControl({ name, value, options, onChange, columns = 2, disabled = false, className = '' }) {
  const gridCols = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'sm:grid-cols-4',
  }[columns] || 'grid-cols-2';

  return (
    <div
      role="radiogroup"
      aria-label={name}
      className={`grid gap-1.5 ${gridCols} ${className}`}
    >
      {options.map((opt) => {
        const selected = String(value) === String(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              'flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-center text-[13px] font-semibold transition-all',
              'disabled:cursor-not-allowed disabled:opacity-60',
              selected
                ? 'border-bt-orange bg-bt-orange-light/60 text-bt-navy ring-1 ring-bt-orange/25'
                : 'border-bt-border bg-white text-bt-ink-2 hover:bg-bt-surface-soft hover:text-bt-navy',
            ].join(' ')}
          >
            {opt.icon ? <opt.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} /> : null}
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEARCHABLE SELECTOR
   ─────────────────────────────────────────────────────────────────────────
   Vehicle / vendor / driver are chosen from the EXISTING masters, never typed
   in. A free-text box filters the list live; picking a row returns the id, and
   the caller re-fetches that master so every related field — vendor mobile,
   driver mobile, document expiries — is auto-populated from the database
   rather than being copied out of the list response.
   ═══════════════════════════════════════════════════════════════════════════ */

export function SearchableSelect({
  id,
  label,
  hint,
  error,
  required,
  value,
  options,
  loading,
  onSearch,
  onSelect,
  formatOption,
  formatSelected,
  placeholder = 'Type to search…',
  emptyLabel = 'No matches',
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const boxRef = useRef(null);

  const selected = options.find((o) => String(o.id) === String(value));

  // Debounced search — the operator types a vehicle number and the list narrows
  // without one request per keystroke.
  useEffect(() => {
    if (!open) return undefined;
    const handle = setTimeout(() => onSearch(term), 250);
    return () => clearTimeout(handle);
  }, [term, open, onSearch]);

  useEffect(() => {
    if (!open) return undefined;
    const onClickAway = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, [open]);

  return (
    <div className="relative" ref={boxRef}>
      <FormField label={label} hint={hint} error={error} required={required} htmlFor={id}>
        <div className="relative">
          <input
            id={id}
            type="text"
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-listbox`}
            autoComplete="off"
            disabled={disabled}
            value={open ? term : (selected ? formatSelected(selected) : '')}
            onChange={(e) => setTerm(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={selected ? formatSelected(selected) : placeholder}
            className={`bt-input bt-input-sm ${error ? 'border-bt-danger' : ''}`}
          />
          {loading ? (
            <span className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-bt-ink-3 border-t-transparent" />
          ) : null}
          {open ? (
            <div
              id={`${id}-listbox`}
              role="listbox"
              className="absolute z-30 mt-1.5 max-h-64 w-full overflow-y-auto rounded-lg border border-bt-border bg-white py-1 shadow-lg"
            >
              {options.length === 0 ? (
                <p className="px-3 py-2.5 text-[13px] text-bt-ink-2">{emptyLabel}</p>
              ) : (
                options.map((opt) => {
                  const isSelected = String(opt.id) === String(value);
                  // The server ranked these vacant-first and labelled each one for
                  // THIS consignment's pickup. A resource that cannot be used is
                  // shown, labelled, and NOT selectable — so the operator can see
                  // why something is unavailable instead of wondering where it
                  // went, and cannot pick it and be rejected by the server.
                  const availability = opt.availability || null;
                  const pickable = availability === null
                    || availability === 'AVAILABLE'
                    || availability === 'CONFLICT';
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      aria-disabled={pickable ? undefined : 'true'}
                      disabled={!pickable}
                      title={opt.availability_reason || undefined}
                      data-availability={availability || undefined}
                      onClick={() => {
                        if (!pickable) return;
                        onSelect(opt);
                        setOpen(false);
                        setTerm('');
                      }}
                      className={`flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-[13px] transition-colors ${
                        !pickable
                          ? 'cursor-not-allowed text-bt-ink-3'
                          : isSelected
                            ? 'bg-bt-orange-light/60 font-semibold text-bt-navy'
                            : 'text-bt-navy hover:bg-bt-surface-soft'
                      }`}
                    >
                      <span className="min-w-0 truncate">{formatOption(opt)}</span>
                      <span className="flex shrink-0 items-center gap-1">
                        {availability ? (
                          <span
                            className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                              availability === 'AVAILABLE'
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                                : availability === 'CONFLICT'
                                  ? 'border-sky-300 bg-sky-50 text-sky-700'
                                  : 'border-amber-300 bg-amber-50 text-amber-700'
                            }`}
                          >
                            {availability === 'AVAILABLE' ? 'Available' : availability === 'CONFLICT' ? 'Assigned' : availability === 'BUSY' ? 'Busy' : 'Unavailable'}
                          </span>
                        ) : null}
                        {isSelected ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-bt-orange" /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </FormField>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   COMPACT INFO ROW — label on top, value below, no vertical gap
   ═══════════════════════════════════════════════════════════════════════════ */

export function InfoRow({ label, value, icon: Icon, valueClassName = '' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5 text-bt-ink-3" strokeWidth={2.2} /> : null}
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-bt-ink-3">
          {label}
        </span>
      </div>
      <span className={`text-[14px] font-semibold text-bt-navy break-words ${valueClassName}`}>
        {value === null || value === undefined || value === '' ? '—' : value}
      </span>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MONEY LINE
   ─────────────────────────────────────────────────────────────────────────
   One row of the money block. `emphasis` is reserved for Net Vendor Payable —
   the single figure an operator is about to act on. Gross and Commission are
   shown at their normal weight so the three read as one arithmetic column
   rather than three competing headlines.
   ═══════════════════════════════════════════════════════════════════════════ */

export function MoneyLine({ label, value, prefix = '', caption, emphasis = false, tone = 'normal', muted = false }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-bt-border/70 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className={`text-[11px] font-semibold uppercase tracking-wider ${tone === 'muted' ? 'text-bt-ink-3' : 'text-bt-ink-2'}`}>
          {label}
        </p>
        {caption ? <p className="mt-0.5 text-[11px] text-bt-ink-3">{caption}</p> : null}
      </div>
      <p
        className={[
          'shrink-0 tabular-nums',
          emphasis ? 'text-[20px] font-bold text-bt-navy' : 'text-[15px] font-semibold text-bt-navy',
          muted ? 'opacity-40' : '',
        ].join(' ')}
      >
        {prefix ? `${prefix} ` : ''}
        ₹{amount(value)}
      </p>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   DOCUMENT STATUS PRESENTATION
   ─────────────────────────────────────────────────────────────────────────
   🟢 Valid   🟠 Expiring Soon   🔴 Expired   ⚪ Not recorded
   ═══════════════════════════════════════════════════════════════════════════ */

const DOC_STATUS = {
  VALID: { dot: 'bg-emerald-500', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Valid', icon: CheckCircle2 },
  EXPIRING_SOON: { dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Expiring Soon', icon: AlertTriangle },
  EXPIRED: { dot: 'bg-red-500', chip: 'bg-red-50 text-red-700 border-red-200', label: 'Expired', icon: ShieldAlert },
  NOT_RECORDED: { dot: 'bg-slate-300', chip: 'bg-slate-50 text-slate-500 border-slate-200', label: 'Not recorded', icon: FileText },
};

export function docStatus(status) {
  return DOC_STATUS[status] || DOC_STATUS.NOT_RECORDED;
}

/* ════════════════════════════════════════════════════════════════════════════
   DOCUMENT ICON TILE
   ═══════════════════════════════════════════════════════════════════════════ */

export function DocumentIconTile({ doc, warningDays }) {
  const tone = docStatus(doc.status);
  const Icon = tone.icon;
  return (
    <div
      className="flex flex-col items-center gap-1.5 rounded-lg border border-bt-border/50 bg-bt-surface-soft p-3 text-center"
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} aria-hidden="true" />
      <p className="text-[12px] font-bold text-bt-navy leading-tight">
        {doc.label}
      </p>
      <p className="text-[11px] text-bt-ink-2">
        {doc.expiry_date ? doc.expiry_date : 'No date'}
      </p>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-bold ${tone.chip}`}
      >
        <Icon className="h-2.5 w-2.5" strokeWidth={2.4} />
        {tone.label}
      </span>
    </div>
  );
}
/**
 * shared.jsx — the small finance-specific building blocks.
 *
 * These sit on top of the console design system: they do not introduce new
 * colours or radii, only the compositions the Finance tabs repeat (a money
 * cell, a stat strip, a paginated table card).
 */

import React from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Inbox } from 'lucide-react';

import SectionCard from '../ui/SectionCard';
import PremiumTable from '../ui/PremiumTable';
import { Button } from '../ui';
import { inr, number } from './format';

export function Money({ value, tone = 'default', className = '' }) {
  const n = Number(value) || 0;
  const resolved =
    tone === 'auto'
      ? n > 0
        ? 'negative'
        : n < 0
          ? 'positive'
          : 'muted'
      : tone;
  const classes = {
    default: 'text-bt-navy',
    positive: 'text-emerald-600',
    negative: 'text-red-600',
    muted: 'text-bt-ink-3',
    warning: 'text-amber-600',
  }[resolved] || 'text-bt-navy';
  return <span className={`font-semibold tabular-nums ${classes} ${className}`}>{inr(n)}</span>;
}

export function MiniStat({ label, value, hint, tone = 'default', icon: Icon }) {
  return (
    <div className="rounded-xl border border-bt-border bg-white p-3.5">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 text-bt-orange" strokeWidth={2.2} /> : null}
        <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-bt-ink-3">{label}</span>
      </div>
      <div className={`mt-1.5 text-[20px] font-bold leading-none tabular-nums ${
        tone === 'positive' ? 'text-emerald-600'
          : tone === 'negative' ? 'text-red-600'
            : tone === 'warning' ? 'text-amber-600'
              : 'text-bt-navy'
      }`}>
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[11.5px] text-bt-ink-2">{hint}</div> : null}
    </div>
  );
}

export function StatStrip({ children, className = '' }) {
  return <div className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${className}`}>{children}</div>;
}

export function ErrorBlock({ message, onRetry }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-[13px] text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">Could not load this section</p>
        <p className="mt-0.5 text-red-600">{message}</p>
      </div>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Note({ children, tone = 'info' }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    neutral: 'border-bt-border bg-slate-50 text-bt-ink-2',
  };
  return (
    <div className={`rounded-xl border p-3.5 text-[12.5px] leading-relaxed ${tones[tone] || tones.info}`}>
      {children}
    </div>
  );
}

export function TableCard({
  title,
  subtitle,
  icon,
  action,
  columns,
  rows,
  loading,
  onRowClick,
  getRowId,
  footer,
  padded = false,
  className = '',
}) {
  return (
    <SectionCard title={title} subtitle={subtitle} icon={icon} action={action} padded={padded} className={className}>
      <PremiumTable
        columns={columns}
        rows={rows || []}
        loading={loading}
        onRowClick={onRowClick}
        getRowId={getRowId}
      />
      {footer ? <div className="border-t border-bt-border p-3.5">{footer}</div> : null}
    </SectionCard>
  );
}

export function Pager({ pagination, onPage }) {
  if (!pagination) return null;
  const { page = 1, pages = 1, total = 0, limit = 25 } = pagination;
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12px] text-bt-ink-2">
        Showing <span className="font-semibold text-bt-navy">{number((page - 1) * limit + 1)}</span>–
        <span className="font-semibold text-bt-navy">{number(Math.min(page * limit, total))}</span> of{' '}
        <span className="font-semibold text-bt-navy">{number(total)}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          Icon={ChevronLeft}
          onClick={() => onPage(Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Prev
        </Button>
        <span className="px-2 text-[12px] font-semibold text-bt-ink-2">
          {page} / {pages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          IconRight={ChevronRight}
          onClick={() => onPage(Math.min(pages, page + 1))}
          disabled={page >= pages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function EmptyBlock({ title = 'Nothing here yet', subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bt-orange-light text-bt-orange-dark">
        <Inbox className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-bt-navy">{title}</p>
      {subtitle ? <p className="max-w-md text-[12.5px] text-bt-ink-2">{subtitle}</p> : null}
    </div>
  );
}

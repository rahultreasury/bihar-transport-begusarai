/**
 * FinanceFilters — the one filter strip every Finance tab shares.
 *
 * The date range and branch are applied by the BACKEND, not by filtering rows
 * in the browser. A preset is therefore just a shortcut that fills the same two
 * date inputs, and "All branches" is the absence of a branch filter.
 */

import React from 'react';
import { CalendarRange, Download, RefreshCw, RotateCcw } from 'lucide-react';

import { Button, FilterSelect, SearchBar } from '../ui';

const PRESETS = [
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
  { key: 'THIS_QUARTER', label: 'This quarter' },
  { key: 'THIS_YEAR', label: 'This year' },
  { key: 'LAST_12', label: 'Last 12 months' },
  { key: 'ALL', label: 'All time' },
];

const iso = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function presetRange(key, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  if (key === 'THIS_MONTH') {
    return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
  if (key === 'LAST_MONTH') {
    return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  }
  if (key === 'THIS_QUARTER') {
    const q = Math.floor(m / 3) * 3;
    return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
  }
  if (key === 'LAST_12') {
    return { from: iso(new Date(y, m - 11, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
  if (key === 'ALL') {
    return { from: '2018-01-01', to: iso(new Date(y + 1, 11, 31)) };
  }
  return { from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
}

export default function FinanceFilters({
  filters,
  branches = [],
  onApply,
  onReset,
  onRefresh,
  onExport,
  refreshing = false,
  search,
  onSearch,
  searchPlaceholder = 'Search invoice, party, voucher…',
  children,
}) {
  const [draft, setDraft] = React.useState(filters);

  React.useEffect(() => {
    setDraft(filters);
  }, [filters.from, filters.to, filters.branch]);

  const applyPreset = (key) => {
    const range = presetRange(key);
    const next = { ...draft, ...range };
    setDraft(next);
    onApply(next);
  };

  return (
    <div className="bt-card mb-5 p-4 sm:p-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="bt-label">From</span>
            <input
              type="date"
              className="bt-input"
              value={draft.from || ''}
              onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            />
          </label>
          <label className="block">
            <span className="bt-label">To</span>
            <input
              type="date"
              className="bt-input"
              value={draft.to || ''}
              onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            />
          </label>
           <Button variant="primary" Icon={CalendarRange} onClick={() => onApply(draft)}>
            Apply
          </Button>
          <Button variant="ghost" Icon={RotateCcw} onClick={onReset}>
            Reset
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => applyPreset(p.key)}
                className="rounded-full border border-bt-border bg-white px-2.5 py-1 text-[11.5px] font-semibold text-bt-ink-2 transition-colors hover:border-bt-orange hover:text-bt-navy"
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" Icon={RefreshCw} loading={refreshing} onClick={onRefresh}>
            Refresh
          </Button>
          {onExport ? (
            <Button variant="secondary" Icon={Download} onClick={onExport}>
              Export
            </Button>
          ) : null}
        </div>
      </div>

      {(onSearch || children) ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-bt-border pt-4 sm:flex-row sm:flex-wrap sm:items-center">
          {onSearch ? (
            <SearchBar
              value={search}
              onChange={onSearch}
              placeholder={searchPlaceholder}
              className="w-full sm:max-w-sm"
            />
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}

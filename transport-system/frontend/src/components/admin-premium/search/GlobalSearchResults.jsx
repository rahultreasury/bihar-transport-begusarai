import React, { useMemo } from 'react';
import {
  Search,
  User,
  Truck,
  Car,
  Package,
  FileText,
  CreditCard,
  Receipt,
  Users,
  Building2,
  Briefcase,
} from 'lucide-react';

const ICONS = {
  drivers: User,
  vehicle_owners: Building2,
  vehicles: Car,
  clients: Briefcase,
  customers: Users,
  bookings: Package,
  enquiries: FileText,
  partners: Building2,
  trips: Truck,
  financial_transactions: CreditCard,
  invoices: Receipt,
  settlements: CreditCard,
  expenses: CreditCard,
  admins: User,
};

function highlight(text, query) {
  const value = String(text ?? '');
  if (!query) return value;
  const q = query.trim();
  if (!q) return value;
  const lower = value.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx === -1) return value;
  const before = value.slice(0, idx);
  const match = value.slice(idx, idx + needle.length);
  const after = value.slice(idx + needle.length);
  return (
    <>
      {before}
      <mark className="rounded bg-amber-100 px-0.5 text-amber-900">{match}</mark>
      {highlight(after, query)}
    </>
  );
}

export default function GlobalSearchResults({
  results,
  loading,
  error,
  totalResults,
  query,
  activeIndex,
  flat,
  onHover,
  onSelect,
}) {
  const q = query.trim();

  if (loading && results.length === 0) {
    return (
      <div className="flex items-center justify-center py-10 text-sm text-slate-500">
        <Search className="mr-2 h-4 w-4 animate-pulse" />
        Searching…
      </div>
    );
  }

  if (error) {
    return <div className="py-8 text-center text-sm text-red-500">{error}</div>;
  }

  if (!q) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        Type to search across Bihar Transport…
      </div>
    );
  }

  if (results.length === 0 || totalResults === 0) {
    return (
      <div className="py-8 text-center text-sm text-slate-500">
        No results found for “{q}”.
      </div>
    );
  }

  let runningIndex = 0;
  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {results.map((category) => {
        const Icon = ICONS[category.module] || Search;
        const startIndex = runningIndex;
        runningIndex += category.results.length;
        return (
          <div key={category.module} className="border-b border-slate-100 last:border-b-0">
            <div className="sticky top-0 z-10 bg-slate-50 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {category.label} · {category.count}
            </div>
            <ul>
              {category.results.map((item, idx) => {
                const globalIndex = startIndex + idx;
                const isActive = globalIndex === activeIndex;
                return (
                  <li key={`${category.module}-${item.id}-${idx}`}>
                    <button
                      type="button"
                      onMouseEnter={() => onHover?.(globalIndex)}
                      onClick={() => onSelect?.(item)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                        isActive ? 'bg-amber-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">
                          {highlight(item.title, q)}
                        </span>
                        {item.subtitle ? (
                          <span className="block truncate text-[12px] text-slate-500">
                            {highlight(item.subtitle, q)}
                          </span>
                        ) : null}
                        {item.meta ? (
                          <span className="block truncate text-[11px] text-slate-400">{item.meta}</span>
                        ) : null}
                      </span>
                      {item.badge ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                          {item.badge}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      {totalResults > flat.length ? (
        <div className="px-4 py-3 text-center text-[12px] text-slate-500">
          Showing {flat.length} of {totalResults} results
        </div>
      ) : null}
    </div>
  );
}

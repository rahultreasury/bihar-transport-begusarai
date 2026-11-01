import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Command } from 'lucide-react';
import useGlobalSearch from '../../../hooks/useGlobalSearch';
import GlobalSearchResults from './GlobalSearchResults';

export default function GlobalSearch({
  placeholder = 'Search anything across Bihar Transport...',
  inputClassName = '',
  wrapperClassName = '',
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const modalInputRef = useRef(null);
  const panelRef = useRef(null);

  const { results, loading, error, totalResults } = useGlobalSearch(query, true);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const flat = useMemo(
    () => results.flatMap((cat) => cat.results.map((r) => ({ ...r, category: cat.label, module: cat.module }))),
    [results]
  );

  // Keep active index in range.
  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  // Global keyboard shortcut + escape.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Focus modal input when opened.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => modalInputRef.current?.focus(), 30);
      document.body.style.overflow = 'hidden';
      return () => {
        clearTimeout(t);
        document.body.style.overflow = '';
      };
    }
    document.body.style.overflow = '';
  }, [open]);

  const handleSelect = useCallback(
    (item) => {
      setOpen(false);
      setQuery('');
      if (item?.route) navigate(item.route);
    },
    [navigate]
  );

  const handleKeyDown = (e) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (flat[activeIndex]) handleSelect(flat[activeIndex]);
    }
  };

  // Click outside panel closes.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <>
      <div className={`relative w-full ${wrapperClassName}`}>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7C93]"
            strokeWidth={1.9}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            className={
              inputClassName ||
              'h-[38px] w-full rounded-[9px] border border-[#E4E9F1] bg-[#F8FAFD] pl-10 pr-16 text-[13px] text-[#243B5A] outline-none transition-colors placeholder:text-[#7B8CA3] focus:border-[#B9C9DE] focus:bg-white focus:ring-2 focus:ring-[#1764E8]/10 [&::-webkit-search-cancel-button]:hidden'
            }
            aria-label="Global search"
          />
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-bt-ink-3 transition-colors hover:bg-bt-orange-light hover:text-bt-navy"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center rounded-[5px] border border-[#DDE4EE] bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[#8797AB] sm:flex">
              ⌘ K
            </kbd>
          )}
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-900/40 px-4 pt-[10vh] backdrop-blur-sm">
          <div
            ref={panelRef}
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_-18px_rgba(15,43,85,0.45)]"
            onKeyDown={handleKeyDown}
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                ref={modalInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="h-9 flex-1 bg-transparent text-[14px] text-slate-900 outline-none placeholder:text-slate-400"
                aria-label="Global search input"
              />
              {loading ? <span className="text-[11px] text-slate-400">Searching…</span> : null}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close search"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <GlobalSearchResults
              results={results}
              loading={loading}
              error={error}
              totalResults={totalResults}
              query={query}
              activeIndex={activeIndex}
              flat={flat}
              onHover={setActiveIndex}
              onSelect={handleSelect}
            />
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-2 text-[11px] text-slate-500">
              <span>↑↓ navigate · Enter open · Esc close</span>
              <span>{totalResults} result{totalResults === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

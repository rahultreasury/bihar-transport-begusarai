/**
 * PremiumCombobox.jsx
 * ---------------------------------------------------------------------------
 * The searchable selector behind every resource picker in the admin ENQUIRY
 * workspace (vehicle, driver, transport owner, transport partner).
 *
 * WHY A COMBOBOX AND NOT A <select>
 *   The options endpoint returns a bounded but growing set — up to 500 vehicles
 *   and 500 drivers today, thousands later. A native <select> renders every
 *   row at once and gives an operator no way to find "BR01STEP001" in a list of
 *   500 registration numbers. This component renders a SHORT list first, adds
 *   more only when asked (scroll / "Show more"), and filters instantly.
 *
 * DESIGN CONTRACT
 *   • Matches the Bihar Transport admin language: navy #1e3a5f, amber #f59e0b,
 *     white surfaces, hairline borders, 12px radius, one soft shadow.
 *   • No gradients, no cartoon icons, no Bootstrap-looking form control.
 *
 * SCALE CONTRACT
 *   The list area is capped at MAX_RENDERED rows even if 10,000 records match,
 *   so the DOM never explodes. Everything else degrades gracefully.
 *
 * ACCESSIBILITY CONTRACT
 *   Trigger is a real <button>; the search field is a WAI-ARIA combobox
 *   (aria-expanded / aria-controls / aria-activedescendant) driving a listbox.
 *   ArrowUp/ArrowDown move the highlight, Home/End jump, Enter selects the
 *   highlighted row, Escape closes and returns focus to the trigger.
 *
 * DATA CONTRACT
 *   This component is presentation-only. It never fetches, never mutates and
 *   never reshapes ids: `onChange` emits the caller's own id as a STRING, which
 *   is exactly what the previous native <select> produced, so every existing
 *   assignment payload stays byte-identical.
 */

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, Search, X } from 'lucide-react';

/** Rows revealed per "page" — the incremental-loading step. */
const STEP = 8;

/**
 * Hard ceiling on mounted rows. Past this the operator must narrow the search.
 * This is what keeps a 10,000-row match set from becoming a 10,000-node list.
 */
const MAX_RENDERED = 60;

/* ── Shared helpers ──────────────────────────────────────────────────────── */

/** `12_000.4` → "12,000". Returns null for anything that is not a real number. */
export function formatKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${Math.round(n).toLocaleString('en-IN')} kg`;
}

/** `tata_1613` / `On Trip` → a short uppercase label. */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).replace(/[_-]+/g, ' ').trim().toUpperCase();
}

/**
 * Wraps every occurrence of `query` inside `text` in a <mark>.
 * Used by the callers' render functions to highlight what actually matched.
 */
export function Highlight({ text, query }) {
  // Non-string children (icons, fragments) are passed straight through — only
  // plain text is ever scanned for a match, so a React node can never be
  // coerced into "[object Object]".
  if (text === null || text === undefined) return null;
  if (typeof text !== 'string') return text;

  const raw = text;
  const needle = (query || '').trim();
  if (!needle || !raw) return raw;

  const haystack = raw.toLowerCase();
  const target = needle.toLowerCase();
  const index = haystack.indexOf(target);
  if (index === -1) return raw;

  return (
    <>
      {raw.slice(0, index)}
      <mark className="rounded-[3px] bg-amber-100 px-[1px] font-semibold text-[#1e3a5f]">
        {raw.slice(index, index + needle.length)}
      </mark>
      {raw.slice(index + needle.length)}
    </>
  );
}

/* ── Component ───────────────────────────────────────────────────────────── */

export default function PremiumCombobox({
  /* identity */
  id,
  label,
  hint,
  icon: Icon,
  required = false,
  disabled = false,
  className = '',

  /* value binding */
  value,
  onChange,
  options,
  getOptionId,
  getKeywords,
  renderOption,
  renderSelected,

  /* copy */
  searchPlaceholder = 'Search…',
  emptyTitle,
  emptyHint,
  noun = 'records',
  selectedPrompt = 'Select',
  selectedFallback = null,

  /* data state */
  loading = false,
}) {
  const uid = useId();
  // React 18's useId emits ids containing colons. They are legal in HTML but
  // break CSS/querySelector, and these ids are interpolated into ARIA
  // references, so strip them.
  const inputId = id || `pcb-${uid.replace(/:/g, '')}`;
  const listId = `${inputId}-list`;
  const labelId = `${inputId}-label`;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(-1);
  const [visibleCount, setVisibleCount] = useState(STEP);
  const [dropUp, setDropUp] = useState(false);

  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const list = useMemo(() => (Array.isArray(options) ? options : []), [options]);
  const hasValue = value !== null && value !== undefined && value !== '';

  /* Debounce the query. The backend has no search parameter for these option
     sets, so this is client-side filtering (see filter step below) — 120ms is
     short enough to feel instant and long enough to skip mid-word re-renders. */
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 120);
    return () => clearTimeout(t);
  }, [search]);

  /* ── Filtering (client-side; no backend change) ──────────────────────── */
  const filtered = useMemo(() => {
    const terms = debounced.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return list;
    return list.filter((item) => {
      // Normalise the keyword shape before matching. `getKeywords` is a caller
      // contract, and a caller returning a single string instead of an array
      // would otherwise throw inside this filter — which takes down the whole
      // page via the error boundary, not just the dropdown.
      const raw = getKeywords(item);
      const keys = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
      if (!keys.length) return false;
      return terms.every((term) => keys.some((k) => String(k).includes(term)));
    });
  }, [list, debounced, getKeywords]);

  /* Ceiling the mounted rows, independently of how many matched. */
  const capped = filtered.length > MAX_RENDERED;
  const rows = useMemo(
    () => filtered.slice(0, Math.min(visibleCount, MAX_RENDERED)),
    [filtered, visibleCount],
  );
  const hasMore = filtered.length > rows.length;

  /* ── Selected item resolution ─────────────────────────────────────────── */

  /**
   * The selected record may legitimately be missing from the assignable list —
   * the backend pre-filters options to resources that are currently valid, but
   * an already-assigned vehicle can sit outside that set. Showing the id alone
   * would be a blank field, so the caller may pass `selectedFallback` (the
   * record from the enquiry payload) to render the real identity instead.
   */
  const selected = useMemo(() => {
    if (!hasValue) return null;
    const found = list.find((item) => String(getOptionId(item)) === String(value));
    return found || selectedFallback || null;
  }, [hasValue, list, getOptionId, value, selectedFallback]);

  const isSelected = useCallback(
    (item) => hasValue && String(getOptionId(item)) === String(value),
    [hasValue, getOptionId, value],
  );

  /* ── Open / close ─────────────────────────────────────────────────────── */

  const openMenu = useCallback(() => {
    if (disabled) return;
    // Flip upward when there is not enough room below, so the list is never
    // pushed off-screen in the workspace's right-hand column.
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom;
      setDropUp(below < 320 && rect.top > below);
    }
    setOpen(true);
    setSearch('');
    setDebounced('');
    setVisibleCount(STEP);
    setActive(-1);
    // Focus after paint so the caret lands in the freshly opened field.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [disabled]);

  const closeMenu = useCallback((returnFocus = true) => {
    setOpen(false);
    setSearch('');
    setDebounced('');
    setActive(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  /* Click anywhere else closes it. */
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) closeMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, closeMenu]);

  /* A fresh result set always starts from the top of the list. */
  useEffect(() => {
    setActive(-1);
  }, [debounced, open]);

  /* ── Selection ────────────────────────────────────────────────────────── */

  const choose = useCallback(
    (item) => {
      onChange?.(getOptionId(item) === undefined || getOptionId(item) === null
        ? ''
        : String(getOptionId(item)));
      closeMenu();
    },
    [getOptionId, onChange, closeMenu],
  );

  const clear = useCallback(
    (e) => {
      e.stopPropagation();
      onChange?.('');
    },
    [onChange],
  );

  const revealMore = useCallback(() => {
    setVisibleCount((c) => (c >= MAX_RENDERED ? c : c + STEP));
  }, []);

  /* ── Keyboard ─────────────────────────────────────────────────────────── */

  const move = useCallback(
    (delta) => {
      if (!rows.length) return;
      setActive((prev) => {
        const next = prev + delta;
        if (next < 0) return 0;
        if (next > rows.length - 1) return rows.length - 1;
        return next;
      });
    },
    [rows.length],
  );

  const onKeyDown = useCallback(
    (e) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (!open) openMenu();
          else move(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!open) openMenu();
          else move(-1);
          break;
        case 'Home':
          if (open) {
            e.preventDefault();
            setActive(rows.length ? 0 : -1);
          }
          break;
        case 'End':
          if (open) {
            e.preventDefault();
            setActive(rows.length - 1);
          }
          break;
        case 'PageDown':
          if (open) {
            e.preventDefault();
            move(STEP);
          }
          break;
        case 'PageUp':
          if (open) {
            e.preventDefault();
            move(-STEP);
          }
          break;
        case 'Enter':
          // Enter selects the highlighted row. `?? rows[0]` matters: `active`
          // is reset by an effect on the render AFTER a keystroke, so for one
          // frame it can point past the end of a freshly filtered list.
          if (open) {
            e.preventDefault();
            const target = (active >= 0 ? rows[active] : null) ?? rows[0];
            if (target) choose(target);
          } else {
            openMenu();
          }
          break;
        case 'Escape':
          if (open) {
            e.preventDefault();
            closeMenu();
          }
          break;
        case 'Tab':
          if (open) closeMenu(false);
          break;
        default:
          break;
      }
    },
    [open, openMenu, move, rows, active, choose, closeMenu],
  );

  /* Keep the highlighted row inside the scroll viewport. */
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector(`[data-cbx-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  /* Infinite scroll: reveal the next step before the user hits the very end. */
  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 48 && hasMore) revealMore();
  }, [hasMore, revealMore]);

  /* ── Render ───────────────────────────────────────────────────────────── */

  const emptyTitleText = emptyTitle || `No ${noun} found`;

  const triggerBody = selected ? (
    renderSelected?.(selected) ?? <span className="truncate text-[13px] font-semibold text-text">{String(getOptionId(selected))}</span>
  ) : (
    <span className="truncate text-[13px] font-medium text-slate-400">{selectedPrompt}</span>
  );

  return (
    <div className={className}>
      {/* ── Label ─────────────────────────────────────────────────────── */}
      <label
        htmlFor={inputId}
        id={labelId}
        className="mb-1.5 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-text"
      >
        {label}
        {required ? <span className="text-amber-600">*</span> : null}
      </label>

      <div ref={wrapRef} className="relative">
        {/* ── Closed state: the "field" ─────────────────────────────────
            The container owns the click-to-toggle so the chevron and the
            trigger share one behaviour, while the inner <button> is what
            actually receives focus and Enter/Space. The clear control is a
            SIBLING button, not a child — nested buttons are invalid HTML and
            break keyboard traversal. */}
        <div
          className={[
            'flex w-full items-center gap-2 rounded-xl border bg-white px-3 py-2 text-left transition',
            'shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
            hasValue ? 'border-amber-500 bg-amber-50/40' : 'border-border',
            disabled
              ? 'cursor-not-allowed bg-slate-50 opacity-70'
              : 'cursor-pointer hover:border-slate-300 hover:bg-slate-50/50 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/25',
          ].join(' ')}
          onClick={() => (open ? closeMenu() : openMenu())}
        >
          <button
            ref={triggerRef}
            type="button"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left outline-none"
          >
            <span className="sr-only">{label}: </span>
            {Icon ? (
              <span
                className={[
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition',
                  hasValue ? 'bg-amber-500 text-white' : 'bg-slate-100 text-muted',
                ].join(' ')}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden="true" />
              </span>
            ) : null}
            <span className="min-w-0 flex-1">{triggerBody}</span>
          </button>

          {hasValue ? (
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              aria-label={`Clear ${label}`}
              title={`Clear ${label}`}
              className="shrink-0 rounded-md p-1 text-muted transition hover:bg-slate-200/70 hover:text-text"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
            </button>
          ) : null}

          <span
            className={[
              'shrink-0 text-muted transition-transform duration-150',
              open ? 'rotate-180' : '',
            ].join(' ')}
          >
            <ChevronDown className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          </span>
        </div>

        {/* ── Open state: the popover ─────────────────────────────────── */}
        {open ? (
          <div
            data-drop={dropUp ? 'up' : 'down'}
            className={[
              'bt-popover absolute z-50 w-full overflow-hidden rounded-xl border border-border bg-white',
              'shadow-[0_18px_44px_-18px_rgba(16,24,40,0.30)]',
              dropUp ? 'bottom-[calc(100%+8px)]' : 'top-[calc(100%+8px)]',
            ].join(' ')}
          >
            {/* Search */}
            <div className="border-b border-border p-2.5">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted"
                  strokeWidth={2.25}
                  aria-hidden="true"
                />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  role="combobox"
                  aria-expanded="true"
                  aria-controls={listId}
                  aria-labelledby={labelId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    active >= 0 && rows[active] ? `${listId}-opt-${active}` : undefined
                  }
                  autoComplete="off"
                  spellCheck={false}
                  value={search}
                  placeholder={searchPlaceholder}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={onKeyDown}
                  className={[
                    'w-full rounded-lg border border-border bg-white py-2 pl-8 pr-2.5 text-[13px] font-medium text-text',
                    'outline-none transition placeholder:font-normal placeholder:text-slate-400',
                    'focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20',
                  ].join(' ')}
                />
                {loading ? (
                  <Loader2
                    className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-amber-500"
                    strokeWidth={2.5}
                    aria-hidden="true"
                  />
                ) : search ? (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted transition hover:bg-slate-100 hover:text-text"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={label}
              aria-labelledby={labelId}
              onScroll={onScroll}
              className="max-h-[300px] overflow-y-auto overscroll-contain p-1.5"
            >
              {loading && !rows.length ? (
                <div className="space-y-1.5 p-1.5" role="status" aria-busy="true">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2.5">
                      <div className="h-8 w-8 shrink-0 animate-pulse rounded-lg bg-skeleton" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div
                          className="h-2.5 animate-pulse rounded bg-skeleton"
                          style={{ width: `${70 - i * 8}%` }}
                        />
                        <div
                          className="h-2 animate-pulse rounded bg-skeleton"
                          style={{ width: `${48 - i * 6}%` }}
                        />
                      </div>
                    </div>
                  ))}
                  <span className="sr-only">Loading {noun}…</span>
                </div>
              ) : null}

              {!loading && !rows.length ? (
                <div className="px-3 py-7 text-center">
                  <p className="text-[13px] font-semibold text-text">{emptyTitleText}</p>
                  {emptyHint ? <p className="mt-1 text-[12px] text-muted">{emptyHint}</p> : null}
                </div>
              ) : null}

              {rows.map((item, index) => {
                const chosen = isSelected(item);
                const isActive = index === active;
                return (
                  <div
                    key={String(getOptionId(item))}
                    id={`${listId}-opt-${index}`}
                    data-cbx-index={index}
                    role="option"
                    aria-selected={chosen}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(item)}
                    className={[
                      'cursor-pointer rounded-lg px-2.5 py-2 transition-colors',
                      isActive ? 'bg-amber-50' : 'bg-transparent',
                    ].join(' ')}
                  >
                    {renderOption?.(item, {
                      query: debounced,
                      selected: chosen,
                      highlighted: isActive,
                    })}
                  </div>
                );
              })}

              {hasMore ? (
                <button
                  type="button"
                  onClick={revealMore}
                  className="mt-1 w-full rounded-lg border border-dashed border-border py-1.5 text-[11.5px] font-semibold text-muted transition hover:border-amber-300 hover:bg-amber-50/50 hover:text-amber-700"
                >
                  Show more
                </button>
              ) : null}
            </div>

            {/* Footer — honest counts, never a silent truncation. */}
            <div className="flex items-center justify-between gap-2 border-t border-border bg-slate-50/70 px-3 py-2">
              <p className="truncate text-[11px] font-medium text-muted" aria-live="polite">
                {rows.length
                  ? `Showing ${rows.length.toLocaleString('en-IN')} of ${filtered.length.toLocaleString('en-IN')} ${noun}`
                  : `0 ${noun}`}
                {capped ? ' — refine your search to narrow further' : ''}
              </p>
              <span className="hidden shrink-0 items-center gap-1 text-[10.5px] text-slate-400 sm:flex">
                <kbd className="rounded border border-border bg-white px-1 font-sans">↑↓</kbd>
                <kbd className="rounded border border-border bg-white px-1 font-sans">↵</kbd>
                <kbd className="rounded border border-border bg-white px-1 font-sans">esc</kbd>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {hint ? <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{hint}</p> : null}
    </div>
  );
}

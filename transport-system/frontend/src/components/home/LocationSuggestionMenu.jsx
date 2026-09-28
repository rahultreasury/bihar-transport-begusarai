/**
 * LocationSuggestionMenu.jsx
 * ---------------------------------------------------------------------------
 * Keyboard-navigable suggestion dropdown for the Home pickup / drop fields.
 *
 * Rendered through a PORTAL on `document.body` for two concrete reasons:
 *
 *   1. The hero section is `overflow-hidden`, so an absolutely-positioned menu
 *      inside the booking card would be clipped the moment it opened downward.
 *   2. The booking card sits in a `relative z-10` stacking context over the
 *      hero image. A menu nested inside it competes with the hero decorations;
 *      a body-level portal with a high z-index always paints on top.
 *
 * This menu is only a FALLBACK. While Google Places is live, Google's own
 * `.pac-container` owns the dropdown and this component renders nothing.
 */

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const MENU_MAX_HEIGHT = 240; // px — keeps a long list from covering the hero
const VIEWPORT_MARGIN = 8;

export default function LocationSuggestionMenu({
  anchorRef,
  items,
  activeIndex,
  onActiveIndexChange,
  onSelect,
  listId,
}) {
  const [placement, setPlacement] = useState(null);

  const measure = useCallback(() => {
    const node = anchorRef?.current;
    if (!node) {
      setPlacement(null);
      return;
    }
    const rect = node.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpwards = spaceBelow < MENU_MAX_HEIGHT + VIEWPORT_MARGIN && rect.top > spaceBelow;

    setPlacement({
      left: rect.left,
      width: rect.width,
      top: openUpwards ? undefined : rect.bottom + 4,
      bottom: openUpwards ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.max(
        120,
        Math.min(MENU_MAX_HEIGHT, openUpwards ? rect.top : spaceBelow) - VIEWPORT_MARGIN
      ),
    });
  }, [anchorRef]);

  // Position before paint so the menu never visibly "jumps" into place.
  useLayoutEffect(measure, [measure, items]);

  // Follow the input while the page scrolls or the viewport resizes.
  useEffect(() => {
    if (!items.length) return undefined;
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [items.length, measure]);

  if (!items.length || !placement || typeof document === 'undefined') return null;

  return createPortal(
    <ul
      id={listId}
      role="listbox"
      style={{
        position: 'fixed',
        top: placement.top,
        bottom: placement.bottom,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        zIndex: 10000,
      }}
      className="bt-scroll-thin overflow-y-auto overscroll-contain rounded-xl border border-slate-200 bg-white py-1 shadow-[0_18px_45px_-12px_rgba(15,23,42,0.35)]"
    >
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        return (
          <li key={item.id} role="option" aria-selected={isActive}>
            <button
              type="button"
              // Keep focus (and the caret) in the input when the list is clicked.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => onSelect(item)}
              className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                isActive ? 'bg-amber-50' : 'bg-white hover:bg-slate-50'
              }`}
            >
              <svg
                className={`h-4 w-4 shrink-0 ${isActive ? 'text-amber-600' : 'text-slate-400'}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z"
                />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
              </svg>
              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-sm ${
                    isActive ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'
                  }`}
                >
                  {item.name}
                </span>
                <span className="block truncate text-xs text-slate-500">{item.state}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>,
    document.body
  );
}

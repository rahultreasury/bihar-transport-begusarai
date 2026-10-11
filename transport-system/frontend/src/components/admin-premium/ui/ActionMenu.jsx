/**
 * ActionMenu.jsx
 * ---------------------------------------------------------------------------
 * THE THREE-DOT MENU, AS A PROPER OVERLAY.
 *
 * WHY THIS EXISTS
 *   The admin console had two independent three-dot menus that each toggled
 *   their own `hidden` class through `document.getElementById(...).classList`.
 *   That approach has no click-outside handler, no Escape handler, no focus
 *   return, and no way to give the menu a backdrop. Duplicating that twice more
 *   would triple the bug.
 *
 *   This is the ONE implementation both call sites now use. It adds the overlay
 *   behaviour and changes nothing about how a menu looks or what it does.
 *
 * THE OVERLAY BEHAVIOUR
 *   Clicking the trigger dims and lightly blurs the page behind it, so the eye
 *   goes to the menu. The menu itself stays perfectly sharp: the backdrop and
 *   the menu are SIBLINGS, never parent/child. That matters technically — a
 *   `backdrop-filter` on an ancestor blurs its descendants too, so nesting them
 *   would have blurred the very thing that must stay readable.
 *
 * WHY A PORTAL
 *   Both elements are portalled to `document.body` for two reasons:
 *     1. `position: fixed` is resolved against the nearest transformed /
 *        filtered / filtered ancestor. Any card with a `transform` or
 *        `backdrop-filter` further up the tree would otherwise trap the
 *        backdrop inside that card.
 *     2. An explicit z-index in `document.body` is a real global ordering, not
 *        a hopeful one that loses to an ancestor's stacking context.
 *
 * NO LAYOUT SHIFT
 *   The body is deliberately NOT scroll-locked. Locking adds a scrollbar-
 *   compensation gutter, which is a visible horizontal jump and a body-width
 *   change — exactly what this component is meant to avoid. The backdrop is
 *   purely visual and takes no layout space.
 *
 * Z-INDEX
 *   68 / 69 — deliberately BELOW the existing `bt-modal-backdrop` (z-70) so a
 *   real modal can still open on top of an open menu, and far below the
 *   Google Places container (z-10000) and the WhatsApp float (z-9999), which
 *   must keep winning.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** Matches the console's own modal timing (btModalIn is 180ms). */
const MENU_TRANSITION_MS = 180;

export default function ActionMenu({
  trigger,
  children,
  label = 'Open menu',
  align = 'right',
  width = 'w-52',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  /* ── Close on click outside (the backdrop) and on Escape ──────────────── */
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        // Return focus to the trigger so keyboard users do not lose their place.
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /* ── Anchor the menu to the trigger, clamped inside the viewport ───────── */
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    const menuWidth = 208; // w-52
    const margin = 8;

    // Measure the real menu if it is mounted, so a scrollbar never pushes it out.
    const measured = menuRef.current?.getBoundingClientRect();
    const width = measured?.width || menuWidth;
    const height = measured?.height || 0;

    let left = align === 'left' ? rect.left : rect.right - width;
    left = Math.min(Math.max(margin, left), window.innerWidth - width - margin);

    // Flip above the trigger when there is not enough room below.
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = height > 0 && spaceBelow < height + margin && rect.top > spaceBelow;
    let top = openUp ? rect.top - height - 6 : rect.bottom + 6;
    top = Math.max(margin, top);

    setPosition({ left, top });
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    reposition();
  }, [open, reposition]);

  // Keep the menu glued to its trigger while the page scrolls or resizes.
  useEffect(() => {
    if (!open) return undefined;
    const onReflow = () => reposition();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, reposition]);

  // A menu that is open when the operator navigates away must not survive it.
  useEffect(() => {
    if (!open) return undefined;
    return () => setOpen(false);
  }, [open]);

  const menu = open && position && typeof document !== 'undefined'
    ? createPortal(
        <>
          {/* BACKDROP — dims + lightly blurs the page. Sibling, never parent. */}
          <div
            data-testid="action-menu-backdrop"
            aria-hidden="true"
            onClick={close}
            className="bt-actionmenu-backdrop"
            style={{ transitionDuration: `${MENU_TRANSITION_MS}ms` }}
          />

          {/* THE MENU — sharp, above the backdrop, never blurred. */}
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            onClick={(e) => e.stopPropagation()}
            className={`bt-actionmenu-panel ${width} ${className}`}
            style={{ left: position.left, top: position.top }}
          >
            {typeof children === 'function' ? children(close) : children}
          </div>
        </>,
        document.body
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="bt-actionmenu-trigger"
      >
        {trigger}
      </button>
      {menu}
    </>
  );
}
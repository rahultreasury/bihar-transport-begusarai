/**
 * AdminShell.jsx
 * ---------------------------------------------------------------------------
 * The single admin layout. Every one of the 29 admin pages renders inside this,
 * which is why one change here re-architects the whole console at once.
 *
 * BEFORE
 *   AdminShell
 *   ├── AdminSidebar   ← a flex child, permanently reserving 285px (76px collapsed)
 *   └── MainWorkspace  ← whatever was left over
 *
 * AFTER
 *   AdminShell
 *   ├── AdminTopHeader      sticky, out of flow → costs no width
 *   ├── NavigationDrawer    fixed overlay → only mounted while open
 *   └── MainWorkspace       the full viewport width, always
 *
 * The width contract, in one line of CSS:
 *   <main className="w-full max-w-full min-w-0">   ← max-w-NONE, not a sidebar offset
 *
 * Two details that matter more than they look:
 *
 *  1. `min-w-0` on the flex child. A flex item defaults to min-width:auto, which
 *     refuses to shrink below its content — that is what makes a wide table push
 *     the whole page into horizontal scroll instead of scrolling inside its own
 *     container. Combined with `overflow-x-auto` on the table wrapper, wide data
 *     now scrolls inside the table, and the page itself never overflows.
 *
 *  2. The drawer is a SIBLING, not a child of the content column. If it lived
 *     inside the column it would either push the content or need a reserved
 *     gutter — the exact problem this refactor removes.
 *
 * Every prop is preserved: `navItems`, `activeKey`, `onNav`, `children`. All 29
 * call sites keep working untouched.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import AdminTopHeader from './AdminTopHeader';
import AdminNavigationDrawer from './AdminNavigationDrawer';
import { useAdminTheme } from '../theme/useAdminTheme';
import { DEFAULT_NAV_ITEMS, usePendingEnquiryCount } from './adminNavigation';

export default function AdminShell({ navItems, activeKey, onNav, children }) {
  const { themeClass } = useAdminTheme();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // One poll, shared by the header bell and the drawer badge.
  const pendingEnquiries = usePendingEnquiryCount();

  const resolvedNavItems = useMemo(() => navItems || [], [navItems]);

  // Close the drawer on navigation: a back/forward or a programmatic route
  // change must never leave the overlay stranded over the new page.
  useEffect(() => {
    setDrawerOpen(false);
  }, [activeKey]);

  return (
    <div
      className={`bt-app min-h-screen ${themeClass} text-text`}
      role="application"
      aria-label="Admin dashboard"
    >
      {/* Skip link — first tab stop, unchanged behaviour. */}
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[10px] focus:bg-bt-navy focus:px-4 focus:py-2 focus:text-white focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Sticky global header. Out of flow, so the workspace below still
          starts at the very left edge of the viewport. */}
      <AdminTopHeader
        onMenuClick={openDrawer}
        navItems={resolvedNavItems}
        pendingEnquiries={pendingEnquiries}
        menuOpen={drawerOpen}
      />

      {/* ── FULL-WIDTH WORKSPACE ──────────────────────────────────────────
          There is no sidebar sibling and no left offset. `max-w-none`
          (i.e. no max-width utility) is the whole point of this refactor. */}
      <div className="flex w-full max-w-full min-w-0 flex-col">
        <main
          id="admin-main-content"
          role="main"
          tabIndex={-1}
          className="w-full max-w-none min-w-0 flex-1 overflow-x-hidden"
        >
          {/*
            The page container.

            `max-w-[1680px]` rather than an unbounded stretch: a 40-column table
            pushed to a 2560px monitor is unreadable, and an operations console
            is meant to be scanned, not admired. Capping the measure keeps line
            lengths sane on very wide screens while still giving data-heavy
            tables every pixel they need on a laptop.

            The padding lives here rather than on each page, so all ~30 modules
            share one gutter: 16px on mobile, 24px on tablet, 32px on desktop.
          */}
          <div className="mx-auto w-full max-w-[1680px] min-w-0 px-4 pb-10 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
            {children}
          </div>
        </main>
      </div>

      {/* Navigation drawer — fixed overlay, mounted only while open, so it
          never reserves layout width at any breakpoint. */}
      <AdminNavigationDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        navItems={resolvedNavItems}
        activeKey={activeKey}
        onNav={onNav}
        pendingEnquiries={pendingEnquiries}
      />
    </div>
  );
}

// Re-exported so `import { DEFAULT_NAV_ITEMS } from '.../AdminShell'` (if any
// page adopts that path) keeps resolving.
export { DEFAULT_NAV_ITEMS };

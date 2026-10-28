/**
 * AdminShell.jsx
 * ---------------------------------------------------------------------------
 * The single admin layout. Every one of the 29 admin pages renders inside this,
 * which is why one change here re-architects the whole console at once.
 *
 * THREE LAYOUTS, ONE SHELL
 *   default            sticky header + full-width workspace + overlay drawer
 *   workspace          full-screen module: shared header, NO sidebar and NO
 *                      sidebar-width reservation. Navigation lives in the
 *                      header's overflow menu.
 *   permanentSidebar   the deep-navy operations sidebar from an earlier
 *                      Vehicle Hire reference (kept for compatibility)
 *
 * Every layout is opt-in. Every existing page keeps the default layout and
 * every existing prop, route and authorisation check is untouched.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Menu, X } from 'lucide-react';

import AdminTopHeader from './AdminTopHeader';
import AdminNavigationDrawer from './AdminNavigationDrawer';
import { useAdminTheme } from '../theme/useAdminTheme';
import {
  DEFAULT_NAV_ITEMS,
  PERMANENT_NAV_GROUPS,
  resolveNavPath,
  usePendingEnquiryCount,
} from './adminNavigation';

/* ──────────────────────────────────────────────────────────────────────────
   BRAND MARK
   A compact Bihar silhouette. Drawn inline so it stays crisp at every density
   and inherits the sidebar's colour without shipping a second raster logo.
   ────────────────────────────────────────────────────────────────────────── */
function BiharMark({ className = 'h-9 w-9' }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        d="M25.4 2.6 33.8 6l5.6-1.4 4.9 5.6-4 5.2 5.9 4.3-3.4 5.9 3.1 5.6-5.2 5.6 2.3 5.7-8.2 2.9-6.1-4.2-6.8 3-6.1-4.9-6.1 1-3.6-5.8 4.2-5.2-5.3-4.4 4.1-5.5-2.3-6 6.9-2.2L18 5.4l7.4-2.8Z"
        fill="#4D8FF8"
      />
      <path
        d="M26 7.1 33.3 10l4.7-1.1 3.5 4-3.7 4.8 4.6 3.4-2.8 4.9 2.6 4.7-4.6 5 1.8 4.5-6.7 2.3-5.4-3.8-6.2 2.8-5.4-4.4-5.2.9-2.7-4.4 4.1-5.1-4.5-3.7 3.6-4.7-2.1-5.3 5.9-1.9 1.2-5.6L26 7.1Z"
        fill="#2D74EE"
        opacity="0.55"
      />
      <path
        d="m25.8 19.6 1.7 3.6 3.9.5-2.9 2.7.8 3.9-3.5-1.9-3.5 1.9.8-3.9-2.9-2.7 3.9-.5 1.7-3.6Z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   PERMANENT SIDEBAR
   ────────────────────────────────────────────────────────────────────────── */
function PermanentSidebar({ activeKey, onNavigate, onClose, overlay = false }) {
  return (
    <aside
      id={overlay ? 'admin-navigation-drawer' : 'admin-permanent-sidebar'}
      className={[
        'flex h-full w-[240px] max-w-[86vw] shrink-0 flex-col overflow-hidden',
        'bg-[#002347] text-white',
        overlay ? 'shadow-[0_0_60px_rgba(0,20,45,0.45)]' : '',
      ].join(' ')}
      aria-label="Main navigation"
    >
      {/* Brand */}
      <div
        className={[
          'relative flex h-[70px] shrink-0 items-center border-b border-white/[0.07]',
          overlay ? 'gap-2.5 px-3.5' : 'gap-3 px-4',
        ].join(' ')}
      >
        <BiharMark className={overlay ? 'h-10 w-10 shrink-0' : 'h-[42px] w-[42px] shrink-0'} />
        <div className="min-w-0 flex-1">
          <p
            className={[
              'truncate font-extrabold leading-tight tracking-[-0.02em] text-white',
              overlay ? 'text-[15px]' : 'text-[16px]',
            ].join(' ')}
          >
            Bihar Transport
          </p>
          <p
            className={[
              'mt-0.5 truncate font-medium leading-tight text-[#A9BBD2]',
              overlay ? 'text-[8.5px]' : 'text-[9px]',
            ].join(' ')}
          >
            Safe Journey, Stronger Bihar
          </p>
        </div>

        {overlay ? (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-white/65 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 pb-6 pt-3" aria-label="Admin sections">
        {PERMANENT_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.title || `group-${groupIndex}`} className={groupIndex === 0 ? '' : 'mt-5'}>
            {group.title ? (
              <p className="mb-2 px-3 text-[10px] font-bold uppercase leading-none tracking-[0.14em] text-[#7F95B0]">
                {group.title}
              </p>
            ) : null}

            <ul className="space-y-[2px]">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === activeKey;

                if (item.disabled) {
                  return (
                    <li key={item.key}>
                      <span
                        className="flex h-[36px] cursor-not-allowed items-center gap-3 rounded-[8px] px-3 text-[13px] font-medium text-[#AFC0D5]/55"
                        aria-disabled="true"
                        title="This module is not available in this build"
                      >
                        <Icon className="h-[17px] w-[17px] shrink-0 text-[#8EA3BD]/45" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#7087A2]/40" strokeWidth={2} />
                      </span>
                    </li>
                  );
                }

                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item)}
                      className={[
                        'group flex h-[36px] w-full items-center gap-3 rounded-[8px] px-3 text-left text-[13px] transition-all duration-150',
                        isActive
                          ? 'bg-[#1764E8] font-semibold text-white shadow-[0_8px_20px_rgba(23,100,232,0.28)]'
                          : 'font-medium text-[#C6D3E3] hover:bg-white/[0.07] hover:text-white',
                      ].join(' ')}
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <Icon
                        className={[
                          'h-[17px] w-[17px] shrink-0',
                          isActive ? 'text-white' : 'text-[#9FB2C9] group-hover:text-white',
                        ].join(' ')}
                        strokeWidth={1.8}
                      />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hasChildren ? (
                        <ChevronRight
                          className={[
                            'h-3.5 w-3.5 shrink-0',
                            isActive ? 'text-white/80' : 'text-[#6F86A2] group-hover:text-[#C6D3E3]',
                          ].join(' ')}
                          strokeWidth={2}
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   SHELL
   ────────────────────────────────────────────────────────────────────────── */
export default function AdminShell({
  navItems,
  activeKey,
  onNav,
  children,
  fullBleed = false,
  permanentSidebar = false,
  workspace = false,
}) {
  const { themeClass } = useAdminTheme();
  const navigate = useNavigate();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // One poll, shared by the header bell and the navigation menus.
  const pendingEnquiries = usePendingEnquiryCount();

  // The full-screen workspace has no sidebar to fall back on, so its header
  // overflow menu must always have the canonical admin navigation available.
  const resolvedNavItems = useMemo(
    () => (navItems?.length ? navItems : workspace ? DEFAULT_NAV_ITEMS : []),
    [navItems, workspace]
  );

  // Close the drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [activeKey]);

  const handlePermanentNavigate = useCallback(
    (item) => {
      const path = resolveNavPath(item);
      if (path) navigate(path);
      else onNav?.(item.key);
      closeDrawer();
    },
    [navigate, onNav, closeDrawer]
  );

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

      {workspace ? (
        <>
          {/* Full-screen module: the shared header spans the viewport and the
              navigation is an overflow menu, so no sidebar width is reserved. */}
          <AdminTopHeader
            onMenuClick={openDrawer}
            navItems={resolvedNavItems}
            activeKey={activeKey}
            pendingEnquiries={pendingEnquiries}
            menuOpen={drawerOpen}
            workspace
          />

          <main
            id="admin-main-content"
            role="main"
            tabIndex={-1}
            className="w-full min-w-0 flex-1 bg-[#F8FBFE]"
          >
            {children}
          </main>
        </>
      ) : permanentSidebar ? (
        <>
          {/* Desktop sidebar */}
          <div className="fixed inset-y-0 left-0 z-40 hidden lg:block">
            <PermanentSidebar
              activeKey={activeKey}
              onNavigate={handlePermanentNavigate}
              onClose={closeDrawer}
            />
          </div>

          {/* Mobile sidebar */}
          {drawerOpen ? (
            <div className="fixed inset-0 z-[60] lg:hidden" role="presentation">
              <button
                type="button"
                onClick={closeDrawer}
                className="absolute inset-0 h-full w-full cursor-default bg-[#001a36]/60"
                aria-label="Close navigation"
                tabIndex={-1}
              />
              <div className="absolute inset-y-0 left-0">
                <PermanentSidebar
                  activeKey={activeKey}
                  onNavigate={handlePermanentNavigate}
                  onClose={closeDrawer}
                  overlay
                />
              </div>
            </div>
          ) : null}

          <div className="flex min-h-screen w-full min-w-0 flex-col lg:pl-[240px]">
            <AdminTopHeader
              onMenuClick={openDrawer}
              navItems={resolvedNavItems}
              pendingEnquiries={pendingEnquiries}
              menuOpen={drawerOpen}
              permanentSidebar
            />

            <main
              id="admin-main-content"
              role="main"
              tabIndex={-1}
              className="w-full min-w-0 flex-1 bg-[#F8FBFE]"
            >
              {fullBleed ? (
                children
              ) : (
                <div className="w-full min-w-0">{children}</div>
              )}
            </main>
          </div>
        </>
      ) : (
        <>
          <AdminTopHeader
            onMenuClick={openDrawer}
            navItems={resolvedNavItems}
            pendingEnquiries={pendingEnquiries}
            menuOpen={drawerOpen}
          />

          <div className="flex w-full max-w-full min-w-0 flex-col">
            <main
              id="admin-main-content"
              role="main"
              tabIndex={-1}
              className={`w-full max-w-none min-w-0 flex-1 ${fullBleed ? '' : 'overflow-x-hidden'}`}
            >
              {fullBleed ? (
                children
              ) : (
                <div className="mx-auto w-full max-w-[1680px] min-w-0 px-4 pb-8 pt-4 sm:px-6 lg:px-8 lg:pb-10 lg:pt-5">
                  {children}
                </div>
              )}
            </main>
          </div>

          <AdminNavigationDrawer
            open={drawerOpen}
            onClose={closeDrawer}
            navItems={resolvedNavItems}
            activeKey={activeKey}
            onNav={onNav}
            pendingEnquiries={pendingEnquiries}
          />
        </>
      )}
    </div>
  );
}

// Re-exported so `import { DEFAULT_NAV_ITEMS } from '.../AdminShell'` (if any
// page adopts that path) keeps resolving.
export { DEFAULT_NAV_ITEMS };

/**
 * AdminTopHeader.jsx
 * ---------------------------------------------------------------------------
 * The sticky global header, shared by every admin module.
 *
 *   height 72px · white surface · 1px bottom border (--bt-border)
 *   left    : [☰] brand mark
 *   centre  : the current module, from the live URL
 *   right   : notifications · support · the signed-in administrator
 *
 * WHY STICKY
 * Every module is a long, dense table. Pinning the header keeps the module name
 * and the notifications bell permanently reachable without costing the page any
 * width — `sticky top-0` is out of flow.
 *
 * The module name is derived from the live URL (see resolveModuleLabel), so it
 * is correct on a deep link, on browser back/forward and after a refresh. It is
 * never a hard-coded string.
 *
 * The bell shows the real count of enquiries awaiting review — the same figure
 * the navigation drawer badges, from the same single 60s poll.
 */

import { useContext, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { Menu, Bell, LifeBuoy } from 'lucide-react';

import { AuthContext } from '../../../contexts/AuthContext';
import { DEFAULT_NAV_ITEMS, resolveModuleLabel } from './adminNavigation';

export default function AdminTopHeader({
  onMenuClick,
  navItems,
  pendingEnquiries,
  menuOpen = false,
}) {
  const { user } = useContext(AuthContext) || {};
  const location = useLocation();

  const adminName = user?.full_name || user?.first_name || 'System Administrator';
  const adminInitials =
    adminName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'A';

  const items = useMemo(() => (navItems?.length ? navItems : DEFAULT_NAV_ITEMS), [navItems]);
  const moduleName = useMemo(
    () => resolveModuleLabel(location.pathname, items),
    [location.pathname, items]
  );

  const hasPending = Number.isFinite(pendingEnquiries) && pendingEnquiries > 0;

  // The trigger doubles as the navigation's only affordance, so it reads as a
  // menu control rather than a generic square button.
  const controlClass =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-bt-border bg-white text-bt-navy transition-colors duration-150 hover:border-bt-border-strong hover:bg-bt-orange-light focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange';

  return (
    <header
      className="sticky top-0 z-40 border-b border-bt-border bg-white"
      style={{ height: 'var(--bt-header-height)' }}
      role="banner"
    >
      <div className="flex h-full w-full max-w-full items-center gap-3 px-4 sm:gap-4 lg:px-8">
        {/* ── Left: menu trigger + brand ── */}
        <div className="flex min-w-0 shrink-0 items-center gap-2.5 sm:gap-3">
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation-drawer"
            className={controlClass}
          >
            <Menu className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
          </button>

          <a href="/admin" className="flex min-w-0 items-center gap-2.5" aria-label="Bihar Transport admin home">
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bt-navy text-[12px] font-bold tracking-tight text-white"
              aria-hidden="true"
            >
              BT
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[15px] font-bold leading-tight tracking-tight text-bt-navy">
                Bihar Transport
              </span>
              <span className="block truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-bt-orange-dark">
                Operations Console
              </span>
            </span>
          </a>
        </div>

        {/* ── Divider, then the current module ── */}
        <div className="hidden h-8 w-px shrink-0 bg-bt-border lg:block" aria-hidden="true" />

        <h1 className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-[0.16em] text-bt-navy lg:text-[13px]">
          {moduleName}
        </h1>

        {/* ── Right: notifications · support · admin ── */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            className={`${controlClass} relative`}
            aria-label={
              hasPending
                ? `${pendingEnquiries} enquir${pendingEnquiries === 1 ? 'y' : 'ies'} awaiting review`
                : 'No enquiries awaiting review'
            }
            title="Enquiries awaiting review"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            {hasPending && (
              <span
                className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-bt-orange px-1 text-center text-[10px] font-bold leading-[18px] text-bt-navy-dark ring-2 ring-white"
                aria-hidden="true"
              >
                {pendingEnquiries > 99 ? '99+' : pendingEnquiries}
              </span>
            )}
          </button>

          <a
            href="/admin/reports"
            className="bt-btn bt-btn-secondary hidden h-10 px-3.5 sm:inline-flex"
            title="Support & reporting"
          >
            <LifeBuoy className="h-[17px] w-[17px]" strokeWidth={2} aria-hidden="true" />
            <span className="hidden lg:inline">Support</span>
          </a>

          {/* Signed-in administrator */}
          <div className="flex items-center gap-2.5">
            <span className="hidden max-w-[10rem] truncate text-[13px] font-medium text-bt-ink-2 xl:block" title={adminName}>
              {adminName}
            </span>
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bt-navy text-[13px] font-bold text-white"
              title={adminName}
              aria-label={`Logged in as ${adminName}`}
            >
              {adminInitials}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

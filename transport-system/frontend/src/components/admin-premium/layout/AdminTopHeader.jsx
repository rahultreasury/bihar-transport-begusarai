/**
 * AdminTopHeader.jsx
 * ---------------------------------------------------------------------------
 * The sticky global header, shared by every admin module.
 *
 *   height 72px · white surface · 1px bottom border (--bt-border)
 *   default layout
 *     left    : [☰] BT logo → Bihar Transport branding → divider → OPERATIONS
 *     centre  : global search → Vehicle Hire | Bookings | Financials
 *     right   : notifications · divider · authenticated user
 *
 *   workspace layout (full-screen Vehicle Hire)
 *     left    : [☰ overflow menu] BT logo → branding → module name
 *     centre  : global search
 *     right   : Vehicle Hire | Bookings | Financials · bell · avatar
 *     The hamburger opens a compact navigation menu, not a sidebar drawer.
 *
 *   permanentSidebar layout
 *     left    : [☰ on mobile] global search with ⌘K hint
 *     right   : notifications · divider · avatar + name
 *
 * WHY STICKY
 * Every module is a long, dense table. Pinning the header keeps the module name
 * and the notifications bell permanently reachable without costing the page any
 * width — `sticky top-0` is out of flow.
 */

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  LogOut,
  Menu,
  Search,
  Truck,
  X,
} from 'lucide-react';

import { Button } from '../ui/AdminUI';
import { AuthContext } from '../../../contexts/AuthContext';
import { buildNavGroups, resolveNavPath } from './adminNavigation';

export default function AdminTopHeader({
  onMenuClick,
  pendingEnquiries,
  menuOpen = false,
  permanentSidebar = false,
  workspace = false,
  navItems = [],
  activeKey,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext) || {};

  const [profileOpen, setProfileOpen] = useState(false);
  const [navMenuOpen, setNavMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const profileRef = useRef(null);
  const navMenuRef = useRef(null);
  const searchRef = useRef(null);

  const hasPending = Number.isFinite(pendingEnquiries) && pendingEnquiries > 0;

  const adminName = user?.full_name || user?.first_name || 'System Administrator';
  const adminEmail = user?.email || 'admin@bihartransport.com';
  const adminInitials =
    adminName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'A';

  // Dismiss the profile menu on outside click or Escape.
  useEffect(() => {
    if (!profileOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setProfileOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [profileOpen]);

  // The full-screen workspace has no persistent sidebar. Its hamburger opens
  // this compact overflow menu; outside click and Escape dismiss it.
  useEffect(() => {
    if (!navMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!navMenuRef.current?.contains(event.target)) setNavMenuOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setNavMenuOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navMenuOpen]);

  // Never leave the menu floating over a new route.
  useEffect(() => {
    setNavMenuOpen(false);
  }, [location.pathname, location.search]);

  const handleLogout = () => {
    setProfileOpen(false);
    setNavMenuOpen(false);
    logout?.();
    navigate('/admin/login', { replace: true });
  };

  const handleWorkspaceNav = (item) => {
    setNavMenuOpen(false);
    const path = resolveNavPath(item);
    if (path) navigate(path);
  };

  const workspaceGroups = useMemo(
    () => (workspace ? buildNavGroups(navItems) : []),
    [workspace, navItems]
  );

  // ⌘K / Ctrl+K focuses the global search, matching the hint in the field.
  useEffect(() => {
    const handleShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select?.();
      }
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    const term = searchQuery.trim();
    if (!term) return;

    // The Vehicle Hire workspace is the one global list that already searches
    // orders, customers, routes, vehicles and drivers in one place. Sending the
    // global query there keeps the header honest without inventing a new route.
    navigate(`/admin/vehicle-hire?search=${encodeURIComponent(term)}`);
  };

  // Compact control weights matching the reference header.
  const plainIconButton =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] text-bt-navy transition-colors duration-150 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange';
  const borderedIconButton =
    'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] border border-slate-200 bg-white text-bt-navy shadow-[0_1px_2px_rgba(16,43,76,0.05)] transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange';
  const headerAction =
    'h-10 rounded-[9px] px-4 text-[13px] [&>svg]:h-4 [&>svg]:w-4';
  const workspaceHeaderAction =
    'h-10 rounded-[9px] px-5 text-[13px] [&>svg]:h-4 [&>svg]:w-4';

  // Map current route to target module label
  const getModuleLabel = (pathname) => {
    if (pathname.startsWith('/admin/bookings')) return 'OPERATIONS';
    if (pathname.startsWith('/admin/vehicle-hire')) return 'VEHICLE HIRE';
    if (pathname.startsWith('/admin/financials')) return 'FINANCIALS';
    if (pathname.startsWith('/admin/trips')) return 'TRIPS';
    if (pathname.startsWith('/admin/enquiries') || pathname.startsWith('/admin/enquiry')) return 'ENQUIRIES';
    if (pathname.startsWith('/admin/dashboard')) return 'DASHBOARD';
    if (pathname.startsWith('/admin/drivers')) return 'DRIVERS';
    if (pathname.startsWith('/admin/vehicles')) return 'VEHICLES';
    if (pathname.startsWith('/admin/owners')) return 'OWNERS';
    if (pathname.startsWith('/admin/clients')) return 'CLIENTS';
    if (pathname.startsWith('/admin/partners')) return 'PARTNERS';
    if (pathname.startsWith('/admin/analytics')) return 'ANALYTICS';
    if (pathname.startsWith('/admin/reports')) return 'REPORTS';
    return 'OPERATIONS';
  };

  const currentModule = getModuleLabel(location.pathname);

  return (
    <header
      className={`sticky top-0 z-40 border-b bg-white ${
        permanentSidebar || workspace ? 'border-[#E8EDF5]' : 'border-bt-border'
      }`}
      style={{ height: permanentSidebar || workspace ? '70px' : 'var(--bt-header-height, 72px)' }}
      role="banner"
    >
      <div
        className={`flex h-full w-full max-w-full items-center ${
          permanentSidebar || workspace ? 'gap-3 px-4 sm:px-6' : 'gap-2 px-4 sm:px-5 lg:px-6'
        }`}
      >
        {permanentSidebar ? (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation-drawer"
            className={`${plainIconButton} lg:hidden`}
          >
            <Menu className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2">
            <div ref={navMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={workspace ? () => setNavMenuOpen((open) => !open) : onMenuClick}
                aria-label="Open navigation menu"
                aria-expanded={workspace ? navMenuOpen : menuOpen}
                aria-haspopup={workspace ? 'menu' : undefined}
                aria-controls={workspace ? 'admin-workspace-nav' : 'admin-navigation-drawer'}
                className={workspace ? `${plainIconButton} bt-workspace-icon` : plainIconButton}
              >
                <Menu className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
              </button>

              {/* Full-screen workspace navigation: a compact overflow menu,
                  never a sidebar and never a reserved column. */}
              {workspace && navMenuOpen ? (
                <div
                  id="admin-workspace-nav"
                  role="menu"
                  aria-label="Admin navigation"
                  className="absolute left-0 top-[calc(100%+12px)] z-[70] max-h-[calc(100vh-92px)] w-[min(320px,calc(100vw-32px))] overflow-y-auto rounded-[16px] border border-[#E4EAF3] bg-white p-2 shadow-[0_24px_60px_-18px_rgba(15,43,85,0.35)]"
                >
                  <div className="flex items-center justify-between px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7C8CA3]">
                      Navigation
                    </p>
                    <button
                      type="button"
                      onClick={() => setNavMenuOpen(false)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-[#7C8CA3] transition-colors hover:bg-[#F4F7FB] hover:text-[#0B2B52]"
                      aria-label="Close navigation"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>

                  {workspaceGroups.map((group) => (
                    <div key={group.title} className="mb-1.5 last:mb-0">
                      <p className="px-3 pb-1 pt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[#94A3B8]">
                        {group.title}
                      </p>
                      <ul>
                        {group.items.map((item) => {
                          const Icon = item.icon;
                          const isActive = item.key === activeKey;
                          return (
                            <li key={item.key}>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleWorkspaceNav(item)}
                                aria-current={isActive ? 'page' : undefined}
                                className={[
                                  'flex w-full items-center gap-2.5 rounded-[9px] px-3 py-2 text-left text-[12.5px] transition-colors',
                                  isActive
                                    ? 'bg-[#FFF4DD] font-semibold text-[#92400E]'
                                    : 'font-medium text-[#42526B] hover:bg-[#F5F8FC] hover:text-[#0B2B52]',
                                ].join(' ')}
                              >
                                {Icon ? (
                                  <Icon
                                    className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#D97706]' : 'text-[#8293A8]'}`}
                                    strokeWidth={1.9}
                                    aria-hidden="true"
                                  />
                                ) : null}
                                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Brand */}
            <a
              href="/admin"
              className="flex min-w-0 items-center gap-3.5"
              aria-label="Bihar Transport admin home"
            >
              <span
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-bt-navy text-[15px] font-bold tracking-tight text-white shadow-[0_4px_12px_-6px_rgba(21,52,91,0.5)]"
                aria-hidden="true"
              >
                BT
              </span>
              <div className="hidden min-w-0 flex-col sm:flex">
                <span className="block truncate text-[16px] font-bold leading-[1.15] tracking-[-0.015em] text-bt-navy xl:text-[16.5px]">
                  Bihar Transport
                </span>
                <span className="block truncate text-[8.5px] font-semibold uppercase tracking-[0.08em] text-bt-orange-dark xl:text-[9px]">
                  OPERATIONS CONSOLE
                </span>
              </div>
            </a>

            <div
              className={`ml-2 hidden h-8 w-px shrink-0 bg-bt-border ${workspace ? 'lg:block' : 'xl:block'}`}
              aria-hidden="true"
            />

            <span
              className={`ml-2 hidden font-semibold tracking-[0.03em] text-bt-navy ${
                workspace ? 'text-[13px] lg:inline-block' : 'text-[13px] xl:inline-block xl:text-[14px]'
              }`}
            >
              {currentModule}
            </span>
          </div>
        )}

        {/* ── Global search ── */}
        <div
          className={`flex min-w-0 items-center ${
            permanentSidebar ? 'flex-1' : workspace ? 'ml-2 flex-1 sm:ml-4' : 'ml-3.5 flex-1'
          }`}
        >
          <form
            onSubmit={handleSearch}
            className={`relative w-full ${
              permanentSidebar ? 'max-w-[700px]' : workspace ? 'max-w-[460px]' : 'max-w-[508px]'
            }`}
          >
            <Search
              className={`pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 ${
                permanentSidebar || workspace ? 'left-3.5 text-[#6B7C93]' : 'left-3.5 text-[#6B7C93]'
              }`}
              strokeWidth={1.9}
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                workspace
                  ? 'Search orders...'
                  : 'Search anything... (order, customer, vehicle, route)'
              }
              className={
                permanentSidebar || workspace
                  ? `h-10 w-full rounded-[9px] border border-[#E4E9F1] bg-[#EEF2F7] pl-10 pr-16 text-[12.5px] text-[#243B5A] outline-none transition-colors placeholder:text-[#7B8CA3] focus:border-[#B9C9DE] focus:bg-white focus:ring-2 focus:ring-[#1764E8]/10 [&::-webkit-search-cancel-button]:hidden ${
                      workspace ? 'bt-workspace-search' : ''
                    }`
                  : 'h-[38px] w-full rounded-[9px] border border-[#E4E9F1] bg-[#F8FAFD] pl-10 pr-16 text-[13px] text-[#243B5A] outline-none transition-colors placeholder:text-[#7B8CA3] focus:border-[#B9C9DE] focus:bg-white focus:ring-2 focus:ring-[#1764E8]/10 [&::-webkit-search-cancel-button]:hidden'
              }
              aria-label="Global search"
            />

            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-bt-ink-3 transition-colors hover:bg-bt-orange-light hover:text-bt-navy"
                aria-label="Clear search"
              >
                <svg className="h-3.5 w-3.5" strokeWidth={2} fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 items-center rounded-[5px] border border-[#DDE4EE] bg-white px-1.5 py-0.5 text-[9.5px] font-semibold text-[#8797AB] sm:flex">
                ⌘ K
              </kbd>
            )}
          </form>
        </div>

        {/* ── Right cluster: quick actions (default), notifications, profile ── */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!permanentSidebar ? (
            <div className="hidden items-center gap-2 xl:flex">
              <Button
                icon={Truck}
                onClick={() => navigate('/admin/vehicle-hire')}
                aria-current={location.pathname.startsWith('/admin/vehicle-hire') ? 'page' : undefined}
                className={`bt-btn-header-vehicle-hire ${workspace ? workspaceHeaderAction : headerAction} ${location.pathname.startsWith('/admin/vehicle-hire') ? 'active' : ''}`}
              >
                Vehicle Hire
              </Button>
              <Button
                icon={CalendarDays}
                onClick={() => navigate('/admin/bookings')}
                aria-current={location.pathname.startsWith('/admin/bookings') ? 'page' : undefined}
                className={`bt-btn-header-bookings ${workspace ? workspaceHeaderAction : `${headerAction} !px-[13px]`} ${location.pathname.startsWith('/admin/bookings') ? 'active' : ''}`}
              >
                Bookings
              </Button>
              <Button
                icon={BarChart3}
                onClick={() => navigate('/admin/financials')}
                aria-current={location.pathname.startsWith('/admin/financials') ? 'page' : undefined}
                className={`bt-btn-header-financials ${workspace ? workspaceHeaderAction : headerAction} ${location.pathname.startsWith('/admin/financials') ? 'active' : ''}`}
              >
                Financials
              </Button>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => navigate('/admin/enquiries')}
            className={
              permanentSidebar
                ? `${plainIconButton} relative`
                : workspace
                  ? `${plainIconButton} bt-workspace-icon relative`
                  : borderedIconButton
            }
            aria-label={
              hasPending
                ? `${pendingEnquiries} enquir${pendingEnquiries === 1 ? 'y' : 'ies'} awaiting review`
                : 'No enquiries awaiting review'
            }
            title="Enquiries awaiting review"
          >
            <Bell className="h-[18px] w-[18px]" strokeWidth={1.9} aria-hidden="true" />
            {hasPending && (
              <span
                className="absolute right-1 top-1 min-w-[15px] rounded-full bg-[#EF4444] px-1 text-center text-[8.5px] font-bold leading-[15px] text-white ring-2 ring-white"
                aria-hidden="true"
              >
                {pendingEnquiries > 99 ? '99+' : pendingEnquiries}
              </span>
            )}
          </button>

          <div className="hidden h-6 w-px bg-[#E5EAF2] sm:block" aria-hidden="true" />

          <div ref={profileRef} className="relative block">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              className="flex h-10 items-center gap-1.5 rounded-[9px] pl-0.5 pr-1 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[#12345C] text-[11.5px] font-bold tracking-[0.02em] text-white ring-2 ring-white"
                aria-hidden="true"
              >
                {adminInitials}
              </span>
              {!workspace ? (
                <span className="hidden whitespace-nowrap text-[10px] font-semibold tracking-[-0.04em] text-[#0B2B52] md:block">
                  {adminName}
                </span>
              ) : null}
              <ChevronDown
                className={`h-3 w-3 text-slate-500 transition-transform ${profileOpen ? 'rotate-180' : ''}`}
                strokeWidth={2.2}
                aria-hidden="true"
              />
            </button>

            {profileOpen ? (
              <div
                role="menu"
                aria-label="Profile menu"
                className="absolute right-0 top-[calc(100%+10px)] z-50 w-60 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_45px_-16px_rgba(15,43,85,0.35)]"
              >
                <div className="px-3 py-2">
                  <p className="truncate text-[14px] font-semibold text-bt-navy">{adminName}</p>
                  <p className="mt-0.5 truncate text-[12px] text-slate-500">{adminEmail}</p>
                </div>
                <div className="my-1 h-px bg-slate-100" aria-hidden="true" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleLogout}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <LogOut className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

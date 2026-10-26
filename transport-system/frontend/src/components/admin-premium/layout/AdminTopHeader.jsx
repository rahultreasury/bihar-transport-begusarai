/**
 * AdminTopHeader.jsx
 * ---------------------------------------------------------------------------
 * The sticky global header, shared by every admin module.
 *
 *   height 72px · white surface · 1px bottom border (--bt-border)
 *   left    : [☰] BT logo → Bihar Transport branding → divider → OPERATIONS
 *   centre  : Vehicle Hire | Bookings | Financials
 *   right   : notifications · divider · authenticated user
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
  Truck,
} from 'lucide-react';

import { DEFAULT_NAV_ITEMS } from './adminNavigation';
import { Button } from '../ui/AdminUI';
import { AuthContext } from '../../../contexts/AuthContext';

export default function AdminTopHeader({
  onMenuClick,
  navItems,
  pendingEnquiries,
  menuOpen = false,
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext) || {};

  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);

  const items = useMemo(() => (navItems?.length ? navItems : DEFAULT_NAV_ITEMS), [navItems]);

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

  const handleLogout = () => {
    setProfileOpen(false);
    logout?.();
    navigate('/admin/login', { replace: true });
  };

  // Compact control weights matching the reference header.
  const plainIconButton =
    'flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] text-bt-navy transition-colors duration-150 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange';
  const borderedIconButton =
    'relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-slate-200 bg-white text-bt-navy shadow-[0_1px_2px_rgba(16,43,76,0.05)] transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange';
  const headerAction =
    'h-8 rounded-[8px] px-3.5 text-[12.5px] [&>svg]:h-3.5 [&>svg]:w-3.5';

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
      className="sticky top-0 z-40 border-b border-bt-border bg-white"
      style={{ height: 'var(--bt-header-height, 72px)' }}
      role="banner"
    >
      <div className="flex h-full w-full max-w-full items-center px-3 sm:px-4">
        {/* ── Left cluster: hamburger, brand, divider, OPERATIONS label ── */}
        <div className="flex min-w-0 items-center gap-2">
          {/* Hamburger */}
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-controls="admin-navigation-drawer"
            className={plainIconButton}
          >
            <Menu className="h-4 w-4" strokeWidth={2.1} aria-hidden="true" />
          </button>

          {/* Brand */}
          <a
            href="/admin"
            className="flex min-w-0 items-center gap-2"
            aria-label="Bihar Transport admin home"
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-bt-navy text-[11px] font-bold tracking-tight text-white"
              aria-hidden="true"
            >
              BT
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="block truncate text-[13px] font-bold leading-[1.15] tracking-[-0.01em] text-bt-navy">
                Bihar Transport
              </span>
              <span className="block truncate text-[8px] font-semibold uppercase tracking-[0.06em] text-bt-orange-dark">
                OPERATIONS CONSOLE
              </span>
            </div>
          </a>

          {/* Divider */}
          <div className="hidden h-6 w-px shrink-0 bg-bt-border xl:block" aria-hidden="true" />

          {/* Dynamic section label */}
          <span className="hidden text-[12px] font-semibold tracking-[0.03em] text-bt-navy xl:inline-block">
            {currentModule}
          </span>
        </div>

        {/* ── Right cluster: quick actions, notifications, profile ── */}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="hidden items-center gap-2 xl:flex">
            <Button
              icon={Truck}
              onClick={() => navigate('/admin/vehicle-hire')}
              aria-current={location.pathname.startsWith('/admin/vehicle-hire') ? 'page' : undefined}
              className={`bt-btn-header-vehicle-hire ${headerAction} ${location.pathname.startsWith('/admin/vehicle-hire') ? 'active' : ''}`}
            >
              Vehicle Hire
            </Button>
            <Button
              icon={CalendarDays}
              onClick={() => navigate('/admin/bookings')}
              aria-current={location.pathname.startsWith('/admin/bookings') ? 'page' : undefined}
              className={`bt-btn-header-bookings ${headerAction} ${location.pathname.startsWith('/admin/bookings') ? 'active' : ''}`}
            >
              Bookings
            </Button>
            <Button
              icon={BarChart3}
              onClick={() => navigate('/admin/financials')}
              aria-current={location.pathname.startsWith('/admin/financials') ? 'page' : undefined}
              className={`bt-btn-header-financials ${headerAction} ${location.pathname.startsWith('/admin/financials') ? 'active' : ''}`}
            >
              Financials
            </Button>
          </div>

          <button
            type="button"
            className={borderedIconButton}
            aria-label={
              hasPending
                ? `${pendingEnquiries} enquir${pendingEnquiries === 1 ? 'y' : 'ies'} awaiting review`
                : 'No enquiries awaiting review'
            }
            title="Enquiries awaiting review"
          >
            <Bell className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {hasPending && (
              <span
                className="absolute -right-1 -top-1 min-w-[14px] rounded-full bg-bt-orange px-1 text-center text-[8.5px] font-bold leading-4 text-bt-navy-dark ring-2 ring-white"
                aria-hidden="true"
              >
                {pendingEnquiries > 99 ? '99+' : pendingEnquiries}
              </span>
            )}
          </button>

          <div className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden="true" />

          <div ref={profileRef} className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              aria-label="Open profile menu"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
              className="flex h-8 items-center gap-1 rounded-[9px] pl-0.5 pr-1 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full bg-bt-navy text-[10.5px] font-bold tracking-[0.02em] text-white ring-2 ring-white"
                aria-hidden="true"
              >
                {adminInitials}
              </span>
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

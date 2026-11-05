import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Route,
  Truck,
  Users,
  BarChart3,
  UserRound,
  LogOut,
  X,
} from 'lucide-react';
import { useContext } from 'react';
import { AuthContext } from '../../contexts/AuthContext';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/partner/dashboard', available: true },
  { key: 'trips', label: 'Trips', icon: Route, path: '/partner/trips', available: true },
  { key: 'vehicles', label: 'Vehicles', icon: Truck, path: '/partner/vehicles', available: true },
  { key: 'drivers', label: 'Drivers', icon: Users, path: '/partner/drivers', available: true },
  { key: 'financials', label: 'Financials', icon: BarChart3, path: '/partner/financials', available: true },
  { key: 'profile', label: 'Profile', icon: UserRound, path: '/partner/profile', available: true },
];

export default function PartnerSidebar({ mobileOpen = false, onClose }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useContext(AuthContext);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const activeKey = useMemo(() => {
    if (pathname === '/partner/dashboard') return 'dashboard';
    return pathname.split('/')[2] || '';
  }, [pathname]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    logout();
    navigate('/partner/login', { replace: true });
    onClose?.();
  };

  const displayName = user?.first_name || user?.name || 'Partner';
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'P';

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-gray-950/50 md:hidden"
          aria-label="Close partner navigation"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-white/10 bg-[#0F2B55] text-white transition-transform duration-200 md:static md:z-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Partner navigation"
      >
        {/* Brand Header */}
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <Link to="/partner/dashboard" className="flex min-w-0 items-center gap-2.5" onClick={onClose}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-[#0F2B55]">
              <Truck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold tracking-tight">Bihar Transport</span>
              <span className="block text-[10px] uppercase tracking-[0.2em] text-amber-300/90">Partner Portal</span>
            </span>
          </Link>
          <button
            type="button"
            className="rounded-lg p-2 text-white/70 hover:bg-white/10 hover:text-white md:hidden"
            aria-label="Close navigation"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-5" aria-label="Partner sections">
          {NAV_ITEMS.map(({ key, label, icon: Icon, path, available }) => {
            const active = activeKey === key;
            const content = (
              <>
                <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-amber-400' : 'text-white/65'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
              </>
            );

            if (!available) {
              return (
                <button
                  type="button"
                  key={key}
                  disabled
                  aria-label={`${label} is not available`}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-white/45 transition-colors cursor-not-allowed"
                >
                  {content}
                </button>
              );
            }

            return (
              <Link
                key={key}
                to={path}
                onClick={onClose}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all ${
                  active
                    ? 'bg-amber-500 text-[#0F2B55] shadow-lg shadow-amber-500/20'
                    : 'text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                {content}
              </Link>
            );
          })}
        </nav>

        {/* User Profile & Logout */}
        <div className="border-t border-white/10 p-3 space-y-3">
          <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-white/5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-sm font-bold text-white shadow-sm">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{displayName}</p>
              <p className="truncate text-[11px] text-amber-300/70">Active Partner</p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
              Active
            </span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
            <span>{isLoggingOut ? 'Signing out...' : 'Logout'}</span>
          </button>
        </div>
      </aside>
    </>
  );
}

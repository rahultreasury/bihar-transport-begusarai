import { useContext } from 'react';
import { Menu, LogOut, Bell } from 'lucide-react';
import { AuthContext } from '../../contexts/AuthContext';

export default function PartnerHeader({ onMenu }) {
  const { user, logout } = useContext(AuthContext);
  const firstName = user?.first_name || user?.name || 'Partner';
  const lastName = user?.last_name || '';
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'P';

  return (
    <header className="sticky top-0 z-30 border-b border-[#1e3a5f]/8 bg-white/95 backdrop-blur-xl">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onMenu}
            className="rounded-xl border border-[#1e3a5f]/10 bg-white p-2 text-[#1e3a5f]/60 hover:bg-[#F5A623]/10 hover:text-[#F5A623] md:hidden"
            aria-label="Open partner navigation"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#F5A623]">Partner Workspace</p>
            <h1 className="truncate text-base font-bold text-[#0F2B55] sm:text-lg">Dashboard</h1>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {/* Notifications */}
          <button
            type="button"
            className="relative rounded-xl border border-[#1e3a5f]/10 bg-white p-2 text-[#1e3a5f]/60 hover:bg-[#F5A623]/10 hover:text-[#F5A623] transition-colors"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" aria-hidden="true" />
            <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-[#F5A623] text-[10px] font-bold text-white flex items-center justify-center">3</span>
          </button>

          {/* User Menu */}
          <div className="hidden sm:flex items-center gap-3 pl-3 border-l border-[#1e3a5f]/10">
            <div className="text-right">
              <p className="truncate text-sm font-semibold text-[#0F2B55]">{displayName || 'Partner'}</p>
              <p className="truncate text-[11px] text-[#1e3a5f]/50">Partner account</p>
            </div>
            <div
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#F5A623] to-[#e8941a] text-sm font-bold text-white shadow-sm"
              aria-label={`Logged in as ${displayName || 'Partner'}`}
              title={displayName || 'Partner'}
            >
              {initials}
            </div>
          </div>

          <button
            type="button"
            onClick={logout}
            className="rounded-xl border border-[#1e3a5f]/10 bg-white p-2 text-[#1e3a5f]/60 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600"
            aria-label="Logout"
            title="Logout"
          >
            <LogOut className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}

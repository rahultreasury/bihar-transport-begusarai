import React, { useMemo, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminTheme } from '../theme/useAdminTheme';

export default function AdminSidebar({ navItems = [], activeKey, onNav, basePath = '/admin' }) {
  const { toggleTheme, themeLabel } = useAdminTheme();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleNav = useCallback((key) => {
    if (key === 'dashboard') {
      navigate('/admin');
    } else if (key === 'bookings') {
      navigate('/admin/bookings');
    } else if (key === 'drivers') {
      navigate('/admin/drivers');
    } else {
      onNav?.(key);
    }
    setMobileOpen(false);
  }, [navigate, onNav]);

  const items = useMemo(() => navItems, [navItems]);

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="fixed top-4 left-4 z-50 xl:hidden flex items-center justify-center h-10 w-10 rounded-xl bg-white dark:bg-gray-900 shadow-lg border border-border/60"
        aria-label={mobileOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        <svg className="w-5 h-5 text-slate-700 dark:text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {mobileOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 xl:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — responsive: hidden on mobile (drawer), collapsed icons on xl, full on 2xl */}
      <aside className={`
        fixed xl:relative z-40 h-full
        transition-all duration-300 ease-in-out
        ${mobileOpen ? 'left-0' : '-left-72 xl:left-0'}
        w-60 shrink-0 border-r border-border/60 bg-sidebar/40 backdrop-blur-xl flex flex-col
      `}>
        {/* Logo / Brand — condensed on xl, full on 2xl */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm flex items-center justify-center text-white font-bold text-sm shrink-0">
              BT
            </div>
            <div className="hidden 2xl:block">
              <div className="text-sm font-semibold tracking-tight">Bihar Transport</div>
              <div className="text-xs text-muted">Enterprise Admin</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="px-3 flex-1 overflow-y-auto">
          <div className="text-[11px] uppercase text-muted/70 px-3 mb-2 mt-1 font-semibold tracking-wider hidden 2xl:block">
            Main Menu
          </div>
          {items.map((it) => {
            const isActive = it.key === activeKey;
            return (
              <button
                key={it.key}
                onClick={() => handleNav(it.key)}
                className={[
                  'w-full flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 relative',
                  isActive
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                    : 'text-text hover:bg-hover/60 border border-transparent hover:border-border/60'
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
                title={it.label}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-amber-400" aria-hidden="true" />
                )}
                <span className="text-lg leading-none w-6 text-center shrink-0">{it.icon || '•'}</span>
                <span className="text-sm font-medium hidden 2xl:block">{it.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Ops Health + Theme */}
        <div className="px-4 pb-5 space-y-2 mt-auto">
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text hover:bg-hover/60 border border-transparent hover:border-border/60 transition"
            title={`${themeLabel} Mode`}
          >
            <span className="text-lg leading-none w-6 text-center shrink-0">
              {themeLabel === 'Dark' ? '🌙' : '☀️'}
            </span>
            <span className="font-medium hidden 2xl:block">{themeLabel} Mode</span>
          </button>

          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 hidden 2xl:block">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Ops Health</div>
                <div className="text-xs text-muted mt-0.5">All systems normal</div>
              </div>
              <div className="relative">
                <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-green-500 animate-ping opacity-30" />
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}


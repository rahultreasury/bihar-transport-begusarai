import React, { useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminTheme } from '../theme/useAdminTheme';

export default function AdminSidebar({ navItems = [], activeKey, onNav, basePath = '/admin' }) {
  const { toggleTheme, themeLabel } = useAdminTheme();
  const navigate = useNavigate();

  const handleNav = useCallback((key) => {
    if (key === 'dashboard') {
      navigate('/admin');
    } else if (key === 'bookings') {
      navigate('/admin/bookings');
    } else {
      // Fallback to onNav for custom handlers
      onNav?.(key);
    }
  }, [navigate, onNav]);

  const items = useMemo(() => navItems, [navItems]);

  return (
    <aside className="w-[272px] shrink-0 border-r border-border/60 bg-sidebar/40 backdrop-blur-xl flex flex-col">
      {/* Logo / Brand */}
      <div className="p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm flex items-center justify-center text-white font-bold text-sm">
            BT
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">Bihar Transport</div>
            <div className="text-xs text-muted">Enterprise Admin</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="px-3 flex-1 overflow-y-auto">
        <div className="text-[11px] uppercase text-muted/70 px-3 mb-2 mt-1 font-semibold tracking-wider">
          Main Menu
        </div>
        <div className="space-y-1">
          {items.map((it) => {
            const isActive = it.key === activeKey;
            return (
              <button
                key={it.key}
                onClick={() => handleNav(it.key)}
                className={[
                  'w-full text-left flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 relative',
                  isActive
                    ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                    : 'text-text hover:bg-hover/60 border border-transparent hover:border-border/60'
                ].join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-amber-400" aria-hidden="true" />
                )}
                <span className="text-lg leading-none w-6 text-center">{it.icon || '•'}</span>
                <span className="text-sm font-medium">{it.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Ops Health + Theme */}
      <div className="px-4 pb-5 space-y-2 mt-auto">
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text hover:bg-hover/60 border border-transparent hover:border-border/60 transition"
        >
          <span className="text-lg leading-none w-6 text-center">
            {themeLabel === 'Dark' ? '🌙' : '☀️'}
          </span>
          <span className="font-medium">{themeLabel} Mode</span>
        </button>

        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
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
  );
}


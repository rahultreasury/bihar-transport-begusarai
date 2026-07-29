import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminTheme } from '../theme/useAdminTheme';
import {
  LayoutDashboard,
  Package,
  Users,
  Truck,
  BarChart3,
  FileText,
  Settings,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/admin' },
  { key: 'bookings', label: 'Bookings', icon: Package, path: '/admin/bookings' },
  { key: 'partners', label: 'Transport Partners', icon: Truck, path: '/admin/partners' },
  { key: 'drivers', label: 'Drivers', icon: Users, path: '/admin/drivers' },
  { key: 'settlements', label: 'Settlements', icon: FileText, path: '/admin/settlements' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: FileText, path: '/admin/reports' },
  { key: 'ai', label: 'AI Insights', icon: Sparkles, path: '/admin/ai' },
  { key: 'settings', label: 'Settings', icon: Settings, path: '/admin/settings' },
];

/**
 * AdminSidebar — Enterprise admin navigation with collapsed mode,
 * mobile drawer with focus trap, keyboard nav, and accessibility.
 */
export default function AdminSidebar({
  navItems = DEFAULT_NAV_ITEMS,
  activeKey,
  onNav,
  basePath = '/admin',
}) {
  const { toggleTheme, themeLabel } = useAdminTheme();
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const closeBtnRef = useRef(null);

  // Persist collapsed state in localStorage
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('admin_sidebar_collapsed') === 'true';
    } catch {
      return false;
    }
  });

  const [mobileOpen, setMobileOpen] = useState(false);

  // Save collapsed state
  useEffect(() => {
    try {
      localStorage.setItem('admin_sidebar_collapsed', String(collapsed));
    } catch { /* ignore */ }
  }, [collapsed]);

const handleNav = useCallback(
    (key, path) => {
      if (path) {
        navigate(path);
      } else if (key === 'dashboard') {
        navigate('/admin');
      } else if (key === 'bookings') {
        navigate('/admin/bookings');
      } else if (key === 'partners') {
        navigate('/admin/partners');
      } else if (key === 'drivers') {
        navigate('/admin/drivers');
      } else if (key === 'settlements') {
        navigate('/admin/settlements');
      } else if (key === 'analytics') {
        navigate('/admin/analytics');
      } else if (key === 'reports') {
        navigate('/admin/reports');
      } else if (key === 'ai') {
        navigate('/admin/ai');
      } else if (key === 'settings') {
        navigate('/admin/settings');
      } else {
        onNav?.(key);
      }
      setMobileOpen(false);
    },
    [navigate, onNav]
  );

  // Focus trap for mobile drawer
  useEffect(() => {
    if (!mobileOpen || !sidebarRef.current) return;

    const sidebar = sidebarRef.current;
    const focusable = sidebar.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    function handleTab(e) {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        } else if (!e.shiftKey && document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    }

    // Auto-focus close button
    closeBtnRef.current?.focus();

    sidebar.addEventListener('keydown', handleTab);
    return () => sidebar.removeEventListener('keydown', handleTab);
  }, [mobileOpen]);

  // ESC key closes mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    function handleEsc(e) {
      if (e.key === 'Escape') {
        setMobileOpen(false);
      }
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [mobileOpen]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => !c);
  }, []);

  // Memoize items to prevent re-renders
  const items = useMemo(() => {
    const itemsSource = navItems?.length ? navItems : DEFAULT_NAV_ITEMS;
    return itemsSource.map((item) => ({
      ...item,
      // Ensure icon is a component, fallback to LayoutDashboard
      Icon: item.icon || LayoutDashboard,
    }));
  }, [navItems]);

  const sidebarWidth = collapsed ? 'w-20' : 'w-60';

  return (
    <>
      {/* Skip to main content — accessibility */}
      <a
        href="#admin-main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-amber-500 focus:text-white focus:rounded-xl focus:shadow-lg focus:outline-none"
      >
        Skip to main content
      </a>

      {/* Mobile hamburger button — visible below xl */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 xl:hidden flex items-center justify-center h-11 w-11 rounded-xl bg-white dark:bg-gray-900 shadow-lg border border-border/60 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label="Open sidebar navigation menu"
        aria-expanded={mobileOpen}
        aria-controls="admin-sidebar"
      >
        <Menu className="w-5 h-5 text-slate-700 dark:text-slate-200" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 xl:hidden animate-fade-in"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        id="admin-sidebar"
        ref={sidebarRef}
        role="navigation"
        aria-label="Admin navigation"
        className={`
          fixed xl:relative z-40 h-full
          transition-all duration-300 ease-in-out
          ${mobileOpen ? 'left-0' : '-left-72 xl:left-0'}
          ${sidebarWidth}
          shrink-0 border-r border-border/60 bg-sidebar/40 backdrop-blur-xl
          flex flex-col
          ${collapsed ? 'items-center' : ''}
        `}
      >
        {/* Logo / Brand */}
        <div className={`p-4 flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
          <div className={`flex items-center ${collapsed ? '' : 'gap-3'}`}>
            <div
              className="h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-sm flex items-center justify-center text-white font-bold text-sm shrink-0"
              aria-hidden="true"
            >
              BT
            </div>
            {!collapsed && (
              <div className="animate-fade-in">
                <div className="text-sm font-semibold tracking-tight">Bihar Transport</div>
                <div className="text-xs text-muted">Enterprise Admin</div>
              </div>
            )}
          </div>

          {/* Collapse toggle — hidden on mobile, visible on desktop */}
          <button
            onClick={toggleCollapsed}
            className="hidden xl:flex items-center justify-center h-7 w-7 rounded-lg hover:bg-hover/60 transition text-muted hover:text-text"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? (
              <ChevronRight className="w-4 h-4" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>

          {/* Mobile close button */}
          <button
            ref={closeBtnRef}
            onClick={() => setMobileOpen(false)}
            className="xl:hidden flex items-center justify-center h-8 w-8 rounded-lg hover:bg-hover/60 transition text-muted hover:text-text"
            aria-label="Close sidebar navigation menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`} aria-label="Main menu">
          {!collapsed && (
            <div className="text-[11px] uppercase text-muted/70 px-3 mb-2 mt-1 font-semibold tracking-wider">
              Main Menu
            </div>
          )}
          <ul role="menubar" aria-orientation="vertical" className="space-y-1">
            {items.map((it) => {
              const isActive = it.key === activeKey;
              const Icon = it.Icon;
              return (
                <li key={it.key} role="none">
                  <button
                    role="menuitem"
                    onClick={() => handleNav(it.key, it.path)}
                    className={[
                      'w-full flex items-center rounded-xl transition-all duration-150 relative group',
                      collapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3 py-2.5',
                      isActive
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                        : 'text-text hover:bg-hover/60 border border-transparent hover:border-border/60',
                    ].join(' ')}
                    aria-current={isActive ? 'page' : undefined}
                    aria-label={it.label}
                    title={collapsed ? it.label : undefined}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-amber-400"
                        aria-hidden="true"
                      />
                    )}
                    <Icon
                      className={`shrink-0 ${collapsed ? 'w-6 h-6' : 'w-5 h-5'}`}
                      aria-hidden="true"
                    />
                    {!collapsed && (
                      <span className="text-sm font-medium whitespace-nowrap">{it.label}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom section — Theme toggle + logout */}
        <div className={`pb-5 space-y-2 mt-auto ${collapsed ? 'px-2' : 'px-4'}`}>
          <button
            onClick={toggleTheme}
            className={`w-full flex items-center rounded-xl px-3 py-2.5 text-sm text-text hover:bg-hover/60 border border-transparent hover:border-border/60 transition ${
              collapsed ? 'justify-center' : 'gap-3'
            }`}
            aria-label={`Switch to ${themeLabel === 'Dark' ? 'light' : 'dark'} mode`}
            title={collapsed ? `${themeLabel} Mode` : undefined}
          >
            {themeLabel === 'Dark' ? (
              <Moon className={`shrink-0 ${collapsed ? 'w-6 h-6' : 'w-5 h-5'}`} aria-hidden="true" />
            ) : (
              <Sun className={`shrink-0 ${collapsed ? 'w-6 h-6' : 'w-5 h-5'}`} aria-hidden="true" />
            )}
            {!collapsed && <span className="font-medium">{themeLabel} Mode</span>}
          </button>

          {!collapsed && (
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4" role="status" aria-live="polite">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">Ops Health</div>
                  <div className="text-xs text-muted mt-0.5">All systems normal</div>
                </div>
                <div className="relative" aria-label="System status: healthy">
                  <div className="h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
                  <div className="absolute inset-0 h-2.5 w-2.5 rounded-full bg-green-500 animate-ping opacity-30" />
                </div>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}


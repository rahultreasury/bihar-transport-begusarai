/**
 * AdminNavigationDrawer.jsx
 * ---------------------------------------------------------------------------
 * The admin navigation drawer. Replaces the permanent 285px sidebar column.
 *
 * WHY IT OVERLAYS
 * The sidebar used to sit in the flex row and permanently reserve 285px (or
 * 76px collapsed) of horizontal space. On data-heavy screens — the enquiry
 * table, the booking ledger, the trip grid — that column is the most expensive
 * real estate on the page, because a table is exactly what wants more width.
 * The drawer is therefore position:fixed and removed from document flow: the
 * workspace underneath uses the full viewport width at all times, and the nav
 * appears over it only while it is open.
 *
 * IT REUSES, IT DOES NOT REINVENT
 *   • the item list and key→path mapping  → adminNavigation.js
 *   • the live enquiry count + its 60s poll → usePendingEnquiryCount()
 *   • the theme toggle and Ops Health card → useAdminTheme()
 *   • the brand navy / amber pills          → literal tokens, as before
 *   • the focus trap + ESC handling         → carried over from the sidebar
 *
 * Accessibility notes: it is a modal dialog while open (focus is trapped and
 * Escape closes it), and inert-ish when closed (unmounted entirely, so its
 * links are never tab-reachable while hidden).
 */

import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, Sun, Moon, X, CheckCircle2 } from 'lucide-react';

import { AuthContext } from '../../../contexts/AuthContext';
import { useAdminTheme } from '../theme/useAdminTheme';
import {
  DEFAULT_NAV_ITEMS,
  buildNavGroups,
  resolveNavPath,
} from './adminNavigation';

// The navigation panel IS the brand navy. Text sits on white/muted-white, the
// single accent is the orange active pill, and nothing else is coloured.
const DRAWER_SURFACE = 'bg-bt-navy';
const DRAWER_BORDER = 'border-white/10';
const DRAWER_HOVER = 'hover:bg-white/[0.08]';
const DRAWER_TEXT = 'text-white/75';
const DRAWER_ICON = 'text-white/60';
const DRAWER_MUTED = 'text-white/45';
const ACTIVE_PILL =
  'bg-bt-orange text-bt-navy-dark font-semibold shadow-[0_6px_18px_rgba(245,160,0,0.28)]';

export default function AdminNavigationDrawer({
  open,
  onClose,
  navItems,
  activeKey,
  onNav,
  pendingEnquiries,
}) {
  const { toggleTheme, themeLabel } = useAdminTheme();
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const closeBtnRef = useRef(null);

  const { user } = useContext(AuthContext) || {};
  const adminName = user?.full_name || user?.first_name || 'System Administrator';
  const adminInitials =
    adminName
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join('') || 'A';

  const items = useMemo(() => (navItems?.length ? navItems : DEFAULT_NAV_ITEMS), [navItems]);
  const groups = useMemo(() => buildNavGroups(items), [items]);

  const handleNav = useCallback(
    (item) => {
      const path = resolveNavPath(item);
      if (path) navigate(path);
      else onNav?.(item.key);
      // Always close: an overlay that lingers over the page the user just
      // navigated to is the most common drawer bug.
      onClose?.();
    },
    [navigate, onNav, onClose]
  );

  // Focus trap while open — carried over from the old sidebar drawer.
  useEffect(() => {
    if (!open || !panelRef.current) return undefined;

    const panel = panelRef.current;
    const focusable = panel.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstFocusable = focusable[0];
    const lastFocusable = focusable[focusable.length - 1];

    function handleTab(e) {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === firstFocusable) {
        e.preventDefault();
        lastFocusable?.focus();
      } else if (!e.shiftKey && document.activeElement === lastFocusable) {
        e.preventDefault();
        firstFocusable?.focus();
      }
    }

    closeBtnRef.current?.focus();
    panel.addEventListener('keydown', handleTab);
    return () => panel.removeEventListener('keydown', handleTab);
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return undefined;
    function handleEsc(e) {
      if (e.key === 'Escape') onClose?.();
    }
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [open, onClose]);

  // Lock body scroll so the page behind does not move under the overlay.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60]" role="presentation">
      {/* Scrim — clicking anywhere outside the panel dismisses the drawer. */}
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default bg-bt-navy-dark/60-[2px]"
        onClick={onClose}
        aria-label="Close navigation"
        tabIndex={-1}
      />

      {/* The panel itself. Fixed + translate: it never occupies layout space. */}
      <aside
        id="admin-navigation-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Admin navigation"
        className={`absolute inset-y-0 left-0 flex w-[288px] max-w-[85vw] flex-col border-r ${DRAWER_BORDER} ${DRAWER_SURFACE} text-white shadow-[0_0_60px_rgba(16,43,76,0.35)]`}
      >
        {/* Brand */}
        <div className={`flex h-16 shrink-0 items-center justify-between border-b ${DRAWER_BORDER} px-4`}>
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bt-orange text-[13px] font-bold text-bt-navy-dark"
              aria-hidden="true"
            >
              BT
            </div>
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold tracking-tight text-white">Bihar Transport</div>
              <div className={`truncate text-[11px] font-semibold uppercase tracking-[0.1em] ${DRAWER_MUTED}`}>
                Operations Console
              </div>
            </div>
          </div>

          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors ${DRAWER_HOVER} hover:text-white`}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Grouped navigation */}
        <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main menu">
          {groups.map((group) => (
            <div key={group.title} className="mb-6 last:mb-0">
              <div className={`mb-2 px-3 text-[10.5px] font-bold uppercase tracking-[0.14em] ${DRAWER_MUTED}`}>
                {group.title}
              </div>
              <ul className="space-y-1">
                {group.items.map((it) => {
                  const isActive = it.key === activeKey;
                  const Icon = it.Icon ?? it.icon ?? LayoutDashboard;
                  return (
                    <li key={it.key}>
                      <button
                        type="button"
                        onClick={() => handleNav(it)}
                        className={[
                          'relative flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 transition-all duration-150',
                          isActive
                            ? ACTIVE_PILL
                            : `${DRAWER_TEXT} ${DRAWER_HOVER} hover:text-white border border-transparent hover:border-white/10`,
                        ].join(' ')}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {/* Icons may be a lucide component OR a plain string
                            glyph (some admin pages pass string icons). */}
                        {typeof Icon === 'string' || typeof Icon === 'number' ? (
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
                            {Icon}
                          </span>
                        ) : (
                          <Icon
                            className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-bt-navy-dark' : DRAWER_ICON}`}
                            strokeWidth={2}
                            aria-hidden="true"
                          />
                        )}
                        <span className="truncate text-[14px] font-medium">{it.label}</span>

                        {it.key === 'enquiries' && pendingEnquiries != null && pendingEnquiries > 0 && (
                          <span
                            className={[
                              'ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums',
                              isActive ? 'bg-bt-navy-dark text-white' : 'bg-bt-orange text-bt-navy-dark',
                            ].join(' ')}
                            title={`${pendingEnquiries} enquir${pendingEnquiries === 1 ? 'y' : 'ies'} awaiting review`}
                            aria-label={`${pendingEnquiries} awaiting review`}
                          >
                            {pendingEnquiries > 99 ? '99+' : pendingEnquiries}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        {/* Identity + theme + ops status */}
        <div className={`mt-auto space-y-2 border-t ${DRAWER_BORDER} px-3 py-4`}>
          <div className="flex items-center gap-3 rounded-[10px] bg-white/[0.06] px-3 py-2.5">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white/10 text-[13px] font-bold text-white"
              aria-hidden="true"
            >
              {adminInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-semibold text-white">{adminName}</div>
              <div className={`truncate text-[11px] font-medium uppercase tracking-wider ${DRAWER_MUTED}`}>
                Administrator
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className={`flex w-full items-center gap-3 rounded-[10px] border border-transparent px-3 py-2.5 text-[14px] text-white/70 transition-colors ${DRAWER_HOVER} hover:text-white`}
            aria-label={`Switch to ${themeLabel === 'Dark' ? 'light' : 'dark'} mode`}
          >
            {themeLabel === 'Dark' ? (
              <Moon className="h-5 w-5 shrink-0" aria-hidden="true" />
            ) : (
              <Sun className="h-5 w-5 shrink-0" aria-hidden="true" />
            )}
            <span className="font-medium">{themeLabel} Mode</span>
          </button>

          <div
            className="flex items-center justify-between rounded-[12px] border border-white/10 bg-white/[0.06] px-4 py-3.5"
            role="status"
            aria-live="polite"
          >
            <div>
              <div className="text-[13px] font-semibold text-white">Ops Health</div>
              <div className={`mt-0.5 text-[12px] ${DRAWER_MUTED}`}>All systems normal</div>
            </div>
            <div className="relative" aria-label="System status: healthy">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

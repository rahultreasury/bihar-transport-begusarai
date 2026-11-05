/**
 * AdminSidebar.jsx
 * ---------------------------------------------------------------------------
 * RETIRED — kept only as a compatibility shim.
 *
 * The permanent sidebar column has been replaced by:
 *   • AdminTopHeader        — the compact sticky global header
 *   • AdminNavigationDrawer — the overlay navigation
 *   both owned by AdminShell, which is what every admin page actually renders.
 *
 * There is no longer any permanent left column reserving 285px of the viewport.
 *
 * WHY THE FILE STILL EXISTS
 * Four pages import `DEFAULT_NAV_ITEMS` from this exact path
 * (AdminEnquiries, AdminEnquiryWorkspace, AdminOrders, AdminOrderMaster). Rather
 * than edit those call sites — which would be churn unrelated to the layout
 * change — the symbol is re-exported from the new single source of truth,
 * adminNavigation.js. The nav definition now lives in exactly one place.
 *
 * AdminSidebar's own component is no longer rendered anywhere. It is kept as a
 * named export for safety, and behaves as an overlay drawer if anything ever
 * does mount it, but nothing in the app depends on that.
 */

import { DEFAULT_NAV_ITEMS, buildNavGroups, resolveNavPath } from './adminNavigation';

export { DEFAULT_NAV_ITEMS };

/**
 * @deprecated The admin console is navigated through AdminNavigationDrawer.
 * Rendered only if a future caller still asks for a sidebar by name.
 */
export default function AdminSidebar({
  navItems = DEFAULT_NAV_ITEMS,
  activeKey,
  onNav,
  navigate,
  onClose,
}) {
  const groups = buildNavGroups(navItems);

  const handleNav = (item) => {
    const path = resolveNavPath(item);
    if (navigate && path) navigate(path);
    else onNav?.(item.key);
    onClose?.();
  };

  return (
    <div className="w-full">
      {groups.map((group) => (
        <div key={group.title} className="mb-4">
          <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {group.title}
          </div>
          <ul className="space-y-1">
            {group.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => handleNav(item)}
                  aria-current={item.key === activeKey ? 'page' : undefined}
                  className={[
                    'w-full rounded-xl px-3 py-2 text-left text-sm font-medium transition-colors',
                    item.key === activeKey
                      ? 'bg-amber-500 text-[#15345B]'
                      : 'text-text hover:bg-card/60',
                  ].join(' ')}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

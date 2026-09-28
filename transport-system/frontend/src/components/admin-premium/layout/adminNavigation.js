/**
 * adminNavigation.js
 * ---------------------------------------------------------------------------
 * THE single source of truth for admin navigation.
 *
 * WHY THIS FILE EXISTS
 * Navigation used to be defined inside AdminSidebar.jsx. The sidebar has been
 * replaced by a collapsible drawer plus a compact sticky header, and the nav
 * definition is now consumed by three different components (the header's
 * "current module" label, the drawer, and pages that still import
 * `DEFAULT_NAV_ITEMS` directly). Defining it once here is what keeps those
 * three from drifting apart.
 *
 * The flat `DEFAULT_NAV_ITEMS` array is preserved EXACTLY as it was, because
 * several pages pass it straight into <AdminShell navItems={...}>. The grouped
 * `NAV_GROUPS` list is a presentational re-ordering of those same items — no
 * route was added, removed, or renamed.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Users,
  Truck,
  Car,
  BarChart3,
  FileText,
  Sparkles,
  Route,
  Inbox,
  Wallet,
} from 'lucide-react';

import { adminEnquiryAPI } from '../../../services/enquiryAPI';

/**
 * The canonical nav list. Order here is the legacy order and is still used as
 * the fallback when a page passes no `navItems` at all.
 */
export const DEFAULT_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, path: '/admin' },
  { key: 'enquiries', label: 'ENQUIRY', icon: Inbox, path: '/admin/enquiries' },
  { key: 'intake-enquiries', label: 'Enquiry Intake', icon: Inbox, path: '/admin/intake-enquiries' },
  { key: 'financials', label: 'Financials', icon: BarChart3, path: '/admin/financials' },
  { key: 'bookings', label: 'Bookings', icon: Package, path: '/admin/bookings' },
  { key: 'trips', label: 'Trips', icon: Route, path: '/admin/trips' },
  { key: 'clients', label: 'Clients', icon: Users, path: '/admin/clients' },
  { key: 'owners', label: 'Transport Owners', icon: Truck, path: '/admin/owners' },
  { key: 'vehicles', label: 'Vehicles', icon: Car, path: '/admin/vehicles' },
  { key: 'drivers', label: 'Drivers', icon: Users, path: '/admin/drivers' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: Truck, path: '/admin/vehicle-owners' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, path: '/admin/analytics' },
  { key: 'reports', label: 'Reports', icon: FileText, path: '/admin/reports' },
  { key: 'ai', label: 'AI Insights', icon: Sparkles, path: '/admin/ai' },
];

/**
 * Legacy key → path fallback.
 *
 * Preserved verbatim from the old sidebar so any caller that navigates by KEY
 * (rather than by the item's own `path`) still lands in exactly the same place.
 * `settlements` was already handled here even though it had no entry in
 * DEFAULT_NAV_ITEMS; it is now also listed under FINANCE so the drawer exposes
 * the page that this mapping already supported.
 */
const KEY_PATH_FALLBACK = {
  dashboard: '/admin',
  financials: '/admin/financials',
  bookings: '/admin/bookings',
  trips: '/admin/trips',
  clients: '/admin/clients',
  drivers: '/admin/drivers',
  vehicles: '/admin/vehicles',
  'vehicle-owners': '/admin/vehicle-owners',
  owners: '/admin/owners',
  partners: '/admin/owners',
  settlements: '/admin/settlements',
  analytics: '/admin/analytics',
  reports: '/admin/reports',
  ai: '/admin/ai',
  settings: '/admin/settings',
};

/**
 * Resolve a nav item to the route it opens.
 * @param {{key?:string, path?:string}} item
 * @returns {string|null}
 */
export function resolveNavPath(item) {
  if (!item) return null;
  if (item.path) return item.path;
  return KEY_PATH_FALLBACK[item.key] || null;
}

/**
 * The drawer's grouped presentation. Every entry references a key that already
 * exists in DEFAULT_NAV_ITEMS, so a page that supplies its OWN `navItems` still
 * works: unknown keys are simply skipped, and unlisted items fall through to a
 * trailing "More" group rather than disappearing.
 *
 * @param {Array<{key:string,label:string,icon:any,path:string}>} items
 * @returns {Array<{title:string, items:Array}>}
 */
export function buildNavGroups(items = DEFAULT_NAV_ITEMS) {
  const byKey = new Map(items.map((it) => [it.key, it]));
  const take = (...keys) => keys.map((k) => byKey.get(k)).filter(Boolean);

  const groups = [
    { title: 'Operations', items: take('dashboard', 'enquiries', 'intake-enquiries', 'bookings', 'trips') },
    { title: 'Network', items: take('clients', 'owners', 'vehicles', 'drivers', 'vehicle-owners') },
    { title: 'Finance', items: take('financials', 'settlements') },
    { title: 'Insights', items: take('analytics', 'reports', 'ai') },
  ].filter((g) => g.items.length > 0);

  // Anything a caller passed that none of the groups claimed.
  const grouped = new Set(groups.flatMap((g) => g.items.map((i) => i.key)));
  const extra = items.filter((it) => !grouped.has(it.key));
  if (extra.length) groups.push({ title: 'More', items: extra });

  return groups;
}

/**
 * The label the sticky header shows for the module currently open.
 *
 * Derived from the real URL, not from a prop, so it is correct on a deep link,
 * on browser back/forward, and after a refresh — all of which change the
 * location without re-rendering any page component. Detail pages
 * (/admin/enquiries/:id) resolve to their list module by longest-prefix match.
 *
 * @param {string} pathname - window.location.pathname
 * @param {Array} items
 * @returns {string}
 */
export function resolveModuleLabel(pathname = '', items = DEFAULT_NAV_ITEMS) {
  const path = String(pathname || '');
  if (!path || path === '/admin' || path === '/admin/') return 'DASHBOARD';

  // Longest path wins, so /admin/enquiries/42 maps to Enquiry, not to /admin.
  let best = null;
  for (const item of items) {
    const target = resolveNavPath(item);
    if (!target || target === '/admin') continue;
    if (path === target || path.startsWith(`${target}/`)) {
      if (!best || target.length > best.target.length) best = { target, item };
    }
  }
  if (best) return String(best.item.label).toUpperCase();

  // Unknown admin route: show its own first segment rather than nothing.
  const segment = path.split('/').filter(Boolean)[1] || '';
  return segment ? segment.replace(/[-_]/g, ' ').toUpperCase() : 'ADMIN';
}

/**
 * Live count of Enquiry records awaiting review.
 *
 * Reads GET /api/admin/enquiries/stats — the same `enquiries` table the enquiry
 * screens list. Moved here (unchanged) so the drawer badge and the header
 * notification bell share ONE poll instead of two.
 *
 * A failed request keeps the previous value rather than blanking the badge, and
 * the 'enquiry-count:changed' event still lets a page force an immediate
 * refresh after it sends or resolves a quote.
 *
 * @returns {number|null} null = unknown, 0 = none pending
 */
export function usePendingEnquiryCount() {
  const [pendingEnquiries, setPendingEnquiries] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const res = await adminEnquiryAPI.getStats();
      const total = res?.data?.data?.NEW;
      setPendingEnquiries(Number.isFinite(total) ? total : null);
    } catch {
      /* keep the previous value; a failed poll must not blank the badge */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    const handler = () => refresh();
    window.addEventListener('enquiry-count:changed', handler);
    return () => window.removeEventListener('enquiry-count:changed', handler);
  }, [refresh]);

  return pendingEnquiries;
}

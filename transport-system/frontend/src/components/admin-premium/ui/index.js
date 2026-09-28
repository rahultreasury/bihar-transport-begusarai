/**
 * admin-premium/ui/index.js
 * ---------------------------------------------------------------------------
 * ONE import path for the console's design system.
 *
 * Every admin module should pull its layout and its primitives from here, so
 * that a page never re-implements a card, a button, a badge or a status
 * treatment locally. That single rule is what keeps thirty pages looking like
 * one product instead of thirty.
 *
 *   import AdminShell, { PageHeader, SectionCard, KpiCard, StatusBadge } from
 *     '../components/admin-premium/ui';
 *
 * The underlying modules are still importable directly for the rare case where
 * a page needs a default export (AdminShell, PremiumTable, EmptyState).
 */

import AdminShell from '../layout/AdminShell';

export { default as AdminShell } from '../layout/AdminShell';
export { default as AdminTopHeader } from '../layout/AdminTopHeader';
export { default as AdminNavigationDrawer } from '../layout/AdminNavigationDrawer';
export { DEFAULT_NAV_ITEMS, resolveNavPath, resolveModuleLabel, buildNavGroups } from '../layout/adminNavigation';

/* Surfaces */
export { default as SectionCard } from './SectionCard';
export { default as KpiCard } from './KpiCard';
export { default as EmptyState } from './EmptyState';
export { default as PremiumTable } from './PremiumTable';

/* Loading + failure states */
export {
  LoadingSkeleton,
  SkeletonText,
  SkeletonKpis,
  SkeletonTable,
} from './LoadingSkeleton';

/* The shared vocabulary: header, buttons, badges, search, forms, modals, charts */
export {
  PageHeader,
  Button,
  StatusBadge,
  resolveStatusTone,
  humanizeStatus,
  SearchBar,
  FilterBar,
  FilterSelect,
  FormField,
  AdminModal,
  ErrorState,
  BlankState,
  IconTile,
  DetailRow,
  CHART_COLORS,
  CHART_SERIES,
  CHART_GRID,
  CHART_TOOLTIP,
  CHART_AXIS,
} from './AdminUI';

export default AdminShell;

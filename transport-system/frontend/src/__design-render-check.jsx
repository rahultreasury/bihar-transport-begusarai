/**
 * Design-system render smoke test (development only).
 *
 * Renders every shared primitive with react-dom/server and prints the markup,
 * so a change to a token or a component can be verified without opening a
 * browser. Run with:
 *
 *   npm run check:design
 *
 * It asserts nothing about layout — it proves the components mount, that the
 * status resolver maps every documented status to a semantic tone, and that
 * the premium class names actually reach the DOM.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { Package } from 'lucide-react';

import KpiCard from './components/admin-premium/ui/KpiCard';
import SectionCard from './components/admin-premium/ui/SectionCard';
import PremiumTable from './components/admin-premium/ui/PremiumTable';
import EmptyState from './components/admin-premium/ui/EmptyState';
import {
  PageHeader,
  Button,
  StatusBadge,
  SearchBar,
  FilterBar,
  AdminModal,
  ErrorState,
  IconTile,
  resolveStatusTone,
} from './components/admin-premium/ui/AdminUI';

const STATUSES = [
  'CONFIRMED',
  'VEHICLE_ASSIGNED',
  'DRIVER_ASSIGNED',
  'AWAITING_QUOTE',
  'QUOTE_SENT',
  'PENDING',
  'REJECTED',
  'CANCELLED',
  'COMPLETED',
  'PAID',
  'PARTIALLY PAID',
  'OUTSTANDING',
];

const EXPECTED_TONE = {
  CONFIRMED: 'success',
  VEHICLE_ASSIGNED: 'info',
  DRIVER_ASSIGNED: 'info',
  AWAITING_QUOTE: 'warning',
  QUOTE_SENT: 'accent',
  PENDING: 'warning',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  COMPLETED: 'success',
  PAID: 'success',
  'PARTIALLY PAID': 'info',
  OUTSTANDING: 'danger',
};

export function runDesignChecks() {
  const failures = [];

  // 1. Every documented status must resolve to its documented tone.
  for (const status of STATUSES) {
    const tone = resolveStatusTone(status);
    if (tone !== EXPECTED_TONE[status]) {
      failures.push(`status "${status}" resolved to "${tone}", expected "${EXPECTED_TONE[status]}"`);
    }
  }

  // 2. The primitives must mount and carry their premium class names.
  const html = renderToStaticMarkup(
    <MemoryRouter>
      <div>
        <PageHeader
          eyebrow="Network"
          title="Clients"
          description="Offline business accounts."
          actions={<Button variant="accent" icon={Package}>Add Client</Button>}
        />

        <div className="grid">
          <KpiCard title="Total Bookings" value="128" subtitle="All time" accent="navy" icon={Package} />
          <KpiCard title="Outstanding" value="₹4.2L" subtitle="Amount due" accent="danger" />
        </div>

        <SectionCard
          title="Pricing"
          subtitle="Pricing and quotation information"
          icon={Package}
          action={<Button size="sm">Export</Button>}
        >
          <p>body</p>
        </SectionCard>

        <FilterBar>
          <SearchBar value="pat" onChange={() => {}} placeholder="Search" />
        </FilterBar>

        <div>
          {STATUSES.map((s) => (
            <StatusBadge key={s} status={s} />
          ))}
        </div>

        <PremiumTable
          columns={[{ key: 'id', header: 'Enquiry ID' }, { key: 'route', header: 'Route' }]}
          rows={[{ id: 1, route: 'Patna → Delhi' }]}
        />

        <EmptyState title="No records" subtitle="Nothing here yet." />
        <ErrorState message="Boom" onRetry={() => {}} />
        <IconTile icon={Package} tone="orange" />
      </div>
    </MemoryRouter>
  );

  const REQUIRED = [
    'bt-page-title',
    'bt-page-desc',
    'bt-eyebrow',
    'bt-kpi',
    'bt-kpi-value',
    'bt-card',
    'bt-card-header',
    'bt-section-title',
    'bt-icon-chip',
    'bt-btn',
    'bt-btn-accent',
    'bt-badge',
    'bt-table-wrap',
    'bt-table',
    'bt-input',
    'bt-empty',
    'bt-error',
  ];

  for (const cls of REQUIRED) {
    if (!html.includes(cls)) failures.push(`missing class "${cls}" in rendered markup`);
  }

  // 3. The modal is a dialog and must close when not open.
  const closed = renderToStaticMarkup(<AdminModal open={false} onClose={() => {}} title="Hidden" />);
  if (closed !== '') failures.push('AdminModal rendered content while closed');

  return { failures, html };
}

const { failures, html } = runDesignChecks();

if (failures.length) {
  console.error('DESIGN SYSTEM CHECK FAILED');
  failures.forEach((f) => console.error('  ✗ ' + f));
  process.exit(1);
}

console.log('DESIGN SYSTEM CHECK PASSED — all primitives render, all statuses resolve.');
console.log(`Rendered ${html.length} bytes of markup using the shared components.`);

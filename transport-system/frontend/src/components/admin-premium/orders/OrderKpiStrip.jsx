/**
 * OrderKpiStrip.jsx — the ORDER / TRIP MASTER dashboard tiles (§19).
 *
 * Every figure is derived by `summariseOrders()` from the rows the server just
 * returned. Nothing here is a hardcoded number, and the strip shows a skeleton
 * while the list is in flight so the admin never sees a stale "0".
 */

import React from 'react';
import {
  ClipboardList,
  Truck,
  Navigation,
  PackageCheck,
  FileCheck2,
  CheckCircle2,
  Wallet,
} from 'lucide-react';
import { summariseOrders } from '../../../utils/orderStatus';
import { inrCompact } from '../../../utils/orderFormat';

const TILE = [
  { key: 'total', label: 'Total Orders', icon: ClipboardList, tone: 'navy' },
  { key: 'activeTrips', label: 'Active Trips', icon: Truck, tone: 'navy' },
  { key: 'vehiclesHired', label: 'Vehicles Hired', icon: Navigation, tone: 'navy' },
  { key: 'inTransit', label: 'In Transit', icon: PackageCheck, tone: 'orange' },
  { key: 'delivered', label: 'Delivered', icon: PackageCheck, tone: 'orange' },
  { key: 'podPending', label: 'POD Pending', icon: FileCheck2, tone: 'orange' },
  { key: 'completed', label: 'Completed', icon: CheckCircle2, tone: 'orange' },
  { key: 'paymentDue', label: 'Payment Due', icon: Wallet, tone: 'orange', money: true },
];

const ICON_STYLE = {
  navy: 'bg-[#15345B]/5 text-[#15345B]',
  orange: 'bg-amber-50 text-[#D98C0B]',
};

/**
 * ONE KPI TILE.
 *
 * A tile shows a real `0` only when the data genuinely says zero. When there is
 * no data at all — typically because the orders request FAILED — it shows an
 * em dash and a "no data" note instead.
 *
 * This matters because the two are very different statements:
 *     "0 orders"        → the database has none
 *     "—" (no data)     → we could not ask
 * Collapsing the second into the first makes a broken API look like an empty
 * business, which is how a server outage went unnoticed behind a row of zeros.
 */
function Tile({ def, value, loading, hasData = true }) {
  const Icon = def.icon;
  const unknown = !loading && !hasData;

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3.5 shadow-[0_1px_2px_rgba(15,43,85,0.04)]">
      <div className="flex items-center gap-2.5">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_STYLE[def.tone]}`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {def.label}
        </p>
      </div>
      {loading ? (
        <div className="mt-2 h-7 w-16 animate-pulse rounded bg-slate-100" />
      ) : (
        <>
          <p
            className={`mt-1.5 text-2xl font-bold tabular-nums tracking-tight ${
              unknown ? 'text-slate-300' : 'text-[#15345B]'
            }`}
          >
            {unknown ? '—' : def.money ? inrCompact(value) : (value ?? 0).toLocaleString('en-IN')}
          </p>
          {unknown ? (
            <p className="mt-0.5 text-[11px] font-medium text-amber-600">No data — load failed</p>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function OrderKpiStrip({ rows, loading = false, hasData = true }) {
  const summary = summariseOrders(rows);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {TILE.map((def) => (
        <Tile key={def.key} def={def} value={summary[def.key]} loading={loading} hasData={hasData} />
      ))}
    </div>
  );
}

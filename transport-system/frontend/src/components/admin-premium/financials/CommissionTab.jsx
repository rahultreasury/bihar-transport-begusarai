/**
 * CommissionTab — what Bihar Transport earned on each hire.
 *
 * Commission is read from the stored VehicleHire row where the Phase 2
 * calculator wrote it: never recomputed from today's rate. A receipt against
 * that commission is a separate, explicit ledger row; the screen shows earned,
 * received and remaining without conflating them.
 */

import React, { useState } from 'react';
import { CircleDollarSign, Percent, TrendingUp, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import SectionCard from '../ui/SectionCard';
import { SearchBar, CHART_AXIS, CHART_COLORS, CHART_GRID, CHART_TOOLTIP } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';

export default function CommissionTab({ filters, refreshKey }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getCommission({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      search: search || undefined,
      status: status || undefined,
      page,
      limit: 25,
    });
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, search, status, page, refreshKey]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  const split = [
    { name: 'Percentage', value: summary.percentage || 0, color: CHART_COLORS.navy },
    { name: 'Fixed', value: summary.fixed || 0, color: CHART_COLORS.orange },
    { name: 'Received', value: summary.received || 0, color: CHART_COLORS.success },
    { name: 'Remaining', value: summary.remaining || 0, color: CHART_COLORS.warning },
  ];

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Earned in period" value={inr(summary.periodEarned)} tone="positive" icon={TrendingUp} hint={`${number(summary.periodTrips)} commission-bearing trips`} />
        <MiniStat label="Cumulative earned" value={inr(summary.earned)} icon={CircleDollarSign} hint={`On gross hire of ${inr(summary.gross)}`} />
        <MiniStat label="Received" value={inr(summary.received)} tone="positive" icon={Wallet} hint="Explicit commission receipt vouchers" />
        <MiniStat label="Remaining" value={inr(summary.remaining)} tone="warning" icon={Percent} hint="Earned but not yet received" />
      </StatStrip>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Commission Mix" subtitle="Percentage vs fixed, then received vs remaining" icon={Percent} className="xl:col-span-2">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={split} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" {...CHART_AXIS} tickLine={false} axisLine={false} />
                <YAxis {...CHART_AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${(Number(v) / 1000).toFixed(0)}K`} width={48} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value) => [inr(value), 'Amount']}
                  labelStyle={{ color: CHART_COLORS.navy, fontWeight: 700 }}
                />
                <Bar dataKey="value" name="Amount" radius={[6, 6, 0, 0]} maxBarSize={54}>
                  {split.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard title="How It Is Calculated" subtitle="Server-authoritative, stored per hire" icon={CircleDollarSign}>
          <div className="space-y-3 text-[12.5px] leading-relaxed text-bt-ink-2">
            <div className="rounded-xl border border-bt-border p-3.5">
              <p className="font-semibold text-bt-navy">Gross vehicle hire</p>
              <p className="mt-1">The freight agreed with the customer. A payment never overwrites this figure.</p>
            </div>
            <div className="rounded-xl border border-bt-border p-3.5">
              <p className="font-semibold text-bt-navy">− Commission</p>
              <p className="mt-1">{summary.percentage ? inr(summary.percentage) : '₹0'} percentage + {summary.fixed ? inr(summary.fixed) : '₹0'} fixed.</p>
            </div>
            <div className="rounded-xl border border-orange-200 bg-orange-50 p-3.5">
              <p className="font-semibold text-bt-orange-dark">= Net vendor payable</p>
              <p className="mt-1">What the vendor is owed, before advances, fuel credits and settlements.</p>
            </div>
          </div>
        </SectionCard>
      </div>

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title="Commission Earned"
        subtitle="Per trip, from the stored VehicleHire record"
        icon={TrendingUp}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.hire_id}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Trip, customer, vendor…"
              className="w-[220px]"
            />
            <button
              type="button"
              onClick={() => {
                setStatus(status === 'EARNED' ? '' : 'EARNED');
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                status === 'EARNED'
                  ? 'border-bt-orange bg-bt-orange-light text-bt-orange-dark'
                  : 'border-bt-border text-bt-ink-2 hover:border-bt-orange'
              }`}
            >
              Only earning trips
            </button>
          </div>
        }
        columns={[
          {
            key: 'trip_number',
            header: 'Trip',
            render: (r) => (
              <div>
                <div className="font-semibold text-bt-navy">{r.trip_number || r.booking_number || `Hire #${r.hire_id}`}</div>
                <div className="text-[11px] text-bt-ink-3">{day(r.date)} · {r.branch || '—'}</div>
              </div>
            ),
          },
          { key: 'customer_name', header: 'Customer' },
          { key: 'vendor_name', header: 'Vendor' },
          { key: 'vehicle_number', header: 'Vehicle', render: (r) => r.vehicle_number || '—' },
          { key: 'gross_hire', header: 'Gross hire', render: (r) => <Money value={r.gross_hire} /> },
          {
            key: 'rate',
            header: 'Rate',
            render: (r) => (
              <span className="text-[12px] text-bt-ink-2">
                {r.commission_type === 'percentage' ? `${r.commission_rate}%` : inr(r.commission_rate)}
                <span className="ml-1 text-[10.5px] uppercase text-bt-ink-3">{titleCase(r.commission_type)}</span>
              </span>
            ),
          },
          { key: 'commission_amount', header: 'Commission', render: (r) => <Money value={r.commission_amount} tone="warning" /> },
          { key: 'received', header: 'Received', render: (r) => <Money value={r.received} tone="positive" /> },
          { key: 'remaining', header: 'Remaining', render: (r) => <Money value={r.remaining} tone={r.remaining > 0 ? 'negative' : 'muted'} /> },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />
    </div>
  );
}

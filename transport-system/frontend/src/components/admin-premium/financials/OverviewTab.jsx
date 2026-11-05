/**
 * OverviewTab — the financial position at a glance.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  Download,
  Fuel,
  HandCoins,
  Handshake,
  Landmark,
  Layers,
  Package,
  Percent,
  ReceiptText,
  TrendingUp,
  Truck,
  Wallet,
} from 'lucide-react';
import {
  Area,
  Bar,
  ComposedChart,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import KpiCard from '../ui/KpiCard';
import SectionCard from '../ui/SectionCard';
import { Button, CHART_AXIS, CHART_COLORS, CHART_GRID, CHART_TOOLTIP } from '../ui';
import { financeAPI } from '../../../services/api';
import { compactInr, day, inr, methodLabel } from './format';
import { ErrorBlock, MiniStat, Money, TableCard } from './shared';
import { useApiData } from './useApiData';

const deltaSub = (kpi, suffix = 'vs previous period') => {
  if (!kpi) return '';
  if (kpi.changePct === null || kpi.changePct === undefined) {
    return kpi.previous ? `Previous ${inr(kpi.previous)}` : 'No previous-period data';
  }
  return `${kpi.changePct >= 0 ? '+' : ''}${Number(kpi.changePct).toFixed(1)}% ${suffix}`;
};

const typeTone = (label) => {
  const l = String(label || '').toLowerCase();
  if (l.includes('receipt')) return 'text-emerald-600';
  if (l.includes('vendor')) return 'text-amber-600';
  if (l.includes('settlement')) return 'text-blue-600';
  if (l.includes('commission')) return 'text-violet-600';
  if (l.includes('advance')) return 'text-amber-600';
  if (l.includes('fuel')) return 'text-sky-600';
  return 'text-bt-navy';
};

export default function OverviewTab({
  data,
  loading,
  error,
  onRetry,
  onOpenPosting,
  onGoTab,
  onOpenTransaction,
}) {
  const navigate = useNavigate();

  const { data: shipmentData } = useApiData(async () => {
    const res = await financeAPI.getShipmentSummary();
    return res?.data?.data || res?.data || null;
  }, []);

  if (error) return <ErrorBlock message={error} onRetry={onRetry} />;
  if (loading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="bt-card h-[118px] p-5">
              <div className="bt-skeleton h-3 w-24 rounded" />
              <div className="bt-skeleton mt-4 h-7 w-32 rounded" />
              <div className="bt-skeleton mt-3 h-2.5 w-40 rounded" />
            </div>
          ))}
        </div>
        <div className="bt-card h-[340px] p-5">
          <div className="bt-skeleton h-4 w-40 rounded" />
          <div className="bt-skeleton mt-8 h-[240px] w-full rounded-xl" />
        </div>
      </div>
    );
  }

  const k = data.kpis;
  const comparison = data.comparison || {};
  const stats = shipmentData || {};

  const shipment = [
    { label: 'Orders', value: stats.orders || 0, icon: Package, hint: 'Total orders', onClick: () => navigate('/admin/bookings') },
    { label: 'Completed', value: stats.completed || 0, icon: CheckCircle2, hint: 'Completed trips', onClick: () => navigate('/admin/bookings/completed') },
    { label: 'In Transit', value: stats.inTransit || 0, icon: Truck, hint: 'Active transit', onClick: () => navigate('/admin/bookings/in-transit') },
    { label: 'Pending POD', value: stats.pendingPod || 0, icon: FileText, hint: 'Awaiting POD', onClick: () => navigate('/admin/bookings/pod-pending') },
  ];

  const actions = [
    { label: 'Record Receipt', icon: ArrowDownLeft, mode: 'receipt', primary: true },
    { label: 'Pay Vendor', icon: ArrowUpRight, mode: 'vendor-payment', primary: false },
    { label: 'Record Advance', icon: HandCoins, mode: 'advance', primary: false },
    { label: 'Receive Commission', icon: TrendingUp, mode: 'commission-receipt', primary: false },
    { label: 'Post Settlement', icon: Handshake, mode: 'settlement', primary: false },
  ];

  const recentColumns = [
    { key: 'date', header: 'Date', render: (r) => day(r.date) },
    {
      key: 'voucher_number',
      header: 'Voucher',
      render: (r) => (
        <button
          type="button"
          onClick={() => onOpenTransaction?.(r)}
          className="font-mono text-[11.5px] text-bt-orange hover:underline"
        >
          {r.voucher_number}
        </button>
      ),
    },
    { key: 'party_name', header: 'Party', render: (r) => <span className="font-semibold text-bt-navy">{r.party_name}</span> },
    { key: 'trip_number', header: 'Trip', render: (r) => r.trip_number || r.booking_number || '—' },
    { key: 'type_label', header: 'Type', render: (r) => <span className={`text-[11.5px] font-semibold ${typeTone(r.type_label)}`}>{r.type_label}</span> },
    { key: 'debit', header: 'Debit (₹)', render: (r) => (r.debit ? inr(r.debit) : '—') },
    { key: 'credit', header: 'Credit (₹)', render: (r) => (r.credit ? inr(r.credit) : '—') },
    { key: 'status', header: 'Status', render: (r) => r.status || 'Posted' },
  ];

  return (
    <div className="space-y-5">
      {/* ── KPI GRID ─────────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Customer Receivables" value={inr(k.customerReceivables.value)} sub={deltaSub(k.customerReceivables)} accent="orange" icon={ReceiptText} onClick={() => onGoTab('receivables')} />
        <KpiCard title="Received This Period" value={inr(k.totalReceived.value)} sub={`${k.totalReceived.count || 0} cash receipts · ${inr(k.totalReceived.nonCash)} non-cash`} accent="success" icon={Download} onClick={() => onGoTab('payments')} />
        <KpiCard title="Vendor Payables" value={inr(k.vendorPayables.value)} sub={`${k.vendorPayables.pendingCount || 0} vendors · net of advances & fuel`} accent="danger" icon={Truck} onClick={() => onGoTab('payables')} />
        <KpiCard title="Commission Earned" value={inr(k.commissionEarned.value)} sub={`${k.commissionEarned.trips || 0} trips · cumulative ${inr(k.commissionEarned.cumulative)}`} accent="navy" icon={Percent} onClick={() => onGoTab('commission')} />
        <KpiCard title="Net Cash Movement" value={inr(k.netCashMovement.value)} sub={`In ${inr(k.netCashMovement.inflow)} − Out ${inr(k.netCashMovement.outflow)}`} accent={k.netCashMovement.value >= 0 ? 'success' : 'danger'} icon={Wallet} />
        <KpiCard title="Advances Outstanding" value={inr(k.advancesGiven.value)} sub={`Vendor ${inr(k.advancesGiven.vendor)} · Driver ${inr(k.advancesGiven.driver)}`} accent="warning" icon={Layers} onClick={() => onGoTab('advances')} />
        <KpiCard title="Petrol Pump Outstanding" value={inr(k.petrolPumpOutstanding.value)} sub={`${k.petrolPumpOutstanding.pumpsWithDues || 0} pumps with dues`} accent="info" icon={Fuel} onClick={() => onGoTab('petrol-pump')} />
        <KpiCard title="Unbilled Freight" value={inr(k.unbilledFreight.value)} sub={`${k.unbilledFreight.trips || 0} completed trips without an invoice`} accent="warning" icon={CircleDollarSign} onClick={() => onGoTab('receivables')} />
      </div>

      {/* ── CASH FLOW + SHIPMENT SUMMARY ───────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[56%_44%]">
        <SectionCard
          title="Cash Flow"
          subtitle={`${data.period?.label || 'Selected period'} · cash only, settlements excluded`}
          icon={Landmark}
          action={
            <div className="flex items-center gap-4 text-[11px] font-semibold text-bt-ink-2">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Collections</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bt-orange" />Payments</span>
            </div>
          }
        >
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.cashFlow || []} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="finCollections" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={CHART_COLORS.success} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={CHART_COLORS.success} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="label" {...CHART_AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis {...CHART_AXIS} tickLine={false} axisLine={false} tickFormatter={compactInr} width={60} />
                <Tooltip
                  contentStyle={CHART_TOOLTIP}
                  formatter={(value, name) => [inr(value), name]}
                  labelStyle={{ color: CHART_COLORS.navy, fontWeight: 700 }}
                />
                <Bar dataKey="payments" name="Payments" fill={CHART_COLORS.orange} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Area
                  type="monotone"
                  dataKey="collections"
                  name="Collections"
                  stroke={CHART_COLORS.success}
                  strokeWidth={2.2}
                  fill="url(#finCollections)"
                />
                <Line type="monotone" dataKey="net" name="Net" stroke={CHART_COLORS.navy} strokeWidth={1.6} dot={false} />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <MiniStat label="Inflow" value={inr(data.cashFlowTotals?.inflow)} tone="positive" icon={ArrowDownLeft} />
            <MiniStat label="Outflow" value={inr(data.cashFlowTotals?.outflow)} tone="negative" icon={ArrowUpRight} />
            <MiniStat label="Net cash" value={inr(data.cashFlowTotals?.net)} tone={data.cashFlowTotals?.net >= 0 ? 'positive' : 'negative'} icon={Wallet} />
          </div>
        </SectionCard>

        <SectionCard title="Shipment Financial Summary" subtitle="Financial view linked to transport operations" icon={Package}>
          <div className="grid gap-3 sm:grid-cols-2">
            {shipment.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.label}
                  type="button"
                  onClick={s.onClick}
                  className="rounded-xl border border-bt-border bg-slate-50 p-4 text-left transition hover:border-bt-orange hover:bg-white"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-bt-orange-light text-bt-orange-dark">
                      <Icon className="h-4 w-4" strokeWidth={2.2} />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-bt-ink-3">{s.label}</span>
                  </div>
                  <p className="mt-3 text-[24px] font-bold text-bt-navy tabular-nums">{s.value}</p>
                  <p className="mt-1 text-[11.5px] text-bt-ink-2">{s.hint}</p>
                </button>
              );
            })}
          </div>
        </SectionCard>
      </div>

      {/* ── QUICK ACTIONS + RECENT TRANSACTIONS ───────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[38%_62%]">
        <SectionCard title="Quick Actions" subtitle="Frequently used finance operations" icon={ReceiptText}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 xl:grid-cols-2 2xl:grid-cols-5">
            {actions.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.label}
                  type="button"
                  onClick={() => onOpenPosting?.(a.mode)}
                  className={`flex flex-col items-center justify-center gap-2 rounded-xl border px-3 py-4 text-center transition ${
                    a.primary
                      ? 'border-bt-navy bg-bt-navy text-white hover:bg-bt-navy-dark'
                      : 'border-bt-border bg-white text-bt-navy hover:border-bt-orange hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-5 w-5" strokeWidth={2.2} />
                  <span className="text-[11.5px] font-semibold leading-tight">{a.label}</span>
                </button>
              );
            })}
          </div>
        </SectionCard>

        <TableCard
          title="Recent Financial Transactions"
          subtitle="The latest ledger rows across every finance source"
          icon={Landmark}
          action={
            <Button variant="ghost" size="sm" onClick={() => onGoTab('payments')}>
              View All →
            </Button>
          }
          columns={recentColumns}
          rows={data.recentTransactions || []}
          getRowId={(r) => r.key}
          onRowClick={(r) => onOpenTransaction?.(r)}
        />
      </div>
    </div>
  );
}

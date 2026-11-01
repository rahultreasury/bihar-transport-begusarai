/**
 * PetrolPumpTab — the pump finance ledger.
 *
 * Fuel is a CREDIT purchase: it raises the pump liability but moves no cash.
 * Pump payments are cash/bank. An outstanding balance is therefore an
 * obligation, not a cash-flow figure, and the previous-month outstanding is
 * shown separately from the fuel bought inside the selected range.
 */

import React, { useState } from 'react';
import { AlertTriangle, Banknote, Building2, Droplets, FileText, Fuel, Plus, Wallet } from 'lucide-react';

import SectionCard from '../ui/SectionCard';
import { Button } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, methodLabel, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';
import PumpLedgerModal from './PumpLedgerModal';

const SUB_TABS = [
  { key: 'pumps', label: 'Pumps' },
  { key: 'fuel', label: 'Fuel' },
  { key: 'payments', label: 'Payments' },
  { key: 'bills', label: 'Bills' },
];

export default function PetrolPumpTab({ filters, refreshKey, onOpenPosting }) {
  const [sub, setSub] = useState('pumps');
  const [page, setPage] = useState(1);
  const [ledgerPump, setLedgerPump] = useState(null);

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getPetrolPumps({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      page,
      limit: 25,
    });
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, page, refreshKey]);

  const summary = data?.summary || {};
  const pumps = data?.rows || [];

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Outstanding" value={inr(summary.outstanding)} tone="negative" icon={Wallet} hint={`${number(summary.pumpsWithDues)} pumps with dues`} />
        <MiniStat label="Previous outstanding" value={inr(summary.previousOutstanding)} icon={Building2} hint="Before this period's fuel" />
        <MiniStat label="Fuel this period" value={inr(summary.periodFuel)} tone="warning" icon={Droplets} hint={`${number(summary.pumpCount)} active pumps`} />
        <MiniStat label="Unbilled fuel" value={inr(summary.unbilledFuel)} icon={FileText} hint={`Paid ${inr(summary.totalPaid)} against bills`} />
      </StatStrip>

      {error ? <ErrorBlock message={error} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-bt-border bg-white p-1">
          {SUB_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setSub(t.key);
                setPage(1);
              }}
              className={`rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                sub === t.key ? 'bg-bt-orange-light text-bt-orange-dark' : 'text-bt-ink-2 hover:text-bt-navy'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" Icon={Plus} onClick={() => onOpenPosting?.('pump')}>
            Add pump
          </Button>
          <Button variant="secondary" size="sm" Icon={Droplets} onClick={() => onOpenPosting?.('fuel')}>
            Record fuel
          </Button>
          <Button variant="secondary" size="sm" Icon={Banknote} onClick={() => onOpenPosting?.('pump-payment')}>
            Pay pump
          </Button>
          <Button variant="secondary" size="sm" Icon={FileText} onClick={() => onOpenPosting?.('pump-bill')}>
            Create bill
          </Button>
        </div>
      </div>

      {sub === 'pumps' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="bt-card h-[230px] p-5"><div className="bt-skeleton h-4 w-32 rounded" /><div className="bt-skeleton mt-4 h-8 w-24 rounded" /><div className="bt-skeleton mt-6 h-2 w-full rounded" /></div>)
          ) : pumps.length === 0 ? (
            <SectionCard className="md:col-span-2 xl:col-span-3" title="No petrol pumps yet" subtitle="Add the pumps BT buys credit fuel from" icon={Fuel}>
              <p className="py-8 text-center text-[12.5px] text-bt-ink-2">
                A pump starts with its opening balance and credit limit. Fuel and payments then build the ledger.
              </p>
            </SectionCard>
          ) : (
            pumps.map((p) => (
              <SectionCard key={p.pump_id} title={p.pump_name} subtitle={[p.pump_code, p.city, p.owner_name].filter(Boolean).join(' · ') || 'Petrol pump'} icon={Fuel}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-bt-ink-3">Outstanding</p>
                    <p className={`mt-1 text-[24px] font-bold tabular-nums ${p.outstanding > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{inr(p.outstanding)}</p>
                    <p className="mt-1 text-[11.5px] text-bt-ink-2">Previous {inr(p.previous_outstanding)} · this period {inr(p.period_fuel)}</p>
                  </div>
                  <span className={`bt-badge ${p.outstanding > 0 ? 'bt-badge-warning' : 'bt-badge-success'}`}>
                    {p.outstanding > 0 ? `${p.unpaid_bills || 0} unpaid bill${p.unpaid_bills === 1 ? '' : 's'}` : 'Clear'}
                  </span>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-bt-ink-2">
                    <span>Credit utilisation</span>
                    <span className="font-semibold text-bt-navy">{p.utilization === null ? 'No limit set' : `${p.utilization}%`}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${p.utilization !== null && p.utilization > 85 ? 'bg-red-500' : 'bg-bt-orange'}`}
                      style={{ width: `${Math.min(100, Math.max(0, p.utilization || 0))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10.5px] text-bt-ink-3">Limit {inr(p.credit_limit)} · paid {inr(p.total_paid)}</p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Button variant="secondary" size="sm" Icon={Droplets} onClick={() => onOpenPosting?.('fuel', { pump_id: p.pump_id })}>
                    Fuel
                  </Button>
                  <Button variant="secondary" size="sm" Icon={Banknote} onClick={() => onOpenPosting?.('pump-payment', { pump_id: p.pump_id })}>
                    Pay
                  </Button>
                  <Button variant="ghost" size="sm" Icon={FileText} onClick={() => onOpenPosting?.('pump-bill', { pump_id: p.pump_id })}>
                    Bill
                  </Button>
                  <Button variant="ghost" size="sm" Icon={Wallet} onClick={() => setLedgerPump(p.pump_id)}>
                    Ledger
                  </Button>
                </div>
                {p.outstanding > 0 ? (
                  <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Last transaction {p.last_transaction_date ? day(p.last_transaction_date) : 'not recorded'}.
                  </p>
                ) : null}
              </SectionCard>
            ))
          )}
        </div>
      ) : null}

      {sub === 'fuel' ? (
        <TableCard
          title="Fuel Transactions"
          subtitle="Credit fuel from pumps, inside the selected range"
          icon={Droplets}
          loading={loading}
          rows={data?.fuel || []}
          getRowId={(r) => r.transaction_id}
          columns={[
            { key: 'date', header: 'Date', render: (r) => day(r.date) },
            { key: 'pump_name', header: 'Pump', render: (r) => <span className="font-medium text-bt-navy">{r.pump_name}</span> },
            { key: 'trip_number', header: 'Trip', render: (r) => r.trip_number || '—' },
            { key: 'vehicle_number', header: 'Vehicle', render: (r) => r.vehicle_number || '—' },
            { key: 'fuel_type', header: 'Fuel', render: (r) => titleCase(r.fuel_type) },
            { key: 'litres', header: 'Litres', render: (r) => number(r.litres) },
            { key: 'rate_per_litre', header: 'Rate', render: (r) => inr(r.rate_per_litre) },
            { key: 'amount', header: 'Amount', render: (r) => <Money value={r.amount} tone="warning" /> },
            { key: 'receipt_number', header: 'Receipt', render: (r) => <span className="font-mono text-[11px]">{r.receipt_number || '—'}</span> },
            { key: 'status', header: 'Billing', render: (r) => <span className={`bt-badge ${r.is_billed ? 'bt-badge-success' : 'bt-badge-neutral'}`}>{r.is_billed ? 'Billed' : 'Unbilled'}</span> },
          ]}
          footer={<Pager pagination={{ page: 1, pages: 1, total: (data?.counts?.fuel || 0), limit: (data?.fuel || []).length || 1 }} onPage={() => {}} />}
        />
      ) : null}

      {sub === 'payments' ? (
        <TableCard
          title="Pump Payments"
          subtitle="Cash, bank, UPI and cheque paid to pumps"
          icon={Banknote}
          loading={loading}
          rows={data?.payments || []}
          getRowId={(r) => r.payment_id}
          columns={[
            { key: 'date', header: 'Date', render: (r) => day(r.date) },
            { key: 'voucher_number', header: 'Voucher', render: (r) => <span className="font-mono text-[11.5px] font-semibold text-bt-navy">{r.voucher_number}</span> },
            { key: 'pump_name', header: 'Pump' },
            { key: 'bill_id', header: 'Bill', render: (r) => (r.bill_id ? `#${r.bill_id}` : 'On account') },
            { key: 'amount', header: 'Amount', render: (r) => <Money value={r.amount} tone="positive" /> },
            { key: 'payment_mode', header: 'Mode', render: (r) => methodLabel(r.payment_method) },
            { key: 'reference_number', header: 'Reference', render: (r) => <span className="font-mono text-[11px]">{r.reference_number || '—'}</span> },
            { key: 'status', header: 'Status', render: (r) => <span className="bt-badge bt-badge-success">{titleCase(r.status)}</span> },
          ]}
        />
      ) : null}

      {sub === 'bills' ? (
        <TableCard
          title="Pump Bills"
          subtitle="Billed fuel, paid amount and remaining balance"
          icon={FileText}
          loading={loading}
          rows={data?.bills || []}
          getRowId={(r) => r.bill_id}
          columns={[
            { key: 'bill_number', header: 'Bill', render: (r) => <span className="font-mono text-[11.5px] font-semibold text-bt-navy">{r.bill_number}</span> },
            { key: 'pump_name', header: 'Pump' },
            { key: 'bill_date', header: 'Bill date', render: (r) => day(r.bill_date) },
            { key: 'period', header: 'Period', render: (r) => `${day(r.period_start)} – ${day(r.period_end)}` },
            { key: 'bill_amount', header: 'Bill amount', render: (r) => <Money value={r.bill_amount} /> },
            { key: 'paid_amount', header: 'Paid', render: (r) => <Money value={r.paid_amount} tone="positive" /> },
            { key: 'outstanding_amount', header: 'Outstanding', render: (r) => <Money value={r.outstanding_amount} tone={r.outstanding_amount > 0 ? 'negative' : 'muted'} /> },
            { key: 'status', header: 'Status', render: (r) => <span className={`bt-badge ${r.status === 'PAID' ? 'bt-badge-success' : r.status === 'PARTIALLY_PAID' ? 'bt-badge-info' : 'bt-badge-warning'}`}>{titleCase(r.status)}</span> },
          ]}
        />
      ) : null}

      <PumpLedgerModal open={!!ledgerPump} pumpId={ledgerPump} onClose={() => setLedgerPump(null)} />
    </div>
  );
}

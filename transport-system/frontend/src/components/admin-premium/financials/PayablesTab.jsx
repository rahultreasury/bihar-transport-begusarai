/**
 * PayablesTab — Provider Payables.
 *
 * The vendor obligation is computed from the stored VehicleHire record:
 *     gross hire − commission = net vendor payable
 * and then reduced only by actual money/benefit movements (payments, fuel
 * credits, commission received, settlement legs). The gross is never rewritten
 * by a payment, which is what makes a fully paid vendor still auditable.
 */

import React, { useState } from 'react';
import { ArrowUpRight, Banknote, CircleDollarSign, Fuel, Handshake, Truck } from 'lucide-react';

import { Button, FilterSelect, SearchBar } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';
import VendorLedgerModal from './VendorLedgerModal';

export default function PayablesTab({ filters, refreshKey, onPostVendorPayment, onPostSettlement }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [ledgerVendor, setLedgerVendor] = useState(null);

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getPayables({
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

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Payable" value={inr(summary.payable)} tone="negative" icon={Truck} hint={`${number(summary.pending_count)} vendors with a balance`} />
        <MiniStat label="Vendor owes BT" value={inr(summary.receivable)} tone="positive" icon={Banknote} hint="Cleared by a non-cash settlement" />
        <MiniStat label="Net payable" value={inr(summary.net)} icon={CircleDollarSign} hint={`Gross ${inr(summary.gross_hire)} − commission ${inr(summary.commission)}`} />
        <MiniStat label="Fuel credits" value={inr(summary.fuel_credits)} tone="warning" icon={Fuel} hint={`Paid ${inr(summary.paid)} in cash/bank`} />
      </StatStrip>

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title="Provider Payables"
        subtitle="One row per vendor: gross hire, commission and the signed balance"
        icon={Truck}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.vendor_id}
        onRowClick={(r) => setLedgerVendor(r.vendor_id)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Vendor, mobile, vehicle…"
              className="w-[220px]"
            />
            <FilterSelect
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All positions' },
                { value: 'PAYABLE', label: 'Payable' },
                { value: 'RECEIVABLE', label: 'Vendor owes BT' },
                { value: 'SETTLED', label: 'Settled' },
              ]}
            />
            <Button variant="primary" size="sm" Icon={ArrowUpRight} onClick={() => onPostVendorPayment?.()}>
              Pay vendor
            </Button>
          </div>
        }
        columns={[
          {
            key: 'vendor_name',
            header: 'Vendor',
            render: (r) => (
              <div className="min-w-[180px]">
                <div className="font-semibold text-bt-navy">{r.vendor_name}</div>
                <div className="text-[11px] text-bt-ink-3">
                  {[r.mobile, r.city, ...(r.vehicle_numbers || []).slice(0, 2)].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
            ),
          },
          { key: 'hire_count', header: 'Hires', render: (r) => number(r.hire_count) },
          { key: 'gross_hire', header: 'Gross hire', render: (r) => <Money value={r.gross_hire} /> },
          { key: 'commission', header: 'Commission', render: (r) => <Money value={r.commission} tone="warning" /> },
          { key: 'net_payable', header: 'Net payable', render: (r) => <Money value={r.net_payable} /> },
          {
            key: 'paid',
            header: 'Paid / credit',
            render: (r) => (
              <div>
                <Money value={r.paid} tone="positive" />
                {(r.fuel_credits > 0 || r.commission_received > 0) ? (
                  <div className="text-[10.5px] text-bt-ink-3">+ fuel {inr(r.fuel_credits)} · comm {inr(r.commission_received)}</div>
                ) : null}
              </div>
            ),
          },
          {
            key: 'balance',
            header: 'Balance',
            render: (r) => (
              <div>
                <Money value={Math.abs(r.balance)} tone={r.balance > 0 ? 'negative' : r.balance < 0 ? 'positive' : 'muted'} />
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-bt-ink-3">{titleCase(r.direction)}</div>
              </div>
            ),
          },
          { key: 'last_payment_date', header: 'Last paid', render: (r) => (r.last_payment_date ? day(r.last_payment_date) : '—') },
          {
            key: 'actions',
            header: '',
            render: (r) => (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  Icon={Truck}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLedgerVendor(r.vendor_id);
                  }}
                >
                  Ledger
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  Icon={Handshake}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPostSettlement?.({ party_type: 'VENDOR', vendor_id: r.vendor_id });
                  }}
                >
                  Settle
                </Button>
              </div>
            ),
          },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />

      <VendorLedgerModal open={!!ledgerVendor} vendorId={ledgerVendor} onClose={() => setLedgerVendor(null)} />
    </div>
  );
}

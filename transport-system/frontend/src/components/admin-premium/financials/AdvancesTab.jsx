/**
 * AdvancesTab — money paid out before it is earned.
 *
 * An advance is counted ONCE. Creating it moves cash out; adjusting it only
 * records utilisation and reduces the outstanding figure. No second cash row is
 * written by an adjustment, which is what prevents double counting.
 */

import React, { useState } from 'react';
import { Banknote, Car, Fuel, HandCoins, UserRound } from 'lucide-react';

import { Button, FilterSelect, SearchBar } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, methodLabel, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';

const TYPE_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'VENDOR', label: 'Vendor' },
  { value: 'DRIVER', label: 'Driver' },
  { value: 'FUEL', label: 'Fuel' },
];

export default function AdvancesTab({ filters, refreshKey, onPostAdvance, onAdjustAdvance }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getAdvances({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      search: search || undefined,
      type: type || undefined,
      status: status || undefined,
      page,
      limit: 25,
    });
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, search, type, status, page, refreshKey]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Outstanding" value={inr(summary.outstanding)} tone="warning" icon={HandCoins} hint={`${number(summary.outstandingCount)} advances not fully adjusted`} />
        <MiniStat label="Vendor advances" value={inr(summary.vendor)} icon={Car} hint="Recoverable from a hire payment" />
        <MiniStat label="Driver advances" value={inr(summary.driver)} icon={UserRound} hint="Recoverable from a settlement" />
        <MiniStat label="Fuel advances" value={inr(summary.fuel)} icon={Fuel} hint={`Total advanced ${inr(summary.total)}`} />
      </StatStrip>

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title="Advances"
        subtitle="Cash already paid out, with its unadjusted balance"
        icon={HandCoins}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.advance_id}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Voucher, party, trip…"
              className="w-[220px]"
            />
            <FilterSelect
              value={type}
              onChange={(v) => {
                setType(v);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
            />
            <FilterSelect
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'OUTSTANDING', label: 'Outstanding only' },
              ]}
            />
            <Button variant="primary" size="sm" Icon={HandCoins} onClick={() => onPostAdvance?.()}>
              New advance
            </Button>
          </div>
        }
        columns={[
          {
            key: 'voucher_number',
            header: 'Voucher',
            render: (r) => (
              <div>
                <div className="font-mono text-[11.5px] font-semibold text-bt-navy">{r.voucher_number}</div>
                <div className="text-[11px] text-bt-ink-3">{day(r.date)}</div>
              </div>
            ),
          },
          {
            key: 'party_name',
            header: 'Party',
            render: (r) => (
              <div>
                <div className="font-medium text-bt-navy">{r.party_name}</div>
                <div className="text-[11px] text-bt-ink-3">{r.trip_number || r.booking_number || r.vehicle_number || '—'}</div>
              </div>
            ),
          },
          {
            key: 'category',
            header: 'Category',
            render: (r) => (
              <span className={`bt-badge ${r.category === 'VENDOR' ? 'bt-badge-navy' : r.category === 'DRIVER' ? 'bt-badge-info' : 'bt-badge-warning'}`}>
                {titleCase(r.category)}
              </span>
            ),
          },
          { key: 'amount', header: 'Advanced', render: (r) => <Money value={r.amount} /> },
          { key: 'adjusted_amount', header: 'Adjusted', render: (r) => <Money value={r.adjusted_amount} tone="positive" /> },
          { key: 'outstanding', header: 'Outstanding', render: (r) => <Money value={r.outstanding} tone={r.outstanding > 0 ? 'warning' : 'muted'} /> },
          { key: 'payment_mode', header: 'Mode', render: (r) => methodLabel(r.payment_method) },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span className={`bt-badge ${r.outstanding <= 0 ? 'bt-badge-success' : r.adjusted_amount > 0 ? 'bt-badge-info' : 'bt-badge-warning'}`}>
                {titleCase(r.status)}
              </span>
            ),
          },
          {
            key: 'actions',
            header: '',
            render: (r) => (
              <Button
                variant="ghost"
                size="sm"
                Icon={Banknote}
                disabled={r.outstanding <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onAdjustAdvance?.(r);
                }}
              >
                Adjust
              </Button>
            ),
          },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />
    </div>
  );
}

/**
 * SettlementsTab — balances cleared without moving cash.
 *
 * A vendor settlement writes TWO ADJUSTMENT legs that cancel: one against the
 * trip payable, one against the previous vendor balance. A customer settlement
 * is a CUSTOMER_PAYMENT with method SETTLEMENT allocated to the invoice. Both
 * are non-cash, so neither appears in the cash-flow chart.
 */

import React, { useState } from 'react';
import { ArrowLeftRight, Building2, Handshake, Info, Users } from 'lucide-react';

import { Button, FilterSelect, SearchBar } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Note, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';

export default function SettlementsTab({ filters, refreshKey, onPostSettlement }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getSettlements({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      search: search || undefined,
      type: type || undefined,
      page,
      limit: 25,
    });
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, search, type, page, refreshKey]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const tripRows = data?.tripSettlements || [];

  return (
    <div className="space-y-4">
      <Note tone="info">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Info className="h-3.5 w-3.5" /> Settlements are non-cash.</span>{' '}
        They reclassify a balance — a payable against a vendor receivable, or an invoice against a customer credit — without money leaving or entering the till.
        That is why the cash impact below is always ₹0.
      </Note>

      <StatStrip>
        <MiniStat label="Settlements posted" value={number(summary.count)} icon={Handshake} hint="Vendor + customer, inside the range" />
        <MiniStat label="Vendor settlements" value={inr(summary.vendor)} icon={Building2} hint="Two offsetting adjustment legs" />
        <MiniStat label="Customer settlements" value={inr(summary.customer)} icon={Users} hint="Allocated against invoices" />
        <MiniStat label="Cash impact" value={inr(summary.cashImpact)} icon={ArrowLeftRight} hint="Always zero by design" />
      </StatStrip>

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title="Settlement Register"
        subtitle="Vendor legs are grouped by settlement voucher"
        icon={Handshake}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.settlement_id}
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
              options={[
                { value: '', label: 'All parties' },
                { value: 'VENDOR', label: 'Vendor' },
                { value: 'CUSTOMER', label: 'Customer' },
              ]}
            />
            <Button variant="primary" size="sm" Icon={Handshake} onClick={() => onPostSettlement?.()}>
              New settlement
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
                <div className="font-medium text-bt-navy">{r.party_name || '—'}</div>
                <div className="text-[11px] text-bt-ink-3">{r.trip_number || r.booking_number || '—'}</div>
              </div>
            ),
          },
          {
            key: 'party_type',
            header: 'Type',
            render: (r) => <span className={`bt-badge ${r.party_type === 'VENDOR' ? 'bt-badge-navy' : 'bt-badge-info'}`}>{titleCase(r.party_type)}</span>,
          },
          { key: 'debit', header: 'Debit leg', render: (r) => (r.debit ? <Money value={r.debit} /> : '—') },
          { key: 'credit', header: 'Credit leg', render: (r) => (r.credit ? <Money value={r.credit} tone="positive" /> : '—') },
          { key: 'amount', header: 'Settled', render: (r) => <Money value={r.amount} tone="warning" /> },
          { key: 'reference', header: 'Reference', render: (r) => <span className="font-mono text-[11px] text-bt-ink-2">{r.reference || '—'}</span> },
          { key: 'status', header: 'Status', render: (r) => <span className="bt-badge bt-badge-success">{titleCase(r.status)}</span> },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />

      {tripRows.length ? (
        <TableCard
          title="Trip Settlements Marked Non-Cash"
          subtitle="Existing driver/owner settlement records whose method is SETTLEMENT"
          icon={Users}
          rows={tripRows}
          getRowId={(r) => r.settlement_id}
          columns={[
            { key: 'settlement_id', header: 'Settlement', render: (r) => `#${r.settlement_id}` },
            { key: 'date', header: 'Date', render: (r) => day(r.date) },
            { key: 'trip_number', header: 'Trip', render: (r) => r.trip_number || r.booking_number || '—' },
            { key: 'branch', header: 'Branch', render: (r) => r.branch || '—' },
            { key: 'driver_amount', header: 'Driver', render: (r) => <Money value={r.driver_amount} /> },
            { key: 'owner_amount', header: 'Owner', render: (r) => <Money value={r.owner_amount} /> },
            { key: 'payment_method', header: 'Method', render: (r) => titleCase(r.payment_method) },
          ]}
        />
      ) : null}
    </div>
  );
}

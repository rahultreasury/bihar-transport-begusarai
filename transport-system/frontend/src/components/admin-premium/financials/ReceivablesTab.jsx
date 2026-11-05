/**
 * ReceivablesTab — Client Receivables and Client Due.
 *
 * Both tabs read the SAME invoice-level aggregation; "Client Due" simply keeps
 * only invoices with money still outstanding and adds an aging breakdown. That
 * is deliberate: a customer who does not appear on Due must not be outstanding
 * on Receivables either.
 */

import React, { useState } from 'react';
import { AlertTriangle, ArrowDownLeft, CircleDollarSign, Clock, ReceiptText } from 'lucide-react';

import SectionCard from '../ui/SectionCard';
import { Button, FilterSelect, SearchBar } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'DUE', label: 'Due' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'PARTIALLY_PAID', label: 'Partially paid' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PAID', label: 'Paid' },
];

const AGING = [
  { key: 'current', label: 'Current', tone: 'bg-emerald-500' },
  { key: 'days1to30', label: '1–30 days', tone: 'bg-amber-400' },
  { key: 'days31to60', label: '31–60 days', tone: 'bg-amber-500' },
  { key: 'days61to90', label: '61–90 days', tone: 'bg-orange-500' },
  { key: 'days90plus', label: '90+ days', tone: 'bg-red-500' },
  { key: 'noDueDate', label: 'No due date', tone: 'bg-slate-400' },
];

export default function ReceivablesTab({ mode = 'receivables', filters, refreshKey, onPostReceipt }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(mode === 'due' ? 'DUE' : '');

  const isDue = mode === 'due';

  const { data, loading, error } = useApiData(async () => {
    const params = {
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      search: search || undefined,
      status: status || (isDue ? 'DUE' : undefined),
      page,
      limit: 25,
    };
    const res = isDue ? await financeAPI.getClientDue(params) : await financeAPI.getReceivables(params);
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, search, status, page, refreshKey, isDue]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];
  const aging = summary.aging || {};

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Outstanding" value={inr(summary.outstanding)} tone="negative" icon={CircleDollarSign} hint={`${number(summary.count ?? summary.openCount)} open invoices`} />
        <MiniStat label="Billed" value={inr(summary.billed)} icon={ReceiptText} hint={`${number(summary.invoiceCount)} invoices up to the end date`} />
        <MiniStat label="Received" value={inr(summary.received)} tone="positive" icon={ArrowDownLeft} hint="Allocated receipts, advances excluded" />
        <MiniStat label="Overdue" value={inr(summary.overdue)} tone="warning" icon={AlertTriangle} hint="Past the invoice due date" />
      </StatStrip>

      {isDue ? (
        <SectionCard
          title="Aging Of Dues"
          subtitle="How long the outstanding money has been waiting"
          icon={Clock}
        >
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
            {AGING.map((bucket) => {
              const pct = summary.outstanding > 0 ? (Number(aging[bucket.key] || 0) / Number(summary.outstanding)) * 100 : 0;
              return pct > 0 ? (
                <div key={bucket.key} className={`${bucket.tone} h-full`} style={{ width: `${pct}%` }} title={`${bucket.label}: ${inr(aging[bucket.key])}`} />
              ) : null;
            })}
          </div>
          <div className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-6">
            {AGING.map((bucket) => (
              <div key={bucket.key} className="rounded-lg border border-bt-border p-3">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${bucket.tone}`} />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[0.05em] text-bt-ink-3">{bucket.label}</span>
                </div>
                <div className="mt-1.5 text-[14px] font-bold text-bt-navy tabular-nums">{inr(aging[bucket.key])}</div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title={isDue ? 'Client Due' : 'Client Receivables'}
        subtitle={isDue ? 'Invoices with money still owed, oldest first' : 'Every invoice up to the selected end date'}
        icon={ReceiptText}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.invoice_id}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Invoice, customer, trip…"
              className="w-[220px]"
            />
            <FilterSelect
              value={status}
              onChange={(v) => {
                setStatus(v);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
            />
            <Button variant="primary" size="sm" Icon={ArrowDownLeft} onClick={() => onPostReceipt?.()}>
              Record receipt
            </Button>
          </div>
        }
        columns={[
          {
            key: 'invoice_number',
            header: 'Invoice',
            render: (r) => (
              <div>
                <div className="font-semibold text-bt-navy">{r.invoice_number}</div>
                <div className="text-[11px] text-bt-ink-3">{r.booking_number || r.trip_number || '—'}</div>
              </div>
            ),
          },
          { key: 'invoice_date', header: 'Date', render: (r) => day(r.invoice_date) },
          {
            key: 'customer_name',
            header: 'Customer',
            render: (r) => (
              <div>
                <div className="font-medium text-bt-navy">{r.customer_name}</div>
                <div className="text-[11px] text-bt-ink-3">{r.customer_phone || r.branch || '—'}</div>
              </div>
            ),
          },
          { key: 'total_amount', header: 'Invoice total', render: (r) => <Money value={r.total_amount} /> },
          { key: 'received', header: 'Received', render: (r) => <Money value={r.received} tone="positive" /> },
          { key: 'outstanding', header: 'Outstanding', render: (r) => <Money value={r.outstanding} tone={r.outstanding > 0 ? 'negative' : 'muted'} /> },
          {
            key: 'due',
            header: 'Due',
            render: (r) =>
              r.overdue_days > 0 ? (
                <span className="bt-badge bt-badge-danger">{r.overdue_days} days overdue</span>
              ) : (
                <span className="text-[11.5px] text-bt-ink-2">{r.due_date ? day(r.due_date) : 'No due date'}</span>
              ),
          },
          {
            key: 'status',
            header: 'Status',
            render: (r) => (
              <span className={`bt-badge ${r.status === 'PAID' ? 'bt-badge-success' : r.status === 'PARTIALLY_PAID' ? 'bt-badge-info' : r.status === 'OVERDUE' ? 'bt-badge-danger' : 'bt-badge-warning'}`}>
                {titleCase(r.status)}
              </span>
            ),
          },
          {
            key: 'action',
            header: '',
            render: (r) => (
              <Button
                variant="ghost"
                size="sm"
                Icon={ArrowDownLeft}
                disabled={r.outstanding <= 0}
                onClick={(e) => {
                  e.stopPropagation();
                  onPostReceipt?.(r);
                }}
              >
                Receive
              </Button>
            ),
          },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />

      {data?.unbilled?.length ? (
        <TableCard
          title="Unbilled Freight"
          subtitle={`${number(data.unbilledSummary?.count)} completed trips · ${inr(data.unbilledSummary?.value)} not yet invoiced`}
          icon={CircleDollarSign}
          rows={data.unbilled}
          getRowId={(r) => r.trip_id}
          columns={[
            { key: 'trip_number', header: 'Trip', render: (r) => <span className="font-semibold text-bt-navy">{r.trip_number}</span> },
            { key: 'booking_number', header: 'Booking', render: (r) => r.booking_number || '—' },
            { key: 'customer_name', header: 'Customer' },
            { key: 'branch', header: 'Branch', render: (r) => r.branch || '—' },
            { key: 'trip_date', header: 'Trip date', render: (r) => day(r.trip_date) },
            { key: 'freight_amount', header: 'Freight', render: (r) => <Money value={r.freight_amount} tone="warning" /> },
          ]}
        />
      ) : null}
    </div>
  );
}

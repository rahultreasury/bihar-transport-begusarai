/**
 * PaymentsTab — Payments Received.
 *
 * Only real customer receipts are listed. A customer advance is deliberately
 * excluded here until it is adjusted against an invoice; otherwise the same
 * money would appear once as an advance and again as a receipt.
 */

import React, { useState } from 'react';
import { ArrowDownLeft, Banknote, Landmark, ReceiptText, Smartphone } from 'lucide-react';

import { Button, FilterSelect, SearchBar } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, methodLabel, number, titleCase, unwrap } from './format';
import { ErrorBlock, MiniStat, Money, Pager, StatStrip, TableCard } from './shared';
import { useApiData } from './useApiData';

export default function PaymentsTab({ filters, refreshKey, onPostReceipt }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState('');

  const { data, loading, error } = useApiData(async () => {
    const res = await financeAPI.getPaymentsReceived({
      date_from: filters.from,
      date_to: filters.to,
      branch: filters.branch || undefined,
      search: search || undefined,
      mode: mode || undefined,
      page,
      limit: 25,
    });
    return unwrap(res);
  }, [filters.from, filters.to, filters.branch, search, mode, page, refreshKey]);

  const summary = data?.summary || {};
  const rows = data?.rows || [];

  return (
    <div className="space-y-4">
      <StatStrip>
        <MiniStat label="Total received" value={inr(summary.total)} tone="positive" icon={ArrowDownLeft} hint={`${number(summary.count)} receipts in range`} />
        <MiniStat label="Cash" value={inr(summary.cash)} icon={Banknote} hint={`${number(summary.cashCount)} cash receipts`} />
        <MiniStat label="Bank / UPI / cheque" value={inr(summary.total - summary.cash)} icon={Landmark} hint="Still real money, just not cash" />
        <MiniStat label="Non-cash" value={inr(summary.nonCash)} icon={ReceiptText} hint="Settlements, excluded from cash flow" />
      </StatStrip>

      {error ? <ErrorBlock message={error} /> : null}

      <TableCard
        title="Payments Received"
        subtitle="Customer money actually received inside the selected range"
        icon={ReceiptText}
        loading={loading}
        rows={rows}
        getRowId={(r) => r.transaction_id}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Receipt, customer, invoice…"
              className="w-[220px]"
            />
            <FilterSelect
              value={mode}
              onChange={(v) => {
                setMode(v);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All modes' },
                { value: 'CASH', label: 'Cash' },
                { value: 'BANK', label: 'Bank' },
                { value: 'UPI', label: 'UPI' },
                { value: 'CHEQUE', label: 'Cheque' },
                { value: 'SETTLEMENT', label: 'Settlement' },
              ]}
            />
            <Button variant="primary" size="sm" Icon={ArrowDownLeft} onClick={() => onPostReceipt?.()}>
              Record receipt
            </Button>
          </div>
        }
        columns={[
          {
            key: 'receipt_number',
            header: 'Receipt',
            render: (r) => (
              <div>
                <div className="font-mono text-[11.5px] font-semibold text-bt-navy">{r.receipt_number}</div>
                <div className="text-[11px] text-bt-ink-3">{day(r.date)}</div>
              </div>
            ),
          },
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
          { key: 'trip_number', header: 'Trip', render: (r) => r.trip_number || r.booking_number || '—' },
          { key: 'invoice_number', header: 'Invoice', render: (r) => r.invoice_number || '—' },
          { key: 'amount', header: 'Amount', render: (r) => <Money value={r.amount} tone="positive" /> },
          {
            key: 'payment_mode',
            header: 'Mode',
            render: (r) => (
              <span className="flex items-center gap-1.5 text-[12px] text-bt-ink-2">
                {String(r.payment_method || '').toUpperCase() === 'CASH' ? <Banknote className="h-3.5 w-3.5" /> : String(r.payment_method || '').toUpperCase() === 'UPI' ? <Smartphone className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />}
                {methodLabel(r.payment_method)}
              </span>
            ),
          },
          { key: 'reference_number', header: 'Reference', render: (r) => <span className="font-mono text-[11px] text-bt-ink-2">{r.reference_number || '—'}</span> },
          { key: 'status', header: 'Status', render: (r) => <span className={`bt-badge ${r.cash ? 'bt-badge-success' : 'bt-badge-info'}`}>{titleCase(r.status)}</span> },
        ]}
        footer={<Pager pagination={data?.pagination} onPage={setPage} />}
      />
    </div>
  );
}

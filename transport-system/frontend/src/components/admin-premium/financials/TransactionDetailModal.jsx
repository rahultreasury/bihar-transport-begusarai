/**
 * TransactionDetailModal — one voucher, every field, plus its correction path.
 */

import React from 'react';
import { Landmark, RotateCcw } from 'lucide-react';

import { AdminModal, Button, DetailRow, StatusBadge } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, methodLabel, titleCase, unwrap } from './format';
import { useApiData } from './useApiData';

export default function TransactionDetailModal({ open, transaction, onClose, onReverse }) {
  const kind = transaction?.kind || 'TRANSACTION';
  const id = transaction?.id;

  const { data, loading } = useApiData(async () => {
    if (!open || !id) return null;
    const res = await financeAPI.getTransactionDetail(id, kind);
    return unwrap(res);
  }, [open, id, kind]);

  const tx = data || transaction || {};
  const meta = tx.metadata_parsed || {};

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={`Voucher ${tx.voucher_number || `TX-${id}`}`}
      description={tx.type_label || tx.transaction_type || kind}
      icon={Landmark}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-bt-ink-3">Original rows are immutable. A reversal creates a new row.</p>
          <Button
            variant="danger"
            Icon={RotateCcw}
            disabled={!tx.transaction_id || kind !== 'TRANSACTION'}
            onClick={() => onReverse?.(tx)}
          >
            Reverse
          </Button>
        </div>
      }
    >
      <div className="space-y-1 p-6">
        {loading ? <div className="bt-skeleton h-32 rounded-xl" /> : null}
        <DetailRow label="Date" value={day(tx.transaction_date || tx.date)} />
        <DetailRow label="Amount" value={inr(tx.amount)} />
        <DetailRow label="Direction" value={titleCase(tx.direction)} />
        <DetailRow label="Mode" value={methodLabel(tx.payment_method)} />
        <DetailRow label="Reference" value={tx.reference_number || '—'} />
        <DetailRow label="Party" value={tx.vendor?.company_name || tx.vendor?.owner_name || tx.client?.company_name || tx.party_name || '—'} />
        <DetailRow label="Trip" value={tx.trip?.trip_number || tx.trip_number || '—'} />
        <DetailRow label="Invoice" value={tx.invoices?.invoice_number || tx.invoice_number || '—'} />
        <DetailRow label="Status" value={<StatusBadge status={tx.status || 'PAID'} />} />
        <DetailRow label="Notes" value={tx.notes || tx.purpose || '—'} />
        {Object.keys(meta).length ? (
          <div className="mt-4 rounded-xl border border-bt-border bg-slate-50 p-3.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-bt-ink-3">Posting metadata</p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-bt-ink-2">
              {JSON.stringify(meta, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </AdminModal>
  );
}

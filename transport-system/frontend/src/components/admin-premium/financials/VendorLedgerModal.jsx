/**
 * VendorLedgerModal — the arithmetic behind a vendor balance.
 *
 * The running balance starts at the party's opening balance and then applies
 * each hire (credit) and each payment / fuel credit / settlement (debit). It is
 * intentionally a signed ledger: a negative balance means the vendor owes BT.
 */

import React from 'react';
import { Truck } from 'lucide-react';

import { AdminModal, StatusBadge } from '../ui';
import PremiumTable from '../ui/PremiumTable';
import { financeAPI } from '../../../services/api';
import { day, inr, titleCase, unwrap } from './format';
import { useApiData } from './useApiData';
import { MiniStat } from './shared';

export default function VendorLedgerModal({ open, vendorId, onClose }) {
  const { data, loading } = useApiData(async () => {
    if (!vendorId) return null;
    const res = await financeAPI.getVendorLedger(vendorId);
    return unwrap(res);
  }, [vendorId, open]);

  const vendor = data?.vendor;
  const summary = data?.summary || {};
  const entries = data?.entries || [];

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={vendor?.vendor_name || 'Vendor ledger'}
      description={vendor ? [vendor.company_name !== vendor.vendor_name ? vendor.company_name : null, vendor.mobile, vendor.city].filter(Boolean).join(' · ') : 'Loading the party ledger…'}
      icon={Truck}
      size="xl"
    >
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MiniStat label="Gross hire" value={inr(summary.gross_hire)} hint="Never overwritten by a payment" />
          <MiniStat label="Commission" value={inr(summary.commission)} hint="Gross − commission = net payable" />
          <MiniStat label="Paid" value={inr(summary.paid)} tone="positive" hint={`Fuel credits ${inr(summary.fuel_credits)}`} />
          <MiniStat
            label={summary.direction === 'RECEIVABLE' ? 'Vendor owes BT' : 'Balance payable'}
            value={inr(Math.abs(summary.balance || 0))}
            tone={summary.balance > 0 ? 'negative' : summary.balance < 0 ? 'positive' : 'default'}
            hint={summary.direction ? titleCase(summary.direction) : undefined}
          />
        </div>

        <div className="rounded-xl border border-bt-border">
          <PremiumTable
            loading={loading}
            rows={entries}
            getRowId={(r) => `${r.kind}-${r.transaction_id || r.reference}-${r.date}`}
            columns={[
              { key: 'date', header: 'Date', render: (r) => day(r.date) },
              {
                key: 'label',
                header: 'Particular',
                render: (r) => (
                  <div>
                    <div className="font-medium text-bt-navy">{r.label}</div>
                    <div className="text-[11px] text-bt-ink-3">{r.reference || '—'}</div>
                  </div>
                ),
              },
              { key: 'kind', header: 'Kind', render: (r) => <StatusBadge status={r.kind} label={titleCase(r.kind)} /> },
              { key: 'debit', header: 'Debit', render: (r) => (r.debit ? <span className="font-semibold text-red-600 tabular-nums">{inr(r.debit)}</span> : '—') },
              { key: 'credit', header: 'Credit', render: (r) => (r.credit ? <span className="font-semibold text-emerald-600 tabular-nums">{inr(r.credit)}</span> : '—') },
              { key: 'balance', header: 'Running balance', render: (r) => <span className={`font-semibold tabular-nums ${r.balance > 0 ? 'text-red-600' : r.balance < 0 ? 'text-emerald-600' : 'text-bt-ink-3'}`}>{inr(r.balance)}</span> },
            ]}
          />
        </div>
        <p className="text-[11.5px] leading-relaxed text-bt-ink-2">
          A positive running balance is money Bihar Transport still owes the vendor. A negative balance is money the vendor owes Bihar Transport — the
          case a vendor settlement clears without any cash movement.
        </p>
      </div>
    </AdminModal>
  );
}

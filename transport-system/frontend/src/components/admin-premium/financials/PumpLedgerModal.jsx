/**
 * PumpLedgerModal — fuel in, payments out, one running balance.
 */

import React from 'react';
import { Fuel } from 'lucide-react';

import { AdminModal } from '../ui';
import PremiumTable from '../ui/PremiumTable';
import { financeAPI } from '../../../services/api';
import { day, inr, unwrap } from './format';
import { useApiData } from './useApiData';
import { MiniStat } from './shared';

export default function PumpLedgerModal({ open, pumpId, onClose }) {
  const { data, loading } = useApiData(async () => {
    if (!pumpId) return null;
    const res = await financeAPI.getPumpLedger(pumpId);
    return unwrap(res);
  }, [pumpId, open]);

  const pump = data?.pump;
  const summary = data?.summary || {};

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={pump?.pump_name || 'Petrol pump ledger'}
      description={pump ? [pump.pump_code, pump.city, pump.contact_number].filter(Boolean).join(' · ') : 'Loading the pump ledger…'}
      icon={Fuel}
      size="xl"
    >
      <div className="space-y-4 p-6">
        <div className="grid gap-3 sm:grid-cols-3">
          <MiniStat label="Opening balance" value={inr(summary.opening)} />
          <MiniStat label="Outstanding" value={inr(summary.outstanding)} tone="negative" />
          <MiniStat label="Ledger rows" value={summary.entries ?? 0} />
        </div>
        <div className="rounded-xl border border-bt-border">
          <PremiumTable
            loading={loading}
            rows={data?.entries || []}
            getRowId={(r) => `${r.kind}-${r.reference}-${r.date}`}
            columns={[
              { key: 'date', header: 'Date', render: (r) => day(r.date) },
              {
                key: 'label',
                header: 'Particular',
                render: (r) => (
                  <div>
                    <div className="font-medium text-bt-navy">{r.label}</div>
                    <div className="text-[11px] text-bt-ink-3">{r.reference || '—'}{r.trip_number ? ` · ${r.trip_number}` : ''}</div>
                  </div>
                ),
              },
              { key: 'debit', header: 'Fuel (debit)', render: (r) => (r.debit ? <span className="font-semibold text-red-600 tabular-nums">{inr(r.debit)}</span> : '—') },
              { key: 'credit', header: 'Payment (credit)', render: (r) => (r.credit ? <span className="font-semibold text-emerald-600 tabular-nums">{inr(r.credit)}</span> : '—') },
              { key: 'balance', header: 'Running balance', render: (r) => <span className={`font-semibold tabular-nums ${r.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{inr(r.balance)}</span> },
            ]}
          />
        </div>
        <p className="text-[11.5px] leading-relaxed text-bt-ink-2">
          Credit fuel increases what BT owes the pump. A pump payment reduces it. Neither is duplicated: the fuel row lives only in the pump ledger; if the
          fuel was supplied on behalf of a vendor, one separate vendor-benefit adjustment records the recovery.
        </p>
      </div>
    </AdminModal>
  );
}

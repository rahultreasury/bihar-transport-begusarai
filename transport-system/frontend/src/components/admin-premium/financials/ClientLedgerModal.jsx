import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { financialAPI } from '../../../services/api';
import { LoadingSkeleton } from '../ui/LoadingSkeleton';
import EmptyState from '../ui/EmptyState';
import PremiumTable from '../ui/PremiumTable';

const inr = (n) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(n) || 0);

const day = (v) => (v ? new Date(v).toLocaleDateString('en-IN') : '—');

function Stat({ label, value, tone = '' }) {
  return (
    <div>
      <div className="text-sm text-gray-500">{label}</div>
      <div className={`text-xl font-bold ${tone}`}>{value}</div>
    </div>
  );
}

export default function ClientLedgerModal({
  isOpen,
  onClose,
  clientId,
  partyType = 'CLIENT',
}) {
  const [ledger, setLedger] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const fetchLedger = React.useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    setLedger(null);
    try {
      let res;
      if (partyType === 'CLIENT') {
        res = await financialAPI.getClientLedger(clientId);
      } else if (partyType === 'VEHICLE_OWNER') {
        res = await financialAPI.getVendorLedger(clientId);
      } else {
        throw new Error('Unsupported party type');
      }
      setLedger(res?.data?.data || null);
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to load ledger');
    } finally {
      setLoading(false);
    }
  }, [clientId, partyType]);

  useEffect(() => {
    if (isOpen) {
      fetchLedger();
    }
  }, [isOpen, fetchLedger]);

  if (!isOpen) return null;

  const isClient = partyType === 'CLIENT';
  const totals = ledger?.totals || {};

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ledger-title"
    >
      <div
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between sticky top-0 bg-white dark:bg-gray-800 z-10">
          <h3 id="ledger-title" className="text-lg font-semibold">
            {isClient ? 'Customer Ledger' : 'Vendor Ledger'}
            {ledger?.party?.name && (
              <span className="ml-2 text-gray-500 text-base font-normal">
                {isClient ? ` · Customer #${ledger.party.client_id}` : ` · Owner #${ledger.party.owner_id}`}
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Close ledger"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading && (
            <div className="space-y-4" role="status" aria-label="Loading ledger">
              <LoadingSkeleton className="h-12" />
              <LoadingSkeleton className="h-12" />
              <LoadingSkeleton className="h-12" />
            </div>
          )}

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 p-4">
              <div className="flex items-center justify-between">
                <p className="text-red-700 dark:text-red-300">{error}</p>
                <button
                  type="button"
                  onClick={fetchLedger}
                  className="px-3 py-1.5 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {ledger && !loading && !error && (
            <>
              {/* Party Info */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div>
                    <h4 className="text-base font-semibold">{ledger.party?.name || '—'}</h4>
                    <div className="text-sm text-gray-500 flex flex-wrap gap-4 mt-1">
                      {ledger.party?.contact_person && (
                        <span>Contact: {ledger.party.contact_person}</span>
                      )}
                      {ledger.party?.mobile && (
                        <span>Phone: {ledger.party.mobile}</span>
                      )}
                      {ledger.party?.email && (
                        <span>Email: {ledger.party.email}</span>
                      )}
                      {ledger.party?.address && (
                        <span className="w-full">Address: {ledger.party.address}</span>
                      )}
                      {ledger.party?.gst_number && (
                        <span className="w-full">GST: {ledger.party.gst_number}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Summary Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                  {isClient ? (
                    <>
                      <Stat label="Billed" value={inr(totals.billed)} />
                      <Stat label="Received" value={inr(totals.received)} tone="text-green-600" />
                      <Stat label="Outstanding" value={inr(totals.currentReceivable)} tone="text-red-600" />
                      <Stat label="Trips" value={totals.tripCount ?? 0} />
                    </>
                  ) : (
                    <>
                      <Stat label="Gross Hire" value={inr(totals.gross_hire)} />
                      <Stat label="Commission" value={inr(totals.commission)} tone="text-amber-600" />
                      <Stat label="Net Payable" value={inr(totals.net_vendor_payable)} tone="text-red-600" />
                      <Stat label="Paid" value={inr(totals.paid)} tone="text-green-600" />
                    </>
                  )}
                </div>
              </div>

              {/* Trips Table */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold">Trips contributing to this balance</h4>
                </div>
                <PremiumTable
                  columns={
                    isClient
                      ? [
                          { key: 'trip_number', label: 'Trip' },
                          { key: 'vehicle_number', label: 'Vehicle' },
                          { key: 'billed', label: 'Billed', format: inr },
                          { key: 'received', label: 'Received', format: inr },
                          { key: 'due', label: 'Remaining', format: inr, highlight: true },
                          { key: 'status', label: 'Status' },
                        ]
                      : [
                          { key: 'trip_number', label: 'Trip' },
                          { key: 'vehicle_number', label: 'Vehicle' },
                          { key: 'gross_hire', label: 'Gross Hire', format: inr },
                          { key: 'commission', label: 'Commission', format: inr },
                          { key: 'net_payable', label: 'Net Payable', format: inr },
                          { key: 'paid', label: 'Paid', format: inr },
                          { key: 'balance', label: 'Remaining', format: inr, highlight: true },
                        ]
                  }
                  rows={ledger.trips || []}
                  onRowClick={(row) => row.trip_id && window.open(`/admin/trips/${row.trip_id}`, '_blank')}
                />
              </div>

              {/* Transaction History */}
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                  <h4 className="text-sm font-semibold mb-2">Transaction history</h4>
                  <p className="text-[12px] text-gray-500">
                    Running balance — each hire increases what is owed, each payment reduces it.
                  </p>
                </div>
                <PremiumTable
                  columns={[
                    { key: 'date', label: 'Date', format: day },
                    { key: 'particulars', label: 'Particular' },
                    { key: 'trip_number', label: 'Trip' },
                    {
                      key: 'debit',
                      label: 'Debit',
                      format: (v) => (v ? inr(v) : '—'),
                    },
                    {
                      key: 'credit',
                      label: 'Credit',
                      format: (v) => (v ? inr(v) : '—'),
                    },
                    { key: 'balance', label: 'Balance', format: inr, highlight: true },
                  ]}
                  rows={ledger.ledger || []}
                />
              </div>
            </>
          )}

          {!loading && !error && !ledger && (
            <EmptyState
              title="No ledger data"
              subtitle="This customer has no financial records yet."
            />
          )}
        </div>
      </div>
    </div>
  );
}
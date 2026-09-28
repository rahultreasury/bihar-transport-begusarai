import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  DollarSign,
  Download,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  TrendingUp,
  WalletCards,
} from 'lucide-react';
import { partnerAPI } from '../services/api';
import PartnerShell from '../components/partner/PartnerShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

const PAYMENT_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  partially_paid: 'Partially Paid',
  cancelled: 'Cancelled',
};

const PAYMENT_STATUS_COLORS = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  paid: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  partially_paid: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/20',
};

const SETTLEMENT_STATUS_LABELS = {
  pending: 'Pending',
  paid: 'Paid',
  partially_paid: 'Partially Paid',
  cancelled: 'Cancelled',
  locked: 'Locked',
};

const SETTLEMENT_STATUS_COLORS = {
  pending: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  paid: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  partially_paid: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/20',
  locked: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
};

const ITEMS_PER_PAGE = 20;

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TRANSACTION_TYPE_LABELS = {
  commission: 'Commission',
  booking_income: 'Booking Income',
  bonus: 'Bonus',
  cash: 'Cash Received',
  online_transfer: 'Online Transfer',
  settlement_payment: 'Settlement Payment',
  settlement_receipt: 'Settlement Receipt',
  partner_receivable: 'Partner Receivable',
  fuel_advance: 'Fuel Advance',
  driver_advance: 'Driver Advance',
  toll: 'Toll',
  repair: 'Repair',
  penalty: 'Penalty',
  other_expense: 'Other Expense',
};

const TRANSACTION_TYPE_COLORS = {
  commission: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  booking_income: 'bg-blue-500/10 text-blue-700 border-blue-500/20',
  bonus: 'bg-purple-500/10 text-purple-700 border-purple-500/20',
  cash: 'bg-green-500/10 text-green-700 border-green-500/20',
  online_transfer: 'bg-cyan-500/10 text-cyan-700 border-cyan-500/20',
  settlement_payment: 'bg-teal-500/10 text-teal-700 border-teal-500/20',
  settlement_receipt: 'bg-indigo-500/10 text-indigo-700 border-indigo-500/20',
  partner_receivable: 'bg-amber-500/10 text-amber-700 border-amber-500/20',
  fuel_advance: 'bg-orange-500/10 text-orange-700 border-orange-500/20',
  driver_advance: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20',
  toll: 'bg-red-500/10 text-red-700 border-red-500/20',
  repair: 'bg-pink-500/10 text-pink-700 border-pink-500/20',
  penalty: 'bg-rose-500/10 text-rose-700 border-rose-500/20',
  other_expense: 'bg-gray-500/10 text-gray-700 border-gray-500/20',
};

export default function PartnerFinancials() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [financials, setFinancials] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [payments, setPayments] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [settlementsLoading, setSettlementsLoading] = useState(true);
  const [error, setError] = useState('');
  const [ledgerError, setLedgerError] = useState('');
  const [paymentsError, setPaymentsError] = useState('');
  const [settlementsError, setSettlementsError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [paymentsPagination, setPaymentsPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [settlementsPagination, setSettlementsPagination] = useState({ page: 1, limit: ITEMS_PER_PAGE, total: 0, pages: 0 });
  const [retrying, setRetrying] = useState(false);

  const page = parseInt(searchParams.get('page')) || 1;
  const view = searchParams.get('view') || 'summary';

  const loadFinancials = useCallback(async () => {
    setRetrying(true);
    setError('');
    try {
      const response = await partnerAPI.getFinancials();
      if (response.data?.success) {
        setFinancials(response.data.data);
      } else {
        throw new Error(response.data?.message || 'Financial data unavailable');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Unable to load financial summary. Please try again.');
      setFinancials(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true);
    setLedgerError('');
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
        sort_by: 'created_at',
        sort_order: 'desc',
      };
      const response = await partnerAPI.getLedger(params);
      if (response.data?.success) {
        setLedgerEntries(response.data.data?.entries || []);
        if (response.data.data?.pagination) {
          setPagination(response.data.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Ledger data unavailable');
      }
    } catch (err) {
      setLedgerError(err.response?.data?.message || err.message || 'Unable to load ledger entries. Please try again.');
      setLedgerEntries([]);
    } finally {
      setLedgerLoading(false);
    }
  }, [page]);

  const loadPayments = useCallback(async () => {
    setPaymentsLoading(true);
    setPaymentsError('');
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
      };
      const response = await partnerAPI.getPayments(params);
      if (response.data?.success) {
        setPayments(response.data.data?.payments || []);
        if (response.data.data?.pagination) {
          setPaymentsPagination(response.data.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Payments data unavailable');
      }
    } catch (err) {
      setPaymentsError(err.response?.data?.message || err.message || 'Unable to load payments. Please try again.');
      setPayments([]);
    } finally {
      setPaymentsLoading(false);
    }
  }, [page]);

  const loadSettlements = useCallback(async () => {
    setSettlementsLoading(true);
    setSettlementsError('');
    try {
      const params = {
        page,
        limit: ITEMS_PER_PAGE,
      };
      const response = await partnerAPI.getSettlements(params);
      if (response.data?.success) {
        setSettlements(response.data.data?.settlements || []);
        if (response.data.data?.pagination) {
          setSettlementsPagination(response.data.data.pagination);
        }
      } else {
        throw new Error(response.data?.message || 'Settlements data unavailable');
      }
    } catch (err) {
      setSettlementsError(err.response?.data?.message || err.message || 'Unable to load settlements. Please try again.');
      setSettlements([]);
    } finally {
      setSettlementsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadFinancials();
    loadLedger();
    loadPayments();
    loadSettlements();
  }, [loadFinancials, loadLedger, loadPayments, loadSettlements]);

  const handlePageChange = (newPage) => {
    if (newPage < 1 || newPage > pagination.pages) return;
    setSearchParams({ page: String(newPage), view }, { replace: true });
  };

  const handleRetry = () => {
    loadFinancials();
    loadLedger();
    loadPayments();
    loadSettlements();
  };

  const summaryCards = financials ? [
    {
      title: 'Total Received',
      value: formatCurrency(financials.totalReceived),
      sub: 'Money received from bookings',
      accent: 'amber',
      icon: DollarSign,
    },
    {
      title: 'Total Earnings',
      value: formatCurrency(financials.totalEarnings),
      sub: 'Commission and booking income',
      accent: 'green',
      icon: TrendingUp,
    },
    {
      title: 'Total Paid Out',
      value: formatCurrency(financials.totalPaidOut),
      sub: 'Payments and receivables',
      accent: 'blue',
      icon: WalletCards,
    },
    {
      title: 'Outstanding Balance',
      value: formatCurrency(financials.outstandingBalance),
      sub: 'Current ledger balance',
      accent: 'rose',
      icon: WalletCards,
    },
    {
      title: 'Advances & Expenses',
      value: formatCurrency(financials.totalAdvancesExpenses),
      sub: 'Fuel, toll, repair, etc.',
      accent: 'red',
      icon: Clock3,
    },
  ] : [];

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Financials</p>
            <h2 className="mt-1 text-2xl font-bold text-[#15345B]">Partner Ledger</h2>
            <p className="mt-1 text-sm text-[#15345B]/60">Financial summary and transaction history.</p>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#F5A000]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button onClick={loadFinancials} className="font-semibold underline hover:decoration-red-500">Retry</button>
          </div>
        )}

        {/* Summary Cards */}
        <section aria-labelledby="summary-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Summary</p>
            <h2 id="summary-heading" className="mt-1 text-lg font-bold text-[#15345B]">Financial overview</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {loading
              ? Array.from({ length: 5 }, (_, index) => <LoadingSkeleton key={index} className="h-28" />)
              : summaryCards.map((card) => {
                  const Icon = card.icon;
                  return (
                    <div
                      key={card.title}
                      className="rounded-2xl border border-[#15345B]/10 bg-white p-5 transition-all hover:border-[#F5A000]/30 hover:shadow-[0_4px_12px_rgba(245,166,35,0.1)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">{card.title}</p>
                          <p className="mt-1 text-2xl font-bold text-[#15345B]">{card.value}</p>
                          <p className="mt-1 text-xs text-[#15345B]/60">{card.sub}</p>
                        </div>
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                          <Icon className="h-5 w-5" aria-hidden="true" />
                        </div>
                      </div>
                    </div>
                  );
                })}
          </div>
        </section>

        {/* Ledger Entries */}
        <section aria-labelledby="ledger-heading">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Ledger</p>
              <h2 id="ledger-heading" className="mt-1 text-lg font-bold text-[#15345B]">Transaction history</h2>
            </div>
            <div className="text-sm text-[#15345B]/60">
              {pagination.total > 0 && `Page ${pagination.page} of ${pagination.pages}`}
            </div>
          </div>

          {ledgerError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
              <span>{ledgerError}</span>
              <button onClick={loadLedger} className="font-semibold underline hover:decoration-red-500">Retry</button>
            </div>
          )}

          {ledgerLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <LoadingSkeleton key={i} className="h-16" />
              ))}
            </div>
          ) : ledgerEntries.length === 0 ? (
            <EmptyState
              title="No transactions found"
              subtitle="Your ledger entries will appear here as transactions are recorded."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-[#15345B]/10 text-left text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Type</th>
                      <th className="pb-3 pr-4">Description</th>
                      <th className="pb-3 pr-4 text-right">Credit</th>
                      <th className="pb-3 pr-4 text-right">Debit</th>
                      <th className="pb-3 pr-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#15345B]/8">
                    {ledgerEntries.map((entry) => (
                      <LedgerRow key={entry.id || entry.ledger_id} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="mt-4 space-y-3 md:hidden">
                {ledgerEntries.map((entry) => (
                  <LedgerCard key={entry.id || entry.ledger_id} entry={entry} />
                ))}
              </div>

              {/* Pagination */}
              {pagination.pages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(pagination.page - 1)}
                    disabled={pagination.page <= 1}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span className="px-4 text-sm font-medium text-[#15345B]/70">
                    Page {pagination.page} of {pagination.pages}
                  </span>
                  <button
                    onClick={() => handlePageChange(pagination.page + 1)}
                    disabled={pagination.page >= pagination.pages}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Payments */}
        <section aria-labelledby="payments-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Payments</p>
            <h2 id="payments-heading" className="mt-1 text-lg font-bold text-[#15345B]">Payment history</h2>
          </div>

          {paymentsError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
              <span>{paymentsError}</span>
              <button onClick={loadPayments} className="font-semibold underline hover:decoration-red-500">Retry</button>
            </div>
          )}

          {paymentsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <LoadingSkeleton key={i} className="h-16" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <EmptyState
              title="No payments found"
              subtitle="Your payment history will appear here once payments are recorded."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-[#15345B]/10 text-left text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">
                      <th className="pb-3 pr-4">Date</th>
                      <th className="pb-3 pr-4">Payment Number</th>
                      <th className="pb-3 pr-4">Method</th>
                      <th className="pb-3 pr-4 text-right">Amount</th>
                      <th className="pb-3 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#15345B]/8">
                    {payments.map((payment) => (
                      <PaymentRow key={payment.payment_id} payment={payment} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="mt-4 space-y-3 md:hidden">
                {payments.map((payment) => (
                  <PaymentCard key={payment.payment_id} payment={payment} />
                ))}
              </div>

              {/* Pagination */}
              {paymentsPagination.pages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(paymentsPagination.page - 1)}
                    disabled={paymentsPagination.page <= 1}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span className="px-4 text-sm font-medium text-[#15345B]/70">
                    Page {paymentsPagination.page} of {paymentsPagination.pages}
                  </span>
                  <button
                    onClick={() => handlePageChange(paymentsPagination.page + 1)}
                    disabled={paymentsPagination.page >= paymentsPagination.pages}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>

        {/* Settlements */}
        <section aria-labelledby="settlements-heading">
          <div className="mb-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Settlements</p>
            <h2 id="settlements-heading" className="mt-1 text-lg font-bold text-[#15345B]">Monthly settlement history</h2>
          </div>

          {settlementsError && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
              <span>{settlementsError}</span>
              <button onClick={loadSettlements} className="font-semibold underline hover:decoration-red-500">Retry</button>
            </div>
          )}

          {settlementsLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <LoadingSkeleton key={i} className="h-16" />
              ))}
            </div>
          ) : settlements.length === 0 ? (
            <EmptyState
              title="No settlements found"
              subtitle="Your monthly settlement history will appear here once settlements are generated."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm" role="table">
                  <thead>
                    <tr className="border-b border-[#15345B]/10 text-left text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">
                      <th className="pb-3 pr-4">Period</th>
                      <th className="pb-3 pr-4">Settlement Number</th>
                      <th className="pb-3 pr-4 text-right">Gross Revenue</th>
                      <th className="pb-3 pr-4 text-right">Commission</th>
                      <th className="pb-3 pr-4 text-right">Net Payable</th>
                      <th className="pb-3 pr-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#15345B]/8">
                    {settlements.map((settlement) => (
                      <SettlementRow key={settlement.settlement_id} settlement={settlement} />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="mt-4 space-y-3 md:hidden">
                {settlements.map((settlement) => (
                  <SettlementCard key={settlement.settlement_id} settlement={settlement} />
                ))}
              </div>

              {/* Pagination */}
              {settlementsPagination.pages > 1 && (
                <div className="mt-6 flex items-center justify-center gap-2">
                  <button
                    onClick={() => handlePageChange(settlementsPagination.page - 1)}
                    disabled={settlementsPagination.page <= 1}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <span className="px-4 text-sm font-medium text-[#15345B]/70">
                    Page {settlementsPagination.page} of {settlementsPagination.pages}
                  </span>
                  <button
                    onClick={() => handlePageChange(settlementsPagination.page + 1)}
                    disabled={settlementsPagination.page >= settlementsPagination.pages}
                    className="p-2 rounded-xl border border-[#15345B]/15 hover:bg-[#F5A000]/10 hover:border-[#F5A000]/30 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </PartnerShell>
  );
}

function LedgerRow({ entry }) {
  const type = entry.transaction_type || 'other';
  const typeLabel = TRANSACTION_TYPE_LABELS[type] || type;
  const typeClass = TRANSACTION_TYPE_COLORS[type] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';
  const credit = entry.credit || 0;
  const debit = entry.debit || 0;
  const balance = entry.running_balance || 0;

  return (
    <tr className="hover:bg-[#F5A000]/3 transition-colors">
      <td className="py-3 pr-4 text-[#15345B]/70">{formatDate(entry.created_at)}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeClass}`}>
          {typeLabel}
        </span>
      </td>
      <td className="py-3 pr-4 text-[#15345B]/60">{entry.description || entry.remarks || '—'}</td>
      <td className="py-3 pr-4 text-right font-medium text-emerald-700">{credit > 0 ? formatCurrency(credit) : '—'}</td>
      <td className="py-3 pr-4 text-right font-medium text-red-700">{debit > 0 ? formatCurrency(debit) : '—'}</td>
      <td className="py-3 pr-4 text-right font-semibold text-[#15345B]">{formatCurrency(balance)}</td>
    </tr>
  );
}

function LedgerCard({ entry }) {
  const type = entry.transaction_type || 'other';
  const typeLabel = TRANSACTION_TYPE_LABELS[type] || type;
  const typeClass = TRANSACTION_TYPE_COLORS[type] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';
  const credit = entry.credit || 0;
  const debit = entry.debit || 0;
  const balance = entry.running_balance || 0;

  return (
    <div className="rounded-xl border border-[#15345B]/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${typeClass}`}>
              {typeLabel}
            </span>
            <span className="text-xs text-[#15345B]/50">{formatDate(entry.created_at)}</span>
          </div>
          <p className="mt-1 text-sm text-[#15345B]/60">{entry.description || entry.remarks || '—'}</p>
        </div>
        <div className="text-right">
          {credit > 0 && <span className="block text-sm font-medium text-emerald-700">+{formatCurrency(credit)}</span>}
          {debit > 0 && <span className="block text-sm font-medium text-red-700">-{formatCurrency(debit)}</span>}
          <span className="text-xs font-semibold text-[#15345B]">{formatCurrency(balance)}</span>
        </div>
      </div>
    </div>
  );
}

function PaymentRow({ payment }) {
  const status = payment.status || 'pending';
  const statusLabel = PAYMENT_STATUS_LABELS[status] || status;
  const statusClass = PAYMENT_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';

  return (
    <tr className="hover:bg-[#F5A000]/3 transition-colors">
      <td className="py-3 pr-4 text-[#15345B]/70">{formatDate(payment.date || payment.created_at)}</td>
      <td className="py-3 pr-4 text-[#15345B]/60">{payment.payment_number || '—'}</td>
      <td className="py-3 pr-4 text-[#15345B]/60">{payment.payment_method || '—'}</td>
      <td className="py-3 pr-4 text-right font-medium text-[#15345B]">{formatCurrency(payment.amount)}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </td>
    </tr>
  );
}

function PaymentCard({ payment }) {
  const status = payment.status || 'pending';
  const statusLabel = PAYMENT_STATUS_LABELS[status] || status;
  const statusClass = PAYMENT_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';

  return (
    <div className="rounded-xl border border-[#15345B]/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
              {statusLabel}
            </span>
            <span className="text-xs text-[#15345B]/50">{formatDate(payment.date || payment.created_at)}</span>
          </div>
          <p className="mt-1 text-sm text-[#15345B]/60">{payment.payment_number || '—'} • {payment.payment_method || '—'}</p>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-[#15345B]">{formatCurrency(payment.amount)}</span>
        </div>
      </div>
    </div>
  );
}

function SettlementRow({ settlement }) {
  const status = settlement.status || 'pending';
  const statusLabel = SETTLEMENT_STATUS_LABELS[status] || status;
  const statusClass = SETTLEMENT_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';
  const period = `${settlement.month}/${settlement.year}`;

  return (
    <tr className="hover:bg-[#F5A000]/3 transition-colors">
      <td className="py-3 pr-4 text-[#15345B]/70">{period}</td>
      <td className="py-3 pr-4 text-[#15345B]/60">{settlement.settlement_number || '—'}</td>
      <td className="py-3 pr-4 text-right font-medium text-[#15345B]">{formatCurrency(settlement.gross_revenue)}</td>
      <td className="py-3 pr-4 text-right font-medium text-[#15345B]/60">{formatCurrency(settlement.commission)}</td>
      <td className="py-3 pr-4 text-right font-semibold text-[#15345B]">{formatCurrency(settlement.net_payable)}</td>
      <td className="py-3 pr-4">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
          {statusLabel}
        </span>
      </td>
    </tr>
  );
}

function SettlementCard({ settlement }) {
  const status = settlement.status || 'pending';
  const statusLabel = SETTLEMENT_STATUS_LABELS[status] || status;
  const statusClass = SETTLEMENT_STATUS_COLORS[status] || 'bg-gray-500/10 text-gray-700 border-gray-500/20';
  const period = `${settlement.month}/${settlement.year}`;

  return (
    <div className="rounded-xl border border-[#15345B]/10 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusClass}`}>
              {statusLabel}
            </span>
            <span className="text-xs text-[#15345B]/50">{period}</span>
          </div>
          <p className="mt-1 text-sm text-[#15345B]/60">{settlement.settlement_number || '—'}</p>
        </div>
        <div className="text-right">
          <span className="text-lg font-semibold text-[#15345B]">{formatCurrency(settlement.net_payable)}</span>
          <span className="block text-xs text-[#15345B]/50">Net Payable</span>
        </div>
      </div>
    </div>
  );
}
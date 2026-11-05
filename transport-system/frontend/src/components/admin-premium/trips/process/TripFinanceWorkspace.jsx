/**
 * TripFinanceWorkspace.jsx
 * ============================================================================
 * TRIP FINANCE WORKSPACE — shows all money related to this Trip.
 *
 * SOURCE OF TRUTH: Bihar Transport Workflow Document
 *
 * THREE FINANCIAL CONCEPTS — KEPT SEPARATE:
 *   A. TRIP CALCULATION        — What this trip owes (Gross Hire − Commission)
 *   B. PREVIOUS VENDOR BALANCE — What was already outstanding (Payable/Receivable)
 *   C. ACTUAL PAYMENT          — What was actually paid/received today
 *
 * FINANCE IS NOT AN OPERATIONAL STATUS.
 *   It is a workspace/action that can be opened regardless of Trip status
 *   (DISPATCHED, IN_TRANSIT, AT_DELIVERY_POINT, DELIVERED, COMPLETED).
 *
 * NO HARDCODED VALUES — all data comes from the canonical financial ledger.
 * NO PLACEHOLDER ALERTS — every action calls a real API endpoint.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, Calculator, CreditCard, FileText, Plus,
  Truck, User, Wallet, Download, RefreshCw, Plus as PlusIcon,
  ChevronRight, FileText as FileIcon,
} from 'lucide-react';

import {
  tripFinancialAPI,
} from '../../../../services/api';
import { SectionCard } from '../../ui';
import {
  Badge, Facts, Notice, cx, fmtDate, inr, ConfirmModal,
} from './dispatchAtoms';

/* ------------------------------------------------------------------ */
/*  Helper                                                            */
/* ------------------------------------------------------------------ */

function statusTone(status) {
  switch ((status || '').toUpperCase()) {
    case 'PAID': return 'success';
    case 'PARTIAL': return 'warning';
    case 'PENDING': return 'muted';
    case 'OVERDUE': return 'error';
    default: return 'info';
  }
}

/* ------------------------------------------------------------------ */
/*  Customer Payment Modal                                            */
/* ------------------------------------------------------------------ */

function CustomerPaymentModal({
  open, trip, financials, onClose, onSuccess, busy,
}) {
  const [form, setForm] = useState({
    amount: '',
    payment_method: 'cash',
    reference_number: '',
    notes: '',
    transaction_date: new Date().toISOString().slice(0, 16),
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const outstanding = financials?.customerDue || 0;
  const freight = financials?.freight || 0;
  const collected = financials?.customerCollected || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) {
      setError('Enter a valid payment amount.');
      return;
    }
    if (amt > outstanding) {
      setError(`Amount (₹${amt}) exceeds outstanding customer due (₹${outstanding}).`);
      return;
    }
    setSubmitting(true);
    try {
      await tripFinancialAPI.recordClientPayment(trip.trip_id, {
        amount: amt,
        payment_method: form.payment_method,
        reference_number: form.reference_number || undefined,
        notes: form.notes || undefined,
        transaction_date: form.transaction_date,
        client_id: trip.client_id,
        source_type: trip.source_type || 'WALK_IN',
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Payment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text">Collect Customer Payment</h2>
          <button className="rounded-lg hover:bg-slate-100 p-2 text-slate-400 transition" onClick={onClose}>
            <span className="sr-only">Close</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Read-only context */}
          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><span className="block text-muted mb-1">Trip</span><span className="font-semibold">{trip.trip_number}</span></div>
              <div><span className="block text-muted mb-1">Customer</span><span className="font-semibold">{financials?.clientName || '—'}</span></div>
              <div><span className="block text-muted mb-1">Customer Freight</span><span className="font-semibold text-amber-600">{inr(freight)}</span></div>
              <div><span className="block text-muted mb-1">Previously Received</span><span className="font-semibold">{inr(collected)}</span></div>
              <div><span className="block text-muted mb-1">Outstanding Due</span><span className="font-semibold text-red-600">{inr(outstanding)}</span></div>
              <div><span className="block text-muted mb-1">Payment Status</span><Badge state={financials?.customerPaymentStatus} /></div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <Notice tone="error" title={error} />
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Amount Received (₹)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Payment Mode</label>
                <select
                  value={form.payment_method}
                  onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Reference / UTR Number</label>
              <input
                type="text"
                value={form.reference_number}
                onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
                placeholder="e.g. UTR1234567890"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Payment Date</label>
              <input
                type="datetime-local"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Remarks</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
                placeholder="Optional remarks..."
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border border-border text-[13px] font-semibold text-text disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.amount || parseFloat(form.amount) > outstanding}
                className={`px-4 py-2 rounded-lg bg-amber-600 text-[13px] font-bold text-white disabled:opacity-50 transition hover:bg-amber-700 ${submitting ? 'opacity-80 cursor-not-allowed' : ''}`}
              >
                {submitting ? 'Posting…' : 'Record Payment'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Vendor Transaction Modal                                          */
/* ------------------------------------------------------------------ */

function VendorTransactionModal({
  open, trip, financials, onClose, onSuccess, busy,
}) {
  const [form, setForm] = useState({
    transaction_type: 'PAY',
    amount: '',
    payment_method: 'cash',
    reference_number: '',
    notes: '',
    transaction_date: new Date().toISOString().slice(0, 16),
    petrol_pump_id: '',
    fuel_litres: '',
    fuel_rate_per_litre: '',
    settlement_reference: '',
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const position = financials?.vendorPosition || {};
  const outstanding = position.outstanding || financials?.ownerDue || 0;
  const grossHire = position.grossHire || financials?.ownerShare || 0;
  const commission = position.commissionAmount || financials?.btCommission || 0;
  const netPayable = position.netVendorPayable || financials?.ownerDue || 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const amt = parseFloat(form.amount);
    if (!amt || amt <= 0) {
      setError('Enter a valid transaction amount.');
      return;
    }
    if (form.transaction_type === 'PAY' && amt > outstanding) {
      setError(`Amount (₹${amt}) exceeds outstanding vendor payable (₹${outstanding}).`);
      return;
    }
    setSubmitting(true);
    try {
      await tripFinancialAPI.recordVendorTransaction(trip.trip_id, {
        transaction_type: form.transaction_type,
        amount: amt,
        payment_method: form.payment_method,
        reference_number: form.reference_number || undefined,
        notes: form.notes || undefined,
        transaction_date: form.transaction_date,
        petrol_pump_id: form.petrol_pump_id || undefined,
        fuel_litres: form.fuel_litres || undefined,
        fuel_rate_per_litre: form.fuel_rate_per_litre || undefined,
        settlement_reference: form.settlement_reference || undefined,
        purpose: form.notes || undefined,
      });
      onSuccess();
      onClose();
    } catch (err) {
      setError(err.message || 'Vendor transaction failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const isFuelCredit = form.transaction_type === 'FUEL_CREDIT';
  const isSettlement = form.transaction_type === 'SETTLEMENT';
  const isCollect = form.transaction_type === 'COLLECT';

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-text">Make Vendor Transaction</h2>
          <button className="rounded-lg hover:bg-slate-100 p-2 text-slate-400 transition" onClick={onClose}>
            <span className="sr-only">Close</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Read-only context */}
          <div className="rounded-lg border border-border bg-slate-50 p-3">
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              <div><span className="block text-muted mb-1">Trip</span><span className="font-semibold">{trip.trip_number}</span></div>
              <div><span className="block text-muted mb-1">Vendor</span><span className="font-semibold">{trip.transportOwner?.owner_name || '—'}</span></div>
              <div><span className="block text-muted mb-1">Gross Vehicle Hire</span><span className="font-semibold text-amber-600">{inr(grossHire)}</span></div>
              <div><span className="block text-muted mb-1">Commission</span><span className="font-semibold">{inr(commission)}</span></div>
              <div><span className="block text-muted mb-1">Net Vendor Payable (Trip)</span><span className="font-semibold text-amber-600">{inr(netPayable)}</span></div>
              <div><span className="block text-muted mb-1">Previous Vendor Balance</span><span className="font-semibold">{inr(position.previousOutstanding || 0)}</span></div>
              <div><span className="block text-muted mb-1">Total Outstanding</span><span className="font-semibold text-red-600">{inr(outstanding)}</span></div>
              <div><span className="block text-muted mb-1">Payment Status</span><Badge state={financials?.ownerPaymentStatus} /></div>
            </div>
          </div>

          {/* Error */}
          {error && <Notice tone="error" title={error} />}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* Transaction Type */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Transaction Type</label>
              <select
                value={form.transaction_type}
                onChange={(e) => setForm({ ...form, transaction_type: e.target.value })}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
              >
                <option value="PAY">PAY — BT pays vendor</option>
                <option value="COLLECT">COLLECT — Receive from vendor (commission)</option>
                <option value="SETTLEMENT">SETTLEMENT — Balance adjustment (no cash)</option>
                <option value="ADVANCE">ADVANCE — Vendor advance</option>
                <option value="FUEL_CREDIT">FUEL CREDIT — Fuel supplied via petrol pump</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Transaction Amount (₹)</label>
                <input
                  type="number" step="0.01" min="0"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Payment Mode</label>
                <select
                  value={form.payment_method}
                  onChange={(e) => setForm({ ...form, payment_method: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting || isSettlement}
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="upi">UPI</option>
                  <option value="cheque">Cheque</option>
                  <option value="settlement">Settlement</option>
                </select>
              </div>
            </div>

            {isFuelCredit && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Petrol Pump ID</label>
                  <input
                    type="text"
                    value={form.petrol_pump_id}
                    onChange={(e) => setForm({ ...form, petrol_pump_id: e.target.value })}
                    className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                    disabled={submitting}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Litres</label>
                    <input
                      type="number" step="0.001" min="0"
                      value={form.fuel_litres}
                      onChange={(e) => setForm({ ...form, fuel_litres: e.target.value })}
                      className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                      disabled={submitting}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Rate / Litre</label>
                    <input
                      type="number" step="0.01" min="0"
                      value={form.fuel_rate_per_litre}
                      onChange={(e) => setForm({ ...form, fuel_rate_per_litre: e.target.value })}
                      className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                      disabled={submitting}
                    />
                  </div>
                </div>
              </div>
            )}

            {!isFuelCredit && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Reference / UTR Number</label>
                <input
                  type="text"
                  value={form.reference_number}
                  onChange={(e) => setForm({ ...form, reference_number: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting}
                  placeholder="e.g. UTR1234567890"
                />
              </div>
            )}

            {isSettlement && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Settlement Reference</label>
                <input
                  type="text"
                  value={form.settlement_reference}
                  onChange={(e) => setForm({ ...form, settlement_reference: e.target.value })}
                  className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                  disabled={submitting}
                  placeholder="e.g. SETT-2026-001"
                />
              </div>
            )}

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Transaction Date</label>
              <input
                type="datetime-local"
                value={form.transaction_date}
                onChange={(e) => setForm({ ...form, transaction_date: e.target.value })}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-1">Remarks</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-border px-2.5 py-2 text-[13px] focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                disabled={submitting}
                placeholder="Optional remarks..."
              />
            </div>

            <div className="pt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 rounded-lg border border-border text-[13px] font-semibold text-text disabled:opacity-50 transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !form.amount || parseFloat(form.amount) <= 0}
                className={`px-4 py-2 rounded-lg bg-amber-600 text-[13px] font-bold text-white disabled:opacity-50 transition hover:bg-amber-700 ${submitting ? 'opacity-80 cursor-not-allowed' : ''}`}
              >
                {submitting ? 'Posting…' : 'Record Transaction'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Payment History Row                                               */
/* ------------------------------------------------------------------ */

function PaymentHistoryRow({ tx }) {
  const isCredit = tx.direction === 'CREDIT';
  return (
    <tr className="border-b border-border hover:bg-slate-50/50">
      <td className="px-3 py-2 text-[12px] text-slate-600">{fmtDate(tx.transaction_date, true)}</td>
      <td className="px-3 py-2 text-[12px] font-mono text-slate-700">{tx.reference_number || `TXN-${tx.transaction_id}`}</td>
      <td className="px-3 py-2 text-[12px]">
        <Badge state={tx.transaction_type} />
      </td>
      <td className="px-3 py-2 text-[12px] text-slate-700">{tx.from_party || '—'}</td>
      <td className="px-3 py-2 text-[12px] text-slate-700">{tx.to_party || '—'}</td>
      <td className="px-3 py-2 text-[12px] text-slate-600 capitalize">{tx.payment_method || '—'}</td>
      <td className="px-3 py-2 text-[12px] {isCredit ? 'text-emerald-600' : 'text-red-600'} font-medium">
        {isCredit ? `+${inr(tx.amount)}` : `-${inr(tx.amount)}`}
      </td>
      <td className="px-3 py-2 text-[12px] text-slate-600">{inr(tx.metadata?.running_balance || 0)}</td>
      <td className="px-3 py-2 text-[12px] text-slate-600">{tx.created_by_name || 'System'}</td>
      <td className="px-3 py-2 text-[12px] text-slate-500">{tx.notes || '—'}</td>
      <td className="px-3 py-2 text-[12px]">
        {tx.direction === 'CREDIT' ? (
          <a
            href={`/api/trips/${tx.trip_id}/payments/${tx.transaction_id}/RECEIPT.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:text-amber-700 text-[12px] underline"
          >
            Receipt
          </a>
        ) : (
          <a
            href={`/api/trips/${tx.trip_id}/payments/${tx.transaction_id}/VOUCHER.pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:text-amber-700 text-[12px] underline"
          >
            Voucher
          </a>
        )}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                    */
/* ------------------------------------------------------------------ */

function TripFinanceWorkspace({ tripId }) {
  const [financials, setFinancials] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Modal state
  const [showCustomerPayment, setShowCustomerPayment] = useState(false);
  const [showVendorTransaction, setShowVendorTransaction] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadFinancials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Trip financials
      const finRes = await tripFinancialAPI.getTripFinancials(tripId);
      if (finRes.data?.success) {
        setFinancials(finRes.data.data);
      } else {
        throw new Error(finRes.data?.message || 'Failed to load financials');
      }

      // Vendor position
      const posRes = await fetch(`/api/trips/${tripId}/vendor-position`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
      });
      if (posRes.ok) {
        const posData = await posRes.json();
        if (posData.success) {
          setFinancials((prev) => ({ ...prev, vendorPosition: posData.data }));
        }
      }

      // Transactions / payment history
      const txRes = await tripFinancialAPI.getTripTransactions(tripId);
      if (txRes.data?.success) {
        setTransactions(txRes.data.data || []);
      }
    } catch (err) {
      setError(err.message || 'Failed to load financial data');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadFinancials();
  }, [loadFinancials]);

  const handlePaymentSuccess = () => {
    loadFinancials();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-amber-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6">
        <p className="flex items-center gap-2 text-[15px] font-bold text-red-800">
          <AlertTriangle size={16} aria-hidden="true" /> Unable to load Trip Finance
        </p>
        <p className="mt-1 text-[13px] text-red-900">{error}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            onClick={loadFinancials}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!financials) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <p className="text-[15px] font-bold text-amber-800">No financial data available for this trip.</p>
      </div>
    );
  }

  // Calculate trip margin
  const customerRevenue = financials.freight || 0;
  const vehicleCost = financials.ownerShare || 0;
  const expectedMargin = customerRevenue - vehicleCost;

  // Commission
  const btCommission = financials.btCommission || 0;
  const commissionRate = financials.commissionRate || 0;
  const commissionType = financials.commissionType || 'percentage';

  // Customer section
  const customerCollected = financials.customerCollected || 0;
  const customerDue = financials.customerDue || 0;
  const customerPaymentStatus = financials.customerPaymentStatus || 'PENDING';
  const freightAmount = financials.freight || 0;

  // Owner/Vendor section
  const ownerShare = financials.ownerShare || 0;
  const ownerPaid = financials.ownerPaid || 0;
  const ownerDue = financials.ownerDue || 0;
  const ownerPaymentStatus = financials.ownerPaymentStatus || 'PENDING';

  // Driver section
  const driverAgreedPay = financials.driverAgreedPay || 0;
  const driverPaid = financials.driverPaid || 0;
  const driverDue = financials.driverDue || 0;
  const driverPaymentStatus = financials.driverPaymentStatus || 'PENDING';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-white p-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Trip</p>
          <p className="mt-0.5 text-[20px] font-bold text-text">{financials.tripNumber || '—'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={`/admin/trips/${tripId}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
          >
            <ArrowRight size={14} aria-hidden="true" /> Back to Trip
          </Link>
          <button
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={loadFinancials}
          >
            <RefreshCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>

      {/* Section 1: CUSTOMER */}
      <SectionCard title="CUSTOMER" subtitle={financials.clientName || 'Walk-in Client'} icon={User}>
        <Facts
          items={[
            { label: 'Customer Freight', value: inr(financials.freight) },
            { label: 'Customer Collected', value: inr(financials.customerCollected) },
            { label: 'Customer Due', value: inr(financials.customerDue) },
            { label: 'Payment Status', value: <Badge state={financials.customerPaymentStatus} tone={statusTone(financials.customerPaymentStatus)} /> },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            onClick={() => setShowCustomerPayment(true)}
          >
            <CreditCard size={14} aria-hidden="true" /> Collect Customer Payment
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => setShowCustomerPayment(true)}
          >
            <FileText size={14} aria-hidden="true" /> View Customer Billing
          </button>
        </div>
      </SectionCard>

      {/* Section 2: VEHICLE VENDOR */}
      <SectionCard title="VEHICLE VENDOR" subtitle={financials.ownerName || '—'} icon={Truck}>
        <Facts
          items={[
            { label: 'Gross Vehicle Hire', value: inr(financials.ownerShare) },
            { label: 'Commission', value: `-${inr(financials.btCommission)} (${financials.commissionRate || 0}% ${financials.commissionType || 'percentage'})` },
            { label: 'Net Vendor Payable (Trip)', value: inr(financials.vendorPosition?.netVendorPayable || financials.ownerDue) },
            { label: 'Previous Vendor Balance', value: inr(financials.vendorPosition?.previousOutstanding || 0) },
            { label: 'Total Outstanding', value: inr(financials.ownerDue) },
            { label: 'Paid on this Trip', value: inr(financials.ownerPaid) },
            { label: 'Trip Balance', value: inr(financials.ownerDue) },
            { label: 'Payment Status', value: <Badge state={financials.ownerPaymentStatus} tone={statusTone(financials.ownerPaymentStatus)} /> },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            onClick={() => setShowVendorTransaction(true)}
          >
            <Wallet size={14} aria-hidden="true" /> Make Vendor Transaction
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => setShowVendorTransaction(true)}
          >
            <FileText size={14} aria-hidden="true" /> View Vendor Ledger
          </button>
        </div>
      </SectionCard>

      {/* Section 3: DRIVER */}
      {financials.driverAgreedPay > 0 && (
        <SectionCard title="DRIVER" subtitle={financials.driverName || '—'} icon={User}>
          <Facts
            items={[
              { label: 'Driver Agreed Pay', value: inr(financials.driverAgreedPay) },
              { label: 'Paid', value: inr(financials.driverPaid) },
              { label: 'Due', value: inr(financials.driverDue) },
              { label: 'Payment Status', value: <Badge state={financials.driverPaymentStatus} tone={statusTone(financials.driverPaymentStatus)} /> },
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => {
                // Driver transaction - use vendor transaction modal with driver context
                setShowVendorTransaction(true);
              }}
            >
              <Wallet size={14} aria-hidden="true" /> Make Driver Transaction
            </button>
          </div>
        </SectionCard>
      )}

      {/* Section 4: TRIP MARGIN */}
      <SectionCard title="TRIP MARGIN" subtitle="Expected profitability for this trip" icon={Calculator}>
        <Facts
          items={[
            { label: 'Customer Revenue', value: inr(financials.freight) },
            { label: 'Vehicle Cost', value: inr(financials.ownerShare) },
            { label: 'Expected Margin', value: inr(expectedMargin), highlight: expectedMargin >= 0 },
            { label: 'BT Commission', value: inr(financials.btCommission) },
            { label: 'Commission Rate', value: `${commissionRate}% ${commissionType}` },
          ]}
        />
      </SectionCard>

      {/* Section 5: COMMISSION DETAILS */}
      <SectionCard title="COMMISSION DETAILS" subtitle="Bihar Transport commission breakdown" icon={Calculator}>
        <Facts
          items={[
            { label: 'Commission Type', value: commissionType },
            { label: 'Commission Rate', value: `${commissionRate}%` },
            { label: 'Commission Amount', value: inr(financials.btCommission) },
          ]}
        />
      </SectionCard>

      {/* Section 6: PAYMENT HISTORY & ACTIONS */}
      <SectionCard title="PAYMENT HISTORY & ACTIONS" subtitle="Ledger entries and available actions" icon={FileText}>
        <div className="space-y-3">
          {transactions.length === 0 ? (
            <p className="text-[13px] text-muted">
              No payment history for this trip yet. Use the actions above to record payments.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-slate-50">
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Date</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Ref / Voucher</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Type</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">From</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">To</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Mode</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Debit / Credit</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Balance</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Recorded By</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Remarks</th>
                    <th className="px-3 py-2 text-[11px] font-bold text-muted">Document</th>
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((tx) => (
                    <PaymentHistoryRow key={tx.transaction_id} tx={tx} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => setShowVendorTransaction(true)}
            >
              <PlusIcon size={14} aria-hidden="true" /> Make Vendor Transaction
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => setShowVendorTransaction(true)}
            >
              <PlusIcon size={14} aria-hidden="true" /> Make Driver Transaction
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
              onClick={() => setShowCustomerPayment(true)}
            >
              <CreditCard size={14} aria-hidden="true" /> Collect Customer Payment
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Modals */}
      <CustomerPaymentModal
        open={showCustomerPayment}
        trip={{ trip_id: tripId, trip_number: financials.tripNumber, client_id: financials.clientId, source_type: financials.sourceType }}
        financials={financials}
        onClose={() => setShowCustomerPayment(false)}
        onSuccess={handlePaymentSuccess}
        busy={busy}
      />
      <VendorTransactionModal
        open={showVendorTransaction}
        trip={{ trip_id: tripId, trip_number: financials.tripNumber, transport_owner_id: financials.ownerId, transportOwner: financials.ownerName ? { owner_name: financials.ownerName } : null, vehicle_id: financials.vehicleId, driver_id: financials.driverId, freight_amount: financials.freight }}
        financials={financials}
        onClose={() => setShowVendorTransaction(false)}
        onSuccess={handlePaymentSuccess}
        busy={busy}
      />
    </div>
  );
}

export default TripFinanceWorkspace;

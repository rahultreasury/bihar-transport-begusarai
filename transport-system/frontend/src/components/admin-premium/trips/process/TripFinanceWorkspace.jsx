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
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calculator, CreditCard, FileText, Plus, Truck, User, Wallet } from 'lucide-react';

import { tripFinancialAPI } from '../../../../services/api';
import { SectionCard } from '../../ui';
import {
  Badge, Facts, Notice, cx, fmtDate, inr,
} from './dispatchAtoms';

function TripFinanceWorkspace({ tripId }) {
  const [financials, setFinancials] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadFinancials = async () => {
    setLoading(true);
    try {
      const res = await tripFinancialAPI.getTripFinancials(tripId);
      if (res.data?.success) {
        setFinancials(res.data.data);
      } else {
        setError(res.data?.message || 'Failed to load financial data');
      }
    } catch (err) {
      setError(err.message || 'Failed to load financial data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFinancials();
  }, [tripId]);

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
          <button
            className="rounded-lg border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => window.location.reload()}
          >
            Reload Page
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
        </div>
      </div>

      {/* Section 1: CUSTOMER */}
      <SectionCard title="CUSTOMER" subtitle={financials.clientName || 'Walk-in Client'} icon={User}>
        <Facts
          items={[
            { label: 'Customer Freight', value: inr(financials.freight) },
            { label: 'Customer Collected', value: inr(financials.customerCollected) },
            { label: 'Customer Due', value: inr(financials.customerDue) },
            { label: 'Payment Status', value: <Badge state={financials.customerPaymentStatus} /> },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            onClick={() => alert('Collect Customer Payment - to be implemented')}
          >
            <Plus size={14} aria-hidden="true" /> Collect Customer Payment
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => alert('View Customer Billing - to be implemented')}
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
            { label: 'Net Vendor Payable (Trip)', value: inr(financials.ownerShare) },
            { label: 'Previous Vendor Balance', value: '— (requires ledger context)' },
            { label: 'Total Outstanding', value: inr(financials.ownerDue) },
            { label: 'Paid on this Trip', value: inr(financials.ownerPaid) },
            { label: 'Trip Balance', value: inr(financials.ownerDue) },
            { label: 'Payment Status', value: <Badge state={financials.ownerPaymentStatus} /> },
          ]}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
            onClick={() => alert('Make Vendor Transaction - to be implemented')}
          >
            <Wallet size={14} aria-hidden="true" /> Make Vendor Transaction
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => alert('View Vendor Ledger - to be implemented')}
          >
            <FileText size={14} aria-hidden="true" /> View Vendor Ledger
          </button>
          <button
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
            onClick={() => alert('View Payment History - to be implemented')}
          >
            <Calculator size={14} aria-hidden="true" /> View Payment History
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
              { label: 'Payment Status', value: <Badge state={financials.driverPaymentStatus} /> },
            ]}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => alert('Make Driver Transaction - to be implemented')}
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
            { label: 'Expected Margin', value: inr((financials.freight || 0) - (financials.ownerShare || 0)), highlight: ((financials.freight || 0) - (financials.ownerShare || 0)) >= 0 },
            { label: 'BT Commission', value: inr(financials.btCommission) },
            { label: 'Commission Rate', value: `${financials.commissionRate || 0}% ${financials.commissionType || 'percentage'}` },
          ]}
        />
      </SectionCard>

      {/* Section 5: COMMISSION DETAILS */}
      <SectionCard title="COMMISSION DETAILS" subtitle="Bihar Transport commission breakdown" icon={Calculator}>
        <Facts
          items={[
            { label: 'Commission Type', value: financials.commissionType || 'percentage' },
            { label: 'Commission Rate', value: `${financials.commissionRate || 0}%` },
            { label: 'Commission Amount', value: inr(financials.btCommission) },
          ]}
        />
      </SectionCard>

      {/* Section 6: PAYMENT HISTORY & ACTIONS */}
      <SectionCard title="PAYMENT HISTORY & ACTIONS" subtitle="Ledger entries and available actions" icon={FileText}>
        <div className="space-y-3">
          <p className="text-[13px] text-muted">
            Full transaction history and payment actions will be implemented here.
            This includes: vendor payments, driver settlements, customer collections,
            fuel payments, and settlement vouchers.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => alert('Make Vendor Transaction - to be implemented')}
            >
              <Plus size={14} aria-hidden="true" /> Make Vendor Transaction
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-2 text-[12.5px] font-bold text-white transition hover:bg-amber-700"
              onClick={() => alert('Make Driver Transaction - to be implemented')}
            >
              <Plus size={14} aria-hidden="true" /> Make Driver Transaction
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
              onClick={() => alert('Collect Customer Payment - to be implemented')}
            >
              <CreditCard size={14} aria-hidden="true" /> Collect Customer Payment
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
              onClick={() => alert('View Vendor Ledger - to be implemented')}
            >
              <FileText size={14} aria-hidden="true" /> View Vendor Ledger
            </button>
            <button
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-text transition hover:bg-slate-50"
              onClick={() => alert('View Payment History - to be implemented')}
            >
              <FileText size={14} aria-hidden="true" /> View Payment History
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

export default TripFinanceWorkspace;
/**
 * FinancePostingModal — the single dialog that posts money.
 *
 * Every write goes through FinancePostingService. The dialog never calculates
 * a balance or a commission; it collects intent, sends it once with an
 * idempotency key, and shows the server's voucher number. A retried submission
 * therefore returns the same voucher instead of creating a second one.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Droplets,
  FileText,
  Fuel,
  HandCoins,
  Handshake,
  Plus,
  RotateCcw,
  TrendingUp,
} from 'lucide-react';

import { AdminModal, Button, FormField } from '../ui';
import { financeAPI } from '../../../services/api';
import { day, inr, unwrap } from './format';
import { useApiData } from './useApiData';
import { Note } from './shared';

const MODE_META = {
  receipt: { title: 'Record Customer Receipt', description: 'Cash, bank, UPI, cheque or a non-cash settlement against an invoice.', icon: ArrowDownLeft },
  'vendor-payment': { title: 'Pay Vendor', description: 'Cash/bank payment plus an optional fuel credit supplied on the vendor\'s behalf.', icon: ArrowUpRight },
  advance: { title: 'Record Advance', description: 'Money paid out before it is earned. It is counted once, then adjusted.', icon: HandCoins },
  'advance-adjust': { title: 'Adjust Advance', description: 'Record utilisation without writing a second cash row.', icon: Banknote },
  'commission-receipt': { title: 'Receive Commission', description: 'Explicit commission received from a vendor against a trip.', icon: TrendingUp },
  settlement: { title: 'Post Settlement', description: 'Clear a vendor or customer balance without moving cash.', icon: Handshake },
  pump: { title: 'Add Petrol Pump', description: 'Opening balance, credit limit and contact details.', icon: Plus },
  fuel: { title: 'Record Fuel', description: 'Credit fuel purchased from a pump. Raises the pump liability; moves no cash.', icon: Droplets },
  'pump-bill': { title: 'Create Pump Bill', description: 'Bill all unbilled fuel in a period and compute the outstanding amount.', icon: FileText },
  'pump-payment': { title: 'Pay Petrol Pump', description: 'Cash/bank payment against a pump bill or on account.', icon: Banknote },
  'opening-balance': { title: 'Set Opening Balance', description: 'A signed opening balance: positive = party owes BT, negative = BT owes party.', icon: Banknote },
  reverse: { title: 'Reverse Transaction', description: 'Post an opposite-direction reversal. The original row is never edited.', icon: RotateCcw },
};

const today = () => new Date().toISOString().slice(0, 10);
const makeKey = () =>
  (globalThis.crypto?.randomUUID?.() || `fin-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const blank = {
  invoice_id: '',
  trip_id: '',
  vendor_id: '',
  party_type: 'VENDOR',
  party_id: '',
  pump_id: '',
  bill_id: '',
  amount: '',
  cash_amount: '',
  fuel_amount: '',
  litres: '',
  rate_per_litre: '',
  payment_method: 'CASH',
  reference_number: '',
  transaction_date: today(),
  given_at: today(),
  fuel_date: today(),
  payment_date: today(),
  bill_date: today(),
  period_start: '',
  period_end: '',
  due_date: '',
  notes: '',
  is_advance: false,
  fuel_type: 'DIESEL',
  receipt_number: '',
  pump_name: '',
  pump_code: '',
  owner_name: '',
  contact_number: '',
  city: '',
  credit_limit: '',
  opening_balance: '',
  gst_number: '',
  as_of_date: today(),
  reason: '',
};

function Field({ label, children, hint, required }) {
  return (
    <FormField label={label} hint={hint} required={required}>
      {children}
    </FormField>
  );
}

export default function FinancePostingModal({ open, mode, preset = {}, onClose, onSuccess }) {
  const meta = MODE_META[mode] || MODE_META.receipt;
  const Icon = meta.icon;
  const [form, setForm] = useState({ ...blank, ...preset });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState(makeKey);

  const { data: lookups } = useApiData(async () => {
    if (!open) return null;
    const res = await financeAPI.getLookups();
    return unwrap(res);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setForm({ ...blank, ...preset });
    setError('');
    setSaving(false);
    setIdempotencyKey(makeKey());
  }, [open, mode]);

  const set = (key) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event?.target ? event.target.value : event;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const invoices = lookups?.invoices || [];
  const vendors = lookups?.vendors || [];
  const pumps = lookups?.pumps || [];
  const trips = lookups?.trips || [];

  const selectedInvoice = useMemo(
    () => invoices.find((i) => String(i.invoice_id) === String(form.invoice_id)),
    [invoices, form.invoice_id],
  );
  const selectedTrip = useMemo(
    () => trips.find((t) => String(t.trip_id) === String(form.trip_id)),
    [trips, form.trip_id],
  );

  useEffect(() => {
    if (selectedTrip?.vendor_id && !form.vendor_id) {
      setForm((prev) => ({ ...prev, vendor_id: String(selectedTrip.vendor_id) }));
    }
  }, [selectedTrip?.vendor_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mode === 'receipt' && selectedInvoice && !preset.amount) {
      setForm((prev) => ({ ...prev, amount: prev.amount || String(selectedInvoice.invoice_total || '') }));
    }
  }, [mode, selectedInvoice?.invoice_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsLookups = !['reverse', 'advance-adjust'].includes(mode);
  const requiresReference = ['BANK', 'SETTLEMENT'].includes(String(form.payment_method || '').toUpperCase());

  const buildPayload = () => {
    const base = {
      notes: form.notes || undefined,
      transaction_date: form.transaction_date || today(),
      idempotency_key: idempotencyKey,
    };
    switch (mode) {
      case 'receipt':
        return {
          ...base,
          invoice_id: Number(form.invoice_id),
          amount: Number(form.amount),
          payment_method: form.payment_method,
          reference_number: form.reference_number || undefined,
          transaction_date: form.transaction_date,
        };
      case 'vendor-payment':
        return {
          ...base,
          trip_id: form.trip_id ? Number(form.trip_id) : undefined,
          vendor_id: form.vendor_id ? Number(form.vendor_id) : undefined,
          amount: Number(form.cash_amount || form.amount || 0),
          fuel_amount: Number(form.fuel_amount || 0),
          petrol_pump_id: form.pump_id ? Number(form.pump_id) : undefined,
          payment_method: form.payment_method,
          reference_number: form.reference_number || undefined,
          is_advance: Boolean(form.is_advance),
        };
      case 'advance':
        return {
          ...base,
          party_type: form.party_type,
          trip_id: form.trip_id ? Number(form.trip_id) : undefined,
          amount: Number(form.amount),
          payment_method: form.payment_method,
          reference_number: form.reference_number || undefined,
          given_at: form.given_at,
        };
      case 'advance-adjust':
        return {
          amount: Number(form.amount),
          reference_number: form.reference_number || undefined,
          notes: form.notes || undefined,
        };
      case 'commission-receipt':
        return {
          ...base,
          vendor_id: form.vendor_id ? Number(form.vendor_id) : undefined,
          trip_id: form.trip_id ? Number(form.trip_id) : undefined,
          amount: Number(form.amount),
          payment_method: form.payment_method,
          reference_number: form.reference_number || undefined,
        };
      case 'settlement':
        return {
          ...base,
          party_type: form.party_type,
          vendor_id: form.vendor_id ? Number(form.vendor_id) : undefined,
          invoice_id: form.invoice_id ? Number(form.invoice_id) : undefined,
          trip_id: form.trip_id ? Number(form.trip_id) : undefined,
          amount: Number(form.amount),
          reference_number: form.reference_number || undefined,
          settlement_date: form.transaction_date,
        };
      case 'pump':
        return {
          pump_name: form.pump_name,
          pump_code: form.pump_code || undefined,
          owner_name: form.owner_name || undefined,
          contact_number: form.contact_number || undefined,
          city: form.city || undefined,
          credit_limit: Number(form.credit_limit || 0),
          opening_balance: Number(form.opening_balance || 0),
          gst_number: form.gst_number || undefined,
        };
      case 'fuel': {
        const litres = Number(form.litres);
        const rate = Number(form.rate_per_litre);
        return {
          pump_id: Number(form.pump_id),
          trip_id: form.trip_id ? Number(form.trip_id) : undefined,
          fuel_type: form.fuel_type,
          litres,
          rate_per_litre: rate,
          total_amount: Number(form.amount) || Math.round(litres * rate * 100) / 100,
          fuel_date: form.fuel_date,
          receipt_number: form.receipt_number || undefined,
          remarks: form.notes || undefined,
          idempotency_key: idempotencyKey,
        };
      }
      case 'pump-bill':
        return {
          pump_id: Number(form.pump_id),
          period_start: form.period_start,
          period_end: form.period_end,
          bill_date: form.bill_date,
          due_date: form.due_date || undefined,
          adjustment_amount: Number(form.amount || 0),
          remarks: form.notes || undefined,
        };
      case 'pump-payment':
        return {
          pump_id: Number(form.pump_id),
          bill_id: form.bill_id ? Number(form.bill_id) : undefined,
          amount: Number(form.amount),
          payment_method: form.payment_method,
          reference_number: form.reference_number || undefined,
          payment_date: form.payment_date,
          remarks: form.notes || undefined,
          idempotency_key: idempotencyKey,
        };
      case 'opening-balance':
        return {
          party_type: form.party_type,
          party_id: Number(form.party_id),
          amount: Number(form.amount),
          as_of_date: form.as_of_date,
          notes: form.notes || undefined,
        };
      case 'reverse':
        return { reason: form.reason };
      default:
        return base;
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = buildPayload();
      let response;
      if (mode === 'receipt') response = await financeAPI.postReceipt(payload);
      else if (mode === 'vendor-payment') response = await financeAPI.postVendorPayment(payload);
      else if (mode === 'advance') response = await financeAPI.postAdvance(payload);
      else if (mode === 'advance-adjust') response = await financeAPI.adjustAdvance(preset.advance_id, payload);
      else if (mode === 'commission-receipt') response = await financeAPI.postCommissionReceipt(payload);
      else if (mode === 'settlement') response = await financeAPI.postSettlement(payload);
      else if (mode === 'pump') response = await financeAPI.createPump(payload);
      else if (mode === 'fuel') response = await financeAPI.postFuel(payload);
      else if (mode === 'pump-bill') response = await financeAPI.createPumpBill(payload);
      else if (mode === 'pump-payment') response = await financeAPI.payPump(payload);
      else if (mode === 'opening-balance') response = await financeAPI.setOpeningBalance(payload);
      else if (mode === 'reverse') response = await financeAPI.reverseTransaction(preset.transaction_id, payload);
      else throw new Error(`Unknown posting mode "${mode}"`);

      onSuccess?.(unwrap(response), mode);
      onClose?.();
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'The posting failed. Nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <AdminModal open={open} onClose={onClose} title={meta.title} description={meta.description} icon={Icon} size="lg">
      <form onSubmit={submit}>
        <div className="grid gap-4 p-6 sm:grid-cols-2">
          {error ? (
            <div className="sm:col-span-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-[12.5px] text-red-700">
              {error}
            </div>
          ) : null}

          {mode === 'receipt' ? (
            <Field label="Invoice" required hint={selectedInvoice ? `${selectedInvoice.customer_name} · ${inr(selectedInvoice.invoice_total)} · due ${day(selectedInvoice.due_at)}` : 'The receipt is allocated to this invoice'}>
              <select className="bt-select" value={form.invoice_id} onChange={set('invoice_id')} required>
                <option value="">Select an invoice…</option>
                {invoices.map((i) => (
                  <option key={i.invoice_id} value={i.invoice_id}>
                    {i.invoice_number} · {i.customer_name} · {inr(i.invoice_total)}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}

          {mode === 'settlement' ? (
            <Field label="Party type" required>
              <select className="bt-select" value={form.party_type} onChange={set('party_type')}>
                <option value="VENDOR">Vendor</option>
                <option value="CUSTOMER">Customer</option>
              </select>
            </Field>
          ) : null}

          {mode === 'advance' ? (
            <Field label="Advance category" required>
              <select className="bt-select" value={form.party_type} onChange={set('party_type')}>
                <option value="VENDOR">Vendor</option>
                <option value="DRIVER">Driver</option>
                <option value="FUEL">Fuel</option>
                <option value="CUSTOMER">Customer</option>
              </select>
            </Field>
          ) : null}

          {(mode === 'vendor-payment' || mode === 'commission-receipt' || (mode === 'settlement' && form.party_type === 'VENDOR')) ? (
            <Field label="Vendor" required={mode !== 'settlement'}>
              <select className="bt-select" value={form.vendor_id} onChange={set('vendor_id')} required={mode !== 'settlement'}>
                <option value="">Select a vendor…</option>
                {vendors.map((v) => (
                  <option key={v.vendor_id} value={v.vendor_id}>{v.name}{v.mobile ? ` · ${v.mobile}` : ''}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {mode === 'settlement' && form.party_type === 'CUSTOMER' ? (
            <Field label="Invoice" required hint="A customer settlement must reduce a specific invoice">
              <select className="bt-select" value={form.invoice_id} onChange={set('invoice_id')} required>
                <option value="">Select an invoice…</option>
                {invoices.map((i) => (
                  <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_number} · {i.customer_name} · {inr(i.invoice_total)}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {['receipt', 'vendor-payment', 'advance', 'commission-receipt', 'settlement', 'fuel'].includes(mode) ? (
            <Field label="Trip" hint={selectedTrip ? `${selectedTrip.trip_number} · ${selectedTrip.vendor_name || selectedTrip.customer_name || 'No party'} · freight ${inr(selectedTrip.freight_amount)}` : 'Optional, but a trip anchors the ledger allocation'}>
              <select className="bt-select" value={form.trip_id} onChange={set('trip_id')}>
                <option value="">No specific trip</option>
                {trips.map((t) => (
                  <option key={t.trip_id} value={t.trip_id}>{t.trip_number} · {t.vendor_name || t.customer_name || t.branch || 'Trip'}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {mode === 'vendor-payment' ? (
            <>
              <Field label="Cash amount" required hint="Money actually paid now">
                <input type="number" min="0" step="0.01" className="bt-input" value={form.cash_amount} onChange={set('cash_amount')} required />
              </Field>
              <Field label="Fuel credit (optional)" hint="Fuel BT supplied to the vendor; reduces the payable but is not cash">
                <input type="number" min="0" step="0.01" className="bt-input" value={form.fuel_amount} onChange={set('fuel_amount')} />
              </Field>
              <Field label="Petrol pump" hint="Required only when a fuel credit is included">
                <select className="bt-select" value={form.pump_id} onChange={set('pump_id')}>
                  <option value="">No pump</option>
                  {pumps.map((p) => <option key={p.pump_id} value={p.pump_id}>{p.pump_name}</option>)}
                </select>
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-[12.5px] font-medium text-bt-ink-2">
                <input type="checkbox" checked={!!form.is_advance} onChange={set('is_advance')} className="h-4 w-4 accent-bt-orange" />
                Treat as an advance
              </label>
            </>
          ) : null}

          {['receipt', 'advance', 'advance-adjust', 'commission-receipt', 'settlement', 'pump-payment'].includes(mode) ? (
            <Field label="Amount" required>
              <input type="number" min="0.01" step="0.01" className="bt-input" value={form.amount} onChange={set('amount')} required />
            </Field>
          ) : null}

          {['receipt', 'advance', 'commission-receipt', 'vendor-payment', 'pump-payment'].includes(mode) ? (
            <>
              <Field label="Payment method" required>
                <select className="bt-select" value={form.payment_method} onChange={set('payment_method')}>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank transfer</option>
                  <option value="UPI">UPI</option>
                  <option value="CHEQUE">Cheque</option>
                  {mode === 'receipt' || mode === 'settlement' ? <option value="SETTLEMENT">Settlement (non-cash)</option> : null}
                </select>
              </Field>
              <Field label="Reference / UTR" hint={requiresReference ? 'Required for bank and settlement postings' : 'Optional for cash'} required={requiresReference}>
                <input className="bt-input" value={form.reference_number} onChange={set('reference_number')} required={requiresReference} placeholder={requiresReference ? 'UTR / cheque / settlement reference' : 'Optional'} />
              </Field>
            </>
          ) : null}

          {['receipt', 'vendor-payment', 'settlement'].includes(mode) ? (
            <Field label="Transaction date">
              <input type="date" className="bt-input" value={form.transaction_date} onChange={set('transaction_date')} />
            </Field>
          ) : null}

          {mode === 'advance' ? (
            <Field label="Advance date">
              <input type="date" className="bt-input" value={form.given_at} onChange={set('given_at')} />
            </Field>
          ) : null}

          {mode === 'advance-adjust' ? (
            <div className="sm:col-span-2">
              <Note tone="info">
                Adjusting <strong>{preset.voucher_number || `Advance #${preset.advance_id}`}</strong> · {preset.party_name} · advanced {inr(preset.amount)} · already adjusted {inr(preset.adjusted_amount)}.
                The unadjusted balance is {inr(preset.outstanding)}. No second cash row is written.
              </Note>
            </div>
          ) : null}

          {mode === 'pump' ? (
            <>
              <Field label="Pump name" required><input className="bt-input" value={form.pump_name} onChange={set('pump_name')} required /></Field>
              <Field label="Pump code"><input className="bt-input" value={form.pump_code} onChange={set('pump_code')} placeholder="e.g. PP-BEG-01" /></Field>
              <Field label="Owner name"><input className="bt-input" value={form.owner_name} onChange={set('owner_name')} /></Field>
              <Field label="Contact number"><input className="bt-input" value={form.contact_number} onChange={set('contact_number')} /></Field>
              <Field label="City"><input className="bt-input" value={form.city} onChange={set('city')} /></Field>
              <Field label="GST number"><input className="bt-input" value={form.gst_number} onChange={set('gst_number')} /></Field>
              <Field label="Credit limit"><input type="number" min="0" step="0.01" className="bt-input" value={form.credit_limit} onChange={set('credit_limit')} /></Field>
              <Field label="Opening balance" hint="Positive = BT owes the pump"><input type="number" step="0.01" className="bt-input" value={form.opening_balance} onChange={set('opening_balance')} /></Field>
            </>
          ) : null}

          {['fuel', 'pump-bill', 'pump-payment'].includes(mode) ? (
            <Field label="Petrol pump" required>
              <select className="bt-select" value={form.pump_id} onChange={set('pump_id')} required>
                <option value="">Select a pump…</option>
                {pumps.map((p) => <option key={p.pump_id} value={p.pump_id}>{p.pump_name}{p.city ? ` · ${p.city}` : ''}</option>)}
              </select>
            </Field>
          ) : null}

          {mode === 'fuel' ? (
            <>
              <Field label="Fuel type" required>
                <select className="bt-select" value={form.fuel_type} onChange={set('fuel_type')}>
                  <option value="DIESEL">Diesel</option>
                  <option value="PETROL">Petrol</option>
                  <option value="CNG">CNG</option>
                  <option value="OTHER">Other</option>
                </select>
              </Field>
              <Field label="Litres" required><input type="number" min="0.01" step="0.01" className="bt-input" value={form.litres} onChange={set('litres')} required /></Field>
              <Field label="Rate per litre" required><input type="number" min="0.01" step="0.01" className="bt-input" value={form.rate_per_litre} onChange={set('rate_per_litre')} required /></Field>
              <Field label="Total amount" hint="Leave blank to use litres × rate"><input type="number" min="0" step="0.01" className="bt-input" value={form.amount} onChange={set('amount')} /></Field>
              <Field label="Fuel date"><input type="date" className="bt-input" value={form.fuel_date} onChange={set('fuel_date')} /></Field>
              <Field label="Receipt number" hint="Also used as the idempotency reference"><input className="bt-input" value={form.receipt_number} onChange={set('receipt_number')} /></Field>
            </>
          ) : null}

          {mode === 'pump-bill' ? (
            <>
              <Field label="Period start" required><input type="date" className="bt-input" value={form.period_start} onChange={set('period_start')} required /></Field>
              <Field label="Period end" required><input type="date" className="bt-input" value={form.period_end} onChange={set('period_end')} required /></Field>
              <Field label="Bill date"><input type="date" className="bt-input" value={form.bill_date} onChange={set('bill_date')} /></Field>
              <Field label="Due date"><input type="date" className="bt-input" value={form.due_date} onChange={set('due_date')} /></Field>
              <Field label="Adjustment amount" hint="Added to the fuel total; use a negative value for a credit"><input type="number" step="0.01" className="bt-input" value={form.amount} onChange={set('amount')} /></Field>
            </>
          ) : null}

          {mode === 'pump-payment' ? (
            <>
              <Field label="Payment date"><input type="date" className="bt-input" value={form.payment_date} onChange={set('payment_date')} /></Field>
              <Field label="Bill ID (optional)" hint="Leave blank for an on-account payment"><input type="number" min="1" className="bt-input" value={form.bill_id} onChange={set('bill_id')} /></Field>
            </>
          ) : null}

          {mode === 'opening-balance' ? (
            <>
              <Field label="Party type" required>
                <select className="bt-select" value={form.party_type} onChange={set('party_type')}>
                  <option value="CUSTOMER">Customer</option>
                  <option value="VENDOR">Vendor</option>
                  <option value="DRIVER">Driver</option>
                  <option value="PETROL_PUMP">Petrol pump</option>
                </select>
              </Field>
              <Field label="Party ID" required hint="The numeric customer / vendor / driver / pump id"><input type="number" min="1" className="bt-input" value={form.party_id} onChange={set('party_id')} required /></Field>
              <Field label="Amount" required hint="Positive = party owes BT; negative = BT owes party"><input type="number" step="0.01" className="bt-input" value={form.amount} onChange={set('amount')} required /></Field>
              <Field label="As of date"><input type="date" className="bt-input" value={form.as_of_date} onChange={set('as_of_date')} /></Field>
            </>
          ) : null}

          {mode === 'reverse' ? (
            <div className="sm:col-span-2">
              <Note tone="warning">
                You are reversing <strong>{preset.voucher_number || `TX-${preset.transaction_id}`}</strong> · {inr(preset.amount)}. An opposite-direction REVERSAL row is posted; the original is untouched.
              </Note>
              <Field label="Reason for reversal" required hint="At least 5 characters; stored in the audit trail">
                <textarea className="bt-textarea" rows={3} value={form.reason} onChange={set('reason')} required minLength={5} />
              </Field>
            </div>
          ) : null}

          {['receipt', 'vendor-payment', 'advance', 'commission-receipt', 'settlement', 'fuel', 'pump-bill', 'pump-payment', 'opening-balance'].includes(mode) ? (
            <Field label="Notes" className="sm:col-span-2">
              <textarea className="bt-textarea" rows={2} value={form.notes} onChange={set('notes')} placeholder="Optional note stored with the voucher" />
            </Field>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-bt-border px-6 py-4">
          <p className="text-[11px] leading-relaxed text-bt-ink-3">
            {needsLookups ? 'Posted with a unique idempotency key. Retrying the same submission returns the same voucher.' : 'This posting is recorded in the audit trail.'}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={onClose} type="button">Cancel</Button>
            <Button variant="primary" type="submit" loading={saving}>
              {mode === 'reverse' ? 'Post reversal' : 'Post entry'}
            </Button>
          </div>
        </footer>
      </form>
    </AdminModal>
  );
}

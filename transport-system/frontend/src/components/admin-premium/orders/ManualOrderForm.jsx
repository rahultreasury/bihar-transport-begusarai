/**
 * ManualOrderForm.jsx
 * ---------------------------------------------------------------------------
 * Manual (phone/offline) order creation form for the Admin Order / Trip Master.
 *
 * Connected to real backend APIs:
 *   GET  /api/admin/orders/manual/lookups   customers, vehicles, drivers, owners
 *   POST /api/admin/orders/manual            create the order
 *
 * One central Order/Trip record is created: a Booking + a Trip with
 * source_type = MANUAL. No enquiry, no quotation, no fake vehicle/driver,
 * and no automatic invoice are created.
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Plus,
  User,
  Truck,
  MapPin,
  Package,
  CreditCard,
  Search,
  Save,
  CheckCircle,
  Building2,
  FileText,
  ChevronDown,
} from 'lucide-react';
import { adminAPI } from '../../../services/api';
import { Button, AdminModal, FormField } from '../ui/AdminUI';
import { inr } from '../../../utils/orderFormat';

const RATE_AS_PER_OPTIONS = [
  { label: 'Per Trip', value: 'per_trip' },
  { label: 'Per Ton', value: 'per_ton' },
  { label: 'Per KM', value: 'per_km' },
  { label: 'Fixed Freight', value: 'fixed' },
];

const GST_TYPE_OPTIONS = [
  { label: 'Forward Charge', value: 'FORWARD_CHARGE' },
  { label: 'RCM', value: 'RCM' },
  { label: 'Exempt', value: 'EXEMPT' },
];

const PAYMENT_TERMS_OPTIONS = [
  { label: 'Full Payment in Advance', value: 'FULL_PAYMENT_IN_ADVANCE' },
  {
    label: 'Booking Amount + Advance After Loading + Balance at Unloading',
    value: 'BOOKING_ADVANCE_BALANCE',
  },
  { label: 'Custom Schedule', value: 'CUSTOM' },
];

const YES_NO_TBC = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
  { label: 'To Be Confirmed', value: 'to_be_confirmed' },
];

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currency(v) {
  return inr(num(v));
}

export default function ManualOrderForm({ open, onClose, onSuccess }) {
  const [step, setStep] = useState('form'); // form | confirm | success
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [lookups, setLookups] = useState({ clients: [], vehicles: [], drivers: [], owners: [] });
  const [lookupsLoading, setLookupsLoading] = useState(false);
  const [lookupsError, setLookupsError] = useState(null);
  const [lookupsLoaded, setLookupsLoaded] = useState(false);

  const [customerMode, setCustomerMode] = useState('existing'); // existing | new
  const [customerSearch, setCustomerSearch] = useState('');
  const [filteredClients, setFilteredClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState(null);

  const [form, setForm] = useState({
    orderInfo: { orderDate: new Date().toISOString().split('T')[0], branch: '' },
    customer: { mode: 'existing', clientId: '', newClient: {} },
    pickup: {
      location: '', address: '', city: '', state: 'Bihar', pincode: '',
      contactPerson: '', contactNumber: '',
    },
    drop: {
      location: '', address: '', city: '', state: 'Bihar', pincode: '',
      contactPerson: '', contactNumber: '',
    },
    tripType: 'One Way',
    distanceKm: '',
    goods: {
      description: '', category: '', quantity: '', quantityUnit: 'Pieces',
      weight: '', weightUnit: 'Tons', packageType: '', specialInstructions: '', value: '',
    },
    vehicle: {
      type: '', size: '', requiredQuantity: 1, tripDate: '',
      expectedDeliveryDate: '', specialRequirements: '', remarks: '',
    },
    commercial: {
      rateType: 'per_trip', rateAsPer: 'per_trip', rate: '', freightAmount: '',
      gstType: 'FORWARD_CHARGE', gstPercentage: '', gstAmount: '',
      additionalCharges: [{ name: '', rate: '', quantity: '', total: '' }],
      additionalChargesTax: '', totalBillingAmount: '',
      paymentTerms: '', paymentRemarks: '',
    },
    operational: {
      podRequired: false, partyInvoiceRequired: 'to_be_confirmed',
      ewayBillRequired: 'to_be_confirmed', lrGrRequired: 'to_be_confirmed',
      specialDocuments: '', remarks: '',
    },
  });

  // ── Lookups (customers + vehicles) ────────────────────────────────
  const loadLookups = useCallback(async () => {
    setLookupsLoading(true);
    setLookupsError(null);
    try {
      const res = await adminAPI.getManualOrderLookups({ limit: 200 });
      const data = res.data?.data || {};
      setLookups({
        clients: Array.isArray(data.clients) ? data.clients : [],
        vehicles: Array.isArray(data.vehicles) ? data.vehicles : [],
        drivers: Array.isArray(data.drivers) ? data.drivers : [],
        owners: Array.isArray(data.owners) ? data.owners : [],
      });
      setLookupsLoaded(true);
    } catch (err) {
      setLookupsError(err?.response?.data?.message || err?.message || 'Failed to load customer/vehicle list');
      setLookupsLoaded(false);
    } finally {
      setLookupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadLookups();
  }, [open, loadLookups]);

  useEffect(() => {
    const term = customerSearch.trim().toLowerCase();
    setFilteredClients(
      lookups.clients.filter(
        (c) =>
          !term ||
          String(c.company_name || '').toLowerCase().includes(term) ||
          String(c.contact_person || '').toLowerCase().includes(term) ||
          String(c.phone || '').includes(term) ||
          String(c.client_code || '').toLowerCase().includes(term)
      )
    );
  }, [customerSearch, lookups.clients]);

  // ── Computed commercial totals ────────────────────────────────────
  const commercial = form.commercial;
  const additionalCharges = useMemo(() => {
    return (commercial.additionalCharges || []).map((c) => ({
      ...c,
      total: num(c.rate) * num(c.quantity),
    }));
  }, [commercial.additionalCharges]);

  const additionalChargesTotal = useMemo(
    () => additionalCharges.reduce((s, c) => s + num(c.total), 0),
    [additionalCharges]
  );

  const gstAmount = useMemo(() => {
    if (commercial.gstType === 'EXEMPT') return 0;
    if (commercial.gstType === 'RCM') return num(commercial.gstAmount);
    return num(commercial.freightAmount) * (num(commercial.gstPercentage) / 100);
  }, [commercial.freightAmount, commercial.gstPercentage, commercial.gstType, commercial.gstAmount]);

  const totalBillingAmount = useMemo(
    () =>
      num(commercial.freightAmount) +
      additionalChargesTotal +
      num(gstAmount) +
      num(commercial.additionalChargesTax),
    [commercial.freightAmount, additionalChargesTotal, gstAmount, commercial.additionalChargesTax]
  );

  const suggestedFreight = useMemo(() => {
    const rate = num(commercial.rate);
    const dist = num(form.distanceKm);
    const weight = num(form.goods.weight);
    switch (commercial.rateAsPer) {
      case 'per_ton': return rate * weight;
      case 'per_km': return rate * dist;
      default: return rate;
    }
  }, [commercial.rate, commercial.rateAsPer, form.distanceKm, form.goods.weight]);

  // ── Field helpers ─────────────────────────────────────────────────
  const setField = useCallback((section, key, value) => {
    setForm((prev) => {
      const next = { ...prev, [section]: { ...prev[section], [key]: value } };
      // Keep totalBillingAmount in sync with computed unless user overrides
      return next;
    });
  }, []);

  const setNested = useCallback((section, key, subKey, value) => {
    setForm((prev) => {
      const next = { ...prev, [section]: { ...prev[section], [key]: { ...prev[section][key], [subKey]: value } } };
      return next;
    });
  }, []);

  const addChargeRow = useCallback(() => {
    setForm((prev) => {
      const next = { ...prev, commercial: { ...prev.commercial } };
      next.commercial.additionalCharges = [
        ...(prev.commercial.additionalCharges || []),
        { name: '', rate: '', quantity: '', total: '' },
      ];
      return next;
    });
  }, []);

  const removeChargeRow = useCallback((index) => {
    setForm((prev) => {
      const next = { ...prev, commercial: { ...prev.commercial } };
      next.commercial.additionalCharges = prev.commercial.additionalCharges.filter((_, i) => i !== index);
      if (next.commercial.additionalCharges.length === 0) {
        next.commercial.additionalCharges = [{ name: '', rate: '', quantity: '', total: '' }];
      }
      return next;
    });
  }, []);

  const updateChargeRow = useCallback((index, key, value) => {
    setForm((prev) => {
      const next = { ...prev, commercial: { ...prev.commercial } };
      const rows = [...(next.commercial.additionalCharges || [])];
      rows[index] = { ...rows[index], [key]: value };
      next.commercial.additionalCharges = rows;
      return next;
    });
  }, []);

  const selectedClient = useMemo(
    () => lookups.clients.find((c) => c.client_id == selectedClientId),
    [lookups.clients, selectedClientId]
  );

  // ── Validation ────────────────────────────────────────────────────
  const validate = useCallback(() => {
    const errors = {};
    const f = form;
    if (!f.pickup.location.trim()) errors.pickupLocation = 'Pickup location is required';
    if (!f.pickup.city.trim()) errors.pickupCity = 'Pickup city is required';
    if (!f.drop.location.trim()) errors.dropLocation = 'Drop location is required';
    if (!f.drop.city.trim()) errors.dropCity = 'Drop city is required';
    if (!f.goods.description.trim()) errors.goodsDescription = 'Goods description is required';
    if (!f.vehicle.type.trim()) errors.vehicleType = 'Vehicle type is required';
    if (!f.vehicle.tripDate) errors.tripDate = 'Trip date is required';
    if (!f.commercial.rateType) errors.rateType = 'Rate type is required';
    if (!f.commercial.rateAsPer) errors.rateAsPer = 'Rate as per is required';
    if (num(f.commercial.rate) === 0 && !f.commercial.rate) errors.rate = 'Rate is required';
    if (num(f.commercial.freightAmount) === 0 && !f.commercial.freightAmount) {
      errors.freightAmount = 'Freight amount is required';
    }
    if (num(f.commercial.totalBillingAmount) === 0 && !f.commercial.totalBillingAmount) {
      errors.totalBillingAmount = 'Total billing amount is required';
    }
    if (f.customer.mode === 'new') {
      const nc = f.customer.newClient;
      if (!nc.companyName?.trim()) errors.newCompanyName = 'Customer company name is required';
      if (!nc.contactPerson?.trim()) errors.newContactPerson = 'Contact person is required';
      if (!nc.phone?.trim()) errors.newPhone = 'Phone number is required';
    } else if (!selectedClientId) {
      errors.customer = 'Select an existing customer or add a new one';
    }
    if (f.operational.podRequired === undefined || f.operational.podRequired === null) {
      errors.podRequired = 'POD requirement must be specified';
    }
    return errors;
  }, [form, selectedClientId, customerMode]);

  // ── Submit ────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setSubmitError('Please fix the highlighted fields.');
      return;
    }

    const STORAGE_KEY = 'bt_admin_manual_order_idempotency_key';
    let idempotencyKey = null;
    
    // Try to restore from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && typeof stored === 'string' && stored.startsWith('manual-')) {
        const parts = stored.split('-');
        if (parts.length === 3 && parts[2].length >= 15) {
          idempotencyKey = stored;
        }
      }
    } catch {
      // localStorage unavailable
    }
    
    // Generate new key if not restored
    if (!idempotencyKey) {
      const timestamp = Date.now();
      const randomBytes = new Uint8Array(11);
      crypto.getRandomValues(randomBytes);
      const randomPart = Array.from(randomBytes)
        .map(b => b.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 15);
      idempotencyKey = `manual-${timestamp}-${randomPart}`;
    }
    
    // Persist immediately
    try {
      localStorage.setItem(STORAGE_KEY, idempotencyKey);
    } catch {
      // Ignore storage errors
    }

    const clearIdempotencyKey = () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore storage errors
      }
    };

    const payload = {
      idempotency_key: idempotencyKey,
      orderInfo: {
        orderDate: form.orderInfo.orderDate,
        branch: form.orderInfo.branch || null,
      },
      customer: {
        clientId: form.customer.mode === 'existing' ? selectedClientId || null : null,
        newClient:
          form.customer.mode === 'new'
            ? {
                companyName: form.customer.newClient.companyName,
                contactPerson: form.customer.newClient.contactPerson,
                phone: form.customer.newClient.phone,
                alternateMobile: form.customer.newClient.alternateMobile || null,
                email: form.customer.newClient.email || null,
                address: form.customer.newClient.address || null,
                city: form.customer.newClient.city || null,
                state: form.customer.newClient.state || 'Bihar',
                gstNumber: form.customer.newClient.gstNumber || null,
                panNumber: form.customer.newClient.panNumber || null,
              }
            : null,
      },
      pickup: {
        location: form.pickup.location,
        address: form.pickup.address || null,
        city: form.pickup.city,
        state: form.pickup.state || 'Bihar',
        pincode: form.pickup.pincode || null,
        contactPerson: form.pickup.contactPerson || null,
        contactNumber: form.pickup.contactNumber || null,
      },
      drop: {
        location: form.drop.location,
        address: form.drop.address || null,
        city: form.drop.city,
        state: form.drop.state || 'Bihar',
        pincode: form.drop.pincode || null,
        contactPerson: form.drop.contactPerson || null,
        contactNumber: form.drop.contactNumber || null,
      },
      distance_km: form.distanceKm ? num(form.distanceKm) : null,
      tripType: form.tripType,
      goods: {
        description: form.goods.description,
        category: form.goods.category || null,
        quantity: form.goods.quantity ? num(form.goods.quantity) : 1,
        quantityUnit: form.goods.quantityUnit || null,
        weight: form.goods.weight ? num(form.goods.weight) : null,
        weightUnit: form.goods.weightUnit || null,
        packageType: form.goods.packageType || null,
        specialInstructions: form.goods.specialInstructions || null,
        value: form.goods.value ? num(form.goods.value) : null,
      },
      vehicle: {
        type: form.vehicle.type,
        size: form.vehicle.size || null,
        requiredQuantity: form.vehicle.requiredQuantity || 1,
        tripDate: form.vehicle.tripDate || null,
        expectedDeliveryDate: form.vehicle.expectedDeliveryDate || null,
        specialRequirements: form.vehicle.specialRequirements || null,
        remarks: form.vehicle.remarks || null,
      },
      commercial: {
        rateType: form.commercial.rateType,
        rateAsPer: form.commercial.rateAsPer,
        rate: num(form.commercial.rate),
        freightAmount: num(form.commercial.freightAmount),
        gstType: form.commercial.gstType,
        gstPercentage: num(form.commercial.gstPercentage),
        gstAmount: num(gstAmount),
        additionalCharges: additionalCharges.map((c) => ({
          name: c.name,
          rate: num(c.rate),
          quantity: num(c.quantity),
          total: num(c.total),
        })),
        additionalChargesTax: num(form.commercial.additionalChargesTax),
        totalBillingAmount: num(form.commercial.totalBillingAmount) || num(totalBillingAmount),
        paymentTerms: form.commercial.paymentTerms || null,
        paymentRemarks: form.commercial.paymentRemarks || null,
      },
      operational: {
        podRequired: form.operational.podRequired === true,
        partyInvoiceRequired: form.operational.partyInvoiceRequired || 'to_be_confirmed',
        ewayBillRequired: form.operational.ewayBillRequired || 'to_be_confirmed',
        lrGrRequired: form.operational.lrGrRequired || 'to_be_confirmed',
        specialDocuments: form.operational.specialDocuments || null,
        remarks: form.operational.remarks || null,
      },
    };

    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await adminAPI.createManualOrder(payload);
      const data = res.data;
      if (res.status === 200 && data.data && data.data.idempotent) {
        clearIdempotencyKey();
        setSubmitError(null);
        setStep('success');
        setSubmitting(false);
        onSuccess?.({ ...data.data.booking, ...data.data.trip, idempotent: true });
        return;
      }
      if (!res.data || !res.data.success) {
        throw new Error(res.data?.message || 'Order creation failed');
      }
      clearIdempotencyKey();
      setSubmitting(false);
      setStep('success');
      onSuccess?.(data.data);
    } catch (err) {
      setSubmitting(false);
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        'Failed to create order. Please try again.';
      setSubmitError(msg);
    }
  }, [
    form, validate, selectedClientId, additionalCharges, gstAmount, totalBillingAmount,
    suggestedFreight, onSuccess,
  ]);

  const handleCreateConfirmed = useCallback(() => {
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setSubmitError('Please fix the highlighted fields.');
      return;
    }
    setStep('confirm');
    setSubmitError(null);
  }, [form, validate]);

  const handleCancelConfirm = useCallback(() => setStep('form'), []);

  const handleReset = useCallback(() => {
    clearIdempotencyKey();
    setForm({
      orderInfo: { orderDate: new Date().toISOString().split('T')[0], branch: '' },
      customer: { mode: 'existing', clientId: '', newClient: {} },
      pickup: { location: '', address: '', city: '', state: 'Bihar', pincode: '', contactPerson: '', contactNumber: '' },
      drop: { location: '', address: '', city: '', state: 'Bihar', pincode: '', contactPerson: '', contactNumber: '' },
      tripType: 'One Way',
      distanceKm: '',
      goods: { description: '', category: '', quantity: '', quantityUnit: 'Pieces', weight: '', weightUnit: 'Tons', packageType: '', specialInstructions: '', value: '' },
      vehicle: { type: '', size: '', requiredQuantity: 1, tripDate: '', expectedDeliveryDate: '', specialRequirements: '', remarks: '' },
      commercial: {
        rateType: 'per_trip', rateAsPer: 'per_trip', rate: '', freightAmount: '',
        gstType: 'FORWARD_CHARGE', gstPercentage: '', gstAmount: '',
        additionalCharges: [{ name: '', rate: '', quantity: '', total: '' }],
        additionalChargesTax: '', totalBillingAmount: '',
        paymentTerms: '', paymentRemarks: '',
      },
      operational: { podRequired: false, partyInvoiceRequired: 'to_be_confirmed', ewayBillRequired: 'to_be_confirmed', lrGrRequired: 'to_be_confirmed', specialDocuments: '', remarks: '' },
    });
    setSelectedClientId(null);
    setCustomerSearch('');
    setStep('form');
    setSubmitError(null);
  }, []);

  // ── Vehicle types distinct list ───────────────────────────────────
  const vehicleTypes = useMemo(
    () => [...new Set((lookups.vehicles || []).map((v) => v.vehicle_type).filter(Boolean))],
    [lookups.vehicles]
  );

  if (step === 'success') {
    return (
      <AdminModal open={true} onClose={onClose} title="Order Created" icon={CheckCircle} size="md">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="h-8 w-8 text-emerald-600" aria-hidden="true" />
            <div>
              <h3 className="font-bold text-navy">Manual order created</h3>
              <p className="text-sm text-slate-600">The order has been saved and appears in Order / Trip Master and Vehicle Hire.</p>
            </div>
          </div>
          <footer className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>Done</Button>
          </footer>
        </div>
      </AdminModal>
    );
  }

  return (
    <AdminModal open={open} onClose={onClose} title="Create Manual Order" icon={Plus} size="xl" closeOnBackdrop={false}>
      <div className="space-y-1">
        {submitError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{submitError}</div>
        )}
        {lookupsError && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700 mb-3">{lookupsError}</div>
        )}

        {/* SECTION A — ORDER INFORMATION */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <User className="h-4 w-4" aria-hidden="true" /> A. Order Information
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Order Date</label>
              <input
                type="date"
                value={form.orderInfo.orderDate}
                onChange={(e) => setField('orderInfo', 'orderDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Order Source</label>
              <input type="text" value="Manual" readOnly className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Order Type</label>
              <input type="text" value="Manual Order" readOnly className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Branch / Location</label>
              <input
                value={form.orderInfo.branch}
                onChange={(e) => setField('orderInfo', 'branch', e.target.value)}
                placeholder="e.g. Begusarai"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </div>
          </div>
        </section>

        {/* SECTION B — CUSTOMER INFORMATION */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <Building2 className="h-4 w-4" aria-hidden="true" /> B. Customer Information
          </h3>
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => setCustomerMode('existing')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${customerMode === 'existing' ? 'bg-[#15345B] text-white border-[#15345B]' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              Select Existing Customer
            </button>
            <button
              onClick={() => setCustomerMode('new')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${customerMode === 'new' ? 'bg-[#15345B] text-white border-[#15345B]' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
            >
              + Add New Customer
            </button>
          </div>

          {customerMode === 'existing' ? (
            <>
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search by name, mobile, company or client code…"
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </div>
              {lookupsLoading ? (
                <div className="text-sm text-slate-500">Loading customers…</div>
              ) : lookupsError ? (
                <div className="text-sm text-amber-600">Unable to load customers — database temporarily unavailable.</div>
              ) : filteredClients.length === 0 ? (
                <div className="text-sm text-slate-500">No matching customers.</div>
              ) : (
                <div className="space-y-1">
                  {filteredClients.slice(0, 20).map((c) => (
                    <button
                      key={c.client_id}
                      onClick={() => setSelectedClientId(c.client_id)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border text-sm transition ${selectedClientId == c.client_id ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-white border-slate-200 hover:bg-slate-50'}`}
                    >
                      <div className="font-medium text-slate-800">{c.company_name}</div>
                      <div className="text-xs text-slate-500">
                        {c.contact_person} • {c.phone} {c.client_code ? `• ${c.client_code}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {selectedClient && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-xs font-semibold uppercase text-slate-500 mb-1">Selected customer</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                    <div><span className="text-slate-500 text-xs block">Name</span>{selectedClient.company_name}</div>
                    <div><span className="text-slate-500 text-xs block">Contact</span>{selectedClient.contact_person}</div>
                    <div><span className="text-slate-500 text-xs block">Mobile</span>{selectedClient.phone}</div>
                    <div><span className="text-slate-500 text-xs block">GSTIN</span>{selectedClient.gst_number || '—'}</div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <FormField label="Customer / Company Name *" required>
                <input
                  value={form.customer.newClient.companyName || ''}
                  onChange={(e) => setNested('customer', 'newClient', 'companyName', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <FormField label="Contact Person *" required>
                  <input
                    value={form.customer.newClient.contactPerson || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'contactPerson', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
                <FormField label="Mobile Number *" required>
                  <input
                    type="tel"
                    value={form.customer.newClient.phone || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'phone', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
                <FormField label="Alternate Mobile">
                  <input
                    type="tel"
                    value={form.customer.newClient.alternateMobile || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'alternateMobile', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <FormField label="Email">
                  <input
                    type="email"
                    value={form.customer.newClient.email || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'email', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
                <FormField label="City">
                  <input
                    value={form.customer.newClient.city || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'city', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
                <FormField label="State">
                  <input
                    value={form.customer.newClient.state || 'Bihar'}
                    onChange={(e) => setNested('customer', 'newClient', 'state', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
              </div>
              <FormField label="Billing Address">
                <input
                  value={form.customer.newClient.address || ''}
                  onChange={(e) => setNested('customer', 'newClient', 'address', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
              <div className="grid grid-cols-2 gap-3">
                <FormField label="GSTIN">
                  <input
                    value={form.customer.newClient.gstNumber || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'gstNumber', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
                <FormField label="PAN">
                  <input
                    value={form.customer.newClient.panNumber || ''}
                    onChange={(e) => setNested('customer', 'newClient', 'panNumber', e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </FormField>
              </div>
              {selectedClientId && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  A customer with this phone already exists — select them instead to avoid a duplicate record.
                </div>
              )}
            </>
          )}
        </section>

        {/* SECTION C — PICKUP AND DELIVERY */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <MapPin className="h-4 w-4" aria-hidden="true" /> C. Pickup &amp; Delivery Details
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <FormField label="Pickup Location *">
                <input
                  value={form.pickup.location}
                  onChange={(e) => setNested('pickup', 'location', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FormField label="Pickup City *">
                <input
                  value={form.pickup.city}
                  onChange={(e) => setNested('pickup', 'city', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div>
              <FormField label="Pickup Full Address">
                <input
                  value={form.pickup.address}
                  onChange={(e) => setNested('pickup', 'address', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div>
              <FormField label="Pickup Pincode">
                <input
                  value={form.pickup.pincode}
                  onChange={(e) => setNested('pickup', 'pincode', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FormField label="Drop Location *">
                <input
                  value={form.drop.location}
                  onChange={(e) => setNested('drop', 'location', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FormField label="Drop City *">
                <input
                  value={form.drop.city}
                  onChange={(e) => setNested('drop', 'city', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div>
              <FormField label="Drop Full Address">
                <input
                  value={form.drop.address}
                  onChange={(e) => setNested('drop', 'address', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <div>
              <FormField label="Drop Pincode">
                <input
                  value={form.drop.pincode}
                  onChange={(e) => setNested('drop', 'pincode', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <FormField label="Pickup Contact Person">
              <input
                value={form.pickup.contactPerson}
                onChange={(e) => setNested('pickup', 'contactPerson', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Pickup Contact Number">
              <input
                type="tel"
                value={form.pickup.contactNumber}
                onChange={(e) => setNested('pickup', 'contactNumber', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Drop Contact Person">
              <input
                value={form.drop.contactPerson}
                onChange={(e) => setNested('drop', 'contactPerson', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Drop Contact Number">
              <input
                type="tel"
                value={form.drop.contactNumber}
                onChange={(e) => setNested('drop', 'contactNumber', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Trip Type</label>
              <select
                value={form.tripType}
                onChange={(e) => setForm((prev) => ({ ...prev, tripType: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="One Way">One Way</option>
                <option value="Two Way">Two Way</option>
              </select>
            </div>
            <FormField label="Distance (KM)">
              <input
                type="number"
                value={form.distanceKm}
                onChange={(e) => setForm((prev) => ({ ...prev, distanceKm: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>
        </section>

        {/* SECTION D — GOODS */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <Package className="h-4 w-4" aria-hidden="true" /> D. Goods Information
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 sm:col-span-2">
              <FormField label="Goods Name / Description *">
                <input
                  value={form.goods.description}
                  onChange={(e) => setNested('goods', 'description', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                />
              </FormField>
            </div>
            <FormField label="Goods Category">
              <input
                value={form.goods.category}
                onChange={(e) => setNested('goods', 'category', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Quantity">
              <input
                type="number"
                value={form.goods.quantity}
                onChange={(e) => setNested('goods', 'quantity', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Quantity Unit">
              <select
                value={form.goods.quantityUnit}
                onChange={(e) => setNested('goods', 'quantityUnit', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="Pieces">Pieces</option>
                <option value="Tons">Tons</option>
                <option value="Kilograms">Kilograms</option>
                <option value="Bags">Bags</option>
                <option value="Bundles">Bundles</option>
              </select>
            </FormField>
            <FormField label="Approx. Weight">
              <input
                type="number"
                value={form.goods.weight}
                onChange={(e) => setNested('goods', 'weight', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Weight Unit">
              <select
                value={form.goods.weightUnit}
                onChange={(e) => setNested('goods', 'weightUnit', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="Tons">Tons</option>
                <option value="Kilograms">Kilograms</option>
                <option value="Quintals">Quintals</option>
              </select>
            </FormField>
            <FormField label="Package Type">
              <input
                value={form.goods.packageType}
                onChange={(e) => setNested('goods', 'packageType', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Goods Value (₹)">
              <input
                type="number"
                value={form.goods.value}
                onChange={(e) => setNested('goods', 'value', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>
          <FormField label="Special Handling Instructions">
            <textarea
              rows={2}
              value={form.goods.specialInstructions}
              onChange={(e) => setNested('goods', 'specialInstructions', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
            />
          </FormField>
        </section>

        {/* SECTION E — VEHICLE REQUIREMENT */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <Truck className="h-4 w-4" aria-hidden="true" /> E. Vehicle Requirement
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Vehicle Type</label>
              <div className="relative">
                <select
                  value={form.vehicle.type}
                  onChange={(e) => setNested('vehicle', 'type', e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
                >
                  <option value="">Select vehicle type</option>
                  {vehicleTypes.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" aria-hidden="true" />
              </div>
              {vehicleTypes.length === 0 && lookups.vehicles.length > 0 && (
                <p className="text-xs text-slate-400 mt-1">No vehicle types in fleet master.</p>
              )}
            </div>
            <FormField label="Vehicle Size">
              <input
                value={form.vehicle.size}
                onChange={(e) => setNested('vehicle', 'size', e.target.value)}
                placeholder="e.g. 22 ft"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Quantity">
              <input
                type="number"
                value={form.vehicle.requiredQuantity}
                onChange={(e) => setNested('vehicle', 'requiredQuantity', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Trip Date *">
              <input
                type="date"
                value={form.vehicle.tripDate}
                onChange={(e) => setNested('vehicle', 'tripDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Expected Delivery Date">
              <input
                type="date"
                value={form.vehicle.expectedDeliveryDate}
                onChange={(e) => setNested('vehicle', 'expectedDeliveryDate', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Special Vehicle Requirements">
              <input
                value={form.vehicle.specialRequirements}
                onChange={(e) => setNested('vehicle', 'specialRequirements', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>
          <FormField label="Remarks">
            <input
              value={form.vehicle.remarks}
              onChange={(e) => setNested('vehicle', 'remarks', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
            />
          </FormField>
          <p className="mt-2 text-xs text-slate-500">
            Vehicle assignment is optional at order creation. If no vehicle is assigned, the order status is
            <span className="font-semibold">ORDER CONFIRMED / VEHICLE PENDING</span> and it appears in Vehicle Hire
            waiting for vehicle assignment. No fake vehicle or driver is created.
          </p>
        </section>

        {/* SECTION F — COMMERCIAL */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <CreditCard className="h-4 w-4" aria-hidden="true" /> F. Customer Freight &amp; Commercial Details
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="Rate Type">
              <select
                value={form.commercial.rateType}
                onChange={(e) => setNested('commercial', 'rateType', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="per_trip">Per Trip</option>
                <option value="per_ton">Per Ton</option>
                <option value="per_km">Per KM</option>
                <option value="fixed">Fixed Freight</option>
              </select>
            </FormField>
            <FormField label="Rate As Per">
              <select
                value={form.commercial.rateAsPer}
                onChange={(e) => setNested('commercial', 'rateAsPer', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                {RATE_AS_PER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Rate (₹)">
              <input
                type="number"
                value={form.commercial.rate}
                onChange={(e) => {
                  setNested('commercial', 'rate', e.target.value);
                  if (!form.commercial.freightAmount) {
                    setNested('commercial', 'freightAmount', String(num(suggestedFreight)));
                    setNested('commercial', 'totalBillingAmount', String(num(suggestedFreight)));
                  }
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="Freight Amount (₹)">
              <input
                type="number"
                value={form.commercial.freightAmount}
                onChange={(e) => {
                  setNested('commercial', 'freightAmount', e.target.value);
                  setNested('commercial', 'totalBillingAmount', String(num(totalBillingAmount)));
                }}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <FormField label="GST Type">
              <select
                value={form.commercial.gstType}
                onChange={(e) => setNested('commercial', 'gstType', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                {GST_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="GST %">
              <input
                type="number"
                value={form.commercial.gstPercentage}
                onChange={(e) => setNested('commercial', 'gstPercentage', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <FormField label="GST Amount (₹)">
              <input
                type="number"
                value={num(gstAmount).toFixed(2)}
                readOnly
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-slate-50"
              />
            </FormField>
            <FormField label="Additional Charges Tax (₹)">
              <input
                type="number"
                value={form.commercial.additionalChargesTax}
                onChange={(e) => setNested('commercial', 'additionalChargesTax', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>

          <div className="mt-3">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Additional Charges</label>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase text-slate-400">Charge Name</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-slate-400">Rate (₹)</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-slate-400">Qty</th>
                    <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase text-slate-400">Total (₹)</th>
                    <th className="px-3 py-2 text-center text-[11px] font-semibold uppercase text-slate-400"> </th>
                  </tr>
                </thead>
                <tbody>
                  {additionalCharges.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <input
                          value={c.name}
                          onChange={(e) => updateChargeRow(i, 'name', e.target.value)}
                          className="w-full px-2 py-1 border-transparent focus:ring-0 bg-transparent text-sm"
                          placeholder="Charge name"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={c.rate}
                          onChange={(e) => updateChargeRow(i, 'rate', e.target.value)}
                          className="w-full px-2 py-1 border-transparent focus:ring-0 bg-transparent text-sm text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={c.quantity}
                          onChange={(e) => updateChargeRow(i, 'quantity', e.target.value)}
                          className="w-full px-2 py-1 border-transparent focus:ring-0 bg-transparent text-sm text-right"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{currency(c.total)}</td>
                      <td className="px-3 py-2 text-center">
                        {additionalCharges.length > 1 ? (
                          <button
                            onClick={() => removeChargeRow(i)}
                            className="text-slate-400 hover:text-red-500"
                            aria-label="Remove charge"
                          >
                            ×
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {additionalCharges.length < 5 && (
                <button
                  onClick={addChargeRow}
                  className="w-full mt-2 px-3 py-2 text-xs font-semibold text-amber-600 hover:bg-amber-50 rounded-lg border border-amber-100"
                >
                + Add charge row
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="col-span-2 sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Payment Terms</label>
              <select
                value={form.commercial.paymentTerms}
                onChange={(e) => setNested('commercial', 'paymentTerms', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="">Not finalized</option>
                {PAYMENT_TERMS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <FormField label="Total Billing Amount (₹)">
              <input
                type="number"
                value={form.commercial.totalBillingAmount || totalBillingAmount}
                onChange={(e) => setNested('commercial', 'totalBillingAmount', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs font-semibold text-slate-500 mb-1">Computed Total</label>
              <div className="px-3 py-2 border border-slate-300 rounded-lg text-sm font-bold text-slate-800 bg-slate-50">
                {currency(totalBillingAmount)}
              </div>
            </div>
            <FormField label="Payment Remarks">
              <input
                value={form.commercial.paymentRemarks}
                onChange={(e) => setNested('commercial', 'paymentRemarks', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
              />
            </FormField>
          </div>
        </section>

        {/* SECTION G — OPERATIONAL */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <FileText className="h-4 w-4" aria-hidden="true" /> G. Operational Requirements
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">POD Required?</label>
              <select
                value={form.operational.podRequired ? 'yes' : 'no'}
                onChange={(e) => setNested('operational', 'podRequired', e.target.value === 'yes')}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
              <p className="text-xs text-slate-400 mt-1">
                If Yes: Delivered → POD Pending → POD Received → Completed. If No: Delivered → Completed.
              </p>
            </div>
            <FormField label="Party Invoice Required">
              <select
                value={form.operational.partyInvoiceRequired}
                onChange={(e) => setNested('operational', 'partyInvoiceRequired', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                {YES_NO_TBC.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="E-Way Bill Required">
              <select
                value={form.operational.ewayBillRequired}
                onChange={(e) => setNested('operational', 'ewayBillRequired', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                {YES_NO_TBC.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
            <FormField label="LR/GR Required">
              <select
                value={form.operational.lrGrRequired}
                onChange={(e) => setNested('operational', 'lrGrRequired', e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none bg-white"
              >
                {YES_NO_TBC.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </FormField>
          </div>
          <FormField label="Special Documents">
            <input
              value={form.operational.specialDocuments}
              onChange={(e) => setNested('operational', 'specialDocuments', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
            />
          </FormField>
          <FormField label="Operational Remarks">
            <textarea
              rows={2}
              value={form.operational.remarks}
              onChange={(e) => setNested('operational', 'remarks', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-200 outline-none"
            />
          </FormField>
        </section>

        {/* SECTION H — FINAL REVIEW */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 mb-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
            <Save className="h-4 w-4" aria-hidden="true" /> H. Final Review
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><span className="text-slate-500 text-xs block">Customer</span>{form.customer.mode === 'existing' && selectedClient ? selectedClient.company_name : form.customer.newClient.companyName || '—'}</div>
            <div><span className="text-slate-500 text-xs block">Mobile</span>{form.customer.mode === 'existing' && selectedClient ? selectedClient.phone : form.customer.newClient.phone || '—'}</div>
            <div><span className="text-slate-500 text-xs block">Pickup</span>{form.pickup.location}, {form.pickup.city}</div>
            <div><span className="text-slate-500 text-xs block">Drop</span>{form.drop.location}, {form.drop.city}</div>
            <div><span className="text-slate-500 text-xs block">Goods</span>{form.goods.description}</div>
            <div><span className="text-slate-500 text-xs block">Qty / Weight</span>{form.goods.quantity} {form.goods.quantityUnit} · {form.goods.weight} {form.goods.weightUnit}</div>
            <div><span className="text-slate-500 text-xs block">Vehicle</span>{form.vehicle.type}</div>
            <div><span className="text-slate-500 text-xs block">Trip Date</span>{form.vehicle.tripDate || '—'}</div>
            <div><span className="text-slate-500 text-xs block">Freight</span>{currency(form.commercial.freightAmount)}</div>
            <div><span className="text-slate-500 text-xs block">GST</span>{currency(gstAmount)}</div>
            <div><span className="text-slate-500 text-xs block">Addl. Charges</span>{currency(additionalChargesTotal)}</div>
            <div className="col-span-2 sm:col-span-1"><span className="text-slate-500 text-xs block">Total Billing</span>{currency(num(form.commercial.totalBillingAmount) || num(totalBillingAmount))}</div>
            <div><span className="text-slate-500 text-xs block">POD</span>{form.operational.podRequired ? 'Yes' : 'No'}</div>
            <div><span className="text-slate-500 text-xs block">Payment Terms</span>{form.commercial.paymentTerms || 'Not finalized'}</div>
          </div>
        </section>

        <footer className="flex flex-wrap justify-end gap-2 pt-4 border-t border-slate-200">
          <Button variant="secondary" onClick={handleReset} disabled={submitting}>
            Reset
          </Button>
          {step === 'form' ? (
            <Button variant="primary" onClick={handleCreateConfirmed} disabled={submitting} loading={submitting}>
              Create Confirmed Order
            </Button>
          ) : (
            <>
              <Button variant="secondary" onClick={handleCancelConfirm} disabled={submitting}>
                Back to Form
              </Button>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                Confirm creating order for{' '}
                <span className="font-bold">{form.customer.mode === 'existing' && selectedClient ? selectedClient.company_name : form.customer.newClient.companyName}</span>{' '}
                — {currency(num(form.commercial.totalBillingAmount) || num(totalBillingAmount))}. Status will be ORDER CONFIRMED / VEHICLE PENDING.
              </div>
              <Button variant="primary" onClick={handleSubmit} disabled={submitting} loading={submitting}>
                Yes, Create Order
              </Button>
            </>
          )}
        </footer>
      </div>
    </AdminModal>
  );
}

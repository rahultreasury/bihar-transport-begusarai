import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import OwnerRegistrationSection from '../components/admin-premium/transport/OwnerRegistrationSection';
import DriverRegistrationSection from '../components/admin-premium/transport/DriverRegistrationSection';
import VehicleRegistrationSection from '../components/admin-premium/transport/VehicleRegistrationSection';

/**
 * AdminRegisterResources
 * ---------------------------------------------------------------------------
 * A dedicated, full-width registration workspace for Transport Owner, Driver
 * and Vehicle. It is a real route (/admin/drivers/register-resources), not a
 * modal — there is no dimmed dashboard behind it.
 *
 * Scrolling model: ONE natural document scroll. The compact page header and
 * the slim progress stepper scroll up and out of view with the page; only the
 * global app header (AdminShell) and the compact bottom action bar stay put.
 * There is no fixed-height workspace and no nested scroll container.
 *
 * Workflow:  Select Resources  →  Enter Details  →  Review & Save
 *
 * All three resources persist through the single atomic combined endpoint
 * (POST /admin/transport-resources). The existing profile-based modal
 * (TransportResourceRegistrationModal) is intentionally left untouched so the
 * Owner/Vehicle profile flows keep working.
 */

const REGISTER_ROUTE = '/admin/drivers/register-resources';
const DRIVERS_ROUTE = '/admin/drivers';

// Same nav model the Drivers page uses, so the drawer + active state stay
// consistent with where the operator came from.
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' },
];

const STEPS = [
  { key: 'select', label: 'Select Resources' },
  { key: 'details', label: 'Enter Details' },
  { key: 'review', label: 'Review & Save' },
];

const RESOURCE_TYPES = [
  { key: 'owner', label: 'Transport Owner', description: 'A transport company or individual fleet owner', accent: 'amber', Icon: BuildingIcon },
  { key: 'driver', label: 'Driver', description: 'A driver with licence and contact details', accent: 'navy', Icon: DriverIcon },
  { key: 'vehicle', label: 'Vehicle', description: 'A truck or pickup with its documents', accent: 'teal', Icon: TruckIcon },
];

const RESOURCE_LABEL = { owner: 'Transport Owner', driver: 'Driver', vehicle: 'Vehicle' };

const INITIAL_FORM = { owner: {}, driver: {}, vehicle: {} };
const EMPTY_ERRORS = { owner: {}, driver: {}, vehicle: {} };

/* ────────────────────────────── Icons ────────────────────────────── */
function BuildingIcon({ className = 'w-6 h-6' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1m-1 4h1m4-4h1m-1 4h1M9 21v-4h6v4" /></svg>);
}
function DriverIcon({ className = 'w-6 h-6' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5.5 15a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM14 6.5A3.75 3.75 0 1021 8.6M3.2 20a5.2 5.2 0 0110.4 0M15 13h5a1 1 0 011 1v5a1 1 0 01-1 1h-5v-7z" /></svg>);
}
function TruckIcon({ className = 'w-6 h-6' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M2 7h11v9H2zM13 10h4l3 3v3h-7v-6zM5.5 19a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5zM17.5 19a1.75 1.75 0 100-3.5 1.75 1.75 0 000 3.5z" /></svg>);
}
function CheckIcon({ className = 'w-4 h-4' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={2.6} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>);
}
function AlertIcon({ className = 'w-4 h-4' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M10.3 3.9L2.6 17a1.5 1.5 0 001.3 2.3h16.2A1.5 1.5 0 0021.4 17L13.7 3.9a1.5 1.5 0 00-2.6 0z" /></svg>);
}
function ArrowLeftIcon({ className = 'w-4 h-4' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7 7-7m-7 7h18" /></svg>);
}
function ArrowRightIcon({ className = 'w-4 h-4' }) {
  return (<svg className={className} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7-7 7m7-7H3" /></svg>);
}
function Spinner({ className = 'w-4 h-4' }) {
  return (<svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>);
}

/* ──────────────────────────── Helpers ──────────────────────────── */
const digits = (v) => (v || '').replace(/\D/g, '');
const isTenDigitMobile = (v) => /^[6-9]\d{9}$/.test(digits(v));
const hasAny = (obj) => Object.values(obj || {}).some((v) => v && String(v).trim() !== '');

export default function AdminRegisterResources() {
  const navigate = useNavigate();
  const location = useLocation();

  const [selectedResources, setSelectedResources] = useState({ owner: false, driver: false, vehicle: false });
  const [step, setStep] = useState('select'); // select | details | review | success
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [createdEntities, setCreatedEntities] = useState({});
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [errors, setErrors] = useState(EMPTY_ERRORS);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [toast, setToast] = useState(null);
  const [ownersMap, setOwnersMap] = useState({});
  const [driversMap, setDriversMap] = useState({});

  // Synchronous access to the latest form data (avoids React 18 batching
  // stale reads inside validation and submit).
  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);

  const submitLockRef = useRef(false);
  const reviewDataLoadedRef = useRef(false);

  const context = useMemo(() => location.state?.context || {}, [location.state]);

  // Where Cancel / Done should return the operator — the page they launched
  // registration from. Falls back to Drivers when there is no source.
  const homeRoute = useMemo(() => {
    switch (context.sourcePage) {
      case 'vehicles': return '/admin/vehicles';
      case 'owners': return '/admin/vehicle-owners';
      default: return DRIVERS_ROUTE;
    }
  }, [context.sourcePage]);

  // Initialise selection from context on the select step.
  useEffect(() => {
    if (step !== 'select') return;
    const initial = { owner: false, driver: false, vehicle: false };
    if (context.resourceType) initial[context.resourceType] = true;
    else {
      if (context.ownerId) initial.owner = true;
      if (context.driverId) initial.driver = true;
      if (context.vehicleId) initial.vehicle = true;
    }
    setSelectedResources(initial);
    setFormData(INITIAL_FORM);
    setErrors(EMPTY_ERRORS);
    setServerError(null);
    setCreatedEntities({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  const selectedList = useMemo(() => RESOURCE_TYPES.filter((r) => selectedResources[r.key]), [selectedResources]);
  const selectedCount = selectedList.length;

  const hasUnsavedChanges = useMemo(() => {
    if (step === 'success') return false;
    return Object.values(formData).some((section) => hasAny(section));
  }, [formData, step]);

  /* ─────────────────────────── Validation ─────────────────────────── */
  const computeErrors = useCallback(() => {
    const fd = formDataRef.current;
    const next = { owner: {}, driver: {}, vehicle: {} };

    if (selectedResources.owner) {
      const o = fd.owner || {};
      if (!o.owner_name?.trim()) next.owner.owner_name = 'Owner name is required';
      if (!digits(o.phone)) next.owner.phone = 'Phone number is required';
      else if (!isTenDigitMobile(o.phone)) next.owner.phone = 'Enter a valid 10-digit phone number';
      if (!o.city?.trim()) next.owner.city = 'City is required';
      const commission = parseFloat(o.commission_percentage);
      if (isNaN(commission) || commission < 0 || commission > 100) next.owner.commission_percentage = 'Commission must be between 0 and 100';
    }

    if (selectedResources.driver) {
      const d = fd.driver || {};
      if (!d.driver_name?.trim()) next.driver.driver_name = 'Driver name is required';
      if (!digits(d.mobile)) next.driver.mobile = 'Mobile number is required';
      else if (!isTenDigitMobile(d.mobile)) next.driver.mobile = 'Enter a valid 10-digit mobile number';
      if (!d.license_number?.trim()) next.driver.license_number = 'Licence number is required';
      // A driver must belong to a Transport Owner. When an owner is created in
      // this same workflow the backend links them automatically; otherwise the
      // operator must pick an existing owner or mark the driver as self-owner.
      if (!selectedResources.owner && !d.is_self_owner && !d.transport_owner_id) {
        next.driver.transport_owner_id = 'Select a transport owner or mark the driver as a self owner';
      }
    }

    if (selectedResources.vehicle) {
      const v = fd.vehicle || {};
      if (!v.vehicle_number?.trim()) next.vehicle.vehicle_number = 'Vehicle number is required';
      else if (!/^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/i.test(v.vehicle_number.replace(/[^A-Za-z0-9]/g, ''))) next.vehicle.vehicle_number = 'Enter a valid vehicle number (e.g. BR09AB1234)';
      if (!v.vehicle_type?.trim()) next.vehicle.vehicle_type = 'Vehicle type is required';
      if (!v.vehicle_name?.trim()) next.vehicle.vehicle_name = 'Vehicle name is required';
      if (!v.current_status) next.vehicle.current_status = 'Status is required';
    }

    return next;
  }, [selectedResources]);

  const detailsAreValid = useCallback(() => {
    const next = computeErrors();
    return !hasAny(next.owner) && !hasAny(next.driver) && !hasAny(next.vehicle);
  }, [computeErrors]);

  /* ─────────────────────────── Navigation ─────────────────────────── */
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  const stepAccessible = useCallback((key) => {
    if (key === 'select') return true;
    if (key === 'details') return selectedCount > 0;
    if (key === 'review') return selectedCount > 0 && detailsAreValid();
    return false;
  }, [selectedCount, detailsAreValid]);

  const goToStep = useCallback((key) => {
    if (key === 'review') {
      const next = computeErrors();
      if (hasAny(next.owner) || hasAny(next.driver) || hasAny(next.vehicle)) {
        setErrors(next);
        showToast('Please fix the highlighted fields before reviewing.', 'error');
        return;
      }
      setErrors(EMPTY_ERRORS);
    }
    setServerError(null);
    setStep(key);
  }, [computeErrors, showToast]);

  const handleResourceToggle = useCallback((resource) => {
    setSelectedResources((prev) => ({ ...prev, [resource]: !prev[resource] }));
    setErrors((prev) => ({ ...prev, [resource]: {} }));
  }, []);

  const handleFormDataChange = useCallback((resource, field, value) => {
    setFormData((prev) => ({ ...prev, [resource]: { ...(prev[resource] || {}), [field]: value } }));
    setErrors((prev) => ({ ...prev, [resource]: { ...(prev[resource] || {}), [field]: null } }));
  }, []);

  const handleFormErrorsChange = useCallback((resource, resourceErrors) => {
    setErrors((prev) => ({ ...prev, [resource]: resourceErrors || {} }));
  }, []);

  /* ─────────────────────── Review name resolution ─────────────────────── */
  useEffect(() => {
    if (step !== 'review' || reviewDataLoadedRef.current) return;
    reviewDataLoadedRef.current = true;
    let active = true;
    (async () => {
      try {
        const jobs = [];
        if (selectedResources.driver || selectedResources.vehicle) jobs.push(adminAPI.getVehicleOwners({ limit: 200, status: 'active' }));
        if (selectedResources.vehicle) jobs.push(adminAPI.getDrivers({ limit: 200 }));
        const results = await Promise.all(jobs);
        if (!active) return;
        let oi = 0;
        if (selectedResources.driver || selectedResources.vehicle) {
          const res = results[oi++];
          if (res?.data?.success) { const map = {}; (res.data.data || []).forEach((o) => { map[o.owner_id] = o; }); setOwnersMap(map); }
        }
        if (selectedResources.vehicle) {
          const res = results[oi++];
          if (res?.data?.success) { const map = {}; (res.data.data || []).forEach((d) => { map[d.driver_id] = d; }); setDriversMap(map); }
        }
      } catch (err) { console.error('Failed to load review reference data:', err); }
    })();
    return () => { active = false; };
  }, [step, selectedResources]);

  /* ─────────────────────────── Submission ─────────────────────────── */
  const buildPayload = useCallback(() => {
    const fd = formDataRef.current;
    const payload = { owner: null, driver: null, vehicle: null };

    if (selectedResources.owner) {
      const o = fd.owner || {};
      payload.owner = {
        owner_name: o.owner_name.trim(), mobile: digits(o.phone), city: o.city.trim(),
        commission_percentage: parseFloat(o.commission_percentage) || 0,
        company_name: o.company_name?.trim() || null, email: o.email?.trim() || null, state: o.state?.trim() || 'Bihar',
        gst_number: o.gst_number?.trim() || null, pan_number: o.pan_number?.trim() || null, bank_name: o.bank_name?.trim() || null,
        bank_account: o.account_number?.trim() || null, bank_ifsc: o.ifsc?.trim() || null, upi_id: o.upi_id?.trim() || null,
        address: o.address?.trim() || null, alternate_mobile: o.alternate_mobile ? digits(o.alternate_mobile) : null,
      };
    }

    if (selectedResources.driver) {
      const d = fd.driver || {};
      payload.driver = {
        driver_name: d.driver_name.trim(), mobile: digits(d.mobile),
        alternate_mobile: d.alternate_mobile ? digits(d.alternate_mobile) : undefined,
        license_number: d.license_number?.trim() || undefined, license_expiry: d.license_expiry?.trim() || undefined,
        city: d.city?.trim() || undefined, state: d.state?.trim() || 'Bihar', address: d.address?.trim() || undefined,
        emergency_contact: d.emergency_contact ? digits(d.emergency_contact) : undefined,
        ...(d.is_self_owner ? { is_self_owner: true } : { transport_owner_id: d.transport_owner_id ? parseInt(d.transport_owner_id, 10) : undefined }),
      };
    }

    if (selectedResources.vehicle) {
      const v = fd.vehicle || {};
      payload.vehicle = {
        vehicle_number: v.vehicle_number.trim().toUpperCase(), vehicle_type: v.vehicle_type.trim(), vehicle_name: v.vehicle_name.trim(),
        capacity_kg: v.capacity_kg ? Number(v.capacity_kg) : null, capacity_volume: v.capacity_volume ? Number(v.capacity_volume) : null,
        vehicle_make: v.vehicle_make?.trim() || null, vehicle_model: v.vehicle_model?.trim() || null,
        manufacturing_year: v.manufacturing_year ? Number(v.manufacturing_year) : null, registration_date: v.registration_date?.trim() || null,
        insurance_number: v.insurance_number?.trim() || null, insurance_expiry: v.insurance_expiry?.trim() || null,
        permit_number: v.permit_number?.trim() || null, permit_expiry: v.permit_expiry?.trim() || null,
        pollution_certificate: v.pollution_certificate?.trim() || null, pollution_expiry: v.pollution_expiry?.trim() || null,
        base_location: v.base_location?.trim() || null, hourly_rate: v.hourly_rate ? Number(v.hourly_rate) : null,
        per_km_rate: v.per_km_rate ? Number(v.per_km_rate) : null, owner_id: v.owner_id ? Number(v.owner_id) : undefined,
        driver_id: v.driver_id ? Number(v.driver_id) : undefined, current_status: v.current_status, assign_owner_driver: Boolean(v.assign_owner_driver),
      };
    }

    return payload;
  }, [selectedResources]);

  const handleSubmit = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (submitLockRef.current) return;

    const next = computeErrors();
    if (hasAny(next.owner) || hasAny(next.driver) || hasAny(next.vehicle)) {
      setErrors(next);
      setStep('details');
      showToast('Please fix the highlighted fields before registering.', 'error');
      return;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setServerError(null);

    try {
      const res = await adminAPI.registerTransportResources(buildPayload());
      if (res.data?.success) {
        setCreatedEntities(res.data.data || {});
        setStep('success');
        showToast('Resources registered successfully.');
      } else {
        throw new Error(res.data?.message || 'Failed to register resources');
      }
    } catch (err) {
      console.error('Registration error:', err);
      // The combined endpoint runs in a single transaction, so a failure
      // means nothing was created — the operator can safely correct and
      // retry. Surface the server-authoritative message; never fake success.
      const data = err.response?.data || {};
      const message = data.message || data.errors?.[0]?.msg || err.message || 'Server error. Please try again.';
      setServerError(message);
      setStep('details');
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
      submitLockRef.current = false;
    }
  }, [buildPayload, computeErrors, showToast]);

  /* ─────────────────────── Close / back handling ─────────────────────── */
  const exitWorkspace = useCallback(() => navigate(homeRoute), [navigate, homeRoute]);

  const requestClose = useCallback(() => {
    if (hasUnsavedChanges && step !== 'success') setShowDiscardConfirm(true);
    else exitWorkspace();
  }, [hasUnsavedChanges, step, exitWorkspace]);

  const handleHeaderBack = useCallback(() => {
    if (step === 'select' || step === 'success') requestClose();
    else if (step === 'details') goToStep('select');
    else if (step === 'review') goToStep('details');
  }, [step, requestClose, goToStep]);

  const resetForAnother = useCallback(() => {
    setSelectedResources({ owner: false, driver: false, vehicle: false });
    setFormData(INITIAL_FORM);
    setErrors(EMPTY_ERRORS);
    setCreatedEntities({});
    setServerError(null);
    setOwnersMap({});
    setDriversMap({});
    reviewDataLoadedRef.current = false;
    setStep('select');
  }, []);

  /* ──────────── Browser back + tab-close guards (unsaved changes) ──────────── */
  const guardActiveRef = useRef(false);
  useEffect(() => { guardActiveRef.current = hasUnsavedChanges && step !== 'success'; }, [hasUnsavedChanges, step]);

  useEffect(() => {
    const onPopState = () => {
      if (guardActiveRef.current) {
        window.history.pushState({ btRegisterGuard: true }, '', REGISTER_ROUTE);
        setShowDiscardConfirm(true);
      }
    };
    window.history.pushState({ btRegisterGuard: true }, '', REGISTER_ROUTE);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const onBeforeUnload = (e) => { if (guardActiveRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!showDiscardConfirm) return;
    const onKey = (e) => { if (e.key === 'Escape') setShowDiscardConfirm(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDiscardConfirm]);

  /* ─────────────────────────── Review model ─────────────────────────── */
  const review = useMemo(() => {
    const fd = formDataRef.current;
    const out = [];

    if (selectedResources.owner) {
      const o = fd.owner || {};
      out.push({
        key: 'owner', label: RESOURCE_LABEL.owner, Icon: BuildingIcon, accent: 'amber',
        rows: [
          { label: 'Owner name', value: o.owner_name },
          { label: 'Phone', value: o.phone ? digits(o.phone) : '' },
          { label: 'City', value: o.city },
          { label: 'Commission', value: o.commission_percentage !== undefined && o.commission_percentage !== '' ? `${o.commission_percentage}%` : '' },
          { label: 'Company', value: o.company_name },
          { label: 'Email', value: o.email },
          { label: 'GST', value: o.gst_number },
          { label: 'PAN', value: o.pan_number },
        ].filter((r) => r.value),
      });
    }

    if (selectedResources.driver) {
      const d = fd.driver || {};
      let ownerAssoc = '';
      if (d.is_self_owner) ownerAssoc = 'Self (driver is the owner)';
      else if (d.transport_owner_id) ownerAssoc = ownersMap[d.transport_owner_id]?.owner_name || `Transport Owner #${d.transport_owner_id}`;
      else if (selectedResources.owner) ownerAssoc = `New owner — ${fd.owner?.owner_name || ''}`;
      out.push({
        key: 'driver', label: RESOURCE_LABEL.driver, Icon: DriverIcon, accent: 'navy',
        rows: [
          { label: 'Driver name', value: d.driver_name },
          { label: 'Mobile', value: d.mobile ? digits(d.mobile) : '' },
          { label: 'Licence number', value: d.license_number },
          { label: 'Licence expiry', value: d.license_expiry },
          { label: 'Transport owner', value: ownerAssoc },
          { label: 'City', value: d.city },
        ].filter((r) => r.value),
      });
    }

    if (selectedResources.vehicle) {
      const v = fd.vehicle || {};
      let vOwner = '';
      if (v.owner_id) vOwner = ownersMap[v.owner_id]?.owner_name || `Owner #${v.owner_id}`;
      else if (selectedResources.owner) vOwner = `New owner — ${fd.owner?.owner_name || ''}`;
      let vDriver = '';
      if (v.driver_id) vDriver = driversMap[v.driver_id]?.driver_name || `Driver #${v.driver_id}`;
      else if (selectedResources.driver) vDriver = `New driver — ${fd.driver?.driver_name || ''}`;
      out.push({
        key: 'vehicle', label: RESOURCE_LABEL.vehicle, Icon: TruckIcon, accent: 'teal',
        rows: [
          { label: 'Vehicle number', value: v.vehicle_number?.toUpperCase() },
          { label: 'Type', value: v.vehicle_type },
          { label: 'Name', value: v.vehicle_name },
          { label: 'Status', value: v.current_status },
          { label: 'Capacity', value: v.capacity_kg ? `${v.capacity_kg} kg` : (v.capacity_volume ? `${v.capacity_volume} cu ft` : '') },
          { label: 'Owner', value: vOwner },
          { label: 'Driver', value: vDriver },
          { label: 'Insurance expiry', value: v.insurance_expiry },
        ].filter((r) => r.value),
      });
    }

    return out;
  }, [selectedResources, ownersMap, driversMap, formData]);

  /* ─────────────────────────── Accent maps ─────────────────────────── */
  const accentRing = { amber: 'border-amber-500 bg-amber-50/60', navy: 'border-bt-navy bg-bt-navy/[0.04]', teal: 'border-teal-500 bg-teal-50/60' };
  const accentIcon = { amber: 'bg-amber-100 text-amber-600', navy: 'bg-bt-navy/10 text-bt-navy', teal: 'bg-teal-100 text-teal-600' };

  /* ─────────────────────────── Renderers ─────────────────────────── */
  const renderSelectionStep = () => (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-bt-navy">What would you like to register?</h2>
        <p className="mt-1 text-sm text-bt-ink-2">
          Select one or more resources. Each is created independently, and any combination can be registered together in a single step.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {RESOURCE_TYPES.map(({ key, label, description, Icon, accent }) => {
          const isSelected = selectedResources[key];
          return (
            <button key={key} type="button" onClick={() => handleResourceToggle(key)} aria-pressed={isSelected}
              className={`group relative flex items-start gap-4 rounded-xl border bg-bt-surface p-4 text-left transition-colors duration-150 hover:border-bt-border-strong hover:shadow-[0_2px_10px_rgba(16,43,76,0.06)] focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange focus-visible:ring-offset-2 ${isSelected ? accentRing[accent] : 'border-bt-border'}`}>
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition-colors ${isSelected ? accentIcon[accent] : 'bg-bt-surface-soft text-bt-ink-3 group-hover:bg-bt-orange-light group-hover:text-bt-orange-dark'}`}><Icon /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-bt-navy">{label}</span>
                <span className="mt-0.5 block text-[13px] leading-snug text-bt-ink-2">{description}</span>
              </span>
              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${isSelected ? 'border-bt-orange bg-bt-orange text-white' : 'border-bt-border-strong bg-transparent'}`} aria-hidden="true">
                {isSelected && <CheckIcon className="w-3 h-3" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderSummary = ({ sticky = true } = {}) => (
    <div className={`space-y-4 ${sticky ? 'lg:sticky lg:top-4' : ''}`}>
      <div className="rounded-xl border border-bt-border bg-bt-surface p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-bt-ink-3">Selected resources</h3>
        <ul className="mt-3 space-y-2.5">
          {selectedList.map(({ key, label, Icon, accent }) => (
            <li key={key} className="flex items-center gap-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentIcon[accent]}`}><Icon className="w-4.5 h-4.5" /></span>
              <span className="text-sm font-semibold text-bt-navy">{label}</span>
              <CheckIcon className="ml-auto h-4 w-4 text-bt-success" />
            </li>
          ))}
          {selectedCount === 0 && <li className="text-sm text-bt-ink-3">No resources selected yet.</li>}
        </ul>
      </div>
      <div className="rounded-xl border border-dashed border-bt-border-strong bg-bt-surface-soft p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-bt-ink-3">Tips</h3>
        <ul className="mt-2 space-y-1.5 text-[13px] leading-snug text-bt-ink-2">
          <li>Required fields are marked with <span className="font-semibold text-bt-danger">*</span>.</li>
          <li>Your entries are preserved as you move between steps.</li>
          <li>Registering an owner and driver together links them automatically.</li>
        </ul>
      </div>
    </div>
  );

  const renderDetailsStep = () => (
    <div className="space-y-4">
      {/* Compact selected-resources summary for < lg (above the form). */}
      <div className="lg:hidden">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-bt-border bg-bt-surface p-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-bt-ink-3">Selected</span>
          {selectedList.map(({ key, label, Icon, accent }) => (
            <span key={key} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${accentIcon[accent]}`}><Icon className="h-3.5 w-3.5" /> {label}</span>
          ))}
          {selectedCount === 0 && <span className="text-xs text-bt-ink-3">None</span>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="min-w-0 space-y-5">
          {serverError && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700" role="alert">
              <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" /><span>{serverError}</span>
            </div>
          )}
          {selectedResources.owner && (
            <OwnerRegistrationSection formData={formData.owner} errors={errors.owner}
              onChange={(f, v) => handleFormDataChange('owner', f, v)} onErrorsChange={(e) => handleFormErrorsChange('owner', e)} context={context} />
          )}
          {selectedResources.driver && (
            <DriverRegistrationSection formData={formData.driver} errors={errors.driver}
              onChange={(f, v) => handleFormDataChange('driver', f, v)} onErrorsChange={(e) => handleFormErrorsChange('driver', e)} context={context} />
          )}
          {selectedResources.vehicle && (
            <VehicleRegistrationSection formData={formData.vehicle} errors={errors.vehicle}
              onChange={(f, v) => handleFormDataChange('vehicle', f, v)} onErrorsChange={(e) => handleFormErrorsChange('vehicle', e)} context={context} />
          )}
        </div>
        <aside className="hidden min-w-0 lg:block">{renderSummary({ sticky: true })}</aside>
      </div>
    </div>
  );

  const renderReviewStep = () => (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-bold text-bt-navy">Review before registering</h2>
        <p className="mt-1 text-sm text-bt-ink-2">
          Confirm the details below. {selectedCount} resource{selectedCount > 1 ? 's' : ''} will be created in a single, all-or-nothing transaction.
        </p>
      </div>
      {serverError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm text-red-700" role="alert">
          <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" /><span>{serverError}</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {review.map(({ key, label, Icon, accent, rows }) => (
          <div key={key} className="overflow-hidden rounded-xl border border-bt-border bg-bt-surface">
            <div className="flex items-center gap-2.5 border-b border-bt-border bg-bt-surface-soft px-4 py-2.5">
              <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentIcon[accent]}`}><Icon className="h-4.5 w-4.5" /></span>
              <h3 className="text-sm font-bold text-bt-navy">{label}</h3>
            </div>
            <dl className="divide-y divide-bt-border">
              {rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                  <dt className="text-[13px] text-bt-ink-3">{r.label}</dt>
                  <dd className="text-right text-sm font-semibold text-bt-ink">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );

  const renderSuccessStep = () => {
    const created = [];
    if (createdEntities.owner_id) created.push({ key: 'owner', label: RESOURCE_LABEL.owner, Icon: BuildingIcon, accent: 'amber', name: formData.owner?.owner_name, id: createdEntities.owner_code || `#${createdEntities.owner_id}` });
    if (createdEntities.driver_id) created.push({ key: 'driver', label: RESOURCE_LABEL.driver, Icon: DriverIcon, accent: 'navy', name: formData.driver?.driver_name, id: createdEntities.driver_code || `#${createdEntities.driver_id}` });
    if (createdEntities.vehicle_id) created.push({ key: 'vehicle', label: RESOURCE_LABEL.vehicle, Icon: TruckIcon, accent: 'teal', name: formData.vehicle?.vehicle_number?.toUpperCase(), id: createdEntities.vehicle_number || `#${createdEntities.vehicle_id}` });
    return (
      <div className="mx-auto max-w-xl py-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-bt-success-bg text-bt-success"><CheckIcon className="h-7 w-7" /></div>
        <h2 className="mt-4 text-xl font-bold text-bt-navy">{created.length} resource{created.length > 1 ? 's' : ''} registered</h2>
        <p className="mt-1 text-sm text-bt-ink-2">The following records were created and are now available in the admin lists.</p>
        <ul className="mt-5 space-y-2.5 text-left">
          {created.map(({ key, label, Icon, accent, name, id }) => (
            <li key={key} className="flex items-center gap-3 rounded-xl border border-bt-border bg-bt-surface p-3.5">
              <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${accentIcon[accent]}`}><Icon className="h-5 w-5" /></span>
              <div className="min-w-0">
                <div className="text-sm font-bold text-bt-navy">{label}</div>
                <div className="truncate text-sm text-bt-ink-2">{name}</div>
              </div>
              <span className="ml-auto shrink-0 rounded-lg bg-bt-surface-soft px-2.5 py-1 font-mono text-xs font-semibold text-bt-ink-2">{id}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  /* ─────────────────────────── Status chip ─────────────────────────── */
  const statusChip = useMemo(() => {
    if (submitting) return { tone: 'busy', text: 'Saving…' };
    if (step === 'success') return { tone: 'done', text: 'Saved' };
    if (step === 'review') return { tone: 'ready', text: 'Ready to register' };
    if (step === 'details') return { tone: 'draft', text: 'Draft — unsaved' };
    if (selectedCount > 0) return { tone: 'draft', text: `${selectedCount} selected` };
    return { tone: 'idle', text: 'No selection' };
  }, [step, submitting, selectedCount]);

  const chipTone = { idle: 'bg-bt-surface-soft text-bt-ink-3', draft: 'bg-bt-orange-light text-bt-orange-dark', ready: 'bg-bt-navy text-white', busy: 'bg-bt-surface-soft text-bt-ink-2', done: 'bg-bt-success-bg text-bt-success' };
  const headerBackLabel = step === 'select' || step === 'success' ? 'Cancel' : 'Back';

  const footerInfo = () => {
    if (step === 'select') return selectedCount > 0 ? `${selectedCount} resource${selectedCount > 1 ? 's' : ''} selected` : 'Select at least one resource to continue';
    if (step === 'details') return `Step 2 of 3 · ${selectedCount} resource${selectedCount > 1 ? 's' : ''}`;
    if (step === 'review') return 'Review';
    return 'Registration complete';
  };

  /* ─────────────────────────── Layout ─────────────────────────── */
  return (
    <AdminShell fullBleed navItems={NAV_ITEMS} activeKey="drivers" onNav={() => {}}>
      <div className="min-w-0">
        {/* ─── Compact page header (light) — scrolls away with the page ─── */}
        <div className="border-b border-bt-border bg-bt-surface">
          <div className="mx-auto w-full max-w-[1200px] px-4 pt-4 pb-3 sm:px-6 lg:px-8">
            <nav aria-label="Breadcrumb" className="mb-2">
              <ol className="flex flex-wrap items-center gap-1.5 text-xs text-bt-ink-3">
                <li><button type="button" onClick={() => navigate('/admin')} className="rounded px-0.5 transition-colors hover:text-bt-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange">Admin</button></li>
                <li aria-hidden="true">/</li>
                <li><button type="button" onClick={() => navigate(homeRoute)} className="rounded px-0.5 transition-colors hover:text-bt-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange">Resources</button></li>
                <li aria-hidden="true">/</li>
                <li className="px-0.5 font-medium text-bt-ink-2" aria-current="page">Register Resources</li>
              </ol>
            </nav>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <div className="min-w-0">
                <h1 className="text-[26px] font-bold leading-tight tracking-tight text-bt-navy">Register Transport Resources</h1>
                <p className="mt-1 max-w-2xl text-sm text-bt-ink-2">
                  Onboard a transport owner, driver and vehicle. Register any combination — each resource is saved to its own record.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${chipTone[statusChip.tone]}`}>
                  {statusChip.tone === 'busy' && <Spinner className="h-3.5 w-3.5" />}
                  {statusChip.tone === 'done' && <CheckIcon className="h-3.5 w-3.5" />}
                  {statusChip.text}
                </span>
                <button type="button" onClick={handleHeaderBack} disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-bt-border px-2.5 py-1.5 text-sm font-semibold text-bt-ink-2 transition-colors duration-150 hover:bg-bt-surface-soft hover:text-bt-navy focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange disabled:opacity-50">
                  <ArrowLeftIcon className="h-4 w-4" />{headerBackLabel}
                </button>
              </div>
            </div>
            {/* Slim horizontal stepper — scrolls away with the page. */}
            <nav aria-label="Progress" className="mt-3">
              <ol className="flex items-center gap-1.5 sm:gap-2.5">
                {STEPS.map((s, i) => {
                  const isCurrent = s.key === step;
                  const isComplete = stepIndex > i || step === 'success';
                  const accessible = stepAccessible(s.key) && !submitting;
                  const hasError = s.key === 'details' && Object.values(errors).some((sec) => hasAny(sec));
                  return (
                    <li key={s.key} className="flex items-center gap-1.5 sm:gap-2.5">
                      <button type="button" disabled={!accessible} onClick={() => goToStep(s.key)} aria-current={isCurrent ? 'step' : undefined}
                        className={`flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange ${isCurrent ? 'bg-bt-orange-light' : 'hover:bg-bt-surface-soft'} ${accessible ? '' : 'cursor-not-allowed opacity-60'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${hasError ? 'bg-bt-danger text-white' : isComplete ? 'bg-bt-orange text-bt-navy-dark' : isCurrent ? 'bg-bt-navy text-white' : 'bg-bt-surface-soft text-bt-ink-3'}`}>
                          {hasError ? <AlertIcon className="h-3 w-3" /> : isComplete ? <CheckIcon className="h-3 w-3" /> : i + 1}
                        </span>
                        <span className={`text-[13px] font-semibold ${isCurrent ? 'text-bt-navy' : 'text-bt-ink-2'}`}>{s.label}</span>
                      </button>
                      {i < STEPS.length - 1 && <span className="h-px w-3 bg-bt-border sm:w-6" aria-hidden="true" />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
        </div>

        {/* ─── Main content — natural document flow ─── */}
        <div className="mx-auto w-full max-w-[1200px] px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
          {step === 'select' && renderSelectionStep()}
          {step === 'details' && renderDetailsStep()}
          {step === 'review' && renderReviewStep()}
          {step === 'success' && renderSuccessStep()}
        </div>

        {/* ─── Compact sticky action bar ─── */}
        <div className="sticky bottom-0 z-20 border-t border-bt-border bg-bt-surface/95 backdrop-blur" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8" style={{ minHeight: 60 }}>
            <div className="text-[13px] text-bt-ink-3">
              {step === 'review' ? (
                <button type="button" onClick={() => goToStep('details')} className="inline-flex items-center gap-1.5 rounded-lg font-semibold text-bt-navy transition-colors hover:text-bt-orange-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-bt-orange">
                  <ArrowLeftIcon className="h-4 w-4" /> Back to edit
                </button>
              ) : footerInfo()}
            </div>
            <div className="flex items-center gap-2">
              {step === 'select' && (
                <button type="button" onClick={() => goToStep('details')} disabled={selectedCount === 0} className="bt-btn bt-btn-accent disabled:cursor-not-allowed disabled:opacity-50">
                  Continue <ArrowRightIcon className="h-4 w-4" />
                </button>
              )}
              {step === 'details' && (
                <button type="button" onClick={() => goToStep('review')} className="bt-btn bt-btn-accent">
                  Continue to Review <ArrowRightIcon className="h-4 w-4" />
                </button>
              )}
              {step === 'review' && (
                <>
                  <button type="button" onClick={requestClose} disabled={submitting} className="bt-btn bt-btn-ghost disabled:opacity-50">Cancel registration</button>
                  <button type="button" onClick={handleSubmit} disabled={submitting} className="bt-btn bt-btn-accent disabled:cursor-not-allowed disabled:opacity-70">
                    {submitting ? (<><Spinner className="h-4 w-4" /> Registering…</>) : (<>Register {selectedCount} Resource{selectedCount > 1 ? 's' : ''}</>)}
                  </button>
                </>
              )}
              {step === 'success' && (
                <>
                  <button type="button" onClick={resetForAnother} className="bt-btn bt-btn-ghost">Register another</button>
                  <button type="button" onClick={exitWorkspace} className="bt-btn bt-btn-primary">Done</button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ─── Discard confirmation ─── */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-bt-navy-dark/40 backdrop-blur-sm" onClick={() => setShowDiscardConfirm(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" aria-labelledby="discard-title" className="relative w-full max-w-md rounded-2xl border border-bt-border bg-bt-surface p-6 shadow-[0_24px_64px_rgba(16,43,76,0.18)]">
            <h2 id="discard-title" className="text-lg font-bold text-bt-navy">Discard unsaved changes?</h2>
            <p className="mt-2 text-sm text-bt-ink-2">You have entered information that has not been saved. Leaving now will discard it.</p>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button type="button" onClick={() => setShowDiscardConfirm(false)} className="bt-btn bt-btn-ghost">Keep editing</button>
              <button type="button" onClick={() => { setShowDiscardConfirm(false); exitWorkspace(); }} className="bt-btn bg-bt-danger text-white hover:bg-red-600">Discard & leave</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Toast ─── */}
      {toast && (
        <div className="fixed right-5 top-5 z-[100] animate-slide-down" role="status">
          <div className={`flex items-center gap-3 rounded-2xl border px-5 py-3.5 text-sm font-semibold shadow-[0_12px_32px_rgba(16,43,76,0.16)] ${toast.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {toast.type === 'success' ? <CheckIcon className="h-5 w-5" /> : <AlertIcon className="h-5 w-5" />}
            <span>{toast.message}</span>
            <button type="button" onClick={() => setToast(null)} aria-label="Dismiss" className="ml-2 opacity-50 transition-opacity hover:opacity-100">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}
    </AdminShell>
  );
}

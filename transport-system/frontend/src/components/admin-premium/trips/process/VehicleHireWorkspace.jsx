/**
 * VehicleHireWorkspace.jsx
 * ---------------------------------------------------------------------------
 * THE UNIVERSAL VEHICLE HIRE WORKSPACE — the screen itself, with no page frame.
 *
 *   ORDER CONFIRMED → WAITING FOR VEHICLE → [ Hire Vehicle ] → VEHICLE HIRED
 *
 * THIS IS THE ONE IMPLEMENTATION
 *   There is no Contract Hire page and no Commission Hire page. "Billing To"
 *   decides which commercial model a hire is, and the Business Model is DERIVED
 *   from it and shown read-only. Two pages would be two implementations of the
 *   same arithmetic drifting apart.
 *
 * WHY IT HAS NO `AdminShell`
 *   The workspace is rendered by TWO hosts, and each already supplies the console
 *   frame:
 *     • `pages/AdminVehicleHire.jsx`  → the standalone route at
 *       /admin/trips/:tripId/vehicle-hire
 *     • `VehicleWorkspace.jsx`       → the `vehicle` stage of the Trip process,
 *       i.e. /admin/trips/:tripId/vehicle, inside `TripProcessShell`
 *   Drawing a shell here would nest a second sidebar inside the process page.
 *   So the frame belongs to the host and the workspace renders only its own work.
 *
 * `embedded` tells this component which host it is in, for exactly one thing:
 * whether to repeat a page header the host has already drawn.
 *
 * EVERYTHING ELSE IS UNCHANGED FROM THE ORIGINAL PAGE
 *   Same state hooks, same validation, same server-calculated money, same three
 *   separate figures (gross / commission / net), same challan, same endpoints.
 *   Only the chrome moved.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Truck,
  FileText,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Download,
  Share2,
  ArrowLeft,
  Percent,
  Building2,
} from 'lucide-react';

import {
  PageHeader,
  Button,
  StatusBadge,
  FormField,
  SectionCard,
  ErrorState,
  BlankState,
  DetailRow,
  IconTile,
} from '../../ui';
import { vehicleHireAPI } from '../../../../services/vehicleHireAPI';
import {
  SegmentedControl,
  SearchableSelect,
  InfoRow,
  MoneyLine,
  docStatus,
  inr,
  amount,
  fmtDate,
  humanize,
} from './vehicleHireComponents/VehicleHireComponents';
import QuotationEditor from '../../enquiries/QuotationEditor';

/* ═══════════════════════════════════════════════════════════════════════════
   THE WORKSPACE
   ─────────────────────────────────────────────────────────────────────────
   ══════════════════════════════════════════════════════════════════════════ */

export default function VehicleHireWorkspace({
  tripId,
  embedded = false,
  editMode = false,
}) {
  const navigate = useNavigate();

  /**
   * `editPath` — where "edit this hire" goes from HERE.
   *
   * The same pre-filled form has to be reachable from both hosts. `?edit=1` is
   * what selects it, and the workspace UPDATEs the one existing hire rather than
   * creating a second one. The canonical route is `/vehicle-hire`; the legacy
   * `/vehicle` route redirects here.
   */
  const editPath = `/admin/trips/${tripId}/vehicle-hire?edit=1`;

  // ── Server state ─────────────────────────────────────────────────────────
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // Catalogue is part of the context response; derive it to avoid stale/null state
  const catalogue = context?.catalogue ?? null;

  // ── Form state (the operator's rate INPUTS only) ─────────────────────────
  const [form, setForm] = useState({
    vehicle_id: '',
    vendor_id: '',
    driver_id: '',
    billing_to: '',
    rate_basis: 'FIXED',
    rate_value: '',
    rate_quantity: '',
    commission_type: 'PERCENTAGE',
    commission_rate: '5',
    remarks: '',
    documents_expired_ack: false,
  });

  // ── Lookup state ─────────────────────────────────────────────────────────
  const [vehicles, setVehicles] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [lookupsLoading, setLookupsLoading] = useState(false);

  // ── Detail of the currently selected masters (real DB values) ────────────
  const [vehicleDetail, setVehicleDetail] = useState(null);
  const [driverDetail, setDriverDetail] = useState(null);
  const [vendorDetail, setVendorDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── Money: the SERVER's answer, not the browser's ────────────────────────
  const [money, setMoney] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  // ── Save / success ───────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [success, setSuccess] = useState(null);
  const [toast, setToast] = useState(null);
  const [challanBusy, setChallanBusy] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const setField = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: null } : prev));
  }, []);

  /* ── Load the page context ──────────────────────────────────────────────── */
  const loadContext = useCallback(async () => {
    if (!tripId) {
      setLoadError('Trip ID is missing');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    // Reset form and detail state immediately when tripId changes,
    // so the fetchPreselectedDetails effect sees clean state and doesn't
    // display stale data from the previous trip while the API response loads.
    setForm({
      vehicle_id: '',
      vendor_id: '',
      driver_id: '',
      billing_to: '',
      rate_basis: 'FIXED',
      rate_value: '',
      rate_quantity: '',
      commission_type: 'PERCENTAGE',
      commission_rate: '5',
      remarks: '',
      documents_expired_ack: false,
    });
    setVehicleDetail(null);
    setDriverDetail(null);
    setVendorDetail(null);
    fetchedDetailsRef.current = { vehicle: null, driver: null, vendor: null };
    setSuccess(null);
    setSaveError(null);
    setFieldErrors({});
    setPreviewError(null);
    setMoney(null);

    try {
      const response = await vehicleHireAPI.getContext(tripId);
      if (!response.data?.success) throw new Error(response.data?.message || 'Failed to load trip');
      const data = response.data.data;

      setContext(data);

      // ── EDIT MODE: pre-fill from the EXISTING hire ───────────────────────
      // Every field comes from the stored record the backend read, so the form
      // shows what was actually agreed rather than policy defaults. A hire is
      // never created from this path.
      if (editMode && data.existing_hire) {
        const h = data.existing_hire;
        setForm((prev) => ({
          ...prev,
          vehicle_id: String(h.vehicle?.vehicle_id ?? ''),
          vendor_id: String(h.vendor?.owner_id ?? ''),
          driver_id: String(h.driver?.driver_id ?? ''),
          billing_to: h.billing_to || '',
          // The stored commission_type is the canonical 'percentage' | 'fixed'
          // vocabulary; a stored rate of 0 with a percentage type is the
          // "No Commission" deal, so it is offered back as such.
          commission_type: Number(h.commission_rate) === 0 && h.commission_type === 'percentage'
            ? 'NO_COMMISSION'
            : String(h.commission_type || 'percentage').toUpperCase(),
          rate_basis: h.rate_basis || 'FIXED',
          rate_value: h.rate_value === null || h.rate_value === undefined ? '' : String(h.rate_value),
          rate_quantity: h.rate_quantity === null || h.rate_quantity === undefined
            ? ''
            : String(h.rate_quantity),
          commission_rate: String(h.commission_rate ?? ''),
          remarks: h.remarks || '',
        }));
        setSuccess(null);
        return;
      }

      // ── NEW HIRE: open on the trip's own resources and the policy defaults.
      // A prior trip's RATE is deliberately NOT carried over — one trip's rate
      // is not this trip's rate.
      const billingDefault =
        data.previous_terms?.billing_to
        || (data.can_hire ? 'CONSIGNOR' : '');

      setForm((prev) => ({
        ...prev,
        vehicle_id: String(data.assignment.vehicle_id ?? ''),
        vendor_id: String(data.assignment.vendor_id ?? ''),
        driver_id: String(data.assignment.driver_id ?? ''),
        billing_to: billingDefault,
        rate_basis: data.catalogue?.default_rate_basis || 'FIXED',
        commission_type: data.catalogue?.default_commission_type || 'PERCENTAGE',
        commission_rate: String(data.catalogue?.default_commission_percentage ?? 5),
      }));

      // Clear stale vehicle/driver/vendor details when the trip has no assignment
      const hasAssignment = data.assignment.vehicle_id || data.assignment.driver_id || data.assignment.vendor_id;
      if (!hasAssignment) {
        setVehicleDetail(null);
        setDriverDetail(null);
        setVendorDetail(null);
        fetchedDetailsRef.current = { vehicle: null, driver: null, vendor: null };
      }

      if (data.existing_hire) setSuccess({ hire: data.existing_hire, trip: data.trip });
    } catch (err) {
      setLoadError(err.response?.data?.message || err.message || 'Failed to load trip');
    } finally {
      setLoading(false);
    }
  }, [tripId, editMode]);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  const fetchedDetailsRef = useRef({ vehicle: null, driver: null, vendor: null });
  // Fetch details for pre-selected items after context loads
  useEffect(() => {
    const fetchPreselectedDetails = async () => {
      if (form.vehicle_id && fetchedDetailsRef.current.vehicle !== form.vehicle_id) {
        try {
          const res = await vehicleHireAPI.getVehicle(form.vehicle_id);
          const detail = res.data?.data;
          if (detail) {
            setVehicleDetail(detail);
            fetchedDetailsRef.current.vehicle = form.vehicle_id;
            if (detail.vendor && fetchedDetailsRef.current.vendor !== detail.vendor.owner_id) {
              setVendorDetail(detail.vendor);
              fetchedDetailsRef.current.vendor = detail.vendor.owner_id;
            }
            if (detail.driver && fetchedDetailsRef.current.driver !== detail.driver.driver_id) {
              setDriverDetail({ driver: detail.driver });
              fetchedDetailsRef.current.driver = detail.driver.driver_id;
            }
          }
        } catch (err) {
          console.error('Failed to fetch preselected vehicle details:', err);
        }
      } else if (form.driver_id && !form.vehicle_id && fetchedDetailsRef.current.driver !== form.driver_id) {
        try {
          const res = await vehicleHireAPI.getDriver(form.driver_id);
          const detail = res.data?.data;
          if (detail) {
            setDriverDetail(detail);
            fetchedDetailsRef.current.driver = form.driver_id;
          }
        } catch (err) {
          console.error('Failed to fetch preselected driver details:', err);
        }
      } else if (form.vendor_id && !form.vehicle_id && fetchedDetailsRef.current.vendor !== form.vendor_id) {
        try {
          const res = await vehicleHireAPI.getVendor(form.vendor_id);
          const detail = res.data?.data;
          if (detail?.vendor) {
            setVendorDetail(detail.vendor);
            fetchedDetailsRef.current.vendor = form.vendor_id;
          }
        } catch (err) {
          console.error('Failed to fetch preselected vendor details:', err);
        }
      }
    };
    if (!loading && context) {
      fetchPreselectedDetails();
    }
  }, [loading, context, form.vehicle_id, form.driver_id, form.vendor_id]);

  /* ── Load the searchable selectors from the existing masters ────────────── */
  const lookupsReqRef = useRef(0);
  const loadLookups = useCallback(async (search = '') => {
    const reqId = lookupsReqRef.current + 1;
    lookupsReqRef.current = reqId;
    setLookupsLoading(true);
    try {
      // `trip_id` is what makes the server annotate and rank for THIS pickup —
      // vacant vehicles and drivers first, each labelled AVAILABLE / BUSY /
      // CONFLICT / UNAVAILABLE against the consignment being booked.
      const response = await vehicleHireAPI.getLookups({ search, limit: 25, tripId: tripId || undefined });
      if (reqId !== lookupsReqRef.current) return; // stale response
      if (response.data?.success) {
        const d = response.data.data;
        setVehicles(d.vehicles || []);
        setVendors(d.vendors || []);
        setDrivers(d.drivers || []);
      }
    } catch (err) {
      if (lookupsReqRef.current === reqId) {
        showToast('Could not load vehicle / vendor / driver lists', 'error');
      }
    } finally {
      if (lookupsReqRef.current === reqId) {
        setLookupsLoading(false);
      }
    }
  }, [showToast, tripId]);

  useEffect(() => {
    loadLookups('');
  }, [loadLookups]);

  /* ── Selecting a vehicle: real detail + auto-populated vendor ───────────── */
  const selectVehicle = useCallback(async (opt, source = 'user') => {
    setField('vehicle_id', String(opt.id));
    setDetailLoading(true);
    try {
      const response = await vehicleHireAPI.getVehicle(opt.id);
      const detail = response.data?.data;
      if (!detail) return;

      setVehicleDetail(detail);
      // Ensure the selected vehicle is in the options list for display
      setVehicles((prev) => {
        const exists = prev.some((v) => v.vehicle_id === detail.vehicle.vehicle_id);
        if (exists) return prev;
        return [...prev, { ...detail.vehicle, documents: detail.documents, vendor: detail.vendor, driver: detail.driver }];
      });
      // Vendor mobile and the vendor itself come from the vehicle's OWNER in
      // the existing master — never a hardcoded or duplicated vendor list.
      if (detail.vendor) {
        setField('vendor_id', String(detail.vendor.owner_id));
        setVendorDetail(detail.vendor);
        // Re-query that vendor's own vehicles + drivers so the vendor selection
        // narrows the driver's list to their fleet.
        const vres = await vehicleHireAPI.getVendor(detail.vendor.owner_id);
        if (vres.data?.data?.drivers) setDrivers(vres.data.data.drivers);
      } else {
        setVendorDetail(null);
      }
      // Auto-populate assigned driver if vehicle has one
      // Only auto-select driver if the selection came from user action (not from driver selection)
      if (detail.driver && source === 'user') {
        setField('driver_id', String(detail.driver.driver_id));
        setDriverDetail({ driver: detail.driver });
        // Ensure the auto-selected driver is in the options list
        setDrivers((prev) => {
          const exists = prev.some((d) => d.driver_id === detail.driver.driver_id);
          if (exists) return prev;
          return [...prev, { ...detail.driver, label: detail.driver.driver_name }];
        });
      } else if (!detail.driver && source === 'user') {
        // Clear driver if vehicle has no assigned driver and user selected vehicle
        setField('driver_id', '');
        setDriverDetail(null);
      }
    } catch (err) {
      showToast('Could not load vehicle details', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [setField, showToast]);

  const selectVendor = useCallback(async (opt) => {
    setField('vendor_id', String(opt.id));
    setDetailLoading(true);
    try {
      const response = await vehicleHireAPI.getVendor(opt.id);
      const detail = response.data?.data;
      if (!detail) return;
      setVendorDetail(detail.vendor);
      if (Array.isArray(detail.vehicles) && detail.vehicles.length) setVehicles(detail.vehicles);
      if (Array.isArray(detail.drivers) && detail.drivers.length) setDrivers(detail.drivers);
    } catch (err) {
      showToast('Could not load vendor details', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [setField, showToast]);

  const selectDriver = useCallback(async (opt, source = 'user') => {
    setField('driver_id', String(opt.id));
    setDetailLoading(true);
    try {
      const response = await vehicleHireAPI.getDriver(opt.id);
      const detail = response.data?.data;
      if (!detail) return;
      setDriverDetail(detail);
      // Ensure the selected driver is in the options list for display
      setDrivers((prev) => {
        const exists = prev.some((d) => d.driver_id === detail.driver.driver_id);
        if (exists) return prev;
        return [...prev, { ...detail.driver, label: detail.driver.driver_name }];
      });
      // The driver's own vendor auto-fills, from the existing master.
      if (detail.vendor) {
        setField('vendor_id', String(detail.vendor.owner_id));
        setVendorDetail((prev) => prev || detail.vendor);
      }
      // Auto-populate assigned vehicle if driver has one
      // Only auto-select vehicle if the selection came from user action (not from vehicle selection)
      if (detail.driver?.current_vehicle_id && source === 'user') {
        const vehicleId = detail.driver.current_vehicle_id;
        try {
          const vres = await vehicleHireAPI.getVehicle(vehicleId);
          const vdetail = vres.data?.data;
          if (vdetail) {
            // Check if vehicle is usable (not off-road, available)
            const usable = vdetail.usable !== false;
            const unusableReason = vdetail.unusable_reason || null;
            if (usable) {
              setField('vehicle_id', String(vehicleId));
              setVehicleDetail(vdetail);
              // Ensure the auto-selected vehicle is in the options list
              setVehicles((prev) => {
                const exists = prev.some((v) => v.vehicle_id === vdetail.vehicle.vehicle_id);
                if (exists) return prev;
                return [...prev, { ...vdetail.vehicle, documents: vdetail.documents, vendor: vdetail.vendor, driver: vdetail.driver }];
              });
              // Auto-populate vendor from vehicle's owner
              if (vdetail.vendor) {
                setField('vendor_id', String(vdetail.vendor.owner_id));
                setVendorDetail(vdetail.vendor);
                const vvres = await vehicleHireAPI.getVendor(vdetail.vendor.owner_id);
                if (vvres.data?.data?.drivers) setDrivers(vvres.data.data.drivers);
              }
            } else {
              // Driver has a vehicle but it's not available - show message but don't auto-select
              showToast(`Driver's assigned vehicle (${vdetail.vehicle?.vehicle_number || vehicleId}) is not available: ${unusableReason}`, 'error');
            }
          }
        } catch (err) {
          console.error('Failed to fetch driver\'s assigned vehicle:', err);
        }
      } else if (!detail.driver?.current_vehicle_id && source === 'user') {
        // Driver has no assigned vehicle - clear vehicle selection to allow manual pick
        setField('vehicle_id', '');
        setVehicleDetail(null);
      }
    } catch (err) {
      showToast('Could not load driver details', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, [setField, showToast]);

  /* ── The derived business model — READ ONLY, always visible ────────────── */
  const businessModel = useMemo(() => {
    const map = catalogue?.business_model_by_billing_to || {};
    return map[form.billing_to] || null;
  }, [catalogue, form.billing_to]);

  /* ── Local mirror of the gross, for an instant summary while typing ────── */
  // The SAVED value always comes from the server; this only keeps the summary
  // card responsive between preview round trips.
  const localGross = useMemo(() => {
    const rate = Number(form.rate_value);
    if (!Number.isFinite(rate) || rate < 0) return null;
    const basis = (catalogue?.rate_basis || []).find((b) => b.value === form.rate_basis);
    if (!basis) return null;

    if (basis.mode === 'RATE_QUANTITY') {
      const qty = Number(form.rate_quantity);
      if (!Number.isFinite(qty) || qty <= 0) return null;
      return rate * qty;
    }
    if (basis.mode === 'NET') {
      const isPct = form.commission_type === 'PERCENTAGE';
      const comm = Number(form.commission_rate) || 0;
      if (isPct) {
        if (comm >= 100) return null;
        return rate / (1 - comm / 100);
      }
      return rate + comm;
    }
    return rate;
  }, [form, catalogue]);

  /* ── Preview: the server's authoritative calculation ────────────────────── */
  // Debounced so the summary card settles shortly after typing stops, without a
  // request per keystroke.
  const previewTimer = useRef(null);
  // `can_hire` is false once a hire already exists, which is exactly the state
  // edit mode starts in. Allowing it through editMode keeps the live summary
  // card working while editing — it still calls the same server calculator.
  const previewEnabled =
    (!!context?.can_hire || (editMode && !!context?.existing_hire))
    && !!form.vehicle_id
    && !!form.vendor_id
    && !!form.driver_id
    && !!form.billing_to
    && !!form.rate_value
    && form.rate_value !== ''
    && (localGross !== null);

  useEffect(() => {
    if (success) return undefined;
    if (!previewEnabled) {
      setMoney(null);
      setPreviewError(null);
      return undefined;
    }

    const payload = {
      vehicle_id: Number(form.vehicle_id),
      vendor_id: Number(form.vendor_id),
      driver_id: Number(form.driver_id),
      billing_to: form.billing_to,
      rate_basis: form.rate_basis,
      rate_value: Number(form.rate_value),
      rate_quantity: form.rate_quantity === '' ? null : Number(form.rate_quantity),
      commission_type: form.commission_type,
      commission_rate: form.commission_type === 'NO_COMMISSION' ? 0 : Number(form.commission_rate),
      documents_expired_ack: form.documents_expired_ack,
    };

    setPreviewing(true);
    previewTimer.current = setTimeout(async () => {
      try {
        const response = await vehicleHireAPI.previewHire(tripId, payload);
        setMoney(response.data?.data || null);
        setPreviewError(null);
      } catch (err) {
        setMoney(null);
        setPreviewError(err.response?.data?.message || 'Could not calculate this hire');
      } finally {
        setPreviewing(false);
      }
    }, 350);

    return () => clearTimeout(previewTimer.current);
  }, [
    form, tripId, previewEnabled, success,
  ]);

  /* ── Save ───────────────────────────────────────────────────────────────── */
  const validate = useCallback(() => {
    const errors = {};
    if (!form.vehicle_id) errors.vehicle_id = 'Select a vehicle';
    if (!form.vendor_id) errors.vendor_id = 'Select a vehicle vendor';
    if (!form.driver_id) errors.driver_id = 'Select a driver';
    if (!form.billing_to) errors.billing_to = 'Select who the hire is billed to';
    if (form.rate_value === '' || Number.isNaN(Number(form.rate_value)) || Number(form.rate_value) < 0) {
      errors.rate_value = 'Enter a valid rate';
    }

    const basis = (catalogue?.rate_basis || []).find((b) => b.value === form.rate_basis);
    if (basis?.mode === 'RATE_QUANTITY') {
      const qty = Number(form.rate_quantity);
      if (form.rate_quantity === '' || !Number.isFinite(qty) || qty <= 0) {
        errors.rate_quantity = `${basis.quantityLabel || 'Quantity'} is required`;
      }
    }

    if (form.commission_type === 'PERCENTAGE') {
      const pct = Number(form.commission_rate);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        errors.commission_rate = 'Enter a percentage between 0 and 100';
      }
    }
    if (form.commission_type === 'FIXED') {
      const fixed = Number(form.commission_rate);
      if (!Number.isFinite(fixed) || fixed < 0) {
        errors.commission_rate = 'Enter a valid amount';
      }
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [form, catalogue]);

  const handleSubmit = useCallback(async () => {
    if (saving) return;
    setSaveError(null);

    if (!validate()) return;

    // The SAME operator inputs either way. In edit mode the request goes out as
    // a PUT so the backend UPDATEs the one existing hire; otherwise it POSTs to
    // create one. The browser sends rate inputs only — gross, commission and
    // net are always computed by the server.
    const payload = {
      vehicle_id: Number(form.vehicle_id),
      vendor_id: Number(form.vendor_id),
      driver_id: Number(form.driver_id),
      billing_to: form.billing_to,
      business_model: businessModel || undefined,
      rate_basis: form.rate_basis,
      rate_value: Number(form.rate_value),
      rate_quantity: form.rate_quantity === '' ? null : Number(form.rate_quantity),
      commission_type: form.commission_type,
      commission_rate: form.commission_type === 'NO_COMMISSION' ? 0 : Number(form.commission_rate),
      remarks: form.remarks || null,
      documents_expired_ack: form.documents_expired_ack,
    };

    setSaving(true);
    try {
      const response = editMode
        ? await vehicleHireAPI.updateVehicleHire(tripId, payload)
        : await vehicleHireAPI.hireVehicle(tripId, payload);

      setSuccess(response.data?.data || null);
      showToast(editMode ? 'Vehicle hire updated' : 'Vehicle hired successfully');
    } catch (err) {
      setSaveError(
        err.response?.data?.message
          || err.message
          || (editMode ? 'Could not update the vehicle hire' : 'Could not save the vehicle hire')
      );
    } finally {
      setSaving(false);
    }
  }, [saving, validate, tripId, form, businessModel, showToast, editMode]);

  /* ── Challan ────────────────────────────────────────────────────────────── */
  const downloadChallan = useCallback(async () => {
    if (challanBusy) return;
    setChallanBusy(true);
    try {
      const { blob, filename } = await vehicleHireAPI.downloadChallan(
        tripId, success?.hire?.challan_number
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast('Could not download the challan', 'error');
    } finally {
      setChallanBusy(false);
    }
  }, [challanBusy, tripId, success, showToast]);

  const shareChallan = useCallback(async () => {
    if (challanBusy) return;
    setChallanBusy(true);
    try {
      const { blob, filename } = await vehicleHireAPI.downloadChallan(
        tripId, success?.hire?.challan_number
      );
      const file = new File([blob], filename, { type: 'application/pdf' });

      // Sharing is a client concern; the server exposes ONE stable document.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Challan ${success?.hire?.challan_number || ''}`.trim(),
          text: `Vehicle hire challan for trip ${context?.trip?.trip_number || ''}`,
        });
      } else {
        showToast('Sharing is not supported on this device — use Download Challan', 'error');
      }
    } catch (err) {
      if (err?.name !== 'AbortError') {
        showToast('Could not share the challan', 'error');
      }
    } finally {
      setChallanBusy(false);
    }
  }, [challanBusy, tripId, success, context, showToast]);

  /** Navigate to the canonical Trip Master. */
  const goToCanonicalMaster = useCallback(() => {
    const t = context?.trip;
    if (t?.trip_id) {
      navigate(`/admin/trips/${t.trip_id}`);
    }
  }, [navigate, context?.trip?.trip_id]);

  /* ── RENDER ─────────────────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-bt-orange border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <ErrorState
        title="Could not open the Vehicle Hire page"
        message={loadError}
        onRetry={loadContext}
      />
    );
  }

  if (!context) return null;

const trip = context.trip;
  const hireReadyStatuses = catalogue?.hire_ready_statuses || ['PENDING'];
  const isHireReady = hireReadyStatuses.includes(trip.status);
  const alreadyHired = !!context.existing_hire;

  /* ════════════════════════════════════════════════════════════════════════
     SUCCESS STATE — the application's existing success UI
     ═══════════════════════════════════════════════════════════════════════ */
  if (success?.hire) {
    const h = success.hire;
    return (
      <div className="space-y-4">
        {/* ── Compact success banner ────────────────────────────────────── */}
        <div className="flex items-center justify-between rounded-lg border border-bt-green-200 bg-emerald-50/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600"
              aria-hidden="true"
            >
              <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-[14px] font-bold text-bt-navy">Vehicle hired successfully</p>
              <p className="text-[12.5px] text-bt-ink-2">
                Challan <span className="font-semibold text-bt-navy">{h.challan_number}</span> · Trip {trip.trip_number}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              loading={challanBusy}
              onClick={downloadChallan}
            >
              Challan
            </Button>
            {typeof navigator !== 'undefined' && navigator.canShare ? (
              <Button
                variant="secondary"
                size="sm"
                icon={Share2}
                loading={challanBusy}
                onClick={shareChallan}
              >
                Share
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="sm"
              onClick={goToCanonicalMaster}
            >
              Back to Trip
            </Button>
          </div>
        </div>

        {/* ── Compact hire details + financial summary ──────────────────── */}
        <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
          {/* Left: hire details */}
          <div className="grid gap-4">
            <SectionCard
              title="Hire Details"
              subtitle={`Recorded on trip ${trip.trip_number}`}
              bodyClass="p-4"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DetailRow label="Vehicle" value={h.vehicle?.vehicle_number} />
                <DetailRow
                  label="Vehicle Type"
                  value={[h.vehicle?.vehicle_type, h.vehicle?.vehicle_name].filter(Boolean).join(' · ') || '—'}
                />
                <DetailRow label="Vendor" value={h.vendor?.owner_name} />
                <DetailRow label="Driver" value={h.driver?.driver_name} />
                <DetailRow label="Billing To" value={humanize(h.billing_to)} />
                <DetailRow label="Business Model" value={humanize(h.business_model)} />
                <DetailRow label="Rate As Per" value={humanize(h.rate_basis)} />
              </dl>
            </SectionCard>

            {/* ── Vendor Payment ─────────────────────────────────────────── */}
            <SectionCard
              title="Vendor Payment"
              subtitle="Current trip payable — separate from vendor ledger"
              bodyClass="p-4"
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <DetailRow label="Net Vendor Payable" value={inr(h.net_vendor_payable)} />
                <DetailRow label="Paid" value={inr(h.paid_amount || 0)} />
                <DetailRow
                  label="Balance"
                  value={inr(Number(h.net_vendor_payable || 0) - Number(h.paid_amount || 0))}
                />
                <DetailRow label="Payment Status" value={h.payment_status || 'Pending'} />
              </dl>
              <div className="mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => navigate('/admin/settlements')}
                >
                  Make Transaction
                </Button>
              </div>
              {h.payment_history?.length ? (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-bt-ink-3">
                    Payment History
                  </p>
                  {h.payment_history.map((p) => (
                    <div key={p.id || p.date} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-bt-ink-2">{p.date} · {p.type || p.description}</span>
                      <span className="font-medium text-bt-navy">{inr(p.amount)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </SectionCard>
          </div>

          {/* Right: financial summary */}
          <div className="space-y-4">
            <SectionCard
              title="Hire Financial Summary"
              subtitle="Gross − Commission = Net Vendor Payable"
              icon={Percent}
              bodyClass="p-5"
            >
              <div className="rounded-xl border border-bt-border bg-gradient-to-br from-white to-bt-surface-soft p-4">
                <dl className="space-y-1">
                  <MoneyLine label="Gross Hire" value={h.gross_hire} />
                  <MoneyLine
                    label="Commission"
                    value={h.commission_amount}
                    prefix="−"
                    tone="muted"
                    caption={
                      h.commission_type === 'fixed'
                        ? `Fixed ${inr(h.commission_rate)}`
                        : `${amount(h.commission_rate)}%`
                    }
                  />
                  <div className="my-3 h-px w-full bg-gradient-to-r from-bt-border via-bt-border-strong to-bt-border"></div>
                  <div className="rounded-lg bg-[rgba(245,160,0,0.08)] px-3 py-2">
                    <MoneyLine label="Net Vendor Payable" value={h.net_vendor_payable} emphasis />
                  </div>
                </dl>
              </div>
            </SectionCard>

            {/* ── Next operational action ─────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bt-border bg-white px-3.5 py-2.5">
              <span className="text-[12px] font-semibold text-bt-ink-2">Next step</span>
              <StatusBadge status="ASSIGNED" label="VEHICLE HIRED" tone="success" />
              <span className="text-bt-ink-3">→</span>
              <StatusBadge
                status={success.next_operational?.status}
                label={success.next_operational?.label || 'Waiting for loading'}
                tone="warning"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     BLOCKED — the trip is not in a hire-ready state, or already has a hire
     ═══════════════════════════════════════════════════════════════════════ */
  // `can_hire` is false as soon as a hire exists, which is precisely when EDIT
  // mode is the right action — so an existing hire routes to the same form
  // rather than a dead end. Without ?edit=1 the page behaves exactly as before.
  if (!context.can_hire && !editMode) {
    return (
      <>
        {!embedded ? (
          <div className="mb-4 flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToCanonicalMaster}
              className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-bt-ink-2 transition-colors hover:text-bt-navy"
            >
              <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
              Back to Trip
            </Button>
            <span className="text-bt-ink-3/50">/</span>
            <span className="font-mono text-[13px] font-semibold text-bt-navy">{trip.trip_number}</span>
          </div>
        ) : null}
        <SectionCard bodyClass="p-5">
          <BlankState
            title={alreadyHired ? 'A vehicle has already been hired for this trip' : 'Vehicle hiring is not available'}
            subtitle={context.blocked_reason}
            action={(
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" size="sm" onClick={goToCanonicalMaster}>
                  Back to Trip
                </Button>
                {/* The agreed hire can still be corrected — through this same
                    form, which UPDATEs the one hire rather than adding one. */}
                {alreadyHired ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(editPath)}
                  >
                    Edit Vehicle Hire
                  </Button>
                ) : null}
              </div>
            )}
          />
        </SectionCard>
      </>
    );
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE FORM
     ═══════════════════════════════════════════════════════════════════════ */

  const documents = vehicleDetail?.documents || context.documents;
  const expiredCritical = (documents?.expired_critical || []).filter(Boolean);
  const expiringSoon = (documents?.expiring_soon || []).filter(Boolean);

  const rateBasis = (catalogue?.rate_basis || []).find((b) => b.value === form.rate_basis);

  // The effective rate label follows the selected basis ("Rate Per Ton" for
  // Per Ton), so the field never says "rate" when it means something else.
  const rateLabel = rateBasis?.rateLabel || 'Vehicle Hire Rate';
  const needsQuantity = rateBasis?.mode === 'RATE_QUANTITY';

  const canSubmit =
    !!form.vehicle_id && !!form.vendor_id && !!form.driver_id && !!form.billing_to
    && form.rate_value !== '' && (localGross !== null)
    && (expiredCritical.length === 0 || form.documents_expired_ack)
    && !saving && !previewing;

  // ── Compact info display for selected vehicle/vendor/driver ──────────────
  const vehicleInfo = vehicleDetail?.vehicle;
  const vendorInfo = vendorDetail;
  const driverInfo = driverDetail?.driver;

  return (
    <>
      {/* ── Compact header (standalone only) ─────────────────────────────── */}
      {!embedded ? (
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToCanonicalMaster}
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-bt-ink-2 transition-colors hover:text-bt-navy"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.2} />
                Back to Trip
              </Button>
              <span className="text-bt-ink-3/40">/</span>
              <div className="flex items-center gap-3">
                <span className="text-[13px] font-medium text-bt-ink-2 uppercase tracking-wider">Trip</span>
                <span className="font-mono text-[15px] font-bold text-bt-navy tracking-tight">{trip.trip_number}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10.5px] font-bold uppercase tracking-[0.16em] text-bt-orange">Vehicle Hiring</span>
            <div className="h-px flex-1 bg-gradient-to-r from-bt-orange/20 to-transparent"></div>
          </div>
          <h1 className="bt-page-title -mt-2">Vehicle Hiring</h1>
          <p className="bt-page-desc -mt-2">
            Assign vehicle, vendor and driver with accurate commercial terms for trip {trip.trip_number}
          </p>
        </div>
      ) : null}

      {/* ── Compact status bar (embedded only) ───────────────────────────── */}
      {embedded ? (
        <section
          aria-label="Vehicle hire status"
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-bt-border bg-white px-4 py-2.5"
        >
          <div className="min-w-0">
            <p className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-bt-ink-3">
              {editMode ? 'Editing existing hire' : 'Vehicle Hire'}
            </p>
            <p className="mt-0.5 text-[13px] font-semibold text-bt-navy">
              {editMode
                ? `Updating the hire on ${trip.trip_number} — this does not create a second one.`
                : `Engage a vehicle for ${trip.trip_number}${context.customer?.name ? ` · ${context.customer.name}` : ''}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              status={trip.status}
              label={
                editMode
                  ? 'VEHICLE HIRED'
                  : (isHireReady ? 'WAITING FOR VEHICLE' : trip.status?.replace(/_/g, ' '))
              }
              tone={editMode ? 'success' : 'warning'}
            />
            <Button
              variant="accent"
              size="sm"
              icon={Truck}
              loading={saving}
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {saving
                ? (editMode ? 'Saving…' : 'Hiring…')
                : (editMode ? 'Save Changes' : 'Hire Vehicle')}
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── Main content: 2-column grid ─────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* ══════════════════════════════════════════════════════════════════
           LEFT COLUMN — main operational workspace
           ══════════════════════════════════════════════════════════════════ */}
        <div className="min-w-0 space-y-4">
          {/* ── VEHICLE & DRIVER ─────────────────────────────────────────── */}
          <SectionCard
            title="Vehicle & Driver"
            subtitle="Select the vehicle, vendor and driver for this trip."
            icon={Truck}
            action={
              <Button
                variant="ghost"
                size="sm"
                icon={Truck}
                onClick={() => {
                  // Reset selection to allow re-picking
                  setVehicleDetail(null);
                  setVendorDetail(null);
                  setDriverDetail(null);
                  setForm((prev) => ({
                    ...prev,
                    vehicle_id: '',
                    vendor_id: '',
                    driver_id: '',
                  }));
                }}
              >
                {form.vehicle_id ? 'Change Vehicle' : 'Select Vehicle'}
              </Button>
            }
            bodyClass="p-5"
          >
            {/* ── Selected information display ─────────── */}
            {vehicleInfo ? (
              <div className="mb-6 space-y-5">
                {/* Vehicle Information */}
                <div className="rounded-xl border border-bt-border bg-bt-surface-soft p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(21,52,91,0.06)] text-bt-navy">
                      <Truck className="h-4 w-4" strokeWidth={2.1} />
                    </div>
                    <h3 className="text-[14px] font-bold text-bt-navy">Vehicle Information</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <InfoRow
                      label="Vehicle Number"
                      value={vehicleInfo.vehicle_number}
                    />
                    <InfoRow
                      label="Vehicle Type"
                      value={vehicleInfo.vehicle_type}
                    />
                    <InfoRow
                      label="Vehicle Size"
                      value={vehicleInfo.body_type || (vehicleInfo.capacity_kg ? `${Number(vehicleInfo.capacity_kg).toLocaleString('en-IN')} kg` : '—')}
                    />
                    <InfoRow
                      label="Vehicle Name"
                      value={vehicleInfo.vehicle_name || '—'}
                    />
                  </div>
                </div>

                {/* Vendor Information */}
                {vendorInfo ? (
                  <div className="rounded-xl border border-bt-border bg-bt-surface-soft p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(21,52,91,0.06)] text-bt-navy">
                        <Building2 className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <h3 className="text-[14px] font-bold text-bt-navy">Vendor Information</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <InfoRow
                        label="Vendor Name"
                        value={vendorInfo.owner_name}
                      />
                      <InfoRow
                        label="Vendor Mobile"
                        value={vendorInfo.mobile}
                      />
                      <InfoRow
                        label="Vendor GST"
                        value={vendorInfo.gst_number || '—'}
                      />
                    </div>
                  </div>
                ) : null}

                {/* Driver Information */}
                {driverInfo ? (
                  <div className="rounded-xl border border-bt-border bg-bt-surface-soft p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgba(21,52,91,0.06)] text-bt-navy">
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="7" r="4"></circle>
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        </svg>
                      </div>
                      <h3 className="text-[14px] font-bold text-bt-navy">Driver Information</h3>
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      <InfoRow
                        label="Driver Name"
                        value={driverInfo.driver_name}
                      />
                      <InfoRow
                        label="Driver Mobile"
                        value={driverInfo.mobile}
                      />
                      <InfoRow
                        label="Driver License"
                        value={driverInfo.driving_license || '—'}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mb-6 rounded-xl border border-dashed border-bt-border/60 bg-bt-surface-soft py-8 text-center">
                <div className="flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(21,52,91,0.06)] text-bt-navy">
                    <Truck className="h-5 w-5" strokeWidth={2.1} />
                  </div>
                </div>
                <p className="mt-3 text-[14px] font-medium text-bt-navy">
                  No vehicle selected
                </p>
                <p className="mt-1 text-[13px] text-bt-ink-2">
                  Search and assign vehicle, vendor and driver below
                </p>
              </div>
            )}

            {/* ── Search inputs ─────────────────────────────────── */}
            <div className="space-y-4">
              <h4 className="text-[13px] font-bold uppercase tracking-[0.08em] text-bt-navy">Assignment</h4>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-2">
                <SearchableSelect
                  id="vh-vehicle"
                  label="Vehicle Number"
                  required
                  loading={lookupsLoading || detailLoading}
                  value={form.vehicle_id}
                  options={vehicles.map((v) => ({ id: v.vehicle_id, ...v }))}
                  onSearch={() => loadLookups('')}
                  onSelect={selectVehicle}
                  error={fieldErrors.vehicle_id}
                  placeholder="Search by number, type or name"
                  emptyLabel="No vehicles found"
                  formatOption={(o) => `${o.vehicle_number} · ${o.vehicle_type}${o.vehicle_name ? ` · ${o.vehicle_name}` : ''}`}
                  formatSelected={(o) => `${o.vehicle_number} · ${o.vehicle_type}`}
                  hint={vehicleDetail?.vehicle?.vehicle_type ? `Vehicle Type: ${vehicleDetail.vehicle.vehicle_type}` : undefined}
                />

                <SearchableSelect
                  id="vh-vendor"
                  label="Vehicle Vendor"
                  required
                  loading={lookupsLoading || detailLoading}
                  value={form.vendor_id}
                  options={vendors.map((v) => ({ id: v.owner_id, ...v }))}
                  onSearch={(term) => loadLookups(term)}
                  onSelect={selectVendor}
                  error={fieldErrors.vendor_id}
                  placeholder="Search by owner name or mobile"
                  emptyLabel="No vendors found"
                  formatOption={(o) => `${o.owner_name}${o.mobile ? ` · ${o.mobile}` : ''}`}
                  formatSelected={(o) => `${o.owner_name}${o.mobile ? ` · ${o.mobile}` : ''}`}
                  hint={vendorDetail?.mobile ? `Vendor Mobile: ${vendorDetail.mobile}` : undefined}
                />

                <SearchableSelect
                  id="vh-driver"
                  label="Driver"
                  required
                  loading={lookupsLoading || detailLoading}
                  value={form.driver_id}
                  options={drivers.map((d) => ({ id: d.driver_id, ...d }))}
                  onSearch={(term) => loadLookups(term)}
                  onSelect={selectDriver}
                  error={fieldErrors.driver_id}
                  placeholder="Search by name or mobile"
                  emptyLabel="No drivers found"
                  formatOption={(o) => `${o.driver_name}${o.mobile ? ` · ${o.mobile}` : ''}`}
                  formatSelected={(o) => `${o.driver_name}${o.mobile ? ` · ${o.mobile}` : ''}`}
                  hint={driverDetail?.driver?.mobile ? `Driver Mobile: ${driverDetail.driver.mobile}` : undefined}
                />

                {/* Vehicle size — from the vehicle master, read-only. */}
                <FormField
                  label="Vehicle Size"
                  hint="From the vehicle master record"
                >
                  <div className="bt-input bt-input-sm flex items-center bg-bt-surface-soft text-bt-ink-2">
                    {vehicleDetail?.vehicle?.capacity_kg
                      ? `${Number(vehicleDetail.vehicle.capacity_kg).toLocaleString('en-IN')} kg`
                      : vehicleDetail?.vehicle?.body_type
                        ? vehicleDetail.vehicle.body_type
                        : '—'}
                  </div>
                </FormField>
              </div>
            </div>
          </SectionCard>

          {/* ── VEHICLE DOCUMENT EXPIRY (compact grid) ──────────────────── */}
          <SectionCard
            title="Vehicle Documents"
            subtitle={`Warning at ${documents?.warning_days ?? catalogue?.document_warning_days ?? 30} days`}
            icon={FileText}
            bodyClass="p-5"
          >
            {documents?.documents?.length ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {documents.documents.map((doc) => {
                  const tone = docStatus(doc.status);
                  const Icon = tone.icon;
                  return (
                    <div
                      key={doc.key}
                      className="group flex flex-col items-center gap-2 rounded-xl border border-bt-border bg-white p-4 text-center transition-all duration-150 hover:border-bt-border-strong hover:shadow-sm"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-bt-surface-soft">
                        <Icon className={`h-4 w-4 ${tone.label === 'Expired' ? 'text-red-600' : tone.label === 'Expiring Soon' ? 'text-amber-600' : tone.label === 'Valid' ? 'text-emerald-600' : 'text-slate-500'}`} strokeWidth={2.2} />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-[13px] font-bold text-bt-navy leading-tight">
                          {doc.label}
                        </p>
                        <p className="text-[12px] text-bt-ink-2">
                          {doc.expiry_date ? fmtDate(doc.expiry_date) : 'No date recorded'}
                        </p>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${tone.chip}`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} aria-hidden="true" />
                        {tone.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-bt-border/60 bg-bt-surface-soft py-8 text-center">
                <div className="flex justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(21,52,91,0.06)] text-bt-navy">
                    <FileText className="h-5 w-5" strokeWidth={2.1} />
                  </div>
                </div>
                <p className="mt-3 text-[14px] font-medium text-bt-navy">
                  No documents to display
                </p>
                <p className="mt-1 text-[13px] text-bt-ink-2">
                  Select a vehicle to see its document status
                </p>
              </div>
            )}

            {/* An expired critical document is never silently hired. */}
            {expiredCritical.length > 0 ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
                <div className="flex items-start gap-2">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" strokeWidth={2.1} />
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-bold text-red-800">Vehicle document expired</p>
                    <ul className="mt-1 space-y-0.5">
                      {expiredCritical.map((d) => (
                        <li key={d.key} className="text-[11.5px] text-red-700">
                          {d.label} expired: <strong>{fmtDate(d.expiry_date)}</strong>
                          {d.days_remaining !== null && d.days_remaining !== undefined
                            ? ` (${Math.abs(d.days_remaining)} days ago)`
                            : ''}
                        </li>
                      ))}
                    </ul>

                    {catalogue?.can_override_expired_documents ? (
                      <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-md border border-red-200 bg-white p-2">
                        <input
                          type="checkbox"
                          checked={form.documents_expired_ack}
                          onChange={(e) => setField('documents_expired_ack', e.target.checked)}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--bt-danger)]"
                        />
                        <span className="text-[11.5px] leading-relaxed text-bt-navy">
                          I acknowledge this vehicle is being hired with an expired critical document.
                        </span>
                      </label>
                    ) : (
                      <p className="mt-2 rounded-md border border-red-200 bg-white p-2 text-[11.5px] leading-relaxed text-red-800">
                        A <strong>{catalogue?.expired_document_override_roles?.join(' or ')}</strong>{' '}
                        account is required to hire a vehicle with an expired critical document.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {expiringSoon.length > 0 ? (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" strokeWidth={2.1} />
                  <div className="min-w-0 text-[11.5px] text-amber-800">
                    <p className="font-bold">Expiring soon</p>
                    <p className="mt-0.5">
                      {expiringSoon
                        .map((d) => `${d.label} on ${fmtDate(d.expiry_date)}`)
                        .join(' · ')}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </SectionCard>

          {/* ── CUSTOMER QUOTATION ────────────────────────────────────────── */}
          {context?.customer?.enquiry_id && (
            <SectionCard
              title="Customer Quotation"
              subtitle="Prepare and send the customer quotation for this enquiry"
              icon={FileText}
              bodyClass="p-4"
            >
              <QuotationEditor
                enquiryId={context.customer.enquiry_id}
                onChanged={() => {
                  // Optionally refresh context if needed
                }}
              />
            </SectionCard>
          )}

          {/* ── COMMERCIAL TERMS ────────────────────────────────────────── */}
          <SectionCard
            title="Commercial Terms"
            subtitle="Billing To determines the business model"
            bodyClass="p-4"
          >
            {/* ── Billing To ─────────────────────────────────────────────── */}
            <FormField label="Billing To" required error={fieldErrors.billing_to}>
              <SegmentedControl
                name="Billing To"
                value={form.billing_to}
                onChange={(v) => setField('billing_to', v)}
                options={(catalogue?.billing_to || []).map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
                columns={catalogue?.billing_to?.length > 2 ? 4 : 2}
              />
            </FormField>

            {/* ── Business Model (derived, read-only) ────────────────────── */}
            <div className="mt-3 flex items-center justify-between rounded-lg border border-bt-border bg-bt-surface-soft px-3 py-2.5">
              <div className="flex items-center gap-2">
                <IconTile icon={Building2} tone={businessModel === 'COMMISSION' ? 'warning' : 'navy'} size="sm" />
                <div>
                  <p className="text-[10.5px] font-bold uppercase tracking-wider text-bt-ink-3">
                    Business Model
                  </p>
                  <p className="text-[14px] font-bold text-bt-navy">
                    {businessModel || '—'}
                  </p>
                </div>
              </div>
              <p className="max-w-[200px] text-[11px] leading-relaxed text-bt-ink-2">
                {businessModel === 'COMMISSION'
                  ? 'Bihar Transport intermediates the load and earns a commission on the gross hire.'
                  : 'The hire rate is contracted for this trip.'}
              </p>
            </div>

            {/* ── Rate As Per ────────────────────────────────────────────── */}
            <FormField label="Rate As Per" required className="mt-3">
              <SegmentedControl
                name="Rate As Per"
                value={form.rate_basis}
                onChange={(v) => setField('rate_basis', v)}
                options={(catalogue?.rate_basis || []).map((b) => ({
                  value: b.value,
                  label: b.label,
                }))}
                columns={catalogue?.rate_basis?.length > 3 ? 4 : 3}
              />
            </FormField>

            {/* ── Rate value + quantity ──────────────────────────────────── */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label={rateLabel} required error={fieldErrors.rate_value}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-bt-ink-3">
                    ₹
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={form.rate_value}
                    onChange={(e) => setField('rate_value', e.target.value)}
                    placeholder="0.00"
                    className={`bt-input bt-input-sm pl-8 ${fieldErrors.rate_value ? 'border-bt-danger' : ''}`}
                  />
                </div>
              </FormField>

              {needsQuantity ? (
                <FormField
                  label={rateBasis?.quantityLabel || 'Quantity'}
                  required
                  error={fieldErrors.rate_quantity}
                  hint={rateBasis?.unit ? `Counted in ${rateBasis.unit}` : undefined}
                >
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      value={form.rate_quantity}
                      onChange={(e) => setField('rate_quantity', e.target.value)}
                      placeholder="0"
                      className={`bt-input bt-input-sm pr-14 ${fieldErrors.rate_quantity ? 'border-bt-danger' : ''}`}
                    />
                    {rateBasis?.unit ? (
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[13px] font-medium text-bt-ink-3">
                        {rateBasis.unit}
                      </span>
                    ) : null}
                  </div>
                </FormField>
              ) : null}
            </div>

            {/* ── Commission ─────────────────────────────────────────────── */}
            <div className="mt-3 border-t border-bt-border pt-3">
              <FormField label="Commission" required>
                <SegmentedControl
                  name="Commission Type"
                  value={form.commission_type}
                  onChange={(v) => {
                    setField('commission_type', v);
                    // Switching to "No Commission" clears the rate so a stale
                    // percentage can never be silently applied.
                    if (v === 'NO_COMMISSION') setField('commission_rate', '0');
                  }}
                  options={(catalogue?.commission_types || []).map((o) => ({
                    value: o.value,
                    label: o.label,
                    hint: o.hint,
                  }))}
                  columns={3}
                />
              </FormField>

              {form.commission_type !== 'NO_COMMISSION' ? (
                <div className="mt-2 max-w-[200px]">
                  <FormField
                    label={form.commission_type === 'FIXED' ? 'Commission Amount' : 'Commission Percentage'}
                    required
                    error={fieldErrors.commission_rate}
                  >
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-bt-ink-3">
                        {form.commission_type === 'FIXED' ? '₹' : <Percent className="h-4 w-4" strokeWidth={2.2} />}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={form.commission_rate}
                        onChange={(e) => setField('commission_rate', e.target.value)}
                        placeholder="0"
                        className={`bt-input bt-input-sm pl-8 ${fieldErrors.commission_rate ? 'border-bt-danger' : ''}`}
                      />
                    </div>
                  </FormField>
                </div>
              ) : (
                <p className="mt-2 text-[11.5px] text-bt-ink-2">
                  No commission on this hire. Both figures are ₹0.
                </p>
              )}
            </div>

            {/* ── Remarks ────────────────────────────────────────────────── */}
            <div className="mt-3">
              <FormField label="Remarks" hint="Optional notes about this vehicle hiring">
                <textarea
                  value={form.remarks}
                  onChange={(e) => setField('remarks', e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="e.g. Driver to report at the loading point by 6 PM."
                  className="bt-textarea bt-input-sm resize-y"
                />
              </FormField>
            </div>
          </SectionCard>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
           RIGHT COLUMN — financial summary + actions
           ══════════════════════════════════════════════════════════════════ */}
        <div className="space-y-4">
          {/* ── LIVE FINANCIAL CALCULATION ─────────────────────────────── */}
          <SectionCard
            title="Hire Financial Summary"
            subtitle="Gross − Commission = Net Vendor Payable"
            icon={Percent}
            bodyClass="p-5"
            action={previewing ? <span className="text-[11.5px] text-bt-ink-2 flex items-center gap-1.5"><span className="h-3 w-3 animate-spin rounded-full border-2 border-bt-ink-3 border-t-transparent"></span>Calculating</span> : null}
          >
            <div className="relative overflow-hidden rounded-xl border border-bt-border bg-gradient-to-br from-white to-bt-surface-soft p-4">
              <dl className="space-y-1">
                <MoneyLine
                  label="Gross Hire"
                  value={money?.gross_hire ?? localGross ?? 0}
                  muted={!money && localGross === null}
                />
                <MoneyLine
                  label="Commission"
                  value={money?.commission_amount ?? 0}
                  prefix="−"
                  tone="muted"
                  muted={!money}
                  caption={
                    form.commission_type === 'NO_COMMISSION'
                      ? 'No commission'
                      : form.commission_type === 'FIXED'
                        ? `Fixed ${inr(form.commission_rate)}`
                        : `${form.commission_rate}%`
                  }
                />
                <div className="my-3 h-px w-full bg-gradient-to-r from-bt-border via-bt-border-strong to-bt-border"></div>
                <div className="rounded-lg bg-[rgba(245,160,0,0.08)] px-3 py-2">
                  <MoneyLine
                    label="Net Vendor Payable"
                    value={money?.net_vendor_payable ?? 0}
                    emphasis
                    muted={!money}
                  />
                </div>
              </dl>
            </div>

            {previewError ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                {previewError}
              </p>
            ) : null}

            {saveError ? (
              <p className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-[12px] text-red-800" role="alert">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
                {saveError}
              </p>
            ) : null}

            <p className="mt-4 text-[12px] leading-relaxed text-bt-ink-2">
              Hiring this vehicle creates an obligation only. No payment is recorded here — the vendor
              is paid later through the vendor payment ledger.
            </p>

            {/* ── ACTIONS ──────────────────────────────────────────────── */}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-bt-border pt-4">
              {!embedded ? (
                <Button variant="secondary" size="sm" onClick={() => navigate(`/admin/trips/${trip.trip_id}`)} disabled={saving}>
                  Cancel
                </Button>
              ) : null}
              <Button
                variant="accent"
                size="sm"
                icon={Truck}
                loading={saving}
                disabled={!canSubmit}
                onClick={handleSubmit}
              >
                {saving
                  ? (editMode ? 'Saving…' : 'Hiring…')
                  : (editMode ? 'Save Changes' : 'Hire Vehicle')}
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── Toast, in the console's existing style ───────────────────────── */}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div
            role="status"
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-[13px] font-medium text-white shadow-lg ${
              toast.type === 'error' ? 'bg-red-500' : 'bg-emerald-600'
            }`}
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </>
  );
}

export { MoneyLine };

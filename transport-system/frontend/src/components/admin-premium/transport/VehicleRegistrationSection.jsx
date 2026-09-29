import React, { useState, useCallback, useEffect, useRef } from 'react';
import { adminAPI } from '../../../services/api';
import { planRcFill, buildRcStatusMessage, buildRcDisplayRows } from './rcLookupStatus';
import RcApiDataSection from './RcApiDataSection';

const VEHICLE_TYPES = [
  'Mahindra Bolero Pickup',
  'Tata Ace (Chhota Hathi)',
  'Tata Yodha',
  'Ashok Leyland Dost',
  'Mahindra Jeeto',
  'Pickup Truck',
  'Mini Truck',
  '14 ft Truck',
  '17 ft Truck',
  '19 ft Truck',
  '22 ft Truck',
  'Trailer',
  'Container',
  'Other'
];

// Indian RC format: SS NN SSSS NNNN (BR09AB1234, MH01CL3390, BH01AA1234).
// Mirrors the backend validation in services/vehicleLookupService.js.
const RC_PATTERN = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$/;

const normalizeRc = (value) => (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const isValidRc = (value) => RC_PATTERN.test(normalizeRc(value));

// RC field mapping and status-message logic live in ./rcLookupStatus.js so they
// can be unit tested independently of React.

function toSearchable(text) {
  return (text || '').toLowerCase();
}

function SearchableSelect({ value, onChange, options, placeholder, inputClass, error, displayRenderer, onOpenChange }) {
  const [query, setQuery] = useState(value);
  const [filtered, setFiltered] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (open) {
      const q = toSearchable(query);
      setFiltered(options.filter(o => toSearchable(displayRenderer ? displayRenderer(o) : o).includes(q)));
    } else {
      setFiltered([]);
    }
  }, [query, open, options, displayRenderer]);

  const select = (option) => {
    onChange(option);
    setQuery(displayRenderer ? displayRenderer(option) : option);
    setOpen(false);
    onOpenChange?.(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onOpenChange?.(true); }}
          onFocus={() => { setOpen(true); onOpenChange?.(true); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered.length === 1) select(filtered[0]);
              else if (query.trim()) { onChange(query.trim()); setOpen(false); onOpenChange?.(false); }
            }
          }}
          placeholder={placeholder || 'Select...'}
          autoComplete="off"
          className={`${inputClass} ${error ? 'border-red-500/50' : 'border-border/60'}`}
        />
        <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-gray-800 border border-border/60 rounded-xl shadow-2xl max-h-48 overflow-y-auto">
          {filtered.map(option => (
            <button
              key={option.owner_id || option.driver_id || option.vehicle_id}
              type="button"
              onClick={() => select(option)}
              className="w-full text-left px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
            >
              {displayRenderer ? displayRenderer(option) : option}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-30 w-full mt-1.5 bg-white dark:bg-gray-800 border border-border/60 rounded-xl shadow-2xl">
          <div className="px-4 py-3 text-sm text-muted">No matching results</div>
        </div>
      )}
    </div>
  );
}

export default function VehicleRegistrationSection({
 formData,
 errors,
 onChange,
 onErrorsChange,
 context,
 createdOwner,
 createdDriver,
 initialOwner = null,
 initialDriver = null,
}) {
  const [owners, setOwners] = useState([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [ownerType, setOwnerType] = useState('');
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const ownerWrapperRef = useRef(null);

  // RC lookup (backend -> Parse CarInfo). The Parse API key stays server-side;
  // this component only ever talks to our own API. Nothing is rendered until
  // the admin explicitly clicks "Fetch RC".
  const [rcStatus, setRcStatus] = useState('idle'); // idle | loading | success | error
  const [rcMessage, setRcMessage] = useState('');
  const [rcData, setRcData] = useState(null); // null until a lookup succeeds
  const [rcVehicleNumber, setRcVehicleNumber] = useState('');
  // Form fields the last lookup populated, so the manual section does not ask
  // the admin to type something the RC already supplied.
  const [rcFilledFields, setRcFilledFields] = useState([]);
  // Fields the admin chose to override by hand (reveals the input again).
  const [rcOverrideFields, setRcOverrideFields] = useState([]);
  const rcLookupDoneRef = useRef(null);
  const rcLookupConfiguredRef = useRef(null);

  // Hide the "Fetch RC" affordance when the server has no Parse key configured,
  // instead of letting the admin trigger a guaranteed 503.
  useEffect(() => {
    let active = true;
    adminAPI
      .getVehicleLookupStatus()
      .then((res) => {
        if (active && res.data?.success) rcLookupConfiguredRef.current = res.data?.data?.configured === true;
      })
      .catch(() => {
        // Stay optimistic on a transient network failure — the lookup itself
        // surfaces a real message if it is genuinely unavailable.
        if (active) rcLookupConfiguredRef.current = true;
      });
    return () => { active = false; };
  }, []);

  // Fetch transport owners for dropdown
  useEffect(() => {
    let active = true;
    const fetchOwners = async () => {
      setOwnersLoading(true);
      try {
        const res = await adminAPI.getVehicleOwners({ search: ownerSearch, limit: 50, status: 'active' });
        if (active && res.data?.success) {
          setOwners(res.data.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch vehicle owners:', err);
      } finally {
        if (active) setOwnersLoading(false);
      }
    };
    if (ownerOpen || ownerSearch) {
      fetchOwners();
    }
    return () => { active = false; };
  }, [ownerSearch, ownerOpen]);

  // Fetch drivers for dropdown - filtered by selected owner
  useEffect(() => {
    let active = true;
    const fetchDrivers = async () => {
      setDriversLoading(true);
      try {
        if (selectedOwner) {
          const res = await adminAPI.getDrivers({
            transport_owner_id: selectedOwner.owner_id,
            limit: 100
          });
          if (active && res.data?.success) {
            setDrivers(res.data.data || []);
          }
        } else {
          const res = await adminAPI.getDrivers({ limit: 100 });
          if (active && res.data?.success) {
            setDrivers(res.data.data || []);
          }
        }
      } catch (err) {
        console.error('Failed to fetch drivers:', err);
      } finally {
        if (active) setDriversLoading(false);
      }
    };
    fetchDrivers();
    return () => { active = false; };
  }, [selectedOwner]);

  // Close owner dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ownerWrapperRef.current && !ownerWrapperRef.current.contains(e.target)) {
        setOwnerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Pre-select owner from context or created owner
 useEffect(() => {
   if (createdOwner || context.ownerId || selectedOwner) return;
   if (!initialOwner?.owner_id) return;

   setSelectedOwner(initialOwner);
   onChange('owner_id', String(initialOwner.owner_id));
   setOwnerType(initialOwner.owner_type || '');
 }, [createdOwner, context.ownerId, initialOwner, onChange, selectedOwner]);

 // Pre-select driver from context or created driver
 useEffect(() => {
   if (createdDriver) {
     onChange('driver_id', String(createdDriver.driver_id));
   } else if (context.driverId) {
     onChange('driver_id', String(context.driverId));
   } else if (!formData.driver_id && initialDriver?.driver_id) {
     onChange('driver_id', String(initialDriver.driver_id));
   }
 }, [createdDriver, context.driverId, formData.driver_id, initialDriver, onChange]);

  const handleChange = useCallback((e) => {
    const { name, value, type } = e.target;
    onChange(name, type === 'number' ? (value === '' ? '' : Number(value)) : value);
    if (errors[name]) {
      onErrorsChange(prev => ({ ...prev, [name]: '' }));
    }
  }, [errors, onChange, onErrorsChange]);

  /**
   * Write RC values into the form — never overwriting admin-typed input.
   * Delegates the decision to planRcFill() so it stays unit testable.
   */
  const applyRcData = useCallback((rc) => {
    const plan = planRcFill(formData, rc, { vehicleTypeOptions: VEHICLE_TYPES });
    plan.filled.forEach(({ field, value }) => onChange(field, value));
    return plan;
  }, [formData, onChange]);

  /** A manual input is suppressed only while the RC value stands unreviewed. */
  const isFilledFromRc = useCallback(
    (field) => rcFilledFields.includes(field) && !rcOverrideFields.includes(field),
    [rcFilledFields, rcOverrideFields],
  );

  const revealManualInput = useCallback((field) => {
    setRcOverrideFields((prev) => (prev.includes(field) ? prev : [...prev, field]));
  }, []);

  /**
   * Look the RC up via our backend (which holds the Parse CarInfo key) and
   * auto-fill the matching empty fields. Failures are non-blocking: the admin
   * always types the remaining details manually.
   */
  const runRcLookup = useCallback(async (rawValue) => {
    const vehicleNumber = normalizeRc(rawValue);
    if (!isValidRc(vehicleNumber)) return null;
    if (rcLookupConfiguredRef.current === false) return null;
    // Never issue a second call for a number we already resolved — this is what
    // keeps repeated "Fetch RC" clicks from burning Parse credits.
    if (rcLookupDoneRef.current === vehicleNumber) return null;

    setRcStatus('loading');
    setRcMessage('Fetching RC details...');

    try {
      const res = await adminAPI.lookupVehicleByNumber(vehicleNumber);
      const rc = res.data?.data;
      const warnings = res.data?.warnings || [];
      // A lookup is successful when the backend says so and did not explicitly
      // report `found: false`. Do NOT require the `found` flag to be present:
      // a successful response that simply omits it must never be misreported
      // to the admin as "no RC record found".
      const isSuccess = res.data?.success === true && res.data?.found !== false
        && rc && typeof rc === 'object';

      if (isSuccess) {
        const { filled, skippedAsFilled, rcUsable, notApplicable } = applyRcData(rc);
        const resolvedNumber = res.data?.vehicleNumber || vehicleNumber;
        const rcWithIdentity = { ...rc, vehicleIdentityVerified: res.data?.vehicleIdentityVerified };

        rcLookupDoneRef.current = vehicleNumber;
        setRcStatus('success');
        setRcData(rcWithIdentity);
        setRcVehicleNumber(resolvedNumber);
        setRcFilledFields(filled.map((f) => f.field));
        setRcOverrideFields([]);
        setRcMessage(buildRcStatusMessage({
          found: res.data?.found,
          filled,
          skippedAsFilled,
          rcUsable,
          notApplicable,
          warnings,
          // Count what the RC Data section actually shows.
          availableCount: buildRcDisplayRows(rcWithIdentity, { vehicleNumber: resolvedNumber }).length,
        }));
        return rc;
      }

      // Not found / unusable: allow a retry later.
      rcLookupDoneRef.current = null;
      setRcData(null);
      setRcVehicleNumber('');
      setRcFilledFields([]);
      setRcOverrideFields([]);
      setRcStatus('error');
      setRcMessage(
        res.data?.found === false
          ? 'No RC record found for this number.'
          : res.data?.message || 'Unable to fetch RC details. Please try again or enter the information manually.'
      );
      return null;
    } catch (err) {
      // Never surface raw axios errors, stack traces or upstream bodies.
      rcLookupDoneRef.current = null;
      setRcData(null);
      setRcVehicleNumber('');
      setRcFilledFields([]);
      setRcOverrideFields([]);
      setRcStatus('error');
      setRcMessage(
        'Unable to fetch RC details. Please try again or enter the information manually.'
      );
      return null;
    }
  }, [applyRcData]);

  const handleVehicleNumberChange = useCallback((e) => {
    onChange('vehicle_number', e.target.value.toUpperCase().replace(/\s+/g, '').slice(0, 10));
    if (errors.vehicle_number) {
      onErrorsChange(prev => ({ ...prev, vehicle_number: '' }));
    }
    // Any edit re-arms the lookup and clears the RC section, so a previous
    // vehicle's data can never leak into the next one.
    rcLookupDoneRef.current = null;
    setRcStatus('idle');
    setRcMessage('');
    setRcData(null);
    setRcVehicleNumber('');
    setRcFilledFields([]);
    setRcOverrideFields([]);
  }, [errors, onChange, onErrorsChange]);

  const handleOwnerSelect = useCallback((owner) => {
    onChange('owner_id', String(owner.owner_id));
    onChange('driver_id', '');
    setOwnerType(owner.owner_type || '');
    setSelectedOwner(owner);
    setOwnerSearch('');
    setOwnerOpen(false);
    if (errors.owner_id) {
      onErrorsChange(prev => ({ ...prev, owner_id: '' }));
    }
    if (errors.driver_id) {
      onErrorsChange(prev => ({ ...prev, driver_id: '' }));
    }
  }, [errors, onChange, onErrorsChange]);

  const inputCls = (f) =>
    `w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${
      errors[f] ? 'border-red-500/50' : 'border-border/60'
    }`;

  const labelCls = 'block text-sm font-medium mb-1.5';

  // Numbered pill for the guided steps; a plain dot for un-numbered sections.
  const StepHeader = ({ step, title, hint }) => (
    <div className="flex items-center gap-2">
      {step ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500 text-[10px] font-bold text-white">
          {step}
        </span>
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-purple-500" />
      )}
      <span className="text-xs font-semibold text-muted uppercase tracking-wider">{title}</span>
      {hint && <span className="text-[11px] font-normal normal-case tracking-normal text-muted">{hint}</span>}
    </div>
  );

  /** Compact read-only row shown in place of an input the RC already filled. */
  const RcFilledNote = ({ label, value, onEdit }) => (
    <div className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/50 dark:bg-emerald-900/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</span>
        <button
          type="button"
          onClick={onEdit}
          className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-purple-600 hover:text-purple-700 dark:text-purple-400"
        >
          Change
        </button>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="truncate text-sm font-semibold text-text" title={value}>{value}</span>
        <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          ✓ RC
        </span>
      </div>
    </div>
  );

  return (
    <fieldset className="space-y-5 border border-purple-200 dark:border-purple-800 rounded-2xl p-5 bg-purple-50/30 dark:bg-purple-900/10">
      <legend className="flex items-center gap-2 px-3 py-1 bg-purple-100 dark:bg-purple-900/30 rounded-xl text-sm font-semibold text-purple-700 dark:text-purple-300">
        <span className="text-xl">🚛</span>
        <span>Vehicle</span>
      </legend>

      {/* ── STEP 1 — Vehicle Identification ─────────────────────────── */}
      <div className="space-y-3">
        <StepHeader step={1} title="Vehicle Identification" />
        <div>
          <label className={labelCls}>
            Vehicle Number <span className="text-red-500">*</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              name="vehicle_number"
              value={formData.vehicle_number || ''}
              onChange={handleVehicleNumberChange}
              onBlur={(e) => runRcLookup(e.target.value)}
              placeholder="BR09AB1234"
              maxLength={10}
              className={`${inputCls('vehicle_number')} min-w-0 font-mono tracking-wider`}
            />
            <button
              type="button"
              // Keep focus on the input so onBlur does not double-fire a lookup.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runRcLookup(formData.vehicle_number)}
              disabled={rcStatus === 'loading' || !isValidRc(formData.vehicle_number)}
              title="Fetch RC details for this registration number"
              className="shrink-0 px-3 py-2.5 rounded-xl border border-amber-500/40 text-amber-600 dark:text-amber-400 text-sm font-medium hover:bg-amber-500/10 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {rcStatus === 'loading'
                ? 'Fetching...'
                : rcData ? 'Refresh RC' : 'Fetch RC'}
            </button>
          </div>
          {errors.vehicle_number && <p className="text-xs text-red-500 mt-1">{errors.vehicle_number}</p>}
          {rcMessage && (
            <p className={`text-xs mt-1 ${rcStatus === 'error' ? 'text-amber-600 dark:text-amber-400' : 'text-muted'}`}>
              {rcMessage}
            </p>
          )}
        </div>
      </div>

      {/* ── STEP 2 — RC Details (only after a successful fetch) ─────── */}
      <div className="space-y-3">
        <StepHeader step={2} title="RC Details" hint="Fetched from RC" />
        {rcStatus === 'success' && rcData ? (
          <RcApiDataSection data={rcData} vehicleNumber={rcVehicleNumber} />
        ) : (
          <p className="rounded-xl border border-dashed border-border bg-card/30 px-3 py-2.5 text-xs text-muted">
            Enter the vehicle registration number and click <span className="font-semibold text-text">Fetch RC</span> to
            automatically retrieve available vehicle information.
          </p>
        )}
      </div>

      {/* ── STEP 3 — Manual Vehicle Information ─────────────────────── */}
      <div className="border-t border-border/40 pt-4 space-y-4">
        <StepHeader step={3} title="Vehicle Information" hint="Complete the remaining details" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Vehicle Type */}
          <div>
            <label className={labelCls}>
              Vehicle Type <span className="text-red-500">*</span>
            </label>
            <select
              name="vehicle_type"
              value={formData.vehicle_type || ''}
              onChange={(e) => onChange('vehicle_type', e.target.value)}
              className={inputCls('vehicle_type')}
            >
              <option value="">Select type</option>
              {VEHICLE_TYPES.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
            {errors.vehicle_type && <p className="text-xs text-red-500 mt-1">{errors.vehicle_type}</p>}
          </div>

          {/* Vehicle Name */}
          <div>
            {isFilledFromRc('vehicle_name') ? (
              <RcFilledNote label="Vehicle Name *" value={formData.vehicle_name}
                onEdit={() => revealManualInput('vehicle_name')} />
            ) : (
              <>
                <label className={labelCls}>
                  Vehicle Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  name="vehicle_name"
                  value={formData.vehicle_name || ''}
                  onChange={(e) => onChange('vehicle_name', e.target.value)}
                  placeholder="e.g. Tata Ace"
                  className={inputCls('vehicle_name')}
                />
                {errors.vehicle_name && <p className="text-xs text-red-500 mt-1">{errors.vehicle_name}</p>}
              </>
            )}
          </div>

          {/* Registration Date */}
          <div>
            {isFilledFromRc('registration_date') ? (
              <RcFilledNote label="Registration Date" value={formData.registration_date}
                onEdit={() => revealManualInput('registration_date')} />
            ) : (
              <>
                <label className={labelCls}>Registration Date</label>
                <input
                  type="date"
                  name="registration_date"
                  value={formData.registration_date || ''}
                  onChange={(e) => onChange('registration_date', e.target.value)}
                  className={inputCls('registration_date')}
                />
              </>
            )}
          </div>

          {/* Capacity (kg) */}
          <div>
            <label className={labelCls}>Capacity (kg)</label>
            <input
              type="number"
              name="capacity_kg"
              value={formData.capacity_kg || ''}
              onChange={(e) => onChange('capacity_kg', e.target.value)}
              placeholder="e.g. 25000"
              className={inputCls('capacity_kg')}
            />
          </div>

          {/* Capacity Volume */}
          <div>
            <label className={labelCls}>Capacity Volume (cubic m)</label>
            <input
              type="number"
              name="capacity_volume"
              value={formData.capacity_volume || ''}
              onChange={(e) => onChange('capacity_volume', e.target.value)}
              placeholder="e.g. 50"
              className={inputCls('capacity_volume')}
            />
          </div>

          {/* Vehicle Make */}
          <div>
            {isFilledFromRc('vehicle_make') ? (
              <RcFilledNote label="Make" value={formData.vehicle_make}
                onEdit={() => revealManualInput('vehicle_make')} />
            ) : (
              <>
                <label className={labelCls}>Make</label>
                <input
                  type="text"
                  name="vehicle_make"
                  value={formData.vehicle_make || ''}
                  onChange={(e) => onChange('vehicle_make', e.target.value)}
                  placeholder="e.g. Tata"
                  className={inputCls('vehicle_make')}
                />
              </>
            )}
          </div>

          {/* Vehicle Model */}
          <div>
            {isFilledFromRc('vehicle_model') ? (
              <RcFilledNote label="Model" value={formData.vehicle_model}
                onEdit={() => revealManualInput('vehicle_model')} />
            ) : (
              <>
            <label className={labelCls}>Model</label>
            <input
              type="text"
              name="vehicle_model"
              value={formData.vehicle_model || ''}
              onChange={(e) => onChange('vehicle_model', e.target.value)}
              placeholder="e.g. Ace"
              className={inputCls('vehicle_model')}
            />
              </>
            )}
          </div>

          {/* Manufacturing Year */}
          <div>
            <label className={labelCls}>Manufacturing Year</label>
            <input
              type="number"
              name="manufacturing_year"
              value={formData.manufacturing_year || ''}
              onChange={(e) => onChange('manufacturing_year', e.target.value)}
              placeholder="e.g. 2022"
              min={1990}
              max={new Date().getFullYear() + 1}
              className={inputCls('manufacturing_year')}
            />
          </div>
        </div>
      </div>

      {/* ── STEP 4 — Documents ───────────────────────────────────────── */}
      <div className="border-t border-border/40 pt-4 space-y-4">
        <StepHeader step={4} title="Documents" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Insurance Number */}
          <div>
            <label className={labelCls}>Insurance Number</label>
            <input
              type="text"
              name="insurance_number"
              value={formData.insurance_number || ''}
              onChange={(e) => onChange('insurance_number', e.target.value)}
              placeholder="Insurance policy number"
              className={inputCls('insurance_number')}
            />
          </div>

          {/* Insurance Expiry */}
          <div>
            {isFilledFromRc('insurance_expiry') ? (
              <RcFilledNote label="Insurance Expiry" value={formData.insurance_expiry}
                onEdit={() => revealManualInput('insurance_expiry')} />
            ) : (
              <>
                <label className={labelCls}>Insurance Expiry</label>
                <input
                  type="date"
                  name="insurance_expiry"
                  value={formData.insurance_expiry || ''}
                  onChange={(e) => onChange('insurance_expiry', e.target.value)}
                  className={inputCls('insurance_expiry')}
                />
              </>
            )}
          </div>

          {/* Permit Number */}
          <div>
            <label className={labelCls}>Permit Number</label>
            <input
              type="text"
              name="permit_number"
              value={formData.permit_number || ''}
              onChange={(e) => onChange('permit_number', e.target.value)}
              placeholder="Permit number"
              className={inputCls('permit_number')}
            />
          </div>

          {/* Permit Expiry */}
          <div>
            <label className={labelCls}>Permit Expiry</label>
            <input
              type="date"
              name="permit_expiry"
              value={formData.permit_expiry || ''}
              onChange={(e) => onChange('permit_expiry', e.target.value)}
              className={inputCls('permit_expiry')}
            />
          </div>

          {/* Pollution Certificate */}
          <div>
            <label className={labelCls}>Pollution Certificate</label>
            <input
              type="text"
              name="pollution_certificate"
              value={formData.pollution_certificate || ''}
              onChange={(e) => onChange('pollution_certificate', e.target.value)}
              placeholder="Certificate number"
              className={inputCls('pollution_certificate')}
            />
          </div>

          {/* Pollution Expiry */}
          <div>
            {isFilledFromRc('pollution_expiry') ? (
              <RcFilledNote label="Pollution Expiry" value={formData.pollution_expiry}
                onEdit={() => revealManualInput('pollution_expiry')} />
            ) : (
              <>
                <label className={labelCls}>Pollution Expiry</label>
                <input
                  type="date"
                  name="pollution_expiry"
                  value={formData.pollution_expiry || ''}
                  onChange={(e) => onChange('pollution_expiry', e.target.value)}
                  className={inputCls('pollution_expiry')}
                />
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── STEP 5 — Additional Details ─────────────────────────────── */}
      <div className="border-t border-border/40 pt-4 space-y-4">
        <StepHeader step={5} title="Additional Details" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Base Location */}
          <div>
            <label className={labelCls}>Base Location</label>
            <input
              type="text"
              name="base_location"
              value={formData.base_location || ''}
              onChange={(e) => onChange('base_location', e.target.value)}
              placeholder="e.g. Begusarai Depot"
              className={inputCls('base_location')}
            />
          </div>

          {/* Hourly Rate */}
          <div>
            <label className={labelCls}>Hourly Rate (₹)</label>
            <input
              type="number"
              name="hourly_rate"
              value={formData.hourly_rate || ''}
              onChange={(e) => onChange('hourly_rate', e.target.value)}
              placeholder="e.g. 500"
              step="0.01"
              className={inputCls('hourly_rate')}
            />
          </div>

          {/* Per KM Rate */}
          <div>
            <label className={labelCls}>Per KM Rate (₹)</label>
            <input
              type="number"
              name="per_km_rate"
              value={formData.per_km_rate || ''}
              onChange={(e) => onChange('per_km_rate', e.target.value)}
              placeholder="e.g. 25"
              step="0.01"
              className={inputCls('per_km_rate')}
            />
          </div>

          {/* Current Status */}
          <div>
            <label className={labelCls}>
              Status <span className="text-red-500">*</span>
            </label>
            <select
              name="current_status"
              value={formData.current_status || 'available'}
              onChange={(e) => onChange('current_status', e.target.value)}
              className={inputCls('current_status')}
            >
              <option value="available">Available</option>
              <option value="on_trip">On Trip</option>
              <option value="maintenance">Maintenance</option>
              <option value="inactive">Inactive</option>
            </select>
            {errors.current_status && <p className="text-xs text-red-500 mt-1">{errors.current_status}</p>}
          </div>
        </div>
      </div>

      {/* Transport Owner & Driver Assignment (Optional) */}
      <div className="border-t border-border/40 pt-4 space-y-5">
        <StepHeader title="Transport Owner & Driver Assignment" hint="(optional)" />

        {/* Transport Owner Selection */}
        <div className="space-y-3" ref={ownerWrapperRef}>
          <label className={labelCls}>
            Transport Owner
          </label>
          <SearchableSelect
            value={selectedOwner ? `${selectedOwner.owner_name} (${selectedOwner.owner_code || selectedOwner.owner_id})` : ''}
            onChange={handleOwnerSelect}
            options={owners}
            placeholder="Search transport owner by name or code... (optional)"
            inputClass={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${errors.owner_id ? 'border-red-500/50' : 'border-border/60'}`}
            error={errors.owner_id}
            displayRenderer={(o) => `${o.owner_name} (${o.owner_code || o.owner_id}) • ${o.city || ''}`}
            onOpenChange={(open) => setOwnerOpen(open)}
          />
          {errors.owner_id && <p className="text-xs text-red-500 mt-1">{errors.owner_id}</p>}

          {/* Selected Owner Display */}
          {selectedOwner && (
            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-xs font-bold text-amber-700 dark:text-amber-400">
                  {selectedOwner.owner_name?.charAt(0) || 'O'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-amber-900 dark:text-amber-200 truncate">{selectedOwner.owner_name}</div>
                  <div className="text-xs text-amber-700 dark:text-amber-400 font-mono">
                    {selectedOwner.owner_code || `ID: ${selectedOwner.owner_id}`} • {selectedOwner.city || ''}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Driver Selection */}
        <div className="space-y-3">
          <label className={labelCls}>
            Driver
          </label>
          <SearchableSelect
            value={drivers.find(d => String(d.driver_id) === String(formData.driver_id)) 
              ? `${drivers.find(d => String(d.driver_id) === String(formData.driver_id)).driver_name} (${drivers.find(d => String(d.driver_id) === String(formData.driver_id)).driver_code || drivers.find(d => String(d.driver_id) === String(formData.driver_id)).driver_id})` 
              : ''}
            onChange={(driver) => {
              onChange('driver_id', String(driver.driver_id));
              if (errors.driver_id) {
                onErrorsChange(prev => ({ ...prev, driver_id: '' }));
              }
            }}
            options={drivers}
            placeholder="Search driver by name or mobile... (optional)"
            inputClass={`w-full px-3 py-2.5 rounded-xl border text-sm bg-card/40 focus:outline-none focus:ring-2 focus:ring-amber-500/30 transition ${errors.driver_id ? 'border-red-500/50' : 'border-border/60'}`}
            error={errors.driver_id}
            displayRenderer={(d) => `${d.driver_name} (${d.driver_code || d.driver_id}) • ${d.mobile}`}
            onOpenChange={() => {}}
          />
          {errors.driver_id && <p className="text-xs text-red-500 mt-1">{errors.driver_id}</p>}

          {/* Selected Driver Display */}
          {formData.driver_id && (
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-xs font-bold text-purple-700 dark:text-purple-400">
                  {drivers.find(d => String(d.driver_id) === String(formData.driver_id))?.driver_name?.charAt(0) || 'D'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-purple-900 dark:text-purple-200 truncate">
                    {drivers.find(d => String(d.driver_id) === String(formData.driver_id))?.driver_name}
                  </div>
                  <div className="text-xs text-purple-700 dark:text-purple-400 font-mono">
                    {drivers.find(d => String(d.driver_id) === String(formData.driver_id))?.driver_code || `ID: ${formData.driver_id}`} • {drivers.find(d => String(d.driver_id) === String(formData.driver_id))?.mobile}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Assign Owner-Driver Relationship */}
        {selectedOwner && formData.driver_id && (
          <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-800/30 cursor-pointer">
            <input
              type="checkbox"
              name="assign_owner_driver"
              checked={formData.assign_owner_driver}
              onChange={(e) => onChange('assign_owner_driver', e.target.checked)}
              className="w-5 h-5 text-amber-500 border-border/60 rounded focus:ring-amber-500/30"
            />
            <div className="flex-1">
              <div className="font-medium text-text">Assign this driver to the selected transport owner</div>
              <div className="text-sm text-muted">Creates the owner-driver relationship in the system</div>
            </div>
          </label>
        )}
      </div>
    </fieldset>
  );
}
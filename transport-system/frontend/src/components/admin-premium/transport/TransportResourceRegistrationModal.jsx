import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { adminAPI } from '../../../services/api';
import OwnerRegistrationSection from './OwnerRegistrationSection';
import DriverRegistrationSection from './DriverRegistrationSection';
import VehicleRegistrationSection from './VehicleRegistrationSection';

const RESOURCE_TYPES = [
  { key: 'owner', label: 'Transport Owner', icon: '🏢', description: 'Register a transport company or individual owner' },
  { key: 'driver', label: 'Driver', icon: '👨‍✈️', description: 'Register a driver with license details' },
  { key: 'vehicle', label: 'Vehicle', icon: '🚛', description: 'Register a vehicle with documents' },
];

export default function TransportResourceRegistrationModal({
  isOpen,
  onClose,
  onSuccess,
  // Context for pre-selection
  context = {}, // { ownerId, driverId, vehicleId, sourcePage }
}) {
  const [selectedResources, setSelectedResources] = useState({
    owner: false,
    driver: false,
    vehicle: false,
  });
  const [step, setStep] = useState('select'); // 'select' | 'form' | 'success'
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [createdEntities, setCreatedEntities] = useState({});
  const [toast, setToast] = useState(null);

  // Form data for each resource
  const [formData, setFormData] = useState({
    owner: {},
    driver: {},
    vehicle: {},
  });

  // Validation errors for each resource
  const [errors, setErrors] = useState({
    owner: {},
    driver: {},
    vehicle: {},
  });

  // Refs for focus management
  const firstInputRef = useRef(null);

  // Initialize from context
  useEffect(() => {
    if (isOpen && step === 'select') {
      const initialSelection = { owner: false, driver: false, vehicle: false };
      
      // Auto-select based on context
      if (context.ownerId) initialSelection.owner = true;
      if (context.driverId) initialSelection.driver = true;
      if (context.vehicleId) initialSelection.vehicle = true;
      
      // If no context, default to all three for flexibility
      if (!context.ownerId && !context.driverId && !context.vehicleId) {
        initialSelection.owner = true;
        initialSelection.driver = true;
        initialSelection.vehicle = true;
      }
      
      setSelectedResources(initialSelection);
      setFormData({ owner: {}, driver: {}, vehicle: {} });
      setErrors({ owner: {}, driver: {}, vehicle: {} });
      setServerError(null);
      setCreatedEntities({});
      
      // Focus first input after render
      setTimeout(() => firstInputRef.current?.focus(), 100);
    }
  }, [isOpen, context, step]);

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('select');
      setSelectedResources({ owner: false, driver: false, vehicle: false });
      setFormData({ owner: {}, driver: {}, vehicle: {} });
      setErrors({ owner: {}, driver: {}, vehicle: {} });
      setServerError(null);
      setCreatedEntities({});
      setSubmitting(false);
    }
  }, [isOpen]);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const handleResourceToggle = useCallback((resource) => {
    setSelectedResources(prev => ({
      ...prev,
      [resource]: !prev[resource],
    }));
    // Clear errors for this resource when toggled
    setErrors(prev => ({ ...prev, [resource]: {} }));
  }, []);

  const handleFormDataChange = useCallback((resource, field, value) => {
    setFormData(prev => ({
      ...prev,
      [resource]: { ...prev[resource], [field]: value },
    }));
    // Clear error for this field
    setErrors(prev => ({
      ...prev,
      [resource]: { ...prev[resource], [field]: null },
    }));
  }, []);

  const handleFormErrorsChange = useCallback((resource, resourceErrors) => {
    setErrors(prev => ({ ...prev, [resource]: resourceErrors }));
  }, []);

  const validateAll = useCallback(() => {
    const newErrors = { owner: {}, driver: {}, vehicle: {} };
    let isValid = true;

    if (selectedResources.owner) {
      const ownerErrors = {};
      const ownerForm = formData.owner;
      if (!ownerForm.owner_name?.trim()) ownerErrors.owner_name = 'Owner name is required';
      const rawPhone = ownerForm.phone?.replace(/\D/g, '') || '';
      if (!rawPhone) ownerErrors.phone = 'Phone number is required';
      else if (!/^[6-9]\d{9}$/.test(rawPhone)) ownerErrors.phone = 'Enter a valid 10-digit phone number';
      if (!ownerForm.city?.trim()) ownerErrors.city = 'City is required';
      const commission = parseFloat(ownerForm.commission_percentage);
      if (isNaN(commission) || commission < 0 || commission > 100) ownerErrors.commission_percentage = 'Commission must be 0-100%';
      
      if (Object.keys(ownerErrors).length > 0) {
        newErrors.owner = ownerErrors;
        isValid = false;
      }
    }

    if (selectedResources.driver) {
      const driverErrors = {};
      const driverForm = formData.driver;
      if (!driverForm.driver_name?.trim()) driverErrors.driver_name = 'Driver name is required';
      const rawMobile = driverForm.mobile?.replace(/\D/g, '') || '';
      if (!rawMobile) driverErrors.mobile = 'Mobile number is required';
      else if (!/^[6-9]\d{9}$/.test(rawMobile)) driverErrors.mobile = 'Enter a valid 10-digit mobile number';
      if (!driverForm.license_number?.trim()) driverErrors.license_number = 'License number is required';
      // transport_owner_id is required unless is_self_owner
      if (!driverForm.is_self_owner && !driverForm.transport_owner_id) {
        driverErrors.transport_owner_id = 'Transport Owner is required (or enable "Driver is the vehicle owner")';
      }
      
      if (Object.keys(driverErrors).length > 0) {
        newErrors.driver = driverErrors;
        isValid = false;
      }
    }

    if (selectedResources.vehicle) {
      const vehicleErrors = {};
      const vehicleForm = formData.vehicle;
      if (!vehicleForm.vehicle_number?.trim()) vehicleErrors.vehicle_number = 'Vehicle number is required';
      if (!vehicleForm.vehicle_type?.trim()) vehicleErrors.vehicle_type = 'Vehicle type is required';
      if (!vehicleForm.vehicle_name?.trim()) vehicleErrors.vehicle_name = 'Vehicle name is required';
      if (!vehicleForm.owner_id) vehicleErrors.owner_id = 'Transport Owner is required';
      if (!vehicleForm.driver_id) vehicleErrors.driver_id = 'Driver is required';
      if (!vehicleForm.current_status) vehicleErrors.current_status = 'Status is required';
      
      if (Object.keys(vehicleErrors).length > 0) {
        newErrors.vehicle = vehicleErrors;
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  }, [selectedResources, formData]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    if (!validateAll()) return;

    setSubmitting(true);
    setServerError(null);
    const newEntities = {};

    try {
      // Create Owner first (if selected)
      if (selectedResources.owner) {
        const ownerPayload = {
          owner_name: formData.owner.owner_name.trim(),
          mobile: formData.owner.phone.replace(/\D/g, ''),
          city: formData.owner.city.trim(),
          commission_percentage: parseFloat(formData.owner.commission_percentage) || 10,
          company_name: formData.owner.company_name?.trim() || null,
          email: formData.owner.email?.trim() || null,
          state: formData.owner.state || 'Bihar',
          gst_number: formData.owner.gst_number?.trim() || null,
          pan_number: formData.owner.pan_number?.trim() || null,
          bank_name: formData.owner.bank_name?.trim() || null,
          bank_account: formData.owner.bank_account?.trim() || null,
          bank_ifsc: formData.owner.bank_ifsc?.trim() || null,
          upi_id: formData.owner.upi_id?.trim() || null,
          address: formData.owner.address?.trim() || null,
          alternate_mobile: formData.owner.alternate_mobile?.trim() || null,
        };
        const res = await adminAPI.createPartner(ownerPayload);
        if (res.data?.success) {
          newEntities.owner = res.data.data;
          showToast('✓ Transport Owner registered successfully.');
        } else {
          throw new Error(res.data?.message || 'Failed to create owner');
        }
      }

      // Create Driver (if selected)
      if (selectedResources.driver) {
        const driverPayload = {
          driver_name: formData.driver.driver_name.trim(),
          mobile: formData.driver.mobile.trim(),
          alternate_mobile: formData.driver.alternate_mobile?.trim() || undefined,
          vehicle_type: formData.driver.vehicle_type?.trim() || undefined,
          vehicle_number: formData.driver.vehicle_number?.trim().toUpperCase() || undefined,
          license_number: formData.driver.license_number?.trim() || undefined,
          license_expiry: formData.driver.license_expiry?.trim() || undefined,
          city: formData.driver.city?.trim() || undefined,
          state: formData.driver.state || 'Bihar',
          address: formData.driver.address?.trim() || undefined,
          emergency_contact: formData.driver.emergency_contact?.trim() || undefined,
          ...(formData.driver.is_self_owner
            ? { is_self_owner: true }
            : { transport_owner_id: formData.driver.transport_owner_id ? parseInt(formData.driver.transport_owner_id) : (newEntities.owner?.owner_id || undefined) }),
        };
        const res = await adminAPI.createDriver(driverPayload);
        if (res.data?.success) {
          newEntities.driver = res.data.data;
          showToast('✓ Driver registered successfully.');
          
          // Assign vehicle after driver creation if selected
          if (formData.driver.vehicle_id && res.data.data?.driver_id) {
            try {
              await adminAPI.assignVehicleToDriver(res.data.data.driver_id, parseInt(formData.driver.vehicle_id));
            } catch (assignErr) {
              console.error('Vehicle assignment failed:', assignErr);
            }
          }
        } else {
          throw new Error(res.data?.message || 'Failed to create driver');
        }
      }

      // Create Vehicle (if selected)
      if (selectedResources.vehicle) {
        const vehiclePayload = {
          vehicle_number: formData.vehicle.vehicle_number.trim(),
          vehicle_type: formData.vehicle.vehicle_type.trim(),
          vehicle_name: formData.vehicle.vehicle_name.trim(),
          capacity_kg: formData.vehicle.capacity_kg ? Number(formData.vehicle.capacity_kg) : null,
          capacity_volume: formData.vehicle.capacity_volume ? Number(formData.vehicle.capacity_volume) : null,
          vehicle_make: formData.vehicle.vehicle_make?.trim() || null,
          vehicle_model: formData.vehicle.vehicle_model?.trim() || null,
          manufacturing_year: formData.vehicle.manufacturing_year ? Number(formData.vehicle.manufacturing_year) : null,
          registration_date: formData.vehicle.registration_date?.trim() || null,
          insurance_number: formData.vehicle.insurance_number?.trim() || null,
          insurance_expiry: formData.vehicle.insurance_expiry?.trim() || null,
          permit_number: formData.vehicle.permit_number?.trim() || null,
          permit_expiry: formData.vehicle.permit_expiry?.trim() || null,
          pollution_certificate: formData.vehicle.pollution_certificate?.trim() || null,
          pollution_expiry: formData.vehicle.pollution_expiry?.trim() || null,
          base_location: formData.vehicle.base_location?.trim() || null,
          hourly_rate: formData.vehicle.hourly_rate ? Number(formData.vehicle.hourly_rate) : null,
          per_km_rate: formData.vehicle.per_km_rate ? Number(formData.vehicle.per_km_rate) : null,
          driver_id: formData.vehicle.driver_id ? Number(formData.vehicle.driver_id) : (newEntities.driver?.driver_id || null),
          current_status: formData.vehicle.current_status,
          assign_owner_driver: formData.vehicle.assign_owner_driver,
        };
        // Vehicle must be created under an owner
        const ownerId = formData.vehicle.owner_id ? parseInt(formData.vehicle.owner_id) : (newEntities.owner?.owner_id);
        if (!ownerId) {
          throw new Error('Transport Owner is required to register a vehicle');
        }
        const res = await adminAPI.createVehicleOwnerVehicle(ownerId, vehiclePayload);
        if (res.data?.success) {
          newEntities.vehicle = res.data.data;
          showToast('✓ Vehicle registered successfully.');
        } else {
          throw new Error(res.data?.message || 'Failed to create vehicle');
        }
      }

      setCreatedEntities(newEntities);
      setStep('success');
      onSuccess?.(newEntities);
      
    } catch (err) {
      console.error('Registration error:', err);
      const errorMsg = err.response?.data?.message || err.response?.data?.errors?.[0]?.msg || err.message || 'Server error. Please try again.';
      setServerError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  }, [selectedResources, formData, validateAll, showToast]);

  const handleBack = useCallback(() => {
    setStep('select');
    setServerError(null);
  }, []);

  const handleDone = useCallback(() => {
    onClose();
  }, [onClose]);

  const handleClose = useCallback(() => {
    if (step === 'form' && !submitting) {
      if (window.confirm('You have unsaved changes. Are you sure you want to close?')) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [step, submitting, onClose]);

  // Render resource selection cards
  const renderSelectionStep = () => (
    <div className="space-y-6">
      <div className="text-center mb-4">
        <h3 className="text-lg font-semibold text-text">What would you like to register?</h3>
        <p className="text-sm text-muted mt-1">Select one or more resources. Each is created independently.</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {RESOURCE_TYPES.map(resource => {
          const isSelected = selectedResources[resource.key];
          return (
            <button
              key={resource.key}
              type="button"
              onClick={() => handleResourceToggle(resource.key)}
              className={`
                relative p-5 rounded-2xl border-2 transition-all duration-200 text-left
                ${isSelected
                  ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/10 shadow-lg shadow-amber-500/10'
                  : 'border-border/60 bg-card/40 hover:border-amber-300 hover:shadow-md'
                }
              `}
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-3xl">{resource.icon}</span>
                <div>
                  <div className="font-semibold text-text">{resource.label}</div>
                  <div className="text-xs text-muted">{resource.description}</div>
                </div>
              </div>
              {isSelected && (
                <div className="absolute top-3 right-3 w-6 h-6 rounded-full bg-amber-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex justify-end pt-4 border-t border-border/40">
        <button
          type="button"
          onClick={() => setStep('form')}
          disabled={!Object.values(selectedResources).some(v => v)}
          className="px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Continue →
        </button>
      </div>
    </div>
  );

  // Render form step with selected resource sections
  const renderFormStep = () => (
    <div className="space-y-6 max-h-[60vh] overflow-y-auto pr-2">
      {selectedResources.owner && (
        <OwnerRegistrationSection
          formData={formData.owner}
          errors={errors.owner}
          onChange={(field, value) => handleFormDataChange('owner', field, value)}
          onErrorsChange={(errs) => handleFormErrorsChange('owner', errs)}
          context={context}
          createdOwner={createdEntities.owner}
        />
      )}
      
      {selectedResources.driver && (
        <DriverRegistrationSection
          formData={formData.driver}
          errors={errors.driver}
          onChange={(field, value) => handleFormDataChange('driver', field, value)}
          onErrorsChange={(errs) => handleFormErrorsChange('driver', errs)}
          context={context}
          createdOwner={createdEntities.owner}
          createdDriver={createdEntities.driver}
        />
      )}
      
      {selectedResources.vehicle && (
        <VehicleRegistrationSection
          formData={formData.vehicle}
          errors={errors.vehicle}
          onChange={(field, value) => handleFormDataChange('vehicle', field, value)}
          onErrorsChange={(errs) => handleFormErrorsChange('vehicle', errs)}
          context={context}
          createdOwner={createdEntities.owner}
          createdDriver={createdEntities.driver}
        />
      )}

      {serverError && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">
          {serverError}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-border/40">
        <button
          type="button"
          onClick={handleBack}
          className="px-4 py-2.5 text-sm font-medium text-muted hover:text-text transition-colors"
        >
          ← Back
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {submitting ? (
            <>
              <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Registering...
            </>
          ) : (
            `Register ${Object.values(selectedResources).filter(v => v).length} Resource${Object.values(selectedResources).filter(v => v).length > 1 ? 's' : ''}`
          )}
        </button>
      </div>
    </div>
  );

  // Render success step
  const renderSuccessStep = () => (
    <div className="space-y-6 text-center">
      <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-text">
        {Object.keys(createdEntities).length} Resource{Object.keys(createdEntities).length > 1 ? 's' : ''} Registered
      </h3>
      <p className="text-muted">All selected resources have been created successfully.</p>
      
      <div className="bg-card/40 rounded-2xl p-4 text-left space-y-3">
        {createdEntities.owner && (
          <div className="flex items-center gap-3 p-3 bg-emerald-50 dark:bg-emerald-900/20 rounded-xl border border-emerald-200 dark:border-emerald-800">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <span className="text-xl">🏢</span>
            </div>
            <div>
              <div className="font-medium text-text">Transport Owner</div>
              <div className="text-sm text-muted">{createdEntities.owner.owner_name}</div>
              <div className="text-xs text-muted font-mono">{createdEntities.owner.owner_code || `ID: ${createdEntities.owner.owner_id}`}</div>
            </div>
          </div>
        )}
        {createdEntities.driver && (
          <div className="flex items-center gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-800">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
              <span className="text-xl">👨‍✈️</span>
            </div>
            <div>
              <div className="font-medium text-text">Driver</div>
              <div className="text-sm text-muted">{createdEntities.driver.driver_name}</div>
              <div className="text-xs text-muted font-mono">{createdEntities.driver.driver_code || `ID: ${createdEntities.driver.driver_id}`}</div>
            </div>
          </div>
        )}
        {createdEntities.vehicle && (
          <div className="flex items-center gap-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-xl border border-purple-200 dark:border-purple-800">
            <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <span className="text-xl">🚛</span>
            </div>
            <div>
              <div className="font-medium text-text">Vehicle</div>
              <div className="text-sm text-muted">{createdEntities.vehicle.vehicle_number}</div>
              <div className="text-xs text-muted font-mono">{createdEntities.vehicle.vehicle_code || `ID: ${createdEntities.vehicle.vehicle_id}`}</div>
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleDone}
        className="w-full px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors mt-2"
      >
        Done
      </button>
    </div>
  );

  if (!isOpen) return null;

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-[100] animate-slide-down">
          <div className={`
            px-5 py-3.5 rounded-2xl shadow-2xl border text-sm font-semibold flex items-center gap-3 backdrop-blur-sm
            ${toast.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/50 border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/50 border-red-200 dark:border-red-700 text-red-700 dark:text-red-300'
            }`}
          >
            <span className="flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {toast.type === 'success' ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
              </svg>
              {toast.message}
            </span>
            <button onClick={() => setToast(null)} className="ml-3 opacity-50 hover:opacity-100 transition">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Backdrop */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={handleClose} />

        {/* Modal */}
        <div className="relative bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-700 shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden animate-scale-in flex flex-col">
          {/* Sticky Header */}
          <div className="sticky top-0 z-10 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 px-7 py-5 flex items-center justify-between rounded-t-3xl">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
                {step === 'select' ? 'Register Transport Resources' : step === 'form' ? 'Resource Details' : 'Registration Complete'}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                {step === 'select' 
                  ? 'Select the resources you want to register. Each is created independently.'
                  : step === 'form'
                  ? 'Fill in the details for each selected resource. Required fields marked with *.'
                  : 'All selected resources have been created successfully.'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="h-10 w-10 rounded-xl border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center justify-center transition shrink-0"
              aria-label="Close"
            >
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-7 space-y-6">
            {step === 'select' && renderSelectionStep()}
            {step === 'form' && renderFormStep()}
            {step === 'success' && renderSuccessStep()}
          </form>
        </div>
      </div>
    </>
  );
}
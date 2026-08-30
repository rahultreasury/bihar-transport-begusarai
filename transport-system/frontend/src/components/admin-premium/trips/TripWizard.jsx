import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import TripSummary from './TripSummary';
import { adminAPI, authAPI } from '../../../services/api';

const WIZARD_STEPS = [
  { key: 'client', label: 'Client', icon: '👤' },
  { key: 'route', label: 'Route', icon: '📍' },
  { key: 'transport', label: 'Transport Assignment', icon: '🚛' },
  { key: 'finance', label: 'Finance', icon: '💰' },
  { key: 'review', label: 'Review', icon: '✓' },
];

function TripWizard({ onComplete, onCancel, editingTrip, onNavigateToStep }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [validationErrors, setValidationErrors] = useState({});
  const [formData, setFormData] = useState({
    user_id: '',
    transport_owner_id: '',
    vehicle_id: '',
    driver_id: '',
    pickup_location: '',
    pickup_city: '',
    drop_location: '',
    drop_city: '',
    distance_km: '',
    trip_date: '',
    expected_delivery_date: '',
    freight_amount: '',
    driver_payment: '',
    owner_payment: '',
    advance: '',
    notes: '',
  });

  const [clients, setClients] = useState([]);
  const [owners, setOwners] = useState([]);
  const [ownerVehicles, setOwnerVehicles] = useState([]);
  const [allDrivers, setAllDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [newClient, setNewClient] = useState({
    first_name: '',
    last_name: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: '',
    pincode: '',
  });
  const [creatingClient, setCreatingClient] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [loadingOwnerData, setLoadingOwnerData] = useState(false);
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false);
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const ownerDropdownRef = useRef(null);
  const driverDropdownRef = useRef(null);

  // Fetch base lookup data
  const fetchLookupData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientsRes, ownersRes, driversRes] = await Promise.all([
        adminAPI.getTripClients(''),
        adminAPI.getTripOwners(''),
        adminAPI.getTripDrivers(''),
      ]);

      if (clientsRes.data?.success) setClients(clientsRes.data.data || []);
      if (ownersRes.data?.success) setOwners(ownersRes.data.data || []);
      if (driversRes.data?.success) setAllDrivers(driversRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch lookup data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load vehicles and drivers for selected owner
  const loadOwnerDependents = useCallback(async (ownerId) => {
    if (!ownerId) {
      setOwnerVehicles([]);
      return;
    }

    setLoadingOwnerData(true);
    try {
      const vehiclesRes = await adminAPI.getVehiclesByOwner(ownerId);

      if (vehiclesRes.data?.success) {
        setOwnerVehicles(vehiclesRes.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch owner vehicles:', err);
    } finally {
      setLoadingOwnerData(false);
    }
  }, []);

  useEffect(() => {
    fetchLookupData();
    setShowAddClient(false);
    setCurrentStep(0);
  }, [fetchLookupData]);

  // Load vehicles when owner changes
  useEffect(() => {
    if (formData.transport_owner_id) {
      setDriverSearch('');
      loadOwnerDependents(formData.transport_owner_id);
      // Reset vehicle and driver if owner changes
      setFormData(prev => ({
        ...prev,
        vehicle_id: '',
        driver_id: '',
      }));
    } else {
      setOwnerVehicles([]);
      setDriverSearch('');
    }
  }, [formData.transport_owner_id, loadOwnerDependents]);

  // Close the driver dropdown when clicking outside of it
  useEffect(() => {
    function handleClickOutside(event) {
      if (driverDropdownRef.current && !driverDropdownRef.current.contains(event.target)) {
        setShowDriverDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Populate form when editing
  useEffect(() => {
    if (editingTrip) {
      setFormData({
        user_id: editingTrip.user_id || '',
        transport_owner_id: editingTrip.transport_owner_id || '',
        vehicle_id: editingTrip.vehicle_id || '',
        driver_id: editingTrip.driver_id || '',
        pickup_location: editingTrip.pickup_location || '',
        pickup_city: editingTrip.pickup_city || '',
        drop_location: editingTrip.drop_location || '',
        drop_city: editingTrip.drop_city || '',
        distance_km: editingTrip.distance_km || '',
        trip_date: editingTrip.trip_date ? new Date(editingTrip.trip_date).toISOString().split('T')[0] : '',
        expected_delivery_date: editingTrip.expected_delivery_date ? new Date(editingTrip.expected_delivery_date).toISOString().split('T')[0] : '',
        freight_amount: editingTrip.freight_amount || '',
        driver_payment: editingTrip.driver_payment || '',
        owner_payment: editingTrip.owner_payment || '',
        advance: editingTrip.advance || '',
        notes: editingTrip.notes || '',
      });
      setClientSearch(`${editingTrip.user?.first_name || ''} ${editingTrip.user?.last_name || ''}`);
      // Load owner dependents if editing
      if (editingTrip.transport_owner_id) {
        loadOwnerDependents(editingTrip.transport_owner_id);
      }
    }
  }, [editingTrip, loadOwnerDependents]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleClientSelect = (client) => {
    setFormData((prev) => ({ ...prev, user_id: client.user_id }));
    setClientSearch(`${client.first_name} ${client.last_name}`);
    setShowAddClient(false);
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setCreatingClient(true);
    setError(null);

    try {
      const defaultPassword = 'client@123';
      const response = await authAPI.signup({
        ...newClient,
        password: defaultPassword,
      });

      if (response.data?.success) {
        const createdClient = response.data.data;
        setFormData((prev) => ({ ...prev, user_id: createdClient.user_id }));
        setClientSearch(`${createdClient.first_name} ${createdClient.last_name}`);
        setShowAddClient(false);
        await fetchLookupData();
      } else {
        throw new Error(response.data?.message || 'Failed to create client');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create client');
    } finally {
      setCreatingClient(false);
    }
  };

  const handleOwnerSelect = (owner) => {
    setFormData((prev) => ({
      ...prev,
      transport_owner_id: owner.owner_id,
      vehicle_id: '',
      driver_id: '',
    }));
    setOwnerSearch('');
    setShowOwnerDropdown(false);
  };

  const handleVehicleSelect = (vehicle) => {
    setFormData((prev) => ({ ...prev, vehicle_id: vehicle.vehicle_id }));
  };

  const handleDriverSelect = (driver) => {
    setFormData((prev) => ({ ...prev, driver_id: driver.driver_id }));
    setDriverSearch('');
    setShowDriverDropdown(false);
  };

  const validateStep = (step) => {
    const errors = {};
    switch (step) {
      case 0: // Client
        if (!formData.user_id) errors.client = 'Please select a client';
        break;
      case 1: // Route
        if (!formData.pickup_city) errors.pickup_city = 'Pickup city is required';
        if (!formData.drop_city) errors.drop_city = 'Drop city is required';
        if (!formData.trip_date) errors.trip_date = 'Trip date is required';
        break;
      case 2: // Transport Assignment
        if (!formData.transport_owner_id) errors.owner = 'Please select a transport owner';
        if (!formData.vehicle_id) errors.vehicle = 'Please select a vehicle';
        if (!formData.driver_id) errors.driver = 'Please select a driver';
        break;
      case 3: // Finance
        if (!formData.freight_amount) errors.freight = 'Freight amount is required';
        break;
      default:
        break;
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToStep = (step) => {
    if (step <= currentStep || completedSteps.has(step)) {
      setCurrentStep(step);
      setValidationErrors({});
      setError(null);
    }
  };

  const handleNext = () => {
    if (validateStep(currentStep)) {
      setCompletedSteps((prev) => new Set([...prev, currentStep]));
      setCurrentStep((prev) => Math.min(prev + 1, WIZARD_STEPS.length - 1));
      setValidationErrors({});
      setError(null);
    } else {
      setError('Please complete all required fields before continuing');
    }
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
    setValidationErrors({});
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const data = {
        user_id: parseInt(formData.user_id),
        transport_owner_id: parseInt(formData.transport_owner_id),
        vehicle_id: parseInt(formData.vehicle_id),
        driver_id: parseInt(formData.driver_id),
        pickup_location: formData.pickup_location,
        pickup_city: formData.pickup_city,
        drop_location: formData.drop_location,
        drop_city: formData.drop_city,
        distance_km: formData.distance_km ? parseFloat(formData.distance_km) : null,
        trip_date: formData.trip_date ? new Date(formData.trip_date) : null,
        expected_delivery_date: formData.expected_delivery_date ? new Date(formData.expected_delivery_date) : null,
        freight_amount: parseFloat(formData.freight_amount),
        driver_payment: formData.driver_payment ? parseFloat(formData.driver_payment) : null,
        owner_payment: formData.owner_payment ? parseFloat(formData.owner_payment) : null,
        advance: formData.advance ? parseFloat(formData.advance) : 0,
        notes: formData.notes || null,
      };

      if (editingTrip) {
        await adminAPI.updateTrip(editingTrip.trip_id, data);
      } else {
        await adminAPI.createTrip(data);
      }

      onComplete?.();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to save trip');
    } finally {
      setSaving(false);
    }
  };

  const filteredClients = clients.filter((client) => {
    const searchLower = clientSearch.toLowerCase();
    const name = `${client.first_name} ${client.last_name}`.toLowerCase();
    const phone = (client.phone || '').toLowerCase();
    return name.includes(searchLower) || phone.includes(searchLower);
  });

  const selectedClient = clients.find(c => c.user_id === parseInt(formData.user_id));
  const selectedOwner = owners.find(o => o.owner_id === parseInt(formData.transport_owner_id));

  // Close the owner dropdown when clicking outside of it
  useEffect(() => {
    function handleClickOutside(event) {
      if (ownerDropdownRef.current && !ownerDropdownRef.current.contains(event.target)) {
        setShowOwnerDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  const selectedVehicle = ownerVehicles.find(v => v.vehicle_id === parseInt(formData.vehicle_id));
  const selectedDriver = allDrivers.find(d => d.driver_id === parseInt(formData.driver_id));

  // Transport Owner options: filter the already-loaded `owners` list in real
  // time (case-insensitive, partial match). This avoids an extra API round-trip
  // and guarantees the dropdown reflects the real database records fetched on
  // page load.
  const filteredOwners = useMemo(() => {
    const term = ownerSearch.trim().toLowerCase();
    if (!term) return owners;
    return owners.filter((o) =>
      (o.owner_name || '').toLowerCase().includes(term) ||
      (o.company_name || '').toLowerCase().includes(term) ||
      (o.mobile || '').includes(ownerSearch.trim()) ||
      (o.owner_code || '').toLowerCase().includes(term) ||
      (o.city || '').toLowerCase().includes(term)
    );
  }, [owners, ownerSearch]);

  // Driver options: filter the already-loaded `allDrivers` list in real time
  // (case-insensitive, partial match). When a Transport Owner is selected we
  // narrow to that owner's drivers; otherwise all active drivers are shown.
  const filteredDrivers = useMemo(() => {
    const term = driverSearch.trim().toLowerCase();
    const base = formData.transport_owner_id
      ? allDrivers.filter((d) => d.transport_owner_id === parseInt(formData.transport_owner_id))
      : allDrivers;
    if (!term) return base;
    return base.filter((d) =>
      (d.driver_name || '').toLowerCase().includes(term) ||
      (d.mobile || '').includes(driverSearch.trim()) ||
      String(d.driver_id).includes(driverSearch.trim()) ||
      (d.license_number || '').toLowerCase().includes(term)
    );
  }, [allDrivers, formData.transport_owner_id, driverSearch]);

  return (
    <div className="flex gap-6 h-full">
      {/* Main Wizard */}
      <div className="flex-1 flex flex-col h-full min-w-0">
        {/* Step Indicator */}
        <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
          {WIZARD_STEPS.map((step, index) => {
            const isClickable = index <= currentStep + 1 || completedSteps.has(index);
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => isClickable && setCurrentStep(index)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                  index === currentStep
                    ? 'bg-amber-500 text-white'
                    : isClickable
                    ? 'bg-amber-100 text-amber-700 cursor-pointer hover:bg-amber-200'
                    : 'bg-gray-100 text-gray-500'
                }`}
              >
                <span>{step.icon}</span>
                <span className="hidden sm:inline">{step.label}</span>
              </button>
            );
          })}
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Step Content */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          {/* Step 0: Client */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>👤</span> Select Client
              </h3>

              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Search or Select Client *</label>
                <input
                  type="text"
                  placeholder="Search by name or phone..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                />
              </div>

              {/* Client List */}
              {clientSearch && !showAddClient && (
                <div className="max-h-48 overflow-y-auto border border-border/60 rounded-xl">
                  {filteredClients.length > 0 ? (
                    filteredClients.slice(0, 10).map((client) => (
                      <button
                        key={client.user_id}
                        type="button"
                        onClick={() => handleClientSelect(client)}
                        className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                          formData.user_id === client.user_id ? 'bg-amber-50' : ''
                        }`}
                      >
                        <div className="font-medium">{client.first_name} {client.last_name}</div>
                        <div className="text-xs text-muted">{client.phone}</div>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-3 text-sm text-muted">No clients found</div>
                  )}
                </div>
              )}

              {/* Selected Client Info */}
              {selectedClient && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="font-medium text-amber-800">
                    {selectedClient.first_name} {selectedClient.last_name}
                  </div>
                  <div className="text-sm text-amber-600">{selectedClient.phone}</div>
                </div>
              )}

              {/* Add New Client Button */}
              {!showAddClient ? (
                <button
                  type="button"
                  onClick={() => setShowAddClient(true)}
                  className="w-full py-3 border-2 border-dashed border-border/60 rounded-xl text-sm font-medium text-muted hover:border-amber-500 hover:text-amber-600 transition-colors"
                >
                  + Add New Client
                </button>
              ) : (
                <div className="p-4 border border-border/60 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Add New Client</h4>
                    <button
                      type="button"
                      onClick={() => setShowAddClient(false)}
                      className="text-sm text-muted hover:text-text"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">First Name *</label>
                      <input
                        type="text"
                        value={newClient.first_name}
                        onChange={(e) => setNewClient(prev => ({ ...prev, first_name: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Last Name *</label>
                      <input
                        type="text"
                        value={newClient.last_name}
                        onChange={(e) => setNewClient(prev => ({ ...prev, last_name: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Phone *</label>
                      <input
                        type="tel"
                        value={newClient.phone}
                        onChange={(e) => setNewClient(prev => ({ ...prev, phone: e.target.value }))}
                        placeholder="10-digit number"
                        className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted mb-1">Email *</label>
                      <input
                        type="email"
                        value={newClient.email}
                        onChange={(e) => setNewClient(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-muted mb-1">Address</label>
                    <input
                      type="text"
                      value={newClient.address}
                      onChange={(e) => setNewClient(prev => ({ ...prev, address: e.target.value }))}
                      className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleCreateClient}
                    disabled={creatingClient || !newClient.first_name || !newClient.last_name || !newClient.phone || !newClient.email}
                    className="w-full py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {creatingClient ? 'Creating...' : 'Create Client'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Step 1: Route */}
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>📍</span> Route Information
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Pickup City *</label>
                  <input
                    type="text"
                    name="pickup_city"
                    value={formData.pickup_city}
                    onChange={handleChange}
                    placeholder="e.g., Patna"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    required
                  />
                  {validationErrors.pickup_city && (
                    <p className="mt-1 text-xs text-red-500">{validationErrors.pickup_city}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Drop City *</label>
                  <input
                    type="text"
                    name="drop_city"
                    value={formData.drop_city}
                    onChange={handleChange}
                    placeholder="e.g., Delhi"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    required
                  />
                  {validationErrors.drop_city && (
                    <p className="mt-1 text-xs text-red-500">{validationErrors.drop_city}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Pickup Location</label>
                  <input
                    type="text"
                    name="pickup_location"
                    value={formData.pickup_location}
                    onChange={handleChange}
                    placeholder="Full pickup address"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Drop Location</label>
                  <input
                    type="text"
                    name="drop_location"
                    value={formData.drop_location}
                    onChange={handleChange}
                    placeholder="Full drop address"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Distance (km)</label>
                  <input
                    type="number"
                    name="distance_km"
                    value={formData.distance_km}
                    onChange={handleChange}
                    step="0.1"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Trip Date *</label>
                  <input
                    type="date"
                    name="trip_date"
                    value={formData.trip_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    required
                  />
                  {validationErrors.trip_date && (
                    <p className="mt-1 text-xs text-red-500">{validationErrors.trip_date}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Expected Delivery</label>
                  <input
                    type="date"
                    name="expected_delivery_date"
                    value={formData.expected_delivery_date}
                    onChange={handleChange}
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Transport Assignment */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>🚛</span> Transport Assignment
              </h3>
              <p className="text-sm text-muted">Select the transport owner, vehicle and driver for this trip.</p>

              {/* Transport Owner */}
              <div className="space-y-3" ref={ownerDropdownRef}>
                <label className="block text-sm font-medium text-muted">Transport Owner *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">🔍</span>
                  <input
                    type="text"
                    placeholder="Search transport owner..."
                    value={ownerSearch}
                    onChange={(e) => { setOwnerSearch(e.target.value); setShowOwnerDropdown(true); }}
                    onFocus={() => setShowOwnerDropdown(true)}
                    className="w-full pl-9 pr-9 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">▼</span>
                </div>

                {showOwnerDropdown && (
                  <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl bg-surface shadow-lg">
                    {loading ? (
                      <div className="px-4 py-3 text-sm text-muted">Loading transport owners...</div>
                    ) : filteredOwners.length > 0 ? (
                      filteredOwners.map((owner) => {
                        const ownerTypeLabel = {
                          TRANSPORT_COMPANY: 'Transport Company',
                          INDIVIDUAL_OWNER: 'Individual Owner',
                          DRIVER_OWNER: 'Driver Owner',
                        }[owner.owner_type] || 'Owner';
                        const ownerTypeColor = {
                          TRANSPORT_COMPANY: 'bg-blue-100 text-blue-700',
                          INDIVIDUAL_OWNER: 'bg-green-100 text-green-700',
                          DRIVER_OWNER: 'bg-amber-100 text-amber-700',
                        }[owner.owner_type] || 'bg-gray-100 text-gray-700';

                        return (
                          <button
                            key={owner.owner_id}
                            type="button"
                            onClick={() => handleOwnerSelect(owner)}
                            className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                              formData.transport_owner_id === owner.owner_id ? 'bg-amber-50' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="font-medium">{owner.owner_name}</div>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${ownerTypeColor}`}>{ownerTypeLabel}</span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted mt-1">
                              {owner.company_name && <span>{owner.company_name}</span>}
                              {owner.company_name && <span>•</span>}
                              <span>{owner.mobile}</span>
                              {owner.city && <><span>•</span><span>{owner.city}</span></>}
                              <span>•</span>
                              <span className={`capitalize ${owner.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>{owner.status}</span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted">No transport owners found</div>
                    )}
                  </div>
                )}

                {selectedOwner && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="flex items-center gap-2">
                      <div className="font-medium text-blue-800">{selectedOwner.owner_name}</div>
                      {selectedOwner.owner_type && (
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          selectedOwner.owner_type === 'TRANSPORT_COMPANY' ? 'bg-blue-100 text-blue-700' :
                          selectedOwner.owner_type === 'INDIVIDUAL_OWNER' ? 'bg-green-100 text-green-700' :
                          selectedOwner.owner_type === 'DRIVER_OWNER' ? 'bg-amber-100 text-amber-700' :
                          'bg-gray-100 text-gray-700'
                        }`}>
                          {selectedOwner.owner_type === 'TRANSPORT_COMPANY' ? 'Transport Company' :
                           selectedOwner.owner_type === 'INDIVIDUAL_OWNER' ? 'Individual Owner' :
                           selectedOwner.owner_type === 'DRIVER_OWNER' ? 'Driver Owner' :
                           selectedOwner.owner_type}
                        </span>
                      )}
                    </div>
                    {selectedOwner.company_name && (
                      <div className="text-sm text-blue-600">{selectedOwner.company_name}</div>
                    )}
                    <div className="text-sm text-blue-600">{selectedOwner.mobile}</div>
                    {selectedOwner.city && <div className="text-sm text-blue-600">{selectedOwner.city}</div>}
                    <div className="text-xs text-blue-500 capitalize mt-1">Status: {selectedOwner.status}</div>
                  </div>
                )}
              </div>

              {/* Vehicle */}
              {formData.transport_owner_id && (
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-muted">Available Vehicles *</label>

                  {loadingOwnerData ? (
                    <div className="p-4 text-sm text-muted">Loading vehicles...</div>
                  ) : ownerVehicles.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {ownerVehicles.map((vehicle) => (
                        <button
                          key={vehicle.vehicle_id}
                          type="button"
                          onClick={() => handleVehicleSelect(vehicle)}
                          className={`w-full text-left p-4 rounded-xl border-2 transition-colors ${
                            formData.vehicle_id === vehicle.vehicle_id
                              ? 'border-amber-500 bg-amber-50'
                              : 'border-border/60 hover:border-amber-300 hover:bg-hover/40'
                          }`}
                        >
                          <div className="font-medium text-sm">{vehicle.vehicle_number}</div>
                          <div className="text-xs text-muted mt-1">{vehicle.vehicle_name} • {vehicle.vehicle_type}</div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm text-yellow-700">
                      No vehicles found for this transport owner.
                    </div>
                  )}

                  {selectedVehicle && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                      <div className="text-sm font-medium text-green-800">Selected: {selectedVehicle.vehicle_number}</div>
                      <div className="text-xs text-green-600">{selectedVehicle.vehicle_name} • {selectedVehicle.vehicle_type}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Driver - always visible */}
              <div className="space-y-3" ref={driverDropdownRef}>
                <label className="block text-sm font-medium text-muted">Available Drivers *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">🔍</span>
                  <input
                    type="text"
                    placeholder="Search driver..."
                    value={driverSearch}
                    onChange={(e) => { setDriverSearch(e.target.value); setShowDriverDropdown(true); }}
                    onFocus={() => setShowDriverDropdown(true)}
                    className="w-full pl-9 pr-9 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">▼</span>
                </div>

                {!formData.transport_owner_id && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
                    Showing all available drivers. Select a transport owner to filter the list.
                  </div>
                )}

                {showDriverDropdown && (
                  <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl bg-surface shadow-lg">
                    {loading ? (
                      <div className="px-4 py-3 text-sm text-muted">Loading drivers...</div>
                    ) : filteredDrivers.length > 0 ? (
                      filteredDrivers.map((driver) => (
                        <button
                          key={driver.driver_id}
                          type="button"
                          onClick={() => handleDriverSelect(driver)}
                          className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                            formData.driver_id === driver.driver_id ? 'bg-amber-50' : ''
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className="font-medium">{driver.driver_name}</div>
                            {driver.transport_owner_id && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                                {driver.transportOwner?.owner_name || 'Owner'}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted mt-1">
                            <span>{driver.mobile}</span>
                            {driver.license_number && <><span>•</span><span>License: {driver.license_number}</span></>}
                            {driver.currentVehicle && <><span>•</span><span>{driver.currentVehicle.vehicle_number}</span></>}
                            <span>•</span>
                            <span className={`capitalize ${driver.status === 'available' ? 'text-green-600' : driver.status === 'inactive' ? 'text-red-600' : 'text-amber-600'}`}>{driver.status}</span>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted">No drivers found</div>
                    )}
                  </div>
                )}

                {selectedDriver && (
                  <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl">
                    <div className="text-sm font-medium text-purple-800">Selected: {selectedDriver.driver_name}</div>
                    <div className="text-xs text-purple-600">{selectedDriver.mobile}</div>
                    {selectedDriver.license_number && (
                      <div className="text-xs text-purple-600">License: {selectedDriver.license_number}</div>
                    )}
                    {selectedDriver.transportOwner && (
                      <div className="text-xs text-purple-600">Owner: {selectedDriver.transportOwner.owner_name}</div>
                    )}
                    {selectedDriver.currentVehicle && (
                      <div className="text-xs text-purple-600">Vehicle: {selectedDriver.currentVehicle.vehicle_number}</div>
                    )}
                  </div>
                )}
              </div>

              {validationErrors.owner && (
                <p className="text-sm text-red-500">{validationErrors.owner}</p>
              )}
              {validationErrors.vehicle && (
                <p className="text-sm text-red-500">{validationErrors.vehicle}</p>
              )}
              {validationErrors.driver && (
                <p className="text-sm text-red-500">{validationErrors.driver}</p>
              )}
            </div>
          )}

          {/* Step 3: Finance */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>💰</span> Financial Details
              </h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Client Freight (₹) *</label>
                  <input
                    type="number"
                    name="freight_amount"
                    value={formData.freight_amount}
                    onChange={handleChange}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    required
                  />
                  {validationErrors.freight && (
                    <p className="mt-1 text-xs text-red-500">{validationErrors.freight}</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Owner Payable (₹)</label>
                  <input
                    type="number"
                    name="owner_payment"
                    value={formData.owner_payment}
                    onChange={handleChange}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Driver Payable (₹)</label>
                  <input
                    type="number"
                    name="driver_payment"
                    value={formData.driver_payment}
                    onChange={handleChange}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Advance (₹)</label>
                  <input
                    type="number"
                    name="advance"
                    value={formData.advance}
                    onChange={handleChange}
                    step="0.01"
                    placeholder="0.00"
                    className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Notes</label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Any additional notes..."
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors resize-none"
                />
              </div>
            </div>
          )}

          {/* Step 4: Review */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>✓</span> Review & Create Trip
              </h3>

              <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Client</span>
                  <span className="text-sm font-medium">
                    {selectedClient ? `${selectedClient.first_name} ${selectedClient.last_name}` : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Route</span>
                  <span className="text-sm font-medium">
                    {formData.pickup_city} → {formData.drop_city}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Transport Assignment</span>
                  <span className="text-sm font-medium">
                    {selectedOwner ? selectedOwner.owner_name : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Vehicle</span>
                  <span className="text-sm font-medium">
                    {selectedVehicle ? selectedVehicle.vehicle_number : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Driver</span>
                  <span className="text-sm font-medium">
                    {selectedDriver ? selectedDriver.driver_name : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Freight</span>
                  <span className="text-sm font-medium text-amber-600">
                    ₹{parseFloat(formData.freight_amount || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Owner Payable</span>
                  <span className="text-sm font-medium">
                    ₹{parseFloat(formData.owner_payment || 0).toLocaleString('en-IN')}
                  </span>
                </div>
                <div className="flex justify-between py-2">
                  <span className="text-sm text-muted">Driver Payable</span>
                  <span className="text-sm font-medium">
                    ₹{parseFloat(formData.driver_payment || 0).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </form>

        {/* Action Bar */}
        <div className="flex items-center justify-between pt-6 mt-6 border-t border-border/60">
          <button
            type="button"
            onClick={currentStep === 0 ? onCancel : handleBack}
            className="px-4 py-2.5 border border-border/60 rounded-xl text-sm font-medium hover:bg-hover/60 transition-colors"
          >
            {currentStep === 0 ? 'Cancel' : 'Back'}
          </button>

          <div className="flex items-center gap-3">
            {currentStep < WIZARD_STEPS.length - 1 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 transition-colors"
              >
                Next: {WIZARD_STEPS[currentStep + 1].label}
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={saving}
                className="px-4 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? 'Creating...' : editingTrip ? 'Update Trip' : 'Create Trip'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Trip Summary Sidebar */}
      {onNavigateToStep && (
        <div className="w-80 shrink-0 hidden lg:block">
          <TripSummary
            formData={formData}
            clients={clients}
            owners={owners}
            ownerVehicles={ownerVehicles}
            allDrivers={allDrivers}
            onNavigateToStep={onNavigateToStep}
          />
        </div>
      )}
    </div>
  );
}

export default TripWizard;

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { adminAPI, authAPI } from '../../../services/api';
import TripAdvanceStep from './TripAdvanceStep';

const WIZARD_STEPS = [
  { key: 'trip', label: 'Trip', description: 'Trip Details', icon: '📋' },
  { key: 'resources', label: 'Resources', description: 'Vehicle & Driver', icon: '🚛' },
  { key: 'advance', label: 'Advance', description: 'Money Paid', icon: '💰' },
  { key: 'review', label: 'Review', description: 'Confirm Trip', icon: '✓' },
];

function TripWizard({ onComplete, onCancel, editingTrip, onNavigateToStep, currentStep: externalCurrentStep, onStepChange }) {
  const [internalCurrentStep, setInternalCurrentStep] = useState(0);
  const currentStep = externalCurrentStep !== undefined ? externalCurrentStep : internalCurrentStep;
  const setCurrentStep = onStepChange || setInternalCurrentStep;
  const [completedSteps, setCompletedSteps] = useState(new Set());
  const [validationErrors, setValidationErrors] = useState({});
  const [formData, setFormData] = useState({
    source_type: 'ONLINE_BOOKING',
    user_id: '',
    client_id: '',
    pickup_city: '',
    drop_city: '',
    pickup_location: '',
    drop_location: '',
    distance_km: '',
    trip_date: new Date().toISOString().split('T')[0],
    expected_delivery_date: '',
    freight_amount: '',
    vehicle_id: '',
    driver_id: '',
    transport_owner_id: '',
    notes: '',
    advances: [],
    trip_id: null,
  });

  const [clients, setClients] = useState([]);
  const [offlineClients, setOfflineClients] = useState([]);
  const [owners, setOwners] = useState([]);
  const [allVehicles, setAllVehicles] = useState([]);
  const [allDrivers, setAllDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [offlineClientSearch, setOfflineClientSearch] = useState('');
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddOfflineClient, setShowAddOfflineClient] = useState(false);
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
  const [newOfflineClient, setNewOfflineClient] = useState({
    company_name: '',
    contact_person: '',
    phone: '',
    email: '',
    address: '',
    city: '',
    state: 'Bihar',
    gst_number: '',
    pan_number: '',
    bank_account: '',
    bank_ifsc: '',
    bank_name: '',
    upi_id: '',
    notes: '',
  });
  const [creatingClient, setCreatingClient] = useState(false);
  const [creatingOfflineClient, setCreatingOfflineClient] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const vehicleDropdownRef = useRef(null);
  const driverDropdownRef = useRef(null);

  // Fetch base lookup data
  const fetchLookupData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientsRes, offlineClientsRes, vehiclesRes, driversRes, ownersRes] = await Promise.all([
        adminAPI.getTripClients(''),
        adminAPI.getTripOfflineClients(''),
        adminAPI.getTripVehicles(''),
        adminAPI.getTripDrivers(''),
        adminAPI.getTripOwners(''),
      ]);

      if (clientsRes.data?.success) setClients(clientsRes.data.data || []);
      if (offlineClientsRes.data?.success) setOfflineClients(offlineClientsRes.data.data || []);
      if (vehiclesRes.data?.success) setAllVehicles(vehiclesRes.data.data || []);
      if (driversRes.data?.success) setAllDrivers(driversRes.data.data || []);
      if (ownersRes.data?.success) setOwners(ownersRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch lookup data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLookupData();
    setShowAddClient(false);
    setCurrentStep(0);
  }, [fetchLookupData]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(event.target)) {
        setShowVehicleDropdown(false);
      }
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
        source_type: editingTrip.source_type || 'ONLINE_BOOKING',
        user_id: editingTrip.user_id || '',
        client_id: editingTrip.client_id || '',
        pickup_city: editingTrip.pickup_city || '',
        drop_city: editingTrip.drop_city || '',
        pickup_location: editingTrip.pickup_location || '',
        drop_location: editingTrip.drop_location || '',
        distance_km: editingTrip.distance_km || '',
        trip_date: editingTrip.trip_date ? new Date(editingTrip.trip_date).toISOString().split('T')[0] : '',
        expected_delivery_date: editingTrip.expected_delivery_date ? new Date(editingTrip.expected_delivery_date).toISOString().split('T')[0] : '',
        freight_amount: editingTrip.freight_amount || '',
        vehicle_id: editingTrip.vehicle_id || '',
        driver_id: editingTrip.driver_id || '',
        transport_owner_id: editingTrip.transport_owner_id || '',
        notes: editingTrip.notes || '',
        advances: [],
        trip_id: editingTrip.trip_id,
      });
      if (editingTrip.source_type === 'ONLINE_BOOKING' && editingTrip.user_id) {
        setClientSearch(`${editingTrip.user?.first_name || ''} ${editingTrip.user?.last_name || ''}`);
      } else if (editingTrip.source_type === 'OFFLINE_CLIENT' && editingTrip.client_id) {
        setOfflineClientSearch(editingTrip.client?.company_name || '');
      }
      if (editingTrip.vehicle_id) {
        setVehicleSearch(editingTrip.vehicle?.vehicle_number || '');
      }
      if (editingTrip.driver_id) {
        setDriverSearch(editingTrip.driver?.driver_name || '');
      }
    }
  }, [editingTrip]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleClientSelect = (client) => {
    setFormData((prev) => ({ ...prev, user_id: client.user_id, client_id: '' }));
    setClientSearch(`${client.first_name} ${client.last_name}`);
    setOfflineClientSearch('');
    setShowAddClient(false);
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    setCreatingClient(true);
    setError(null);

    try {
      // Normalize phone: keep only digits, then take the last 10.
      // The backend /api/auth/signup validates phone with /^[0-9]{10}$/
      // and the `users.phone` unique column expects exactly 10 digits.
      const digitsOnly = String(newClient.phone || '').replace(/\D/g, '');
      const normalizedPhone = digitsOnly.slice(-10);

      if (normalizedPhone.length !== 10) {
        throw new Error('Phone must be exactly 10 digits');
      }

      const normalizedEmail = String(newClient.email || '').trim();

      const defaultPassword = 'client@123';
      const response = await authAPI.signup({
        ...newClient,
        phone: normalizedPhone,
        email: normalizedEmail,
        password: defaultPassword,
      });

      if (response.data?.success) {
        const createdClient = response.data.data;
        setFormData((prev) => ({ ...prev, user_id: createdClient.user_id, client_id: '' }));
        setClientSearch(`${createdClient.first_name} ${createdClient.last_name}`);
        setOfflineClientSearch('');
        setShowAddClient(false);
        // Reflect the normalized phone in the form state so subsequent
        // submits stay consistent.
        setNewClient((prev) => ({ ...prev, phone: normalizedPhone, email: normalizedEmail }));
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

  const handleOfflineClientSelect = (client) => {
    setFormData((prev) => ({ ...prev, client_id: client.client_id, user_id: '' }));
    setOfflineClientSearch(client.company_name);
    setClientSearch('');
    setShowAddOfflineClient(false);
  };

  const handleCreateOfflineClient = async (e) => {
    e.preventDefault();
    setCreatingOfflineClient(true);
    setError(null);

    try {
      const response = await adminAPI.createClient(newOfflineClient);

      if (response.data?.success) {
        const createdClient = response.data.data;
        setFormData((prev) => ({ ...prev, client_id: createdClient.client_id, user_id: '' }));
        setOfflineClientSearch(createdClient.company_name);
        setClientSearch('');
        setShowAddOfflineClient(false);
        await fetchLookupData();
      } else {
        throw new Error(response.data?.message || 'Failed to create client');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to create client');
    } finally {
      setCreatingOfflineClient(false);
    }
  };

  const handleVehicleSelect = (vehicle) => {
    setFormData((prev) => ({
      ...prev,
      vehicle_id: vehicle.vehicle_id,
      transport_owner_id: vehicle.owner_id || prev.transport_owner_id,
    }));
    setVehicleSearch(`${vehicle.vehicle_number} ${vehicle.vehicle_name || ''}`);
    setShowVehicleDropdown(false);

    // Auto-select driver if vehicle has an assigned driver
    if (vehicle.driver_id) {
      setFormData((prev) => ({ ...prev, driver_id: vehicle.driver_id }));
      const assignedDriver = allDrivers.find(d => d.driver_id === vehicle.driver_id);
      if (assignedDriver) {
        setDriverSearch(`${assignedDriver.driver_name}`);
      }
    }
  };

  const handleDriverSelect = (driver) => {
    setFormData((prev) => ({ ...prev, driver_id: driver.driver_id }));
    setDriverSearch(`${driver.driver_name}`);
    setShowDriverDropdown(false);
  };

  const validateStep = (step) => {
    const errors = {};
    switch (step) {
      case 0: // Trip
        if (formData.source_type === 'ONLINE_BOOKING' && !formData.user_id) {
          errors.client = 'Please select a customer';
        }
        if (formData.source_type === 'OFFLINE_CLIENT' && !formData.client_id) {
          errors.client = 'Please select a client';
        }
        if (!formData.pickup_city) errors.pickup_city = 'Pickup city is required';
        if (!formData.drop_city) errors.drop_city = 'Drop city is required';
        if (!formData.trip_date) errors.trip_date = 'Trip date is required';
        if (!formData.freight_amount || parseFloat(formData.freight_amount) < 0) errors.freight = 'Freight amount is required';
        break;
      case 1: // Resources
        if (!formData.vehicle_id) errors.vehicle = 'Please select a vehicle';
        if (!formData.driver_id) errors.driver = 'Please select a driver';
        break;
      case 2: // Advance
        // Advance is optional, no validation required
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
        source_type: formData.source_type,
        user_id: formData.source_type === 'ONLINE_BOOKING' ? parseInt(formData.user_id) : null,
        client_id: formData.source_type === 'OFFLINE_CLIENT' ? parseInt(formData.client_id) : null,
        pickup_location: formData.pickup_location,
        pickup_city: formData.pickup_city,
        drop_location: formData.drop_location,
        drop_city: formData.drop_city,
        distance_km: formData.distance_km ? parseFloat(formData.distance_km) : null,
        trip_date: formData.trip_date ? new Date(formData.trip_date) : null,
        expected_delivery_date: formData.expected_delivery_date ? new Date(formData.expected_delivery_date) : null,
        freight_amount: parseFloat(formData.freight_amount),
        vehicle_id: parseInt(formData.vehicle_id),
        driver_id: parseInt(formData.driver_id),
        transport_owner_id: parseInt(formData.transport_owner_id),
        notes: formData.notes || null,
        advance: 0, // Will be updated by advance records
      };

      let tripId;
      if (editingTrip) {
        await adminAPI.updateTrip(editingTrip.trip_id, data);
        tripId = editingTrip.trip_id;
      } else {
        const response = await adminAPI.createTrip(data);
        tripId = response.data?.data?.trip_id;
        if (tripId) {
          setFormData((prev) => ({ ...prev, trip_id: tripId }));
        }
      }

      // Save advances if any
      if (tripId && formData.advances && formData.advances.length > 0) {
        const validAdvances = formData.advances.filter((a) => parseFloat(a.amount) > 0);
        for (const advance of validAdvances) {
          await adminAPI.createTripAdvanceByTripId(tripId, {
            advance_type: advance.type,
            amount: parseFloat(advance.amount),
            payment_method: advance.payment_method,
            given_at: advance.date ? new Date(advance.date).toISOString() : new Date().toISOString(),
            notes: advance.note || null,
            driver_id: formData.driver_id || null,
            vehicle_id: formData.vehicle_id || null,
            transport_owner_id: formData.transport_owner_id || null,
          });
        }
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
  const selectedVehicle = allVehicles.find(v => v.vehicle_id === parseInt(formData.vehicle_id));
  const selectedDriver = allDrivers.find(d => d.driver_id === parseInt(formData.driver_id));
  const selectedOwner = owners.find(o => o.owner_id === parseInt(formData.transport_owner_id));

  // Vehicle options: filter the already-loaded `allVehicles` list in real time
  const filteredVehicles = useMemo(() => {
    const term = vehicleSearch.trim().toLowerCase();
    if (!term) return allVehicles;
    return allVehicles.filter((v) =>
      (v.vehicle_number || '').toLowerCase().includes(term) ||
      (v.vehicle_name || '').toLowerCase().includes(term) ||
      (v.vehicle_type || '').toLowerCase().includes(term)
    );
  }, [allVehicles, vehicleSearch]);

  // Driver options: filter the already-loaded `allDrivers` list in real time
  // When a vehicle is selected, narrow to drivers belonging to that vehicle's owner
  const filteredDrivers = useMemo(() => {
    const term = driverSearch.trim().toLowerCase();
    let base = allDrivers;
    if (selectedVehicle?.owner_id) {
      base = allDrivers.filter((d) => d.transport_owner_id === selectedVehicle.owner_id);
    }
    if (!term) return base;
    return base.filter((d) =>
      (d.driver_name || '').toLowerCase().includes(term) ||
      (d.mobile || '').includes(driverSearch.trim()) ||
      String(d.driver_id).includes(driverSearch.trim()) ||
      (d.license_number || '').toLowerCase().includes(term)
    );
  }, [allDrivers, selectedVehicle, driverSearch]);

  return (
    <div className="flex flex-col h-full">
      {/* Main Wizard */}
      <div className="flex-1 flex flex-col min-w-0">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Step Content */}
        <form onSubmit={handleSubmit} className="flex-1">
          {/* Step 0: Trip */}
          {currentStep === 0 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>📋</span> Trip Details
              </h3>

              {/* Client Selection */}
              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Customer *</label>
                <input
                  type="text"
                  placeholder="Search by name or phone..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                />
                {clientSearch && !showAddClient && (
                  <div className="max-h-48 overflow-y-auto border border-border/60 rounded-xl mt-1">
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
                {selectedClient && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl mt-2">
                    <div className="font-medium text-amber-800">{selectedClient.first_name} {selectedClient.last_name}</div>
                    <div className="text-sm text-amber-600">{selectedClient.phone}</div>
                  </div>
                )}
                {!showAddClient && !selectedClient && (
                  <button
                    type="button"
                    onClick={() => setShowAddClient(true)}
                    className="w-full py-3 border-2 border-dashed border-border/60 rounded-xl text-sm font-medium text-muted hover:border-amber-500 hover:text-amber-600 transition-colors mt-2"
                  >
                    + Add New Client
                  </button>
                )}
                {showAddClient && (
                  <div className="p-4 border border-border/60 rounded-xl space-y-4 mt-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">Add New Client</h4>
                      <button type="button" onClick={() => setShowAddClient(false)} className="text-sm text-muted hover:text-text">Cancel</button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">First Name *</label>
                        <input type="text" value={newClient.first_name} onChange={(e) => setNewClient(prev => ({ ...prev, first_name: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm" required />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">Last Name *</label>
                        <input type="text" value={newClient.last_name} onChange={(e) => setNewClient(prev => ({ ...prev, last_name: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">Phone *</label>
                        <input type="tel" value={newClient.phone} onChange={(e) => setNewClient(prev => ({ ...prev, phone: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm" required />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-muted mb-1">Email *</label>
                        <input type="email" value={newClient.email} onChange={(e) => setNewClient(prev => ({ ...prev, email: e.target.value }))} className="w-full px-3 py-2 bg-surface border border-border/60 rounded-lg text-sm" required />
                      </div>
                    </div>
                    <button type="button" onClick={handleCreateClient} disabled={creatingClient || !newClient.first_name || !newClient.last_name || !newClient.phone || !newClient.email} className="w-full py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors">
                      {creatingClient ? 'Creating...' : 'Create Client'}
                    </button>
                  </div>
                )}
                {validationErrors.client && <p className="mt-1 text-xs text-red-500">{validationErrors.client}</p>}
              </div>

              {/* Route */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Pickup City *</label>
                  <input type="text" name="pickup_city" value={formData.pickup_city} onChange={handleChange} placeholder="e.g., Patna" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" required />
                  {validationErrors.pickup_city && <p className="mt-1 text-xs text-red-500">{validationErrors.pickup_city}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Drop City *</label>
                  <input type="text" name="drop_city" value={formData.drop_city} onChange={handleChange} placeholder="e.g., Delhi" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" required />
                  {validationErrors.drop_city && <p className="mt-1 text-xs text-red-500">{validationErrors.drop_city}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Pickup Location</label>
                  <input type="text" name="pickup_location" value={formData.pickup_location} onChange={handleChange} placeholder="Full pickup address" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Drop Location</label>
                  <input type="text" name="drop_location" value={formData.drop_location} onChange={handleChange} placeholder="Full drop address" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Distance (km)</label>
                  <input type="number" name="distance_km" value={formData.distance_km} onChange={handleChange} step="0.1" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Trip Date *</label>
                  <input type="date" name="trip_date" value={formData.trip_date} onChange={handleChange} className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" required />
                  {validationErrors.trip_date && <p className="mt-1 text-xs text-red-500">{validationErrors.trip_date}</p>}
                </div>
                <div>
                  <label className="block text-sm font-medium text-muted mb-1.5">Expected Delivery</label>
                  <input type="date" name="expected_delivery_date" value={formData.expected_delivery_date} onChange={handleChange} className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-muted mb-1.5">Freight Amount (₹) *</label>
                <input type="number" name="freight_amount" value={formData.freight_amount} onChange={handleChange} step="0.01" placeholder="0.00" className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors" required />
                {validationErrors.freight && <p className="mt-1 text-xs text-red-500">{validationErrors.freight}</p>}
              </div>
            </div>
          )}

          {/* Step 1: Resources */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>🚛</span> Resources
              </h3>
              <p className="text-sm text-muted">Select vehicle and driver for this trip. The transport owner is automatically resolved from the vehicle.</p>

              {/* Vehicle */}
              <div className="space-y-3" ref={vehicleDropdownRef}>
                <label className="block text-sm font-medium text-muted">Vehicle *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">🔍</span>
                  <input
                    type="text"
                    placeholder="Search vehicle by number or name..."
                    value={vehicleSearch}
                    onChange={(e) => { setVehicleSearch(e.target.value); setShowVehicleDropdown(true); }}
                    onFocus={() => setShowVehicleDropdown(true)}
                    className="w-full pl-9 pr-9 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">▼</span>
                </div>

                {showVehicleDropdown && (
                  <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl bg-surface shadow-lg">
                    {loading ? (
                      <div className="px-4 py-3 text-sm text-muted">Loading vehicles...</div>
                    ) : filteredVehicles.length > 0 ? (
                      filteredVehicles.map((vehicle) => (
                        <button
                          key={vehicle.vehicle_id}
                          type="button"
                          onClick={() => handleVehicleSelect(vehicle)}
                          className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                            formData.vehicle_id === vehicle.vehicle_id ? 'bg-amber-50' : ''
                          }`}
                        >
                          <div className="font-medium text-sm">{vehicle.vehicle_number}</div>
                          <div className="text-xs text-muted mt-1">{vehicle.vehicle_name} • {vehicle.vehicle_type}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted">No vehicles found</div>
                    )}
                  </div>
                )}

                {selectedVehicle && (
                  <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                    <div className="text-sm font-medium text-green-800">Selected: {selectedVehicle.vehicle_number}</div>
                    <div className="text-xs text-green-600">{selectedVehicle.vehicle_name} • {selectedVehicle.vehicle_type}</div>
                  </div>
                )}
              </div>

              {/* Auto-resolved Transport Owner */}
              {selectedVehicle?.owner_id && (
                <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="text-sm font-medium text-blue-800 mb-1">✓ Transport Owner (Auto-resolved)</div>
                  {(() => {
                    const owner = owners.find(o => o.owner_id === selectedVehicle.owner_id);
                    return owner ? (
                      <div>
                        <div className="text-sm text-blue-700 font-medium">{owner.owner_name}</div>
                        <div className="text-xs text-blue-600">{owner.company_name} • {owner.mobile}</div>
                      </div>
                    ) : (
                      <div className="text-sm text-blue-600">Owner ID: {selectedVehicle.owner_id}</div>
                    );
                  })()}
                </div>
              )}

              {/* Driver */}
              <div className="space-y-3" ref={driverDropdownRef}>
                <label className="block text-sm font-medium text-muted">Driver *</label>
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

                {!selectedVehicle && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700">
                    Select a vehicle first to filter drivers by transport owner.
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

              {validationErrors.vehicle && <p className="text-sm text-red-500">{validationErrors.vehicle}</p>}
              {validationErrors.driver && <p className="text-sm text-red-500">{validationErrors.driver}</p>}
            </div>
          )}

          {/* Step 2: Advance */}
          {currentStep === 2 && (
            <TripAdvanceStep
              formData={formData}
              onChange={(advances) => setFormData((prev) => ({ ...prev, advances }))}
              errors={validationErrors}
            />
          )}

          {/* Step 3: Review */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span>✓</span> Review & Create Trip
              </h3>

              <div className="space-y-3 p-4 bg-gray-50 rounded-xl">
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Customer</span>
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
                  <span className="text-sm text-muted">Vehicle</span>
                  <span className="text-sm font-medium">
                    {selectedVehicle ? selectedVehicle.vehicle_number : '-'}
                  </span>
                </div>
                <div className="flex justify-between py-2 border-b border-gray-200">
                  <span className="text-sm text-muted">Transport Owner</span>
                  <span className="text-sm font-medium">
                    {selectedOwner ? selectedOwner.owner_name : '-'}
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
                {formData.advances && formData.advances.length > 0 && (
                  <div className="flex justify-between py-2 border-b border-gray-200">
                    <span className="text-sm text-muted">Total Advance</span>
                    <span className="text-sm font-medium text-orange-600">
                      ₹{formData.advances.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0).toLocaleString('en-IN')}
                    </span>
                  </div>
                )}
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
    </div>
  );
}

export default TripWizard;

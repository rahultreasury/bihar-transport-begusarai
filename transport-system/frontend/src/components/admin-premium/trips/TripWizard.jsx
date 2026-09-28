import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { adminAPI } from '../../../services/api';
import TripAdvanceStep from './TripAdvanceStep';
import TransportResourceRegistrationModal from '../transport/TransportResourceRegistrationModal';
import ClientFormModal from '../clients/ClientFormModal';

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
    partner_id: '',
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
  const [partners, setPartners] = useState([]);
  const [allVehicles, setAllVehicles] = useState([]);
  const [allDrivers, setAllDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [clientSearch, setClientSearch] = useState('');
  const [partnerSearch, setPartnerSearch] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const [showPartnerDropdown, setShowPartnerDropdown] = useState(false);
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const [showDriverDropdown, setShowDriverDropdown] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const partnerDropdownRef = useRef(null);
  const vehicleDropdownRef = useRef(null);
  const driverDropdownRef = useRef(null);

  // Registration modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [registerContext, setRegisterContext] = useState({});
  const [registerResourceType, setRegisterResourceType] = useState(null);

  // Fetch base lookup data
  const fetchLookupData = useCallback(async () => {
    setLoading(true);
    try {
      const [clientsRes, offlineClientsRes, vehiclesRes, driversRes, ownersRes, partnersRes] = await Promise.all([
        adminAPI.getTripClients(''),
        adminAPI.getTripOfflineClients(''),
        adminAPI.getTripVehicles(''),
        adminAPI.getTripDrivers(''),
        adminAPI.getTripOwners(''),
        adminAPI.getPartners({ limit: 500 }),
      ]);

      if (clientsRes.data?.success) setClients(clientsRes.data.data || []);
      if (offlineClientsRes.data?.success) setOfflineClients(offlineClientsRes.data.data || []);
      if (vehiclesRes.data?.success) setAllVehicles(vehiclesRes.data.data || []);
      if (driversRes.data?.success) setAllDrivers(driversRes.data.data || []);
      if (ownersRes.data?.success) setOwners(ownersRes.data.data || []);
      if (partnersRes.data?.success) setPartners(partnersRes.data.data || []);
    } catch (err) {
      console.error('Failed to fetch lookup data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Registration modal handlers
  const handleOpenRegisterModal = useCallback((resourceType) => {
    setRegisterResourceType(resourceType);
    setRegisterContext({ sourcePage: 'trip-wizard', resourceType });
    setShowRegisterModal(true);
  }, []);

  const handleRegisterSuccess = useCallback((createdEntities) => {
    setShowRegisterModal(false);
    setRegisterContext({});
    setRegisterResourceType(null);
    
    // Auto-select the created resource in the form
    if (createdEntities.vehicle) {
      setFormData((prev) => ({ ...prev, vehicle_id: createdEntities.vehicle.vehicle_id }));
      setVehicleSearch(createdEntities.vehicle.vehicle_number);
    }
    if (createdEntities.driver) {
      setFormData((prev) => ({ ...prev, driver_id: createdEntities.driver.driver_id }));
      setDriverSearch(createdEntities.driver.driver_name);
    }
    if (createdEntities.owner) {
      setFormData((prev) => ({ ...prev, transport_owner_id: createdEntities.owner.owner_id }));
    }
    
    // Refresh lookup data to include new entities
    fetchLookupData();
  }, [fetchLookupData]);

  useEffect(() => {
    fetchLookupData();
    setShowClientModal(false);
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
        setClientSearch(editingTrip.client?.company_name || '');
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
    if (client._source === 'offline') {
      setFormData((prev) => ({ ...prev, client_id: client._id, user_id: '', source_type: 'OFFLINE_CLIENT' }));
      setClientSearch(client._name);
    } else {
      setFormData((prev) => ({ ...prev, user_id: client._id, client_id: '', source_type: 'ONLINE_BOOKING' }));
      setClientSearch(`${client.first_name} ${client.last_name}`);
    }
    setShowClientModal(false);
  };

  // Called by ClientFormModal after a new client is created.
  // Automatically selects the new client and refreshes the lookup list.
  const handleClientCreated = (createdClient) => {
    setFormData((prev) => ({
      ...prev,
      client_id: createdClient.client_id,
      user_id: '',
      source_type: 'OFFLINE_CLIENT',
    }));
    setClientSearch(createdClient.company_name);
    setShowClientModal(false);
    fetchLookupData();
  };

  const handleClearClient = () => {
    setFormData((prev) => ({ ...prev, client_id: '', user_id: '', source_type: 'ONLINE_BOOKING' }));
    setClientSearch('');
  };

  const handlePartnerSelect = async (partner) => {
    setFormData((prev) => ({ ...prev, partner_id: partner.partner_id, vehicle_id: '', driver_id: '', transport_owner_id: '' }));
    setPartnerSearch(`${partner.partner_name}`);
    setShowPartnerDropdown(false);
    setVehicleSearch('');
    setDriverSearch('');

    // Resolve the linked VehicleOwner for this partner and load only that
    // partner's vehicles + drivers (dependent selectors — ownership-aware).
    try {
      const ownerRes = await adminAPI.getOwnerByPartner(partner.partner_id);
      if (ownerRes.data?.success && ownerRes.data.data) {
        const owner = ownerRes.data.data;
        setFormData((prev) => ({ ...prev, transport_owner_id: owner.owner_id }));

        const [vehiclesRes, driversRes] = await Promise.all([
          adminAPI.getVehiclesByOwner(owner.owner_id),
          adminAPI.getDriversByOwner(owner.owner_id, ''),
        ]);
        if (vehiclesRes.data?.success) setAllVehicles(vehiclesRes.data.data || []);
        if (driversRes.data?.success) setAllDrivers(driversRes.data.data || []);
      } else {
        // Partner has no linked transport owner — clear dependent lists so the
        // UI cannot show vehicles/drivers from another partner.
        setAllVehicles([]);
        setAllDrivers([]);
      }
    } catch (err) {
      console.error('Failed to load partner resources:', err);
      setAllVehicles([]);
      setAllDrivers([]);
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
        if (!formData.partner_id) errors.partner = 'Please select a transport partner';
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
        partner_id: formData.partner_id ? parseInt(formData.partner_id) : null,
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

  const filteredOfflineClients = offlineClients.filter((client) => {
    const searchLower = clientSearch.toLowerCase();
    const company = (client.company_name || '').toLowerCase();
    const contact = (client.contact_person || '').toLowerCase();
    const phone = (client.phone || '').toLowerCase();
    const code = (client.client_code || '').toLowerCase();
    const email = (client.email || '').toLowerCase();
    return company.includes(searchLower) || contact.includes(searchLower) || phone.includes(searchLower) || code.includes(searchLower) || email.includes(searchLower);
  });

  // Merge both client sources for the dropdown
  const allFilteredClients = [
    ...filteredClients.map(c => ({ ...c, _source: 'online', _id: c.user_id, _name: `${c.first_name} ${c.last_name}`, _phone: c.phone, _code: null })),
    ...filteredOfflineClients.map(c => ({ ...c, _source: 'offline', _id: c.client_id, _name: c.company_name, _phone: c.phone, _code: c.client_code, _contact: c.contact_person })),
  ];

  const selectedClient = formData.source_type === 'OFFLINE_CLIENT' && formData.client_id
    ? offlineClients.find(c => c.client_id === parseInt(formData.client_id))
    : clients.find(c => c.user_id === parseInt(formData.user_id));
  const selectedVehicle = allVehicles.find(v => v.vehicle_id === parseInt(formData.vehicle_id));
  const selectedDriver = allDrivers.find(d => d.driver_id === parseInt(formData.driver_id));
  const selectedOwner = owners.find(o => o.owner_id === parseInt(formData.transport_owner_id));
  const selectedPartner = partners.find(p => p.partner_id === parseInt(formData.partner_id));

  // Partner options: filter the already-loaded `partners` list in real time
  const filteredPartners = useMemo(() => {
    const term = partnerSearch.trim().toLowerCase();
    if (!term) return partners;
    return partners.filter((p) =>
      (p.partner_name || '').toLowerCase().includes(term) ||
      (p.company_name || '').toLowerCase().includes(term) ||
      (p.city || '').toLowerCase().includes(term) ||
      (p.mobile || '').includes(partnerSearch.trim())
    );
  }, [partners, partnerSearch]);

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
                {selectedClient ? (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="font-medium text-amber-800">
                        {formData.source_type === 'OFFLINE_CLIENT'
                          ? selectedClient.company_name
                          : `${selectedClient.first_name} ${selectedClient.last_name}`}
                      </div>
                      <div className="text-sm text-amber-600 flex items-center gap-2">
                        {formData.source_type === 'OFFLINE_CLIENT' && selectedClient.client_code && (
                          <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-mono">{selectedClient.client_code}</span>
                        )}
                        {formData.source_type === 'OFFLINE_CLIENT' && selectedClient.contact_person && (
                          <span className="text-[11px]">{selectedClient.contact_person}</span>
                        )}
                        <span>{selectedClient.phone}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearClient}
                      className="text-amber-600 hover:text-amber-800 text-xl leading-none"
                      title="Clear selection"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      placeholder="Search by name, phone, or client code..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="w-full px-3 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                    />
                    {clientSearch && (
                      <div className="max-h-48 overflow-y-auto border border-border/60 rounded-xl mt-1">
                        {allFilteredClients.length > 0 ? (
                          allFilteredClients.slice(0, 10).map((client) => (
                            <button
                              key={`${client._source}-${client._id}`}
                              type="button"
                              onClick={() => handleClientSelect(client)}
                              className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                                (formData.source_type === 'ONLINE_BOOKING' && formData.user_id === client._id) ||
                                (formData.source_type === 'OFFLINE_CLIENT' && formData.client_id === client._id)
                                  ? 'bg-amber-50'
                                  : ''
                              }`}
                            >
                              <div className="font-medium">{client._name}</div>
                              <div className="text-xs text-muted flex items-center gap-2">
                                {client._code && <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px] font-mono">{client._code}</span>}
                                {client._contact && <span className="text-[11px]">{client._contact}</span>}
                                <span>{client._phone}</span>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="px-4 py-3 text-sm text-muted">No clients found</div>
                        )}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setShowClientModal(true)}
                      className="w-full py-3 border-2 border-dashed border-border/60 rounded-xl text-sm font-medium text-muted hover:border-amber-500 hover:text-amber-600 transition-colors mt-2"
                    >
                      + Add New Client
                    </button>
                  </>
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
              <p className="text-sm text-muted">Select a transport partner first. The partner's linked transport owner, vehicles, and drivers are then loaded automatically so the assignment stays ownership-consistent.</p>

              {/* Partner / Transport Owner */}
              <div className="space-y-3" ref={partnerDropdownRef}>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-muted">Transport Partner *</label>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">🔍</span>
                  <input
                    type="text"
                    placeholder="Search partner by name or company..."
                    value={partnerSearch}
                    onChange={(e) => { setPartnerSearch(e.target.value); setShowPartnerDropdown(true); }}
                    onFocus={() => setShowPartnerDropdown(true)}
                    className="w-full pl-9 pr-9 py-2.5 bg-surface border border-border/60 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-colors"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">▼</span>
                </div>

                {showPartnerDropdown && (
                  <div className="max-h-60 overflow-y-auto border border-border/60 rounded-xl bg-surface shadow-lg">
                    {loading ? (
                      <div className="px-4 py-3 text-sm text-muted">Loading partners...</div>
                    ) : filteredPartners.length > 0 ? (
                      filteredPartners.map((partner) => (
                        <button
                          key={partner.partner_id}
                          type="button"
                          onClick={() => handlePartnerSelect(partner)}
                          className={`w-full text-left px-4 py-3 hover:bg-hover/60 transition-colors border-b border-border/40 last:border-0 ${
                            formData.partner_id === partner.partner_id ? 'bg-amber-50' : ''
                          }`}
                        >
                          <div className="font-medium text-sm">{partner.partner_name}</div>
                          <div className="text-xs text-muted mt-1">{partner.company_name} • {partner.city}</div>
                        </button>
                      ))
                    ) : (
                      <div className="px-4 py-3 text-sm text-muted">No partners found</div>
                    )}
                  </div>
                )}

                {selectedPartner && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <div className="text-sm font-medium text-amber-800">Selected: {selectedPartner.partner_name}</div>
                    <div className="text-xs text-amber-600">{selectedPartner.company_name} • {selectedPartner.city}</div>
                  </div>
                )}
                {validationErrors.partner && <p className="text-sm text-red-500">{validationErrors.partner}</p>}
              </div>

              {/* Vehicle */}
              <div className="space-y-3" ref={vehicleDropdownRef}>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-muted">Vehicle *</label>
                  <button
                    type="button"
                    onClick={() => handleOpenRegisterModal('vehicle')}
                    className="px-3 py-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 hover:underline"
                  >
                    + Add New Vehicle
                  </button>
                </div>
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
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-muted">Driver *</label>
                  <button
                    type="button"
                    onClick={() => handleOpenRegisterModal('driver')}
                    className="px-3 py-1.5 text-xs font-medium text-amber-600 hover:text-amber-700 hover:underline"
                  >
                    + Add New Driver
                  </button>
                </div>
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
                    {selectedClient
                      ? formData.source_type === 'OFFLINE_CLIENT'
                        ? `${selectedClient.company_name}${selectedClient.client_code ? ` (${selectedClient.client_code})` : ''}`
                        : `${selectedClient.first_name} ${selectedClient.last_name}`
                      : '-'}
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
                  <span className="text-sm text-muted">Transport Partner</span>
                  <span className="text-sm font-medium">
                    {selectedPartner ? selectedPartner.partner_name : '-'}
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

      {showRegisterModal && (
        <TransportResourceRegistrationModal
          isOpen={showRegisterModal}
          onClose={() => { setShowRegisterModal(false); setRegisterContext({}); setRegisterResourceType(null); }}
          onSuccess={handleRegisterSuccess}
          context={registerContext}
        />
      )}

      <ClientFormModal
        isOpen={showClientModal}
        onClose={() => setShowClientModal(false)}
        onSuccess={handleClientCreated}
      />
    </div>
  );
}

export default TripWizard;

import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'vehicle-owners', label: 'Vehicle Owners', icon: '👤' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

export default function AdminVehicleOwnerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();

  // --- State ---
  const [owner, setOwner] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // --- Data fetching ---
  useEffect(() => {
    fetchOwnerProfile();
  }, [id]);

  const fetchOwnerProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ownerRes, bookingsRes] = await Promise.all([
        adminAPI.getVehicleOwner(id),
        adminAPI.getVehicleOwnerBookings(id, { limit: 10 }),
      ]);
      if (ownerRes.data?.success) {
        setOwner(ownerRes.data.data);
      }
      if (bookingsRes.data?.success) {
        setBookings(bookingsRes.data.data || []);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch vehicle owner profile');
    } finally {
      setLoading(false);
    }
  };

  const fetchDrivers = async () => {
    setDriversLoading(true);
    try {
      const res = await adminAPI.getVehicleOwnerDrivers(id, { limit: 50 });
      if (res.data?.success) {
        setDrivers(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch drivers:', err);
    } finally {
      setDriversLoading(false);
    }
  };

  const fetchVehicles = async () => {
    setVehiclesLoading(true);
    try {
      const res = await adminAPI.getVehicleOwnerVehicles(id, { limit: 50 });
      if (res.data?.success) {
        setVehicles(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch vehicles:', err);
    } finally {
      setVehiclesLoading(false);
    }
  };

  const fetchTrips = async () => {
    if (!id) return;
    setTripsLoading(true);
    try {
      const res = await adminAPI.getTripsByOwnerId(id, { limit: 50 });
      if (res.data?.success) {
        setTrips(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch owner trips:', err);
    } finally {
      setTripsLoading(false);
    }
  };

  const fetchActivities = async () => {
    if (!id) return;
    setActivitiesLoading(true);
    try {
      const res = await adminAPI.getEntityAuditLogs('vehicle_owner', id, { limit: 20 });
      if (res.data?.success) {
        setActivities(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch activities:', err);
    } finally {
      setActivitiesLoading(false);
    }
  };

  // Fetch drivers for DRIVER_OWNER to show linked driver info
  useEffect(() => {
    if (owner?.owner_type === 'DRIVER_OWNER' && drivers.length === 0 && !driversLoading) {
      fetchDrivers();
    }
  }, [owner?.owner_type]);

  // Fetch data for active tab
  useEffect(() => {
    if (activeTab === 'drivers' && drivers.length === 0 && !driversLoading) {
      fetchDrivers();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'vehicles' && vehicles.length === 0 && !vehiclesLoading) {
      fetchVehicles();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'trips' && trips.length === 0 && !tripsLoading) {
      fetchTrips();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'overview' && activities.length === 0 && !activitiesLoading) {
      fetchActivities();
    }
  }, [activeTab]);

  const handleAddVehicle = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setFormError('');

    const formData = new FormData(e.target);
    const data = {
      vehicle_number: formData.get('vehicle_number'),
      vehicle_type: formData.get('vehicle_type'),
      vehicle_name: formData.get('vehicle_name'),
      capacity_kg: formData.get('capacity_kg') ? parseFloat(formData.get('capacity_kg')) : null,
      capacity_volume: formData.get('capacity_volume') ? parseFloat(formData.get('capacity_volume')) : null,
      vehicle_make: formData.get('vehicle_make') || null,
      vehicle_model: formData.get('vehicle_model') || null,
      manufacturing_year: formData.get('manufacturing_year') ? parseInt(formData.get('manufacturing_year')) : null,
      registration_date: formData.get('registration_date') || null,
      insurance_number: formData.get('insurance_number') || null,
      insurance_expiry: formData.get('insurance_expiry') || null,
      permit_number: formData.get('permit_number') || null,
      permit_expiry: formData.get('permit_expiry') || null,
      pollution_certificate: formData.get('pollution_certificate') || null,
      pollution_expiry: formData.get('pollution_expiry') || null,
      base_location: formData.get('base_location') || null,
      hourly_rate: formData.get('hourly_rate') ? parseFloat(formData.get('hourly_rate')) : null,
      per_km_rate: formData.get('per_km_rate') ? parseFloat(formData.get('per_km_rate')) : null,
    };

    try {
      const res = await adminAPI.createVehicleOwnerVehicle(id, data);
      if (res.data?.success) {
        setShowAddVehicleModal(false);
        fetchVehicles();
        fetchOwnerProfile();
      } else {
        setFormError(res.data?.message || 'Failed to add vehicle');
      }
    } catch (err) {
      setFormError(err.response?.data?.message || 'Failed to add vehicle');
    } finally {
      setSubmitting(false);
    }
  };

  // --- Derived data ---
  const activeVehicles = useMemo(() => vehicles.filter(v => v.current_status === 'available').length, [vehicles]);
  const availableDrivers = useMemo(() => drivers.filter(d => d.status === 'available').length, [drivers]);
  const activeTripsCount = useMemo(() => trips.filter(t => ['pending', 'confirmed', 'in_transit', 'pickup_completed'].includes(t.status)).length, [trips]);
  const pendingApplications = useMemo(() => (owner?.applications?.length || 0), [owner]);

  const getInitials = (name) => {
    if (!name) return '??';
    return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-100 text-green-700';
      case 'inactive': return 'bg-gray-100 text-gray-600';
      case 'suspended': return 'bg-red-100 text-red-700';
      default: return 'bg-gray-100 text-gray-600';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatDateTime = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // --- Conditional returns AFTER all hooks ---
  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      </AdminShell>
    );
  }

  if (error || !owner) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
        <div className="text-center py-12">
          <p className="text-red-500">{error || 'Vehicle owner not found'}</p>
          <button onClick={() => navigate('/admin/vehicle-owners')} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-xl">
            Back to Vehicle Owners
          </button>
        </div>
      </AdminShell>
    );
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'vehicles', label: 'Vehicles', count: owner._count?.vehicles || 0 },
    { key: 'drivers', label: 'Drivers', count: owner._count?.drivers || 0 },
    { key: 'trips', label: 'Trips', count: trips.length },
    { key: 'bookings', label: 'Bookings', count: owner._count?.bookings || 0 },
  ];

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
      <div className="space-y-6">
        {/* ==================== PREMIUM PROFILE HEADER ==================== */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            {/* Left: Identity */}
            <div className="flex items-center gap-5">
              <button
                onClick={() => navigate('/admin/vehicle-owners')}
                className="p-2 rounded-lg hover:bg-hover/60 transition"
              >
                <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-2xl font-bold text-amber-700 dark:text-amber-400">
                {getInitials(owner.owner_name)}
              </div>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-2xl font-bold text-text">{owner.owner_name}</h1>
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusColor(owner.status)}`}>
                    {owner.status || 'N/A'}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted flex-wrap">
                  <span className="font-mono text-xs bg-hover/60 px-2 py-0.5 rounded">{owner.owner_code || '—'}</span>
                  <span>{owner.mobile}</span>
                  <span>{owner.city}{owner.state ? `, ${owner.state}` : ''}</span>
                </div>
              </div>
            </div>

            {/* Right: Quick Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => navigate(`/admin/vehicle-owners/${id}/edit`)}
                className="px-3 py-2 text-sm font-medium text-muted hover:text-text border border-border rounded-xl hover:bg-hover/60 transition"
              >
                Edit Owner
              </button>
              <button
                onClick={() => setShowAddVehicleModal(true)}
                className="px-3 py-2 text-sm font-medium bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
              >
                + Add Vehicle
              </button>
              <button
                onClick={() => navigate('/admin/drivers/create?owner_id=' + id)}
                className="px-3 py-2 text-sm font-medium border border-border rounded-xl hover:bg-hover/60 transition"
              >
                + Add Driver
              </button>
              <button
                onClick={() => navigate('/admin/trips/create?owner_id=' + id)}
                className="px-3 py-2 text-sm font-medium border border-border rounded-xl hover:bg-hover/60 transition"
              >
                + Create Trip
              </button>
            </div>
          </div>
        </div>

        {/* ==================== FINANCIAL + OPERATIONAL KPIs ==================== */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard title="Total Vehicles" value={owner._count?.vehicles || 0} icon="🚛" color="blue" />
          <KpiCard title="Active Vehicles" value={activeVehicles} icon="🟢" color="green" />
          <KpiCard title="Total Drivers" value={owner._count?.drivers || 0} icon="👨‍✈️" color="sky" />
          <KpiCard title="Available Drivers" value={availableDrivers} icon="✅" color="emerald" />
          <KpiCard title="Active Trips" value={activeTripsCount} icon="🚚" color="purple" />
          <KpiCard title="Total Bookings" value={owner._count?.bookings || 0} icon="📦" color="amber" />
        </div>

        {/* ==================== BUSINESS HEALTH ==================== */}
        <div className="bg-card rounded-2xl border border-border p-6">
          <h3 className="text-lg font-semibold text-text mb-4">Business Health</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${owner.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <div>
                <div className="text-xs text-muted">Owner Status</div>
                <div className="text-sm font-medium capitalize">{owner.status || 'N/A'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${activeVehicles > 0 ? 'bg-green-500' : 'bg-orange-500'}`}></div>
              <div>
                <div className="text-xs text-muted">Vehicle Availability</div>
                <div className="text-sm font-medium">{activeVehicles > 0 ? `${activeVehicles} Available` : 'No Vehicles'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${availableDrivers > 0 ? 'bg-green-500' : 'bg-orange-500'}`}></div>
              <div>
                <div className="text-xs text-muted">Driver Availability</div>
                <div className="text-sm font-medium">{availableDrivers > 0 ? `${availableDrivers} Available` : 'No Drivers'}</div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${activeTripsCount === 0 ? 'bg-green-500' : 'bg-blue-500'}`}></div>
              <div>
                <div className="text-xs text-muted">Active Trips</div>
                <div className="text-sm font-medium">{activeTripsCount} In Progress</div>
              </div>
            </div>
          </div>
          {pendingApplications > 0 && (
            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-xl flex items-center gap-2">
              <span className="text-orange-600 text-sm font-medium">⚠ {pendingApplications} pending application(s) awaiting review</span>
            </div>
          )}
        </div>

        {/* ==================== TABS ==================== */}
        <div className="border-b border-border">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 px-4 text-sm font-medium transition border-b-2 whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                    activeTab === tab.key ? 'bg-amber-100 text-amber-700' : 'bg-hover/60 text-muted'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ==================== OVERVIEW TAB ==================== */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Contact & Business Info */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-card rounded-2xl border border-border p-6">
                <h3 className="text-lg font-semibold text-text mb-4">Contact Information</h3>
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-muted">Mobile</span>
                    <span className="text-text font-medium">{owner.mobile}</span>
                  </div>
                  {owner.alternate_mobile && (
                    <div className="flex justify-between">
                      <span className="text-muted">Alternate Mobile</span>
                      <span className="text-text font-medium">{owner.alternate_mobile}</span>
                    </div>
                  )}
                  {owner.email && (
                    <div className="flex justify-between">
                      <span className="text-muted">Email</span>
                      <span className="text-text font-medium">{owner.email}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">City</span>
                    <span className="text-text font-medium">{owner.city || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">State</span>
                    <span className="text-text font-medium">{owner.state || 'Bihar'}</span>
                  </div>
                  {owner.address && (
                    <div className="flex justify-between">
                      <span className="text-muted">Address</span>
                      <span className="text-text font-medium text-right max-w-[60%]">{owner.address}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-card rounded-2xl border border-border p-6">
                <h3 className="text-lg font-semibold text-text mb-4">Business Information</h3>
                <div className="space-y-3">
                  {owner.company_name && (
                    <div className="flex justify-between">
                      <span className="text-muted">Company</span>
                      <span className="text-text font-medium">{owner.company_name}</span>
                    </div>
                  )}
                  {owner.gst_number && (
                    <div className="flex justify-between">
                      <span className="text-muted">GST Number</span>
                      <span className="text-text font-medium">{owner.gst_number}</span>
                    </div>
                  )}
                  {owner.pan_number && (
                    <div className="flex justify-between">
                      <span className="text-muted">PAN Number</span>
                      <span className="text-text font-medium">{owner.pan_number}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Member Since</span>
                    <span className="text-text font-medium">{formatDate(owner.created_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Owner Type</span>
                    <span className="text-text font-medium capitalize">{owner.owner_type?.replace('_', ' ') || 'Transport Company'}</span>
                  </div>
                </div>
              </div>

              {/* Phase 2.3 — SELF OWNER relationship section */}
              {String(owner.owner_type || '').toUpperCase() === 'DRIVER_OWNER' && (
                <div className="bg-card rounded-2xl border border-violet-500/30 bg-violet-500/5 p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-violet-500/15 flex items-center justify-center">
                      <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-violet-700 dark:text-violet-300">SELF OWNER</h3>
                      <p className="text-xs text-violet-600/80 dark:text-violet-400/80">This person is both the Transport Owner and the Driver</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Owner side */}
                    <div className="p-3 rounded-xl bg-white/50 dark:bg-gray-800/50 border border-violet-500/20">
                      <div className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1">Transport Owner</div>
                      <div className="text-sm font-bold text-text">{owner.owner_name}</div>
                      <div className="text-xs text-muted font-mono">{owner.owner_code}</div>
                    </div>
                    {/* Driver side */}
                    <div className="p-3 rounded-xl bg-white/50 dark:bg-gray-800/50 border border-violet-500/20">
                      <div className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1">Driver</div>
                      {owner.drivers && owner.drivers.length > 0 ? (
                        <>
                          <div className="text-sm font-bold text-text">{owner.drivers[0].driver_name}</div>
                          <div className="text-xs text-muted font-mono">{owner.drivers[0].driver_code}</div>
                        </>
                      ) : (
                        <div className="text-sm text-muted">No driver linked yet</div>
                      )}
                    </div>
                  </div>
                  {/* Vehicles */}
                  {owner.vehicles && owner.vehicles.length > 0 && (
                    <div className="mt-3 p-3 rounded-xl bg-white/50 dark:bg-gray-800/50 border border-violet-500/20">
                      <div className="text-[10px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wider mb-1">Vehicle(s)</div>
                      <div className="flex flex-wrap gap-2">
                        {owner.vehicles.map(v => (
                          <span key={v.vehicle_id} className="text-xs font-mono font-semibold text-text bg-violet-500/10 px-2 py-0.5 rounded">
                            {v.vehicle_number}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex items-center gap-2 text-xs text-violet-600 dark:text-violet-400">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                    <span className="font-semibold">Relationship: Owner + Driver</span>
                  </div>
                </div>
              )}
            </div>

            {/* Recent Activity Timeline */}
            <div className="bg-card rounded-2xl border border-border p-6">
              <h3 className="text-lg font-semibold text-text mb-4">Recent Activity</h3>
              {activitiesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
                </div>
              ) : activities.length > 0 ? (
                <div className="space-y-4">
                  {activities.map((activity, idx) => (
                    <div key={activity.audit_id || idx} className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500 mt-2 flex-shrink-0"></div>
                      <div className="flex-1">
                        <p className="text-sm text-text">{activity.action || 'Activity recorded'}</p>
                        <p className="text-xs text-muted mt-0.5">{formatDateTime(activity.created_at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState title="No recent activity" subtitle="Activity will appear here as operations are performed." />
              )}
            </div>
          </div>
        )}

        {/* ==================== VEHICLES TAB ==================== */}
        {activeTab === 'vehicles' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text">Vehicles</h3>
              <button
                onClick={() => setShowAddVehicleModal(true)}
                className="px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
              >
                + Add Vehicle
              </button>
            </div>
            {vehiclesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
              </div>
            ) : vehicles.length > 0 ? (
              <PremiumTable
                columns={[
                  { key: 'vehicle_number', label: 'Vehicle Number', render: (v) => (
                    <button
                      onClick={() => navigate(`/admin/vehicles/${v.vehicle_id}`)}
                      className="text-amber-600 hover:text-amber-700 font-medium font-mono text-sm"
                    >
                      {v.vehicle_number}
                    </button>
                  )},
                  { key: 'vehicle_type', label: 'Type', render: (v) => `${v.vehicle_type}${v.vehicle_name ? ' — ' + v.vehicle_name : ''}` },
                  { key: 'current_status', label: 'Status', render: (v) => {
                    const statusColors = {
                      available: 'bg-green-100 text-green-700',
                      assigned: 'bg-blue-100 text-blue-700',
                      on_trip: 'bg-blue-100 text-blue-700',
                      inactive: 'bg-gray-100 text-gray-600',
                      maintenance: 'bg-orange-100 text-orange-700',
                    };
                    return (
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[v.current_status] || 'bg-gray-100 text-gray-600'}`}>
                        {v.current_status || 'inactive'}
                      </span>
                    );
                  }},
                  { key: 'driver', label: 'Assigned Driver', render: (v) => v.driver ? v.driver.driver_name : '—' },
                  { key: 'actions', label: '', render: (v) => (
                    <button
                      onClick={() => navigate(`/admin/vehicles/${v.vehicle_id}`)}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      View
                    </button>
                  )},
                ]}
                rows={vehicles}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🚛</div>
                <p className="text-muted mb-4">No vehicles registered for this owner yet.</p>
                <button
                  onClick={() => setShowAddVehicleModal(true)}
                  className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
                >
                  + Add First Vehicle
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== DRIVERS TAB ==================== */}
        {activeTab === 'drivers' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text">Drivers</h3>
              <button
                onClick={() => navigate('/admin/drivers/create?owner_id=' + id)}
                className="px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
              >
                + Add Driver
              </button>
            </div>
            {driversLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
              </div>
            ) : drivers.length > 0 ? (
              <PremiumTable
                columns={[
                  { key: 'driver_name', label: 'Name', render: (d) => (
                    <div>
                      <div className="font-medium">{d.driver_name}</div>
                      <div className="text-[10px] text-muted font-mono">{d.driver_code}</div>
                    </div>
                  )},
                  { key: 'mobile', label: 'Mobile', render: (d) => d.mobile },
                  { key: 'vehicle', label: 'Assigned Vehicle', render: (d) => {
                    const v = d.currentVehicle;
                    return v ? (
                      <div>
                        <div className="font-mono text-sm">{v.vehicle_number}</div>
                        <div className="text-[10px] text-muted">{v.vehicle_type}</div>
                      </div>
                    ) : <span className="text-muted text-xs">—</span>;
                  }},
                  { key: 'status', label: 'Status', render: (d) => {
                    const statusColors = {
                      available: 'bg-green-100 text-green-700',
                      on_trip: 'bg-blue-100 text-blue-700',
                      offline: 'bg-gray-100 text-gray-600',
                    };
                    return (
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[d.status] || 'bg-gray-100 text-gray-600'}`}>
                        {d.status}
                      </span>
                    );
                  }},
                  { key: 'actions', label: '', render: (d) => (
                    <button
                      onClick={() => navigate(`/admin/drivers/${d.driver_id}`)}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      View Profile
                    </button>
                  )},
                ]}
                rows={drivers}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">👨‍✈️</div>
                <p className="text-muted mb-4">No drivers connected to this owner yet.</p>
                <button
                  onClick={() => navigate('/admin/drivers/create?owner_id=' + id)}
                  className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
                >
                  + Add First Driver
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== TRIPS TAB ==================== */}
        {activeTab === 'trips' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text">Trip History</h3>
              <button
                onClick={() => navigate('/admin/trips/create?owner_id=' + id)}
                className="px-3 py-1.5 text-sm font-medium bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
              >
                + Create Trip
              </button>
            </div>
            {tripsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
              </div>
            ) : trips.length > 0 ? (
              <PremiumTable
                columns={[
                  { key: 'trip_number', label: 'Trip #', render: (t) => (
                    <span className="text-amber-600 font-medium font-mono text-sm">{t.trip_number}</span>
                  )},
                  { key: 'client', label: 'Client', render: (t) => t.user ? `${t.user.first_name} ${t.user.last_name}` : '—' },
                  { key: 'route', label: 'Route', render: (t) => `${t.pickup_city || '—'} → ${t.drop_city || '—'}` },
                  { key: 'vehicle', label: 'Vehicle', render: (t) => t.vehicle?.vehicle_number || '—' },
                  { key: 'driver', label: 'Driver', render: (t) => t.driver?.driver_name || '—' },
                  { key: 'status', label: 'Status', render: (t) => {
                    const statusColors = {
                      COMPLETED: 'bg-green-100 text-green-700',
                      DELIVERED: 'bg-green-100 text-green-700',
                      CANCELLED: 'bg-red-100 text-red-700',
                      IN_TRANSIT: 'bg-blue-100 text-blue-700',
                      pending: 'bg-orange-100 text-orange-700',
                      confirmed: 'bg-blue-100 text-blue-700',
                    };
                    return (
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[t.status] || 'bg-gray-100 text-gray-600'}`}>
                        {String(t.status || '—').replace(/_/g, ' ')}
                      </span>
                    );
                  }},
                  { key: 'actions', label: '', render: (t) => (
                    <button
                      onClick={() => navigate(`/admin/trips/${t.trip_id}`)}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      View
                    </button>
                  )},
                ]}
                rows={trips}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">🗺️</div>
                <p className="text-muted mb-4">No trips created for this owner yet.</p>
                <button
                  onClick={() => navigate('/admin/trips/create?owner_id=' + id)}
                  className="px-4 py-2 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition"
                >
                  + Create First Trip
                </button>
              </div>
            )}
          </div>
        )}

        {/* ==================== BOOKINGS TAB ==================== */}
        {activeTab === 'bookings' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-lg font-semibold text-text mb-4">Recent Bookings</h3>
            {bookings.length > 0 ? (
              <PremiumTable
                columns={[
                  { key: 'booking_number', label: 'Booking #', render: (b) => (
                    <span className="text-amber-600 font-medium font-mono text-sm">{b.booking_number || b.booking_reference || '—'}</span>
                  )},
                  { key: 'pickup_city', label: 'From', render: (b) => b.pickup_city || '—' },
                  { key: 'drop_city', label: 'To', render: (b) => b.drop_city || '—' },
                  { key: 'status', label: 'Status', render: (b) => {
                    const statusColors = {
                      delivered: 'bg-green-100 text-green-700',
                      completed: 'bg-green-100 text-green-700',
                      cancelled: 'bg-red-100 text-red-700',
                      in_transit: 'bg-blue-100 text-blue-700',
                      pending: 'bg-orange-100 text-orange-700',
                      confirmed: 'bg-blue-100 text-blue-700',
                    };
                    return (
                      <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${statusColors[b.status] || 'bg-gray-100 text-gray-600'}`}>
                        {String(b.status || '—').replace(/_/g, ' ')}
                      </span>
                    );
                  }},
                  { key: 'final_price', label: 'Amount', render: (b) => b.final_price ? `₹${Number(b.final_price).toLocaleString('en-IN')}` : '—' },
                  { key: 'actions', label: '', render: (b) => (
                    <button
                      onClick={() => navigate(`/admin/bookings/${b.booking_id}`)}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium"
                    >
                      View
                    </button>
                  )},
                ]}
                rows={bookings}
              />
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3">📦</div>
                <p className="text-muted">No bookings found for this owner.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

import React, { useEffect, useState } from 'react';
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
  const [owner, setOwner] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [vehicles, setVehicles] = useState([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAddVehicleModal, setShowAddVehicleModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

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
        setBookings(bookingsRes.data.data);
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
        // Refresh owner profile to update counts
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
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'drivers', label: 'Drivers' },
    { key: 'bookings', label: 'Bookings' },
  ];

  // Fetch drivers when drivers tab is active
  useEffect(() => {
    if (activeTab === 'drivers' && drivers.length === 0 && !driversLoading) {
      fetchDrivers();
    }
  }, [activeTab]);

  // Fetch vehicles when vehicles tab is active
  useEffect(() => {
    if (activeTab === 'vehicles' && vehicles.length === 0 && !vehiclesLoading) {
      fetchVehicles();
    }
  }, [activeTab]);

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicle-owners">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/admin/vehicle-owners')}
            className="p-2 rounded-lg hover:bg-hover/60 transition"
          >
            <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-2xl font-bold text-amber-700 dark:text-amber-400">
              {owner.owner_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text">{owner.owner_name}</h1>
              {owner.company_name && <p className="text-muted">{owner.company_name}</p>}
              <p className="text-sm text-muted">{owner.mobile} • {owner.city}</p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard title="Total Vehicles" value={owner._count?.vehicles || 0} icon="🚛" color="blue" />
          <KpiCard title="Total Drivers" value={owner._count?.drivers || 0} icon="⌁" color="sky" />
          <KpiCard title="Total Bookings" value={owner._count?.bookings || 0} icon="📦" color="purple" />
          <KpiCard title="Status" value={owner.status || 'N/A'} icon="📊" color="green" />
          <KpiCard title="Member Since" value={new Date(owner.created_at).toLocaleDateString()} icon="📅" color="amber" />
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-4">
            {tabs.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 px-1 text-sm font-medium transition border-b-2 ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'border-transparent text-muted hover:text-text'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
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
                  <span className="text-text font-medium">{owner.city || '-'}</span>
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
                {owner.bank_account && (
                  <div className="flex justify-between">
                    <span className="text-muted">Bank Account</span>
                    <span className="text-text font-medium">{owner.bank_account}</span>
                  </div>
                )}
                {owner.bank_ifsc && (
                  <div className="flex justify-between">
                    <span className="text-muted">Bank IFSC</span>
                    <span className="text-text font-medium">{owner.bank_ifsc}</span>
                  </div>
                )}
                {owner.upi_id && (
                  <div className="flex justify-between">
                    <span className="text-muted">UPI ID</span>
                    <span className="text-text font-medium">{owner.upi_id}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'vehicles' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-lg font-semibold text-text mb-4">Vehicles</h3>
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
                  { key: 'vehicle_type', label: 'Type', render: (v) => `${v.vehicle_type} — ${v.vehicle_name || ''}`.trim() },
                  { key: 'current_status', label: 'Status', render: (v) => (
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                      v.current_status === 'available' ? 'bg-green-100 text-green-700' :
                      v.current_status === 'assigned' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {v.current_status || 'inactive'}
                    </span>
                  )},
                ]}
                data={vehicles}
                onRowClick={(v) => navigate(`/admin/vehicles/${v.vehicle_id}`)}
              />
            ) : (
              <EmptyMessage message="No vehicles registered for this owner" />
            )}
          </div>
        )}

        {activeTab === 'drivers' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-lg font-semibold text-text mb-4">Drivers</h3>
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
                  { key: 'status', label: 'Status', render: (d) => (
                    <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${
                      d.status === 'available' ? 'bg-green-100 text-green-700' :
                      d.status === 'on_trip' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {d.status}
                    </span>
                  )},
                  { key: 'vehicle', label: 'Vehicle', render: (d) => {
                    const v = d.currentVehicle;
                    return v ? (
                      <div>
                        <div className="font-mono text-sm">{v.vehicle_number}</div>
                        <div className="text-[10px] text-muted">{v.vehicle_type}</div>
                      </div>
                    ) : <span className="text-muted text-xs">—</span>;
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
                data={drivers}
                onRowClick={(d) => navigate(`/admin/drivers/${d.driver_id}`)}
              />
            ) : (
              <EmptyMessage message="No drivers assigned to this transport owner" />
            )}
          </div>
        )}

        {activeTab === 'bookings' && (
          <div className="bg-card rounded-2xl border border-border p-6">
            <h3 className="text-lg font-semibold text-text mb-4">Recent Bookings</h3>
            {bookings.length > 0 ? (
              <PremiumTable
                columns={[
                  { key: 'booking_number', label: 'Booking #' },
                  { key: 'pickup_city', label: 'From' },
                  { key: 'drop_city', label: 'To' },
                  { key: 'status', label: 'Status' },
                  { key: 'final_price', label: 'Price', render: (b) => b.final_price ? `₹${b.final_price.toLocaleString()}` : '-' },
                ]}
                data={bookings}
              />
            ) : (
              <EmptyMessage message="No bookings found" />
            )}
          </div>
        )}
      </div>
    </AdminShell>
  );
}

function EmptyMessage({ message }) {
  return (
    <div className="text-center py-8">
      <p className="text-muted">{message}</p>
    </div>
  );
}

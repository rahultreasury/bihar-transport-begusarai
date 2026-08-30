import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import KpiCard from '../components/admin-premium/ui/KpiCard';
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

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'trips', label: 'Trip History' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'documents', label: 'Documents' },
  { key: 'assignments', label: 'Assignments' },
];

export default function AdminVehicleProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [vehicle, setVehicle] = useState(null);
  const [owner, setOwner] = useState(null);
  const [driver, setDriver] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [showAssignDriverModal, setShowAssignDriverModal] = useState(false);
  const [trips, setTrips] = useState([]);
  const [tripsLoading, setTripsLoading] = useState(false);

  useEffect(() => {
    fetchVehicleProfile();
  }, [id]);

  const fetchVehicleProfile = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminAPI.getVehicle(id);
      if (res.data?.success && res.data.data) {
        const v = res.data.data;
        setVehicle(v);
        setOwner(v.owner_name ? {
          owner_id: v.owner_id,
          owner_name: v.owner_name,
          owner_code: v.owner_code,
          company_name: v.company_name,
          mobile: v.owner_phone,
          email: v.owner?.email,
          city: v.owner?.city,
          state: v.owner?.state,
        } : null);
        setDriver(v.driver_id ? {
          driver_id: v.driver_id,
          driver_name: v.driver_name,
          driver_code: v.driver_code,
          mobile: v.driver_phone,
        } : null);
      } else {
        setError('Vehicle not found');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to fetch vehicle profile');
    } finally {
      setLoading(false);
    }
  };

  const handleAssignSuccess = () => {
    setShowAssignDriverModal(false);
    fetchVehicleProfile();
  };

  // Fetch trips when trips tab is active
  useEffect(() => {
    if (activeTab === 'trips' && id && trips.length === 0 && !tripsLoading) {
      fetchTrips();
    }
  }, [activeTab, id]);

  const fetchTrips = async () => {
    if (!id) return;
    setTripsLoading(true);
    try {
      const res = await adminAPI.getTripsByVehicleId(id, { limit: 50 });
      if (res.data?.success) {
        setTrips(res.data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch vehicle trips:', err);
    } finally {
      setTripsLoading(false);
    }
  };

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicles">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500"></div>
        </div>
      </AdminShell>
    );
  }

  if (error || !vehicle) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="vehicles">
        <div className="text-center py-12">
          <p className="text-red-500">{error || 'Vehicle not found'}</p>
          <button onClick={() => navigate('/admin/vehicles')} className="mt-4 px-4 py-2 bg-amber-500 text-white rounded-xl">
            Back to Vehicles
          </button>
        </div>
      </AdminShell>
    );
  }

  const rawStatus = vehicle.current_status || (vehicle.is_available ? 'available' : 'inactive');
  const status = rawStatus === 'assigned' ? 'on_trip' : rawStatus;
  const statusColors = {
    available: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20',
    on_trip: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400 border-blue-200 dark:border-blue-500/20',
    maintenance: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 border-amber-200 dark:border-amber-500/20',
    inactive: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400 border-slate-200 dark:border-slate-500/20',
  };

  const getDocumentStatus = (expiryDate) => {
    if (!expiryDate) return { label: 'N/A', color: 'slate' };
    const today = new Date();
    const expiry = new Date(expiryDate);
    const thirtyDays = new Date();
    thirtyDays.setDate(today.getDate() + 30);
    
    if (expiry <= today) return { label: 'Expired', color: 'red' };
    if (expiry <= thirtyDays) return { label: 'Expiring Soon', color: 'amber' };
    return { label: 'Valid', color: 'green' };
  };

  const docStyles = {
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
    red: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
    slate: 'bg-slate-100 text-slate-600 dark:bg-slate-500/10 dark:text-slate-400',
  };

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="vehicles">
      <div className="space-y-5">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm">
          <button
            onClick={() => navigate('/admin/vehicles')}
            className="text-slate-500 hover:text-amber-600 transition-colors"
          >
            Vehicles
          </button>
          <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-900 dark:text-slate-100 font-medium">Vehicle Details</span>
        </nav>

        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/vehicles')}
              className="p-2 rounded-lg hover:bg-hover/60 transition"
            >
              <svg className="w-5 h-5 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-400 shrink-0">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              <div>
                <h1 className="text-xl font-bold text-text">{vehicle.vehicle_name || vehicle.vehicle_number}</h1>
                <p className="font-mono text-sm text-slate-500 dark:text-slate-400">{vehicle.vehicle_number}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-slate-500 dark:text-slate-400">{vehicle.vehicle_type?.replace(/_/g, ' ') || '—'}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${statusColors[status] || statusColors.inactive}`}>
                    {status === 'on_trip' ? 'On Trip' : status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown'}
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled
              className="px-4 py-2 rounded-xl border border-border/60 text-sm font-semibold text-slate-400 cursor-not-allowed"
              title="Edit vehicle API not yet available"
            >
              Edit Vehicle
            </button>
            <button
              disabled
              className="px-4 py-2 rounded-xl border border-border/60 text-sm font-semibold text-slate-400 cursor-not-allowed"
              title="Change owner API not yet available"
            >
              Change Owner
            </button>
          </div>
        </div>

        {/* Overview Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard title="Status" value={status === 'on_trip' ? 'On Trip' : status?.charAt(0).toUpperCase() + status?.slice(1) || 'Unknown'} sub="Currently operational" accent={status === 'available' ? 'emerald' : status === 'on_trip' ? 'blue' : 'slate'} />
          <KpiCard title="Capacity" value={vehicle.capacity_kg ? `${vehicle.capacity_kg.toLocaleString()} kg` : '—'} sub="Max Load Capacity" accent="amber" />
          <KpiCard title="Make / Model" value={vehicle.vehicle_make ? `${vehicle.vehicle_make} ${vehicle.vehicle_model || ''}` : '—'} sub={vehicle.vehicle_model || ''} accent="sky" />
          <KpiCard title="Manufacturing" value={vehicle.manufacturing_year || '—'} sub={`${vehicle.manufacturing_year ? new Date().getFullYear() - vehicle.manufacturing_year + ' years old' : ''}`} accent="purple" />
        </div>

        {/* Tabs */}
        <div className="border-b border-border">
          <div className="flex gap-6 overflow-x-auto">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 px-1 text-sm font-medium transition border-b-2 whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-amber-500 text-amber-600 dark:text-amber-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Vehicle Information */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Vehicle Information</h3>
              <div className="space-y-3">
                {[
                  { label: 'Vehicle Number', value: vehicle.vehicle_number, mono: true },
                  { label: 'Vehicle Type', value: vehicle.vehicle_type?.replace(/_/g, ' ') },
                  { label: 'Vehicle Name', value: vehicle.vehicle_name },
                  { label: 'Capacity', value: vehicle.capacity_kg ? `${vehicle.capacity_kg.toLocaleString()} kg` : '—' },
                  { label: 'Capacity Volume', value: vehicle.capacity_volume || '—' },
                  { label: 'Make', value: vehicle.vehicle_make || '—' },
                  { label: 'Model', value: vehicle.vehicle_model || '—' },
                  { label: 'Manufacturing Year', value: vehicle.manufacturing_year || '—' },
                  { label: 'Base Location', value: vehicle.base_location || '—' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-slate-500 dark:text-slate-400">{item.label}</span>
                    <span className={`text-sm font-medium text-text ${item.mono ? 'font-mono' : ''}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Registration Details */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Registration Details</h3>
              <div className="space-y-3">
                {[
                  { label: 'Registration Number', value: vehicle.vehicle_number, mono: true },
                  { label: 'Registration Date', value: vehicle.registration_date || '—' },
                  { label: 'Vehicle Type', value: vehicle.vehicle_type?.replace(/_/g, ' ') },
                  { label: 'Capacity', value: vehicle.capacity_kg ? `${vehicle.capacity_kg.toLocaleString()} kg` : '—' },
                  { label: 'Manufacturing Year', value: vehicle.manufacturing_year || '—' },
                  { label: 'Base Location', value: vehicle.base_location || '—' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-slate-500 dark:text-slate-400">{item.label}</span>
                    <span className={`text-sm font-medium text-text ${item.mono ? 'font-mono' : ''}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Documents & Rates */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Documents & Rates</h3>
              <div className="space-y-3">
                {[
                  { label: 'Insurance Number', value: vehicle.insurance_number || '—', status: getDocumentStatus(vehicle.insurance_expiry) },
                  { label: 'Insurance Expiry', value: vehicle.insurance_expiry || '—', status: getDocumentStatus(vehicle.insurance_expiry) },
                  { label: 'Permit Number', value: vehicle.permit_number || '—', status: getDocumentStatus(vehicle.permit_expiry) },
                  { label: 'Permit Expiry', value: vehicle.permit_expiry || '—', status: getDocumentStatus(vehicle.permit_expiry) },
                  { label: 'Pollution Certificate', value: vehicle.pollution_certificate || '—', status: getDocumentStatus(vehicle.pollution_expiry) },
                  { label: 'Pollution Expiry', value: vehicle.pollution_expiry || '—', status: getDocumentStatus(vehicle.pollution_expiry) },
                  { label: 'Hourly Rate', value: vehicle.hourly_rate ? `₹${vehicle.hourly_rate}` : '—' },
                  { label: 'Per KM Rate', value: vehicle.per_km_rate ? `₹${vehicle.per_km_rate}` : '—' },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                    <span className="text-sm text-slate-500 dark:text-slate-400">{item.label}</span>
                    <div className="flex items-center gap-2">
                      {item.status && (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${docStyles[item.status.color]}`}>
                          {item.status.label}
                        </span>
                      )}
                      <span className="text-sm font-medium text-text">{item.value}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Transport Owner */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Transport Owner</h3>
              {owner ? (
                <button
                  onClick={() => navigate(`/admin/vehicle-owners/${owner.owner_id}`)}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-border/60 hover:border-amber-300 dark:hover:border-amber-500/30 hover:bg-amber-50/50 dark:hover:bg-amber-500/5 transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center text-amber-700 dark:text-amber-400 font-bold text-sm">
                      {owner.owner_name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text">{owner.owner_name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{owner.owner_code} • {owner.city || 'N/A'}</div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">No transport owner assigned</p>
              )}
            </div>

            {/* Current Driver */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Current Driver</h3>
              {driver ? (
                <button
                  onClick={() => navigate(`/admin/drivers/${driver.driver_id}`)}
                  className="w-full flex items-center justify-between p-3 rounded-xl border border-border/60 hover:border-amber-300 dark:hover:border-amber-500/30 hover:bg-amber-50/50 dark:hover:bg-amber-500/5 transition-all text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm">
                      {getInitials(driver.driver_name)}
                    </div>
                    <div>
                      <div className="text-sm font-medium text-text">{driver.driver_name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{driver.driver_code} • {driver.mobile}</div>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-slate-500 dark:text-slate-400">No driver assigned</p>
                  <button
                    onClick={() => setShowAssignDriverModal(true)}
                    className="text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
                  >
                    + Assign Driver
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'trips' && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
            <h3 className="text-base font-semibold text-text mb-4">Trip History</h3>
            {tripsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-amber-500"></div>
              </div>
            ) : trips.length === 0 ? (
              <EmptyState title="No trip history" subtitle="Trip history will appear here once this vehicle is assigned to trips." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Trip #</th>
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Route</th>
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Client</th>
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Driver</th>
                      <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Freight</th>
                      <th className="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Expenses</th>
                      <th className="text-right py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trips.map((trip) => (
                      <tr key={trip.trip_id} className="border-b border-border/30 hover:bg-hover/30 transition-colors">
                        <td className="py-3 px-2">
                          <span className="text-amber-600 hover:text-amber-700 font-medium font-mono text-xs">
                            {trip.trip_number}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-xs text-slate-500">
                          {trip.trip_date ? new Date(trip.trip_date).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="py-3 px-2 text-xs">
                          <div className="font-medium">{trip.pickup_city || '—'}</div>
                          <div className="text-slate-400">→ {trip.drop_city || '—'}</div>
                        </td>
                        <td className="py-3 px-2 text-xs">{trip.user ? `${trip.user.first_name} ${trip.user.last_name}` : '—'}</td>
                        <td className="py-3 px-2 text-xs">{trip.driver?.driver_name || '—'}</td>
                        <td className="py-3 px-2">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${
                            trip.status === 'COMPLETED' || trip.status === 'DELIVERED' ? 'bg-emerald-50 text-emerald-700' :
                            trip.status === 'CANCELLED' ? 'bg-red-50 text-red-700' :
                            trip.status === 'IN_TRANSIT' ? 'bg-blue-50 text-blue-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {String(trip.status || '—').replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right text-xs font-medium">
                          {trip.freight_amount != null ? `₹${Number(trip.freight_amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-3 px-2 text-right text-xs font-medium text-red-600">
                          {trip.totalExpenses != null ? `₹${Number(trip.totalExpenses).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-3 px-2 text-right text-xs font-medium text-emerald-600">
                          {trip.profit != null ? `₹${Number(trip.profit).toLocaleString('en-IN')}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'maintenance' && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
            <h3 className="text-base font-semibold text-text mb-4">Maintenance History</h3>
            <EmptyState title="No maintenance records" subtitle="Maintenance records will appear here." />
          </div>
        )}

        {activeTab === 'documents' && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
            <h3 className="text-base font-semibold text-text mb-4">Documents & Expiry Status</h3>
            <div className="space-y-3">
              {[
                { name: 'Insurance', number: vehicle.insurance_number, expiry: vehicle.insurance_expiry },
                { name: 'Permit', number: vehicle.permit_number, expiry: vehicle.permit_expiry },
                { name: 'Pollution Certificate (PUC)', number: vehicle.pollution_certificate, expiry: vehicle.pollution_expiry },
                { name: 'Registration (RC)', number: vehicle.vehicle_number, expiry: null },
              ].map((doc, i) => {
                const status = getDocumentStatus(doc.expiry);
                return (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl border border-border/60">
                    <div>
                      <div className="text-sm font-medium text-text">{doc.name}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">{doc.number || '—'}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {doc.expiry ? `Expires: ${new Date(doc.expiry).toLocaleDateString('en-IN')}` : 'No expiry date'}
                      </div>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${docStyles[status.color]}`}>
                      {status.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'assignments' && (
          <div className="space-y-5">
            {/* Driver Assignment History */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Driver Assignment History</h3>
              {vehicle.assignment_history && vehicle.assignment_history.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Driver</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Assigned At</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Unassigned At</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicle.assignment_history.map((assignment) => (
                        <tr key={assignment.assignment_id} className="border-b border-border/30 hover:bg-hover/30 transition-colors">
                          <td className="py-3 px-2 text-xs font-medium">{assignment.driver_name || `Driver #${assignment.driver_id}`}</td>
                          <td className="py-3 px-2 text-xs text-slate-500">
                            {assignment.assigned_at ? new Date(assignment.assigned_at).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-2 text-xs text-slate-500">
                            {assignment.unassigned_at ? new Date(assignment.unassigned_at).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${
                              assignment.status === 'active' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {assignment.status || '—'}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-xs text-slate-500">{assignment.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No driver assignments" subtitle="Driver assignment history will appear here." />
              )}
            </div>

            {/* Booking History */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-6">
              <h3 className="text-base font-semibold text-text mb-4">Booking History</h3>
              {vehicle.booking_history && vehicle.booking_history.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60">
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Booking</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Date</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Route</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Customer</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Driver</th>
                        <th className="text-left py-3 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vehicle.booking_history.map((booking) => (
                        <tr key={booking.booking_id} className="border-b border-border/30 hover:bg-hover/30 transition-colors">
                          <td className="py-3 px-2">
                            <button
                              onClick={() => navigate(`/admin/bookings/${booking.booking_number}`)}
                              className="text-amber-600 hover:text-amber-700 font-medium font-mono text-xs"
                            >
                              {booking.booking_number}
                            </button>
                          </td>
                          <td className="py-3 px-2 text-xs text-slate-500">
                            {booking.pickup_date ? new Date(booking.pickup_date).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-2 text-xs">
                            <div className="font-medium">{booking.pickup_location || '—'}</div>
                            <div className="text-slate-400">→ {booking.drop_location || '—'}</div>
                          </td>
                          <td className="py-3 px-2 text-xs">{booking.customer || '—'}</td>
                          <td className="py-3 px-2 text-xs">{booking.driver || '—'}</td>
                          <td className="py-3 px-2">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium ${
                              booking.status === 'completed' || booking.status === 'delivered' ? 'bg-emerald-50 text-emerald-700' :
                              booking.status === 'cancelled' ? 'bg-red-50 text-red-700' :
                              booking.status === 'in_progress' || booking.status === 'confirmed' ? 'bg-blue-50 text-blue-700' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {String(booking.status || '—').replace(/_/g, ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title="No booking history" subtitle="Booking history will appear here once this vehicle is assigned to bookings." />
              )}
            </div>
          </div>
        )}

        {/* Assign Driver Modal */}
        {showAssignDriverModal && driver && (
          <AssignDriverModal
            isOpen={showAssignDriverModal}
            onClose={() => setShowAssignDriverModal(false)}
            onSuccess={handleAssignSuccess}
            driverId={driver.driver_id}
            currentVehicleId={vehicle.vehicle_id}
          />
        )}
      </div>
    </AdminShell>
  );
}

function getInitials(name) {
  if (!name) return 'VH';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return parts[0].slice(0, 2).toUpperCase();
}

function AssignDriverModal({ isOpen, onClose, onSuccess, driverId, currentVehicleId }) {
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchVehicles();
    }
  }, [isOpen]);

  const fetchVehicles = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await adminAPI.getAvailableVehicles(driverId);
      if (response.data?.success) {
        setVehicles(response.data.data || []);
      } else {
        setError(response.data?.message || 'Failed to load available vehicles');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load available vehicles');
    } finally {
      setLoading(false);
    }
  };

  const handleAssign = useCallback(async () => {
    if (!selectedVehicleId) {
      setError('Please select a vehicle');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await adminAPI.assignVehicleToDriver(driverId, selectedVehicleId);
      if (response.data?.success) {
        onSuccess?.();
        handleClose();
      } else {
        setError(response.data?.message || 'Failed to assign vehicle');
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Server error');
    } finally {
      setSubmitting(false);
    }
  }, [selectedVehicleId, driverId, onSuccess]);

  const handleClose = useCallback(() => {
    setSelectedVehicleId(null);
    setError('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative w-full max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-border/60 overflow-hidden" role="dialog" aria-modal="true" aria-label="Assign Vehicle">
        <div className="p-5 border-b border-border/60">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold">Assign Vehicle</h3>
              <p className="text-sm text-muted mt-0.5">Driver ID: {driverId}</p>
            </div>
            <button onClick={handleClose} className="h-8 w-8 rounded-lg border border-border/60 flex items-center justify-center hover:bg-hover/60 transition" aria-label="Close">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4 max-h-96 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-600 dark:text-red-400">{error}</div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="animate-pulse h-20 rounded-2xl bg-gray-100 dark:bg-gray-800/50" />
              ))}
            </div>
          ) : vehicles.length === 0 ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-violet-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-text">No Available Vehicles</p>
              <p className="text-xs text-muted mt-1">All vehicles are currently assigned</p>
            </div>
          ) : (
            <div className="space-y-2">
              {vehicles.map(vehicle => (
                <button
                  key={vehicle.vehicle_id}
                  onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}
                  className={`w-full text-left p-4 rounded-2xl border-2 transition ${
                    selectedVehicleId === vehicle.vehicle_id
                      ? 'border-violet-500 bg-violet-500/5'
                      : 'border-border/60 hover:border-violet-500/40'
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white shrink-0">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0zM13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{vehicle.vehicle_name || vehicle.vehicle_number}</div>
                      <div className="text-xs text-muted mt-0.5">
                        {vehicle.vehicle_number} · {vehicle.vehicle_type?.replace(/_/g, ' ') || '—'}
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {vehicle.capacity_kg ? `${vehicle.capacity_kg} kg capacity` : ''}
                        {vehicle.per_km_rate ? ` · ₹${vehicle.per_km_rate}/km` : ''}
                      </div>
                    </div>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      selectedVehicleId === vehicle.vehicle_id ? 'border-violet-500 bg-violet-500' : 'border-border'
                    }`}>
                      {selectedVehicleId === vehicle.vehicle_id && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-5 border-t border-border/60">
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
            >
              Cancel
            </button>
            <button
              onClick={handleAssign}
              disabled={!selectedVehicleId || submitting || loading}
              className="flex-1 px-4 py-2.5 rounded-xl bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600 transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Assigning...
                </>
              ) : (
                'Assign Vehicle'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

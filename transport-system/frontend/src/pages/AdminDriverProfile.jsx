import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { adminAPI, financialAPI } from '../services/api';
import { MapPin, Phone, FileText, CheckCircle, XCircle, AlertCircle, MoreHorizontal } from 'lucide-react';

import AdminShell from '../components/admin-premium/layout/AdminShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import PremiumTable from '../components/admin-premium/ui/PremiumTable';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import DriverStatusBadge from '../components/admin-premium/drivers/DriverStatusBadge';
import DriverTimeline from '../components/admin-premium/drivers/DriverTimeline';
import KpiCard from '../components/admin-premium/ui/KpiCard';
import DriverVehicleAssignModal from '../components/admin-premium/drivers/DriverVehicleAssignModal';
import DriverTransactionModal from '../components/admin-premium/drivers/DriverTransactionModal';
import ActionMenu from '../components/admin-premium/ui/ActionMenu';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'vehicles', label: 'Vehicles', icon: '🚛' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const TABS = [
  { key: 'overview', label: 'Overview', icon: 'ℹ️' },
  { key: 'trips', label: 'Trips', icon: '🚚' },
  { key: 'financials', label: 'Financials', icon: '💰' },
  { key: 'documents', label: 'Documents', icon: '📄' },
  { key: 'performance', label: 'Performance', icon: '⭐' },
  { key: 'timeline', label: 'Timeline', icon: '📋' }
];

const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '₹0';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
};

export default function AdminDriverProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [driver, setDriver] = useState(null);
  const [trips, setTrips] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [driverLedger, setDriverLedger] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showTransactionModal, setShowTransactionModal] = useState(false);

  const activeTab = searchParams.get('tab') || 'overview';
  const setActiveTab = useCallback((tab) => {
    setSearchParams(tab === 'overview' ? {} : { tab });
  }, [setSearchParams]);

  const fetchData = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      // Load main driver data first
      const driverRes = await adminAPI.getDriver(id);
      if (driverRes.data?.success) {
        setDriver(driverRes.data.data);
      } else {
        throw new Error(driverRes.data?.message || 'Driver not found');
      }

      // Load secondary data independently (don't fail if they fail)
      const loadSecondaryData = async () => {
        try {
          const tripsRes = await adminAPI.getDriverTrips(id, { limit: 100 });
          if (tripsRes.data?.success) {
            setTrips(tripsRes.data.data || []);
          }
        } catch (err) {
          console.warn('Failed to load driver trips:', err);
        }

        try {
          const transactionsRes = await adminAPI.getDriverTransactions(id, { limit: 100 });
          if (transactionsRes.data?.success) {
            setTransactions(transactionsRes.data.data || []);
          }
        } catch (err) {
          console.warn('Failed to load driver transactions:', err);
        }

        try {
          const timelineRes = await adminAPI.getDriverTimeline(id);
          if (timelineRes.data?.success) {
            setTimeline(timelineRes.data.data || []);
          }
        } catch (err) {
          console.warn('Failed to load driver timeline:', err);
        }

        try {
          const ledgerRes = await financialAPI.getDriverLedger(id);
          if (ledgerRes.data?.success) {
            setDriverLedger(ledgerRes.data.data);
          }
        } catch (err) {
          console.warn('Failed to load driver ledger:', err);
          // Ledger may not be available for all drivers, don't fail
        }
      };

      loadSecondaryData();
    } catch (err) {
      console.error('Error fetching driver profile:', err);
      const errorMsg = err.response?.data?.message || err.message || 'Failed to load driver profile';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const goBack = useCallback(() => {
    navigate('/admin/drivers');
  }, [navigate]);

  const getInitials = (name) => {
    if (!name) return 'D';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
  };

  const getLicenseValidity = (expiry) => {
    if (!expiry) return { status: 'unknown', label: 'Unknown' };
    try {
      const expiryDate = new Date(expiry);
      const today = new Date();
      const daysUntilExpiry = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
      if (daysUntilExpiry <= 0) return { status: 'expired', label: 'Expired' };
      if (daysUntilExpiry <= 30) return { status: 'warning', label: 'Expiring Soon' };
      return { status: 'valid', label: 'Valid' };
    } catch {
      return { status: 'unknown', label: 'Unknown' };
    }
  };

  const metrics = useMemo(() => {
    const totalTrips = trips.length || driver?.total_deliveries || 0;
    const ledgerTotals = driverLedger?.totals || {};
    const totalEarnings = ledgerTotals.totalAgreedPay || 0;
    const pendingAmount = ledgerTotals.outstanding || 0;
    const paidAmount = ledgerTotals.totalPaid || 0;
    const advanceGiven = (driverLedger?.payments || [])
      .filter(t => t.transaction_type === 'DRIVER_ADVANCE' || t.transaction_type === 'driver_advance')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
    const avgRating = driver?.rating || driver?.performance_rating || null;

    return {
      totalTrips,
      totalEarnings,
      paidAmount,
      pendingAmount,
      advanceGiven,
      avgRating,
    };
  }, [driver, trips, transactions, driverLedger]);

  if (loading) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="drivers">
        <div className="space-y-4">
          <LoadingSkeleton className="h-12 w-48" />
          <LoadingSkeleton className="h-64 w-full" />
        </div>
      </AdminShell>
    );
  }

  if (error || !driver) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="drivers">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-8 text-center">
          <div className="text-red-500 font-semibold mb-2">Failed to load driver</div>
          <div className="text-sm text-muted mb-4">{error || 'Driver not found'}</div>
          <button onClick={goBack} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">
            Back to Drivers
          </button>
        </div>
      </AdminShell>
    );
  }

  const licenseValidity = getLicenseValidity(driver.license_expiry);
  const hasActiveBooking = driver.bookingAssignments?.[0]?.booking;
  const currentVehicle = driver.currentVehicle || driver.transportVehicles?.[0];

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="drivers">
      <div className="space-y-5">
        <button
          onClick={goBack}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Drivers
        </button>

        <div className="rounded-[16px] border border-border/60 bg-card/40 p-6 shadow-sm">
          <div className="flex flex-col lg:flex-row items-start lg:items-center gap-4 lg:gap-6">
            <div className="h-20 w-20 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-lg shadow-amber-500/20">
              {getInitials(driver.driver_name)}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="bt-page-title">{driver.driver_name}</h1>
                <DriverStatusBadge status={driver.status} size="md" />
              </div>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted flex-wrap">
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{driver.driver_code}</span>
                <a href={`tel:${driver.mobile}`} className="flex items-center gap-1 hover:text-text transition">
                  <Phone className="w-4 h-4" />
                  {driver.mobile || '—'}
                </a>
                {driver.dob && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    DOB: {driver.dob}
                  </span>
                )}
                {driver.license_number && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-4 h-4" />
                    {driver.license_number}
                  </span>
                )}
                {(driver.city || driver.state) && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    {driver.city}{driver.city && driver.state && ', '}{driver.state || ''}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate(`/admin/drivers/${id}?action=edit`)}
                className="px-4 py-2 rounded-xl border border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-500/20 transition"
              >
                Edit Driver
              </button>
              <button
                onClick={() => setShowAssignModal(true)}
                className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
              >
                Assign Vehicle
              </button>
              <ActionMenu
                trigger={
                  <button className="px-4 py-2 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition flex items-center gap-1">
                    <MoreHorizontal className="w-4 h-4" />
                    More
                  </button>
                }
                align="right"
              >
                {(close) => (
                  <div className="p-1">
                    <button
                      onClick={() => {
                        setShowTransactionModal(true);
                        close();
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-sm hover:bg-hover/60 transition"
                    >
                      Add Transaction
                    </button>
                  </div>
                )}
              </ActionMenu>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <KpiCard
            title="Total Trips"
            value={metrics.totalTrips}
            accent="blue"
            onClick={() => setActiveTab('trips')}
            action={<span className="text-[11px] font-semibold text-amber-600">View trips →</span>}
          />
          <KpiCard
            title="Total Earnings"
            value={formatCurrency(metrics.totalEarnings)}
            accent="success"
            onClick={() => setActiveTab('financials')}
            action={<span className="text-[11px] font-semibold text-amber-600">View financials →</span>}
          />
          <KpiCard
            title="Pending Amount"
            value={formatCurrency(metrics.pendingAmount)}
            accent="warning"
            onClick={() => setActiveTab('financials')}
            action={<span className="text-[11px] font-semibold text-amber-600">View details →</span>}
          />
          <KpiCard
            title="Advance Given"
            value={formatCurrency(metrics.advanceGiven)}
            accent="amber"
            onClick={() => setActiveTab('financials')}
            action={<span className="text-[11px] font-semibold text-amber-600">View details →</span>}
          />
          <KpiCard
            title="Average Rating"
            value={metrics.avgRating ? `⭐ ${metrics.avgRating.toFixed(1)}` : 'Not available'}
            accent="warning"
            onClick={() => setActiveTab('performance')}
            action={<span className="text-[11px] font-semibold text-amber-600">View performance →</span>}
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-hide">
          {TABS.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                  : 'text-muted hover:text-text hover:bg-hover/60 border border-transparent'
              }`}
            >
              <span className="mr-1.5">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-[400px]">
          {activeTab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <SectionCard title="Driver Information">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Full Name</span>
                    <span className="text-sm font-medium mt-0.5">{driver.driver_name}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Driver ID</span>
                    <span className="text-sm font-mono font-semibold text-amber-600 dark:text-amber-400 mt-0.5">{driver.driver_code}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Mobile Number</span>
                    <a href={`tel:${driver.mobile}`} className="text-sm font-medium mt-0.5 text-amber-600 hover:text-amber-700">{driver.mobile || '—'}</a>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Alternate Number</span>
                    <span className="text-sm font-medium mt-0.5">{driver.alternate_mobile || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Date of Birth</span>
                    <span className="text-sm font-medium mt-0.5">{driver.dob || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Current Status</span>
                    <span className="text-sm font-medium mt-0.5"><DriverStatusBadge status={driver.status} size="sm" /></span>
                  </div>
                  <div className="flex flex-col sm:col-span-2">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Address</span>
                    <span className="text-sm font-medium mt-0.5">{driver.address || `${driver.city || ''}, ${driver.state || ''}`.trim() || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Transport Owner</span>
                    <span className="text-sm mt-0.5">
                      {driver.transportOwner ? (
                        <button
                          onClick={() => navigate(`/admin/vehicle-owners/${driver.transportOwner.owner_id}`)}
                          className="text-amber-600 hover:text-amber-700 hover:underline font-medium"
                        >
                          {driver.transportOwner.owner_name}
                        </button>
                      ) : (
                        <span className="text-muted">No transport owner assigned</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Assigned Vehicle</span>
                    <span className="text-sm mt-0.5">
                      {currentVehicle ? (
                        <button
                          onClick={() => navigate(`/admin/vehicles/${currentVehicle.vehicle_id}`)}
                          className="text-amber-600 hover:text-amber-700 hover:underline font-medium"
                        >
                          {currentVehicle.vehicle_number}
                        </button>
                      ) : (
                        <span className="text-muted">No vehicle assigned</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Vehicle Type</span>
                    <span className="text-sm font-medium mt-0.5">{currentVehicle?.vehicle_type || driver.vehicle_type || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Licence Number</span>
                    <span className="text-sm font-medium mt-0.5">{driver.license_number || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Licence Class</span>
                    <span className="text-sm font-medium mt-0.5">{driver.license_class || '—'}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Licence Expiry</span>
                    <span className="text-sm font-medium mt-0.5 flex items-center gap-2">
                      {driver.license_expiry ? new Date(driver.license_expiry).toLocaleDateString('en-IN') : '—'}
                      {licenseValidity.status === 'valid' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-green-500/10 text-green-600 border border-green-500/20">
                          {licenseValidity.label}
                        </span>
                      )}
                      {licenseValidity.status === 'warning' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-600 border border-amber-500/20">
                          {licenseValidity.label}
                        </span>
                      )}
                      {licenseValidity.status === 'expired' && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider bg-red-500/10 text-red-600 border border-red-500/20">
                          {licenseValidity.label}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-medium text-muted uppercase tracking-wider">Joining Date</span>
                    <span className="text-sm font-medium mt-0.5">{driver.joining_date || (driver.created_at ? new Date(driver.created_at).toLocaleDateString('en-IN') : '—')}</span>
                  </div>
                </div>
              </SectionCard>

              <div className="space-y-4">
                <SectionCard title="Current Assignment">
                  {currentVehicle ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-muted">Assigned Vehicle</div>
                        <div className="text-sm font-semibold">{currentVehicle.vehicle_number}</div>
                        <div className="text-xs text-muted">{currentVehicle.vehicle_type || currentVehicle.vehicle_name || ''}</div>
                      </div>
                      <div className="pt-2 border-t border-border/60">
                        <div className="text-xs text-muted">Vehicle Owner</div>
                        <div className="text-sm font-medium">{currentVehicle.owner_name || driver.transportOwner?.owner_name || '—'}</div>
                      </div>
                      <button
                        onClick={() => navigate(`/admin/vehicles/${currentVehicle.vehicle_id}`)}
                        className="w-full px-4 py-2 rounded-xl border border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
                      >
                        View Vehicle
                      </button>
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <div className="text-sm text-muted mb-3">No vehicle assigned</div>
                      <button
                        onClick={() => setShowAssignModal(true)}
                        className="px-4 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
                      >
                        Assign Vehicle
                      </button>
                    </div>
                  )}
                </SectionCard>

                <SectionCard title="Current Trip / Booking">
                  {hasActiveBooking ? (
                    <div className="space-y-3">
                      <div>
                        <div className="text-xs text-muted">Booking Reference</div>
                        <button
                          onClick={() => navigate(`/admin/bookings/${hasActiveBooking.booking_number}`)}
                          className="text-sm font-semibold text-amber-600 hover:text-amber-700 hover:underline"
                        >
                          {hasActiveBooking.booking_reference || hasActiveBooking.booking_number}
                        </button>
                      </div>
                      <div>
                        <div className="text-xs text-muted">Route</div>
                        <div className="text-sm">
                          {hasActiveBooking.pickup_city} → {hasActiveBooking.drop_city}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-muted">Status</div>
                        <div className="text-sm font-medium">{hasActiveBooking.status}</div>
                      </div>
                      <button
                        onClick={() => navigate(`/admin/bookings/${hasActiveBooking.booking_number}`)}
                        className="w-full px-4 py-2 rounded-xl border border-amber-500/30 text-amber-700 dark:text-amber-300 text-sm font-semibold hover:bg-amber-50 dark:hover:bg-amber-500/10 transition"
                      >
                        View Booking
                      </button>
                    </div>
                  ) : (
                    <div className="text-sm text-muted text-center py-4">No active trip or booking</div>
                  )}
                </SectionCard>
              </div>
            </div>
          )}

          {activeTab === 'trips' && (
            <SectionCard title="Trip History" subtitle={`${trips.length} trips found`}>
              {trips.length === 0 ? (
                <EmptyState title="No trips found" subtitle="Trip history will appear here once the driver is assigned to trips." />
              ) : (
                <PremiumTable
                  columns={[
                    {
                      key: 'trip_number',
                      header: 'Trip #',
                      render: (r) => (
                        <button
                          onClick={() => navigate(`/admin/trips/${r.trip_id}`)}
                          className="text-amber-600 hover:text-amber-700 hover:underline font-mono text-sm"
                        >
                          {r.trip_number || r.booking_reference || '—'}
                        </button>
                      )
                    },
                    {
                      key: 'route',
                      header: 'Route',
                      render: (r) => (
                        <div className="text-sm">
                          {r.pickup_city || r.booking?.pickup_city || '—'} → {r.drop_city || r.booking?.drop_city || '—'}
                        </div>
                      )
                    },
                    {
                      key: 'status',
                      header: 'Status',
                      render: (r) => (
                        <span className="text-sm font-medium">{r.status || r.booking?.status || '—'}</span>
                      )
                    },
                    {
                      key: 'date',
                      header: 'Date',
                      render: (r) => (
                        <span className="text-sm text-muted">
                          {r.trip_date ? new Date(r.trip_date).toLocaleDateString('en-IN') : r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '—'}
                        </span>
                      )
                    },
                    {
                      key: 'freight',
                      header: 'Freight',
                      render: (r) => (
                        <span className="text-sm font-medium">{formatCurrency(r.freight_amount || r.booking?.final_price)}</span>
                      )
                    }
                  ]}
                  rows={trips.map(t => ({ ...t, id: t.trip_id }))}
                />
              )}
            </SectionCard>
          )}

          {activeTab === 'financials' && (
            <div className="space-y-4">
              <SectionCard title="Financial Summary (One Finance)">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-xs text-muted">Total Earnings</div>
                    <div className="text-lg font-bold mt-1">{formatCurrency(metrics.totalEarnings)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-xs text-muted">Paid Amount</div>
                    <div className="text-lg font-bold mt-1">{formatCurrency(metrics.paidAmount)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-xs text-muted">Pending Amount</div>
                    <div className="text-lg font-bold mt-1">{formatCurrency(metrics.pendingAmount)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-xs text-muted">Advance Given</div>
                    <div className="text-lg font-bold mt-1">{formatCurrency(metrics.advanceGiven)}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 p-4">
                    <div className="text-xs text-muted">Current Balance</div>
                    <div className="text-lg font-bold mt-1">{formatCurrency(driver.current_balance || metrics.pendingAmount || 0)}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Transaction History" subtitle={`${transactions.length} transactions`} action={
                <button
                  onClick={() => setShowTransactionModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-white text-xs font-semibold hover:bg-amber-600 transition"
                >
                  Add Transaction
                </button>
              }>
                {transactions.length === 0 ? (
                  <EmptyState title="No transactions" subtitle="Financial transactions will appear here." />
                ) : (
                  <PremiumTable
                    columns={[
                      {
                        key: 'transaction_date',
                        header: 'Date',
                        render: (r) => (
                          <span className="text-sm text-muted">
                            {r.transaction_date ? new Date(r.transaction_date).toLocaleDateString('en-IN') : '—'}
                          </span>
                        )
                      },
                      {
                        key: 'transaction_type',
                        header: 'Type',
                        render: (r) => (
                          <span className="text-sm capitalize">{r.transaction_type.replace(/_/g, ' ')}</span>
                        )
                      },
                      {
                        key: 'amount',
                        header: 'Amount',
                        render: (r) => (
                          <span className={`text-sm font-medium ${['advance', 'fuel_expense', 'toll_expense', 'other_expense'].includes(r.transaction_type) ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(r.amount)}
                          </span>
                        )
                      },
                      {
                        key: 'description',
                        header: 'Description',
                        render: (r) => (
                          <span className="text-sm">{r.description || '—'}</span>
                        )
                      },
                      {
                        key: 'payment_mode',
                        header: 'Payment Mode',
                        render: (r) => (
                          <span className="text-sm capitalize">{r.payment_mode || '—'}</span>
                        )
                      }
                    ]}
                    rows={transactions.map(t => ({ ...t, id: t.transaction_id }))}
                  />
                )}
              </SectionCard>
            </div>
          )}

          {activeTab === 'documents' && (
            <SectionCard title="Documents & Verification">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border/60 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold">Driving Licence</h4>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium ${licenseValidity.status === 'valid' ? 'bg-green-500/10 text-green-600' : licenseValidity.status === 'warning' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-600'}`}>
                      {licenseValidity.status === 'valid' && <CheckCircle className="w-3 h-3" />}
                      {licenseValidity.status === 'warning' && <AlertCircle className="w-3 h-3" />}
                      {licenseValidity.status === 'expired' && <XCircle className="w-3 h-3" />}
                      {licenseValidity.label}
                    </span>
                  </div>
                  <div className="text-xs text-muted space-y-1">
                    <div>Licence Number: {driver.license_number || '—'}</div>
                    <div>Licence Class: {driver.license_class || '—'}</div>
                    <div>Expiry Date: {driver.license_expiry ? new Date(driver.license_expiry).toLocaleDateString('en-IN') : '—'}</div>
                  </div>
                </div>
                <div className="rounded-xl border border-border/60 p-4">
                  <h4 className="text-sm font-semibold mb-2">Verification Status</h4>
                  <div className="text-xs text-muted space-y-1">
                    <div className="flex items-center gap-2">
                      <span>Verified:</span>
                      <span className={`font-medium ${driver.is_verified ? 'text-green-600' : 'text-red-600'}`}>
                        {driver.is_verified ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div>Registered On: {driver.created_at ? new Date(driver.created_at).toLocaleDateString('en-IN') : '—'}</div>
                  </div>
                </div>
              </div>
            </SectionCard>
          )}

          {activeTab === 'performance' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SectionCard title="Performance Metrics">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Average Rating</span>
                    <span className="text-sm font-semibold">
                      {metrics.avgRating ? `⭐ ${metrics.avgRating.toFixed(1)}` : 'Not available'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Total Trips</span>
                    <span className="text-sm font-semibold">{metrics.totalTrips}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Total Deliveries</span>
                    <span className="text-sm font-semibold">{driver.total_deliveries || 0}</span>
                  </div>
                </div>
              </SectionCard>
              <SectionCard title="Trip Status Breakdown">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Completed</span>
                    <span className="text-sm font-semibold text-green-600">
                      {trips.filter(t => (t.status || '').toLowerCase() === 'completed' || (t.status || '').toLowerCase() === 'delivered').length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">In Transit</span>
                    <span className="text-sm font-semibold text-blue-600">
                      {trips.filter(t => (t.status || '').toLowerCase() === 'in_transit').length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Pending</span>
                    <span className="text-sm font-semibold text-amber-600">
                      {trips.filter(t => ['pending', 'assigned'].includes((t.status || '').toLowerCase())).length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">Cancelled</span>
                    <span className="text-sm font-semibold text-red-600">
                      {trips.filter(t => (t.status || '').toLowerCase() === 'cancelled').length}
                    </span>
                  </div>
                </div>
              </SectionCard>
            </div>
          )}

          {activeTab === 'timeline' && (
            <SectionCard title="Activity Timeline">
              <DriverTimeline events={timeline} loading={false} />
            </SectionCard>
          )}
        </div>
      </div>

      <DriverVehicleAssignModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onSuccess={() => {
          setShowAssignModal(false);
          fetchData();
        }}
        driver={driver}
      />

      <DriverTransactionModal
        isOpen={showTransactionModal}
        onClose={() => setShowTransactionModal(false)}
        onSuccess={() => {
          setShowTransactionModal(false);
          fetchData();
        }}
        driver={driver}
      />
    </AdminShell>
  );
}

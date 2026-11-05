import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Calendar,
  ChevronRight,
  Clock3,
  DollarSign,
  Download,
  FileText,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Route,
  Shield,
  Truck,
  User,
  WalletCards,
  X,
} from 'lucide-react';
import { partnerAPI } from '../services/api';
import PartnerShell from '../components/partner/PartnerShell';
import SectionCard from '../components/admin-premium/ui/SectionCard';
import EmptyState from '../components/admin-premium/ui/EmptyState';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

function formatCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Timeline step definitions matching the existing state machine
const TIMELINE_STEPS = [
  { key: 'created', label: 'Created', icon: FileText },
  { key: 'assigned', label: 'Assigned', icon: User },
  { key: 'confirmed', label: 'Confirmed', icon: Shield },
  { key: 'pickup_started', label: 'Pickup Started', icon: MapPin },
  { key: 'pickup_completed', label: 'Pickup Completed', icon: Package },
  { key: 'in_transit', label: 'In Transit', icon: Route },
  { key: 'out_for_delivery', label: 'Out for Delivery', icon: Truck },
  { key: 'delivered', label: 'Delivered', icon: Package },
  { key: 'completed', label: 'Completed', icon: Shield },
];

export default function PartnerTripDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [error, setError] = useState('');
  const [retrying, setRetrying] = useState(false);
  // Driver assignment state
  const [assigning, setAssigning] = useState(false);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [drivers, setDrivers] = useState([]);
  const [driversLoading, setDriversLoading] = useState(false);
  const [assignError, setAssignError] = useState('');

  const loadTrip = useCallback(async () => {
    if (!id) return;
    setRetrying(true);
    setError('');
    setLoading(true);
    try {
      const response = await partnerAPI.getTrip(id);
      if (response.data?.success) {
        setTrip(response.data.data);
      } else {
        throw new Error(response.data?.message || 'Trip data unavailable');
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 403) {
        setError('Access denied: This trip does not belong to your partner account.');
      } else if (status === 404) {
        setError('Trip not found. It may have been deleted or you may not have access.');
      } else {
        setError(err.response?.data?.message || err.message || 'Unable to load trip details. Please try again.');
      }
      setTrip(null);
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [id]);

  const loadTimeline = useCallback(async () => {
    if (!id) return;
    setTimelineLoading(true);
    try {
      const response = await partnerAPI.getTripTimeline(id);
      if (response.data?.success) {
        setTimeline(response.data.data || []);
      } else {
        setTimeline([]);
      }
    } catch (err) {
      console.error('Failed to load timeline:', err);
      setTimeline([]);
    } finally {
      setTimelineLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadTrip();
    loadTimeline();
  }, [loadTrip, loadTimeline]);

  const loadDrivers = useCallback(async () => {
    setDriversLoading(true);
    try {
      const response = await partnerAPI.getDrivers({ limit: 100 });
      if (response.data?.success) {
        setDrivers(response.data.data || []);
      } else if (Array.isArray(response.data)) {
        setDrivers(response.data);
      }
    } catch (err) {
      console.error('Failed to load drivers:', err);
      setDrivers([]);
    } finally {
      setDriversLoading(false);
    }
  }, []);

  const handleAssignDriver = async () => {
    if (!selectedDriverId) {
      setAssignError('Please select a driver');
      return;
    }
    setAssigning(true);
    setAssignError('');
    try {
      const response = await partnerAPI.assignDriverToTrip(trip.trip_id || trip.id, parseInt(selectedDriverId, 10));
      if (response.data?.success) {
        setTrip({ ...trip, driver: response.data.data?.driver || { driver_id: parseInt(selectedDriverId, 10) }, driver_id: parseInt(selectedDriverId, 10), driver_name: response.data.data?.driver?.driver_name || trip.driver_name });
        setShowAssignModal(false);
        setSelectedDriverId('');
      } else {
        throw new Error(response.data?.message || 'Failed to assign driver');
      }
    } catch (err) {
      setAssignError(err.response?.data?.message || err.message || 'Unable to assign driver. Please try again.');
    } finally {
      setAssigning(false);
    }
  };

  const openAssignModal = async () => {
    setShowAssignModal(true);
    setSelectedDriverId('');
    setAssignError('');
    await loadDrivers();
  };

  const handleRetry = () => {
    loadTrip();
    loadTimeline();
  };

  const tripId = trip?.booking_number || trip?.bookingNumber || trip?.trip_id || trip?.id || '—';
  const status = trip?.status || 'unknown';
  const routeText = [trip?.pickup_city, trip?.drop_city].filter(Boolean).join(' → ') || 'Route details unavailable';
  const vehicleText = trip?.vehicle?.registration_number || trip?.vehicle_number || '—';
  const driverText = trip?.driver?.name || trip?.driver_name || '—';
  const driverMobile = trip?.driver?.mobile || trip?.driver_mobile || '—';

  return (
    <PartnerShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate('/partner/trips')}
              className="rounded-xl border border-[#15345B]/15 bg-white p-2 text-[#15345B]/60 hover:bg-[#F5A000]/10 hover:text-[#F5A000] transition-colors"
              aria-label="Back to trips"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#F5A000]">Trip Detail</p>
              <h2 className="mt-1 text-2xl font-bold text-[#15345B]">{tripId}</h2>
              <p className="mt-1 text-sm text-[#15345B]/60">{routeText}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            disabled={retrying}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-[#F5A000]/30 bg-white px-4 py-2.5 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/10 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
            {retrying ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-center justify-between" role="alert">
            <span>{error}</span>
            <button onClick={handleRetry} className="font-semibold underline hover:decoration-red-500">Retry</button>
          </div>
        )}

        {loading ? (
          <div className="space-y-6">
            <LoadingSkeleton className="h-48" />
            <LoadingSkeleton className="h-32" />
            <LoadingSkeleton className="h-24" />
          </div>
        ) : !trip ? (
          <EmptyState
            title="Trip not found"
            subtitle={error || 'Unable to load trip details.'}
          />
        ) : (
          <>
            {/* Trip Status Header */}
            <div className="rounded-2xl border border-[#15345B]/10 bg-white p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Route className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Current Status</p>
                    <div className="mt-1 flex items-center gap-2">
                      <StatusBadge status={status} size="md" />
                      <span className="text-sm font-medium text-[#15345B]/60">
                        {trip.current_status || trip.status_description || '—'}
                      </span>
                    </div>
                  </div>
                </div>
                <Link
                  to="/partner/trips"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#F5A000] hover:underline"
                >
                  Back to Trips
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </div>

            {/* Trip Overview */}
            <SectionCard title="Trip Overview">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <FileText className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Booking ID</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{tripId}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Calendar className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Scheduled Date</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{formatDate(trip.pickup_date)}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Clock3 className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Created</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{formatDateTime(trip.created_at)}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Package className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Goods Type</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{trip.goods_type || '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Route className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Distance</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{trip.estimated_distance_km ? `${trip.estimated_distance_km} km` : '—'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Shield className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Settlement</p>
                    <p className="mt-1 font-semibold text-[#15345B]">{trip.settlement_status || 'pending'}</p>
                  </div>
                </div>
              </div>
            </SectionCard>

            {/* Route Details */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <SectionCard title="Pickup Location">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-[#F5A000]" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-[#15345B]">{trip.pickup_location || trip.pickup_city || '—'}</p>
                      {trip.pickup_address && <p className="mt-1 text-sm text-[#15345B]/60">{trip.pickup_address}</p>}
                      {trip.pickup_city && trip.pickup_state && (
                        <p className="mt-1 text-sm text-[#15345B]/60">{[trip.pickup_city, trip.pickup_state].filter(Boolean).join(', ')}</p>
                      )}
                      {trip.pickup_time && <p className="mt-1 text-sm text-[#15345B]/60">Time: {trip.pickup_time}</p>}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Drop Location">
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-5 w-5 text-[#F5A000]" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-[#15345B]">{trip.drop_location || trip.drop_city || '—'}</p>
                      {trip.drop_address && <p className="mt-1 text-sm text-[#15345B]/60">{trip.drop_address}</p>}
                      {trip.drop_city && trip.drop_state && (
                        <p className="mt-1 text-sm text-[#15345B]/60">{[trip.drop_city, trip.drop_state].filter(Boolean).join(', ')}</p>
                      )}
                    </div>
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* Vehicle & Driver */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <SectionCard title="Vehicle">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <Truck className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[#15345B]">{vehicleText}</p>
                    {trip.vehicle_name && <p className="mt-1 text-sm text-[#15345B]/60">{trip.vehicle_name}</p>}
                    {trip.vehicle_type && <p className="mt-1 text-xs text-[#15345B]/50">Type: {trip.vehicle_type}</p>}
                    {trip.vehicle_id && <p className="mt-1 text-xs text-[#15345B]/50">Vehicle ID: {trip.vehicle_id}</p>}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="Driver">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F5A000]/10 text-[#F5A000]">
                    <User className="h-6 w-6" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#15345B]">{driverText}</p>
                    {driverMobile !== '—' && (
                      <p className="mt-1 text-sm text-[#15345B]/60 flex items-center gap-1">
                        <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                        {driverMobile}
                      </p>
                    )}
                    {trip.driver_id && <p className="mt-1 text-xs text-[#15345B]/50">Driver ID: {trip.driver_id}</p>}
                    {!trip.driver_id && (
                      <p className="mt-1 text-xs text-red-600">No driver assigned</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={openAssignModal}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-[#F5A000]/30 bg-[#F5A000]/10 px-3 py-2 text-sm font-semibold text-[#F5A000] transition-colors hover:bg-[#F5A000]/20"
                  >
                    {trip.driver_id ? 'Change Driver' : 'Assign Driver'}
                  </button>
                </div>
              </SectionCard>
            </div>

            {/* Assign Driver Modal */}
            {showAssignModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Assign Driver">
                <div className="w-full max-w-md rounded-2xl border border-[#15345B]/10 bg-white p-6 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-[#15345B]">
                      {trip?.driver_id ? 'Change Driver' : 'Assign Driver'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setShowAssignModal(false)}
                      className="rounded-lg p-1 text-[#15345B]/50 hover:bg-[#15345B]/5 hover:text-[#15345B]"
                      aria-label="Close"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>

                  {assignError && (
                    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
                      {assignError}
                    </div>
                  )}

                  <div className="space-y-3">
                    <div>
                      <label htmlFor="driver-select" className="block text-sm font-semibold text-[#15345B]/70 mb-1">
                        Select Driver
                      </label>
                      {driversLoading ? (
                        <div className="h-10 w-full rounded-xl bg-[#15345B]/5 animate-pulse" />
                      ) : (
                        <select
                          id="driver-select"
                          value={selectedDriverId}
                          onChange={(e) => {
                            setSelectedDriverId(e.target.value);
                            setAssignError('');
                          }}
                          className="w-full rounded-xl border border-[#15345B]/15 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F5A000]/30 focus:border-[#F5A000]"
                        >
                          <option value="">— Select a driver —</option>
                          {drivers.map((d) => (
                            <option key={d.driver_id || d.id} value={d.driver_id || d.id}>
                              {d.driver_name || d.name} — {d.mobile || 'No mobile'}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>

                    {drivers.length === 0 && !driversLoading && (
                      <p className="text-sm text-[#15345B]/60">No drivers available for your partner account.</p>
                    )}
                  </div>

                  <div className="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setShowAssignModal(false)}
                      className="rounded-xl border border-[#15345B]/15 px-4 py-2 text-sm font-semibold text-[#15345B]/70 hover:bg-[#15345B]/5"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleAssignDriver}
                      disabled={assigning || !selectedDriverId}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#F5A000] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#e09612] disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {assigning ? (
                        <>
                          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                          Assigning...
                        </>
                      ) : (
                        trip?.driver_id ? 'Update Driver' : 'Assign Driver'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Goods Details */}
            {trip.goods_description && (
              <SectionCard title="Goods Description">
                <p className="text-sm text-[#15345B]/70">{trip.goods_description}</p>
                {(trip.goods_weight_kg || trip.number_of_items) && (
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    {trip.goods_weight_kg && <span><span className="font-semibold text-[#15345B]/50">Weight:</span> {trip.goods_weight_kg} kg</span>}
                    {trip.number_of_items && <span><span className="font-semibold text-[#15345B]/50">Items:</span> {trip.number_of_items}</span>}
                    {trip.fragile && <span><span className="font-semibold text-[#15345B]/50">Fragile:</span> Yes</span>}
                  </div>
                )}
              </SectionCard>
            )}

            {/* Timeline */}
            <SectionCard title="Trip Timeline">
              {timelineLoading ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <LoadingSkeleton key={i} className="h-12" />
                  ))}
                </div>
              ) : timeline.length === 0 ? (
                <EmptyState
                  title="No timeline events"
                  subtitle="Timeline events will appear here as the trip progresses."
                />
              ) : (
                <div className="space-y-4">
                  {timeline.map((event, index) => (
                    <TimelineItem key={event.id || index} event={event} isLast={index === timeline.length - 1} />
                  ))}
                </div>
              )}
            </SectionCard>

            {/* Financial Information */}
            <SectionCard title="Financial Information">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl border border-[#15345B]/10 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Commission Rate</p>
                  <p className="mt-1 font-semibold text-[#15345B]">
                    {trip.commission_type === 'fixed' ? `₹${trip.commission_amount}` : `${trip.commission_percentage || 0}%`}
                  </p>
                </div>
                <div className="rounded-xl border border-[#15345B]/10 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Commission Earned</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{formatCurrency(trip.commission_amount)}</p>
                </div>
                <div className="rounded-xl border border-[#15345B]/10 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Settlement Status</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{trip.settlement_status || 'pending'}</p>
                </div>
                <div className="rounded-xl border border-[#15345B]/10 bg-[#F8FAFC] p-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#15345B]/50">Estimated Price</p>
                  <p className="mt-1 font-semibold text-[#15345B]">{formatCurrency(trip.estimated_price)}</p>
                </div>
              </div>
            </SectionCard>

            {/* Documents */}
            <SectionCard title="Documents">
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-[#15345B]/10 bg-[#F8FAFC] p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-[#15345B]/50" aria-hidden="true" />
                    <span className="text-sm text-[#15345B]/70">No documents available for this trip yet.</span>
                  </div>
                </div>
              </div>
            </SectionCard>
          </>
        )}
      </div>
    </PartnerShell>
  );
}

function TimelineItem({ event, isLast }) {
  const eventType = event.event_type || event.type || 'unknown';
  const eventLabel = event.event_label || event.title || eventType.replace(/_/g, ' ');
  const eventDescription = event.description || event.notes || '';
  const eventTime = formatDateTime(event.created_at || event.timestamp);
  const eventActor = event.created_by_name || event.actor || 'System';

  return (
    <div className="relative flex gap-4 last:pb-0">
      {/* Vertical line */}
      {!isLast && (
        <div
          className="absolute left-5 top-8 bottom-0 w-0.5 bg-[#15345B]/10"
          aria-hidden="true"
        />
      )}

      {/* Timeline dot */}
      <div className="relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#F5A000] bg-white text-[#F5A000]">
        <Clock3 className="h-5 w-5" aria-hidden="true" />
      </div>

      {/* Content */}
      <div className="flex-1 pb-6 last:pb-0">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-semibold text-[#15345B]">{eventLabel}</p>
            {eventDescription && <p className="mt-1 text-sm text-[#15345B]/60">{eventDescription}</p>}
          </div>
          <div className="text-right text-xs text-[#15345B]/50">
            <p>{eventTime}</p>
            {eventActor && <p>by {eventActor}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
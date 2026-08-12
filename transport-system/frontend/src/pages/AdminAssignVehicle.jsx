import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: '▦' },
  { key: 'bookings', label: 'Bookings', icon: '⟐' },
  { key: 'drivers', label: 'Drivers', icon: '⌁' },
  { key: 'owners', label: 'Transport Owners', icon: '⧉' },
  { key: 'analytics', label: 'Analytics', icon: '◷' },
  { key: 'ai', label: 'AI Insights', icon: '✦' }
];

const formatINR = (value) =>
  value != null && Number.isFinite(Number(value))
    ? `₹${Number(value).toLocaleString('en-IN')}`
    : '—';

/**
 * AdminAssignVehicle
 * Dedicated, full-page vehicle assignment workflow:
 *   /admin/bookings/:bookingNumber/assign-vehicle
 */
function AdminAssignVehicle() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [bookingLoaded, setBookingLoaded] = useState(false);

  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [vehicleError, setVehicleError] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 0 });

  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  useEffect(() => {
    if (!bookingNumber) return;
    (async () => {
      try {
        const response = await adminAPI.getBookingByNumber(bookingNumber);
        if (response.data?.success) setBooking(response.data.data);
      } catch (err) {
        setVehicleError(err?.response?.data?.message || err?.message || 'Could not load booking');
      } finally {
        setBookingLoaded(true);
      }
    })();
  }, [bookingNumber]);

  const fetchVehicles = useCallback(async (pg) => {
    setLoadingVehicles(true);
    setVehicleError('');
    try {
      const response = await adminAPI.getVehicles({ page: pg, limit: 20, type });
      if (response.data?.success) {
        setVehicles(response.data.data || []);
        setPagination(response.data.pagination || { total: 0, pages: 0 });
        setPage(pg);
      } else {
        setVehicleError('Failed to load vehicles');
      }
    } catch (err) {
      setVehicleError(err?.response?.data?.message || err?.message || 'Failed to load vehicles');
    } finally {
      setLoadingVehicles(false);
    }
  }, [type]);

  useEffect(() => {
    fetchVehicles(1);
  }, [fetchVehicles]);

const quote = (booking?.quote_status || 'PENDING').toUpperCase();
  const isVehicleAssigned = !!booking?.vehicle_id || !!booking?.vehicle_number || !!booking?.truck_number_snapshot;
  // Exceptional operational path — the acceptance gate is intentionally removed.
  // The NORMAL quote workflow selects the driver (whose vehicle auto-derives)
  // WITH the final quote; customer acceptance auto-confirms them. This page is
  // a manual/exceptional override and must not be blocked on acceptance.
  const canAssign = !isVehicleAssigned && !['cancelled', 'completed', 'delivered'].includes(booking?.status);

  const handleSelectVehicle = useCallback((vehicle) => {
    setSelectedVehicle(vehicle);
    setConfirmOpen(true);
    setAssignError('');
    setAssignSuccess('');
  }, []);

  const handleConfirmAssign = useCallback(async () => {
    if (!booking || !selectedVehicle) return;
    setAssigning(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const response = await adminAPI.assignVehicle(booking.booking_id, selectedVehicle.vehicle_id);
      if (response.data?.success) {
        setAssignSuccess('Vehicle assigned successfully.');
        setConfirmOpen(false);
        try {
          const bResp = await adminAPI.getBookingByNumber(bookingNumber);
          if (bResp.data?.success) setBooking(bResp.data.data);
        } catch { /* ignore */ }
        fetchVehicles(page);
      } else {
        setAssignError(response.data?.message || 'Failed to assign vehicle');
      }
    } catch (err) {
      setAssignError(err?.response?.data?.message || err?.message || 'Failed to assign vehicle');
    } finally {
      setAssigning(false);
    }
  }, [booking, selectedVehicle, bookingNumber, fetchVehicles, page]);

  if (bookingLoaded && isVehicleAssigned) {
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="bookings" onNav={(k) => {}}>
        <div className="space-y-5 max-w-3xl">
          <button onClick={() => navigate('/admin/bookings')} className="text-sm font-semibold text-amber-600 dark:text-amber-400 hover:underline">← Back to bookings</button>
          <div className="rounded-2xl border border-blue-500/30 bg-blue-500/5 p-8 text-center">
            <div className="text-5xl mb-4" aria-hidden="true">🚚</div>
            <h1 className="text-xl font-bold">Vehicle Already Assigned</h1>
            <p className="text-sm text-muted mt-2">
              {booking.booking_number || booking.booking_reference} — {booking.vehicle_number || booking.truck_number_snapshot || '—'}
            </p>
            <div className="flex justify-center gap-3 mt-6">
              <button onClick={() => navigate(`/admin/bookings/${bookingNumber}`)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">
                View Booking
              </button>
            </div>
          </div>
        </div>
      </AdminShell>
    );
  }

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey="bookings" onNav={(k) => {}}>
      <div className="space-y-5 max-w-5xl">
        <button
          onClick={() => navigate(`/admin/bookings/${bookingNumber}`)}
          className="text-sm font-semibold text-amber-600 dark:text-amber-400 hover:underline"
        >
          ← Back to booking
        </button>

        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assign Vehicle</h1>
          <p className="text-sm text-muted mt-1">
            Assign an available fleet vehicle to this booking.
          </p>
        </div>

        {/* Booking summary */}
        {booking && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-lg">{booking.booking_number || booking.booking_reference}</span>
                  <StatusBadge status={booking.status} quoteStatus={booking.quote_status} size="sm" />
                </div>
                <div className="flex items-center gap-2 text-sm mt-2">
                  <span className="font-medium">{booking.pickup_city || '—'}</span>
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <span className="font-medium">{booking.drop_city || '—'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Required Vehicle</div>
                  <div className="font-semibold capitalize">{String(booking.vehicle_type_required || '—').replace(/_/g, ' ')}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Price</div>
                  <div className="font-semibold">{booking.final_price != null ? formatINR(booking.final_price) : '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Quote</div>
                  <div className="font-semibold capitalize">{String(quote).toLowerCase()}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Confirmation panel */}
        {confirmOpen && selectedVehicle && (
          <div className="rounded-2xl border border-blue-500/40 bg-blue-500/5 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border/40">
              <span className="text-sm font-bold tracking-tight">ASSIGN VEHICLE</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Booking</div>
                  <div className="font-semibold">{booking?.booking_number || booking?.booking_reference || bookingNumber}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Route</div>
                  <div className="font-semibold">{booking?.pickup_city || '—'} → {booking?.drop_city || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Vehicle</div>
                  <div className="font-semibold">{selectedVehicle.vehicle_number}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Vehicle Type</div>
                  <div className="font-semibold capitalize">{String(selectedVehicle.vehicle_type || '—').replace(/_/g, ' ')}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Capacity</div>
                  <div className="font-semibold">{selectedVehicle.capacity_kg ? `${selectedVehicle.capacity_kg} kg` : '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Owner</div>
                  <div className="font-semibold">{selectedVehicle.owner_name || '—'}</div>
                </div>
              </div>

              {assignError && (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                  {assignError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setConfirmOpen(false); setSelectedVehicle(null); }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={assigning || !canAssign}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-semibold hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assigning ? 'Assigning...' : 'Confirm Vehicle Assignment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {assignSuccess && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <div className="text-5xl mb-3" aria-hidden="true">✅</div>
            <h3 className="text-lg font-bold">Vehicle Assigned Successfully</h3>
            <p className="text-sm text-muted mt-1">{assignSuccess}</p>
            <div className="flex justify-center gap-3 mt-5">
              <button onClick={() => navigate(`/admin/bookings/${bookingNumber}`)} className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition">
                View Booking
              </button>
              <button onClick={() => navigate('/admin/bookings')} className="px-5 py-2 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition">
                All Bookings
              </button>
            </div>
          </div>
        )}

        {!isVehicleAssigned && !assignSuccess && canAssign && (
          <>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-bold tracking-tight">AVAILABLE VEHICLES</h2>
                <p className="text-xs text-muted mt-0.5">{pagination.total > 0 ? `${pagination.total} vehicle(s)` : 'Loading...'}</p>
              </div>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-xs font-semibold text-text focus:ring-2 focus:ring-blue-500/40 outline-none transition"
                aria-label="Filter by vehicle type"
              >
                <option value="">All Types</option>
                <option value="truck">Truck</option>
                <option value="mini_truck">Mini Truck</option>
                <option value="pickup">Pickup</option>
                <option value="tempo">Tempo</option>
                <option value="tata_ace">Tata Ace</option>
                <option value="container">Container</option>
              </select>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {vehicleError && !loadingVehicles && (
                <div className="col-span-full rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                  {vehicleError}
                </div>
              )}

              {vehicles.length === 0 && !loadingVehicles && !vehicleError && (
                <div className="col-span-full rounded-2xl border border-dashed border-border/60 p-10 text-center">
                  <div className="text-sm text-muted">No vehicles found.</div>
                </div>
              )}

              {vehicles.map((vehicle) => {
                const isAvail = String(vehicle.current_status || 'available') === 'available' && (vehicle.is_available ?? true);
                return (
                  <div key={vehicle.vehicle_id} className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-lg shrink-0">
                        🚚
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-text truncate">{vehicle.vehicle_number}</div>
                        <div className="text-xs text-muted mt-0.5 capitalize">{String(vehicle.vehicle_type || '—').replace(/_/g, ' ')}</div>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted">
                          {vehicle.capacity_kg && <span>Capacity: {vehicle.capacity_kg} kg</span>}
                          {vehicle.owner_name && <span>Owner: {vehicle.owner_name}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleSelectVehicle(vehicle)}
                        disabled={!isAvail || !canAssign}
                        className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                          !isAvail || !canAssign
                            ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                            : 'bg-blue-500 text-white hover:bg-blue-600'
                        }`}
                        title={!isAvail ? 'Vehicle is unavailable' : 'Select this vehicle'}
                      >
                        {isAvail ? 'Select' : 'Unavailable'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {loadingVehicles && (
                <div className="col-span-full flex items-center justify-center py-4">
                  <div className="h-5 w-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-muted">Loading vehicles...</span>
                </div>
              )}
            </div>

            {pagination.pages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <button
                  onClick={() => fetchVehicles(page - 1)}
                  disabled={page <= 1}
                  className="px-3 py-2 rounded-xl border border-border/60 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40"
                >
                  ← Prev
                </button>
                <span className="text-sm text-muted">Page {page} of {pagination.pages}</span>
                <button
                  onClick={() => fetchVehicles(page + 1)}
                  disabled={page >= pagination.pages}
                  className="px-3 py-2 rounded-xl border border-border/60 text-sm font-medium hover:bg-hover/60 transition disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}

{!isVehicleAssigned && !canAssign && !assignSuccess && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-8 text-center">
            <div className="text-sm text-muted">
              This booking cannot accept a vehicle assignment in its current state.
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminAssignVehicle;

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
 * AdminAssignDriver
 * Dedicated, full-page driver assignment workflow:
 *   /admin/bookings/:bookingNumber/assign-driver
 * Exposes available drivers with search + filters, then a confirmation
 * panel before calling the backend assignment API.
 */
function AdminAssignDriver() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [bookingLoaded, setBookingLoaded] = useState(false);

  // Driver picker state
  const [drivers, setDrivers] = useState([]);
  const [loadingDrivers, setLoadingDrivers] = useState(false);
  const [driverError, setDriverError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('available');
  const [vehicleType, setVehicleType] = useState('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const listRef = useRef(null);
  const pageRef = useRef(1);
  const loadingRef = useRef(false);

  // Confirmation panel state
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');

  // Load booking by canonical number
  useEffect(() => {
    if (!bookingNumber) return;
    (async () => {
      try {
        const response = await adminAPI.getBookingByNumber(bookingNumber);
        if (response.data?.success) {
          setBooking(response.data.data);
        }
      } catch (err) {
        setDriverError(err?.response?.data?.message || err?.message || 'Could not load booking');
      } finally {
        setBookingLoaded(true);
      }
    })();
  }, [bookingNumber]);

  const fetchDrivers = useCallback(async (pg, { append = false } = {}) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoadingDrivers(true);
    setDriverError('');
    try {
      const response = await adminAPI.getAssignableDrivers({
        page: pg,
        limit: 20,
        search,
        status,
        vehicle_type: vehicleType,
      });
      if (response.data?.success) {
        const data = response.data.data || [];
        const pagination = response.data.pagination || {};
        setDrivers((prev) => (append ? [...prev, ...data] : data));
        setTotal(pagination.total || 0);
        setPage(pg);
        pageRef.current = pg;
        setHasMore(pg < (pagination.pages || 1));
      } else {
        setDriverError('Failed to load drivers');
      }
    } catch (err) {
      setDriverError(err?.response?.data?.message || err?.message || 'Failed to load drivers');
    } finally {
      loadingRef.current = false;
      setLoadingDrivers(false);
    }
  }, [search, status, vehicleType]);

  // Debounced load
  useEffect(() => {
    const timer = setTimeout(() => {
      setDrivers([]);
      pageRef.current = 1;
      fetchDrivers(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, status, vehicleType, fetchDrivers]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && hasMore && !loadingRef.current) {
      fetchDrivers(pageRef.current + 1, { append: true });
    }
  }, [fetchDrivers, hasMore]);

// Exceptional operational path — the acceptance gate is intentionally
  // removed. The NORMAL quote workflow selects the driver WITH the final quote
  // (sendQuoteWithReservation) and reserves them; customer acceptance then
  // auto-confirms driver + vehicle. This page is for manual driver assignment
  // and must not be blocked merely because the customer has not accepted yet.
  const isDriverAssigned = !!booking?.driver_id || !!booking?.driver_name_snapshot || !!booking?.truck_number_snapshot;
  const quote = (booking?.quote_status || 'PENDING').toUpperCase();
  const canAssign = !isDriverAssigned && !['cancelled', 'completed', 'delivered'].includes(booking?.status);

  const selectedDriverName = useMemo(() => {
    if (!selectedDriver) return '';
    return selectedDriver.driver_name
      || `${selectedDriver.first_name || ''} ${selectedDriver.last_name || ''}`.trim()
      || `Driver #${selectedDriver.driver_id}`;
  }, [selectedDriver]);

  const handleSelectDriver = useCallback((driver) => {
    setSelectedDriver(driver);
    setConfirmOpen(true);
    setAssignError('');
    setAssignSuccess('');
  }, []);

  const handleConfirmAssign = useCallback(async () => {
    if (!booking || !selectedDriver) return;
    setAssigning(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const response = await adminAPI.assignDriver(booking.booking_id, selectedDriver.driver_id);
      if (response.data?.success) {
        setAssignSuccess('Driver assigned successfully. Vehicle auto-assigned from the driver\'s registered vehicle.');
        setConfirmOpen(false);
        // Refresh booking + driver list
        try {
          const bResp = await adminAPI.getBookingByNumber(bookingNumber);
          if (bResp.data?.success) setBooking(bResp.data.data);
        } catch { /* ignore */ }
        fetchDrivers(pageRef.current);
      } else {
        setAssignError(response.data?.message || 'Failed to assign driver');
      }
    } catch (err) {
      setAssignError(err?.response?.data?.message || err?.message || 'Failed to assign driver');
    } finally {
      setAssigning(false);
    }
  }, [booking, selectedDriver, bookingNumber, fetchDrivers]);

  // Success view if driver already assigned
  if (bookingLoaded && isDriverAssigned) {
    const driverName = booking.driver_name_snapshot
      || `${booking.driver_first_name || ''} ${booking.driver_last_name || ''}`.trim()
      || '—';
    return (
      <AdminShell navItems={NAV_ITEMS} activeKey="bookings" onNav={(k) => {}}>
        <div className="space-y-5 max-w-3xl">
          <button onClick={() => navigate('/admin/bookings')} className="text-sm font-semibold text-amber-600 dark:text-amber-400 hover:underline">← Back to bookings</button>
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
            <div className="text-5xl mb-4" aria-hidden="true">✅</div>
            <h1 className="text-xl font-bold">Driver Already Assigned</h1>
            <p className="text-sm text-muted mt-2">
              {booking.booking_number || booking.booking_reference} — {driverName}
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

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assign Driver</h1>
          <p className="text-sm text-muted mt-1">
            Select an available driver to operate this booking. The driver's registered vehicle will be auto-assigned.
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
                  <span className="font-medium">{booking.pickup_city || booking.pickup_location || '—'}</span>
                  <svg className="w-4 h-4 text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <span className="font-medium">{booking.drop_city || booking.drop_location || '—'}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Customer</div>
                  <div className="font-semibold">{`${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Goods</div>
                  <div className="font-semibold">{booking.goods_type || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Required Vehicle</div>
                  <div className="font-semibold capitalize">{String(booking.vehicle_type_required || '—').replace(/_/g, ' ')}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Price</div>
                  <div className="font-semibold">
                    {booking.final_price != null ? formatINR(booking.final_price) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Distance</div>
                  <div className="font-semibold">{booking.estimated_distance_km != null ? `${booking.estimated_distance_km} km` : '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Quote</div>
                  <div className="font-semibold capitalize">{String(quote).toLowerCase()}</div>
                </div>
              </div>
            </div>

{!canAssign && !isDriverAssigned && (
              <div className="mt-4 rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3 text-sm text-muted">
                This booking cannot accept a driver assignment in its current state.
              </div>
            )}
          </div>
        )}

        {/* Confirmation panel */}
        {confirmOpen && selectedDriver && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 backdrop-blur-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border/40">
              <span className="text-sm font-bold tracking-tight">ASSIGN DRIVER</span>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Booking</div>
                  <div className="font-semibold">{booking?.booking_number || booking?.booking_reference || bookingNumber}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Route</div>
                  <div className="font-semibold">
                    {booking?.pickup_city || '—'} → {booking?.drop_city || '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Driver</div>
                  <div className="font-semibold">{selectedDriverName}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Driver ID</div>
                  <div className="font-semibold">{selectedDriver.driver_code || `DRV${String(selectedDriver.driver_id).padStart(6, '0')}`}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Phone</div>
                  <div className="font-semibold">{selectedDriver.mobile || '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted uppercase tracking-wider">Rating</div>
                  <div className="font-semibold">{selectedDriver.rating ? `★ ${selectedDriver.rating}` : '—'}</div>
                </div>
              </div>

              {selectedDriver.vehicle && (
                <div className="mt-2 pt-3 border-t border-border/40">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-sm">
                    <div>
                      <div className="text-[11px] text-muted uppercase tracking-wider">Vehicle</div>
                      <div className="font-semibold">{selectedDriver.vehicle.vehicle_number || '—'}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted uppercase tracking-wider">Vehicle Type</div>
                      <div className="font-semibold capitalize">{String(selectedDriver.vehicle.vehicle_type || '—').replace(/_/g, ' ')}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted uppercase tracking-wider">Capacity</div>
                      <div className="font-semibold">{selectedDriver.vehicle.capacity_kg ? `${selectedDriver.vehicle.capacity_kg} kg` : '—'}</div>
                    </div>
                  </div>
                </div>
              )}

              {assignError && (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                  {assignError}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setConfirmOpen(false); setSelectedDriver(null); }}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmAssign}
                  disabled={assigning || !canAssign}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {assigning ? 'Assigning...' : 'Confirm Driver Assignment'}
                </button>
              </div>
            </div>
          </div>
        )}

        {assignSuccess && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center">
            <div className="text-5xl mb-3" aria-hidden="true">✅</div>
            <h3 className="text-lg font-bold">Driver Assigned Successfully</h3>
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

        {!isDriverAssigned && !assignSuccess && canAssign && (
          <>
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-bold tracking-tight">AVAILABLE DRIVERS</h2>
                <p className="text-xs text-muted mt-0.5">{total > 0 ? `${total} driver(s) available` : 'Searching...'}</p>
              </div>
            </div>

            {/* Search + filters */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4 space-y-3">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, driver ID, mobile, vehicle number..."
                className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm font-medium text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
                aria-label="Search drivers"
              />
              <div className="grid grid-cols-2 gap-2.5">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-xs font-semibold text-text focus:ring-2 focus:ring-amber-500/40 outline-none transition"
                  aria-label="Filter by status"
                >
                  <option value="available">Available</option>
                  <option value="">All Status</option>
                  <option value="on_trip">On Trip</option>
                  <option value="inactive">Inactive</option>
                </select>
                <select
                  value={vehicleType}
                  onChange={(e) => setVehicleType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-xs font-semibold text-text focus:ring-2 focus:ring-amber-500/40 outline-none transition"
                  aria-label="Filter by vehicle type"
                >
                  <option value="">All Vehicle Types</option>
                  <option value="truck">Truck</option>
                  <option value="mini_truck">Mini Truck</option>
                  <option value="pickup">Pickup</option>
                  <option value="tempo">Tempo</option>
                  <option value="tata_ace">Tata Ace</option>
                  <option value="ashok_leyland_dost">Dost</option>
                  <option value="container">Container</option>
                </select>
              </div>
            </div>

            {/* Driver cards */}
            <div
              ref={listRef}
              onScroll={handleScroll}
              className="space-y-3 max-h-[55vh] overflow-y-auto pr-1"
              role="list"
              aria-label="Available drivers"
            >
              {driverError && !loadingDrivers && (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
                  {driverError}
                </div>
              )}

              {drivers.length === 0 && !loadingDrivers && !driverError && (
                <div className="rounded-2xl border border-dashed border-border/60 p-10 text-center">
                  <div className="text-sm text-muted">No drivers found. Try adjusting your search or filters.</div>
                </div>
              )}

              {drivers.map((driver) => {
                const dName = driver.driver_name
                  || `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
                  || `Driver #${driver.driver_id}`;
                const dCode = driver.driver_code || `DRV${String(driver.driver_id).padStart(6, '0')}`;
                const isAvail = (driver.is_available ?? true) && String(driver.status || 'available') === 'available';
                const v = driver.vehicle;

                return (
                  <div
                    key={driver.driver_id}
                    className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-4"
                    role="listitem"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {dName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-bold text-text">{dName}</span>
                          <span className="text-[11px] font-semibold text-muted">{dCode}</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-xs text-muted">
                          <span>{driver.mobile || '—'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-0.5 text-amber-600">
                            ★ {driver.rating ?? '—'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className={`font-semibold ${isAvail ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500'}`}>
                            {isAvail ? 'Available' : String(driver.status || 'unavailable').replace(/_/g, ' ')}
                          </span>
                          {typeof driver.total_deliveries === 'number' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{driver.total_deliveries} trips</span>
                            </>
                          )}
                        </div>

                        {v && (
                          <div className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 text-xs">
                            <span className="text-text">
                              Vehicle: <span className="font-semibold">{v.vehicle_number || '—'}</span>
                            </span>
                            <span className="text-muted capitalize">• {String(v.vehicle_type || '—').replace(/_/g, ' ')}</span>
                            {v.capacity_kg && <span className="text-muted">• Capacity: {v.capacity_kg} kg</span>}
                          </div>
                        )}
                        {!v && (
                          <div className="mt-2 inline-flex items-center rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-1.5 text-xs text-red-600">
                            No registered vehicle
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        <button
                          onClick={() => handleSelectDriver(driver)}
                          disabled={!isAvail || !v || !canAssign}
                          className={`px-4 py-2 rounded-xl text-sm font-semibold transition ${
                            !isAvail || !v || !canAssign
                              ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 cursor-not-allowed'
                              : 'bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-500/20'
                          }`}
                          title={
                            !isAvail ? 'Driver is unavailable'
                              : !v ? 'Driver has no registered vehicle'
                                : 'Select this driver'
                          }
                        >
                          {!isAvail ? 'Unavailable' : !v ? 'No Vehicle' : 'Select Driver'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {loadingDrivers && (
                <div className="flex items-center justify-center py-4">
                  <div className="h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                  <span className="ml-3 text-sm text-muted">Loading drivers...</span>
                </div>
              )}
              {!loadingDrivers && hasMore && (
                <p className="text-center text-[11px] text-muted py-2">Scroll for more drivers...</p>
              )}
            </div>
          </>
        )}

{!isDriverAssigned && !canAssign && !assignSuccess && (
          <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-8 text-center">
            <div className="text-sm text-muted">
              This booking cannot accept a driver assignment in its current state.
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminAssignDriver;


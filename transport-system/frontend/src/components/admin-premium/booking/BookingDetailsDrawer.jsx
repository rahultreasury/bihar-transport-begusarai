import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StatusBadge from './StatusBadge';
import { adminAPI } from '../../../services/api';

const InfoRow = React.memo(function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-text break-words">{value || 'Not Available'}</div>
    </div>
  );
});

const SectionCard = React.memo(function SectionCard({ title, children }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border/40">
        <span className="text-sm font-bold tracking-tight">{title}</span>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </div>
  );
});

function BookingDetailsDrawer({ booking, isOpen, onClose, onBookingUpdated }) {
  const drawerRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Assign Driver modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [availableDrivers, setAvailableDrivers] = useState([]);
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [assigningDriver, setAssigningDriver] = useState(false);
  const [assignError, setAssignError] = useState('');
  const [assignSuccess, setAssignSuccess] = useState('');
  const [loadingDrivers, setLoadingDrivers] = useState(false);

  // Assign Vehicle modal state
  const [showAssignVehicleModal, setShowAssignVehicleModal] = useState(false);
  const [availableVehicles, setAvailableVehicles] = useState([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState(null);
  const [assigningVehicle, setAssigningVehicle] = useState(false);
  const [assignVehicleError, setAssignVehicleError] = useState('');
  const [assignVehicleSuccess, setAssignVehicleSuccess] = useState('');
  const [loadingVehicles, setLoadingVehicles] = useState(false);

  // Trap focus
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      setTimeout(() => {
        drawerRef.current?.focus();
      }, 100);
    } else {
      previousActiveElement.current?.focus();
    }
  }, [isOpen]);

  // Handle ESC
  useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        if (showAssignModal) {
          setShowAssignModal(false);
        } else if (showAssignVehicleModal) {
          setShowAssignVehicleModal(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, showAssignModal, showAssignVehicleModal]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const canAssignDriver = useCallback(() => {
    if (!booking) return false;
    if (booking.driver_id) return false;
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) return false;
    return true;
  }, [booking]);

  const handleOpenAssignModal = useCallback(async () => {
    setAssignError('');
    setAssignSuccess('');
    setSelectedDriverId(null);
    setLoadingDrivers(true);
    setShowAssignModal(true);
    try {
      const response = await adminAPI.getAvailableDrivers();
      if (response.data?.success) {
        setAvailableDrivers(response.data.data || []);
      } else {
        setAssignError('Failed to load available drivers');
      }
    } catch (err) {
      setAssignError('Failed to load available drivers');
      console.error('Error loading drivers:', err);
    } finally {
      setLoadingDrivers(false);
    }
  }, []);

  const handleAssignDriver = useCallback(async () => {
    if (!selectedDriverId || !booking) return;
    setAssigningDriver(true);
    setAssignError('');
    setAssignSuccess('');
    try {
      const response = await adminAPI.assignDriver(booking.booking_id, selectedDriverId);
      if (response.data?.success) {
        setAssignSuccess(`Driver assigned successfully`);
        // Refresh booking details
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
        setTimeout(() => {
          setShowAssignModal(false);
        }, 500);
      } else {
        setAssignError(response.data?.message || 'Failed to assign driver');
      }
    } catch (err) {
      setAssignError(err?.response?.data?.message || err?.message || 'Failed to assign driver');
    } finally {
      setAssigningDriver(false);
    }
  }, [selectedDriverId, booking, onBookingUpdated]);

  const canAssignVehicle = useCallback(() => {
    if (!booking) return false;
    if (booking.vehicle_id) return false;
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) return false;
    return true;
  }, [booking]);

  const handleOpenAssignVehicleModal = useCallback(async () => {
    setAssignVehicleError('');
    setAssignVehicleSuccess('');
    setSelectedVehicleId(null);
    setLoadingVehicles(true);
    setShowAssignVehicleModal(true);
    try {
      const response = await adminAPI.getVehicles({ limit: 100 });
      if (response.data?.success) {
        const allVehicles = response.data.data || [];
        const available = allVehicles.filter(v => v.is_available === 1 || v.is_available === true);
        setAvailableVehicles(available);
      } else {
        setAssignVehicleError('Failed to load available vehicles');
      }
    } catch (err) {
      setAssignVehicleError('Failed to load available vehicles');
      console.error('Error loading vehicles:', err);
    } finally {
      setLoadingVehicles(false);
    }
  }, []);

  const handleAssignVehicle = useCallback(async () => {
    if (!selectedVehicleId || !booking) return;
    setAssigningVehicle(true);
    setAssignVehicleError('');
    setAssignVehicleSuccess('');
    try {
      const response = await adminAPI.assignVehicle(booking.booking_id, selectedVehicleId);
      if (response.data?.success) {
        setAssignVehicleSuccess('Vehicle assigned successfully');
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
        setTimeout(() => {
          setShowAssignVehicleModal(false);
        }, 500);
      } else {
        setAssignVehicleError(response.data?.message || 'Failed to assign vehicle');
      }
    } catch (err) {
      setAssignVehicleError(err?.response?.data?.message || err?.message || 'Failed to assign vehicle');
    } finally {
      setAssigningVehicle(false);
    }
  }, [selectedVehicleId, booking, onBookingUpdated]);

  if (!booking) return null;

  const customerName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || '—';
  const driverName = `${booking.driver_first_name || ''} ${booking.driver_last_name || ''}`.trim() || null;
  const vehicleInfo = booking.vehicle_name
    ? `${booking.vehicle_name}${booking.vehicle_number ? ` (${booking.vehicle_number})` : ''}`
    : null;
  const distance = booking.estimated_distance_km ? `${booking.estimated_distance_km} km` : '—';
  const price = booking.final_price
    ? `₹${Number(booking.final_price).toLocaleString()}`
    : booking.estimated_price
      ? `₹${Number(booking.estimated_price).toLocaleString()} (est.)`
      : '—';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
            onClick={() => { if (!showAssignModal && !showAssignVehicleModal) onClose(); }}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.div
            ref={drawerRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-[540px] bg-surface border-l border-border/60 shadow-2xl z-50 overflow-hidden flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Booking Details"
            tabIndex={-1}
          >
            {/* Header */}
            <div className="shrink-0 px-6 py-5 border-b border-border/60 flex items-center justify-between bg-header/30 backdrop-blur-xl">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold tracking-tight truncate">
                    {booking.booking_reference || 'Booking Details'}
                  </h2>
                  {booking.status && <StatusBadge status={booking.status} size="sm" />}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Booking ID: #{booking.booking_id}
                </div>
              </div>
              <button
                onClick={onClose}
                className="h-10 w-10 rounded-xl border border-border/60 bg-card/40 flex items-center justify-center hover:bg-hover/60 transition ml-3 shrink-0"
                aria-label="Close drawer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

              {/* 1. Customer Information */}
              <SectionCard title="Customer Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Customer Name" value={customerName} />
                  <InfoRow label="Mobile Number" value={booking.customer_phone} />
                  <InfoRow label="Email" value={booking.customer_email} />
                </div>
              </SectionCard>

              {/* 2. Booking Information */}
              <SectionCard title="Booking Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Booking Reference" value={booking.booking_reference} />
                  <InfoRow label="Booking Date &amp; Time" value={booking.created_at ? new Date(booking.created_at).toLocaleString('en-IN') : '—'} />
                  <InfoRow label="Pickup Location" value={booking.pickup_location || booking.pickup_address || booking.pickup_city} />
                  <InfoRow label="Drop Location" value={booking.drop_location || booking.drop_address || booking.drop_city} />
                  <InfoRow label="Goods Type" value={booking.goods_type || '—'} />
                  <InfoRow label="Pickup Date" value={booking.pickup_date ? new Date(booking.pickup_date).toLocaleDateString('en-IN') + (booking.pickup_time ? ` ${booking.pickup_time}` : '') : '—'} />
                  <InfoRow label="Distance" value={distance} />
                  <InfoRow label="Price" value={price} />
                </div>
              </SectionCard>

              {/* 3. Assignment */}
              <SectionCard title="Assignment">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Assigned Driver" value={driverName || 'Not Assigned'} />
                  <InfoRow label="Driver Phone" value={booking.driver_phone || '—'} />
                  <InfoRow label="Assigned Vehicle" value={vehicleInfo || 'Not Assigned'} />
                  <InfoRow label="Vehicle Type" value={booking.vehicle_type_required ? booking.vehicle_type_required.replace(/_/g, ' ') : '—'} />
                </div>
                {canAssignDriver() && (
                  <button
                    onClick={handleOpenAssignModal}
                    className="mt-3 w-full py-2.5 px-4 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                    </svg>
                    Assign Driver
                  </button>
                )}
                {canAssignVehicle() && (
                  <button
                    onClick={handleOpenAssignVehicleModal}
                    className="mt-2 w-full py-2.5 px-4 rounded-xl border-2 border-violet-500 text-violet-600 font-semibold text-sm hover:bg-violet-50 transition flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" />
                    </svg>
                    Assign Vehicle
                  </button>
                )}
              </SectionCard>

              {/* 4. Booking Status */}
              <SectionCard title="Booking Status">
                <div className="flex items-center gap-3">
                  <StatusBadge status={booking.status} size="lg" />
                  <div className="text-sm text-muted">
                    {booking.status === 'pending' && 'Awaiting confirmation'}
                    {booking.status === 'confirmed' && 'Booking confirmed'}
                    {booking.status === 'driver_assigned' && 'Driver has been assigned'}
                    {booking.status === 'pickup_completed' && 'Goods picked up'}
                    {booking.status === 'in_transit' && 'Goods in transit'}
                    {booking.status === 'delivered' && 'Goods delivered'}
                    {booking.status === 'cancelled' && 'Booking was cancelled'}
                    {booking.status === 'completed' && 'Booking completed'}
                  </div>
                </div>
                {booking.delivery_current_status && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <InfoRow label="Delivery Status" value={booking.delivery_current_status.replace(/_/g, ' ')} />
                      <InfoRow label="Status Description" value={booking.delivery_status_description || '—'} />
                    </div>
                  </div>
                )}
              </SectionCard>

            </div>
          </motion.div>

          {/* Assign Driver Modal */}
          {showAssignModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50" onClick={() => { if (!assigningDriver) setShowAssignModal(false); }} aria-hidden="true" />
              <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" role="dialog" aria-modal="true" aria-label="Assign Driver">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Assign Driver</h3>
                    <p className="text-sm text-gray-500 mt-0.5">Select an available driver for this booking</p>
                  </div>
                  <button
                    onClick={() => setShowAssignModal(false)}
                    disabled={assigningDriver}
                    className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition disabled:opacity-50"
                    aria-label="Close"
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>

                <div className="p-5 max-h-[400px] overflow-y-auto">
                  {loadingDrivers ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-6 w-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      <span className="ml-3 text-sm text-gray-500">Loading drivers...</span>
                    </div>
                  ) : availableDrivers.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">🧑‍🔧</div>
                      <p className="text-sm text-gray-500 font-medium">No available drivers</p>
                      <p className="text-xs text-gray-400 mt-1">All drivers are currently assigned to other bookings</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {availableDrivers.map((driver) => {
                        const isSelected = selectedDriverId === driver.driver_id;
                        return (
                          <button
                            key={driver.driver_id}
                            onClick={() => setSelectedDriverId(driver.driver_id)}
                            className={`w-full text-left p-3.5 rounded-xl border-2 transition ${
                              isSelected
                                ? 'border-amber-500 bg-amber-50'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                  {driver.first_name?.[0] || 'D'}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900 text-sm">
                                    {driver.first_name} {driver.last_name}
                                  </div>
                                  <div className="text-xs text-gray-500">{driver.phone || '—'}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-semibold text-amber-600">⭐ {driver.rating ?? '—'}</div>
                                <div className="text-xs text-gray-400">{driver.total_deliveries ?? 0} deliveries</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {assignError && (
                  <div className="px-5 pb-2">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {assignError}
                    </div>
                  </div>
                )}

                {assignSuccess && (
                  <div className="px-5 pb-2">
                    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                      {assignSuccess}
                    </div>
                  </div>
                )}

                <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowAssignModal(false)}
                    disabled={assigningDriver}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAssignDriver}
                    disabled={!selectedDriverId || assigningDriver || loadingDrivers}
                    className="px-5 py-2.5 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {assigningDriver ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      'Assign Driver'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Assign Vehicle Modal */}
          {showAssignVehicleModal && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
              <div className="absolute inset-0 bg-black/50" onClick={() => { if (!assigningVehicle) setShowAssignVehicleModal(false); }} aria-hidden="true" />
              <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden" role="dialog" aria-modal="true" aria-label="Assign Vehicle">
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">Assign Vehicle</h3>
                    <p className="text-sm text-gray-500 mt-0.5">Select an available vehicle for this booking</p>
                  </div>
                  <button
                    onClick={() => setShowAssignVehicleModal(false)}
                    disabled={assigningVehicle}
                    className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition disabled:opacity-50"
                    aria-label="Close"
                  >
                    <span className="text-xl leading-none">×</span>
                  </button>
                </div>

                <div className="p-5 max-h-[400px] overflow-y-auto">
                  {loadingVehicles ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="h-6 w-6 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                      <span className="ml-3 text-sm text-gray-500">Loading vehicles...</span>
                    </div>
                  ) : availableVehicles.length === 0 ? (
                    <div className="text-center py-8">
                      <div className="text-3xl mb-2">🚛</div>
                      <p className="text-sm text-gray-500 font-medium">No available vehicles</p>
                      <p className="text-xs text-gray-400 mt-1">All vehicles are currently assigned to other bookings or unavailable</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {availableVehicles.map((vehicle) => {
                        const isSelected = selectedVehicleId === vehicle.vehicle_id;
                        return (
                          <button
                            key={vehicle.vehicle_id}
                            onClick={() => setSelectedVehicleId(vehicle.vehicle_id)}
                            className={`w-full text-left p-3.5 rounded-xl border-2 transition ${
                              isSelected
                                ? 'border-violet-500 bg-violet-50'
                                : 'border-gray-200 hover:border-gray-300 bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                                  {vehicle.vehicle_type?.[0]?.toUpperCase() || 'V'}
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900 text-sm">
                                    {vehicle.vehicle_name || vehicle.vehicle_number || `Vehicle #${vehicle.vehicle_id}`}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {vehicle.vehicle_number || '—'} · {vehicle.vehicle_type?.replace(/_/g, ' ') || '—'}
                                  </div>
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-xs font-semibold text-violet-600">{vehicle.capacity_kg ? `${vehicle.capacity_kg} kg` : '—'}</div>
                                <div className="text-xs text-gray-400">{vehicle.vehicle_make || '—'}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {assignVehicleError && (
                  <div className="px-5 pb-2">
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {assignVehicleError}
                    </div>
                  </div>
                )}

                {assignVehicleSuccess && (
                  <div className="px-5 pb-2">
                    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                      {assignVehicleSuccess}
                    </div>
                  </div>
                )}

                <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-3">
                  <button
                    onClick={() => setShowAssignVehicleModal(false)}
                    disabled={assigningVehicle}
                    className="px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-50 transition disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAssignVehicle}
                    disabled={!selectedVehicleId || assigningVehicle || loadingVehicles}
                    className="px-5 py-2.5 rounded-xl bg-violet-500 text-white font-semibold text-sm hover:bg-violet-600 transition disabled:opacity-50 flex items-center gap-2"
                  >
                    {assigningVehicle ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Assigning...
                      </>
                    ) : (
                      'Assign Vehicle'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </AnimatePresence>
  );
}

export default BookingDetailsDrawer;

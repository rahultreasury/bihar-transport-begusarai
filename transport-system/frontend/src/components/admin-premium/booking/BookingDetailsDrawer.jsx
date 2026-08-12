import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  UserRound,
  AlertCircle,
  CheckCircle2,
  Send,
  Timer,
  Truck,
  Star,
} from 'lucide-react';
import StatusBadge from './StatusBadge';
import { adminAPI } from '../../../services/api';

/* ===================================================================
   THEME CONSTANTS - Bihar Transport Branding
   =================================================================== */
const ORANGE = {
  gradient: 'from-amber-500 to-orange-600',
  light: 'bg-amber-50',
  border: 'border-amber-500',
  text: 'text-amber-600',
  bg: 'bg-amber-500',
  glow: '0 0 20px rgba(245,158,11,0.3)',
  bgSoft: 'bg-amber-500/10',
  ring: 'ring-amber-500/30',
};

const DARK_NAVY = 'bg-[#1e3a5f]';
const SUCCESS_GREEN = 'bg-emerald-500';

/* ===================================================================
   UTILITY COMPONENTS
   =================================================================== */

const InfoRow = React.memo(function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-text break-words">{value || 'Not Available'}</div>
    </div>
  );
});

const SectionCard = React.memo(function SectionCard({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden ${className}`}
    >
      <div className="px-5 py-3.5 border-b border-border/40">
        <span className="text-sm font-bold tracking-tight">{title}</span>
      </div>
      <div className="px-5 py-4">
        {children}
      </div>
    </motion.div>
  );
});

/* ===================================================================
   BOOKING DETAILS DRAWER - Main Component
   =================================================================== */

function BookingDetailsDrawer({ booking, isOpen, onClose, onBookingUpdated }) {
  const drawerRef = useRef(null);
  const previousActiveElement = useRef(null);

  // Assign Driver state — uses the scalable picker (10k+ drivers).
  // The driver's registered vehicle is auto-associated by the backend.
  const [assignedDriver, setAssignedDriver] = useState(null);
  const [assigningDriverForBooking, setAssigningDriverForBooking] = useState(false);
  const [assignDriverError, setAssignDriverError] = useState('');
  const [assignDriverSuccess, setAssignDriverSuccess] = useState('');

// Send Quote state — final price + quote validity + remarks
  const [finalPrice, setFinalPrice] = useState('');
  const [quoteValidityHours, setQuoteValidityHours] = useState('2');
  const [quoteRemarks, setQuoteRemarks] = useState('');
  const [sendingQuote, setSendingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState('');
  const [quoteSuccess, setQuoteSuccess] = useState('');

// Quote resource selection — driver (their assigned vehicle is auto-resolved)
  const [selectedQuoteDriverId, setSelectedQuoteDriverId] = useState(null);
  const [selectedQuoteDriver, setSelectedQuoteDriver] = useState(null);
  const [selectedQuoteVehicle, setSelectedQuoteVehicle] = useState(null); // auto-resolved from driver

  // Scalable Driver Picker modal state (10k+ drivers) — server-side pagination,
  // debounced search, filters, lazy loading. Only a bounded page is ever held
  // in memory; the endpoint returns driver + assigned vehicle + trip stats.
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState('quote'); // 'assign' | 'quote'
  const [pickerDrivers, setPickerDrivers] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerStatus, setPickerStatus] = useState('');
  const [pickerVehicleType, setPickerVehicleType] = useState('');
  const [pickerPage, setPickerPage] = useState(1);
  const [pickerHasMore, setPickerHasMore] = useState(false);
  const [pickerTotal, setPickerTotal] = useState(0);
  const [pickerError, setPickerError] = useState('');
  const pickerListRef = useRef(null);
  const pickerSearchRef = useRef(null);
  const pickerPageRef = useRef(1);
  const pickerLoadingRef = useRef(false);

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
        if (showDriverPicker) {
          setShowDriverPicker(false);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose, showDriverPicker]);

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
    // Exceptional operational path — the acceptance gate is intentionally
    // removed. The NORMAL quote workflow selects the driver WITH the final
    // quote (sendQuoteWithReservation) and reserves them; customer acceptance
    // then auto-confirms driver + vehicle. This Assign Driver action is for
    // manual operational assignment and must not be blocked merely because
    // the customer has not accepted yet.
    if (['cancelled', 'completed', 'delivered'].includes(booking.status)) return false;
    return true;
  }, [booking]);

  // ===== Scalable Driver Picker (10k+ drivers) =====
  // Server-side pagination + debounced search + filters + lazy loading.
  // Only a bounded page of drivers is ever held in memory. The endpoint
  // returns each driver with its assigned vehicle + today/lifetime trip stats,
  // so the frontend never combines multiple API calls.

  const fetchPickerPage = useCallback(async (page, { search, status, vehicleType, append = false } = {}) => {
    if (pickerLoadingRef.current) return;
    pickerLoadingRef.current = true;
setPickerLoading(true);
    setPickerError('');
    try {
      const response = await adminAPI.getAssignableDrivers({
        page,
        limit: 20,
        search: search || '',
        status: status || '',
        vehicle_type: vehicleType || '',
      });
if (response.data?.success) {
        const drivers = response.data.data || [];
        const pagination = response.data.pagination || {};
        setPickerDrivers((prev) => (append ? [...prev, ...drivers] : drivers));
        setPickerTotal(pagination.total || 0);
        setPickerPage(page);
        pickerPageRef.current = page;
        setPickerHasMore(page < (pagination.pages || 1));
      } else {
        setPickerError('Failed to load drivers');
      }
    } catch (err) {
      setPickerError(err?.response?.data?.message || err?.message || 'Failed to load drivers');
    } finally {
      pickerLoadingRef.current = false;
      setPickerLoading(false);
    }
  }, []);

  // Open the scalable driver picker in 'assign' mode.
  // When a driver is selected, they are auto-assigned to the booking and
  // their registered vehicle is auto-resolved.
  const handleOpenAssignPicker = useCallback(() => {
    setPickerMode('assign');
    setShowDriverPicker(true);
    setPickerDrivers([]);
    setPickerPage(1);
    pickerPageRef.current = 1;
    setPickerError('');
    setPickerSearch('');
    setPickerStatus('');
    setPickerVehicleType('');
    setSelectedQuoteDriverId(null);
    setSelectedQuoteDriver(null);
    setSelectedQuoteVehicle(null);
    setAssignDriverError('');
    setAssignDriverSuccess('');
    // The debounced useEffect below is the single source of truth for fetching.
    // It fires when showDriverPicker changes to true, after 300ms debounce.
  }, [fetchPickerPage]);

  // Assign the selected driver to the booking (called from the picker).
  const handleAssignDriverFromPicker = useCallback(async (driver) => {
    if (!booking) return;
    setAssigningDriverForBooking(true);
    setAssignDriverError('');
    setAssignDriverSuccess('');
    try {
      const response = await adminAPI.assignDriver(booking.booking_id, driver.driver_id);
      if (response.data?.success) {
        setAssignedDriver(driver);
        setAssignDriverSuccess('Driver assigned. Vehicle auto-assigned from driver\'s registered vehicle.');
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
      } else {
        setAssignDriverError(response.data?.message || 'Failed to assign driver');
      }
    } catch (err) {
      setAssignDriverError(err?.response?.data?.message || err?.message || 'Failed to assign driver');
    } finally {
      setAssigningDriverForBooking(false);
    }
  }, [booking, onBookingUpdated]);


  // Load first page when the picker opens.
  // The debounced useEffect below is the single source of truth for fetching.
  // It fires when showDriverPicker changes to true, after 300ms debounce.
  const openDriverPicker = useCallback(() => {
    setPickerMode('quote');
    setShowDriverPicker(true);
    setPickerDrivers([]);
    setPickerPage(1);
    pickerPageRef.current = 1;
    setPickerError('');
    setPickerSearch('');
    setPickerStatus('');
    setPickerVehicleType('');
    setSelectedQuoteDriverId(null);
    setSelectedQuoteDriver(null);
    setSelectedQuoteVehicle(null);
  }, [fetchPickerPage]);

  // Debounced server-side search (300ms) — resets to page 1
  useEffect(() => {
    if (!showDriverPicker) return;
    const timer = setTimeout(() => {
      fetchPickerPage(1, { search: pickerSearch, status: pickerStatus, vehicleType: pickerVehicleType });
    }, 300);
    return () => clearTimeout(timer);
  }, [pickerSearch, pickerStatus, pickerVehicleType, showDriverPicker, fetchPickerPage]);

  // Infinite scroll — load next page when the admin scrolls near the bottom
  const handlePickerScroll = useCallback(() => {
    const el = pickerListRef.current;
    if (!el) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && pickerHasMore && !pickerLoadingRef.current) {
      fetchPickerPage(pickerPageRef.current + 1, {
        search: pickerSearch,
        status: pickerStatus,
        vehicleType: pickerVehicleType,
        append: true,
      });
    }
  }, [fetchPickerPage, pickerSearch, pickerStatus, pickerVehicleType, pickerHasMore]);

  // Lock page scroll while the picker is open
  useEffect(() => {
    if (showDriverPicker) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [showDriverPicker]);

// Select a driver from the picker.
  // In 'assign' mode (opened from Assign Driver button): auto-assign to booking.
  // In 'quote' mode (opened from Send Quote section): just set selection.
  // Business rule: One Driver = One Vehicle. The driver's vehicle is stored on
  // their profile (vehicle_type / vehicle_number at registration). The vehicle
  // is read directly from the driver — no separate assignment-table lookup.
const handleSelectPickerDriver = useCallback((driver) => {
    // SINGLE SOURCE OF TRUTH: the driver's current active vehicle is resolved
    // from the driver's own registered vehicle (stored on the Driver row at
    // registration — one-driver-one-vehicle). The "Current Vehicle" card and
    // the validation below MUST use this SAME resolved object. There is no
    // separate "Assigned Vehicle" lookup.
    const driverVehicle = driver.vehicle || (
      driver.vehicle_number
        ? { vehicle_number: driver.vehicle_number, vehicle_type: driver.vehicle_type || null }
        : null
    );

    // Defensive assertion: if the Current Vehicle is rendered, validation must
    // pass. It is impossible for both to be true simultaneously. Never silently
    // continue — fail immediately with a descriptive developer error.
    if (driverVehicle && !driverVehicle.vehicle_number) {
      throw new Error(
        '[BookingDetailsDrawer] Inconsistent driver vehicle payload: ' +
          'current vehicle resolved but vehicle_number is missing. ' +
          'The Current Vehicle card and validation must use the same source of truth.'
      );
    }

    setSelectedQuoteDriverId(driver.driver_id);
    setSelectedQuoteDriver(driver);
    setSelectedQuoteVehicle(driverVehicle);
    setQuoteError('');
    // Validate ONLY that the driver has an active vehicle linked — using the
    // SAME resolved object the UI renders (not driver.vehicle_number, which is
    // never populated at the top level of the picker payload).
    if (!driverVehicle) {
      setQuoteError('This driver does not have an active vehicle.');
    }
    if (pickerMode === 'assign') {
      // Auto-assign driver to booking and close picker.
      handleAssignDriverFromPicker(driver);
    }
    setShowDriverPicker(false);
  }, [pickerMode, handleAssignDriverFromPicker]);

  // When the drawer opens with a NEW booking, reset selection state.
  // Only reset when the booking_id actually changes, not on every booking
  // prop update (which would clear the driver selection after sending a quote).
  const previousBookingIdRef = useRef(null);
  useEffect(() => {
    if (isOpen && booking) {
      if (previousBookingIdRef.current !== booking.booking_id) {
        previousBookingIdRef.current = booking.booking_id;
        setSelectedQuoteDriverId(null);
        setSelectedQuoteDriver(null);
        setSelectedQuoteVehicle(null);
        setAssignedDriver(null);
        setAssignDriverError('');
        setAssignDriverSuccess('');
        setPickerMode('quote');
      }
    }
  }, [isOpen, booking]);

const handleSendQuote = useCallback(async () => {
    if (!booking) return;
    const price = Number(finalPrice);
    if (!finalPrice || isNaN(price) || price <= 0) {
      setQuoteError('Please enter a valid final price (₹).');
      return;
    }
    const validity = Number(quoteValidityHours);
    if (!validity || validity <= 0) {
      setQuoteError('Please enter a valid quote validity (hours).');
      return;
    }
    if (!selectedQuoteDriverId) {
       setQuoteError('Please select a driver before sending the quote.');
       return;
     }
     // Defensive assertion: if the Current Vehicle card is visible
     // (selectedQuoteDriver is set), selectedQuoteVehicle must not be null.
     // The Current Vehicle card and validation must use the same source of
     // truth. It is impossible for both to be true simultaneously:
     // ✓ Vehicle is displayed, ✗ Driver has no active vehicle.
     if (selectedQuoteDriver && !selectedQuoteVehicle) {
       throw new Error(
         '[BookingDetailsDrawer] Inconsistent state: selectedQuoteDriver is set ' +
           'but selectedQuoteVehicle is null. The Current Vehicle card and ' +
           'validation must use the same source of truth.'
       );
     }
     // Single validation path — use selectedQuoteVehicle as the one source
     // of truth. The resolved vehicle object is the same one the Current
     // Vehicle card renders (not driver.vehicle_number, which is never
     // populated at the top level of the picker payload).
     if (!selectedQuoteVehicle) {
       setQuoteError('This driver does not have an active vehicle.');
       return;
     }

    setSendingQuote(true);
    setQuoteError('');
    setQuoteSuccess('');
    try {
      const response = await adminAPI.sendQuote(booking.booking_id, {
        driver_id: selectedQuoteDriverId,
        // vehicle_id is OPTIONAL — the backend auto-resolves the driver's
        // current active vehicle. Only send it if one was explicitly resolved.
        ...(selectedQuoteVehicle.vehicle_id ? { vehicle_id: selectedQuoteVehicle.vehicle_id } : {}),
        final_price: price,
        quote_validity_hours: validity,
        remarks: quoteRemarks || null,
      });
      if (response.data?.success) {
        setQuoteSuccess('Quote sent to customer successfully.');
        if (onBookingUpdated) {
          onBookingUpdated(booking.booking_id);
        }
      } else {
        setQuoteError(response.data?.message || 'Failed to send quote');
      }
    } catch (err) {
      setQuoteError(err?.response?.data?.message || err?.message || 'Failed to send quote');
    } finally {
      setSendingQuote(false);
    }
}, [booking, finalPrice, quoteValidityHours, quoteRemarks, selectedQuoteDriverId, selectedQuoteVehicle, onBookingUpdated]);

  // Determine whether the Send Quote button should be enabled
const canSendQuote = useCallback(() => {
    if (!finalPrice || Number(finalPrice) <= 0) return false;
    if (!quoteValidityHours || Number(quoteValidityHours) <= 0) return false;
    if (!selectedQuoteDriverId) return false;
    // The vehicle must be auto-resolved from the selected driver.
    if (!selectedQuoteVehicle) return false;
    return true;
  }, [finalPrice, quoteValidityHours, selectedQuoteDriverId, selectedQuoteVehicle]);

  if (!booking) return null;

  const customerName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || '—';
  const distance = booking.estimated_distance_km ? `${booking.estimated_distance_km} km` : '—';
  const price = booking.final_price
    ? `\u20B9${Number(booking.final_price).toLocaleString()}`
    : booking.estimated_price
      ? `\u20B9${Number(booking.estimated_price).toLocaleString()} (est.)`
      : '—';

  // Brokerage model: driver + vehicle info from booking snapshots (read-only)
  const driverName = booking.driver_name_snapshot
    || `${booking.driver_first_name || ''} ${booking.driver_last_name || ''}`.trim()
    || '—';
  const driverPhone = booking.mobile_snapshot || booking.driver_phone || '—';
  const vehicleNumber = booking.truck_number_snapshot || booking.vehicle_number || '—';
  const vehicleType = booking.vehicle_type || booking.vehicle_type_required || null;
  const ownerName = booking.owner_name_snapshot || booking.partner_name_snapshot || null;
  const isDriverAssigned = !!booking.driver_id || !!booking.driver_name_snapshot || !!booking.truck_number_snapshot;

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
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Drawer */}
          <motion.div
            ref={drawerRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-[580px] bg-surface border-l border-border/60 shadow-2xl z-50 overflow-hidden flex flex-col"
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
{booking.status && <StatusBadge status={booking.status} quoteStatus={booking.quote_status} size="sm" />}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Booking ID: #{booking.booking_id}
                </div>
              </div>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={onClose}
                className="h-10 w-10 rounded-xl border border-border/60 bg-card/40 flex items-center justify-center hover:bg-hover/60 transition ml-3 shrink-0"
                aria-label="Close drawer"
              >
                <X className="w-5 h-5" strokeWidth={2} />
              </motion.button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

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

              {/* 3. QUOTE & PRICING - Send Final Quote */}
              <SectionCard title="Quote & Pricing">
                <div className="space-y-4">
                  {/* Quote status */}
                  <div className="flex items-center justify-between rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Timer className="w-4 h-4 text-amber-600" strokeWidth={2.5} />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-text uppercase tracking-wider">Quote Status</div>
                        <div className="text-xs text-muted mt-0.5">
                          {booking.quote_status || 'PENDING'}
                        </div>
                      </div>
                    </div>
                    {booking.final_price != null && (
                      <div className="text-right">
                        <div className="text-[10px] text-muted uppercase tracking-wider">Final Price</div>
                        <div className="text-sm font-bold text-amber-600">
                          ₹{Number(booking.final_price).toLocaleString('en-IN')}
                        </div>
                      </div>
                    )}
                  </div>

{/* Driver selection — opens the scalable full-screen picker (10k+ drivers) */}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Select Driver <span className="text-red-500">*</span>
                    </label>
                    {selectedQuoteDriver ? (
                      <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-text truncate">
                            {selectedQuoteDriver.driver_name || `${selectedQuoteDriver.first_name || ''} ${selectedQuoteDriver.last_name || ''}`.trim() || `Driver #${selectedQuoteDriver.driver_id}`}
                          </div>
                          <div className="text-[11px] text-muted mt-0.5 flex items-center gap-2">
                            <span>{selectedQuoteDriver.driver_code || `DRV${String(selectedQuoteDriver.driver_id).padStart(6, '0')}`}</span>
                            <span>·</span>
                            <span>{selectedQuoteDriver.mobile || '—'}</span>
                            <span className="inline-flex items-center gap-0.5">
                              <Star className="w-3 h-3 text-amber-600 fill-current" strokeWidth={0} />
                              {selectedQuoteDriver.rating ?? '—'}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={openDriverPicker}
                          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-600 text-xs font-semibold hover:bg-amber-500/20 transition"
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={openDriverPicker}
                        className="w-full px-4 py-2.5 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 text-sm font-semibold text-amber-600 hover:bg-amber-500/10 transition flex items-center justify-center gap-2"
                      >
                        <UserRound className="w-4 h-4" strokeWidth={2.5} />
                        Search &amp; Select Driver
                      </button>
                    )}
                  </div>

{/* Current vehicle — auto-resolved from the selected driver by the backend */}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Current Vehicle
                    </label>
                    {!selectedQuoteDriver ? (
                      <div className="rounded-xl border border-border/40 bg-card/40 px-4 py-2.5 text-sm text-muted">
                        Select a driver to view their current vehicle.
                      </div>
                    ) : selectedQuoteVehicle ? (
                      <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 px-4 py-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Truck className="w-4 h-4 text-amber-600 shrink-0" strokeWidth={2.5} />
                          <span className="text-sm font-bold text-text">{selectedQuoteVehicle.vehicle_number || '—'}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-muted">
                          <div>
                            <span className="block uppercase tracking-wider">Vehicle Type</span>
                            <span className="font-semibold text-text">
                              {selectedQuoteVehicle.vehicle_type ? String(selectedQuoteVehicle.vehicle_type).replace(/_/g, ' ') : '—'}
                            </span>
                          </div>
                          <div>
                            <span className="block uppercase tracking-wider">Capacity</span>
                            <span className="font-semibold text-text">
                              {selectedQuoteVehicle.capacity_kg ? `${selectedQuoteVehicle.capacity_kg} kg` : '—'}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2} />
                        <span className="text-sm text-red-700 dark:text-red-400">
                          This driver does not have an active vehicle.
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Final price input */}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Final Transport Price (₹)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-muted">₹</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={finalPrice}
                        onChange={(e) => setFinalPrice(e.target.value)}
                        placeholder="e.g. 6900"
                        className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm font-semibold text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
                      />
                    </div>
                  </div>

                  {/* Quote validity */}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Quote Validity (hours)
                    </label>
                    <select
                      value={quoteValidityHours}
                      onChange={(e) => setQuoteValidityHours(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm font-semibold text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
                    >
                      <option value="1">1 Hour</option>
                      <option value="2">2 Hours</option>
                      <option value="4">4 Hours</option>
                      <option value="8">8 Hours</option>
                      <option value="24">24 Hours</option>
                    </select>
                  </div>

                  {/* Remarks */}
                  <div>
                    <label className="block text-xs font-semibold text-text mb-1.5">
                      Remarks (optional)
                    </label>
                    <textarea
                      value={quoteRemarks}
                      onChange={(e) => setQuoteRemarks(e.target.value)}
                      placeholder="e.g. Price includes tolls and loading charges"
                      rows={2}
                      className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm font-semibold text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition resize-none"
                    />
                  </div>

                  {/* Error / Success */}
                  {quoteError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2} />
                      <span className="text-sm text-red-700 dark:text-red-400">{quoteError}</span>
                    </div>
                  )}
                  {quoteSuccess && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-4 py-2.5 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={2} />
                      <span className="text-sm text-emerald-700 dark:text-emerald-400">{quoteSuccess}</span>
                    </div>
                  )}

{/* Send quote button */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSendQuote}
                    disabled={sendingQuote || !canSendQuote()}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-amber-500/20"
                  >
                    {sendingQuote ? (
                      <>
                        <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Sending Quote...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" strokeWidth={2.5} />
                        Send Quote to Customer
                      </>
                    )}
                  </motion.button>
{!canSendQuote() && (
                    <div className="rounded-xl bg-amber-500/5 border border-amber-500/10 px-3 py-2 text-[11px] text-muted">
{!selectedQuoteDriverId && 'Select a driver to enable sending.'}
                      {selectedQuoteDriverId && !selectedQuoteVehicle && 'This driver does not have an active vehicle.'}
                      {selectedQuoteDriverId && selectedQuoteVehicle && !finalPrice && 'Enter a final price to enable sending.'}
                    </div>
                  )}
                  <p className="text-[11px] text-muted text-center">
                    Booking is NOT confirmed until the customer accepts the final quote.
                  </p>
                </div>
              </SectionCard>

              {/* 4. Booking Status + Driver/Vehicle (read-only, brokerage) */}
              <SectionCard title="Booking Status">
                <div className="flex items-center gap-3">
<StatusBadge status={booking.status} quoteStatus={booking.quote_status} size="lg" />
<div className="text-sm text-muted">
                    {(booking.status === 'pending' && (booking.quote_status || 'PENDING').toUpperCase() !== 'ACCEPTED') && 'Awaiting confirmation'}
                    {(booking.status === 'pending' && (booking.quote_status || 'PENDING').toUpperCase() === 'ACCEPTED') && 'Booking confirmed'}
                    {booking.status === 'confirmed' && 'Booking confirmed'}
                    {booking.status === 'driver_assigned' && 'Driver has been assigned'}
                    {booking.status === 'pickup_completed' && 'Goods picked up'}
                    {booking.status === 'in_transit' && 'Goods in transit'}
                    {booking.status === 'delivered' && 'Goods delivered'}
                    {booking.status === 'cancelled' && 'Booking was cancelled'}
                    {booking.status === 'completed' && 'Booking completed'}
                  </div>
                </div>

                {/* Assigned driver + vehicle (informational only, read-only) */}
                {isDriverAssigned && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                      <InfoRow label="Driver Name" value={driverName} />
                      <InfoRow label="Driver Phone" value={driverPhone} />
                      <InfoRow label="Vehicle Number" value={vehicleNumber} />
                      <InfoRow label="Vehicle Type" value={vehicleType ? String(vehicleType).replace(/_/g, ' ') : '—'} />
                      {ownerName && <InfoRow label="Transport Owner" value={ownerName} />}
                    </div>
                    <p className="text-[11px] text-muted mt-2 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" strokeWidth={2.5} />
                      Vehicle auto-assigned from the driver's registered vehicle.
                    </p>
                  </div>
                )}

{/* Assign Driver action (brokerage: admin only assigns a driver) */}
{!isDriverAssigned && canAssignDriver() && (
  <div className="mt-3 pt-3 border-t border-border/40">
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={handleOpenAssignPicker}
      disabled={assigningDriverForBooking}
      className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {assigningDriverForBooking ? (
        <>
          <div className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Assigning...
        </>
      ) : (
        <>
          <UserRound className="w-4 h-4" strokeWidth={2.5} />
          Assign Driver
        </>
      )}
    </motion.button>
    <p className="text-[11px] text-muted text-center mt-1.5">
      The driver's registered vehicle will be auto-assigned.
    </p>
    {assignDriverError && (
      <div className="mt-2 rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 flex items-center gap-2">
        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2} />
        <span className="text-sm text-red-700 dark:text-red-400">{assignDriverError}</span>
      </div>
    )}
    {assignDriverSuccess && (
      <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 dark:bg-emerald-500/10 dark:border-emerald-500/20 px-4 py-2.5 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" strokeWidth={2} />
        <span className="text-sm text-emerald-700 dark:text-emerald-400">{assignDriverSuccess}</span>
      </div>
    )}
  </div>
)}

{/* Explain why Assign Driver is disabled (terminal booking state) */}
                {!isDriverAssigned && !canAssignDriver() && (
                  <div className="mt-3 pt-3 border-t border-border/40 rounded-xl bg-amber-500/5 border border-amber-500/10 px-4 py-3">
                    <p className="text-[11px] text-muted flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" strokeWidth={2.5} />
                      <span>
                        This booking cannot accept a driver assignment in its current state.
                      </span>
                    </p>
                  </div>
                )}

                {/* Delivery status */}
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


          {/* SCALABLE DRIVER PICKER MODAL (10k+ drivers) */}
          <AnimatePresence>
            {showDriverPicker && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4"
                role="dialog"
                aria-modal="true"
                aria-label="Search & Select Driver"
              >
                {/* Backdrop */}
                <div
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                  onClick={() => setShowDriverPicker(false)}
                  aria-hidden="true"
                />

                {/* Panel */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 16 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 16 }}
                  transition={{ type: 'spring', damping: 26, stiffness: 300 }}
                  className="relative bg-white dark:bg-gray-950 border border-border/60 overflow-hidden flex flex-col w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:rounded-2xl shadow-2xl"
                >
                  {/* Header */}
                  <div className="shrink-0 px-5 py-4 border-b border-border/60 flex items-center justify-between bg-white/50 dark:bg-gray-950/50 backdrop-blur-xl">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
                        <UserRound className="w-5 h-5 text-white" strokeWidth={2.5} />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-text">Search &amp; Select Driver</h3>
                        <p className="text-xs text-muted mt-0.5">
                          {pickerTotal > 0 ? `${pickerTotal} drivers` : 'Loading drivers...'} · vehicle auto-assigned
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDriverPicker(false)}
                      className="h-9 w-9 rounded-xl border border-border/60 flex items-center justify-center hover:bg-hover/60 transition shrink-0"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4" strokeWidth={2} />
                    </button>
                  </div>

                  {/* Search + Filters */}
                  <div className="shrink-0 px-5 py-3 border-b border-border/40 space-y-2.5">
                    <div className="relative">
                      <input
                        ref={pickerSearchRef}
                        type="text"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        placeholder="Search by name, driver ID, mobile, vehicle number, vehicle type..."
                        className="w-full px-4 py-2.5 rounded-xl border border-border/60 bg-card/40 text-sm font-medium text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <select
                        value={pickerStatus}
                        onChange={(e) => setPickerStatus(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-xs font-semibold text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
                      >
                        <option value="">All Status</option>
                        <option value="available">Available</option>
                        <option value="on_trip">On Trip</option>
                        <option value="inactive">Inactive</option>
                      </select>
                      <select
                        value={pickerVehicleType}
                        onChange={(e) => setPickerVehicleType(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl border border-border/60 bg-card/40 text-xs font-semibold text-text focus:ring-2 focus:ring-amber-500/40 focus:border-transparent outline-none transition"
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

                  {/* Results list (infinite scroll) */}
                  <div
                    ref={pickerListRef}
                    onScroll={handlePickerScroll}
                    className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5 min-h-[200px]"
                  >
                    {pickerError && (
                      <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-500/10 dark:border-red-500/20 px-4 py-2.5 flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 shrink-0" strokeWidth={2} />
                        <span className="text-sm text-red-700 dark:text-red-400">{pickerError}</span>
                      </div>
                    )}

                    {!pickerError && pickerDrivers.length === 0 && !pickerLoading && (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                          <UserRound className="w-8 h-8 text-amber-600/70" strokeWidth={1.5} />
                        </div>
                        <p className="text-sm font-semibold text-text">No drivers found</p>
                        <p className="text-xs text-muted mt-1">Try adjusting your search or filters.</p>
                      </div>
                    )}

                    {pickerDrivers.map((driver) => {
                      const dName = driver.driver_name
                        || `${driver.first_name || ''} ${driver.last_name || ''}`.trim()
                        || `Driver #${driver.driver_id}`;
                      const dCode = driver.driver_code || `DRV${String(driver.driver_id).padStart(6, '0')}`;
                      const dStatus = String(driver.status || 'available').replace(/_/g, ' ');
                      const v = driver.vehicle;
                      const chosen = selectedQuoteDriverId === driver.driver_id;
                      return (
                        <button
                          key={driver.driver_id}
                          type="button"
                          onClick={() => handleSelectPickerDriver(driver)}
                          className={`w-full text-left p-4 rounded-2xl border-2 transition-all duration-200 ${
                            chosen
                              ? 'border-amber-500 bg-amber-500/5 shadow-lg'
                              : 'border-border/60 bg-card/40 hover:border-amber-500/40'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                              {dName.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-text truncate">{dName}</span>
                                <span className="text-[10px] font-semibold text-muted">{dCode}</span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-muted">
                                <span>{driver.mobile || '—'}</span>
                                <span className="text-border">•</span>
                                <span className="capitalize">{dStatus}</span>
                                <span className="text-border">•</span>
                                <span className="inline-flex items-center gap-0.5">
                                  <Star className="w-3 h-3 text-amber-600 fill-current" strokeWidth={0} />
                                  {driver.rating ?? '—'}
                                </span>
                                {typeof driver.todayTrips === 'number' && (
                                  <>
                                    <span className="text-border">•</span>
                                    <span>{driver.todayTrips} today</span>
                                  </>
                                )}
                                {typeof driver.total_deliveries === 'number' && (
                                  <>
                                    <span className="text-border">•</span>
                                    <span>{driver.total_deliveries} trips</span>
                                  </>
                                )}
                              </div>
                              {v ? (
                                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[10px] font-semibold">
                                  <Truck className="w-3 h-3" strokeWidth={2.5} />
                                  {v.vehicle_number}
                                  {v.vehicle_type ? ` · ${String(v.vehicle_type).replace(/_/g, ' ')}` : ''}
                                  {v.capacity_kg ? ` · ${v.capacity_kg} kg` : ''}
                                </div>
                              ) : (
<div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 text-[10px] font-semibold">
                                  <AlertCircle className="w-3 h-3" strokeWidth={2.5} />
                                  No vehicle
                                </div>
                              )}
                            </div>
                            <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 ${
                              chosen ? 'border-amber-500 bg-amber-500' : 'border-border'
                            }`}>
                              {chosen && <CheckCircle2 className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {pickerLoading && (
                      <div className="flex items-center justify-center py-4">
                        <div className="h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                        <span className="ml-3 text-sm text-muted">Loading drivers...</span>
                      </div>
                    )}
                    {!pickerLoading && pickerHasMore && (
                      <p className="text-center text-[11px] text-muted py-2">Scroll for more drivers...</p>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  );
}

export default BookingDetailsDrawer;

import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import StatusBadge from './StatusBadge';
import BookingTimeline from './BookingTimeline';

const InfoRow = React.memo(function InfoRow({ label, value, fullWidth }) {
  return (
    <div className={fullWidth ? 'col-span-full' : ''}>
      <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-text break-words">{value || 'Not Available'}</div>
    </div>
  );
});

const CollapsibleSection = React.memo(function CollapsibleSection({ title, defaultOpen = true, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-hover/40 transition"
        aria-expanded={isOpen}
      >
        <span className="text-sm font-semibold">{title}</span>
        <svg
          className={`w-4 h-4 text-muted transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-5 pb-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

function BookingDetailsDrawer({ booking, isOpen, onClose }) {
  const drawerRef = useRef(null);
  const previousActiveElement = useRef(null);

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
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  if (!booking) return null;

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
                  Created {booking.created_at ? new Date(booking.created_at).toLocaleString('en-IN') : '—'}
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
              {/* Booking Summary */}
              <CollapsibleSection title="Booking Summary" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Booking Reference" value={booking.booking_reference} />
                  <InfoRow label="Status" value={booking.status ? booking.status.replace(/_/g, ' ') : '—'} />
                  <InfoRow label="Created At" value={booking.created_at ? new Date(booking.created_at).toLocaleString('en-IN') : '—'} />
                  <InfoRow label="Updated At" value={booking.updated_at ? new Date(booking.updated_at).toLocaleString('en-IN') : '—'} />
                </div>
              </CollapsibleSection>

              {/* Customer Details */}
              <CollapsibleSection title="Customer Details" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Name" value={`${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim()} />
                  <InfoRow label="Phone" value={booking.customer_phone} />
                  <InfoRow label="Email" fullWidth value={booking.customer_email} />
                </div>
              </CollapsibleSection>

              {/* Pickup Information */}
              <CollapsibleSection title="Pickup Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Location" fullWidth value={booking.pickup_location || booking.pickup_address} />
                  <InfoRow label="City" value={booking.pickup_city} />
                  <InfoRow label="State" value={booking.pickup_state || 'Bihar'} />
                  <InfoRow label="Date" value={booking.pickup_date ? new Date(booking.pickup_date).toLocaleDateString('en-IN') : '—'} />
                  <InfoRow label="Time" value={booking.pickup_time} />
                </div>
              </CollapsibleSection>

              {/* Drop Information */}
              <CollapsibleSection title="Drop Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Location" fullWidth value={booking.drop_location || booking.drop_address} />
                  <InfoRow label="City" value={booking.drop_city} />
                  <InfoRow label="State" value={booking.drop_state || 'Bihar'} />
                </div>
              </CollapsibleSection>

              {/* Driver Information */}
              <CollapsibleSection title="Driver Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Driver ID" value={booking.driver_id ? `#${booking.driver_id}` : 'Not Assigned'} />
                  <InfoRow label="Driver User" value={booking.driver_user_id ? `#${booking.driver_user_id}` : '—'} />
                </div>
              </CollapsibleSection>

              {/* Vehicle Information */}
              <CollapsibleSection title="Vehicle Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Vehicle" value={booking.vehicle_name || 'Not Assigned'} />
                  <InfoRow label="Number" value={booking.vehicle_number || '—'} />
                  <InfoRow label="Type Required" value={booking.vehicle_type_required?.replace(/_/g, ' ')} />
                </div>
              </CollapsibleSection>

              {/* Goods Information */}
              <CollapsibleSection title="Goods Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Type" value={booking.goods_type} />
                  <InfoRow label="Description" fullWidth value={booking.goods_description} />
                  <InfoRow label="Weight" value={booking.goods_weight_kg ? `${booking.goods_weight_kg} kg` : '—'} />
                  <InfoRow label="Items" value={booking.number_of_items?.toString() || '—'} />
                  <InfoRow label="Fragile" value={booking.fragile ? 'Yes' : 'No'} />
                </div>
              </CollapsibleSection>

              {/* Payment Information */}
              <CollapsibleSection title="Payment Information">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-2">
                  <InfoRow label="Estimated Price" value={booking.estimated_price ? `₹${Number(booking.estimated_price).toLocaleString()}` : '—'} />
                  <InfoRow label="Final Price" value={booking.final_price ? `₹${Number(booking.final_price).toLocaleString()}` : '—'} />
                  <InfoRow label="Distance" value={booking.estimated_distance_km ? `${booking.estimated_distance_km} km` : '—'} />
                </div>
              </CollapsibleSection>

              {/* Timeline */}
              <CollapsibleSection title="Booking Timeline" defaultOpen={true}>
                <BookingTimeline booking={booking} />
              </CollapsibleSection>

              {/* Internal Notes */}
              <CollapsibleSection title="Additional Info">
                <div className="text-sm text-muted mt-2">
                  <p>Booking ID: <span className="font-mono">{booking.booking_id}</span></p>
                  {booking.cancelled_at && (
                    <p className="mt-1">Cancelled: {new Date(booking.cancelled_at).toLocaleString('en-IN')}</p>
                  )}
                  {booking.delivered_at && (
                    <p className="mt-1">Delivered: {new Date(booking.delivered_at).toLocaleString('en-IN')}</p>
                  )}
                </div>
              </CollapsibleSection>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default BookingDetailsDrawer;


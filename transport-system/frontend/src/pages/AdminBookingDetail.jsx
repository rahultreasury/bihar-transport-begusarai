import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { adminAPI } from '../services/api';
import AdminShell from '../components/admin-premium/layout/AdminShell';
import StatusBadge from '../components/admin-premium/booking/StatusBadge';
import BookingTimeline from '../components/admin-premium/booking/BookingTimeline';
import { LoadingSkeleton } from '../components/admin-premium/ui/LoadingSkeleton';

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

const formatDateTime = (value) =>
  value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const InfoRow = React.memo(function InfoRow({ label, value }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm font-semibold text-text break-words">{value || '—'}</div>
    </div>
  );
});

const SectionCard = React.memo(function SectionCard({ title, children, className = '' }) {
  return (
    <div className={`rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl overflow-hidden ${className}`}>
      <div className="px-5 py-3.5 border-b border-border/40">
        <span className="text-sm font-bold tracking-tight">{title}</span>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
});

/**
 * AdminBookingDetail
 * READ-ONLY booking detail page navigated by canonical booking number:
 *   /admin/bookings/:bookingNumber
 *
 * Operational actions (Assign Driver / Assign Vehicle / Update Status) are
 * separated into explicit buttons that open dedicated workflows — they never
 * turn this read-only view into an edit form.
 */
function AdminBookingDetail() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchBooking = useCallback(async (identifier) => {
    setLoading(true);
    setError(null);
    try {
      const response = await adminAPI.getBookingByNumber(identifier);
      if (response.data?.success) {
        setBooking(response.data.data);
      } else {
        setError(response.data?.message || 'Booking not found');
      }
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Failed to load booking');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (bookingNumber) fetchBooking(bookingNumber);
  }, [bookingNumber, fetchBooking]);

  const customerName = `${booking?.customer_first_name || ''} ${booking?.customer_last_name || ''}`.trim() || '—';
  const driverName = booking?.driver_name_snapshot
    || `${booking?.driver_first_name || ''} ${booking?.driver_last_name || ''}`.trim()
    || '—';
  const driverPhone = booking?.mobile_snapshot || booking?.driver_phone || '—';
  const vehicleNumber = booking?.truck_number_snapshot || booking?.vehicle_number || '—';
  const vehicleType = booking?.vehicle_type || booking?.vehicle_type_required || '—';
  const isDriverAssigned = !!booking?.driver_id || !!booking?.driver_name_snapshot || !!booking?.truck_number_snapshot || !!booking?.vehicle_id;
  const quote = (booking?.quote_status || 'PENDING').toUpperCase();

  const activeNav = {
    key: 'bookings',
    label: 'Bookings',
    icon: '⟐',
  };

  return (
    <AdminShell navItems={NAV_ITEMS} activeKey={activeNav.key} onNav={(k) => {}}>
      <div className="space-y-5 max-w-5xl">
        {/* Back button */}
        <button
          onClick={() => navigate('/admin/bookings')}
          className="inline-flex items-center gap-2 text-sm font-semibold text-amber-600 dark:text-amber-400 hover:underline"
          aria-label="Back to bookings"
        >
          <span aria-hidden="true">←</span> Back to bookings
        </button>

        {/* Header */}
        <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-lg shrink-0">
                B
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold tracking-tight truncate">
                    {booking?.booking_number || booking?.booking_reference || bookingNumber}
                  </h1>
                  {booking?.status && <StatusBadge status={booking.status} quoteStatus={booking.quote_status} size="sm" />}
                </div>
                <div className="text-xs text-muted mt-0.5">
                  Booking ID: #{booking?.booking_id || '—'} · Created {booking?.created_at ? formatDateTime(booking.created_at) : '—'}
                </div>
              </div>
            </div>

{/* Operational actions — clearly separated, navigate to dedicated workflows */}
            {booking && booking.booking_id && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => navigate(`/admin/bookings/${booking.booking_number || bookingNumber}/assign-driver`)}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-500 text-white text-sm font-semibold hover:bg-violet-600 transition shadow-lg shadow-violet-500/20"
                  title="Assign an available driver. The driver's registered vehicle is auto-assigned."
                >
                  <span aria-hidden="true">👤</span> Assign Driver
                </button>
                <Link
                  to={`/track/${booking.booking_number || bookingNumber}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-border/60 text-sm font-semibold hover:bg-hover/60 transition"
                  title="Open the customer tracking page for this booking"
                >
                  <span aria-hidden="true">📍</span> Track
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Error state */}
        {error && !loading && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6 text-center">
            <div className="text-red-500 font-semibold mb-2">Failed to load booking</div>
            <div className="text-sm text-muted mb-4">{error}</div>
            <button
              onClick={() => fetchBooking(bookingNumber)}
              className="px-5 py-2 rounded-xl bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="space-y-4">
            <LoadingSkeleton className="h-40 w-full" />
            <div className="grid md:grid-cols-2 gap-4">
              <LoadingSkeleton className="h-48 w-full" />
              <LoadingSkeleton className="h-48 w-full" />
            </div>
          </div>
        )}

        {!loading && !error && booking && (
          <div className="space-y-5">
            {/* Route + Summary banner */}
            <div className="rounded-2xl border border-border/60 bg-card/40 backdrop-blur-xl p-5">
              <div className="grid md:grid-cols-2 gap-6 items-center">
                <div className="space-y-4">
                  <div>
                    <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">Pickup</div>
                    <div className="text-sm font-bold">{booking.pickup_location || booking.pickup_city || '—'}</div>
                    {booking.pickup_address && <div className="text-xs text-muted mt-0.5">{booking.pickup_address}</div>}
                    {booking.pickup_date && (
                      <div className="text-xs text-muted mt-1">
                        {formatDate(booking.pickup_date)}{booking.pickup_time ? ` · ${booking.pickup_time}` : ''}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-muted">
                    <span className="w-px h-px" />
                    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">Drop</div>
                    <div className="text-sm font-bold">{booking.drop_location || booking.drop_city || '—'}</div>
                    {booking.drop_address && <div className="text-xs text-muted mt-0.5">{booking.drop_address}</div>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl bg-amber-500/5 border border-amber-500/15 p-3">
                    <div className="text-[11px] text-muted uppercase tracking-wider">Distance</div>
                    <div className="text-lg font-bold mt-1">
                      {booking.estimated_distance_km != null ? `${booking.estimated_distance_km} km` : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3">
                    <div className="text-[11px] text-muted uppercase tracking-wider">Price</div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                      {booking.final_price != null
                        ? formatINR(booking.final_price)
                        : booking.estimated_price != null
                          ? `${formatINR(booking.estimated_price)} (est.)`
                          : '—'}
                    </div>
                  </div>
                  <div className="rounded-xl bg-violet-500/5 border border-violet-500/15 p-3">
                    <div className="text-[11px] text-muted uppercase tracking-wider">Required Vehicle</div>
                    <div className="text-sm font-bold mt-1 capitalize">
                      {String(booking.vehicle_type_required || '—').replace(/_/g, ' ')}
                    </div>
                  </div>
                  <div className="rounded-xl bg-blue-500/5 border border-blue-500/15 p-3">
                    <div className="text-[11px] text-muted uppercase tracking-wider">Quote Status</div>
                    <div className="text-sm font-bold capitalize mt-1">
                      {String(quote).toLowerCase() || '—'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
              {/* Customer */}
              <SectionCard title="Customer">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Customer Name" value={customerName} />
                  <InfoRow label="Mobile" value={booking.customer_phone} />
                  <InfoRow label="Email" value={booking.customer_email} />
                </div>
              </SectionCard>

              {/* Cargo */}
              <SectionCard title="Cargo / Goods">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Goods Type" value={booking.goods_type || '—'} />
                  <InfoRow label="Description" value={booking.goods_description || '—'} />
                  <InfoRow label="Weight" value={booking.goods_weight_kg != null ? `${booking.goods_weight_kg} kg` : '—'} />
                  <InfoRow label="Items" value={booking.number_of_items != null ? String(booking.number_of_items) : '—'} />
                  {booking.fragile && <InfoRow label="Fragile" value="Yes" />}
                </div>
              </SectionCard>

              {/* Pricing */}
              <SectionCard title="Pricing">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <InfoRow label="Estimated Price" value={formatINR(booking.estimated_price)} />
                  <InfoRow label="Final Price" value={formatINR(booking.final_price)} />
                  <InfoRow label="Quote Status" value={String(quote).toLowerCase() || '—'} />
                  <InfoRow label="Confirmation" value={booking.confirmation_source || '—'} />
                </div>
                {booking.quote_remarks && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-[11px] font-medium text-muted uppercase tracking-wider mb-1">Quote Remarks</div>
                    <div className="text-sm text-text break-words">{booking.quote_remarks}</div>
                  </div>
                )}
              </SectionCard>

              {/* Assignment */}
              <SectionCard title="Assignment">
                {isDriverAssigned ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <InfoRow label="Driver Name" value={driverName} />
                    <InfoRow label="Driver Phone" value={driverPhone} />
                    <InfoRow label="Vehicle Number" value={vehicleNumber} />
                    <InfoRow label="Vehicle Type" value={String(vehicleType).replace(/_/g, ' ') || '—'} />
                    {booking.owner_name_snapshot && <InfoRow label="Transport Owner" value={booking.owner_name_snapshot} />}
                    <InfoRow label="Assigned At" value={formatDateTime(booking.driver_assigned_at)} />
                  </div>
                ) : (
                  <p className="text-sm text-muted">
                    No driver or vehicle assigned yet. Use the Assign Driver / Assign Vehicle buttons above to open the dedicated workflows.
                  </p>
                )}
              </SectionCard>

              {/* Booking timeline */}
              <SectionCard title="Booking Timeline" className="lg:col-span-2">
                <BookingTimeline booking={booking} />
              </SectionCard>
            </div>
          </div>
        )}
      </div>
    </AdminShell>
  );
}

export default AdminBookingDetail;


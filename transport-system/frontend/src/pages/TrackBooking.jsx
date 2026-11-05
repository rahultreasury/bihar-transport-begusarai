import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import { enquiryAPI } from '../services/enquiryAPI';
import SEO from '../components/seo/SEO';
import { deriveQuoteState } from '../utils/bookingUtils';
import { FALLBACK_CUSTOMER_CARE, buildCallUrl } from '../config/customerCare';

// Tracking components
import BookingHeader from '../components/tracking/BookingHeader';
import StatusCard from '../components/tracking/StatusCard';
import ProgressTimeline from '../components/tracking/ProgressTimeline';
import ActivityFeed from '../components/tracking/ActivityFeed';
import BookingDetails from '../components/tracking/BookingDetails';
import QuoteCard from '../components/tracking/QuoteCard';
import DriverVehicleCard from '../components/tracking/DriverVehicleCard';
import SupportCard from '../components/tracking/SupportCard';
import LoadingSkeleton from '../components/tracking/LoadingSkeleton';
import NotFoundCard from '../components/tracking/NotFoundCard';
import TrackingMap from '../components/tracking/TrackingMap';

/**
 * TrackBooking — Main tracking page with support for:
 *   /track                          — Search form only
 *   /track/:bookingNumber           — Auto-fetch + dashboard
 *
 * States: loading, error, notFound, empty, loaded
 */
function TrackBooking() {
  const { bookingNumber } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Search form state
  const [searchRef, setSearchRef] = useState(() => {
    try {
      return localStorage.getItem('bt_last_tracking_ref') || '';
    } catch (e) {
      return '';
    }
  });

  // Data states
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);

  /**
   * Fetch booking details from the backend.
   * Uses the public GET /api/bookings/track/:reference endpoint.
   */
   const fetchBooking = useCallback(async (ref) => {
     if (!ref || ref.trim() === '') return;

     const normalizedRef = ref.trim().replace(/^#/, '').toUpperCase();

     setLoading(true);
     setError('');
     setNotFound(false);
     setBooking(null);

     // Save last search as convenience
     try {
       localStorage.setItem('bt_last_tracking_ref', normalizedRef);
     } catch (e) {
       // ignore
     }

     try {
       // First, try to treat as enquiry (Request ID)
       try {
         const enquiryRes = await enquiryAPI.get(normalizedRef);
         if (enquiryRes?.data?.success && enquiryRes?.data?.data) {
           // It's an enquiry - navigate to enquiry confirmation page
           navigate(`/booking/enquiry/${encodeURIComponent(normalizedRef)}`);
           return;
         }
       } catch (e) {
         // Distinguish error types - only 404 means not an enquiry
         const status = e.response?.status;
         const hasResponse = !!e.response;
         if (!hasResponse) {
           // Network error - don't assume not found, surface error
           throw e;
         }
         if (status !== 404) {
           // Auth or server errors - don't assume it's a booking; throw
           throw e;
         }
         // 404 means not found as enquiry, try booking
       }

       // Try booking tracking
       let response;
       try {
         response = await bookingAPI.trackBookingByReference(normalizedRef);
       } catch (e) {
         // Only fallback on network errors or 5xx, not 404
         if (e.response?.status === 404) {
           throw e;
         }
         response = await bookingAPI.trackBooking(normalizedRef);
       }

       if (response?.data?.success && response?.data?.data) {
         setBooking(response.data.data);
       } else if (response?.data?.success === false) {
         setNotFound(true);
         setBooking(null);
       } else {
         // Unexpected shape, treat as error
         throw new Error('Unexpected response format');
       }
     } catch (err) {
       console.error('TrackBooking error:', err);
       const status = err.response?.status;
       if (status === 404) {
         setNotFound(true);
         setBooking(null);
       } else {
         setError(
           err.response?.data?.message ||
           err.message ||
           'Unable to fetch booking details. Please try again later.'
         );
         setBooking(null);
       }
     } finally {
       setLoading(false);
     }
  }, []);

  // Auto-fetch when bookingNumber is in URL
   useEffect(() => {
     if (bookingNumber) {
       const normalized = bookingNumber.replace(/^#/, '').toUpperCase();
       setSearchRef(normalized);
       fetchBooking(normalized);
     } else {
       // Reset state when on /track without a number
       setBooking(null);
       setError('');
       setNotFound(false);
       setLoading(false);
     }
   }, [bookingNumber, fetchBooking]);

  /**
   * Handle track button click from search form.
   */
  const handleTrack = (e) => {
     e.preventDefault();
     const ref = searchRef.trim();
     if (!ref) return;

     const normalizedRef = ref.replace(/^#/, '').toUpperCase();

     // Navigate to /track/:ref — this triggers the useEffect above
     navigate(`/track/${normalizedRef}`);
   };

/**
   * Handle retry on error.
   */
  const handleRetry = () => {
    if (bookingNumber) {
      fetchBooking(bookingNumber);
    }
  };

  /**
   * Accept the final quote → booking becomes confirmed.
   * Uses the PUBLIC reference-based endpoint so guest customers (no JWT)
   * can accept. After success, re-fetch the booking so the UI transitions to
   * the "Booking Confirmed" + driver/vehicle/ETA state immediately.
   */
  const handleAcceptQuote = async () => {
    if (!booking) return;
    await bookingAPI.acceptQuoteByReference(bookingNumber);
    await fetchBooking(bookingNumber);
  };

  /**
   * Reject the final quote → releases reservations, booking stays pending.
   * Uses the PUBLIC reference-based endpoint so guest customers (no JWT)
   * can reject. After success, re-fetch so the UI reflects the REJECTED state.
   */
  const handleRejectQuote = async () => {
    if (!booking) return;
    await bookingAPI.rejectQuoteByReference(bookingNumber);
    await fetchBooking(bookingNumber);
  };

  /**
   * Handle quote expiry → re-fetch so the UI reflects the EXPIRED state.
   */
  const handleQuoteExpired = () => {
    if (bookingNumber) {
      fetchBooking(bookingNumber);
    }
  };

// Derived booking state for quote-aware rendering.
  // SINGLE SOURCE OF TRUTH:
  //   - quote_status === 'SENT'            → QuoteCard (price, countdown,
  //                                           Accept/Reject). NO driver info.
  //   - booking.status === 'confirmed' (or
  //     downstream) OR quote_status === 'ACCEPTED'
  //     (backend sets status='confirmed' atomically on accept)
  //                                         → DriverVehicleCard (driver name,
  //                                           phone, vehicle, call/WhatsApp).
  // There is no artificial intermediate UI state — the backend flips the
  // booking to confirmed immediately when the customer accepts the quote.
  const { quoteStatus, status: normalizedStatus, isConfirmed, isQuoteSent, isEdgeCase } = deriveQuoteState({
    quoteStatus: booking?.quote_status,
    status: booking?.status,
    finalPrice: booking?.final_price,
  });

  // DEBUG: log the exact runtime values so we can trace why QuoteCard
  // does or does not render.
  if (booking) {
    console.log('[QUOTE DEBUG]', {
      rawQuoteStatus: booking?.quote_status,
      rawStatus: booking?.status,
      finalPrice: booking?.final_price,
      bookingNumber: booking?.booking_number,
      normalizedQuoteStatus: quoteStatus,
      normalizedStatus: normalizedStatus,
      isConfirmed,
      isQuoteSent,
      isEdgeCase,
      shouldShowQuote: isQuoteSent || isConfirmed,
    });
  }

  // ==============================
  // RENDER: SEARCH ONLY (no booking number in URL)
  // ==============================
  if (!bookingNumber) {
    return (
      <>
        <SEO
          title="Track Booking | Bihar Transport Begusarai"
          description="Track your goods transport booking with Bihar Transport Begusarai. Enter your booking reference number to get real-time status of your shipment."
          keywords="track truck booking, track delivery Bihar, goods tracking, transport tracking Begusarai, booking status"
          canonical="https://bihartransport.in/track"
        />
        {/* Hero section with homepage background image */}
        <section className="hero-gradient relative overflow-hidden" style={{ minHeight: 'calc(100vh - 72px)' }}>
          <div className="absolute inset-0 bg-gradient-to-r from-[#061F40]/90 via-[#061F40]/70 to-transparent"></div>
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl"></div>
            <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl"></div>
          </div>

          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16 lg:py-20 relative z-10 h-full flex items-center">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center w-full">
              {/* Left Column - Content */}
              <div className="space-y-6 text-white">
                <div className="inline-flex items-center px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold uppercase tracking-wider">
                  SHIPMENT TRACKING
                </div>
                <h1 className="text-3xl sm:text-4xl lg:text-5xl xl:text-6xl font-bold leading-tight">
                  Your shipment,<br />
                  <span className="text-[#FF9500]">every step of the way.</span>
                </h1>
                <p className="text-lg text-white/90 leading-relaxed max-w-xl">
                  Track your booking in real time with Bihar Transport.<br />
                  Stay updated on pickup, transit, and delivery from anywhere.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
                  <div className="flex flex-col gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">Booking Visibility</h3>
                    <p className="text-sm text-white/80">Get full visibility of your booking from enquiry to delivery.</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">Real-time Progress</h3>
                    <p className="text-sm text-white/80">Track every milestone as your shipment moves.</p>
                  </div>
                  <div className="flex flex-col gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                      <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="font-semibold text-white">Delivery Updates</h3>
                    <p className="text-sm text-white/80">Stay informed about delivery status and updates.</p>
                  </div>
                </div>
              </div>

              {/* Right Column - Search Card */}
              <div>
                <div className="tracking-card p-5 md:p-7 max-w-[520px] ml-auto">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#FF9500]/10">
                      <svg className="h-6 w-6 text-[#FF9500]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-[#061F40]">Track Your Shipment</h2>
                      <p className="text-sm text-slate-600">Enter your Request ID or Booking Reference.</p>
                    </div>
                  </div>

                  <form onSubmit={handleTrack} className="space-y-4">
                    <div>
                      <label htmlFor="bookingRef" className="block text-sm font-semibold text-slate-700 mb-1.5">
                        Request ID or Booking Reference
                      </label>
                      <div className="relative">
                        <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <input
                          id="bookingRef"
                          type="text"
                          value={searchRef}
                          onChange={(e) => setSearchRef(e.target.value.toUpperCase())}
                          placeholder="e.g. BTB-2026-00001 or BTB-20261016-015551"
                          className="w-full pl-10 pr-10 py-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-[#FF9500] focus:border-transparent outline-none transition-all bg-white text-slate-900 text-base font-mono"
                          autoFocus
                          autoComplete="off"
                        />
                        {searchRef && (
                          <button
                            type="button"
                            onClick={() => setSearchRef('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                            aria-label="Clear"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5">
                        Enter the booking reference you received after booking.
                      </p>
                    </div>

                    <button
                      type="submit"
                      disabled={!searchRef.trim() || loading}
                      className="w-full py-3.5 bg-[#FF9500] text-white rounded-xl font-semibold hover:bg-[#FF9500]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer text-base flex items-center justify-center gap-2"
                    >
                      {loading ? (
                        <>
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          Searching...
                        </>
                      ) : (
                        <>
                          Track Shipment
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </>
                      )}
                    </button>

                    <div className="relative flex items-center py-2">
                      <div className="flex-grow border-t border-slate-200"></div>
                      <span className="flex-shrink mx-4 text-xs text-slate-400">OR</span>
                      <div className="flex-grow border-t border-slate-200"></div>
                    </div>

                    <a
                      href="/book-transport"
                      className="w-full py-3 border border-[#FF9500] text-[#FF9500] rounded-xl font-semibold hover:bg-[#FF9500]/5 transition-colors cursor-pointer text-base flex items-center justify-center gap-2"
                    >
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Don&apos;t have a booking? Book Transport →
                    </a>
                  </form>

                  <div className="mt-6 pt-6 border-t border-slate-100 flex items-center justify-center gap-2 text-sm text-slate-600">
                    <svg className="h-4 w-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    <span>Need help? Call us at</span>
                    <a
                      href={buildCallUrl(FALLBACK_CUSTOMER_CARE)}
                      className="text-[#FF9500] font-medium hover:text-[#FF9500]/90"
                    >
                      +91 8210 931 799
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </>
    );
  }

  // ==============================
  // RENDER: LOADING STATE
  // ==============================
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7F8FA]">
        <LoadingSkeleton />
      </div>
    );
  }

  // ==============================
  // RENDER: ERROR STATE
  // ==============================
  if (error) {
    return (
      <div className="min-h-screen bg-[#F7F8FA]">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 md:py-24">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 md:p-8 text-center shadow-sm">
            <div className="flex justify-center mb-4">
              <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>
            <h2 className="text-lg font-bold text-[#14284B] mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-600 mb-6">{error}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#F59E0B] text-white rounded-xl font-semibold hover:bg-[#F59E0B]/90 transition-colors shadow-sm cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
              </button>
              <a
                href="/track"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-slate-300 text-slate-700 rounded-xl font-semibold hover:bg-slate-50 transition-colors cursor-pointer"
              >
                New Search
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ==============================
  // RENDER: NOT FOUND
  // ==============================
  if (notFound) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 md:py-24">
          <NotFoundCard bookingRef={bookingNumber} onRetry={handleRetry} />
        </div>
      </div>
    );
  }

  // ==============================
  // RENDER: BOOKING DASHBOARD
  // ==============================
  if (!booking) {
    // Safety: if loading finished but booking is null, show error state
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 md:py-24">
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-6 md:p-8 text-center">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Unable to load booking</h2>
            <p className="text-sm text-gray-600 mb-6">The booking data could not be loaded. Please try again.</p>
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors shadow-sm cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      return new Date(dateStr).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-8 space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
          <a href="/" className="hover:text-[#FF9500] transition-colors">Home</a>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <a href="/track" className="hover:text-[#FF9500] transition-colors">Track</a>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-[#061F40] font-medium truncate max-w-[200px] font-mono">
            {booking.booking_reference}
          </span>
        </nav>

        {/* Enquiry success banner */}
        {location.state?.message && (
          <div className="rounded-2xl bg-emerald-50 border-2 border-emerald-200 p-4 md:p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-bold text-emerald-800">{location.state.message}</h3>
                <p className="text-sm text-emerald-700 mt-1">
                  Enquiry ID: <span className="font-mono font-semibold">{booking.booking_reference}</span>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Premium Booking Summary Hero */}
        <div className="rounded-3xl bg-gradient-to-br from-[#061F40] via-[#0f3d7d] to-[#061F40] p-6 md:p-8 text-white shadow-xl border border-white/10 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,149,0,0.15),transparent_70%)]"></div>
          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-6">
              <div>
                <div className="flex items-center gap-3 mb-3 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm uppercase tracking-wider">
                    {isConfirmed ? (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                        Booking Confirmed
                      </>
                    ) : (
                      <>
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                        {quoteStatus === 'SENT' ? 'Quote Awaiting Approval' : 'Tracking Active'}
                      </>
                    )}
                  </span>
                  <span className="text-sm text-white/70 font-mono">{booking.booking_reference}</span>
                </div>
                <h1 className="text-2xl md:text-3xl lg:text-4xl font-bold leading-tight">
                  {booking.customer_first_name ? `${booking.customer_first_name} ${booking.customer_last_name || ''}` : 'Shipment Tracking'}
                </h1>
                <p className="text-white/80 mt-2 text-sm md:text-base">
                  Pickup • Transit • Delivery
                </p>
              </div>
              <div className="flex flex-col items-start lg:items-end gap-2">
                <div className="text-right">
                  <p className="text-white/70 text-xs uppercase tracking-wider">Booking Date</p>
                  <p className="text-lg font-semibold">{formatDate(booking.created_at)}</p>
                </div>
                {booking.final_price != null && (
                  <div className="text-right">
                    <p className="text-white/70 text-xs uppercase tracking-wider">Total Cost</p>
                    <p className="text-2xl md:text-3xl font-bold text-[#FF9500]">
                      ₹{Number(booking.final_price).toLocaleString('en-IN')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4 border border-white/10">
                <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Pickup</p>
                <p className="text-sm md:text-base font-semibold truncate">{booking.pickup_city || booking.pickup_location || '—'}</p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4 border border-white/10">
                <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Destination</p>
                <p className="text-sm md:text-base font-semibold truncate">{booking.drop_city || booking.drop_location || '—'}</p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4 border border-white/10">
                <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Vehicle Type</p>
                <p className="text-sm md:text-base font-semibold capitalize">
                  {booking.vehicle_type_required?.replace(/_/g, ' ') || booking.vehicle_type?.replace(/_/g, ' ') || '—'}
                </p>
              </div>
              <div className="rounded-2xl bg-white/10 backdrop-blur-sm p-4 border border-white/10">
                <p className="text-white/70 text-xs uppercase tracking-wider mb-1">Status</p>
                <p className="text-sm md:text-base font-semibold capitalize truncate">
                  {String(booking.status || '').replace(/_/g, ' ')}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Main Dashboard Layout - Two Column */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left Column - ~64% */}
          <div className="lg:col-span-3 space-y-6">
            {/* Quote/Driver Card */}
            {(isQuoteSent || isConfirmed) && (
              <div className="animate-fade-in-down" style={{ animationDuration: '0.4s' }}>
                {isQuoteSent ? (
                  <QuoteCard
                    booking={booking}
                    onAccept={handleAcceptQuote}
                    onReject={handleRejectQuote}
                    onExpired={handleQuoteExpired}
                    isEdgeCase={isEdgeCase}
                  />
                ) : (
                  <DriverVehicleCard booking={booking} />
                )}
              </div>
            )}

            {/* Status Card */}
            <div className="animate-fade-in-down" style={{ animationDuration: '0.4s', animationDelay: '0.05s' }}>
              <StatusCard
                status={booking.status}
                quoteStatus={booking.quote_status}
                pickupDate={booking.pickup_date}
                updatedAt={booking.updated_at}
              />
            </div>

            {/* Progress Timeline & Activity Feed */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="animate-fade-in-down" style={{ animationDuration: '0.4s', animationDelay: '0.1s' }}>
                <ProgressTimeline status={booking.status} quoteStatus={booking.quote_status} />
              </div>
              <div className="animate-fade-in-down" style={{ animationDuration: '0.4s', animationDelay: '0.15s' }}>
                <ActivityFeed
                  events={booking.bookingEvents}
                  status={booking.status}
                  quoteStatus={booking.quote_status}
                  createdAt={booking.created_at}
                  updatedAt={booking.updated_at}
                />
              </div>
            </div>

            {/* Booking Details */}
            <div className="animate-fade-in-down" style={{ animationDuration: '0.4s', animationDelay: '0.2s' }}>
              <BookingDetails booking={booking} />
            </div>

            {/* Support Card */}
            <div className="animate-fade-in-down" style={{ animationDuration: '0.4s', animationDelay: '0.25s' }}>
              <SupportCard bookingRef={booking.booking_reference} />
            </div>
          </div>

          {/* Right Column - Map ~36% */}
          <div className="lg:col-span-2 space-y-6">
            <div className="animate-fade-in-down sticky top-6" style={{ animationDuration: '0.4s', animationDelay: '0.1s' }}>
              <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
                <div className="p-4 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-[#061F40] uppercase tracking-wider flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#FF9500]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                    </svg>
                    Live Tracking Map
                  </h3>
                </div>
                <div className="h-[600px] lg:h-[calc(100vh-200px)] max-h-[800px] relative">
                  <TrackingMap booking={booking} />
                </div>
              </div>

              {/* Route Summary Card */}
              <div className="mt-6 rounded-2xl bg-white border border-slate-200 shadow-sm p-5">
                <h3 className="text-sm font-semibold text-[#061F40] uppercase tracking-wider mb-4">Route Details</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">Pickup Location</p>
                      <p className="text-sm font-medium text-slate-900 break-words">
                        {booking.pickup_address || booking.pickup_location || booking.pickup_city || '—'}
                      </p>
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <svg className="h-6 w-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-slate-500">Destination Location</p>
                      <p className="text-sm font-medium text-slate-900 break-words">
                        {booking.drop_address || booking.drop_location || booking.drop_city || '—'}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TrackBooking;


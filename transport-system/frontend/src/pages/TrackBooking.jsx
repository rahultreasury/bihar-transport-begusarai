import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import SEO from '../components/seo/SEO';

// Tracking components
import BookingHeader from '../components/tracking/BookingHeader';
import StatusCard from '../components/tracking/StatusCard';
import ProgressTimeline from '../components/tracking/ProgressTimeline';
import ActivityFeed from '../components/tracking/ActivityFeed';
import BookingDetails from '../components/tracking/BookingDetails';
import SupportCard from '../components/tracking/SupportCard';
import LoadingSkeleton from '../components/tracking/LoadingSkeleton';
import NotFoundCard from '../components/tracking/NotFoundCard';

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

  // Search form state
  const [searchRef, setSearchRef] = useState('');

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

    setLoading(true);
    setError('');
    setNotFound(false);
    setBooking(null);

    try {
      const response = await bookingAPI.trackBooking(ref.trim());

      if (response.data.success && response.data.data) {
        setBooking(response.data.data);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setNotFound(true);
      } else {
        setError(
          err.response?.data?.message ||
          'Unable to fetch booking details. Please try again later.'
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when bookingNumber is in URL
  useEffect(() => {
    if (bookingNumber) {
      setSearchRef(bookingNumber);
      fetchBooking(bookingNumber);
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

    // Navigate to /track/:ref — this triggers the useEffect above
    navigate(`/track/${ref.toUpperCase()}`);
  };

  /**
   * Handle retry on error.
   */
  const handleRetry = () => {
    if (bookingNumber) {
      fetchBooking(bookingNumber);
    }
  };

  // ==============================
  // RENDER: SEARCH ONLY (no booking number in URL)
  // ==============================
  if (!bookingNumber) {
    return (
      <>
        <SEO
          title="Track Booking"
          description="Track your goods transport booking with Bihar Transport. Enter your booking reference number to get real-time status of your shipment."
          keywords="track truck booking, track delivery Bihar, goods tracking, transport tracking Begusarai, booking status"
          canonical="https://bihartransport.com/track"
        />
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 md:py-24">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-2xl bg-amber-100 flex items-center justify-center">
                <svg className="h-8 w-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              Track Your Booking
            </h1>
            <p className="text-gray-500 text-sm md:text-base">
              Enter your booking reference number to track your shipment.
            </p>
          </div>

          {/* Search Form */}
          <form onSubmit={handleTrack} className="space-y-4">
            <div>
              <label htmlFor="bookingRef" className="block text-sm font-medium text-gray-700 mb-1.5">
                Booking Reference
              </label>
              <input
                id="bookingRef"
                type="text"
                value={searchRef}
                onChange={(e) => setSearchRef(e.target.value.toUpperCase())}
                placeholder="e.g. BT-20260723-000125"
                className="w-full px-4 py-3.5 border border-gray-300 rounded-xl focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-900 text-base"
                autoFocus
                autoComplete="off"
              />
              <p className="text-xs text-gray-400 mt-1.5">
                Enter the booking reference you received after booking.
              </p>
            </div>

            <button
              type="submit"
              disabled={!searchRef.trim() || loading}
              className="w-full py-3.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer text-base"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Searching...
                </span>
              ) : (
                'Track Booking'
              )}
            </button>

            {/* Quick links */}
            <div className="text-center">
              <a
                href="/book-transport"
                className="text-sm text-amber-600 hover:text-amber-700 font-medium transition-colors"
              >
                Don&apos;t have a booking? Book Transport →
              </a>
            </div>
          </form>

          {/* Support snippet */}
          <div className="mt-10 text-center">
            <p className="text-xs text-gray-400">
              Need help? Call us at{' '}
              <a href="tel:+918210931799" className="text-amber-600 font-medium hover:text-amber-700">
                +91 8210 931 799
              </a>
            </p>
          </div>
        </div>
      </div>
    </>
  );
  }

  // ==============================
  // RENDER: LOADING STATE
  // ==============================
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <LoadingSkeleton />
      </div>
    );
  }

  // ==============================
  // RENDER: ERROR STATE
  // ==============================
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-lg mx-auto px-4 sm:px-6 py-16 md:py-24">
          <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-6 md:p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center">
                <svg className="h-7 w-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h2>
            <p className="text-sm text-gray-600 mb-6">{error}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={handleRetry}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors shadow-sm cursor-pointer"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Retry
              </button>
              <a
                href="/track"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors cursor-pointer"
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
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 md:py-10 space-y-5 md:space-y-6">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-gray-500">
          <a href="/" className="hover:text-amber-600 transition-colors">Home</a>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <a href="/track" className="hover:text-amber-600 transition-colors">Track</a>
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-gray-900 font-medium truncate max-w-[140px]">
            {booking.booking_reference}
          </span>
        </nav>

        {/* Booking Header — animated entrance */}
        <div className="animate-fade-in-down" style={{ animationDuration: '0.4s' }}>
          <BookingHeader booking={booking} />
        </div>

        {/* Current Status Card */}
        <div className="animate-fade-in-down" style={{ animationDuration: '0.5s', animationDelay: '0.1s' }}>
          <StatusCard
            status={booking.status}
            pickupDate={booking.pickup_date}
            updatedAt={booking.updated_at}
          />
        </div>

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6">
          {/* Progress Timeline */}
          <div className="animate-fade-in-down" style={{ animationDuration: '0.5s', animationDelay: '0.2s' }}>
            <ProgressTimeline status={booking.status} />
          </div>

          {/* Activity Feed */}
          <div className="animate-fade-in-down" style={{ animationDuration: '0.5s', animationDelay: '0.25s' }}>
            <ActivityFeed
              status={booking.status}
              createdAt={booking.created_at}
              updatedAt={booking.updated_at}
            />
          </div>
        </div>

        {/* Booking Details */}
        <div className="animate-fade-in-down" style={{ animationDuration: '0.5s', animationDelay: '0.3s' }}>
          <BookingDetails booking={booking} />
        </div>

        {/* Support Card */}
        <div className="animate-fade-in-down" style={{ animationDuration: '0.5s', animationDelay: '0.35s' }}>
          <SupportCard bookingRef={booking.booking_reference} />
        </div>
      </div>
    </div>
  );
}

export default TrackBooking;


import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { bookingAPI } from '../services/api';
import { LiveTrackingMap } from '../components/MapComponents';

function DeliveryTracking() {
  const [searchParams] = useSearchParams();
  const [trackingRef, setTrackingRef] = useState(searchParams.get('ref') || '');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [driverLocation, setDriverLocation] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const handleTrack = async (e) => {
    e.preventDefault();
    if (!trackingRef) return;

    setLoading(true);
    setError('');
    setBooking(null);
    setDriverLocation(null);

    try {
      const response = await bookingAPI.trackBooking(trackingRef);
      if (response.data.success) {
        setBooking(response.data.data);
        // Set initial driver location if available
        if (response.data.data.current_latitude && response.data.data.current_longitude) {
          setDriverLocation({
            lat: response.data.data.current_latitude,
            lng: response.data.data.current_longitude
          });
          setLastUpdate(new Date());
        }
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Booking not found');
    } finally {
      setLoading(false);
    }
  };

  // Simulate live tracking updates (in production, use WebSocket or polling)
  useEffect(() => {
    if (!booking || !booking.driver) return;

    const interval = setInterval(async () => {
      try {
        // In production, this would fetch real-time location from the server
        // For demo, we'll simulate movement
        const response = await bookingAPI.trackBooking(trackingRef);
        if (response.data.success && response.data.data) {
          const data = response.data.data;
          if (data.current_latitude && data.current_longitude) {
            setDriverLocation({
              lat: parseFloat(data.current_latitude),
              lng: parseFloat(data.current_longitude)
            });
            setLastUpdate(new Date());
          }
        }
      } catch (err) {
        console.error('Error updating location:', err);
      }
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [booking, trackingRef]);

  const getStatusStep = (status) => {
    const steps = {
      'pending': 0,
      'confirmed': 1,
      'driver_assigned': 2,
      'pickup_completed': 3,
      'in_transit': 4,
      'delivered': 5,
      'completed': 5
    };
    return steps[status] || 0;
  };

  const statusSteps = [
    { key: 'pending', label: 'Booking Created', icon: '📋' },
    { key: 'confirmed', label: 'Confirmed', icon: '✅' },
    { key: 'driver_assigned', label: 'Driver Assigned', icon: '👨‍💼' },
    { key: 'pickup_completed', label: 'Pickup Completed', icon: '📦' },
    { key: 'in_transit', label: 'In Transit', icon: '🚚' },
    { key: 'delivered', label: 'Delivered', icon: '🏁' }
  ];

  const currentStep = booking ? getStatusStep(booking.status) : 0;

  // Calculate mock locations for demo (in production, use real coordinates)
  const getMockLocation = (city, isPickup = true) => {
    const locations = {
      'Begusarai': { lat: 25.4200, lng: 85.9900 },
      'Patna': { lat: 25.5941, lng: 85.1376 },
      'Muzaffarpur': { lat: 26.1225, lng: 85.3905 },
      'Gaya': { lat: 24.7969, lng: 85.0078 },
      'Darbhanga': { lat: 26.2704, lng: 85.9014 },
      'Bhagalpur': { lat: 25.2435, lng: 86.9918 },
      'Purnia': { lat: 25.4939, lng: 87.4752 },
      'Arrah': { lat: 25.5552, lng: 84.6638 }
    };
    return locations[city] || { lat: 25.6200, lng: 85.8900 };
  };

  const pickupCoords = booking?.pickup_city ? getMockLocation(booking.pickup_city, true) : null;
  const dropCoords = booking?.drop_city ? getMockLocation(booking.drop_city, false) : null;

  // For demo: simulate driver location between pickup and drop
  const demoDriverLocation = (() => {
    if (!pickupCoords || !dropCoords || currentStep < 4) return null;
    const progress = 0.6; // 60% of the way
    return {
      lat: pickupCoords.lat + (dropCoords.lat - pickupCoords.lat) * progress,
      lng: pickupCoords.lng + (dropCoords.lng - pickupCoords.lng) * progress
    };
  })();

  const displayDriverLocation = driverLocation || demoDriverLocation;

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Track Your Delivery</h1>
          <p className="text-gray-600">Enter your booking reference to track your shipment</p>
        </div>

        {/* Search Form */}
        <div className="card mb-8">
          <form onSubmit={handleTrack} className="flex flex-col md:flex-row gap-4">
            <input
              type="text"
              value={trackingRef}
              onChange={(e) => setTrackingRef(e.target.value.toUpperCase())}
              placeholder="Enter Booking Reference (e.g., BTB-XXXX)"
              className="input-field flex-1"
            />
            <button
              type="submit"
              disabled={loading || !trackingRef}
              className="btn-primary disabled:opacity-50"
            >
              {loading ? 'Tracking...' : 'Track'}
            </button>
          </form>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Tracking Result */}
        {booking && (
          <div className="space-y-6">
            {/* Booking Info */}
            <div className="card">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-amber-500">{booking.booking_reference}</h2>
                  <p className="text-gray-600">{booking.goods_description}</p>
                </div>
                <div className="mt-4 md:mt-0 flex items-center gap-2">
                  {displayDriverLocation && currentStep >= 2 && (
                    <span className="flex items-center text-green-600 text-sm">
                      <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></span>
                      Live Tracking
                    </span>
                  )}
                  <span className={`badge ${
                    booking.status === 'delivered' || booking.status === 'completed' ? 'badge-delivered' :
                    booking.status === 'in_transit' ? 'badge-in-transit' :
                    booking.status === 'cancelled' ? 'badge-cancelled' : 'badge-pending'
                  }`}>
                    {booking.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 block">From</span>
                  <span className="font-medium">{booking.pickup_city}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">To</span>
                  <span className="font-medium">{booking.drop_city}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Pickup Date</span>
                  <span className="font-medium">{new Date(booking.pickup_date).toLocaleDateString()}</span>
                </div>
                <div>
                  <span className="text-gray-500 block">Est. Price</span>
                  <span className="font-medium">₹{booking.estimated_price}</span>
                </div>
              </div>
            </div>

            {/* Live Tracking Map - Show when in transit */}
            {currentStep >= 2 && (pickupCoords || dropCoords) && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold flex items-center">
                    <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></span>
                    Live Tracking
                  </h3>
                  {lastUpdate && (
                    <span className="text-sm text-gray-500">
                      Last updated: {lastUpdate.toLocaleTimeString()}
                    </span>
                  )}
                </div>
                
                <LiveTrackingMap 
                  driverLocation={displayDriverLocation}
                  pickupLocation={pickupCoords}
                  dropLocation={dropCoords}
                />

                {/* Route Info */}
                <div className="mt-4 grid grid-cols-3 gap-4 text-center">
                  <div className="p-3 bg-green-50 rounded-lg">
                    <div className="text-green-600 font-semibold">A</div>
                    <div className="text-sm text-gray-600">{booking.pickup_city}</div>
                    <div className="text-xs text-gray-400">Pickup</div>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <div className="text-amber-600 font-semibold">🚚</div>
                    <div className="text-sm text-gray-600">
                      {currentStep >= 4 ? 'In Transit' : 'Driver Assigned'}
                    </div>
                    <div className="text-xs text-gray-400">
                      {booking.vehicle_number || 'Assigning...'}
                    </div>
                  </div>
                  <div className="p-3 bg-red-50 rounded-lg">
                    <div className="text-red-600 font-semibold">B</div>
                    <div className="text-sm text-gray-600">{booking.drop_city}</div>
                    <div className="text-xs text-gray-400">Destination</div>
                  </div>
                </div>
              </div>
            )}

            {/* Timeline */}
            <div className="card">
              <h3 className="text-lg font-semibold mb-6">Delivery Status</h3>
              <div className="relative">
                {/* Progress Line */}
                <div className="absolute top-6 left-0 right-0 h-1 bg-gray-200">
                  <div 
                    className="h-full bg-amber-500 transition-all duration-500"
                    style={{ width: `${(currentStep / 5) * 100}%` }}
                  ></div>
                </div>

                {/* Steps */}
                <div className="flex justify-between relative">
                  {statusSteps.map((step, index) => (
                    <div key={step.key} className="flex flex-col items-center">
                      <div 
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-xl z-10 ${
                          index <= currentStep 
                            ? 'bg-amber-500 text-white' 
                            : 'bg-gray-200 text-gray-400'
                        }`}
                      >
                        {index <= currentStep ? step.icon : '⭕'}
                      </div>
                      <p className={`mt-2 text-xs text-center ${index <= currentStep ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                        {step.label}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Driver Info (if assigned) */}
            {booking.driver && (
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Driver Information</h3>
                <div className="flex items-center">
                  <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center text-white text-2xl font-bold">
                    {booking.driver.first_name?.[0]}
                  </div>
                  <div className="ml-4">
                    <p className="font-semibold text-lg">
                      {booking.driver.first_name} {booking.driver.last_name}
                    </p>
                    <div className="flex items-center gap-4 text-gray-600">
                      <span>⭐ Rating: {booking.driver.rating || 'N/A'}</span>
                      <span>📦 Deliveries: {booking.driver.total_deliveries || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Vehicle Info (if assigned) */}
            {booking.vehicle_number && (
              <div className="card">
                <h3 className="text-lg font-semibold mb-4">Vehicle Details</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500 block">Vehicle</span>
                    <span className="font-medium">{booking.vehicle_name || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Number</span>
                    <span className="font-medium">{booking.vehicle_number}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Type</span>
                    <span className="font-medium capitalize">{booking.vehicle_type || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500 block">Est. Delivery</span>
                    <span className="font-medium">
                      {booking.estimated_delivery_time 
                        ? new Date(booking.estimated_delivery_time).toLocaleString() 
                        : 'Calculating...'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default DeliveryTracking;


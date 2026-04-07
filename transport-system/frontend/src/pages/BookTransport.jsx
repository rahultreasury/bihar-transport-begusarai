import { useState, useContext, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, StandaloneSearchBox } from '@react-google-maps/api';
import { AuthContext } from '../App';
import { bookingAPI } from '../services/api';

// Bihar region center coordinates
const BIHAR_CENTER = { lat: 25.6200, lng: 85.8900 };

// Google Maps configuration
const libraries = ['places', 'geometry', 'distanceMatrix'];

function BookTransport() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const vehicleParam = searchParams.get('vehicle') || '';

  // Google Maps API loader
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: apiKey,
    libraries: apiKey && apiKey.length > 10 ? libraries : [],
  });
  const hasApiKey = apiKey && apiKey.length > 10;

  // Map locations state
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropLocation, setDropLocation] = useState(null);
  const [calculatedDistance, setCalculatedDistance] = useState(0);
  const [calculatingRoute, setCalculatingRoute] = useState(false);
  
  // Price estimation states
  const [distance, setDistance] = useState(0);
  const [estimatedPrice, setEstimatedPrice] = useState(0);
  const [loadingPrice, setLoadingPrice] = useState(false);

  // Search box refs
  const [pickupSearchBox, setPickupSearchBox] = useState(null);
  const [dropSearchBox, setDropSearchBox] = useState(null);

  const [formData, setFormData] = useState({
    pickup_location: '',
    pickup_address: '',
    pickup_city: 'Begusarai',
    pickup_date: '',
    pickup_time: '',
    drop_location: '',
    drop_address: '',
    drop_city: '',
    goods_description: '',
    goods_type: '',
    goods_weight_kg: '',
    number_of_items: 1,
    fragile: false,
    vehicle_type_required: vehicleParam || 'truck'
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

// City distance estimation (ACTUAL road distances between Bihar cities in km)
  // Updated to reflect real road distances
  const cityDistances = {
    'Begusarai-Patna': 185, 'Begusarai-Muzaffarpur': 95, 'Begusarai-Gaya': 180,
    'Begusarai-Darbhanga': 110, 'Begusarai-Bhagalpur': 130, 'Begusarai-Purnia': 145,
    'Patna-Muzaffarpur': 105, 'Patna-Gaya': 95, 'Patna-Darbhanga': 165,
    'Patna-Bhagalpur': 240, 'Patna-Purnia': 310, 'Muzaffarpur-Gaya': 190,
    'Muzaffarpur-Darbhanga': 65, 'Muzaffarpur-Bhagalpur': 245, 'Muzaffarpur-Purnia': 225,
    'Gaya-Darbhanga': 165, 'Gaya-Bhagalpur': 320, 'Gaya-Purnia': 380,
    'Darbhanga-Bhagalpur': 210, 'Darbhanga-Purnia': 165, 'Bhagalpur-Purnia': 95
  };

// Get distance between two cities
  const getEstimatedDistance = (city1, city2) => {
    if (!city1 || !city2 || city1 === city2) return 10;
    const key1 = `${city1}-${city2}`;
    const key2 = `${city2}-${city1}`;
    return cityDistances[key1] || cityDistances[key2] || 50;
  };

  // Calculate price based on distance and vehicle type
  const calculateEstimatedPrice = (dist, vType) => {
    const rates = {
      'truck': 25,      // ₹25 per km
      'mini_truck': 15, // ₹15 per km
      'pickup': 12,     // ₹12 per km
      'tempo': 18,      // ₹18 per km
      'lorry': 25       // ₹25 per km
    };
    const rate = rates[vType] || rates['pickup'];
    return Math.round(dist * rate);
  };

  // Calculate distance using Google Distance Matrix API
  const calculateDistanceFromGoogle = useCallback(async (origin, destination) => {
    if (!hasApiKey || !isLoaded || !origin?.lat || !destination?.lat) {
      return null;
    }

    setCalculatingRoute(true);
    try {
      const service = new window.google.maps.DistanceMatrixService();
      
      const results = await new Promise((resolve, reject) => {
        service.getDistanceMatrix(
          {
            origins: [new window.google.maps.LatLng(origin.lat, origin.lng)],
            destinations: [new window.google.maps.LatLng(destination.lat, destination.lng)],
            travelMode: window.google.maps.TravelMode.DRIVING,
            unitSystem: window.google.maps.UnitSystem.METRIC,
          },
          (response, status) => {
            if (status === window.google.maps.DistanceMatrixStatus.OK) {
              resolve(response);
            } else {
              reject(new Error(`Distance Matrix failed: ${status}`));
            }
          }
        );
      });

      if (results.rows[0].elements[0].status === 'OK') {
        const distValue = results.rows[0].elements[0].distance.value;
        return distValue / 1000; // Convert to km
      }
      return null;
    } catch (err) {
      console.error('Distance calculation error:', err);
      return null;
    } finally {
      setCalculatingRoute(false);
    }
  }, [hasApiKey, isLoaded]);

  // Calculate route using Google Directions API
  const [directions, setDirections] = useState(null);

  const calculateRoute = useCallback(() => {
    if (!hasApiKey || !isLoaded || !pickupLocation?.lat || !dropLocation?.lat) {
      return;
    }

    setCalculatingRoute(true);
    const directionsService = new window.google.maps.DirectionsService();
    directionsService.route(
      {
        origin: { lat: pickupLocation.lat, lng: pickupLocation.lng },
        destination: { lat: dropLocation.lat, lng: dropLocation.lng },
        travelMode: window.google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === window.google.maps.DirectionsStatus.OK) {
          setDirections(result);
          if (result.routes[0] && result.routes[0].legs[0]) {
            const dist = result.routes[0].legs[0].distance.value / 1000;
            setCalculatedDistance(Math.round(dist));
            const price = calculateEstimatedPrice(dist, formData.vehicle_type_required);
            setEstimatedPrice(price);
          }
        }
        setCalculatingRoute(false);
      }
    );
  }, [pickupLocation, dropLocation, hasApiKey, isLoaded, formData.vehicle_type_required]);

  // Auto-calculate route when both locations are selected
  useEffect(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      calculateRoute();
    }
  }, [pickupLocation, dropLocation, calculateRoute]);

  // Update price when vehicle type changes
  useEffect(() => {
    if (calculatedDistance > 0) {
      const price = calculateEstimatedPrice(calculatedDistance, formData.vehicle_type_required);
      setEstimatedPrice(price);
    } else if (formData.pickup_city && formData.drop_city) {
      const dist = getEstimatedDistance(formData.pickup_city, formData.drop_city);
      setDistance(dist);
      const price = calculateEstimatedPrice(dist, formData.vehicle_type_required);
      setEstimatedPrice(price);
    }
  }, [formData.vehicle_type_required, formData.pickup_city, formData.drop_city, calculatedDistance]);

  // Handle pickup location search
  const onPickupLoad = useCallback((ref) => {
    setPickupSearchBox(ref);
  }, []);

  const onPickupPlacesChanged = useCallback(() => {
    if (pickupSearchBox) {
      const places = pickupSearchBox.getPlaces();
      if (places && places.length > 0) {
        const place = places[0];
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          address: place.formatted_address,
          name: place.name,
        };
        setPickupLocation(location);
        setFormData(prev => ({
          ...prev,
          pickup_location: place.name || place.formatted_address,
          pickup_address: place.formatted_address
        }));
      }
    }
  }, [pickupSearchBox]);

  // Handle drop location search
  const onDropLoad = useCallback((ref) => {
    setDropSearchBox(ref);
  }, []);

  const onDropPlacesChanged = useCallback(() => {
    if (dropSearchBox) {
      const places = dropSearchBox.getPlaces();
      if (places && places.length > 0) {
        const place = places[0];
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          address: place.formatted_address,
          name: place.name,
        };
        setDropLocation(location);
        setFormData(prev => ({
          ...prev,
          drop_location: place.name || place.formatted_address,
          drop_address: place.formatted_address
        }));
      }
    }
  }, [dropSearchBox]);

  // Handle city-based price calculation
  useEffect(() => {
    if (!pickupLocation?.lat && formData.pickup_city && formData.drop_city) {
      setLoadingPrice(true);
      setTimeout(() => {
        const dist = getEstimatedDistance(formData.pickup_city, formData.drop_city);
        setDistance(dist);
        const price = calculateEstimatedPrice(dist, formData.vehicle_type_required);
        setEstimatedPrice(price);
        setLoadingPrice(false);
      }, 300);
    }
  }, [formData.pickup_city, formData.drop_city, formData.vehicle_type_required, pickupLocation?.lat]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!user) {
      navigate('/login', { state: { from: '/book-transport' } });
      return;
    }

    const finalDistance = calculatedDistance > 0 ? calculatedDistance : distance;
    const finalPrice = calculatedDistance > 0 
      ? calculateEstimatedPrice(calculatedDistance, formData.vehicle_type_required)
      : estimatedPrice;

    const submitData = {
      ...formData,
      estimated_distance_km: finalDistance,
      estimated_price: finalPrice
    };

    setLoading(true);

    try {
      const response = await bookingAPI.create(submitData);
      
      if (response.data.success) {
        navigate('/dashboard', { 
          state: { message: 'Booking created successfully!', bookingRef: response.data.data.booking_reference }
        });
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create booking');
    } finally {
      setLoading(false);
    }
  };

  // Map center calculation
  const mapCenter = useMemo(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      return {
        lat: (pickupLocation.lat + dropLocation.lat) / 2,
        lng: (pickupLocation.lng + dropLocation.lng) / 2,
      };
    }
    return pickupLocation?.lat ? pickupLocation : BIHAR_CENTER;
  }, [pickupLocation, dropLocation]);

  const vehicleTypes = [
    { value: 'truck', label: 'Truck', rate: 25, description: '₹25/km', icon: '🚛' },
    { value: 'mini_truck', label: 'Mini Truck', rate: 15, description: '₹15/km', icon: '🛻' },
    { value: 'pickup', label: 'Pickup', rate: 12, description: '₹12/km', icon: '🛺' },
    { value: 'tempo', label: 'Tempo', rate: 18, description: '₹18/km', icon: '🚚' },
    { value: 'lorry', label: 'Lorry', rate: 25, description: '₹25/km', icon: '🚛' }
  ];

const goodsTypes = [
    'Electronics', 'Furniture', 'Food Items', 'Clothing', 'Machinery',
    'Construction Materials', 'Agricultural Products', 'Pharmaceuticals', 'Other'
  ];

  const biharCities = [
    'Begusarai', 'Patna', 'Muzaffarpur', 'Gaya', 'Darbhanga',
    'Bhagalpur', 'Purnia', 'Arrah', 'Bihar Sharif', 'Katihar',
    'Dhanbad', 'Jamshedpur', 'Ranchi'
  ];

  // WhatsApp Business Number
  const WHATSAPP_NUMBER = '8210931799';

  // Generate WhatsApp message
  const generateWhatsAppMessage = () => {
    const finalDistance = calculatedDistance > 0 ? calculatedDistance : distance;
    const finalPrice = calculatedDistance > 0 
      ? calculateEstimatedPrice(calculatedDistance, formData.vehicle_type_required)
      : estimatedPrice;
    
    const vehicleName = vehicleTypes.find(v => v.value === formData.vehicle_type_required)?.label || 'Truck';
    
    const message = `Hello Bihar Transport,

Pickup Location: ${formData.pickup_location || formData.pickup_city}
Drop Location: ${formData.drop_location || formData.drop_city}
Vehicle: ${vehicleName}
Distance: ${finalDistance} km
Estimated Price: ₹${finalPrice}

Please confirm booking.`;
    
    return encodeURIComponent(message);
  };

  // Handle WhatsApp booking
  const handleWhatsAppBooking = () => {
    const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${generateWhatsAppMessage()}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 md:py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Book Transport</h1>
          <p className="text-gray-600 text-sm md:text-base">Fill in the details to book your goods transportation</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Vehicle Selection */}
          <div className="card">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Select Vehicle Type</h2>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {vehicleTypes.map((vehicle) => (
                <label 
                  key={vehicle.value}
                  className={`cursor-pointer border-2 rounded-xl p-3 md:p-4 transition-all ${
                    formData.vehicle_type_required === vehicle.value
                      ? 'border-amber-500 bg-amber-100'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="vehicle_type_required"
                    value={vehicle.value}
                    checked={formData.vehicle_type_required === vehicle.value}
                    onChange={handleChange}
                    className="sr-only"
                  />
                  <div className="text-center">
                    <div className="text-2xl md:text-3xl mb-1">{vehicle.icon}</div>
                    <div className="font-semibold text-xs md:text-sm">{vehicle.label}</div>
                    <div className="text-xs text-amber-600 font-medium">{vehicle.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Pickup & Drop Locations with Google Places Autocomplete */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Pickup Details */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <span className="w-7 h-7 md:w-8 md:h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-xs md:text-sm mr-2">A</span>
                Pickup Details
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="label">Pickup Location *</label>
                  {hasApiKey && isLoaded ? (
                    <StandaloneSearchBox onLoad={onPickupLoad} onPlacesChanged={onPickupPlacesChanged}>
                      <input
                        type="text"
                        name="pickup_location"
                        value={formData.pickup_location}
                        onChange={handleChange}
                        placeholder="Search location (e.g., Begusarai Railway Station)"
                        className="input-field"
                        required
                      />
                    </StandaloneSearchBox>
                  ) : (
                    <input
                      type="text"
                      name="pickup_location"
                      value={formData.pickup_location}
                      onChange={handleChange}
                      placeholder="e.g., Railway Station, Warehouse"
                      className="input-field"
                      required
                    />
                  )}
                  {pickupLocation?.lat && (
                    <p className="text-xs text-green-600 mt-1">✓ Location selected</p>
                  )}
                </div>
                <div>
                  <label className="label">City *</label>
                  <select
                    name="pickup_city"
                    value={formData.pickup_city}
                    onChange={handleChange}
                    className="input-field"
                    required
                  >
                    {biharCities.map(city => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Detailed Address</label>
                  <textarea
                    name="pickup_address"
                    value={formData.pickup_address}
                    onChange={handleChange}
                    placeholder="Floor, building details, landmark..."
                    className="input-field"
                    rows={2}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Pickup Date *</label>
                    <input
                      type="date"
                      name="pickup_date"
                      value={formData.pickup_date}
                      onChange={handleChange}
                      min={new Date().toISOString().split('T')[0]}
                      className="input-field"
                      required
                    />
                  </div>
                  <div>
                    <label className="label">Pickup Time *</label>
                    <input
                      type="time"
                      name="pickup_time"
                      value={formData.pickup_time}
                      onChange={handleChange}
                      className="input-field"
                      required
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Drop Details */}
            <div className="card">
              <h2 className="text-lg font-semibold mb-4 flex items-center">
                <span className="w-7 h-7 md:w-8 md:h-8 bg-red-500 text-white rounded-full flex items-center justify-center text-xs md:text-sm mr-2">B</span>
                Drop Details
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="label">Drop Location *</label>
                  {hasApiKey && isLoaded ? (
                    <StandaloneSearchBox onLoad={onDropLoad} onPlacesChanged={onDropPlacesChanged}>
                      <input
                        type="text"
                        name="drop_location"
                        value={formData.drop_location}
                        onChange={handleChange}
                        placeholder="Search location (e.g., Patna Railway Station)"
                        className="input-field"
                        required
                      />
                    </StandaloneSearchBox>
                  ) : (
                    <input
                      type="text"
                      name="drop_location"
                      value={formData.drop_location}
                      onChange={handleChange}
                      placeholder="e.g., Market, Warehouse"
                      className="input-field"
                      required
                    />
                  )}
                  {dropLocation?.lat && (
                    <p className="text-xs text-green-600 mt-1">✓ Location selected</p>
                  )}
                </div>
                <div>
                  <label className="label">City *</label>
                  <select
                    name="drop_city"
                    value={formData.drop_city}
                    onChange={handleChange}
                    className="input-field"
                    required
                  >
                    <option value="">Select City</option>
                    {biharCities.map(city => (
                      <option key={city} value={city}>{city}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Detailed Address</label>
                  <textarea
                    name="drop_address"
                    value={formData.drop_address}
                    onChange={handleChange}
                    placeholder="Floor, building details, landmark..."
                    className="input-field"
                    rows={2}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Google Map & Route & Price Estimation */}
          {(pickupLocation?.lat && dropLocation?.lat) && (
            <div className="card">
              <h2 className="text-lg md:text-xl font-semibold mb-4">Route & Price Estimation</h2>
              
              {/* Loading State */}
              {calculatingRoute && (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500 mx-auto mb-2"></div>
                  <p className="text-gray-600">Calculating route and price...</p>
                </div>
              )}

              {/* Map */}
              {hasApiKey && isLoaded ? (
                <div className="mb-6">
                  <GoogleMap
                    mapContainerStyle={{ width: '100%', height: '250px md:300px', borderRadius: '0.75rem' }}
                    center={mapCenter}
                    zoom={9}
                    options={{
                      disableDefaultUI: false,
                      zoomControl: true,
                      streetViewControl: false,
                      mapTypeControl: false,
                      fullscreenControl: true,
                    }}
                  >
                    {pickupLocation?.lat && (
                      <Marker
                        position={{ lat: pickupLocation.lat, lng: pickupLocation.lng }}
                        label="A"
                        title={pickupLocation.name || 'Pickup Location'}
                      />
                    )}
                    {dropLocation?.lat && (
                      <Marker
                        position={{ lat: dropLocation.lat, lng: dropLocation.lng }}
                        label="B"
                        title={dropLocation.name || 'Drop Location'}
                      />
                    )}
                    {directions && (
                      <DirectionsRenderer
                        directions={directions}
                        options={{
                          suppressMarkers: true,
                          polylineOptions: {
                            strokeColor: '#f59e0b',
                            strokeWeight: 4,
                          },
                        }}
                      />
                    )}
                  </GoogleMap>
                </div>
              ) : (
                <div className="w-full h-48 md:h-64 bg-gray-100 rounded-lg flex items-center justify-center mb-6">
                  <div className="text-center p-4">
                    <div className="text-4xl mb-2">🗺️</div>
                    <p className="text-gray-600 text-sm">Add Google Maps API key for interactive map</p>
                    {calculatedDistance > 0 && (
                      <p className="text-amber-500 font-semibold mt-2">Distance: {calculatedDistance} km</p>
                    )}
                  </div>
                </div>
              )}

              {/* Price Estimation Card */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-4 md:p-6 border-2 border-blue-200">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Route & Price Estimation</h3>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div className="text-center p-3 md:p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-2xl md:text-3xl font-bold text-blue-600">
                      {calculatedDistance > 0 ? calculatedDistance : distance}
                    </div>
                    <div className="text-sm text-gray-500">km (Estimated)</div>
                  </div>
                  <div className="text-center p-3 md:p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-lg md:text-xl font-semibold text-gray-800">
                      {vehicleTypes.find(v => v.value === formData.vehicle_type_required)?.label || 'Pickup'}
                    </div>
                    <div className="text-sm text-gray-500">
                      ₹{vehicleTypes.find(v => v.value === formData.vehicle_type_required)?.rate || 12}/km
                    </div>
                  </div>
                  <div className="text-center p-3 md:p-4 bg-white rounded-lg shadow-sm">
                    <div className="text-2xl md:text-3xl font-bold text-green-600">₹{estimatedPrice}</div>
                    <div className="text-sm text-gray-500">Estimated Price</div>
                  </div>
                </div>
                
                <p className="text-xs text-gray-500 text-center">
                  * Price is estimated. Final price may vary based on actual distance and conditions.
                </p>
              </div>
            </div>
          )}

          {/* City-based Price Estimation (when no map coordinates) */}
          {(!pickupLocation?.lat && !dropLocation?.lat && formData.pickup_city && formData.drop_city) && (
            <div className="card bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200">
              <h2 className="text-lg md:text-xl font-semibold mb-4 text-blue-900">Estimated Trip Details</h2>
              
              {loadingPrice ? (
                <div className="text-center py-4">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                  <p className="text-blue-700">Calculating price...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-white rounded-xl shadow-sm">
                    <div className="text-3xl font-bold text-blue-600">{distance}</div>
                    <div className="text-sm text-gray-500">km (Estimated)</div>
                  </div>
                  <div className="text-center p-4 bg-white rounded-xl shadow-sm">
                    <div className="text-xl font-semibold text-gray-800">
                      {vehicleTypes.find(v => v.value === formData.vehicle_type_required)?.label}
                    </div>
                    <div className="text-sm text-gray-500">Vehicle Type</div>
                  </div>
                  <div className="text-center p-4 bg-white rounded-xl shadow-sm">
                    <div className="text-3xl font-bold text-green-600">₹{estimatedPrice}</div>
                    <div className="text-sm text-gray-500">Estimated Price</div>
                  </div>
                </div>
              )}
              
              <p className="text-xs text-gray-500 text-center mt-4">
                * Select precise locations to get accurate pricing with map route
              </p>
            </div>
          )}

          {/* Goods Details */}
          <div className="card">
            <h2 className="text-lg md:text-xl font-semibold mb-4">Goods Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">Goods Description *</label>
                <textarea
                  name="goods_description"
                  value={formData.goods_description}
                  onChange={handleChange}
                  placeholder="Describe your goods (e.g., 20 boxes of household items)"
                  className="input-field"
                  rows={3}
                  required
                />
              </div>
              <div>
                <label className="label">Goods Type</label>
                <select
                  name="goods_type"
                  value={formData.goods_type}
                  onChange={handleChange}
                  className="input-field"
                >
                  <option value="">Select Type</option>
                  {goodsTypes.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Weight (kg)</label>
                <input
                  type="number"
                  name="goods_weight_kg"
                  value={formData.goods_weight_kg}
                  onChange={handleChange}
                  placeholder="Approximate weight"
                  className="input-field"
                  min="1"
                />
              </div>
              <div>
                <label className="label">Number of Items</label>
                <input
                  type="number"
                  name="number_of_items"
                  value={formData.number_of_items}
                  onChange={handleChange}
                  className="input-field"
                  min="1"
                />
              </div>
              <div className="flex items-center">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    name="fragile"
                    checked={formData.fragile}
                    onChange={handleChange}
                    className="w-5 h-5 text-amber-500 border-gray-300 rounded focus:ring-amber-500"
                  />
                  <span className="ml-2 text-gray-700">Fragile Goods</span>
                </label>
              </div>
            </div>
          </div>

{/* Submit & WhatsApp Buttons */}
          <div className="flex flex-col md:flex-row justify-center items-center gap-4">
            {estimatedPrice > 0 && (
              <div className="bg-amber-500 text-white px-6 py-3 rounded-xl text-center">
                <div className="text-sm">Estimated Price</div>
                <div className="text-2xl font-bold">₹{estimatedPrice}</div>
              </div>
            )}
            
            {/* WhatsApp Button */}
            {estimatedPrice > 0 && (
              <button
                type="button"
                onClick={handleWhatsAppBooking}
                className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-4 px-6 rounded-xl transition-colors w-full md:w-auto"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                Book via WhatsApp
              </button>
            )}
            
            <button
              type="submit"
              disabled={loading}
              className="btn-primary text-lg px-12 py-4 disabled:opacity-50 w-full md:w-auto"
            >
              {loading ? 'Processing...' : 'Book Transport'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default BookTransport;


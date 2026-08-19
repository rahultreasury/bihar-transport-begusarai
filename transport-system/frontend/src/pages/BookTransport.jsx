import { useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, StandaloneSearchBox } from '@react-google-maps/api';
import { AuthContext } from '../App';
import { bookingAPI } from '../services/api';
// Shared 18-vehicle fleet catalogue — SINGLE SOURCE OF TRUTH (same data as Home).
import {
  vehicleTypes,
  DEFAULT_VEHICLE_ID,
  getVehicleById,
  getVehicleRate,
  getVehicleName
} from '../data/vehicleCatalogue';
// SVG fallback icons — resolved at render time via getVehicleIcon(id).
import { getVehicleIcon } from '../components/icons/VehicleIcons';

// Bihar region center coordinates
const BIHAR_CENTER = { lat: 25.6200, lng: 85.8900 };

// Google Maps configuration
const libraries = ['places', 'geometry', 'distanceMatrix'];

// Backward-compatible mapping for legacy direct type query params
// (e.g. /book-transport?vehicle=truck) to a representative fleet id.
// Mirrors the backend LEGACY_TYPE_FALLBACK in services/vehiclePricing.js.
const LEGACY_VEHICLE_PARAM_FALLBACK = {
  truck: 'truck-17ft',
  mini_truck: 'tata-407-10ft',
  pickup: 'pickup-truck',
  tempo: 'tata-407-14ft',
  lorry: 'truck-19ft'
};

/**
 * Resolve a ?vehicle= query param to a valid fleet id (slug).
 * Returns the matching catalogue id, a legacy-type representative, or ''.
 */
const resolveVehicleParam = (param) => {
  if (!param) return '';
  if (getVehicleById(param)) return param;
  if (LEGACY_VEHICLE_PARAM_FALLBACK[param]) return LEGACY_VEHICLE_PARAM_FALLBACK[param];
  return '';
};

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

  const formRef = useRef(null);

  // Pre-select the vehicle passed from the Home fleet catalogue (?vehicle=<vehicle-id>).
  // The value stored in the form is the unique fleet id (slug) — the exact value the
  // backend pricing engine (vehiclePricing.js) and booking validation expect.
  const preselectedFleetVehicle = resolveVehicleParam(vehicleParam);
  const initialVehicleType = preselectedFleetVehicle || DEFAULT_VEHICLE_ID;

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
    vehicle_type_required: initialVehicleType
  });

  // Smoothly scroll to the booking form when arriving from a fleet vehicle card
  useEffect(() => {
    if (!preselectedFleetVehicle) return;
    const t = setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
  }, [preselectedFleetVehicle]);

  // ===== Vehicle Selector Carousel =====
  const vehicleCarouselRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  // Fixed card width (220px) + gap (12px) — used for one-card arrow steps.
  const VEHICLE_CARD_STEP = 232;
  const carouselRafRef = useRef(0);

  const updateCarouselArrows = useCallback(() => {
    const el = vehicleCarouselRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 4);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 4);
  }, []);

  // rAF-throttled scroll handler — keeps re-renders to one per frame.
  const handleCarouselScroll = useCallback(() => {
    if (carouselRafRef.current) return;
    carouselRafRef.current = requestAnimationFrame(() => {
      carouselRafRef.current = 0;
      updateCarouselArrows();
    });
  }, [updateCarouselArrows]);

  // Smoothly scroll one card width left/right (desktop arrow buttons).
  const scrollCarousel = useCallback((direction) => {
    const el = vehicleCarouselRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * VEHICLE_CARD_STEP, behavior: 'smooth' });
  }, []);

  // Arrow-key keyboard navigation on the carousel (accessibility).
  const handleCarouselKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const el = vehicleCarouselRef.current;
    if (!el) return;
    el.scrollBy({
      left: (e.key === 'ArrowLeft' ? -1 : 1) * VEHICLE_CARD_STEP,
      behavior: 'smooth'
    });
  }, []);

  // Keep arrow visibility in sync on mount / resize / after data loads.
  useEffect(() => {
    updateCarouselArrows();
    window.addEventListener('resize', updateCarouselArrows);
    return () => {
      window.removeEventListener('resize', updateCarouselArrows);
      if (carouselRafRef.current) cancelAnimationFrame(carouselRafRef.current);
    };
  }, [updateCarouselArrows]);

  // Auto-scroll the selected/preselected vehicle card into view (centered).
  useEffect(() => {
    const t = setTimeout(() => {
      const selected = vehicleCarouselRef.current?.querySelector(
        `[data-vehicle-id="${formData.vehicle_type_required}"]`
      );
      selected?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      updateCarouselArrows();
    }, 250);
    return () => clearTimeout(t);
  }, [formData.vehicle_type_required, updateCarouselArrows]);

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

  // Calculate price based on distance and the selected vehicle's per-km rate.
  // Rates come from the shared 18-vehicle catalogue (same display rates as Home),
  // which mirrors the backend vehiclePricing.js source of truth.
  const calculateEstimatedPrice = (dist, vType) => {
    const rate = getVehicleRate(vType);
    return Math.round(dist * (rate || getVehicleRate(DEFAULT_VEHICLE_ID)));
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
      const response = await bookingAPI.createAuthenticated(submitData);
      
      if (response.data.success) {
        const bookingRef = response.data.data.booking_reference;
        navigate(`/track/${bookingRef}`, {
          state: { message: 'Booking created successfully!' }
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
    
    const vehicleName = getVehicleName(formData.vehicle_type_required);
    
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

        <form onSubmit={handleSubmit} className="space-y-6" ref={formRef}>
          {/* Pre-selected vehicle notice */}
          {preselectedFleetVehicle && (
            <div className="bg-blue-900 text-white rounded-xl px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <svg className="w-5 h-5 text-amber-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-semibold">
                  {getVehicleName(preselectedFleetVehicle)} pre-selected
                </span>
              </div>
              <span className="text-xs text-blue-100/80 sm:text-right">
                The matching vehicle has been auto-selected below.
              </span>
            </div>
          )}

          {/* Vehicle Selection — premium horizontal carousel (Amazon / Apple-style) */}
          <div className="card">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h2 className="text-lg md:text-xl font-semibold">Select Vehicle</h2>
              <span className="text-xs text-gray-500">
                {vehicleTypes.length} vehicles available
              </span>
            </div>

            <div className="relative">
              {/* Desktop navigation arrows — only shown when the carousel overflows */}
              {canScrollLeft && (
                <button
                  type="button"
                  onClick={() => scrollCarousel(-1)}
                  aria-label="Scroll vehicles left"
                  className="hidden md:flex absolute left-0 top-[104px] -translate-x-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg border border-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300 hover:shadow-xl transition-all duration-200 focus-visible:outline-2 focus-visible:outline-amber-500 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
              )}
              {canScrollRight && (
                <button
                  type="button"
                  onClick={() => scrollCarousel(1)}
                  aria-label="Scroll vehicles right"
                  className="hidden md:flex absolute right-0 top-[104px] translate-x-1/2 z-20 w-10 h-10 items-center justify-center rounded-full bg-white text-gray-700 shadow-lg border border-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300 hover:shadow-xl transition-all duration-200 focus-visible:outline-2 focus-visible:outline-amber-500 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              )}

              {/* Horizontal scroll-snap carousel */}
              <div
                ref={vehicleCarouselRef}
                onScroll={handleCarouselScroll}
                onKeyDown={handleCarouselKeyDown}
                tabIndex={0}
                role="group"
                aria-label="Select a vehicle"
                className="flex gap-3 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-1 px-1 outline-none"
              >
                {vehicleTypes.map((vehicle) => {
                  const isSelected = formData.vehicle_type_required === vehicle.id;
                  const VehicleIcon = getVehicleIcon(vehicle.id);
                  return (
                    <label
                      key={vehicle.id}
                      data-vehicle-id={vehicle.id}
                      className={`cursor-pointer border-2 rounded-xl overflow-hidden transition-all snap-start shrink-0 w-[220px] ${
                        isSelected
                          ? 'border-amber-500 bg-amber-100 ring-2 ring-amber-200'
                          : 'border-gray-200 hover:border-amber-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="vehicle_type_required"
                        value={vehicle.id}
                        checked={isSelected}
                        onChange={handleChange}
                        className="sr-only"
                      />
                      <div className="bg-gradient-to-b from-gray-50 to-amber-50/60 px-3 pt-3 pb-2 flex items-center justify-center h-[96px]">
                        {vehicle.image ? (
                          <img
                            src={vehicle.image}
                            alt={vehicle.name}
                            loading="lazy"
                            className="w-full max-h-[84px] object-contain"
                          />
                        ) : (
                          <div className="scale-90">
                            <VehicleIcon />
                          </div>
                        )}
                      </div>
                      <div className="p-2.5 text-center">
                        <div className="font-semibold text-xs md:text-sm text-gray-900 leading-tight mb-1">
                          {vehicle.name}
                        </div>
                        <div className="text-[10px] md:text-xs text-gray-500 mb-1">{vehicle.capacity}</div>
                        <div className="text-[11px] md:text-xs text-amber-600 font-bold">
                          {vehicle.priceLabel}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Mobile swipe hint (desktop shows arrow hints instead) */}
            <p className="mt-2 text-xs text-gray-400 md:hidden text-center">
              ← Swipe to explore all vehicles →
            </p>
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
                      {getVehicleName(formData.vehicle_type_required)}
                    </div>
                    <div className="text-sm text-gray-500">
                      {getVehicleById(formData.vehicle_type_required)?.priceLabel || ''}
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
                      {getVehicleName(formData.vehicle_type_required)}
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


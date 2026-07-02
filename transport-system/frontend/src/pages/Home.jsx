import { useState, useEffect, useRef } from 'react';
import { bookingAPI } from '../services/api';
import { Link, useNavigate } from 'react-router-dom';
import { LoadScript, Autocomplete } from '@react-google-maps/api';

// SVG Icons for vehicles
const TruckIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="8" y="20" width="36" height="24" rx="2" fill="#F5A623" />
    <rect x="44" y="28" width="12" height="16" rx="2" fill="#F5A623" />
    <circle cx="18" cy="48" r="5" fill="#1e3a5f" />
    <circle cx="46" cy="48" r="5" fill="#1e3a5f" />
    <circle cx="18" cy="48" r="2.5" fill="#fff" />
    <circle cx="46" cy="48" r="2.5" fill="#fff" />
    <rect x="12" y="24" width="8" height="6" rx="1" fill="#1e3a5f" />
    <rect x="46" y="30" width="4" height="4" rx="0.5" fill="#1e3a5f" />
  </svg>
);

const MiniTruckIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="12" y="24" width="28" height="18" rx="2" fill="#F5A623" />
    <rect x="40" y="30" width="12" height="12" rx="2" fill="#F5A623" />
    <circle cx="22" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="46" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="22" cy="46" r="2" fill="#fff" />
    <circle cx="46" cy="46" r="2" fill="#fff" />
    <rect x="14" y="28" width="6" height="4" rx="1" fill="#1e3a5f" />
  </svg>
);

const PickupIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 28L14 28L20 20H48L52 28H10Z" fill="#F5A623" />
    <rect x="10" y="28" width="28" height="16" rx="2" fill="#F5A623" />
    <rect x="38" y="32" width="16" height="12" rx="2" fill="#F5A623" />
    <circle cx="22" cy="48" r="4" fill="#1e3a5f" />
    <circle cx="46" cy="48" r="4" fill="#1e3a5f" />
    <circle cx="22" cy="48" r="2" fill="#fff" />
    <circle cx="46" cy="48" r="2" fill="#fff" />
  </svg>
);

const TempoIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="22" width="40" height="20" rx="2" fill="#F5A623" />
    <rect x="46" y="26" width="12" height="16" rx="2" fill="#F5A623" />
    <circle cx="18" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="46" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="18" cy="46" r="2" fill="#fff" />
    <circle cx="46" cy="46" r="2" fill="#fff" />
    <rect x="10" y="26" width="6" height="4" rx="1" fill="#1e3a5f" />
  </svg>
);

// Vehicle data with prices and SVG icons
const vehicleTypes = [
  {
    type: 'truck',
    name: 'Truck',
    capacity: '10-20 Ton',
    icon: TruckIcon,
    price: 25,
    available: 3,
    description: 'Heavy cargo transport'
  },
  {
    type: 'mini_truck',
    name: 'Mini Truck',
    capacity: '2-3 Ton',
    icon: MiniTruckIcon,
    price: 18,
    available: 1,
    description: 'Small to medium loads'
  },
  {
    type: 'pickup',
    name: 'Pickup',
    capacity: '1-1.5 Ton',
    icon: PickupIcon,
    price: 12,
    available: 2,
    description: 'Light cargo & personal'
  },
  {
    type: 'tempo',
    name: 'Tempo',
    capacity: '3-5 Ton',
    icon: TempoIcon,
    price: 15,
    available: 1,
    description: 'Medium cargo transport'
  }
];

// Service areas
const serviceAreas = [
  { name: 'Begusarai', icon: '📍' },
  { name: 'Patna', icon: '🏙️' },
  { name: 'Muzaffarpur', icon: '🏘️' },
  { name: 'Darbhanga', icon: '🏘️' },
  { name: 'Samastipur', icon: '🏘️' },
  { name: 'Khagaria', icon: '🏘️' }
];

// Customer reviews with Bihar cities
const testimonials = [
  {
    id: 1,
    name: 'Rajesh Kumar',
    rating: 5,
    text: 'Very reliable transport service in Begusarai. They delivered my household items safely and on time.',
    city: 'Patna'
  },
  {
    id: 2,
    name: 'Amit Singh',
    rating: 5,
    text: 'Affordable and fast delivery. The tracking feature helped me know exactly when my goods would arrive.',
    city: 'Muzaffarpur'
  },
  {
    id: 3,
    name: 'Priya Sharma',
    rating: 5,
    text: 'Best transport service in Bihar! Professional staff and well-maintained vehicles.',
    city: 'Darbhanga'
  }
];

// Trust items
const trustItems = [
  { icon: '⭐', title: '25+ Years Experience', description: 'Serving Bihar since 1998 with unmatched expertise' },
  { icon: '📦', title: '5000+ Deliveries Completed', description: 'Successfully delivered goods across Bihar' },
  { icon: '🤝', title: '100+ Happy Clients', description: 'Satisfied customers who trust us regularly' },
  { icon: '📞', title: '24/7 Customer Support', description: 'Round the clock assistance for all your needs' }
];

const WHATSAPP_NUMBER = '8210931799';

const pickupAutocompleteOptions = {
  componentRestrictions: { country: 'in' },
  types: ['geocode']
};

function Home() {
  const navigate = useNavigate();

  // Quick Booking Form State (used for /book-transport navigation)
  const [quickBooking, setQuickBooking] = useState({
    pickup: '',
    drop: '',
    vehicleType: 'truck'
  });

  // Price Calculator State
  const [priceCalc, setPriceCalc] = useState({
    pickup: '',
    drop: '',
    pickupPlaceId: '',
    dropPlaceId: '',
    pickupLat: null,
    pickupLng: null,
    pickupFormattedAddress: '',
    dropLat: null,
    dropLng: null,
    dropFormattedAddress: '',
    vehicleType: 'truck'
  });

  const pickupAutocompleteRef = useRef(null);
  const dropAutocompleteRef = useRef(null);

  const [calcDistance, setCalcDistance] = useState(0);
  const [calcDuration, setCalcDuration] = useState('');
  const [calcPrice, setCalcPrice] = useState(0);
  const [calcWarning, setCalcWarning] = useState('');

  const [isCalculating, setIsCalculating] = useState(false);
  const [showPriceResult, setShowPriceResult] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // Stats animation state
  const [statsVisible, setStatsVisible] = useState(false);
  const statsRef = useRef(null);

  // City distance estimation
  const cityDistances = {
    'Begusarai-Patna': 185,
    'Begusarai-Muzaffarpur': 95,
    'Begusarai-Darbhanga': 110,
    'Begusarai-Samastipur': 45,
    'Begusarai-Khagaria': 65,
    'Patna-Muzaffarpur': 105,
    'Patna-Darbhanga': 165,
    'Patna-Gaya': 95,
    'Muzaffarpur-Darbhanga': 65,
    'Muzaffarpur-Samastipur': 55,
    'Darbhanga-Samastipur': 35,
    'Darbhanga-Khagaria': 75
  };

  const stats = [
    { value: 25, suffix: '+', label: 'Years of Experience' },
    { value: 5000, suffix: '+', label: 'Happy Customers' },
    { value: 100, suffix: '+', label: 'Routes Covered' },
    { value: 50, suffix: '+', label: 'Fleet Vehicles' }
  ];

  const [animatedStats, setAnimatedStats] = useState(stats.map(() => 0));

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !statsVisible) {
            setStatsVisible(true);

            stats.forEach((stat, index) => {
              let current = 0;
              const increment = stat.value / 50;

              const timer = setInterval(() => {
                current += increment;
                if (current >= stat.value) {
                  current = stat.value;
                  clearInterval(timer);
                }
                setAnimatedStats((prev) => {
                  const newStats = [...prev];
                  newStats[index] = Math.floor(current);
                  return newStats;
                });
              }, 30);
            });
          }
        });
      },
      { threshold: 0.3 }
    );

    if (statsRef.current) observer.observe(statsRef.current);

    return () => observer.disconnect();
  }, [statsVisible]);

  const handleQuickBooking = (e) => {
    e.preventDefault();
    const params = new URLSearchParams({
      vehicle: quickBooking.vehicleType,
      pickup: quickBooking.pickup,
      drop: quickBooking.drop
    });
    navigate(`/book-transport?${params.toString()}`);
  };

  // ===== Price Calculator (Distance Matrix API + Google Autocomplete inputs) =====
  const handleCheckPrice = async () => {
    if (!priceCalc.pickupLat || !priceCalc.pickupLng || !priceCalc.dropLat || !priceCalc.dropLng) {
      return;
    }

    setIsCalculating(true);
    setShowPriceResult(false);
    setCalcWarning('');

    try {
      const url = `${import.meta.env.VITE_API_URL || 'http://localhost:3000/api'}/calculate-price`;

      const payload = {
        pickup: {
          address: priceCalc.pickupFormattedAddress || priceCalc.pickup,
          lat: priceCalc.pickupLat,
          lng: priceCalc.pickupLng
        },
        drop: {
          address: priceCalc.dropFormattedAddress || priceCalc.drop,
          lat: priceCalc.dropLat,
          lng: priceCalc.dropLng
        },
        vehicleType: priceCalc.vehicleType
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok || !data?.success) {
        throw new Error(data?.message || 'Failed to calculate price');
      }

      setCalcDistance(data.distanceKm);
      setCalcDuration(data.duration);
      setCalcPrice(data.price);
      setCalcWarning(data.warning || '');

      setLatestQuote({
        pickupLocation: priceCalc.pickup,
        pickupAddress: priceCalc.pickupFormattedAddress || priceCalc.pickup,
        pickupCity: priceCalc.pickup || 'Begusarai',
        dropLocation: priceCalc.drop,
        dropAddress: priceCalc.dropFormattedAddress || priceCalc.drop,
        dropCity: priceCalc.drop || 'Patna',
        vehicleType: priceCalc.vehicleType,
        distanceKm: data.distanceKm,
        price: data.price
      });

      setIsCalculating(false);
      setShowPriceResult(true);
    } catch (e) {
      setIsCalculating(false);
      setCalcWarning(e?.message || 'Network/Google API error');
      setShowPriceResult(true);
    }
  };

  // ===== Book Now modal state (from latest price calc) =====
  const [bookNowOpen, setBookNowOpen] = useState(false);
  const [bookNowLoading, setBookNowLoading] = useState(false);
  const [bookNowError, setBookNowError] = useState('');
  const [bookNowSuccess, setBookNowSuccess] = useState('');

  const [bookNowForm, setBookNowForm] = useState({
    name: '',
    mobile: '',
    goods_type: ''
  });

  const [latestQuote, setLatestQuote] = useState(null);

  const openBookNow = () => {
    if (!latestQuote) return;
    setBookNowError('');
    setBookNowSuccess('');
    setBookNowOpen(true);
  };

  const closeBookNow = () => {
    if (bookNowLoading) return;
    setBookNowOpen(false);
  };

  const validateMobile = (mobile) => /^\d{10}$/.test(String(mobile).trim());

  const handleBookNowSubmit = async (e) => {
    e.preventDefault();
    setBookNowError('');
    setBookNowSuccess('');

    if (!latestQuote) {
      setBookNowError('Please calculate price again before booking.');
      return;
    }

    const name = String(bookNowForm.name || '').trim();
    const mobile = String(bookNowForm.mobile || '').trim();
    const goods_type = String(bookNowForm.goods_type || '').trim();

    if (!name) return setBookNowError('Name is required');
    if (!validateMobile(mobile)) return setBookNowError('Please enter a valid 10-digit mobile number');
    if (!goods_type) return setBookNowError('Goods Type is required');

    setBookNowLoading(true);

    try {
      // MVP contract fields expected by backend POST /api/booking
      const payload = {
        pickup: latestQuote.pickupLocation,
        drop: latestQuote.dropLocation,
        vehicle: latestQuote.vehicleType,
        distance: String(latestQuote.distanceKm),
        price: String(latestQuote.price),
        customerName: name,
        mobile,
        goodsType: goods_type,
        pickupDate: new Date().toISOString().slice(0, 10),
        pickupTime: '10:00 AM'
      };

      const res = await bookingAPI.create(payload);

      if (!res?.data?.success) {
        throw new Error(res?.data?.message || 'Failed to submit booking');
      }

      setBookNowSuccess('Booking Submitted Successfully. Our team will contact you shortly.');

      setBookNowForm({ name: '', mobile: '', goods_type: '' });
      setBookNowLoading(false);

      setTimeout(() => {
        setBookNowOpen(false);
      }, 900);
    } catch (err) {
      setBookNowLoading(false);
      setBookNowError(err?.message || 'Failed to submit booking');
    }
  };

  const handleWhatsApp = () => {
    const message = `Hello Bihar Transport,\n\nI'm interested in booking transport service.\n\nPlease share more details.`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleVehicleClick = (vehicle) => {
    setSelectedVehicle(vehicle.type);
    setQuickBooking((prev) => ({ ...prev, vehicleType: vehicle.type }));
  };

  const renderStars = (rating) => '⭐'.repeat(rating);

  return (
    <div className="overflow-hidden">
      {/* HERO SECTION */}
      <section className="hero-gradient relative overflow-hidden hero-pattern">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 md:py-12 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-12 items-center">
            <div className="text-white order-2 lg:order-1">
              <h1 className="text-xl md:text-3xl lg:text-4xl xl:text-5xl font-bold mb-2 md:mb-4 animate-slide-in-left">
                Reliable Logistics &amp; Goods Transportation
              </h1>
              <p
                className="text-base md:text-xl mb-3 md:mb-6 animate-slide-in-left delay-100"
                style={{ color: '#FFFFFF' }}
              >
                Converting Loads Into Trust Since 1998.
              </p>

              {/* Price Calculator Form */}
              <div
                className="bg-white rounded-xl shadow-2xl p-3 md:p-5 animate-slide-in-left delay-200"
                style={{ borderRadius: '12px' }}
              >
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Pickup</label>
                    <LoadScript
                      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                      libraries={['places']}
                      onError={(e) => console.error('Google Maps LoadScript error (Pickup):', e)}
                    >
                      <Autocomplete
                        options={pickupAutocompleteOptions}
                        onLoad={(ac) => {
                          pickupAutocompleteRef.current = ac;
                        }}
                        onPlaceChanged={() => {
                          try {
                            const ac = pickupAutocompleteRef.current;
                            const place = ac?.getPlace?.();
                            if (!place?.geometry?.location) return;

                            const lat = place.geometry.location.lat();
                            const lng = place.geometry.location.lng();
                            const formatted_address = place.formatted_address || place.name || '';

                            setPriceCalc((prev) => ({
                              ...prev,
                              pickup: formatted_address || prev.pickup,
                              pickupPlaceId: place.place_id || prev.pickupPlaceId,
                              pickupFormattedAddress: formatted_address,
                              pickupLat: lat,
                              pickupLng: lng
                            }));
                            setShowPriceResult(false);
                          } catch (e) {
                            console.error('Google Autocomplete onPlaceChanged error (Pickup):', e);
                          }
                        }}
                      >
                        <input
                          type="text"
                          value={priceCalc.pickup}
                          onChange={(e) => {
                            setPriceCalc({ ...priceCalc, pickup: e.target.value });
                            setShowPriceResult(false);
                          }}
                          placeholder="Enter pickup location"
                          className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                        />
                      </Autocomplete>
                    </LoadScript>
                  </div>

                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Drop</label>
                    <LoadScript
                      googleMapsApiKey={import.meta.env.VITE_GOOGLE_MAPS_API_KEY}
                      libraries={['places']}
                      onError={(e) => console.error('Google Maps LoadScript error (Drop):', e)}
                    >
                      <Autocomplete
                        options={pickupAutocompleteOptions}
                        onLoad={(ac) => {
                          dropAutocompleteRef.current = ac;
                        }}
                        onPlaceChanged={() => {
                          try {
                            const ac = dropAutocompleteRef.current;
                            const place = ac?.getPlace?.();
                            if (!place?.geometry?.location) return;

                            const lat = place.geometry.location.lat();
                            const lng = place.geometry.location.lng();
                            const formatted_address = place.formatted_address || place.name || '';

                            setPriceCalc((prev) => ({
                              ...prev,
                              drop: formatted_address || prev.drop,
                              dropPlaceId: place.place_id || prev.dropPlaceId,
                              dropFormattedAddress: formatted_address,
                              dropLat: lat,
                              dropLng: lng
                            }));
                            setShowPriceResult(false);
                          } catch (e) {
                            console.error('Google Autocomplete onPlaceChanged error (Drop):', e);
                          }
                        }}
                      >
                        <input
                          type="text"
                          value={priceCalc.drop}
                          onChange={(e) => {
                            setPriceCalc({ ...priceCalc, drop: e.target.value });
                            setShowPriceResult(false);
                          }}
                          placeholder="Enter drop location"
                          className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                        />
                      </Autocomplete>
                    </LoadScript>
                  </div>

                  <div className="col-span-2 md:col-span-1">
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Vehicle</label>
                    <select
                      value={priceCalc.vehicleType}
                      onChange={(e) => {
                        setPriceCalc({ ...priceCalc, vehicleType: e.target.value });
                        setShowPriceResult(false);
                      }}
                      className="w-full px-2 py-2 md:py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all cursor-pointer bg-white text-gray-700 text-sm"
                    >
                      {vehicleTypes.map((v) => (
                        <option key={v.type} value={v.type}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="col-span-2 md:col-span-1 flex items-end">
                    <button
                      onClick={handleCheckPrice}
                      disabled={!priceCalc.pickup || !priceCalc.drop}
                      className="w-full py-2 md:py-2.5 px-2 md:px-4 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
                      style={{ backgroundColor: '#F5A623' }}
                    >
                      Check Price
                    </button>
                  </div>
                </div>

                {showPriceResult && !isCalculating && (
                  <div>
                    <div className="mt-2 md:mt-3 bg-green-50 rounded-lg p-2 md:p-3 border border-green-200">
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-600">{calcDistance} km</span>
                        <span className="font-bold text-green-600 text-lg">₹{calcPrice}</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={openBookNow}
                      disabled={!latestQuote || bookNowLoading}
                      className="mt-2 w-full py-2 md:py-2.5 px-2 md:px-4 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer text-sm"
                    >
                      {bookNowLoading ? 'Processing...' : 'Book Now'}
                    </button>

                    {calcWarning && <div className="mt-2 text-xs text-amber-700">{calcWarning}</div>}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 md:gap-3 mt-3 md:mt-4 animate-slide-in-left delay-300">
                <Link
                  to="/book-transport"
                  className="w-full sm:w-auto flex-1 md:flex-none px-4 md:px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-all shadow-lg text-center btn-hover-scale cursor-pointer"
                >
                  Book Transport
                </Link>
                <Link
                  to="/track"
                  className="w-full sm:w-auto flex-1 md:flex-none px-4 md:px-6 py-3 bg-white/10 backdrop-blur text-white rounded-xl font-semibold hover:bg-white/20 transition-all border border-white/30 text-center btn-hover-scale cursor-pointer"
                >
                  Track Delivery
                </Link>
                <a
                  href="tel:+918210931799"
                  className="w-full sm:w-auto flex-1 md:flex-none px-4 md:px-6 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-all shadow-lg text-center btn-hover-scale cursor-pointer flex items-center justify-center gap-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  Call Now
                </a>
              </div>
            </div>

            <div className="order-1 lg:order-2 flex justify-center lg:justify-start animate-slide-in-right">
              <div className="relative">
                <svg viewBox="0 0 200 120" className="w-32 md:w-48 lg:w-80 animate-float" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="20" y="35" width="100" height="50" rx="4" fill="#F5A623" />
                  <rect x="120" y="45" width="35" height="40" rx="4" fill="#F5A623" />
                  <rect x="125" y="50" width="10" height="12" rx="2" fill="#1e3a5f" />
                  <circle cx="50" cy="90" r="14" fill="#1e3a5f" />
                  <circle cx="50" cy="90" r="8" fill="#374151" />
                  <circle cx="50" cy="90" r="4" fill="#9CA3AF" />
                  <circle cx="135" cy="90" r="14" fill="#1e3a5f" />
                  <circle cx="135" cy="90" r="8" fill="#374151" />
                  <circle cx="135" cy="90" r="4" fill="#9CA3AF" />
                  <rect x="25" y="42" width="15" height="10" rx="2" fill="#1e3a5f" opacity="0.3" />
                  <rect x="45" y="42" width="15" height="10" rx="2" fill="#1e3a5f" opacity="0.3" />
                  <rect x="65" y="42" width="15" height="10" rx="2" fill="#1e3a5f" opacity="0.3" />
                  <rect x="85" y="42" width="15" height="10" rx="2" fill="#1e3a5f" opacity="0.3" />
                  <rect x="152" y="55" width="4" height="6" rx="1" fill="#FBBF24" />
                  <line x1="0" y1="108" x2="200" y2="108" stroke="#4B5563" strokeWidth="2" strokeDasharray="10 5" />
                </svg>
              </div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: '60px' }}>
          <svg className="w-full h-16 md:h-20 text-gray-50 absolute bottom-0 animate-wave" viewBox="0 0 1440 100" preserveAspectRatio="none">
            <path fill="currentColor" d="M0,40 C360,100 720,0 1080,60 C1260,90 1380,70 1440,50 L1440,100 L0,100 Z" />
          </svg>
        </div>
      </section>

      {/* LIVE VEHICLE AVAILABILITY */}
      <section className="py-8 bg-white border-b">
        <div className="max-w-7xl mx-auto px-4">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 text-center">Available Vehicles Today</h3>
          <div className="flex flex-wrap justify-center gap-4 md:gap-8">
            {vehicleTypes.map((vehicle) => (
              <div key={vehicle.type} className="flex items-center gap-2 bg-gray-50 px-4 py-2 rounded-full cursor-pointer hover:bg-gray-100 transition-colors">
                <span className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></span>
                <span className="font-medium text-gray-800">
                  {vehicle.available} {vehicle.name}(s) Available
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section ref={statsRef} className="py-10 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8">
            {stats.map((stat, index) => (
              <div key={index} className="text-center">
                <div className="text-3xl md:text-4xl font-bold text-amber-500 mb-1">
                  {animatedStats[index]}
                  {stat.suffix}
                </div>
                <div className="text-sm md:text-base text-gray-600">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* VEHICLE CARDS */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Our Vehicle Fleet</h2>
            <p className="text-gray-600">Choose the right vehicle for your goods transportation needs</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {vehicleTypes.map((vehicle) => (
              <div
                key={vehicle.type}
                onClick={() => handleVehicleClick(vehicle)}
                className={`card rounded-xl cursor-pointer transition-all card-hover border-2 glass-card card-entrance ${
                  selectedVehicle === vehicle.type
                    ? 'border-amber-500 bg-amber-50/90 shadow-lg'
                    : 'border-transparent hover:border-amber-300'
                }`}
                style={{ borderRadius: '12px' }}
              >
                <div className="flex justify-center mb-3">
                  <vehicle.icon />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-1 text-center">{vehicle.name}</h3>
                <p className="text-gray-600 text-center mb-2" style={{ color: '#E0E0E0' }}>
                  Capacity: {vehicle.capacity}
                </p>
                <p className="text-amber-600 font-bold text-center text-lg mb-3">₹{vehicle.price}/km</p>
                <p className="text-gray-500 text-sm text-center mb-4">{vehicle.description}</p>
                <Link
                  to={`/book-transport?vehicle=${vehicle.type}`}
                  className={`block w-full text-center py-2 rounded-lg font-medium transition-colors ${
                    selectedVehicle === vehicle.type
                      ? 'bg-amber-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-amber-500 hover:text-white'
                  }`}
                  style={{ borderRadius: '8px' }}
                >
                  {selectedVehicle === vehicle.type ? '✓ Selected' : 'Book Now →'}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="py-16 md:py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Why Choose Bihar Transport?</h2>
            <p className="text-gray-600">Experience the difference with Bihar's most trusted transport service</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {trustItems.map((item, index) => (
              <div key={index} className="card text-center group hover:-translate-y-1" style={{ borderRadius: '12px' }}>
                <div className="w-16 h-16 bg-amber-500 rounded-2xl flex items-center justify-center text-3xl mb-4 mx-auto group-hover:scale-110 transition-transform">
                  {item.icon}
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">How It Works</h2>
            <p className="text-gray-600">Book your transport in three simple steps</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4">1</div>
              <h3 className="text-lg font-semibold mb-2">Enter Pickup &amp; Drop</h3>
              <p className="text-gray-600">Provide your pickup location and destination where you need to send goods</p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4">2</div>
              <h3 className="text-lg font-semibold mb-2">Select Vehicle &amp; Book</h3>
              <p className="text-gray-600">Choose the appropriate vehicle type and confirm your booking</p>
            </div>
            <div className="text-center">
              <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center text-white text-xl font-bold mx-auto mb-4">3</div>
              <h3 className="text-lg font-semibold mb-2">Track &amp; Receive</h3>
              <p className="text-gray-600">Track your delivery in real-time and receive goods at destination</p>
            </div>
          </div>
        </div>
      </section>

      {/* REVIEWS */}
      <section className="py-16 md:py-20 bg-gradient-to-br from-amber-50 to-yellow-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">What Our Customers Say</h2>
            <p className="text-gray-600">Trusted by thousands across Bihar</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {testimonials.map((testimonial) => (
              <div key={testimonial.id} className="bg-white rounded-xl shadow-lg p-6 card-hover" style={{ borderRadius: '12px' }}>
                <div className="flex items-center mb-3">
                  <div className="text-2xl mr-2">{renderStars(testimonial.rating)}</div>
                </div>
                <p className="text-gray-700 mb-4 italic">"{testimonial.text}"</p>
                <div className="flex items-center">
                  <div className="w-10 h-10 bg-amber-500 rounded-full flex items-center justify-center text-white font-bold mr-3">
                    {testimonial.name.charAt(0)}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{testimonial.name}</p>
                    <p className="text-sm text-gray-500">{testimonial.city}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVICE AREAS */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">We Serve Across Bihar</h2>
            <p className="text-gray-600">Professional transport services covering major cities in Bihar</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {serviceAreas.map((area, index) => (
              <div
                key={index}
                className="card text-center hover:border-amber-500 border-2 border-transparent transition-all cursor-pointer"
                style={{ borderRadius: '12px' }}
              >
                <div className="text-3xl mb-2">{area.icon}</div>
                <h3 className="font-semibold text-gray-900">{area.name}</h3>
                <p className="text-xs text-gray-500 mt-1">Service Available</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* GOOGLE MAP */}
      <section className="py-16 md:py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">Visit Our Office</h2>
            <p className="text-gray-600">Come meet us at our office location</p>
          </div>

          <div className="max-w-4xl mx-auto">
            <div className="rounded-xl overflow-hidden shadow-lg mb-6">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3180.779100401284!2d86.07539347483169!3d25.438049077556723!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x39f20f359cf12d09%3A0x25988191c08e803f!2sBihar%20Transport!5e1!3m2!1sen!2sin!4v1773148297082!5m2!1sen!2sin"
                width="100%"
                height="350"
                style={{ border: 0 }}
                allowFullScreen=""
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Bihar Transport Begusarai Location"
              ></iframe>
            </div>

            <div className="text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-1">Bihar Transport Begusarai</h3>
              <p className="text-gray-600 mb-4">Begusarai, Bihar, India</p>
              <a
                href="https://maps.google.com/?q=Bihar+Transport+Begusarai"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-6 py-3 bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 transition-colors cursor-pointer btn-hover-scale"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Open in Google Maps
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Floating WhatsApp Button */}
      <div className="fixed bottom-6 right-6 z-40 group hidden md:flex">
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hello Bihar Transport, I need transport service. Please help.')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center w-14 h-14 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 hover:scale-110 transition-all whatsapp-pulse cursor-pointer"
          aria-label="Chat on WhatsApp"
        >
          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
        </a>
        <span className="absolute right-16 top-1/2 -translate-y-1/2 bg-gray-900 text-white text-sm px-3 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          Chat with us
        </span>
      </div>

      {/* Sticky bottom action bar (Mobile only) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-3 z-50 md:hidden flex items-center gap-2 shadow-lg">
        <a
          href="tel:+918210931799"
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
            />
          </svg>
          Call Now
        </a>
        <a
          href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hello Bihar Transport, I need transport service. Please help.')}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-green-500 text-white rounded-xl font-semibold hover:bg-green-600 transition-colors cursor-pointer"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
          </svg>
          WhatsApp
        </a>
      </div>

      {/* BOOK NOW MODAL */}
      {bookNowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/50" onClick={closeBookNow} aria-hidden="true" />

          <div
            className="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="book-now-modal-title"
          >
            <div className="p-4 md:p-6 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="book-now-modal-title" className="text-lg md:text-xl font-bold text-gray-900">
                    Book Now
                  </h2>
                  {latestQuote?.distanceKm != null && latestQuote?.price != null ? (
                    <p className="text-sm md:text-base text-gray-600 mt-1">
                      {latestQuote.distanceKm} km • ₹{latestQuote.price}
                    </p>
                  ) : (
                    <p className="text-sm md:text-base text-gray-600 mt-1">Confirm your booking details</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={closeBookNow}
                  disabled={bookNowLoading}
                  className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Close"
                >
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleBookNowSubmit} className="p-4 md:p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Pickup</label>
                  <input
                    type="text"
                    value={latestQuote?.pickupAddress || latestQuote?.pickupLocation || ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Drop</label>
                  <input
                    type="text"
                    value={latestQuote?.dropAddress || latestQuote?.dropLocation || ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Vehicle</label>
                  <input
                    type="text"
                    value={latestQuote?.vehicleType || ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Distance</label>
                  <input
                    type="text"
                    value={latestQuote?.distanceKm != null ? `${latestQuote.distanceKm} km` : ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600">Price</label>
                  <input
                    type="text"
                    value={latestQuote?.price != null ? `₹${latestQuote.price}` : ''}
                    readOnly
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-700 text-sm"
                  />
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Customer Name</label>
                  <input
                    type="text"
                    value={bookNowForm.name}
                    onChange={(e) => setBookNowForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Enter customer name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-gray-600">Mobile Number</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={bookNowForm.mobile}
                    onChange={(e) => setBookNowForm((prev) => ({ ...prev, mobile: e.target.value }))}
                    placeholder="Enter 10-digit mobile number"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                  />
                </div>

                <div className="space-y-1 md:col-span-2">
                  <label className="block text-xs font-semibold text-gray-600">Goods Type</label>
                  <input
                    type="text"
                    value={bookNowForm.goods_type}
                    onChange={(e) => setBookNowForm((prev) => ({ ...prev, goods_type: e.target.value }))}
                    placeholder="e.g., Household, Electronics, Furniture"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                  />
                </div>
              </div>

              {bookNowLoading && (
                <div className="mt-4 flex items-center gap-2 text-amber-700 text-sm">
                  <div className="h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" aria-hidden="true" />
                  <span>Submitting booking...</span>
                </div>
              )}

              {bookNowSuccess && (
                <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-green-700 text-sm">
                  {bookNowSuccess}
                </div>
              )}

              {bookNowError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700 text-sm">
                  {bookNowError}
                </div>
              )}

              <div className="mt-6 flex flex-col sm:flex-row gap-3 sm:gap-4">
                <button
                  type="button"
                  onClick={closeBookNow}
                  disabled={bookNowLoading}
                  className="w-full sm:w-auto flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-gray-800 font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={bookNowLoading}
                  className="w-full sm:w-auto flex-1 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {bookNowLoading ? 'Submitting...' : 'Submit'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="h-20 md:hidden"></div>
    </div>
  );
}

export default Home;


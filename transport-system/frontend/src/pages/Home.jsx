import { useState, useEffect, useRef, useMemo } from 'react';
import { bookingAPI } from '../services/api';
import { Link, useNavigate } from 'react-router-dom';
// One Maps script configuration for the whole app. The loader is a per-document
// singleton that throws if a second call uses different `libraries`, so Home must
// go through the shared `useGoogleMapsApi()` — the exact same path as
// /book-transport and the enquiry page.
//
// Home deliberately does NOT mount <LoadScript>/<Autocomplete> any more. In
// @react-google-maps/api@2.20.8 `LoadScript.render()` returns
// `this.state.loaded ? children : <div>Loading…</div>`, so a child <input> only
// exists while the Maps script reports success — and it never does when the
// script is already in the document (`componentDidMount` early-returns) or when
// it 404s / the key is invalid (the `.catch` branch never sets `loaded: true`).
// That is what made the Pickup and Drop boxes disappear. The inputs now render
// unconditionally and Google Places is attached to the live DOM node by
// `usePlacesAutocomplete`, so the field is always visible AND still autocompletes.
import LocationField from '../components/home/LocationField';
// Shared voice-search system — the exact same hook used by /book-transport, so
// there is a single Web Speech API implementation in the app.
import useVoiceSearch from '../hooks/useVoiceSearch';
import SEO from '../components/seo/SEO';
// Shared customer-care contact — SINGLE SOURCE OF TRUTH.
// The same config feeds the enquiry page's Support card, so the number dialled
// from the Home page can never differ from the one shown on the enquiry page.
import { FALLBACK_CUSTOMER_CARE, buildCallUrl } from '../config/customerCare';
import PanIndiaCoverage from '../components/home/PanIndiaCoverage';
import TrustedClients from '../components/home/TrustedClients';

// Shared 18-vehicle fleet catalogue — SINGLE SOURCE OF TRUTH.
// Images, capacities and per-km rate ranges live in
// src/data/vehicleCatalogue.js and are consumed by both Home and BookTransport.
// SVG fallback icons live in src/components/icons/VehicleIcons.jsx and are
// resolved at render time via getVehicleIcon(id) — never stored in the data.
import { vehicleTypes, DEFAULT_VEHICLE_ID } from '../data/vehicleCatalogue';
import { getVehicleIcon } from '../components/icons/VehicleIcons';

// Service areas
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

/**
 * Customer-care contact for the Home page.
 *
 * The number is NOT hardcoded here any more. It comes from the shared
 * customer-care config (config/customerCare.js), which is itself fed by
 * GET /api/enquiries/config/customer-care → the backend's
 * CUSTOMER_CARE_PHONE / CUSTOMER_CARE_WHATSAPP env vars. The enquiry page's
 * Support card already read from that source; this is what makes the Home page
 * and the Support card impossible to disagree.
 *
 * The rendered value is unchanged — it is the same 8210931799 — it is simply
 * now resolved from one place instead of a literal that could drift.
 */
const HOME_WHATSAPP_DIGITS = (FALLBACK_CUSTOMER_CARE.phoneDigits || '').replace(/\D/g, '');
const WHATSAPP_NUMBER =
  HOME_WHATSAPP_DIGITS.length === 10 ? `91${HOME_WHATSAPP_DIGITS}` : HOME_WHATSAPP_DIGITS;
const HOME_CALL_URL = buildCallUrl(FALLBACK_CUSTOMER_CARE);

// (The Google Places options now live with the field that uses them — see
//  `PLACES_OPTIONS` in components/home/LocationField.jsx.)

function Home() {
  const navigate = useNavigate();

  // Quick Booking Form State (used for /book-transport navigation)
  const [quickBooking, setQuickBooking] = useState({
    pickup: '',
    drop: '',
    vehicleType: DEFAULT_VEHICLE_ID
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
    vehicleType: DEFAULT_VEHICLE_ID
  });

  // Live DOM nodes for the hero pickup / drop inputs. `LocationField` writes the
  // mounted node into these refs; the voice hook reads them to inject a
  // transcript exactly as if it had been typed.
  const pickupInputRef = useRef(null);
  const dropInputRef = useRef(null);

  // ─── Voice search (shared Web Speech API hook) ───────────────────────
  // Writes the transcript into the real input node via the native value setter
  // and dispatches a native `input` event, so React's onChange runs AND the
  // existing Google Places Autocomplete re-queries — identical to typing. The
  // customer still has to choose a suggestion; this never sets coordinates,
  // never selects a place, and never touches navigation.
  const handleVoiceResult = (field, transcript) => {
    const node = field === 'pickup' ? pickupInputRef.current : dropInputRef.current;
    if (!node) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    )?.set;
    if (nativeSetter) nativeSetter.call(node, transcript);
    else node.value = transcript;
    // Replaces (never appends to) any half-typed text already present.
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.focus();
  };

  const {
    supported: voiceSupported,
    listeningField,
    interimText: voiceInterimText,
    message: voiceMessage,
    messageField: voiceMessageField,
    clearMessage: clearVoiceMessage,
    toggle: toggleVoice
  } = useVoiceSearch({ onResult: handleVoiceResult });

  // One mic button, reused for both hero fields so the listening / error UI
  // matches /book-transport exactly. Rendered outside <Autocomplete> so that
  // component keeps the <input> as its direct child.
  const renderVoiceButton = (field) => {
    if (!voiceSupported) return null;
    const isListening = listeningField === field;
    const isOtherFieldListening = !!listeningField && listeningField !== field;
    return (
      <button
        type="button"
        onClick={() => toggleVoice(field)}
        disabled={isOtherFieldListening}
        aria-label={`Search ${field} location by voice`}
        title={isListening ? 'Stop listening' : 'Search by voice'}
        aria-pressed={isListening}
        // 36px square inside the 54px field — still a comfortable touch target
        // on mobile, and it never crowds the placeholder text.
        className={`absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
          isListening ? 'bg-red-50 text-red-600' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'
        }`}
      >
        <span className="relative flex items-center justify-center">
          {isListening && (
            <span className="absolute h-4 w-4 animate-ping rounded-full bg-red-400/50" aria-hidden="true" />
          )}
          <svg
            className="relative h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v3" />
          </svg>
        </span>
      </button>
    );
  };

  // Listening preview / inline error. Interim speech is preview only and is
  // never written into the field.
  const renderVoiceStatus = (field) => {
    const isListening = listeningField === field;
    const message = !isListening && voiceMessageField === field ? voiceMessage : '';
    if (!isListening && !message) return null;
    return (
      <div className="absolute left-0 top-full z-30 mt-1 flex items-center gap-1.5 rounded-md bg-slate-900/95 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
        {isListening ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" aria-hidden="true" />
            <span className="max-w-[160px] truncate sm:max-w-none">
              {voiceInterimText ? `Listening… “${voiceInterimText}”` : 'Listening… tap to stop'}
            </span>
            <span className="sr-only" role="status" aria-live="polite">Listening for a location</span>
          </>
        ) : (
          <>
            <span>{message}</span>
            <button
              type="button"
              onClick={clearVoiceMessage}
              aria-label="Dismiss voice search message"
              className="ml-0.5 rounded p-0.5 text-white/70 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
            >
              <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </>
        )}
      </div>
    );
  };

  const [calcDistance, setCalcDistance] = useState(0);
  const [calcDuration, setCalcDuration] = useState('');
  const [calcPrice, setCalcPrice] = useState(0);
  const [calcWarning, setCalcWarning] = useState('');

  const [isCalculating, setIsCalculating] = useState(false);
  const [showPriceResult, setShowPriceResult] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState(null);

  // ===== Fleet Catalogue — Search, Filters & Compare =====
  const [fleetSearch, setFleetSearch] = useState('');
  const [fleetCapacity, setFleetCapacity] = useState('all');
  const [fleetCategory, setFleetCategory] = useState('all');
  const [fleetPriceRange, setFleetPriceRange] = useState('all');
  const [compareList, setCompareList] = useState([]);
  const [compareOpen, setCompareOpen] = useState(false);

  const CAPACITY_FILTERS = [
    { value: 'all', label: 'All Capacities' },
    { value: 'upto1', label: 'Up to 1 Ton', min: 0, max: 1000 },
    { value: '1to3', label: '1 – 3 Ton', min: 1000, max: 3000 },
    { value: '3to8', label: '3 – 8 Ton', min: 3000, max: 8000 },
    { value: '8to15', label: '8 – 15 Ton', min: 8000, max: 15000 },
    { value: 'above15', label: '15 Ton +', min: 15000, max: Infinity }
  ];

  const PRICE_FILTERS = [
    { value: 'all', label: 'All Prices' },
    { value: 'under40', label: 'Under ₹40/km', min: 0, max: 40 },
    { value: '40to60', label: '₹40 – 60/km', min: 40, max: 60 },
    { value: '60to90', label: '₹60 – 90/km', min: 60, max: 90 },
    { value: 'above90', label: '₹90+/km', min: 90, max: Infinity }
  ];

  const CATEGORY_FILTERS = [
    { value: 'all', label: 'All Truck Types' },
    { value: 'Light Commercial', label: 'Light Commercial' },
    { value: 'Heavy Commercial', label: 'Heavy Commercial' },
    { value: 'Container', label: 'Container' }
  ];

  const DISCLAIMER_FACTORS = [
    'Pickup & destination',
    'Road route',
    'Distance',
    'Diesel prices',
    'Loading type',
    'Truck availability',
    'Seasonal demand',
    'Return load availability'
  ];

  const filteredVehicles = useMemo(() => {
    const term = fleetSearch.trim().toLowerCase();
    const capacityFilter = CAPACITY_FILTERS.find((f) => f.value === fleetCapacity);
    const priceFilter = PRICE_FILTERS.find((f) => f.value === fleetPriceRange);

    return vehicleTypes.filter((v) => {
      if (fleetCategory !== 'all' && v.category !== fleetCategory) return false;
      if (
        capacityFilter &&
        capacityFilter.value !== 'all' &&
        (v.capacityKg < capacityFilter.min || v.capacityKg >= capacityFilter.max)
      ) {
        return false;
      }
      if (
        priceFilter &&
        priceFilter.value !== 'all' &&
        (v.price < priceFilter.min || v.price > priceFilter.max)
      ) {
        return false;
      }
      if (term) {
        const haystack = `${v.name} ${v.capacity} ${v.category} ${v.bestFor.join(' ')}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });
  }, [fleetSearch, fleetCapacity, fleetCategory, fleetPriceRange]);

  const toggleCompare = (vehicle) => {
    setCompareList((prev) => {
      if (prev.some((v) => v.id === vehicle.id)) {
        return prev.filter((v) => v.id !== vehicle.id);
      }
      if (prev.length >= 4) return prev;
      return [...prev, vehicle];
    });
  };

  const resetFleetFilters = () => {
    setFleetSearch('');
    setFleetCapacity('all');
    setFleetCategory('all');
    setFleetPriceRange('all');
  };

  const renderVehicleCard = (vehicle) => {
    const isSelected = selectedVehicle === vehicle.id;
    const isCompared = compareList.some((v) => v.id === vehicle.id);
    const VehicleIcon = getVehicleIcon(vehicle.id);

    return (
      <div
        key={vehicle.id}
        onClick={() => handleVehicleClick(vehicle)}
        className={`group relative bg-white rounded-2xl overflow-hidden transition-all duration-300 cursor-pointer border-2 animate-fade-in flex flex-col shrink-0 w-[280px] snap-start md:w-auto ${
          isCompared
            ? 'border-amber-500 shadow-card-hover'
            : 'border-gray-100 hover:border-amber-300 hover:-translate-y-1.5 hover:shadow-card-hover'
        }`}
        style={{ borderRadius: '12px' }}
      >
        <div className="absolute top-3 left-3 z-10">
          <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full bg-blue-900/90 text-white">
            {vehicle.category}
          </span>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <span className="inline-flex items-center px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-500 text-white shadow-sm">
            Estimated Rate
          </span>
        </div>

        <div className="bg-gradient-to-b from-gray-50 to-amber-50/70 pt-14 pb-4 px-4 flex items-center justify-center">
          {vehicle.image ? (
            <img
              src={vehicle.image}
              alt={vehicle.name}
              loading="lazy"
              className="w-full max-w-[220px] h-[150px] object-contain transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="group-hover:scale-105 transition-transform duration-300">
              <VehicleIcon />
            </div>
          )}
        </div>

        <div className="p-5 flex flex-col flex-1">
          <h3 className="text-base font-bold text-gray-900 mb-2 text-center">{vehicle.name}</h3>

          <div className="flex items-center justify-center gap-2 text-sm text-gray-600 mb-1">
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <span className="font-medium">{vehicle.capacity}</span>
          </div>

          <div className="text-center my-3">
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Per Kilometre</span>
            <div className="text-2xl font-extrabold text-amber-600 leading-tight">{vehicle.priceLabel}</div>
          </div>

          <div className="mt-auto">
            <div className="bg-gray-50 rounded-xl px-3 py-3 mb-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Recommended For</p>
              <ul className="space-y-1">
                {vehicle.bestFor.map((item) => (
                  <li key={item} className="flex items-start gap-1.5 text-xs text-gray-700">
                    <span className="text-amber-500 font-bold leading-none mt-0.5">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex gap-2">
              <Link
                to={`/book-transport?vehicle=${vehicle.id}`}
                onClick={(e) => e.stopPropagation()}
                className={`flex-1 text-center py-2.5 rounded-lg font-semibold text-sm transition-colors text-white ${
                  isSelected ? 'bg-amber-600' : 'bg-amber-500 hover:bg-amber-600'
                }`}
              >
                Book Now
              </Link>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleCompare(vehicle); }}
                className={`px-3 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                  isCompared
                    ? 'bg-blue-900 border-blue-900 text-white'
                    : 'border-gray-200 text-gray-700 hover:border-blue-900 hover:text-blue-900'
                }`}
              >
                {isCompared ? '✓ Added' : 'Compare'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

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

  const handleVehicleClick = (vehicle) => {
    setSelectedVehicle(vehicle.id);
    setQuickBooking((prev) => ({ ...prev, vehicleType: vehicle.id }));
  };

  // ===== Hero Pickup / Drop field handlers =====
  // Free typing. Coordinates are deliberately left alone so an already-resolved
  // place is not thrown away mid-edit — a fresh selection overwrites them.
  const handleLocationChange = (field, rawValue) => {
    setPriceCalc((prev) => ({ ...prev, [field]: rawValue }));
    setShowPriceResult(false);
    // Dismiss a stale voice error once the customer carries on by typing.
    clearVoiceMessage();
  };

  // A suggestion was chosen — Google Places or the local fallback. Both hand
  // back the same shape, so one writer handles both sources.
  const handleLocationSelected = (field, selection) => {
    if (!selection?.label) return;
    setPriceCalc((prev) =>
      field === 'pickup'
        ? {
            ...prev,
            pickup: selection.label,
            pickupPlaceId: selection.placeId || '',
            pickupFormattedAddress: selection.label,
            pickupLat: selection.lat ?? null,
            pickupLng: selection.lng ?? null
          }
        : {
            ...prev,
            drop: selection.label,
            dropPlaceId: selection.placeId || '',
            dropFormattedAddress: selection.label,
            dropLat: selection.lat ?? null,
            dropLng: selection.lng ?? null
          }
    );
    setShowPriceResult(false);
    clearVoiceMessage();
  };

  // Continue is gated on a complete, non-blank route: Pickup + Drop + Vehicle.
  // `vehicleType` always carries DEFAULT_VEHICLE_ID, but it is still checked so
  // the gate cannot silently open if that default is ever cleared.
  const hasCompleteRoute = Boolean(
    String(priceCalc.pickup || '').trim() &&
    String(priceCalc.drop || '').trim() &&
    String(priceCalc.vehicleType || '').trim()
  );

  // ===== Continue to Booking Page =====
  const handleContinue = () => {
    if (!hasCompleteRoute) {
      return;
    }

    const params = new URLSearchParams({
      vehicle: priceCalc.vehicleType,
      pickup: priceCalc.pickup,
      drop: priceCalc.drop
    });
    navigate(`/book-transport?${params.toString()}`);
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
    console.log("1. Submit clicked");
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

    console.log("2. Validation passed");

    setBookNowLoading(true);

    try {
      console.log("3. Creating payload");
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

      console.log("4. Payload:", payload);

      console.log("5. About to call bookingAPI.create()");
      const res = await bookingAPI.create(payload);
      console.log("Full Axios Response:", res);
      console.log("Response Data:", res.data);
      console.log("Success field:", res.data.success);
      console.log("6. bookingAPI.create() returned", res);

      if (!res?.data?.success) {
        throw new Error(res?.data?.message || 'Failed to submit booking');
      }

      const bookingRef = res.data.data?.booking_reference;
      setBookNowSuccess('Booking Submitted Successfully.');

      setBookNowForm({ name: '', mobile: '', goods_type: '' });
      setBookNowLoading(false);

      setTimeout(() => {
        setBookNowOpen(false);
        navigate(`/track/${bookingRef}`);
      }, 900);
    } catch (err) {
      console.error("7. Booking submission error:", err);
      setBookNowLoading(false);
      setBookNowError(err?.message || 'Failed to submit booking');
    }
  };

  const handleWhatsApp = () => {
    const message = `Hello Bihar Transport,\n\nI'm interested in booking transport service.\n\nPlease share more details.`;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const renderStars = (rating) => '⭐'.repeat(rating);

  return (
    <>
      <SEO
        title="Bihar Transport | Truck Booking &amp; Goods Transport Since 1998"
        description="Bihar Transport offers reliable truck booking, goods transport, and logistics services across India. Trusted since 1998. FTL, PTL, Pan India services."
        keywords="Bihar Transport, truck booking, goods transport India, logistics services, freight services, truck rental, mini truck booking, goods transport since 1998"
        canonical="https://bihartransport.in/"
        schema={[
          {
            '@context': 'https://schema.org',
            '@type': 'Organization',
            name: 'Bihar Transport',
            url: 'https://bihartransport.in',
            logo: 'https://bihartransport.in/assets/logo.png',
            foundingDate: '1998',
            description: 'Professional goods transport and logistics services since 1998.',
            sameAs: [
              'https://www.facebook.com/bihartransport.in',
              'https://www.linkedin.com/company/bihartransport/',
              'https://www.instagram.com/bihartransport.in/',
            ],
            contactPoint: {
              '@type': 'ContactPoint',
              telephone: '+91-8210931799',
              contactType: 'customer service',
              availableLanguage: ['English', 'Hindi'],
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'LocalBusiness',
            name: 'Bihar Transport',
            image: 'https://bihartransport.in/assets/logo.png',
            telephone: '+91-8210931799',
            email: 'info@bihartransport.in',
            openingHours: 'Mo-Sa 08:00-20:00, Su 09:00-17:00',
            foundingDate: '1998',
            areaServed: ['Begusarai', 'Patna', 'Muzaffarpur', 'Gaya', 'Darbhanga', 'Bihar', 'India'],
            priceRange: '₹₹',
            url: 'https://bihartransport.in',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: 'Bihar Transport',
            url: 'https://bihartransport.in',
            potentialAction: {
              '@type': 'SearchAction',
              target: {
                '@type': 'EntryPoint',
                urlTemplate: 'https://bihartransport.in/search?q={search_term_string}',
              },
              'query-input': 'required name=search_term_string',
            },
          },
          {
            '@context': 'https://schema.org',
            '@type': 'Service',
            name: 'Goods Transportation Services',
            provider: { '@type': 'Organization', name: 'Bihar Transport' },
            areaServed: ['Begusarai', 'Patna', 'Muzaffarpur', 'Gaya', 'Darbhanga', 'Bihar', 'India'],
            serviceType: 'Trucking and Logistics',
          },
          {
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.in/' },
            ],
          },
        ]}
      />
      <div className="overflow-hidden">
      {/* HERO SECTION */}
      <section className="hero-gradient relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-amber-500/20 rounded-full blur-3xl"></div>
          <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl"></div>
        </div>

        {/* RESPONSIVE CONTENT CONTAINER.

            The hero image is a full-bleed `background-size: cover` layer on the
            <section> itself, so the truck is unaffected by anything in here —
            only the content column is constrained. This is a genuine fluid
            container (`min(100% - 2×gutter, 1280px)` + `margin-inline:auto`),
            never a set of absolute pixel coordinates tuned for one 1440px
            screen, so the left content edge is identical in proportion on a
            1366px laptop, a 1440px Air and a 1920px monitor.

            Vertical padding is stepped rather than fixed: `md:py-8 lg:py-10`
            replaces the old `md:py-12` so the headline → booking bar → CTA
            stack still lands inside the first viewport on SHORT laptop screens
            (1280×720, 1366×768) without the composition being crushed. There is
            deliberately NO `min-height: 100vh` anywhere — the hero is sized by
            its own content, so it never becomes letterboxed or over-tall. */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 md:py-8 lg:py-10 relative z-10">
          {/* Hero grid. The second column is deliberately left empty; the booking
              bar below spans both of them (see the note on that card).

              `lg:gap-y-[22px]` is the BASE rhythm of the left column, and the
              booking card adds `lg:mt-2` on top of it, which produces the
              intended spacing ladder:
                  headline → 16px → subtitle → 30px → card → 22px → CTAs
              The CTAs therefore sit closer to the card than the card sits to
              the subtitle, which keeps the bar grouped with the headline
              instead of floating in the middle of the hero. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-x-12 lg:gap-y-[22px] items-center">
            <div className="text-white lg:col-start-1 lg:row-start-1">
              <h1 className="text-xl md:text-3xl lg:text-4xl xl:text-5xl font-bold mb-2 md:mb-4 animate-slide-in-left">
                Reliable Truck &amp; Goods Transport Across India | Bihar Transport
              </h1>
              <p
                className="text-base md:text-xl animate-slide-in-left delay-100"
                style={{ color: '#FFFFFF' }}
              >
                Converting Loads Into Trust Since 1998.
              </p>
            </div>

            {/* Booking bar: Pickup → Drop → Vehicle → Continue.

                A COMPACT, LEFT-ALIGNED widget — never a full-width white band.
                It occupies both hero grid columns (the second column is empty),
                but it is sized INDEPENDENTLY of the hero container:

                  < 640px  : one column, fully stacked, fluid width.
                  640–1023 : two columns (Pickup | Drop / Vehicle | Continue),
                             capped at 620px so it never looks oversized.
                  1024–1279: two columns, clamp floor 660px.
                  ≥ 1280px : ONE ROW of four, clamp(660px, 48vw, 720px).
                  ≥ 1536px : 720px ceiling — the bar stops growing so the
                             photograph stays the hero.

                `justify-self-start` pins it to the left-hand hero content so it
                never centres, and `relative z-20` gives it its own stacking
                context so the autocomplete dropdown can never be painted under
                the hero decorations or the hero image. */}

            {/* ============================ WIDTH ============================
                ROOT CAUSE OF THE "TOO BIG" COMPLAINT:
                the old card chained FIVE hard pixel ceilings —
                    max-w-[540] sm:max-w-[620] lg/xl:max-w-[700]
                    min-[1400px]:max-w-[720] min-[1536px]:max-w-[720]
                — so it jumped 540 → 620 → 700 → 720 at arbitrary breakpoints
                and then sat at a flat 700–720px everywhere above 1400px. On a
                1024px laptop that 700px ceiling was 73% of the 960px hero
                column, which is exactly why the bar read as "a big form
                dropped on a photo" instead of a widget floating on the truck.

                It is now a single continuous clamp, i.e. the card tracks the
                VIEWPORT rather than a lookup table:
                    lg:w-[clamp(660px, 45vw, 700px)]
                      1024px →  660px (floor)
                      1280px →  660px
                      1366px →  660px
                      1440px →  660px
                      1536px →  691px  ← 45vw
                      1600px →  700px  (ceiling)
                      1920px →  700px  (ceiling — the bar does NOT keep growing
                                         on a wide monitor; that restraint is
                                         what keeps the truck dominant)

                45vw with a 700px ceiling is 20px NARROWER than the previous
                48vw/720px at every width — deliberate, because the bar was
                still reading a touch heavy against the photograph.

                The floor stays at 660px for ONE concrete reason: that is the
                narrowest card where the four tracks below still render
                "Enter pickup location" (plus its 42px mic reservation),
                "Enter drop location" and "17 ft Truck" UNCLIPPED on a 1280px
                laptop. Below ~660px every placeholder clips mid-word.

                Because the container is centred, the bar's RIGHT edge lands
                progressively earlier in the frame as the screen grows — so the
                photograph is LESS covered on a big monitor, never more.

                SURFACE — 20px radius (modern, not a pill), a `p-4` inset, and
                `.btb-booking-glow` for the slow warm-amber breath defined in
                `index.css`. The class replaces the Tailwind `shadow-*` utility
                on purpose: it owns the whole `box-shadow` property so the
                keyframes can animate the resting shadow instead of fighting
                it, and it keeps a real static shadow for reduced-motion.

                The border is `border-white/75` per the design direction, with
                the card's `inset 0 1px 0 rgba(255,255,255,.9)` highlight in
                the same shadow stack doing the actual edge definition — a
                literal white hairline on a white card would vanish against the
                photograph and cost the bar its silhouette. */}
            <div className="lg:col-start-1 lg:col-span-2 lg:row-start-2 relative z-20 w-full max-w-[620px] lg:w-[clamp(660px,45vw,700px)] lg:max-w-[700px] lg:mt-2 justify-self-start rounded-[20px] border border-white/75 bg-white btb-booking-glow p-4 animate-slide-in-left delay-200">
              {/* GEOMETRY — the desktop card is ~108px tall:
                     1 (border) + 16 (padding) + 16 (label) + 6 (label gap)
                     + 52 (control) + 16 (padding) + 1 (border) = 108, on a
                 20px radius. Down from the previous 54px controls / 18px
                 padding / 112px, i.e. genuinely smaller rather than merely
                 re-styled. 52px is still a comfortable, comfortably clickable
                 desktop control, and mobile keeps its own roomier treatment
                 through the responsive padding.

                  PROPORTION SYSTEM — 31 / 31 / 20 / 18 % of the inner width,
                  expressed as FRACTIONS so the row re-balances itself at every
                  card width instead of relying on hardcoded pixels. Resolved
                  tracks: ~204/204/132/118 at the 720px ceiling, ~195/195/126/
                  113 at 1440px, ~185/185/120/108 at the 660px floor:
                    • Pickup & Drop at 31% each are the dominant pair — wide
                      enough for the full "Enter pickup location" placeholder
                      AND its microphone button, never a stub. Their 44px
                      right padding (`pr-11`) is reserved INSIDE the track, so
                      the mic never eats into the text.
                    • Vehicle at 20% and Continue at 18% are the narrow pair.
                      This is the single most important rule here: it is what
                      stops Vehicle re-expanding into the row's dominant block
                      and what keeps Continue compact. Vehicle sits a point
                      above Continue only because "17 ft Truck" is a longer
                      string than "Continue →" and was clipping without it.
                    • `minmax(0, …fr)` (not a bare `fr`) so a long address or a
                      long vehicle name shrinks inside its track instead of
                      forcing the row wider than the card.
                    • 8px gaps at xl keep the four fields visually separate
                      without wasting the bar's width.

                  Every control is `h-[54px]`, so Pickup, Drop, the Vehicle
                  select and the Continue button share one baseline. Combined
                  with the 16px label line, the 6px label gap and the 18px
                  card padding, that is a 114px bar — a compact floating
                  widget, not a form. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 xl:gap-2 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1.35fr)_minmax(0,0.9fr)_minmax(0,0.8fr)]">
                <div className="min-w-0">
                  {/* 13px / 600 — small and elegant. The old 12px + `mb-2`
                      shrank the label so much that the control below it read as
                      an unlabelled box. */}
                  <label
                    htmlFor="home-pickup"
                    className="block text-[13px] leading-4 font-semibold text-gray-500 mb-1.5"
                  >
                    Pickup
                  </label>
                  <LocationField
                    id="home-pickup"
                    label="Pickup"
                    placeholder="Enter pickup location"
                    value={priceCalc.pickup}
                    onChange={(value) => handleLocationChange('pickup', value)}
                    onSelectPlace={(selection) => handleLocationSelected('pickup', selection)}
                    inputRef={pickupInputRef}
                    hasMic={voiceSupported}
                    micSlot={renderVoiceButton('pickup')}
                    statusSlot={renderVoiceStatus('pickup')}
                  />
                </div>

                <div className="min-w-0">
                  <label
                    htmlFor="home-drop"
                    className="block text-[13px] leading-4 font-semibold text-gray-500 mb-1.5"
                  >
                    Drop
                  </label>
                  <LocationField
                    id="home-drop"
                    label="Drop"
                    placeholder="Enter drop location"
                    value={priceCalc.drop}
                    onChange={(value) => handleLocationChange('drop', value)}
                    onSelectPlace={(selection) => handleLocationSelected('drop', selection)}
                    inputRef={dropInputRef}
                    hasMic={voiceSupported}
                    micSlot={renderVoiceButton('drop')}
                    statusSlot={renderVoiceStatus('drop')}
                  />
                </div>

                {/* The two actions are wrapped so that BELOW the desktop row
                    they read as one left-aligned group on the second line
                    (Vehicle ▾ | Continue →) with a single clean block of
                    whitespace to their right — instead of the two separate
                    mid-cell voids a plain 2×2 grid leaves behind.

                    `sm:col-span-2 sm:flex` produces that tablet/mobile
                    grouping; `xl:contents` dissolves the wrapper at ≥1280px
                    so Vehicle and Continue become direct grid items of the
                    four-track desktop row again (DOM order is unchanged, so
                    they land in slots 3 and 4). `display:contents` is a layout
                    no-op otherwise — it holds no box, adds no spacing and
                    leaves the sticky/absolute positioning of the children
                    (mic tooltips, suggestion menus) untouched. */}
                <div className="sm:col-span-2 sm:flex sm:items-start sm:gap-3.5 xl:contents">
                  {/* `sm:max-w-[160px]` holds the select at its desktop cap while
                      the tablet action group hands it a much wider cell;
                      `xl:max-w-none` releases it once the four-track desktop row
                      takes over and sizes the track itself. */}
                  <div className="min-w-0 sm:max-w-[150px] xl:max-w-none">
                    <label
                      htmlFor="home-vehicle"
                      className="block text-[13px] leading-4 font-semibold text-gray-500 mb-1.5"
                    >
                      Vehicle
                    </label>
                    {/* `pl-2 pr-6` is the tightest padding that still clears the
                        native chevron. Chrome adds a few px of its own inset to a
                        <select>, so the previous `pl-2.5 pr-8` was clipping
                        "17 ft Truck" to "17 ft Truc" — this trims 8px back out
                        of the name's way. `h-[52px]` + `rounded-[10px]` match
                        the two location inputs exactly, so the select can never
                        read as taller, heavier or differently-cornered than
                        them. */}
                    <select
                      id="home-vehicle"
                      value={priceCalc.vehicleType}
                      onChange={(e) => {
                        setPriceCalc((prev) => ({ ...prev, vehicleType: e.target.value }));
                        setShowPriceResult(false);
                      }}
                      className="block h-[52px] w-full min-w-0 pl-2 pr-6 border border-gray-300 rounded-[10px] focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all cursor-pointer bg-white text-gray-900 text-[13px]"
                    >
                      {vehicleTypes.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
  
                  <div className="flex min-w-0 flex-col sm:max-w-[165px] xl:max-w-none">
                    {/* Invisible twin of the labels above. Same classes → same box
                        height, so the button lines up with the three controls
                        instead of floating up beside them. */}
                    <span
                      aria-hidden="true"
                      className="block text-[13px] leading-4 font-semibold text-transparent mb-1.5 select-none"
                    >
                      Continue
                    </span>
                    {/* `px-2` + a 13px label + a 14px arrow is what lets
                        "Continue →" sit comfortably inside the 18% track
                        (~108–118px) instead of overflowing or wrapping. */}
                    <button
                      type="button"
                      onClick={handleContinue}
                      disabled={!hasCompleteRoute}
                      className="w-full h-[52px] px-2 flex items-center justify-center gap-1.5 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 hover:shadow-lg active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none cursor-pointer text-[13px]"
                      style={{ backgroundColor: '#F5A000' }}
                    >
                      Continue
                      <svg
                        className="w-3.5 h-3.5 shrink-0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>

              {calcWarning && <div className="mt-2 text-xs text-amber-700">{calcWarning}</div>}
            </div>

            {/* CTAs — back in the left column, same width and same buttons as
                before the bar was widened. */}
            <div className="lg:col-start-1 lg:row-start-3">
              <div className="grid grid-cols-1 sm:flex sm:flex-wrap gap-2 md:gap-3 animate-slide-in-left delay-300">
                <Link
                  to="/book-transport"
                  className="w-full sm:w-auto flex-1 md:flex-none px-4 md:px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-all shadow-lg text-center btn-hover-scale cursor-pointer"
                >
                  Book Transport
                </Link>
                <Link
                  to="/partner"
                  className="w-full sm:w-auto flex-1 md:flex-none px-4 md:px-6 py-3 bg-white/10 backdrop-blur text-white rounded-xl font-semibold hover:bg-white/20 transition-all border border-white/30 text-center btn-hover-scale cursor-pointer"
                >
                  Become a Partner
                </Link>
                <a
                  href={HOME_CALL_URL}
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
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0 overflow-hidden" style={{ height: '60px' }}>
          <svg className="w-full h-16 md:h-20 text-gray-50 absolute bottom-0 animate-wave" viewBox="0 0 1440 100" preserveAspectRatio="none">
            <path fill="currentColor" d="M0,40 C360,100 720,0 1080,60 C1260,90 1380,70 1440,50 L1440,100 L0,100 Z" />
          </svg>
        </div>
      </section>

      {/* TRUSTED CLIENTS */}
      <TrustedClients />

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

      {/* FLEET & PRICING CATALOGUE */}
      <section className="py-16 md:py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Section Header */}
          <div className="text-center mb-8">
            <span className="inline-flex items-center px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 mb-4">
              Pricing Engine
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              Choose the Right Truck for Your Goods
            </h2>
            <p className="text-gray-600 max-w-2xl mx-auto">
              Compare truck sizes, loading capacity and estimated per kilometre rates before booking.
            </p>
          </div>

          {/* Search & Filters */}
          <div className="bg-gray-50 rounded-2xl border border-gray-100 p-4 md:p-5 mb-8 shadow-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
              <div className="lg:col-span-2">
                <label className="block text-xs font-semibold text-gray-600 mb-1">Search Vehicle</label>
                <div className="relative">
                  <svg
                    className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={fleetSearch}
                    onChange={(e) => setFleetSearch(e.target.value)}
                    placeholder="Search by name, capacity or use…"
                    className="w-full pl-9 pr-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Capacity Filter</label>
                <select
                  value={fleetCapacity}
                  onChange={(e) => setFleetCapacity(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm cursor-pointer"
                >
                  {CAPACITY_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Truck Type</label>
                <select
                  value={fleetCategory}
                  onChange={(e) => setFleetCategory(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm cursor-pointer"
                >
                  {CATEGORY_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Price Range</label>
                <select
                  value={fleetPriceRange}
                  onChange={(e) => setFleetPriceRange(e.target.value)}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none transition-all bg-white text-gray-700 text-sm cursor-pointer"
                >
                  {PRICE_FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-gray-500">
                Showing <span className="font-semibold text-gray-800">{filteredVehicles.length}</span> of{' '}
                <span className="font-semibold text-gray-800">{vehicleTypes.length}</span> vehicles
              </p>
              <button
                type="button"
                onClick={resetFleetFilters}
                className="text-xs font-semibold text-amber-600 hover:text-amber-700 hover:underline transition-colors cursor-pointer"
              >
                Clear All Filters
              </button>
            </div>
          </div>

          {/* Mobile: Horizontal Slider */}
          <div className="md:hidden -mx-4 px-4">
            {filteredVehicles.length > 0 ? (
              <>
                <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-4">
                  {filteredVehicles.map((vehicle) => renderVehicleCard(vehicle))}
                </div>
                <p className="text-xs text-gray-400 text-center mb-2">← Swipe to explore more vehicles →</p>
              </>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100">
                <p className="text-3xl mb-2">🚛</p>
                <p className="font-semibold text-gray-800">No vehicles match your filters</p>
                <p className="text-sm text-gray-500 mt-1">Try adjusting or clearing the filters above.</p>
                <button
                  type="button"
                  onClick={resetFleetFilters}
                  className="mt-4 px-5 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>

          {/* Desktop/Tablet: Grid — 4 per row on xl */}
          <div className="hidden md:block">
            {filteredVehicles.length > 0 ? (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredVehicles.map((vehicle) => renderVehicleCard(vehicle))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-2xl border border-gray-100">
                <p className="text-3xl mb-2">🚛</p>
                <p className="font-semibold text-gray-800">No vehicles match your filters</p>
                <p className="text-sm text-gray-500 mt-1">Try adjusting or clearing the filters above.</p>
                <button
                  type="button"
                  onClick={resetFleetFilters}
                  className="mt-4 px-5 py-2.5 bg-amber-500 text-white text-sm font-semibold rounded-lg hover:bg-amber-600 transition-colors cursor-pointer"
                >
                  Clear Filters
                </button>
              </div>
            )}
          </div>

          {/* Disclaimer — Rates are estimates */}
          <div className="mt-10 bg-gradient-to-br from-blue-50 to-amber-50/60 rounded-2xl border border-gray-100 p-5 md:p-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-9 h-9 bg-blue-900 rounded-xl flex items-center justify-center text-white mt-0.5">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h4 className="font-bold text-gray-900 mb-1.5">
                  These rates are estimated — not final freight charges
                </h4>
                <p className="text-sm text-gray-600 mb-3">
                  Actual transport cost depends on the following factors:
                </p>
                <div className="flex flex-wrap gap-2">
                  {DISCLAIMER_FACTORS.map((factor) => (
                    <span
                      key={factor}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-white/80 border border-gray-200 rounded-full text-gray-700"
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                      {factor}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Floating Compare Pill */}
      {compareList.length > 0 && (
        <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-40">
          <button
            type="button"
            onClick={() => setCompareOpen(true)}
            className="flex items-center gap-2 pl-4 pr-5 py-3 bg-blue-900 text-white rounded-full shadow-xl hover:bg-blue-950 transition-colors cursor-pointer animate-fade-in"
          >
            <span className="flex -space-x-2">
              {compareList.slice(0, 4).map((v) => {
                const Icon = getVehicleIcon(v.id);
                return (
                  <span key={v.id} className="w-7 h-7 rounded-full bg-white/20 border-2 border-blue-900 flex items-center justify-center overflow-hidden">
                    {v.image ? (
                      <img src={v.image} alt={v.name} loading="lazy" className="w-full h-full object-contain" />
                    ) : (
                      <Icon />
                    )}
                  </span>
                );
              })}
            </span>
            <span className="text-sm font-semibold">Compare ({compareList.length})</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      )}

      {/* Compare Modal */}
      {compareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3">
          <div className="absolute inset-0 bg-black/50" onClick={() => setCompareOpen(false)} aria-hidden="true" />

          <div
            className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden animate-scale-in"
            role="dialog"
            aria-modal="true"
            aria-labelledby="compare-modal-title"
          >
            <div className="p-4 md:p-6 border-b border-gray-100">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 id="compare-modal-title" className="text-lg md:text-xl font-bold text-gray-900">
                    Compare Vehicles
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Select up to 4 vehicles to compare rates and capacity side-by-side.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 cursor-pointer"
                  aria-label="Close"
                >
                  <span className="text-xl leading-none">×</span>
                </button>
              </div>
            </div>

            <div className="p-4 md:p-6">
              {compareList.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No vehicles selected yet. Tap "Compare" on any vehicle card.</p>
                </div>
              ) : (
                <div className="overflow-x-auto scrollbar-hide">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 pr-3 text-xs font-bold uppercase tracking-wide text-gray-500 w-32">
                          Vehicle
                        </th>
                        {compareList.map((v) => (
                          <th key={v.id} className="text-center py-3 px-2 align-top">
                            <div className="inline-flex items-center justify-center w-12 h-12 bg-gray-50 rounded-xl mb-2 overflow-hidden">
                              {v.image ? (
                                <img src={v.image} alt={v.name} loading="lazy" className="w-full h-full object-contain" />
                              ) : (
                                (() => { const Icon = getVehicleIcon(v.id); return <Icon />; })()
                              )}
                            </div>
                            <div className="font-bold text-gray-900 leading-tight">{v.name}</div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="py-3 pr-3 font-semibold text-gray-600">Category</td>
                        {compareList.map((v) => (
                          <td key={v.id} className="py-3 px-2 text-center">
                            <span className="inline-block px-2 py-0.5 text-[11px] font-bold uppercase rounded-full bg-blue-900/10 text-blue-900">
                              {v.category}
                            </span>
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-3 pr-3 font-semibold text-gray-600">Capacity</td>
                        {compareList.map((v) => (
                          <td key={v.id} className="py-3 px-2 text-center font-medium text-gray-800">{v.capacity}</td>
                        ))}
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-3 pr-3 font-semibold text-gray-600">Est. Rate / km</td>
                        {compareList.map((v) => (
                          <td key={v.id} className="py-3 px-2 text-center">
                            <span className="text-lg font-extrabold text-amber-600">{v.priceLabel}</span>
                          </td>
                        ))}
                      </tr>
                      <tr className="border-b border-gray-100">
                        <td className="py-3 pr-3 font-semibold text-gray-600 align-top">Recommended For</td>
                        {compareList.map((v) => (
                          <td key={v.id} className="py-3 px-2">
                            <ul className="space-y-1 text-xs text-gray-600 text-center">
                              {v.bestFor.map((item) => (
                                <li key={item}>{item}</li>
                              ))}
                            </ul>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-3 pr-3" />
                        {compareList.map((v) => (
                          <td key={v.id} className="py-3 px-2 text-center">
                            <Link
                              to={`/book-transport?vehicle=${v.id}`}
                              onClick={() => setCompareOpen(false)}
                              className="inline-block w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                              Book Now
                            </Link>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-5 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setCompareList([])}
                  className="px-4 py-2.5 text-sm font-semibold text-gray-500 hover:text-red-600 hover:underline transition-colors cursor-pointer"
                >
                  Clear All
                </button>
                <button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  className="px-6 py-2.5 bg-blue-900 hover:bg-blue-950 text-white text-sm font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* PAN INDIA COVERAGE */}
      <PanIndiaCoverage />

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
                title="Bihar Transport Office Location"
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
          href={HOME_CALL_URL}
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
                    value={latestQuote?.vehicleName || latestQuote?.vehicleType || ''}
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
    </>
  );
}

export default Home;


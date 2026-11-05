import { useState, useContext, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { GoogleMap, Marker, DirectionsRenderer, StandaloneSearchBox } from '@react-google-maps/api';
// The Maps script is configured in exactly one module (see the file header for
// the crash this prevents). Every page and component shares those options.
import { useGoogleMapsApi } from '../services/googleMapsLoader';
import { AuthContext } from '../contexts/AuthContext';
import { bookingAPI, mapsAPI } from '../services/api';
// Enquiry intake: "Submit Booking" now creates a pre-booking enquiry instead
// of forcing a login. The confirmation page is reached directly, and a Booking
// is only created server-side once an admin quotes and the customer accepts.
import { enquiryAPI, extractCreatedEnquiry } from '../services/enquiryAPI';
// The "Book via WhatsApp" recipient is resolved from the single source of truth
// (backend customer-care config) rather than a number embedded in this file.
import { fetchCustomerCare } from '../config/customerCare';
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
// Browser-native Web Speech API voice input for the pickup / drop location
// fields. Produces text only — it never bypasses Google Places.
import useVoiceSearch from '../hooks/useVoiceSearch';
// Shared booking form utilities
// NOTE: the "Rate As Per" / "Rate" helpers (RATE_AS_PER_*, getRateAsPerLabel,
// isRateRequired, calculateFreight) are deliberately NOT imported here. Pricing
// is an internal concern — the customer never chooses a rate basis or types a
// rate. They stay exported from utils/bookingForm.js for internal/admin use.
import {
  formatPriceRange,
  calculatePriceRange,
  formatDistance,
  weightToKg,
  formatWeight,
  formatPickupDate,
  formatPickupTime,
  isVehicleSuitable,
  getRecommendedVehicle,
  getSuitableVehicles,
  validateBookingForm,
  isPastDate,
  getDefaultPickupDate,
  getDefaultPickupTime,
  saveBookingDraft,
  loadBookingDraft,
  clearBookingDraft,
  getCachedRoute,
  setCachedRoute,
  buildRouteCacheKey,
  formatQuantity,
  getVehicleDisplayName,
  getVehicleCapacity,
  getVehiclePriceLabel,
  getVehicleCapacityKg,
  debounce
} from '../utils/bookingForm';

// Bihar region center coordinates
const BIHAR_CENTER = { lat: 25.6200, lng: 85.8900 };


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

/**
 * Convert an OPTIONAL numeric form field into what the API expects.
 *
 * Number('') is 0, and posting 0 for a question the customer never answered
 * is a lie the operations team would act on ("0 tonnes") — so an empty field
 * must travel as null and stay null all the way into the database.
 *
 * @param {string|number|null|undefined} value
 * @returns {number|null}
 */
const toOptionalNumber = (value) => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (str === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalise an optional free-text field: whitespace-only and '' both mean
 * "not answered", which is null — never a placeholder string.
 *
 * @param {string|null|undefined} value
 * @returns {string|null}
 */
const toOptionalText = (value) => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str === '' ? null : str;
};

// Journey steps shown in the header progress indicator.
// The real customer journey is: choose a vehicle → set the route → describe the
// shipment → review. The form still renders three internal steps, so the
// display steps are mapped onto them:
//
//   display 1 (Vehicle) ┐
//   display 2 (Route)   ┘ → form step 1
//   display 3 (Shipment)  → form step 2
//   display 4 (Review)    → form step 3
const STEPS = [
  { id: 1, label: 'Vehicle' },
  { id: 2, label: 'Route' },
  { id: 3, label: 'Shipment' },
  { id: 4, label: 'Review' },
];

const DISPLAY_STEP_TO_FORM_STEP = { 1: 1, 2: 1, 3: 2, 4: 3 };

// Which internal form step owns each validated field. Used to decide WHEN a
// validation message is relevant — never before the user asks for it.
//
// Step 2 owns only the pickup schedule. The shipment fields (material,
// quantity, weight, category, handling, instructions) are deliberately absent:
// an unanswered shipment question must never stop the customer moving on, so
// there is nothing to reveal and nothing to own.
const STEP_FIELDS = {
  1: ['pickup_location', 'drop_location', 'vehicle_type_required'],
  2: ['pickup_date', 'pickup_time'],
  3: [],
};

const formStepForField = (name) =>
  Number(Object.keys(STEP_FIELDS).find((step) => STEP_FIELDS[step].includes(name)) || 1);

// Quantity units
const quantityUnits = [
  'Bags', 'Boxes', 'Bundles', 'PCS', 'Pieces', 'Cartons',
  'Drums', 'Pallets', 'Crates', 'Units', 'LOOSE'
];

// Weight units
const weightUnits = [
  'KG', 'Tons', 'Quintal', 'Metric Ton', 'FTL'
];

// Generic logistics categories for the existing `goods_type` string field.
// Plain labels only — the backend stores an opaque String?, so no new
// category taxonomy is introduced on the server.
const goodsCategories = [
  'General goods',
  'Construction material',
  'Machinery',
  'Furniture',
  'Agricultural goods',
  'Industrial goods',
  'Other',
];

// Shared input/select styling so the Shipment step matches the Route step.
const shipmentFieldClass = (hasError) => [
  'h-14 w-full rounded-xl border bg-white px-3.5 text-[15px] text-slate-900 outline-none',
  'transition placeholder:text-slate-400 focus:ring-4',
  hasError
    ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
    : 'border-slate-200 hover:border-slate-300 focus:border-amber-400 focus:ring-amber-100',
].join(' ');

// Customer-care contact is NOT hardcoded here. It is resolved at click time
// from config/customerCare.js, which reads the authoritative value published by
// GET /api/enquiries/config/customer-care (backed by the backend's
// CUSTOMER_CARE_* environment variables). One source of truth, no drift.

function BookTransport() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const vehicleParam = searchParams.get('vehicle') || '';
  // Read pickup/drop location strings passed from the Homepage quick-booking flow.
  const pickupFromUrl = searchParams.get('pickup') || '';
  const dropFromUrl = searchParams.get('drop') || '';

  // Google Maps API loader — shared, single-instance configuration.
  const { isLoaded, loadError, hasApiKey } = useGoogleMapsApi();

  // ─── Map locations state ──────────────────────────────────────────────
  const [pickupLocation, setPickupLocation] = useState(null);
  const [dropLocation, setDropLocation] = useState(null);
  const [pickupStructured, setPickupStructured] = useState(null);
  const [dropStructured, setDropStructured] = useState(null);

  // ─── Route calculation state ──────────────────────────────────────────
  const [routeStatus, setRouteStatus] = useState('idle'); // 'idle' | 'calculating' | 'success' | 'error'
  const [routeError, setRouteError] = useState('');
  const [routeData, setRouteData] = useState(null); // { distanceKm, duration, price, rate, rateMin, rateMax }
  const [directions, setDirections] = useState(null);

  // ─── Price estimation state ───────────────────────────────────────────
  const [priceRange, setPriceRange] = useState(null); // { min, max, label }

  // ─── Form state ───────────────────────────────────────────────────────
  const preselectedFleetVehicle = resolveVehicleParam(vehicleParam);
  const initialVehicleType = preselectedFleetVehicle || DEFAULT_VEHICLE_ID;

  const [formData, setFormData] = useState({
    pickup_location: pickupFromUrl,
    pickup_address: '',
    pickup_city: 'Begusarai',
    pickup_date: getDefaultPickupDate(),
    pickup_time: getDefaultPickupTime(),
    drop_location: dropFromUrl,
    drop_address: '',
    drop_city: '',
    goods_description: '',
    goods_type: '',
    goods_weight_kg: '',
    number_of_items: 1,
    fragile: false,
    material: '',
    quantity: '',
    quantity_unit: '',
    weight_value: '',
    weight_unit: '',
    // Free-text handling/delivery notes. Optional; persisted in the local draft.
    special_instructions: '',
    // Contact details. Required because "Submit Booking" no longer forces a
    // login — these are how the transport team reaches the customer about this
    // request. Prefilled from the logged-in user when there is one (see the
    // prefill effect below) and always editable, pre-filled or not.
    customer_name: '',
    customer_mobile: '',
    vehicle_type_required: initialVehicleType
  });

  // ─── UI state ─────────────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(1);
  // Furthest form step reached — keeps completed steps navigable after an edit.
  const [maxStepReached, setMaxStepReached] = useState(1);
  // Validation is *deferred*, never speculative. `attemptedSteps` turns on the
  // error copy for a whole form step once the user has tried to move past it;
  // `touchedFields` turns it on for a single field the user has actually
  // interacted with. Until then the page stays calm and error-free.
  const [attemptedSteps, setAttemptedSteps] = useState({ 1: false, 2: false, 3: false });
  const [touchedFields, setTouchedFields] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  // Synchronous duplicate-submit latch. `disabled={isSubmitting}` is not enough on
  // its own: setState does not take effect until the next render, so two clicks
  // inside the same frame would both pass the check and create TWO enquiries.
  // A ref is written immediately, so the second click is dropped before it can
  // reach the API. Released in `finally`, and never before.
  const submitLockRef = useRef(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitSuccessData, setSubmitSuccessData] = useState(null);
  const [showReview, setShowReview] = useState(false);
  const [isDesktop, setIsDesktop] = useState(typeof window !== 'undefined' && window.innerWidth >= 1024);
  // Optional address inputs are collapsed by default to keep the route section compact.
  const [showAddressDetails, setShowAddressDetails] = useState(
    () => !!(formData.pickup_address || formData.drop_address)
  );
  // Scroll-spy: which of the two step-1 sections the customer is actually looking at.
  const [routeInView, setRouteInView] = useState(false);

  // Refs
  const vehicleCarouselRef = useRef(null);
  const routeSectionRef = useRef(null);
  // Live DOM nodes for every voice-enabled field (pickup, drop, material,
  // special instructions). Transcripts are written through these (native value
  // setter + input event) so each field reacts exactly as it does to typing —
  // and so the EXISTING Google Places autocomplete still runs for locations.
  const voiceFieldRefs = useRef({});
  // Lets a failed submission pull the confirmation block into view, so the
  // customer reads the reason without scrolling back up to the page banner.
  const reviewConfirmRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  // Fallback scroll step/gap when a card cannot be measured (card 236px + 14px gap).
  const VEHICLE_CARD_STEP = 250;
  const VEHICLE_CARD_GAP = 14;
  const carouselRafRef = useRef(0);
  const [pickupSearchBox, setPickupSearchBox] = useState(null);
  const [dropSearchBox, setDropSearchBox] = useState(null);

  // ─── Viewport tracking ────────────────────────────────────────────────
  useEffect(() => {
    const onResize = () => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
      setIsDesktop(w >= 1024);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Remember the furthest step reached so completed steps stay navigable
  // after the customer jumps back to edit something on Review.
  useEffect(() => {
    setMaxStepReached((prev) => (currentStep > prev ? currentStep : prev));
  }, [currentStep]);

  // ─── Stepper scroll-spy ───────────────────────────────────────────────
  // Form step 1 renders two sections back to back. Track which one the
  // customer is actually looking at so the stepper never claims "Route" is
  // active while the first thing on screen is the vehicle carousel.
  // The route section only counts as "current" once its heading has reached
  // the upper part of the viewport — merely peeking below the fold is not
  // enough to steal the highlight from the vehicle cards.
  useEffect(() => {
    setRouteInView(false);
    if (currentStep !== 1) return undefined;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const el = routeSectionRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const threshold = Math.min(window.innerHeight * 0.35, 260);
      setRouteInView(top <= threshold);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [currentStep]);

  // Re-open the optional address inputs if a draft or URL already carries one.
  useEffect(() => {
    if (formData.pickup_address || formData.drop_address) setShowAddressDetails(true);
  }, [formData.pickup_address, formData.drop_address]);

  // ─── Form persistence (localStorage draft) ────────────────────────────
  // Load draft on mount (only if no URL params override)
  useEffect(() => {
    if (!pickupFromUrl && !dropFromUrl && !vehicleParam) {
      const draft = loadBookingDraft();
      if (draft) {
        setFormData((prev) => ({
          ...prev,
          ...draft,
          vehicle_type_required: draft.vehicle_type_required || initialVehicleType,
        }));
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save draft whenever formData changes (debounced to avoid excessive writes)
  const saveDraftDebounced = useRef(
    debounce((data) => saveBookingDraft(data), 1000)
  ).current;

  useEffect(() => {
    saveDraftDebounced(formData);
  }, [formData, saveDraftDebounced]);

  // Sync pickup/drop location strings from URL params into form state.
  useEffect(() => {
    setFormData((prev) => {
      const next = { ...prev };
      if (pickupFromUrl && !prev.pickup_location) {
        next.pickup_location = pickupFromUrl;
      }
      if (dropFromUrl && !prev.drop_location) {
        next.drop_location = dropFromUrl;
      }
      return next;
    });
  }, [pickupFromUrl, dropFromUrl]);

  // ─── Vehicle Selector Carousel ────────────────────────────────────────
  const updateCarouselArrows = useCallback(() => {
    const el = vehicleCarouselRef.current;
    if (!el) return;
    // Compare against the real scroll bounds with a sub-pixel tolerance —
    // a raw `scrollLeft > 4` test left the left arrow stuck on screen after a
    // smooth scroll settled on a fractional offset at position 0.
    const maxScroll = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < maxScroll - 2);
  }, []);

  const handleCarouselScroll = useCallback(() => {
    if (carouselRafRef.current) return;
    carouselRafRef.current = requestAnimationFrame(() => {
      carouselRafRef.current = 0;
      updateCarouselArrows();
    });
  }, [updateCarouselArrows]);

  // Card width and gap are responsive, so both are read from the live DOM
  // rather than hard-coded — this keeps the arrow/keyboard step exactly equal
  // to one card + one gap at every breakpoint.
  const getCarouselStep = useCallback(() => {
    const el = vehicleCarouselRef.current;
    if (!el) return VEHICLE_CARD_STEP;
    const card = el.querySelector('[data-vehicle-id]');
    if (!card) return VEHICLE_CARD_STEP;
    const styles = window.getComputedStyle(el);
    const gap = parseFloat(styles.columnGap || styles.gap);
    return card.offsetWidth + (Number.isFinite(gap) ? gap : VEHICLE_CARD_GAP);
  }, [VEHICLE_CARD_STEP, VEHICLE_CARD_GAP]);

  // Scrolls exactly one card + gap.
  const scrollCarouselByCard = useCallback((direction) => {
    const el = vehicleCarouselRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * getCarouselStep(), behavior: 'smooth' });
  }, [getCarouselStep]);

  const handleCarouselKeyDown = useCallback((e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const el = vehicleCarouselRef.current;
    if (!el) return;
    el.scrollBy({
      left: (e.key === 'ArrowLeft' ? -1 : 1) * getCarouselStep(),
      behavior: 'smooth'
    });
  }, [getCarouselStep]);

  useEffect(() => {
    updateCarouselArrows();
    window.addEventListener('resize', updateCarouselArrows);
    return () => {
      window.removeEventListener('resize', updateCarouselArrows);
      if (carouselRafRef.current) cancelAnimationFrame(carouselRafRef.current);
    };
  }, [updateCarouselArrows]);

  // The customer's FIRST view of this step always starts at position 0 — the
  // default selection sits mid-catalogue, and scrolling to it is what used to
  // slice the first card in half on load. Only once they have been away (e.g.
  // returned via the stepper) do we gently reveal the chosen card, and then
  // only by as much as is needed to bring it fully into view.
  // Park the chosen vehicle third from the left, with two vehicles before it
  // for context. This is a deliberate, repeatable landing spot: it always shows
  // the customer's selection, and because the target is clamped to >= 0 the
  // first card can never end up sliced in half. (The previous behaviour scrolled
  // the selected card to the centre, which cut the first card on load.)
  const positionSelectedVehicle = useCallback(() => {
    const el = vehicleCarouselRef.current;
    const card = el?.querySelector(
      `[data-vehicle-id="${formData.vehicle_type_required}"]`
    );
    if (!el || !card) return;

    const offsetIntoContent =
      card.getBoundingClientRect().left - el.getBoundingClientRect().left;
    const step = getCarouselStep();

    // Preferred position is "third from the left", but on a narrow screen that
    // would push the chosen card off the right edge — so clamp the offset to
    // whatever keeps it fully visible.
    const desiredOffset = step * 2;
    const maxOffset = Math.max(0, el.clientWidth - card.offsetWidth - 4);
    const offset = Math.min(desiredOffset, maxOffset);

    const target = el.scrollLeft + offsetIntoContent - offset;
    const max = el.scrollWidth - el.clientWidth;

    el.scrollTo({ left: Math.max(0, Math.min(target, max)), behavior: 'smooth' });
    updateCarouselArrows();
  }, [formData.vehicle_type_required, updateCarouselArrows, getCarouselStep]);

  useEffect(() => {
    if (currentStep !== 1) return undefined;
    const t = setTimeout(positionSelectedVehicle, 250);
    return () => clearTimeout(t);
  }, [positionSelectedVehicle, currentStep]);

  // Re-apply on resize so rotating a phone or resizing a window never leaves
  // the chosen card stranded off-screen.
  useEffect(() => {
    if (currentStep !== 1) return undefined;
    let t = 0;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(positionSelectedVehicle, 150);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, [positionSelectedVehicle, currentStep]);

  // ─── Route calculation via backend API ────────────────────────────────
  // Uses the backend /api/calculate-price endpoint which proxies Google Maps
  // Distance Matrix API — keeping the API key server-side.
  // Falls back to client-side Google Maps Directions API when the backend
  // is unavailable but a client API key exists.
  const calculateRoute = useCallback(async () => {
    if (!pickupLocation?.lat || !dropLocation?.lat) return;

    // Check for same location
    if (
      pickupLocation.lat === dropLocation.lat &&
      pickupLocation.lng === dropLocation.lng
    ) {
      setRouteStatus('error');
      setRouteError('Pickup and drop locations cannot be the same.');
      setRouteData(null);
      setDirections(null);
      return;
    }

    // Check cache first (dedupe identical requests)
    const cacheKey = buildRouteCacheKey(pickupLocation, dropLocation, formData.vehicle_type_required);
    const cached = getCachedRoute(cacheKey);
    if (cached) {
      setRouteData(cached);
      setRouteStatus('success');
      setRouteError('');
      return;
    }

    setRouteStatus('calculating');
    setRouteError('');

    try {
      // Try backend API first (keeps Google API key server-side)
      const response = await mapsAPI.calculatePrice({
        pickup: {
          lat: pickupLocation.lat,
          lng: pickupLocation.lng,
          address: pickupLocation.address || formData.pickup_location,
        },
        drop: {
          lat: dropLocation.lat,
          lng: dropLocation.lng,
          address: dropLocation.address || formData.drop_location,
        },
        vehicleType: formData.vehicle_type_required,
      });

      if (response.data.success) {
        const data = {
          distanceKm: response.data.distanceKm,
          duration: response.data.duration,
          price: response.data.price,
          rate: response.data.rate,
          rateMin: response.data.rateMin,
          rateMax: response.data.rateMax,
          warning: response.data.warning,
        };
        setRouteData(data);
        setRouteStatus('success');
        setRouteError('');
        setCachedRoute(cacheKey, data);

        // Also try to get directions for the map (client-side, if API key available)
        if (hasApiKey && isLoaded) {
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
              }
            }
          );
        }
      } else {
        throw new Error(response.data.message || 'Failed to calculate route');
      }
    } catch (err) {
      // Fallback: try client-side Google Maps if API key is available
      if (hasApiKey && isLoaded) {
        try {
          const service = new window.google.maps.DistanceMatrixService();
          const results = await new Promise((resolve, reject) => {
            service.getDistanceMatrix(
              {
                origins: [new window.google.maps.LatLng(pickupLocation.lat, pickupLocation.lng)],
                destinations: [new window.google.maps.LatLng(dropLocation.lat, dropLocation.lng)],
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
            const distKm = Math.round(results.rows[0].elements[0].distance.value / 1000);
            const vehicle = getVehicleById(formData.vehicle_type_required);
            const data = {
              distanceKm: distKm,
              duration: '—',
              price: Math.round(distKm * (vehicle?.price || 50)),
              rate: vehicle?.price || 50,
              rateMin: vehicle?.priceMin || 45,
              rateMax: vehicle?.priceMax || 55,
            };
            setRouteData(data);
            setRouteStatus('success');
            setRouteError('');
            setCachedRoute(cacheKey, data);
          } else {
            throw new Error('Unable to calculate distance');
          }
        } catch (fallbackErr) {
          setRouteStatus('error');
          setRouteError('Unable to calculate route. Please verify your locations.');
          setRouteData(null);
        }
      } else {
        setRouteStatus('error');
        setRouteError('Unable to calculate route. Please verify your locations.');
        setRouteData(null);
      }
    }
  }, [pickupLocation, dropLocation, formData.vehicle_type_required, hasApiKey, isLoaded]);

  // Auto-calculate route when both locations are selected
  useEffect(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      calculateRoute();
    }
  }, [pickupLocation, dropLocation, calculateRoute]);

  // Reset route when either location changes
  useEffect(() => {
    if (!pickupLocation?.lat || !dropLocation?.lat) {
      setRouteStatus('idle');
      setRouteData(null);
      setDirections(null);
      setRouteError('');
    }
  }, [pickupLocation, dropLocation]);

  // ─── Price range calculation ──────────────────────────────────────────
  // Updates whenever route data or vehicle changes
  useEffect(() => {
    if (routeData?.distanceKm && routeData.rateMin && routeData.rateMax) {
      const range = calculatePriceRange(routeData.distanceKm, routeData.rateMin, routeData.rateMax);
      setPriceRange(range);
    } else if (routeData?.distanceKm) {
      // Fallback: use vehicle catalogue rates
      const vehicle = getVehicleById(formData.vehicle_type_required);
      if (vehicle) {
        const range = calculatePriceRange(routeData.distanceKm, vehicle.priceMin, vehicle.priceMax);
        setPriceRange(range);
      }
    } else {
      setPriceRange(null);
    }
  }, [routeData, formData.vehicle_type_required]);

  // ─── Derived values ───────────────────────────────────────────────────
  const distanceKm = routeData?.distanceKm || 0;
  const estimatedPriceMin = priceRange?.min || 0;
  const estimatedPriceMax = priceRange?.max || 0;
  const estimatedPriceLabel = priceRange?.label || '—';

  // Weight in kg for vehicle recommendation
  const weightKg = weightToKg(formData.weight_value, formData.weight_unit);

  // Vehicle recommendation
  const recommendedVehicle = useMemo(() => {
    if (!weightKg) return null;
    const currentVehicle = getVehicleById(formData.vehicle_type_required);
    if (currentVehicle && isVehicleSuitable(currentVehicle, weightKg)) return null;
    return getRecommendedVehicle(weightKg);
  }, [weightKg, formData.vehicle_type_required]);

  // Vehicle capacity warning
  const vehicleCapacityWarning = useMemo(() => {
    if (!weightKg) return null;
    const currentVehicle = getVehicleById(formData.vehicle_type_required);
    if (!currentVehicle) return null;
    if (isVehicleSuitable(currentVehicle, weightKg)) return null;
    return `This vehicle may not be suitable for ${formatWeight(formData.weight_value, formData.weight_unit)}.`;
  }, [weightKg, formData.vehicle_type_required, formData.weight_value, formData.weight_unit]);

  // ─── Location extraction ──────────────────────────────────────────────
  const extractStructuredLocation = (place) => {
    if (!place) return null;
    let city = '';
    let state = '';
    let country = '';
    if (place.address_components) {
      for (const c of place.address_components) {
        const t = c.types;
        if (t.includes('locality')) city = c.long_name;
        else if (t.includes('administrative_area_level_1')) state = c.short_name || c.long_name;
        else if (t.includes('country')) country = c.long_name;
        if (city && state && country) break;
      }
    }
    return {
      city,
      state,
      country,
      place_id: place.place_id || '',
      formatted_address: place.formatted_address || '',
      name: place.name || '',
      lat: place.geometry?.location?.lat(),
      lng: place.geometry?.location?.lng()
    };
  };

  const onPickupLoad = useCallback((ref) => {
    setPickupSearchBox(ref);
  }, []);

  const onPickupPlacesChanged = useCallback(() => {
    if (pickupSearchBox) {
      const places = pickupSearchBox.getPlaces();
      if (places && places.length > 0) {
        const place = places[0];
        const structured = extractStructuredLocation(place);
        if (!structured) return;
        const location = {
          lat: structured.lat,
          lng: structured.lng,
          address: structured.formatted_address,
          name: structured.name
        };
        setPickupLocation(location);
        setPickupStructured(structured);
        setRouteError('');
        setFormData(prev => ({
          ...prev,
          pickup_location: structured.name || structured.formatted_address,
          pickup_address: structured.formatted_address,
          pickup_city: structured.city || prev.pickup_city
        }));
      }
    }
  }, [pickupSearchBox]);

  const onDropLoad = useCallback((ref) => {
    setDropSearchBox(ref);
  }, []);

  const onDropPlacesChanged = useCallback(() => {
    if (dropSearchBox) {
      const places = dropSearchBox.getPlaces();
      if (places && places.length > 0) {
        const place = places[0];
        const structured = extractStructuredLocation(place);
        if (!structured) return;
        const location = {
          lat: structured.lat,
          lng: structured.lng,
          address: structured.formatted_address,
          name: structured.name
        };
        setDropLocation(location);
        setDropStructured(structured);
        setRouteError('');
        setFormData(prev => ({
          ...prev,
          drop_location: structured.name || structured.formatted_address,
          drop_address: structured.formatted_address,
          drop_city: structured.city || prev.drop_city
        }));
      }
    }
  }, [dropSearchBox]);

  // ─── Form handlers ────────────────────────────────────────────────────
  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  // A field counts as "touched" only once the customer has actually left it.
  // Blur (rather than every keystroke) is what keeps the page silent on load
  // and avoids shouting while someone is mid-way through typing an address.
  const handleBlur = (e) => {
    const { name } = e.target;
    setTouchedFields(prev => (prev[name] ? prev : { ...prev, [name]: true }));
  };

  // ─── Voice search (browser Web Speech API) ────────────────────────────
  // The transcript is written into the real input node exactly as if the
  // customer had typed it, so the EXISTING Google Places autocomplete queries
  // it and the customer still picks a suggestion. This never sets a confirmed
  // location, never selects a suggestion, and never advances the booking —
  // it is only another way of entering search text.
  const handleVoiceResult = useCallback((field, transcript) => {
    const node = voiceFieldRefs.current[field];
    if (!node) {
      // No DOM node (shouldn't happen once mounted) — still keep the text.
      setFormData(prev => ({ ...prev, [field]: transcript }));
      return;
    }
    // Take the value setter from the element's OWN prototype rather than a
    // hard-coded one: <textarea> does not share HTMLInputElement's accessor, and
    // resolving it this way is also what preserves line breaks in a spoken
    // multi-line instruction. Assigning through it makes React's onChange fire
    // normally, and the Places widget re-queries for the location fields.
    const nativeSetter = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(node),
      'value'
    )?.set;
    if (nativeSetter) nativeSetter.call(node, transcript);
    else node.value = transcript;
    // Replaces (never appends to) any half-typed text already in the field.
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.focus();
  }, []);

  const {
    supported: voiceSupported,
    listeningField,
    interimText: voiceInterimText,
    message: voiceMessage,
    messageField: voiceMessageField,
    clearMessage: clearVoiceMessage,
    toggle: toggleVoice
  } = useVoiceSearch({ onResult: handleVoiceResult });

  // ─── Shared voice UI ────────────────────────────────────────────────
  // One mic button and one status pill, reused by all four voice-enabled
  // fields (pickup, drop, material, special instructions) so the listening
  // and error experience can never drift between them. `size="sm"` is used
  // inside the taller inputs/textarea.
  const renderVoiceButton = (field, { ariaLabel, size = 'md' } = {}) => {
    if (!voiceSupported) return null;
    const isListening = listeningField === field;
    const isOtherFieldListening = !!listeningField && listeningField !== field;
    const box = size === 'sm' ? 'h-8 w-8' : 'h-10 w-10';
    const icon = size === 'sm' ? 'h-4 w-4' : 'h-[18px] w-[18px]';
    const ring = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5';
    return (
      <button
        type="button"
        onClick={() => toggleVoice(field)}
        disabled={isOtherFieldListening}
        aria-label={ariaLabel}
        title={isListening ? 'Stop listening' : 'Search by voice'}
        aria-pressed={isListening}
        className={`absolute right-1 top-1/2 flex ${box} -translate-y-1/2 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-40 ${
          isListening
            ? 'bg-red-50 text-red-600'
            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
        }`}
      >
        <span className="relative flex items-center justify-center">
          {/* Small, calm pulse ring while listening — not flashy. */}
          {isListening && (
            <span className={`absolute ${ring} animate-ping rounded-full bg-red-400/50`} aria-hidden="true" />
          )}
          <svg
            className={`relative ${icon}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3z"
            />
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-14 0" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v3" />
          </svg>
        </span>
      </button>
    );
  };

  // Listening preview / inline error. Interim speech is previewed only and is
  // never written into the field, so a misheard phrase cannot become a value.
  const renderVoiceStatus = (field) => {
    const isListening = listeningField === field;
    const message = !isListening && voiceMessageField === field ? voiceMessage : '';
    if (!isListening && !message) return null;
    return (
      <div className="absolute left-3 top-full z-30 mt-1 flex items-center gap-1.5 rounded-md bg-slate-900/95 px-2 py-1 text-[11px] font-medium text-white shadow-lg">
        {isListening ? (
          <>
            <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-red-400" aria-hidden="true" />
            <span className="max-w-[190px] truncate sm:max-w-none">
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

  const handleVehicleSelect = (vehicleId) => {
    setFormData(prev => ({ ...prev, vehicle_type_required: vehicleId }));
    setTouchedFields(prev => (
      prev.vehicle_type_required ? prev : { ...prev, vehicle_type_required: true }
    ));
  };

  // ─── Validation ───────────────────────────────────────────────────────
  // The rules themselves are unchanged — validateBookingForm is still the only
  // source of truth. Only the moment the messages become *visible* has changed.
  const allErrors = useMemo(
    () => validateBookingForm(formData, { distanceKm, hasRouteError: routeStatus === 'error' }),
    [formData, distanceKm, routeStatus]
  );

  // Show a field's error only when it is relevant to the user: either the
  // owning step has been attempted, or the customer already touched that field.
  const fieldErrors = useMemo(() => {
    const visible = {};
    Object.keys(allErrors).forEach((name) => {
      const step = formStepForField(name);
      if (attemptedSteps[step] || touchedFields[name]) visible[name] = allErrors[name];
    });
    return visible;
  }, [allErrors, attemptedSteps, touchedFields]);

  const errorFieldsForStep = useCallback(
    (step) => STEP_FIELDS[step].filter((name) => allErrors[name]),
    [allErrors]
  );

  // Reveal every message at once (used when a final submit is attempted).
  const revealAllErrors = useCallback(() => {
    setAttemptedSteps({ 1: true, 2: true, 3: true });
  }, []);

  // ─── Step navigation ──────────────────────────────────────────────────
  const canProceedToStep = (step) => {
    if (step === 2) {
      // Step 1 requires: pickup, drop, vehicle
      return !!(formData.pickup_location && formData.drop_location && formData.vehicle_type_required);
    }
    if (step === 3) {
      // Step 2 (Shipment) requires ONLY the pickup schedule.
      //
      // Material, quantity, weight, goods category, handling and special
      // instructions are intentionally NOT required. Customers routinely book
      // a vehicle before they know the load, and the transport team fills
      // those in on the call. Blocking the journey here would lose the
      // booking; it would not produce better data.
      return !!formData.pickup_date && !!formData.pickup_time;
    }
    return true;
  };

  // ─── Phase 1 presentation values ─────────────────────────────────────
  // These are display-only derivations. Route, price, and validation values
  // continue to come from the existing booking state and utilities above.
  const pickupDisplay = pickupLocation?.name || formData.pickup_location || '—';
  const dropDisplay = dropLocation?.name || formData.drop_location || '—';
  const hasRouteCoordinates = !!(pickupLocation?.lat && dropLocation?.lat);
  const canContinueToShipment = canProceedToStep(2);
  const routeResolved = routeStatus === 'success' && !!routeData;
  const distanceDisplay = routeResolved ? formatDistance(routeData.distanceKm) : '—';
  const fareDisplay = routeResolved ? estimatedPriceLabel : '—';

  // Honest, short explanation of what is still missing — shown beneath the
  // subdued CTA. Never an error, just an orientation cue.
  const continueHint = canContinueToShipment
    ? ''
    : !formData.vehicle_type_required
      ? 'Select a vehicle to continue.'
      : !formData.pickup_location || !formData.drop_location
        ? 'Add a pickup and drop location to continue.'
        : 'Complete the route details to continue.';

  // ─── Review step derived values ──────────────────────────────────────
  // Everything here is derived live from formData / route state — there is no
  // separate review state, so an edit on any step is reflected immediately.
  const reviewVehicle = getVehicleById(formData.vehicle_type_required);
  const ReviewVehicleIcon = reviewVehicle ? getVehicleIcon(reviewVehicle.id) : null;
  const reviewPickupAddress = formData.pickup_address?.trim();
  const reviewDropAddress = formData.drop_address?.trim();
  const reviewInstructions = formData.special_instructions?.trim();
  const reviewIsValid = canProceedToStep(3);
  // Whether the customer described the load at all. When they did not, the
  // shipment card shows a neutral em-dash instead of asserting a value
  // ("Not fragile") they never actually chose.
  const hasShipmentInfo = !!(
    formData.material?.trim() ||
    formData.quantity ||
    formData.weight_value ||
    formData.goods_type?.trim() ||
    formData.fragile ||
    formData.special_instructions?.trim()
  );

  // ─── Shipment step derived values ────────────────────────────────────
  // Mirrors canProceedToStep(3) exactly — the only thing still outstanding is
  // the pickup schedule, so the hint only ever talks about the schedule.
  const canProceedToReview = canProceedToStep(3);
  const shipmentHint = canProceedToReview
    ? ''
    : !formData.pickup_date
      ? 'Choose a pickup date.'
      : 'Choose a pickup time.';

  // The header stepper always reflects what is on screen. Form step 1 renders
  // two sections (Vehicle, then Route) so we scroll-spy between them; form
  // steps 2 and 3 map one-to-one onto Shipment and Review.
  const activeDisplayStep = currentStep === 1 ? (routeInView ? 2 : 1) : currentStep + 1;

  // Availability is based on the furthest step the customer has reached, not
  // the current one — otherwise editing from Review would lock the later
  // steps and force them back through Continue twice.
  const isDisplayStepAvailable = (displayId) =>
    DISPLAY_STEP_TO_FORM_STEP[displayId] <= maxStepReached;

  const goToStep = (step) => {
    if (step < 1 || step > 3) return;
    setCurrentStep(step);
    setShowReview(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const goToDisplayStep = (displayId) => {
    if (!isDisplayStepAvailable(displayId)) return;
    goToStep(DISPLAY_STEP_TO_FORM_STEP[displayId]);
  };

  // The single primary action for the Vehicle + Route step. It deliberately
  // stays clickable while incomplete: pressing it is what *asks* for validation.
  // The button is only visually subdued — never silently dead — so the customer
  // can never be stuck wondering why nothing happens.
  const handleContinueToShipment = () => {
    if (canContinueToShipment) {
      setCurrentStep(2);
      setShowReview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setAttemptedSteps(prev => ({ ...prev, 1: true }));

    const firstError = errorFieldsForStep(1)[0];
    if (!firstError) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const target = (firstError === 'pickup_location' || firstError === 'drop_location')
      ? routeSectionRef.current
      : vehicleCarouselRef.current;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => {
      document.querySelector(`[name="${firstError}"]`)?.focus({ preventScroll: true });
    }, 320);
  };

  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // ─── Review & Submission ──────────────────────────────────────────────

  // Prefill the contact fields from the authenticated user once `user` resolves.
  //
  // `formData.customer_name` / `formData.customer_mobile` are the SINGLE source
  // of truth for the review contact card — there is no second copy. This effect
  // therefore only ever fills an EMPTY field, and it depends on `user` alone, so
  // a re-render can never resurrect an old account value over something the
  // customer has already typed.
  useEffect(() => {
    if (!user) return;
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
    const phone = String(user.phone || '').replace(/\D/g, '').slice(-10);
    setFormData(prev => {
      const next = { ...prev };
      let changed = false;
      if (!prev.customer_name && name) {
        next.customer_name = name;
        changed = true;
      }
      if (!prev.customer_mobile && phone) {
        next.customer_mobile = phone;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [user]);

  // Contact validation. Kept local rather than folded into the shared booking
  // validator because these two fields are specific to the login-free enquiry
  // flow and are rendered on the Review step, not in the shipment step.
  const contactErrors = useMemo(() => {
    const errors = {};
    const name = (formData.customer_name || '').trim();
    const mobile = (formData.customer_mobile || '').replace(/\D/g, '');

    // These stay ordinary, editable, controlled inputs whether or not someone
    // is signed in — the customer can always correct or replace them. A
    // pre-filled account name still has to be a real name, and it is still the
    // customer who is confirming it, so validation is identical either way.
    if (!name) {
      errors.name = 'Please enter your name so our team can reach you.';
    } else if (name.length < 2) {
      errors.name = 'Please enter your full name.';
    }

    if (!mobile) {
      errors.mobile = 'Please enter a 10-digit mobile number.';
    } else if (!/^[6-9]\d{9}$/.test(mobile)) {
      errors.mobile = 'Enter a valid 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
    }

    return errors;
  }, [formData.customer_name, formData.customer_mobile]);

  // Contact errors are only surfaced once submission has been attempted, so a
  // customer filling the form in order is never interrupted.
  const showContactErrors = attemptedSteps[3] === true || attemptedSteps[2] === true;
  const contactError = showContactErrors
    ? { name: contactErrors.name, mobile: contactErrors.mobile }
    : {};
  const hasContactErrors = Boolean(contactErrors.name || contactErrors.mobile);

  const handleReviewAdvance = () => {
    if (!canProceedToStep(3)) {
      setAttemptedSteps(prev => ({ ...prev, 2: true }));
      const firstError = errorFieldsForStep(2)[0];
      if (firstError) {
        // Bring the message into view — the CTA sits at the bottom of the step,
        // so without this the customer would press it and see nothing happen.
        const target = document.querySelector(`[name="${firstError}"]`);
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => target?.focus({ preventScroll: true }), 320);
      }
      return;
    }
    setShowReview(true);
    setCurrentStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ── DUPLICATE-SUBMIT LATCH ───────────────────────────────────────────
    // Checked BEFORE anything else and set synchronously, so a double-click can
    // never produce two enquiries. The button also renders a submitting state.
    if (submitLockRef.current) {
      if (import.meta.env.DEV) {
        console.warn('[booking] submit ignored — a submission is already in flight');
      }
      return;
    }

    setSubmitError('');

    // ── NO LOGIN WALL ──────────────────────────────────────────────────
    // The previous flow redirected to /login here, throwing away a completed
    // twelve-field form. Now the enquiry is created first — authenticated or
    // not — and the customer lands on the confirmation page either way. A
    // logged-in customer's `user` is sent along so the backend can attach the
    // enquiry to their account; a guest simply gets a scoped access token.
    //
    // Validate all fields — reveal every message and take the customer back to
    // the step that actually owns the problem instead of a dead-end focus() call.
    revealAllErrors();
    const firstErrorKey = Object.keys(allErrors)[0];
    if (firstErrorKey) {
      const owningStep = formStepForField(firstErrorKey);
      if (currentStep !== owningStep) {
        setCurrentStep(owningStep);
        setShowReview(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      window.setTimeout(() => {
        document.querySelector(`[name="${firstErrorKey}"]`)?.focus({ preventScroll: true });
      }, 260);
      return;
    }

    // Contact details live on the Review step and are not part of the shared
    // booking validator, so they are gated here.
    if (hasContactErrors) {
      setAttemptedSteps(prev => ({ ...prev, 2: true, 3: true }));
      setShowReview(true);
      setCurrentStep(3);
      window.setTimeout(() => {
        const firstBad = contactErrors.name ? 'customer_name' : 'customer_mobile';
        document.getElementById(firstBad)?.focus({ preventScroll: true });
      }, 260);
      return;
    }

    const finalDistance = distanceKm;

    // `rate_as_per` / `rate` are no longer customer-facing and are not part of
    // formData. They are still stripped defensively: drafts saved by an older
    // build can still carry those keys, and the create endpoint destructures a
    // fixed field list, so they must never reach the API.
    const {
      rate_as_per: _rateAsPer,
      rate: _rate,
      ...persistedFormData
    } = formData;
    void persistedFormData;

    // Customer identity. A guest types a name + mobile on the contact step;
    // a logged-in customer already has both, and the backend prefers the
    // authenticated values over anything posted here.
    const customerName =
      formData.customer_name ||
      formData.contact_name ||
      (user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : '') ||
      '';
    const customerMobile =
      formData.customer_mobile || formData.mobile || formData.contact_mobile || (user?.phone ?? '') || '';

    // Map the booking form's field names onto the enquiry contract. This is a
    // rename only — every value still comes from the page's own validated state,
    // so the enquiry can never disagree with what the customer saw.
    const enquiryPayload = {
      // Customer
      customer_name: customerName,
      customer_mobile: customerMobile,
      customer_email: formData.customer_email || formData.email || null,

      // Route
      pickup_location: formData.pickup_location || formData.pickup_city,
      pickup_address: formData.pickup_address || null,
      pickup_latitude: pickupLocation?.lat ?? null,
      pickup_longitude: pickupLocation?.lng ?? null,
      drop_location: formData.drop_location || formData.drop_city,
      drop_address: formData.drop_address || null,
      drop_latitude: dropLocation?.lat ?? null,
      drop_longitude: dropLocation?.lng ?? null,
      distance_km: finalDistance || null,

      // Vehicle
      requested_vehicle_name: getVehicleName(formData.vehicle_type_required),

      // Shipment — every field here is genuinely optional. An unanswered
      // question is sent as null and stays null: no 0, no "Not specified",
      // no "General goods". A blank cell is an honest "we'll confirm on the
      // call", and the transport team fills it in later.
      material: toOptionalText(formData.material),
      quantity: formData.quantity_unit === 'LOOSE' ? null : toOptionalNumber(formData.quantity),
      quantity_unit: toOptionalText(formData.quantity_unit),
      weight: formData.weight_unit === 'FTL' ? null : toOptionalNumber(formData.weight_value),
      weight_unit: toOptionalText(formData.weight_unit),
      goods_category: toOptionalText(formData.goods_type),
      fragile: Boolean(formData.fragile),
      special_instructions: toOptionalText(formData.special_instructions),

      // Schedule
      pickup_date: formData.pickup_date,
      pickup_time: formData.pickup_time,

      // Estimate carried over from the page's own pricing engine. The FINAL
      // price is never set here — only an authenticated admin can do that.
      estimated_price_min: estimatedPriceMin || null,
      estimated_price_max: estimatedPriceMax || null,
    };

    submitLockRef.current = true;
    setIsSubmitting(true);

    if (import.meta.env.DEV) {
      console.info('[booking] submission started', { pickup: enquiryPayload.pickup_location, drop: enquiryPayload.drop_location });
    }

    try {
      // AWAITED. The server answers only after the enquiry row, its canonical
      // number and its audit event are committed, so by the time this resolves
      // the enquiry genuinely exists and is readable.
      const response = await enquiryAPI.create(enquiryPayload);
      const { enquiry, enquiryId, enquiryNumber, bookingId, redirectTo } =
        extractCreatedEnquiry(response);

      if (import.meta.env.DEV) {
        console.info('[booking] POST /enquiries resolved', {
          success: response?.data?.success,
          enquiryId,
          enquiryNumber,
          bookingId,
        });
      }

      // Navigate ONLY on a confirmed success, and ONLY to the id the backend
      // generated. A failed creation never leaves this page.
      if (response?.data?.success && redirectTo && enquiryNumber) {
        clearBookingDraft();
        if (import.meta.env.DEV) {
          console.info('[booking] navigation started →', redirectTo);
        }
        navigate(redirectTo, {
          // Hand the freshly-created enquiry to the confirmation page through
          // route state so it can render on the FIRST frame, then revalidate
          // against the server in the background. This is a transport of data
          // the server already sent — not a second source of truth.
          state: { enquiryNumber, enquiryId, enquiry, justCreated: true },
        });
        return;
      }

      setSubmitError(
        response?.data?.message ||
          'We could not create your request. Please try again in a moment.'
      );
      reviewConfirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.error('[booking] submission failed', {
          status: err?.response?.status,
          message: err?.response?.data?.message,
        });
      }
      // Stay on this page. Surface the server's field-level validation messages
      // when present so the customer knows exactly which field to fix.
      const details = err?.response?.data?.details;
      if (Array.isArray(details) && details.length) {
        setSubmitError(details.map((d) => d.message).join(' · '));
      } else if (err?.response) {
        setSubmitError(
          err?.response?.data?.message ||
            'We could not reach our servers. Your request was not sent — please try again.'
        );
      } else {
        setSubmitError(
          'We could not reach our servers. Your request was not sent — please check your connection and try again.'
        );
      }
      reviewConfirmRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally {
      // Release the latch only here: after the request has settled, so a retry
      // is always possible and a duplicate is never possible.
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  // ─── Map center ───────────────────────────────────────────────────────
  const mapCenter = useMemo(() => {
    if (pickupLocation?.lat && dropLocation?.lat) {
      return {
        lat: (pickupLocation.lat + dropLocation.lat) / 2,
        lng: (pickupLocation.lng + dropLocation.lng) / 2,
      };
    }
    return pickupLocation?.lat ? pickupLocation : BIHAR_CENTER;
  }, [pickupLocation, dropLocation]);

  // ─── WhatsApp ─────────────────────────────────────────────────────────
  // The enquiry is built entirely from the existing booking state — nothing is
  // hardcoded and no second data structure is introduced. Distance and fare
  // reuse the values already calculated and displayed by this page; they are
  // never recomputed here.
  const SECTION_RULE = '━━━━━━━━━━━━━━━━━━';

  // A line is only emitted when it actually has a value, so the message can
  // never contain "undefined", "null" or an em-dash standing in for nothing.
  const waLine = (value) => {
    const text = typeof value === 'string' ? value.trim() : value;
    if (text === undefined || text === null) return null;
    if (typeof text === 'string' && text === '') return null;
    return `• ${text}`;
  };

  const buildWhatsAppMessage = () => {
    const vehicleName = getVehicleName(formData.vehicle_type_required);
    const pickupDate = formatPickupDate(formData.pickup_date);
    const pickupTime = formatPickupTime(formData.pickup_time);

    const sections = [];

    sections.push(
      [
        'Hello Bihar Transport Team 👋',
        '',
        '🚛 *NEW TRANSPORT BOOKING REQUEST*',
      ].join('\n')
    );

    // ── Route ──
    const routeLines = [
      waLine(`📌 *Pickup:* ${formData.pickup_location || formData.pickup_city}`),
      formData.pickup_address?.trim() ? `   _${formData.pickup_address.trim()}_` : null,
      waLine(`📌 *Drop:* ${formData.drop_location || formData.drop_city}`),
      formData.drop_address?.trim() ? `   _${formData.drop_address.trim()}_` : null,
    ].filter(Boolean);
    sections.push([SECTION_RULE, '📍 *ROUTE DETAILS*', SECTION_RULE, ...routeLines].join('\n'));

    // ── Vehicle & shipment ──
    const shipmentLines = [
      waLine(`🚛 *Vehicle:* ${vehicleName}`),
      waLine(`📦 *Material:* ${formData.material}`),
      formData.goods_type?.trim() ? waLine(`🏷️ *Goods Category:* ${formData.goods_type.trim()}`) : null,
      waLine(`🔢 *Quantity:* ${formatQuantity(formData.quantity, formData.quantity_unit)}`),
      waLine(`⚖️ *Weight:* ${formatWeight(formData.weight_value, formData.weight_unit)}`),
      waLine(`📦 *Handling:* ${formData.fragile ? 'Fragile goods' : 'Not fragile'}`),
    ].filter(Boolean);
    sections.push([SECTION_RULE, '🚚 *VEHICLE & SHIPMENT*', SECTION_RULE, ...shipmentLines].join('\n'));

    // ── Journey & fare ──
    const journeyLines = [
      waLine(`📏 *Distance:* ${formatDistance(distanceKm)}`),
      // estimatedPriceLabel already comes from the page's own priceRange.
      routeResolved ? waLine(`💰 *Estimated Fare:* ${estimatedPriceLabel}`) : null,
    ].filter(Boolean);
    sections.push([SECTION_RULE, '📏 *JOURNEY & FARE*', SECTION_RULE, ...journeyLines].join('\n'));

    // ── Schedule ──
    const scheduleLines = [
      waLine(`📅 *Pickup Date:* ${pickupDate}`),
      pickupTime ? waLine(`${pickupTime.emoji} *Pickup Time:* ${pickupTime.text}`) : null,
    ].filter(Boolean);
    sections.push([SECTION_RULE, '📅 *SCHEDULE*', SECTION_RULE, ...scheduleLines].join('\n'));

    // ── Special instructions (whole section omitted when empty) ──
    const instructions = formData.special_instructions?.trim();
    if (instructions) {
      // Line breaks are preserved exactly as the customer typed/spoke them.
      sections.push(
        [SECTION_RULE, '📝 *SPECIAL INSTRUCTIONS*', SECTION_RULE, instructions].join('\n')
      );
    }

    sections.push(
      [
        SECTION_RULE,
        '',
        'Please review the above details and confirm the booking.',
        '',
        'Thank you,',
        '*Bihar Transport*',
        'Reliable Truck & Goods Transport',
      ].join('\n')
    );

    return sections.join('\n\n');
  };

  const generateWhatsAppMessage = () => encodeURIComponent(buildWhatsAppMessage());

  const handleWhatsAppBooking = async () => {
    // Never send a half-finished enquiry. The button only appears once the
    // route resolved, so pickup/drop are already real places; this covers the
    // pickup schedule using the page's own validation and sends the customer
    // to the step that owns whatever is missing.
    if (!canProceedToReview) {
      revealAllErrors();
      setCurrentStep(2);
      setShowReview(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      window.setTimeout(() => {
        document.querySelector('[name="pickup_date"]')?.focus({ preventScroll: true });
      }, 300);
      return;
    }
    // Resolve the RECIPIENT from the single source of truth (backend
    // customer-care config). The message body is unchanged — it is already built
    // entirely from live form state above, never from a literal.
    const care = await fetchCustomerCare();
    const recipient = (care?.phoneDigits || '').replace(/\D/g, '');
    if (!recipient) {
      setSubmitError('WhatsApp support is temporarily unavailable. Please try again shortly.');
      return;
    }

    const whatsappUrl = `https://wa.me/${recipient}?text=${generateWhatsAppMessage()}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  // ─── Render helpers ───────────────────────────────────────────────────
  // Compact segmented stepper: 01 Vehicle · 02 Route · 03 Shipment · 04 Review.
  // The highlighted pill always matches the section the customer is looking at.
  const renderStepIndicator = () => (
    <nav aria-label="Booking progress" className="w-full">
      <ol className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        {STEPS.map((step, idx) => {
          const isActive = activeDisplayStep === step.id;
          const isCompleted = activeDisplayStep > step.id;
          const isAvailable = isDisplayStepAvailable(step.id);

          return (
            <li key={step.id} className="flex min-w-0 items-center">
              {idx > 0 && (
                <span
                  className={`mx-0.5 h-px w-3 sm:w-5 ${
                    isCompleted ? 'bg-amber-300' : 'bg-slate-200'
                  }`}
                  aria-hidden="true"
                />
              )}
              <button
                type="button"
                onClick={() => isAvailable && goToDisplayStep(step.id)}
                disabled={!isAvailable}
                aria-current={isActive ? 'step' : undefined}
                className={`inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-semibold leading-none transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 sm:gap-2 sm:px-2.5 sm:text-xs ${
                  isActive
                    ? 'border-amber-300 bg-amber-50 text-slate-900'
                    : isCompleted
                      ? 'border-amber-200 bg-white text-amber-700 hover:border-amber-300'
                      : isAvailable
                        ? 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700'
                        : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none sm:h-[18px] sm:w-[18px] sm:text-[10px] ${
                    isActive
                      ? 'bg-amber-500 text-white'
                      : isCompleted
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-400'
                  }`}
                  aria-hidden="true"
                >
                  {isCompleted ? (
                    <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 12l4 4L19 6" />
                    </svg>
                  ) : (
                    String(step.id).padStart(2, '0')
                  )}
                </span>
                <span className="truncate">{step.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  const renderLocationInput = ({
    field,
    value,
    selected,
    error,
    placeholder,
    onLoad,
    onPlacesChanged
  }) => {
    const isListening = listeningField === field;
    const isOtherFieldListening = !!listeningField && listeningField !== field;
    // Only the field the user actually spoke into shows the message — the
    // message string itself is shared by the hook.
    const fieldMessage =
      isListening || voiceMessageField !== field ? null : voiceMessage;

    const input = (
      <input
        id={field}
        ref={(node) => {
          voiceFieldRefs.current[field] = node;
        }}
        type="text"
        name={field}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        placeholder={placeholder}
        autoComplete="off"
        className={`h-14 w-full rounded-xl border bg-white pl-11 ${selected || voiceSupported ? 'pr-24' : 'pr-10'} text-[15px] font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:ring-4 ${
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
            : selected
              ? 'border-emerald-300 focus:border-amber-400 focus:ring-amber-100'
              : 'border-slate-200 hover:border-slate-300 focus:border-amber-400 focus:ring-amber-100'
        }`}
        aria-invalid={!!error}
        aria-describedby={error ? `${field}-error` : undefined}
        required
      />
    );

    return (
      <div className="relative">
        {hasApiKey && isLoaded ? (
          <StandaloneSearchBox onLoad={onLoad} onPlacesChanged={onPlacesChanged}>
            {input}
          </StandaloneSearchBox>
        ) : (
          input
        )}
        <span
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          aria-hidden="true"
        >
          <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.8}
              d="M12 21s7-5.1 7-11a7 7 0 10-14 0c0 5.9 7 11 7 11z"
            />
            <circle cx="12" cy="10" r="2.3" fill="currentColor" stroke="none" />
          </svg>
        </span>
        {selected && (
          <span
            className={`pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ${voiceSupported ? 'right-14' : 'right-3.5'}`}
            aria-label="Location selected"
          >
            <svg className="h-[18px] w-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12l4 4L19 6" />
            </svg>
          </span>
        )}

        {/* Voice search. Rendered only where the Web Speech API exists, so nobody
            is ever offered a dead button. Sits inside the field to the right of
            the text, and is always a real <button type="button"> so it can never
            submit the booking form. */}
        {renderVoiceButton(field, {
          ariaLabel: `Search ${field === 'pickup_location' ? 'pickup' : 'drop'} location by voice`
        })}

        {/* Listening preview / inline status, shared with the shipment fields. */}
        {renderVoiceStatus(field)}
      </div>
    );
  };

  // Select styled to match the route inputs, with a native chevron so the
  // unit is always obvious without adding extra decorative icons.
  const renderSelectField = ({ name, value, options, placeholder, disabled, error, className = '' }) => (
    <div className="relative">
      <select
        id={name}
        name={name}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        disabled={disabled}
        aria-invalid={!!error}
        className={`h-14 w-full appearance-none rounded-xl border bg-white pl-3.5 pr-9 text-[15px] text-slate-900 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${className} ${
          error
            ? 'border-red-300 focus:border-red-400 focus:ring-red-100'
            : 'border-slate-200 hover:border-slate-300 focus:border-amber-400 focus:ring-amber-100'
        }`}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => {
          // Options are plain strings for the unit/category lists below
          // (value === label). { value, label } pairs are also supported for
          // any future list whose stored value must stay stable while the
          // customer sees something friendlier.
          const optionValue = typeof opt === 'string' ? opt : opt.value;
          const optionLabel = typeof opt === 'string' ? opt : opt.label;
          return (
            <option key={optionValue} value={optionValue}>{optionLabel}</option>
          );
        })}
      </select>
      <span
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
        aria-hidden="true"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </span>
    </div>
  );

  // Four clean route states: initial (no copy, no error), calculating,
  // successful, and failed-with-retry. The calculation itself is untouched.
  const renderRouteStatus = () => {
    const shell = 'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg px-3 py-2 text-xs';

    if (routeStatus === 'calculating') {
      return (
        <div className={shell} role="status" aria-live="polite">
          <span
            className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-amber-500 border-t-transparent"
            aria-hidden="true"
          />
          <span className="font-medium text-slate-600">Calculating route...</span>
        </div>
      );
    }

    if (routeStatus === 'success' && routeData) {
      return (
        <div
          className={`${shell} border border-emerald-200 bg-emerald-50/70`}
          role="status"
          aria-live="polite"
        >
          <span className="inline-flex shrink-0 items-center gap-1.5 font-semibold text-emerald-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 12l4 4L19 6" />
            </svg>
            Route calculated
          </span>
          <span className="text-emerald-300" aria-hidden="true">·</span>
          <span className="font-semibold text-slate-800">{formatDistance(routeData.distanceKm)}</span>
          {routeData.duration && routeData.duration !== '—' && (
            <>
              <span className="text-slate-300" aria-hidden="true">·</span>
              <span className="font-medium text-slate-600">{routeData.duration}</span>
            </>
          )}
        </div>
      );
    }

    if (routeStatus === 'error') {
      const detail = routeError && routeError !== 'Unable to calculate route'
        ? routeError
        : 'Please verify your locations and try again.';
      return (
        <div
          className={`${shell} border border-red-200 bg-red-50/70`}
          role="alert"
        >
          <svg className="h-3.5 w-3.5 shrink-0 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span className="font-semibold text-red-700">Unable to calculate route</span>
          <span className="text-red-500" aria-hidden="true">·</span>
          <span className="text-red-600/90">{detail}</span>
          <button
            type="button"
            onClick={calculateRoute}
            className="ml-auto shrink-0 rounded-md px-2 py-1 font-semibold text-red-700 underline decoration-red-300 underline-offset-2 transition hover:bg-red-100 hover:decoration-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300"
          >
            Retry
          </button>
        </div>
      );
    }

    // Initial state — orientation only. No error, no red anything.
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        Select a pickup and drop location to see distance and fare.
      </div>
    );
  };

  // ─── Main render ──────────────────────────────────────────────────────
  if (submitSuccess) {
    return (
      <main className="w-full min-w-0 overflow-x-clip">
        <div className="min-h-screen bg-gray-50 py-6 md:py-8">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
            <div className="text-center py-12">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg className="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">✓ Enquiry Submitted</h1>
              <p className="text-gray-600 mb-8">Your transport enquiry has been received.</p>

              {submitSuccessData && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8 text-left">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Reference ID</span>
                      <span className="font-bold text-gray-900 block">{submitSuccessData.booking_reference || submitSuccessData.booking_number}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Status</span>
                      <span className="font-medium text-gray-900 block capitalize">{submitSuccessData.status}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Pickup</span>
                      <span className="font-medium text-gray-900 block">{submitSuccessData.pickup_location}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Drop</span>
                      <span className="font-medium text-gray-900 block">{submitSuccessData.drop_location}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Vehicle</span>
                      <span className="font-medium text-gray-900 block">{submitSuccessData.vehicle}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Distance</span>
                      <span className="font-medium text-gray-900 block">{submitSuccessData.distance}</span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-gray-500">Estimated Price</span>
                      <span className="font-bold text-amber-600 block">{submitSuccessData.price}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                  type="button"
                  onClick={() => navigate(`/track/${submitSuccessData?.booking_reference || ''}`)}
                  className="btn-secondary"
                >
                  Track Enquiry
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearBookingDraft();
                    window.location.href = '/book-transport';
                  }}
                  className="btn-outline"
                >
                  Book Another Transport
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="btn-secondary"
                >
                  Back to Home
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="w-full min-w-0 overflow-x-clip">
      <div className="min-h-screen bg-gray-50 py-5 md:py-7">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 w-full">
          {/* Page header */}
          <header className="mb-5 sm:mb-6">
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
              Book a Vehicle
            </h1>
            <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-500 sm:text-base">
              Choose your vehicle and tell us where your goods need to go.
            </p>
            <div className="mt-4 border-t border-slate-200 pt-4">
              {renderStepIndicator()}
            </div>
          </header>

          {/* Global error */}
          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 flex items-start gap-2">
              <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <span className="font-medium">Unable to submit enquiry.</span>
                <p className="mt-1">{submitError}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Pre-selected vehicle notice */}
            {preselectedFleetVehicle && (
              <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium">
                    {getVehicleName(preselectedFleetVehicle)} pre-selected
                  </span>
                </div>
                <span className="text-xs text-blue-600">
                  The matching vehicle has been auto-selected for you.
                </span>
              </div>
            )}

            {/* ─── STEP 1: Vehicle first, then route ────────────────────── */}
            {currentStep === 1 && (
              <div className="min-w-0 space-y-5 pb-20 lg:pb-0">
                {/* ─── VEHICLE SELECTION — FIRST MAJOR SECTION ─────────── */}
                {/* pb on small screens keeps the sticky bottom CTA clear of content */}
                <section
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                  aria-labelledby="vehicle-section-heading"
                >
                  {/* Header — the vehicle count reads as part of the heading
                      rather than a detached badge floating on the right. */}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">
                      01 · Choose your vehicle
                    </p>
                    <h2
                      id="vehicle-section-heading"
                      className="mt-1 flex flex-wrap items-baseline gap-x-2.5 text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl"
                    >
                      Choose your vehicle
                      <span className="text-xs font-medium tracking-normal text-slate-400">
                        {vehicleTypes.length} vehicles
                      </span>
                    </h2>
                    <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
                      Select the vehicle that best fits your shipment.
                    </p>
                  </div>

                  {fieldErrors.vehicle_type_required && (
                    <p className="mt-2.5 text-xs text-red-600" role="alert">
                      {fieldErrors.vehicle_type_required}
                    </p>
                  )}

                  <div className="relative mt-4 w-full min-w-0">
                    <div
                      ref={vehicleCarouselRef}
                      onScroll={handleCarouselScroll}
                      onKeyDown={handleCarouselKeyDown}
                      tabIndex={0}
                      role="group"
                      aria-label="Select a vehicle"
                      className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 pt-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 sm:gap-3.5"
                    >
                      {vehicleTypes.map((vehicle) => {
                        const isSelected = formData.vehicle_type_required === vehicle.id;
                        const VehicleIcon = getVehicleIcon(vehicle.id);
                        return (
                          <label
                            key={vehicle.id}
                            data-vehicle-id={vehicle.id}
                            className={`group relative flex w-[200px] shrink-0 snap-start cursor-pointer flex-col overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow,background-color] duration-150 focus-within:ring-2 focus-within:ring-amber-400 focus-within:ring-offset-2 sm:w-[240px] ${
                              isSelected
                                ? 'border-amber-400 bg-amber-50/40 shadow-[0_2px_10px_-6px_rgba(180,83,9,0.35)]'
                                : 'border-slate-200 hover:border-slate-300 hover:shadow-[0_1px_3px_rgba(15,23,42,0.06)]'
                            }`}
                          >
                            <input
                              type="radio"
                              name="vehicle_type_required"
                              value={vehicle.id}
                              checked={isSelected}
                              onChange={() => handleVehicleSelect(vehicle.id)}
                              className="sr-only"
                              aria-label={vehicle.name}
                            />

                            {isSelected && (
                              <span
                                className="absolute right-2 top-2 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-full bg-amber-500 text-white ring-2 ring-white"
                                aria-label="Selected"
                              >
                                <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.5} d="M5 12l4 4L19 6" />
                                </svg>
                              </span>
                            )}

                            {/* Consistent image plate across every card. */}
                            <div
                              className={`flex h-[92px] items-center justify-center px-4 py-3 transition-colors sm:h-[104px] ${
                                isSelected ? 'bg-amber-50/30' : 'bg-slate-50/60'
                              }`}
                            >
                              {vehicle.image ? (
                                <img
                                  src={vehicle.image}
                                  alt={vehicle.name}
                                  loading="lazy"
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <VehicleIcon />
                              )}
                            </div>

                            {/* Hierarchy: name > capacity > rate. Nothing else. */}
                            <div className="flex flex-1 flex-col border-t border-slate-100/80 px-3.5 py-2.5 text-left">
                              <h3 className="text-sm font-bold leading-snug text-slate-900">
                                {vehicle.name}
                              </h3>
                              <p className="mt-0.5 text-xs font-medium text-slate-400">
                                {vehicle.capacity}
                              </p>
                              <p className="mt-1.5 text-[13px] font-extrabold tracking-tight text-amber-600">
                                {vehicle.priceLabel}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                    </div>

                    {/* Arrows sit in the section's own padding gutter, so they never
                        cover a card — not even the first or last one. */}
                    {canScrollLeft && (
                      <button
                        type="button"
                        onClick={() => scrollCarouselByCard(-1)}
                        aria-label="Scroll vehicles left"
                        className="absolute left-0 top-1/2 z-20 flex h-10 w-10 -ml-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_1px_4px_rgba(15,23,42,0.12)] ring-2 ring-white/80 transition hover:border-amber-300 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:h-9 sm:w-9"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>
                    )}

                    {canScrollRight && (
                      <button
                        type="button"
                        onClick={() => scrollCarouselByCard(1)}
                        aria-label="Scroll vehicles right"
                        className="absolute right-0 top-1/2 z-20 flex h-10 w-10 -mr-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-[0_1px_4px_rgba(15,23,42,0.12)] ring-2 ring-white/80 transition hover:border-amber-300 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 sm:h-9 sm:w-9"
                      >
                        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                </section>

                <div className="grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start">
                  <div className="lg:col-span-8 min-w-0 space-y-5">
                    {/* One cohesive route section */}
                    <section
                      ref={routeSectionRef}
                      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                      aria-labelledby="route-section-heading"
                    >
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">02 · Your route</p>
                          <h2 id="route-section-heading" className="mt-1 text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl">Tell us your route</h2>
                          <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">Search a pickup and drop location to plan your trip.</p>
                        </div>
                        <div className="hidden shrink-0 items-center gap-2 text-[11px] font-medium text-slate-400 sm:flex">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                          Journey route
                        </div>
                      </div>

                    {/* Connected journey: pickup → drop in one visual flow */}
                    <div className="relative mt-4">
                      <div
                        className="pointer-events-none absolute bottom-6 left-[13px] top-6 w-px bg-slate-200"
                        aria-hidden="true"
                      />

                      <div className="relative min-w-0">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white ring-4 ring-white">
                            A
                          </span>
                          <label className="text-sm font-bold text-slate-800" htmlFor="pickup_location">
                            Pickup
                          </label>
                          <span className="text-xs text-slate-400" aria-hidden="true">*</span>
                        </div>
                        {renderLocationInput({
                          field: 'pickup_location',
                          value: formData.pickup_location,
                          selected: !!pickupLocation?.lat,
                          error: fieldErrors.pickup_location,
                          placeholder: 'Search pickup location',
                          onLoad: onPickupLoad,
                          onPlacesChanged: onPickupPlacesChanged
                        })}
                        {fieldErrors.pickup_location ? (
                          <p id="pickup_location-error" className="mt-1.5 text-xs text-red-600" role="alert">
                            {fieldErrors.pickup_location}
                          </p>
                        ) : pickupLocation?.lat ? (
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                            Location selected
                          </p>
                        ) : null}
                        {showAddressDetails && (
                          <div className="mt-2">
                            <label className="sr-only" htmlFor="pickup_address">Detailed pickup address (optional)</label>
                            <textarea
                              id="pickup_address"
                              name="pickup_address"
                              value={formData.pickup_address}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="Floor, building details, landmark..."
                              className="h-11 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
                              rows={1}
                            />
                          </div>
                        )}
                      </div>

                      {/* Journey connector */}
                      <div className="relative flex h-7 items-center pl-1.5" aria-hidden="true">
                        <svg
                          className="h-4 w-4 text-amber-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M12 5v14m0 0l-5-5m5 5l5-5"
                          />
                        </svg>
                      </div>

                      <div className="relative min-w-0">
                        <div className="mb-1.5 flex items-center gap-2">
                          <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[11px] font-bold text-white ring-4 ring-white">
                            B
                          </span>
                          <label className="text-sm font-bold text-slate-800" htmlFor="drop_location">
                            Drop
                          </label>
                          <span className="text-xs text-slate-400" aria-hidden="true">*</span>
                        </div>
                        {renderLocationInput({
                          field: 'drop_location',
                          value: formData.drop_location,
                          selected: !!dropLocation?.lat,
                          error: fieldErrors.drop_location,
                          placeholder: 'Search drop location',
                          onLoad: onDropLoad,
                          onPlacesChanged: onDropPlacesChanged
                        })}
                        {fieldErrors.drop_location ? (
                          <p id="drop_location-error" className="mt-1.5 text-xs text-red-600" role="alert">
                            {fieldErrors.drop_location}
                          </p>
                        ) : dropLocation?.lat ? (
                          <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                            Location selected
                          </p>
                        ) : null}
                        {showAddressDetails && (
                          <div className="mt-2">
                            <label className="sr-only" htmlFor="drop_address">Detailed drop address (optional)</label>
                            <textarea
                              id="drop_address"
                              name="drop_address"
                              value={formData.drop_address}
                              onChange={handleChange}
                              onBlur={handleBlur}
                              placeholder="Floor, building details, landmark..."
                              className="h-11 w-full resize-y rounded-lg border border-slate-200 bg-slate-50/60 px-3.5 py-2 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100"
                              rows={1}
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Optional address inputs — collapsed so the journey reads at a glance */}
                    <button
                      type="button"
                      onClick={() => setShowAddressDetails((v) => !v)}
                      aria-expanded={showAddressDetails}
                      className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-amber-700 hover:decoration-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                    >
                      {showAddressDetails ? 'Hide detailed address' : 'Add detailed address (optional)'}
                    </button>

                    <div className="mt-3 border-t border-slate-100 pt-3">
                      {renderRouteStatus()}
                    </div>

                    {hasApiKey && isLoaded && directions && hasRouteCoordinates && (
                      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                        <GoogleMap
                          mapContainerStyle={{ width: '100%', height: '180px' }}
                          center={mapCenter}
                          zoom={6}
                          options={{
                            disableDefaultUI: true,
                            zoomControl: true,
                            streetViewControl: false,
                            mapTypeControl: false,
                            fullscreenControl: false,
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
                          <DirectionsRenderer
                            directions={directions}
                            options={{
                              suppressMarkers: true,
                              polylineOptions: {
                                strokeColor: '#F5A000',
                                strokeWeight: 4,
                              },
                            }}
                          />
                        </GoogleMap>
                      </div>
                    )}
                  </section>

                  {/* Mobile sticky CTA — the same single primary action, pinned to
                      the bottom on small screens where the summary panel is hidden. */}
                  {!isDesktop && (
                    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_-6px_rgba(15,23,42,0.18)] backdrop-blur">
                      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-bold leading-tight text-slate-900">
                            {getVehicleName(formData.vehicle_type_required)}
                          </p>
                          <p className="truncate text-[11px] leading-tight text-slate-500">
                            {routeResolved
                              ? `${distanceDisplay} · ${fareDisplay}`
                              : continueHint || 'Vehicle selected'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleContinueToShipment}
                          aria-disabled={!canContinueToShipment}
                          className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
                            canContinueToShipment
                              ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          Continue
                          {canContinueToShipment && (
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m0 0l-5-5m5 5l-5 5" />
                            </svg>
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* ─── STICKY TRIP SUMMARY (Desktop) ────────────────────── */}
                {/* The single primary CTA for this step lives here. */}
                <aside
                  className="hidden lg:block lg:col-span-4 lg:sticky lg:top-24 lg:self-start"
                  aria-labelledby="trip-summary-heading"
                >
                  <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)] sm:p-6">
                    <div className="mb-3.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <svg className="h-[18px] w-[18px] shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-4 0h.01" />
                        </svg>
                        <h2 id="trip-summary-heading" className="text-sm font-bold text-slate-900">Your Trip</h2>
                      </div>
                      {routeResolved && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
                          Route ready
                        </span>
                      )}
                    </div>

                    <div className="space-y-3.5">
                      {/* Route */}
                      <div className="relative pl-5">
                        <span
                          className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500"
                          aria-hidden="true"
                        />
                        <span
                          className="absolute left-[4px] top-5 h-[calc(100%-1.25rem)] w-px bg-slate-200"
                          aria-hidden="true"
                        />
                        <span
                          className="absolute bottom-1 left-0 h-2.5 w-2.5 rounded-full bg-slate-700"
                          aria-hidden="true"
                        />
                        <div className="pb-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pickup</p>
                          <p className={`mt-0.5 text-[13px] leading-snug ${pickupDisplay === '—' ? 'text-slate-300' : 'font-medium text-slate-900'}`}>
                            {pickupDisplay}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Drop</p>
                          <p className={`mt-0.5 text-[13px] leading-snug ${dropDisplay === '—' ? 'text-slate-300' : 'font-medium text-slate-900'}`}>
                            {dropDisplay}
                          </p>
                        </div>
                      </div>

                      {/* Trip facts — labels left, values right, fare anchored last. */}
                      <div className="space-y-2.5 border-t border-slate-100 pt-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[13px] text-slate-500">Distance</span>
                          <span className="text-[13px] font-semibold text-slate-900">
                            {routeResolved ? distanceDisplay : '—'}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="shrink-0 text-[13px] text-slate-500">Vehicle</span>
                          <span
                            className="min-w-0 truncate text-right text-[13px] font-semibold text-slate-900"
                            title={getVehicleName(formData.vehicle_type_required)}
                          >
                            {getVehicleName(formData.vehicle_type_required)}
                          </span>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2.5">
                          <span className="text-[13px] text-slate-500">Estimated fare</span>
                          <span className={`text-base font-extrabold tracking-tight ${routeResolved ? 'text-amber-600' : 'text-slate-300'}`}>
                            {routeResolved ? fareDisplay : '—'}
                          </span>
                        </div>
                      </div>

                      {/* CTA — subdued until the route is complete, but always
                          clickable so pressing it can surface validation. */}
                      <div className="mt-4 border-t border-slate-100 pt-4">
                        <button
                          type="button"
                          onClick={handleContinueToShipment}
                          aria-disabled={!canContinueToShipment}
                          className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
                            canContinueToShipment
                              ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          Continue to Shipment Details
                          {canContinueToShipment && (
                            <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m0 0l-5-5m5 5l-5 5" />
                            </svg>
                          )}
                        </button>
                        {continueHint && (
                          <p className="mt-2 text-center text-[11px] leading-snug text-slate-400">
                            {continueHint}
                          </p>
                        )}
                      </div>

                      <p className="text-[11px] leading-relaxed text-slate-400">
                        Final quotation may vary based on shipment details and operational conditions.
                      </p>
                    </div>
                  </div>
                </aside>
              </div>
            </div>
            )}

            {/* ─── STEP 2: Shipment Details ─────────────────────────────── */}
            {currentStep === 2 && (
              <div className="space-y-5">
                {/* Shipment Details */}
                <section
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                  aria-labelledby="shipment-section-heading"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">
                      03 · Shipment details
                    </p>
                    <h2
                      id="shipment-section-heading"
                      className="mt-1 text-lg font-extrabold tracking-tight text-slate-900 sm:text-xl"
                    >
                      Tell us about your shipment
                    </h2>
                    <p className="mt-1 text-[13px] text-slate-500 sm:text-sm">
                      Share as much or as little as you know right now — our team will confirm the rest.
                    </p>
                  </div>

                  <div className="mt-5 grid min-w-0 grid-cols-1 gap-x-4 gap-y-4 md:grid-cols-2">
                    {/* 1 · Material / goods — the primary field, full width.
                        No asterisk: nothing in this section is mandatory, and a
                        star the customer cannot satisfy is a lie, not a cue. */}
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-[13px] font-semibold text-slate-800" htmlFor="material">
                        What are you transporting?
                      </label>
                      {/* Voice search writes into this input exactly as typing
                          would. It is an ordinary field, so Google Places is
                          deliberately not involved. Right padding keeps typed
                          text clear of the mic. */}
                      <div className="relative">
                        <input
                          id="material"
                          ref={(node) => {
                            voiceFieldRefs.current.material = node;
                          }}
                          type="text"
                          name="material"
                          value={formData.material}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          placeholder="e.g. Cement, steel, furniture, machinery"
                          className={`${shipmentFieldClass(fieldErrors.material)} ${voiceSupported ? 'pr-11' : ''}`}
                          aria-invalid={!!fieldErrors.material}
                          aria-describedby={fieldErrors.material ? 'material-error' : 'material-hint'}
                        />
                        {renderVoiceButton('material', {
                          ariaLabel: 'Enter goods or material by voice',
                          size: 'sm'
                        })}
                        {renderVoiceStatus('material')}
                      </div>
                      {fieldErrors.material ? (
                        <p id="material-error" className="mt-1.5 text-xs text-red-600" role="alert">
                          {fieldErrors.material}
                        </p>
                      ) : (
                        <p id="material-hint" className="mt-1.5 text-xs text-slate-400">
                          Share whatever details you already have.
                        </p>
                      )}
                    </div>

                    {/* 2 · Quantity + unit */}
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-slate-800" htmlFor="quantity">
                        Quantity
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="quantity"
                          type="number"
                          name="quantity"
                          value={formData.quantity}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          placeholder="Enter quantity"
                          className={`min-w-0 flex-1 ${shipmentFieldClass(fieldErrors.quantity)}`}
                          min="0"
                          disabled={formData.quantity_unit === 'LOOSE'}
                          aria-invalid={!!fieldErrors.quantity}
                          aria-describedby={fieldErrors.quantity ? 'quantity-error' : undefined}
                        />
                        {renderSelectField({
                          name: 'quantity_unit',
                          value: formData.quantity_unit,
                          options: quantityUnits,
                          placeholder: 'Unit',
                          className: 'w-28 shrink-0',
                        })}
                      </div>
                      {fieldErrors.quantity && (
                        <p id="quantity-error" className="mt-1.5 text-xs text-red-600" role="alert">
                          {fieldErrors.quantity}
                        </p>
                      )}
                    </div>

                    {/* 3 · Weight + unit */}
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-slate-800" htmlFor="weight_value">
                        Approximate weight
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="weight_value"
                          type="number"
                          name="weight_value"
                          value={formData.weight_value}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          placeholder="Enter weight"
                          className={`min-w-0 flex-1 ${shipmentFieldClass(fieldErrors.weight_value)}`}
                          min="0"
                          disabled={formData.weight_unit === 'FTL'}
                          aria-invalid={!!fieldErrors.weight_value}
                          aria-describedby={fieldErrors.weight_value ? 'weight_value-error' : undefined}
                        />
                        {renderSelectField({
                          name: 'weight_unit',
                          value: formData.weight_unit,
                          options: weightUnits,
                          placeholder: 'Unit',
                          className: 'w-28 shrink-0',
                        })}
                      </div>
                      {fieldErrors.weight_value && (
                        <p id="weight_value-error" className="mt-1.5 text-xs text-red-600" role="alert">
                          {fieldErrors.weight_value}
                        </p>
                      )}
                    </div>

                    {/* 4 · Goods category — writes to the existing goods_type field */}
                    <div>
                      <label className="mb-1.5 block text-[13px] font-semibold text-slate-800" htmlFor="goods_type">
                        Goods category
                      </label>
                      {renderSelectField({
                        name: 'goods_type',
                        value: formData.goods_type,
                        options: goodsCategories,
                        placeholder: 'Select a category',
                      })}
                    </div>

                    {/* Handling requirement the booking model already supports */}
                    <div>
                      <span className="mb-1.5 block text-[13px] font-semibold text-slate-800">
                        Handling
                      </span>
                      <label
                        className={`flex h-14 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 transition ${
                          formData.fragile
                            ? 'border-amber-300 bg-amber-50/40'
                            : 'border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <input
                          type="checkbox"
                          name="fragile"
                          checked={formData.fragile}
                          onChange={handleChange}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-amber-500 focus:ring-amber-400"
                        />
                        <span className="text-[13px] font-medium text-slate-800">Fragile goods</span>
                      </label>
                    </div>

                    {/* 5 · Special instructions — visually secondary, no marker */}
                    <div className="md:col-span-2">
                      <label className="mb-1.5 block text-[13px] font-semibold text-slate-800" htmlFor="special_instructions">
                        Special instructions
                      </label>
                      {/* Mic sits at the top-right inside the textarea. Extra
                          top padding keeps the placeholder and typed text clear
                          of it. Line breaks in a spoken instruction survive
                          because the transcript is written to a real <textarea>. */}
                      <div className="relative">
                        <textarea
                          id="special_instructions"
                          ref={(node) => {
                            voiceFieldRefs.current.special_instructions = node;
                          }}
                          name="special_instructions"
                          value={formData.special_instructions}
                          onChange={handleChange}
                          onBlur={handleBlur}
                          rows={3}
                          placeholder="Any loading, unloading, handling, fragile-goods, or delivery instructions..."
                          className={`w-full resize-y rounded-xl border border-slate-200 bg-slate-50/60 py-2.5 text-[13px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100 ${voiceSupported ? 'pl-3.5 pr-11 pt-9' : 'px-3.5'}`}
                        />
                        {renderVoiceButton('special_instructions', {
                          ariaLabel: 'Enter special instructions by voice',
                          size: 'sm'
                        })}
                        {renderVoiceStatus('special_instructions')}
                      </div>
                    </div>
                  </div>

                </section>

                {/* Vehicle Capacity Warning */}
                {vehicleCapacityWarning && (
                  <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 flex items-start gap-2">
                    <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="font-medium">Vehicle capacity warning</p>
                      <p className="text-sm mt-0.5">{vehicleCapacityWarning}</p>
                    </div>
                  </div>
                )}

                {/* Recommended Vehicle */}
                {recommendedVehicle && (
                  <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3">
                    <p className="font-medium mb-1">Recommended for your shipment:</p>
                    <div className="flex items-center gap-3">
                      <div className="bg-white rounded-lg p-2 flex-shrink-0">
                        {(() => {
                          const Icon = getVehicleIcon(recommendedVehicle.id);
                          return recommendedVehicle.image ? (
                            <img src={recommendedVehicle.image} alt={recommendedVehicle.name} className="w-12 h-12 object-contain" />
                          ) : (
                            <div className="scale-75"><Icon /></div>
                          );
                        })()}
                      </div>
                      <div>
                        <div className="font-semibold">{recommendedVehicle.name}</div>
                        <div className="text-sm text-blue-700">{recommendedVehicle.capacity} · {recommendedVehicle.priceLabel}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleVehicleSelect(recommendedVehicle.id)}
                        className="ml-auto text-sm font-medium text-blue-600 hover:text-blue-800 underline"
                      >
                        Select this vehicle
                      </button>
                    </div>
                  </div>
                )}

                {/* Date & Time */}
                <section
                  className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                  aria-labelledby="schedule-section-heading"
                >
                  <h2 id="schedule-section-heading" className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    Schedule
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="label" htmlFor="pickup_date">Pickup Date *</label>
                      <input
                        id="pickup_date"
                        type="date"
                        name="pickup_date"
                        value={formData.pickup_date}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        min={getDefaultPickupDate()}
                        className={`input-field ${fieldErrors.pickup_date ? 'border-red-500 focus:ring-red-500' : ''}`}
                        aria-invalid={!!fieldErrors.pickup_date}
                        aria-describedby={fieldErrors.pickup_date ? 'pickup_date-error' : undefined}
                        required
                      />
                      {fieldErrors.pickup_date && (
                        <p id="pickup_date-error" className="text-xs text-red-600 mt-1" role="alert">
                          {fieldErrors.pickup_date}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="pickup_time">Pickup Time *</label>
                      <input
                        id="pickup_time"
                        type="time"
                        name="pickup_time"
                        value={formData.pickup_time}
                        onChange={handleChange}
                        onBlur={handleBlur}
                        className={`input-field ${fieldErrors.pickup_time ? 'border-red-500 focus:ring-red-500' : ''}`}
                        aria-invalid={!!fieldErrors.pickup_time}
                        aria-describedby={fieldErrors.pickup_time ? 'pickup_time-error' : undefined}
                        required
                      />
                      {fieldErrors.pickup_time && (
                        <p id="pickup_time-error" className="text-xs text-red-600 mt-1" role="alert">
                          {fieldErrors.pickup_time}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Single primary action for this step. It sits last, after every
                    field on the step, and is subdued until valid but still
                    clickable so pressing it can surface validation. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={handlePrevStep}
                    className="w-auto self-start rounded-lg px-3 py-2 text-[13px] font-semibold text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 sm:self-auto"
                  >
                    &larr; Back
                  </button>
                  <button
                    type="button"
                    onClick={handleReviewAdvance}
                    aria-disabled={!canProceedToReview}
                    className={`flex w-full items-center justify-center gap-1.5 rounded-lg px-5 py-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 sm:w-auto ${
                      canProceedToReview
                        ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600'
                        : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    Continue to Review
                    {canProceedToReview && (
                      <svg className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m0 0l-5-5m5 5l-5 5" />
                      </svg>
                    )}
                  </button>
                </div>
                {shipmentHint && (
                  <p className="-mt-3 text-center text-[11px] leading-snug text-slate-400 sm:-mt-5 sm:pr-1 sm:text-right">
                    {shipmentHint}
                  </p>
                )}
              </div>
            )}

            {/* ─── STEP 3: Review ───────────────────────────────────────── */}
            {/* pb on small screens keeps the sticky bottom Submit CTA clear of content */}
            {currentStep === 3 && (
              <div className="min-w-0 space-y-5 pb-20 lg:pb-0">
                <div className="min-w-0">
                  <h2 className="text-xl font-extrabold tracking-tight text-slate-950 sm:text-2xl">
                    Review your booking
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-500">
                    Please check your booking details before submitting your request.
                  </p>
                </div>

                <div className="grid min-w-0 gap-5 lg:grid-cols-12 lg:items-start">
                  {/* ── LEFT: what the customer entered ─────────────────── */}
                  <div className="min-w-0 space-y-5 lg:col-span-7 xl:col-span-8">
                    {/* Vehicle */}
                    <section
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                      aria-labelledby="review-vehicle-heading"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 id="review-vehicle-heading" className="text-sm font-bold text-slate-900">
                          Vehicle
                        </h3>
                        <button
                          type="button"
                          onClick={() => goToDisplayStep(1)}
                          aria-label="Edit vehicle selection"
                          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                        >
                          Edit
                        </button>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-lg bg-slate-50 p-1.5">
                          {reviewVehicle?.image ? (
                            <img
                              src={reviewVehicle.image}
                              alt=""
                              className="h-full w-full object-contain"
                            />
                          ) : (
                            <ReviewVehicleIcon />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-slate-900">
                            {getVehicleName(formData.vehicle_type_required)}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {getVehicleCapacity(formData.vehicle_type_required)}
                          </p>
                          <p className="mt-1 text-[13px] font-extrabold text-amber-600">
                            {reviewVehicle?.priceLabel || '—'}
                          </p>
                        </div>
                      </div>
                    </section>

                    {/* Route */}
                    <section
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                      aria-labelledby="review-route-heading"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 id="review-route-heading" className="text-sm font-bold text-slate-900">
                          Route
                        </h3>
                        <button
                          type="button"
                          onClick={() => goToDisplayStep(2)}
                          aria-label="Edit pickup and drop locations"
                          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                        >
                          Edit
                        </button>
                      </div>

                      <div className="relative pl-5">
                        <span
                          className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-500"
                          aria-hidden="true"
                        />
                        <span
                          className="absolute left-[4px] top-5 h-[calc(100%-1.25rem)] w-px bg-slate-200"
                          aria-hidden="true"
                        />
                        <span
                          className="absolute bottom-1 left-0 h-2.5 w-2.5 rounded-full bg-slate-700"
                          aria-hidden="true"
                        />
                        <div className="pb-3">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Pickup
                          </p>
                          <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-900">
                            {pickupDisplay}
                          </p>
                          {reviewPickupAddress && (
                            <p className="mt-0.5 text-xs leading-snug text-slate-400">
                              {reviewPickupAddress}
                            </p>
                          )}
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                            Drop
                          </p>
                          <p className="mt-0.5 text-[13px] font-medium leading-snug text-slate-900">
                            {dropDisplay}
                          </p>
                          {reviewDropAddress && (
                            <p className="mt-0.5 text-xs leading-snug text-slate-400">
                              {reviewDropAddress}
                            </p>
                          )}
                        </div>
                      </div>

                      <dl className="mt-4 space-y-2.5 border-t border-slate-100 pt-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-500">Distance</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {routeResolved ? distanceDisplay : '—'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-500">Pickup date</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {formData.pickup_date || '—'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-500">Pickup time</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {formData.pickup_time || '—'}
                          </dd>
                        </div>
                      </dl>
                    </section>

                    {/* Shipment */}
                    <section
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6"
                      aria-labelledby="review-shipment-heading"
                    >
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <h3 id="review-shipment-heading" className="text-sm font-bold text-slate-900">
                          Shipment details
                        </h3>
                        <button
                          type="button"
                          onClick={() => goToDisplayStep(3)}
                          aria-label="Edit shipment details"
                          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                        >
                          Edit
                        </button>
                      </div>

                      <dl className="space-y-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[13px] text-slate-500">Material / goods</dt>
                          <dd className="min-w-0 text-right text-[13px] font-semibold text-slate-900">
                            {formData.material || '—'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[13px] text-slate-500">Quantity</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {formatQuantity(formData.quantity, formData.quantity_unit)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[13px] text-slate-500">Approximate weight</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {formatWeight(formData.weight_value, formData.weight_unit)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[13px] text-slate-500">Goods category</dt>
                          <dd className="text-right text-[13px] font-semibold text-slate-900">
                            {formData.goods_type || '—'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="shrink-0 text-[13px] text-slate-500">Handling</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {formData.fragile ? 'Fragile' : hasShipmentInfo ? 'Not fragile' : '—'}
                          </dd>
                        </div>
                      </dl>

                      {reviewInstructions && (
                        <div className="mt-4 border-t border-slate-100 pt-3.5">
                          <p className="text-[13px] text-slate-500">Special instructions</p>
                          <p className="mt-1 text-[13px] leading-relaxed text-slate-700">
                            {reviewInstructions}
                          </p>
                        </div>
                      )}
                    </section>
                  </div>

                  {/* ── RIGHT: trip summary and submit ──────────────────── */}
                  <div className="min-w-0 space-y-5 lg:col-span-5 xl:col-span-4 lg:sticky lg:top-24 lg:self-start">
                    <section
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.05)] sm:p-6"
                      aria-labelledby="review-summary-heading"
                    >
                      <h3 id="review-summary-heading" className="text-sm font-bold text-slate-900">
                        Trip summary
                      </h3>

                      <dl className="mt-4 space-y-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-500">Vehicle</dt>
                          <dd className="text-right text-[13px] font-semibold text-slate-900">
                            {getVehicleName(formData.vehicle_type_required)}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3">
                          <dt className="text-[13px] text-slate-500">Distance</dt>
                          <dd className="text-[13px] font-semibold text-slate-900">
                            {routeResolved ? distanceDisplay : '—'}
                          </dd>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 border-t border-slate-100 pt-2.5">
                          <dt className="text-[13px] text-slate-500">Estimated fare</dt>
                          <dd
                            className={`text-base font-extrabold tracking-tight ${
                              routeResolved ? 'text-amber-600' : 'text-slate-300'
                            }`}
                          >
                            {routeResolved ? fareDisplay : '—'}
                          </dd>
                        </div>
                      </dl>

                      <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
                        Final quotation may vary based on shipment details and operational conditions.
                      </p>
                    </section>

                    {/* ── Contact details ─────────────────────────────────────
                        Required because "Submit Booking" no longer forces a
                        login: without a name and mobile there is no way for the
                        transport team to reach the customer about the request.
                        A logged-in customer's details are pre-filled as a
                        starting point, but both fields stay fully editable — the
                        person booking is the person who confirms the contact. */}
                    <section
                      className="rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6"
                      aria-labelledby="review-contact-heading"
                    >
                      <h3 id="review-contact-heading" className="text-sm font-bold text-slate-900">
                        Your contact details
                      </h3>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                        We will only use these to coordinate this transport request.
                      </p>

                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <label
                            htmlFor="customer_name"
                            className="mb-1.5 block text-[13px] font-semibold text-slate-700"
                          >
                            Full name <span className="text-red-500">*</span>
                          </label>
                          {/* A plain controlled input. `formData.customer_name`
                              is the single source of truth and `handleChange`
                              is the only writer, so the value survives every
                              re-render and is exactly what gets submitted. */}
                          <input
                            id="customer_name"
                            name="customer_name"
                            type="text"
                            autoComplete="name"
                            value={formData.customer_name || ''}
                            onChange={handleChange}
                            placeholder="e.g. Ramesh Kumar"
                            aria-invalid={Boolean(contactError.name)}
                            className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-1 ${
                              contactError.name
                                ? 'border-red-300 bg-red-50/40 focus:border-red-500 focus:ring-red-500'
                                : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500'
                            }`}
                          />
                          {contactError.name && (
                            <p className="mt-1 text-[12px] text-red-600">{contactError.name}</p>
                          )}
                        </div>

                        <div>
                          <label
                            htmlFor="customer_mobile"
                            className="mb-1.5 block text-[13px] font-semibold text-slate-700"
                          >
                            Mobile number <span className="text-red-500">*</span>
                          </label>
                          <div className="flex">
                            <span className="inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm text-slate-500">
                              +91
                            </span>
                            {/* Only the 10-digit portion is editable; the "+91"
                                prefix is a separate, non-input element, so it
                                never makes the number itself un-typeable. */}
                            <input
                              id="customer_mobile"
                              name="customer_mobile"
                              type="tel"
                              inputMode="numeric"
                              autoComplete="tel"
                              maxLength={10}
                              value={formData.customer_mobile || ''}
                              onChange={(e) =>
                                handleChange({
                                  target: {
                                    name: 'customer_mobile',
                                    // digits only, so a pasted "+91 98765 43210"
                                    // normalises to "9876543210".
                                    value: e.target.value.replace(/\D/g, '').slice(0, 10),
                                  },
                                })
                              }
                              placeholder="98765 43210"
                              aria-invalid={Boolean(contactError.mobile)}
                              className={`w-full rounded-r-lg border bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:ring-1 ${
                                contactError.mobile
                                  ? 'border-red-300 bg-red-50/40 focus:border-red-500 focus:ring-red-500'
                                  : 'border-slate-300 focus:border-amber-500 focus:ring-amber-500'
                              }`}
                            />
                          </div>
                          {contactError.mobile ? (
                            <p className="mt-1 text-[12px] text-red-600">{contactError.mobile}</p>
                          ) : (
                            <p className="mt-1 text-[12px] text-slate-400">
                              For updates about this request only.
                            </p>
                          )}
                        </div>
                      </div>
                    </section>

                    <section
                      ref={reviewConfirmRef}
                      className="scroll-mt-24 rounded-2xl border border-slate-200/80 bg-white p-5 sm:p-6"
                      aria-labelledby="review-confirm-heading"
                    >
                      <h3 id="review-confirm-heading" className="text-sm font-bold text-slate-900">
                        Everything looks good?
                      </h3>
                      <p className="mt-1.5 text-[13px] leading-relaxed text-slate-500">
                        Submit your booking request and our team will review the trip details and
                        arrange the next steps.
                      </p>

                      {/* A failed submission keeps every field intact — the reason is
                          repeated next to the action itself so the customer never has to
                          scroll back to the top of the page to find out what went wrong. */}
                      {submitError && (
                        <div
                          className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-snug text-red-700"
                          role="alert"
                        >
                          <span className="font-semibold">Unable to submit your booking.</span>{' '}
                          {submitError}
                        </div>
                      )}

                      {/* Single primary action. Never permanently disabled — pressing it
                          runs the existing validation and routes the customer to whichever
                          step actually owns the missing information. On small screens the
                          same action lives in the sticky bar below, so only one submit
                          control is ever actionable at a time. */}
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        aria-disabled={!reviewIsValid}
                        className={`mt-4 hidden w-full items-center justify-center gap-1.5 rounded-lg px-5 py-3.5 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 lg:flex ${
                          reviewIsValid
                            ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600'
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {isSubmitting ? (
                          <>
                            <span
                              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
                              aria-hidden="true"
                            />
                            Submitting…
                          </>
                        ) : (
                          <>
                            Submit Booking
                            <svg
                              className="h-4 w-4 shrink-0"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2.5}
                                d="M5 12h14m0 0l-5-5m5 5l-5 5"
                              />
                            </svg>
                          </>
                        )}
                      </button>

                      {!reviewIsValid && shipmentHint && (
                        <p className="mt-2 text-center text-[11px] leading-snug text-slate-400 lg:text-left">
                          {shipmentHint}
                        </p>
                      )}
                    </section>
                  </div>
                </div>

                {/* Mobile sticky CTA — the same single primary submission action, pinned
                    to the bottom on small screens where the summary column is stacked. */}
                {!isDesktop && (
                  <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 shadow-[0_-2px_12px_-6px_rgba(15,23,42,0.18)] backdrop-blur">
                    <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-[13px] font-bold leading-tight ${
                            routeResolved ? 'text-amber-600' : 'text-slate-300'
                          }`}
                        >
                          {routeResolved ? fareDisplay : '—'}
                        </p>
                        <p className="truncate text-[11px] leading-tight text-slate-500">
                          {getVehicleName(formData.vehicle_type_required)}
                          {routeResolved ? ` · ${distanceDisplay}` : ''}
                        </p>
                      </div>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        aria-disabled={!reviewIsValid}
                        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-4 py-2.5 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 ${
                          isSubmitting
                            ? 'bg-slate-100 text-slate-400'
                            : reviewIsValid
                              ? 'bg-amber-500 text-white shadow-md hover:bg-amber-600'
                              : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {isSubmitting ? (
                          <>
                            <span
                              className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                              aria-hidden="true"
                            />
                            Submitting…
                          </>
                        ) : (
                          <>
                            Submit Booking
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12h14m0 0l-5-5m5 5l-5 5" />
                            </svg>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </form>

          {/* WhatsApp Button (shown when route is calculated) */}
          {routeStatus === 'success' && routeData && (
            <div className="mt-4">
              <button
                type="button"
                onClick={handleWhatsAppBooking}
                className="flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-3 px-5 rounded-lg transition-colors w-full sm:w-auto"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                <span>Book via WhatsApp</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default BookTransport;

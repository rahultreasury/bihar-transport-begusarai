/**
 * vehiclePricing.js
 *
 * Single source of truth for per-kilometre vehicle pricing on the backend.
 * Mirrors the fleet catalogue shown on the Home page so every vehicle uses its
 * OWN rate range and selected (mid) rate.
 *
 * Each entry:
 *   id    — unique vehicle slug (matches Home.jsx vehicleTypes[].id and
 *           /book-transport?vehicle=<id>)
 *   name  — display name
 *   type  — legacy generic category (pickup / mini_truck / truck)
 *   rate  — selected/mid per-km rate used for price calculation
 *   min   — lower bound of the displayed rate range
 *   max   — upper bound of the displayed rate range
 */

const VEHICLE_PRICING = {
  'tata-ace': {
    id: 'tata-ace',
    name: 'Tata Ace',
    type: 'pickup',
    rate: 22.5,
    min: 20,
    max: 25,
  },
  'ashok-leyland-dost': {
    id: 'ashok-leyland-dost',
    name: 'Ashok Leyland Dost',
    type: 'pickup',
    rate: 27.5,
    min: 25,
    max: 30,
  },
  'pickup-truck': {
    id: 'pickup-truck',
    name: 'Mahindra Bolero Pik-Up (Extra Long)',
    type: 'pickup',
    rate: 32.5,
    min: 30,
    max: 35,
  },
  'tata-407-10ft': {
    id: 'tata-407-10ft',
    name: 'Tata 407 (10 ft)',
    type: 'mini_truck',
    rate: 38.5,
    min: 35,
    max: 42,
  },
  'tata-407-14ft': {
    id: 'tata-407-14ft',
    name: 'Tata 407 (14 ft)',
    type: 'mini_truck',
    rate: 43.5,
    min: 42,
    max: 45,
  },
  'truck-17ft': {
    id: 'truck-17ft',
    name: '17 ft Truck',
    type: 'truck',
    rate: 50,
    min: 45,
    max: 55,
  },
  'truck-19ft': {
    id: 'truck-19ft',
    name: '19 ft Truck',
    type: 'truck',
    rate: 57.5,
    min: 55,
    max: 60,
  },
  'truck-22ft-10ton': {
    id: 'truck-22ft-10ton',
    name: '22 ft Truck (10 Ton)',
    type: 'truck',
    rate: 62.5,
    min: 60,
    max: 65,
  },
  'truck-22ft-12ton': {
    id: 'truck-22ft-12ton',
    name: '22 ft Truck (12 Ton)',
    type: 'truck',
    rate: 67.5,
    min: 65,
    max: 70,
  },
  'truck-22ft-heavy': {
    id: 'truck-22ft-heavy',
    name: '22 ft Heavy Truck',
    type: 'truck',
    rate: 72.5,
    min: 70,
    max: 75,
  },
  'truck-24ft': {
    id: 'truck-24ft',
    name: '24 ft Truck',
    type: 'truck',
    rate: 60,
    min: 58,
    max: 62,
  },
  'wheeler-10': {
    id: 'wheeler-10',
    name: '10 Wheeler',
    type: 'truck',
    rate: 78,
    min: 76,
    max: 80,
  },
  'wheeler-12': {
    id: 'wheeler-12',
    name: '12 Wheeler',
    type: 'truck',
    rate: 92,
    min: 90,
    max: 94,
  },
  'wheeler-14': {
    id: 'wheeler-14',
    name: '14 Wheeler',
    type: 'truck',
    rate: 102,
    min: 100,
    max: 104,
  },
  'wheeler-16': {
    id: 'wheeler-16',
    name: '16 Wheeler',
    type: 'truck',
    rate: 118,
    min: 116,
    max: 120,
  },
  'wheeler-18': {
    id: 'wheeler-18',
    name: '18 Wheeler',
    type: 'truck',
    rate: 135,
    min: 133,
    max: 137,
  },
  'container-32ft-single-axle': {
    id: 'container-32ft-single-axle',
    name: '32 ft Container (Single Axle)',
    type: 'truck',
    rate: 68,
    min: 67,
    max: 69,
  },
  'container-32ft-multi-axle': {
    id: 'container-32ft-multi-axle',
    name: '32 ft Container (Multi Axle)',
    type: 'truck',
    rate: 102,
    min: 101,
    max: 103,
  },
};

// Legacy generic type aliases kept for backward compatibility with callers that
// still send the old 5-value contract (e.g. BookTransport radio buttons).
// Each alias resolves to a representative vehicle from the catalogue.
const LEGACY_TYPE_FALLBACK = {
  truck: 'truck-17ft',
  mini_truck: 'tata-407-10ft',
  pickup: 'pickup-truck',
  tempo: 'tata-407-14ft',
  lorry: 'truck-19ft',
};

const isValidVehicleId = (id) =>
  typeof id === 'string' && Object.prototype.hasOwnProperty.call(VEHICLE_PRICING, id);

/**
 * Resolve pricing for a vehicle identifier.
 * Accepts a unique vehicle id (e.g. 'tata-ace') or a legacy generic type
 * (e.g. 'truck'). Returns a cloned pricing object, or null when unknown.
 */
const getVehiclePricing = (id) => {
  if (isValidVehicleId(id)) {
    return { ...VEHICLE_PRICING[id] };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_TYPE_FALLBACK, id)) {
    const fallbackId = LEGACY_TYPE_FALLBACK[id];
    return { ...VEHICLE_PRICING[fallbackId], legacyType: id };
  }
  return null;
};

/** Return the selected/mid per-km rate, or null when the vehicle is unknown. */
const getVehicleRate = (id) => {
  const pricing = getVehiclePricing(id);
  return pricing ? pricing.rate : null;
};

/** Return all valid vehicle ids (for validation purposes). */
const getValidVehicleIds = () => Object.keys(VEHICLE_PRICING);

module.exports = {
  VEHICLE_PRICING,
  LEGACY_TYPE_FALLBACK,
  isValidVehicleId,
  getVehiclePricing,
  getVehicleRate,
  getValidVehicleIds,
};


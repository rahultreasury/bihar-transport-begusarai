/**
 * vehicleCatalogue.js
 *
 * SINGLE SOURCE OF TRUTH for the frontend vehicle fleet catalogue.
 *
 * Consumed by:
 *   - Home.jsx        (fleet & pricing catalogue, quick booking, price calculator)
 *   - BookTransport.jsx (booking form vehicle selection)
 *
 * This module owns the display data only:
 *   - images  (real webp assets; pages fall back to SVG icons from
 *              src/components/icons/VehicleIcons.jsx when an image is missing)
 *   - name, capacity, category, wheels, length, bestFor
 *   - display per-km rate range (priceLabel, priceMin, priceMax) and mid rate (price)
 *
 * NOTE: This is a PURE DATA module. It intentionally contains NO JSX / React
 * components. SVG fallback icons live in src/components/icons/VehicleIcons.jsx
 * and are resolved at render time via getVehicleIcon(id).
 *
 * The backend (services/vehiclePricing.js) remains the authoritative source for
 * price CALCULATION. This file must stay in sync with that catalogue so every
 * vehicle id/slug matches 1:1 (e.g. 'tata-ace', 'truck-17ft').
 *
 * Do NOT duplicate these image imports anywhere else — consume `vehicle.image`.
 */

// Vehicle images — real images live in src/assets/vehicles.
import tataAceImg from '../assets/vehicles/tata-ace.webp';
import ashokLeylandDostImg from '../assets/vehicles/ashok-leyland-dost.webp';
import pickupTruckImg from '../assets/vehicles/pickup-truck.webp';
import tata40710ftImg from '../assets/vehicles/tata-407-10ft.webp';
import tata40714ftImg from '../assets/vehicles/tata-407-14ft.webp';
import truck17ftImg from '../assets/vehicles/truck-17ft.webp';
import truck19ftImg from '../assets/vehicles/truck-19ft.webp';
import truck22ft10tonImg from '../assets/vehicles/truck-22ft-10ton.webp';
import wheeler14Img from '../assets/vehicles/14-wheeler.webp';
import truck16WheelerImg from '../assets/vehicles/truck-16-wheeler.webp';
import truck18WheelerImg from '../assets/vehicles/truck-18-wheeler.webp';
import container32ftSingleImg from '../assets/vehicles/container-32ft-single.webp';
import container32ftMultiImg from '../assets/vehicles/container-32ft-multi.webp';

/**
 * The full 18-vehicle fleet catalogue.
 *
 * Every vehicle uses its UNIQUE id (slug) as the canonical identifier. The
 * legacy `type` (pickup / mini_truck / truck) is kept for display grouping and
 * backward compatibility but is never used for selection or pricing on the
 * frontend. The backend resolves per-km rates from the matching id.
 */
export const vehicleTypes = [
  {
    id: 'tata-ace',
    type: 'pickup',
    name: 'Tata Ace',
    image: tataAceImg,
    capacity: '1000 KG',
    capacityKg: 1000,
    category: 'Light Commercial',
    wheels: 4,
    lengthFt: 8,
    priceLabel: '₹20–25/km',
    price: 22.5,
    priceMin: 20,
    priceMax: 25,
    bestFor: ['Small household goods', 'E-commerce deliveries', 'Small business shipments']
  },
  {
    id: 'ashok-leyland-dost',
    type: 'pickup',
    name: 'Ashok Leyland Dost',
    image: ashokLeylandDostImg,
    capacity: '1.5 Ton (1500 KG)',
    capacityKg: 1500,
    category: 'Light Commercial',
    wheels: 4,
    lengthFt: 9,
    priceLabel: '₹25–30/km',
    price: 27.5,
    priceMin: 25,
    priceMax: 30,
    bestFor: ['Furniture', 'Agricultural goods', 'Retail supply']
  },
  {
    id: 'pickup-truck',
    type: 'pickup',
    name: 'Mahindra Bolero Pik-Up (Extra Long)',
    image: pickupTruckImg,
    capacity: '2 Ton',
    capacityKg: 2000,
    category: 'Light Commercial',
    wheels: 6,
    lengthFt: 10,
    priceLabel: '₹30–35/km',
    price: 32.5,
    priceMin: 30,
    priceMax: 35,
    bestFor: ['Construction material', 'Industrial supplies', 'Medium goods']
  },
  {
    id: 'tata-407-10ft',
    type: 'mini_truck',
    name: 'Tata 407 (10 ft)',
    image: tata40710ftImg,
    capacity: '3 Ton',
    capacityKg: 3000,
    category: 'Heavy Commercial',
    wheels: 6,
    lengthFt: 10,
    priceLabel: '₹35–42/km',
    price: 38.5,
    priceMin: 35,
    priceMax: 42,
    bestFor: ['Construction material', 'Industrial supplies', 'Medium goods']
  },
  {
    id: 'tata-407-14ft',
    type: 'mini_truck',
    name: 'Tata 407 (14 ft)',
    image: tata40714ftImg,
    capacity: '4 Ton',
    capacityKg: 4000,
    category: 'Heavy Commercial',
    wheels: 6,
    lengthFt: 14,
    priceLabel: '₹42–45/km',
    price: 43.5,
    priceMin: 42,
    priceMax: 45,
    bestFor: ['Furniture shifting', 'Commercial goods', 'Retail distribution']
  },
  {
    id: 'truck-17ft',
    type: 'truck',
    name: '17 ft Truck',
    image: truck17ftImg,
    capacity: '4–5 Ton',
    capacityKg: 4500,
    category: 'Heavy Commercial',
    wheels: 6,
    lengthFt: 17,
    priceLabel: '₹45–55/km',
    price: 50,
    priceMin: 45,
    priceMax: 55,
    bestFor: ['Intercity goods', 'FMCG loads', 'Warehouse transfer']
  },
  {
    id: 'truck-19ft',
    type: 'truck',
    name: '19 ft Truck',
    image: truck19ftImg,
    capacity: '7–8 Ton',
    capacityKg: 7500,
    category: 'Heavy Commercial',
    wheels: 6,
    lengthFt: 19,
    priceLabel: '₹55–60/km',
    price: 57.5,
    priceMin: 55,
    priceMax: 60,
    bestFor: ['Bulk FMCG', 'Packed goods', 'Full truck load']
  },
  {
    id: 'truck-22ft-10ton',
    type: 'truck',
    name: '22 ft Truck',
    image: truck22ft10tonImg,
    capacity: '10 Ton',
    capacityKg: 10000,
    category: 'Heavy Commercial',
    wheels: 10,
    lengthFt: 22,
    priceLabel: '₹60–65/km',
    price: 62.5,
    priceMin: 60,
    priceMax: 65,
    bestFor: ['Full truck load', 'Heavy machinery', 'Bulk freight']
  },
  {
    id: 'truck-22ft-12ton',
    type: 'truck',
    name: '22 ft Truck',
    capacity: '12 Ton',
    capacityKg: 12000,
    category: 'Heavy Commercial',
    wheels: 10,
    lengthFt: 22,
    priceLabel: '₹65–70/km',
    price: 67.5,
    priceMin: 65,
    priceMax: 70,
    bestFor: ['Heavy cargo', 'Industrial material', 'Bulk transport']
  },
  {
    id: 'truck-22ft-heavy',
    type: 'truck',
    name: '22 ft Heavy Truck',
    capacity: '12 Ton Heavy',
    capacityKg: 12000,
    category: 'Heavy Commercial',
    wheels: 10,
    lengthFt: 22,
    priceLabel: '₹70–75/km',
    price: 72.5,
    priceMin: 70,
    priceMax: 75,
    bestFor: ['Oversized cargo', 'Industrial equipment', 'High-density goods']
  },
  {
    id: 'truck-24ft',
    type: 'truck',
    name: '24 ft Truck',
    capacity: '13 Ton',
    capacityKg: 13000,
    category: 'Heavy Commercial',
    wheels: 10,
    lengthFt: 24,
    priceLabel: 'Around ₹60/km',
    price: 60,
    priceMin: 58,
    priceMax: 62,
    bestFor: ['Long-haul freight', 'Bulk goods', 'FTL shipments']
  },
  {
    id: 'wheeler-10',
    type: 'truck',
    name: '10 Wheeler',
    capacity: '18 Ton',
    capacityKg: 18000,
    category: 'Heavy Commercial',
    wheels: 10,
    lengthFt: 24,
    priceLabel: 'Around ₹78/km',
    price: 78,
    priceMin: 76,
    priceMax: 80,
    bestFor: ['Heavy industrial loads', 'Construction material', 'Bulk cargo']
  },
  {
    id: 'wheeler-12',
    type: 'truck',
    name: '12 Wheeler',
    capacity: '25 Ton',
    capacityKg: 25000,
    category: 'Heavy Commercial',
    wheels: 12,
    lengthFt: 28,
    priceLabel: 'Around ₹92/km',
    price: 92,
    priceMin: 90,
    priceMax: 94,
    bestFor: ['Large-scale freight', 'Mining material', 'Industrial bulk']
  },
  {
    id: 'wheeler-14',
    type: 'truck',
    name: '14 Wheeler',
    image: wheeler14Img,
    capacity: '30 Ton',
    capacityKg: 30000,
    category: 'Heavy Commercial',
    wheels: 14,
    lengthFt: 30,
    priceLabel: 'Around ₹102/km',
    price: 102,
    priceMin: 100,
    priceMax: 104,
    bestFor: ['Very heavy loads', 'Infrastructure material', 'Bulk industrial']
  },
  {
    id: 'wheeler-16',
    type: 'truck',
    name: '16 Wheeler',
    image: truck16WheelerImg,
    capacity: '35 Ton',
    capacityKg: 35000,
    category: 'Heavy Commercial',
    wheels: 16,
    lengthFt: 32,
    priceLabel: 'Around ₹118/km',
    price: 118,
    priceMin: 116,
    priceMax: 120,
    bestFor: ['Extra heavy cargo', 'Project logistics', 'Bulk freight']
  },
  {
    id: 'wheeler-18',
    type: 'truck',
    name: '18 Wheeler',
    image: truck18WheelerImg,
    capacity: '43 Ton',
    capacityKg: 43000,
    category: 'Heavy Commercial',
    wheels: 18,
    lengthFt: 36,
    priceLabel: 'Around ₹135/km',
    price: 135,
    priceMin: 133,
    priceMax: 137,
    bestFor: ['Maximum capacity loads', 'Project cargo', 'Heavy machinery']
  },
  {
    id: 'container-32ft-single-axle',
    type: 'truck',
    name: '32 ft Container (Single Axle)',
    image: container32ftSingleImg,
    capacity: '7.5–10 Ton',
    capacityKg: 8750,
    category: 'Container',
    wheels: 6,
    lengthFt: 32,
    priceLabel: '₹68/km',
    price: 68,
    priceMin: 67,
    priceMax: 69,
    bestFor: ['Secure containerized goods', 'E-commerce bulk', 'Export-import cargo']
  },
  {
    id: 'container-32ft-multi-axle',
    type: 'truck',
    name: '32 ft Container (Multi Axle)',
    image: container32ftMultiImg,
    capacity: '18 Ton',
    capacityKg: 18000,
    category: 'Container',
    wheels: 12,
    lengthFt: 32,
    priceLabel: '₹102/km',
    price: 102,
    priceMin: 101,
    priceMax: 103,
    bestFor: ['Containerized FTL', 'Heavy sealed cargo', 'Long-distance transport']
  }
];

// Default vehicle selected in the quick booking / price calculator dropdown /
// booking form when no vehicle is specified.
// Uses the unique vehicle id (slug) so selection never collides between
// vehicles that share the same legacy `type` (e.g. 13 vehicles are `truck`).
export const DEFAULT_VEHICLE_ID = 'truck-17ft';

/** Return a catalogue vehicle by its unique id/slug, or undefined. */
export const getVehicleById = (id) =>
  vehicleTypes.find((v) => v.id === id);

/** Alias for getVehicleById — clearer when working with slugs from URLs. */
export const getVehicleBySlug = (id) =>
  vehicleTypes.find((v) => v.id === id);

/** Return the mid per-km rate (₹/km) for a vehicle id, or null. */
export const getVehicleRate = (id) => {
  const v = getVehicleById(id);
  return v ? v.price : null;
};

/** Return the display name for a vehicle id, or a formatted fallback. */
export const getVehicleName = (id) => {
  const v = getVehicleById(id);
  if (v) return v.name;
  if (!id) return '17 ft Truck';
  return id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
};

export default vehicleTypes;


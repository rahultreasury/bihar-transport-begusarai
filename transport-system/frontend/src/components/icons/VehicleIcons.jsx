/**
 * VehicleIcons.jsx
 *
 * SVG fallback icons for the vehicle fleet catalogue.
 *
 * The data module (src/data/vehicleCatalogue.js) is intentionally kept free of
 * JSX. Pages that render the fleet (Home.jsx, BookTransport.jsx) import these
 * icons and render them ONLY as a fallback when a vehicle does not have a real
 * image asset.
 *
 * getVehicleIcon(id) returns the canonical icon component for a vehicle id,
 * falling back to TruckIcon for unknown ids so rendering never crashes.
 */

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

const AceIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="14" y="26" width="24" height="16" rx="2" fill="#F5A623" />
    <rect x="38" y="30" width="12" height="12" rx="2" fill="#F5A623" />
    <circle cx="24" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="44" cy="46" r="4" fill="#1e3a5f" />
    <circle cx="24" cy="46" r="2" fill="#fff" />
    <circle cx="44" cy="46" r="2" fill="#fff" />
    <rect x="16" y="30" width="6" height="4" rx="1" fill="#1e3a5f" />
  </svg>
);

const HeavyTruckIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="18" width="40" height="22" rx="2" fill="#F5A623" />
    <rect x="44" y="24" width="14" height="16" rx="2" fill="#F5A623" />
    <circle cx="16" cy="44" r="4.5" fill="#1e3a5f" />
    <circle cx="32" cy="44" r="4.5" fill="#1e3a5f" />
    <circle cx="50" cy="44" r="4.5" fill="#1e3a5f" />
    <circle cx="16" cy="44" r="2.2" fill="#fff" />
    <circle cx="32" cy="44" r="2.2" fill="#fff" />
    <circle cx="50" cy="44" r="2.2" fill="#fff" />
    <rect x="8" y="22" width="8" height="5" rx="1" fill="#1e3a5f" />
  </svg>
);

const ContainerTruckIcon = () => (
  <svg viewBox="0 0 64 64" className="w-16 h-16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="20" width="52" height="20" rx="2" fill="#F5A623" />
    <rect x="4" y="20" width="52" height="6" rx="2" fill="#1e3a5f" opacity="0.9" />
    <line x1="14" y1="27" x2="14" y2="40" stroke="#1e3a5f" strokeWidth="1.5" opacity="0.4" />
    <line x1="32" y1="27" x2="32" y2="40" stroke="#1e3a5f" strokeWidth="1.5" opacity="0.4" />
    <line x1="50" y1="27" x2="50" y2="40" stroke="#1e3a5f" strokeWidth="1.5" opacity="0.4" />
    <circle cx="16" cy="44" r="4.5" fill="#1e3a5f" />
    <circle cx="46" cy="44" r="4.5" fill="#1e3a5f" />
    <circle cx="16" cy="44" r="2.2" fill="#fff" />
    <circle cx="46" cy="44" r="2.2" fill="#fff" />
    <rect x="44" y="22" width="6" height="6" rx="1" fill="#FBBF24" />
  </svg>
);

/**
 * Canonical icon per vehicle id — mirrors the icon assignments that previously
 * lived on each vehicle entry in the catalogue data module.
 */
const VEHICLE_ICON_MAP = {
  'tata-ace': AceIcon,
  'ashok-leyland-dost': PickupIcon,
  'pickup-truck': PickupIcon,
  'tata-407-10ft': MiniTruckIcon,
  'tata-407-14ft': TempoIcon,
  'truck-17ft': TruckIcon,
  'truck-19ft': TruckIcon,
  'truck-22ft-10ton': TruckIcon,
  'truck-22ft-12ton': TruckIcon,
  'truck-22ft-heavy': TruckIcon,
  'truck-24ft': TruckIcon,
  'wheeler-10': HeavyTruckIcon,
  'wheeler-12': HeavyTruckIcon,
  'wheeler-14': HeavyTruckIcon,
  'wheeler-16': HeavyTruckIcon,
  'wheeler-18': HeavyTruckIcon,
  'container-32ft-single-axle': ContainerTruckIcon,
  'container-32ft-multi-axle': ContainerTruckIcon
};

/**
 * Resolve a vehicle id to its fallback icon component.
 * Unknown ids gracefully fall back to TruckIcon.
 */
export const getVehicleIcon = (id) => VEHICLE_ICON_MAP[id] || TruckIcon;

export {
  TruckIcon,
  MiniTruckIcon,
  PickupIcon,
  TempoIcon,
  AceIcon,
  HeavyTruckIcon,
  ContainerTruckIcon
};

export default getVehicleIcon;


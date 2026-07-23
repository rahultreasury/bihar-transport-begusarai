/**
 * Vehicle Data — Used for pricing, fleet display, and booking
 */
const vehicles = [
  {
    id: 'pickup',
    name: 'Pickup',
    slug: 'pickup',
    capacity: '500–1000 kg',
    minCharge: 1500,
    ratePerKm: 12,
    images: [],
    description: 'Ideal for small loads, local deliveries, and household shifting.',
    metaDescription: 'Book pickup truck for goods transport. Starting ₹12/km. Best for small loads and local delivery.',
    keywords: 'pickup truck booking, small goods transport, local delivery pickup'
  },
  {
    id: 'mini-truck',
    name: 'Mini Truck',
    slug: 'mini-truck',
    capacity: '1000–2000 kg',
    minCharge: 2500,
    ratePerKm: 14,
    images: [],
    description: 'Perfect for medium loads, shop shifting, and intercity transport.',
    metaDescription: 'Book mini truck for goods transport. Starting ₹14/km. Best for medium loads and intercity transport.',
    keywords: 'mini truck booking, medium goods transport, mini truck for shifting'
  },
  {
    id: 'truck',
    name: 'Truck (6-Wheeler)',
    slug: 'truck-6-wheeler',
    capacity: '3000–5000 kg',
    minCharge: 5000,
    ratePerKm: 16,
    images: [],
    description: 'Suitable for large loads, business inventory, and commercial transport.',
    metaDescription: 'Book 6-wheeler truck for goods transport. Starting ₹16/km. For large loads and commercial goods.',
    keywords: 'truck booking, 6 wheeler truck, large goods transport, commercial truck'
  },
  {
    id: 'container',
    name: 'Container Truck',
    slug: 'container-truck',
    capacity: '7000–9000 kg',
    minCharge: 10000,
    ratePerKm: 20,
    images: [],
    description: 'Heavy-duty transport for industrial goods, machinery, and bulk cargo.',
    metaDescription: 'Book container truck for heavy goods. Starting ₹20/km. For industrial and bulk cargo transport.',
    keywords: 'container truck booking, heavy goods transport, industrial cargo truck'
  }
];

export default vehicles;


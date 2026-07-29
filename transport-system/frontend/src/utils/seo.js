/**
 * SEO Utility Functions — Shared across all resource pages
 * Auto-generates breadcrumbs, JSON-LD schemas, FAQs, and canonical URLs
 */
import states from '../data/resources/states';
import cities from '../data/resources/cities';
import routes from '../data/resources/routes';

const SITE_URL = 'https://bihartransport.in';
const SITE_NAME = 'Bihar Transport';
const PHONE = '+918210931799';

// ─── Breadcrumb ───────────────────────────────────────────
export function generateBreadcrumb(items) {
  const itemListElement = items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    item: `${SITE_URL}${item.path}`
  }));

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement
  };

  const links = items.map((item, i) => ({
    name: item.name,
    path: item.path,
    isLast: i === items.length - 1
  }));

  return { schema, links };
}

// ─── FAQ Schema ────────────────────────────────────────────
export function generateFAQSchema(faqs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a
      }
    }))
  };
}

// ─── Organization Schema ───────────────────────────────────
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/assets/logo.png`,
    telephone: PHONE,
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Main Road',
      addressLocality: 'Begusarai',
      addressRegion: 'Bihar',
      postalCode: '851101',
      addressCountry: 'IN'
    },
    sameAs: [
      'https://www.facebook.com/bihartransport.in',
      'https://www.linkedin.com/company/bihartransport/',
      'https://www.instagram.com/bihartransport.in/'
    ]
  };
}

// ─── LocalBusiness Schema ──────────────────────────────────
export function localBusinessSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: SITE_NAME,
    image: `${SITE_URL}/assets/logo.png`,
    telephone: PHONE,
    email: 'info@bihartransport.in',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Main Road',
      addressLocality: 'Begusarai',
      addressRegion: 'Bihar',
      postalCode: '851101',
      addressCountry: 'IN'
    },
    openingHours: 'Mo-Sa 08:00-20:00, Su 09:00-17:00',
    priceRange: '₹₹'
  };
}

// ─── WebPage Schema ────────────────────────────────────────
export function webPageSchema(name, description, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name,
    description,
    url,
    publisher: { '@type': 'Organization', name: SITE_NAME }
  };
}

// ─── Auto FAQ Generator ────────────────────────────────────
export function generateStateFAQs(stateName, capital, services) {
  const serviceList = services?.map(s => s.name).join(', ') || 'FTL, PTL';
  return [
    { q: `What transport services are available in ${stateName}?`, a: `We offer ${serviceList} services across all major cities in ${stateName}. Book trucks, mini trucks, and pickups online.` },
    { q: `How much does goods transport cost in ${stateName}?`, a: `Prices start at ₹12/km for pickups, ₹14/km for mini trucks, and ₹16/km for 6-wheeler trucks in ${stateName}. Use our online calculator for an instant quote.` },
    { q: `Which cities in ${stateName} do you serve?`, a: `We serve all major cities in ${stateName} including ${capital} and other key commercial hubs. Check our city listing for complete coverage.` },
    { q: `How do I book a truck in ${stateName}?`, a: `You can book online through our website in 2 minutes or call ${PHONE} for immediate assistance.` },
    { q: `Is GPS tracking available in ${stateName}?`, a: `Yes, all our vehicles come with real-time GPS tracking for your shipment in ${stateName}.` },
    { q: `What is the delivery time in ${stateName}?`, a: `Delivery times vary by distance. Local deliveries in 24-48 hours, intercity transit within 3-7 days depending on route.` },
    { q: `Do you offer FTL services in ${stateName}?`, a: `Yes, Full Truck Load (FTL) services are available across ${stateName} for bulk cargo and large shipments.` },
    { q: `Can I book transport from ${stateName} to other states?`, a: `Absolutely! We offer Pan India transport services from ${stateName} to all 28 states across India.` },
    { q: `What documents are needed for transport in ${stateName}?`, a: `Basic documents include GST number (for businesses), pickup/delivery address, and goods description. Our team will guide you.` },
    { q: `Is there a minimum charge for transport in ${stateName}?`, a: `Yes, minimum charges apply: ₹1,500 for pickups, ₹2,500 for mini trucks, and ₹5,000 for 6-wheeler trucks in ${stateName}.` }
  ];
}

export function generateCityFAQs(cityName, stateName) {
  return [
    { q: `What transport services are available in ${cityName}?`, a: `We offer FTL, PTL, mini truck, pickup, and container services in ${cityName}, ${stateName}.` },
    { q: `How to book goods transport in ${cityName}?`, a: `Book online on our website or call ${PHONE} for instant truck booking in ${cityName}.` },
    { q: `What is the cost of transport from ${cityName}?`, a: `Rates start at ₹12/km for pickups. Get an instant online quote for your route.` },
    { q: `Which areas in ${cityName} do you serve?`, a: `We cover all major areas and industrial zones in ${cityName}.` },
    { q: `Do you offer same-day delivery in ${cityName}?`, a: `Same-day delivery is available for local routes within ${cityName} for smaller loads.` },
    { q: `Can I track my shipment from ${cityName}?`, a: `Yes, all vehicles have GPS tracking. You can track your shipment in real-time.` },
    { q: `What industries do you serve in ${cityName}?`, a: `We serve all major industries in ${cityName} including manufacturing, retail, agriculture, and commercial sectors.` },
    { q: `Is insurance provided for goods from ${cityName}?`, a: `Yes, we provide transit insurance coverage for all shipments from ${cityName}.` }
  ];
}

export function generateRouteFAQs(fromCity, toCity, distanceKm, fromState, toState) {
  return [
    { q: `What is the distance from ${fromCity} to ${toCity}?`, a: `The distance from ${fromCity} (${fromState}) to ${toCity} (${toState}) is approximately ${distanceKm} km by road.` },
    { q: `How long does transport take from ${fromCity} to ${toCity}?`, a: `Goods transport from ${fromCity} to ${toCity} takes approximately ${Math.ceil(distanceKm / 60)} hours under normal conditions.` },
    { q: `What is the cost of transport from ${fromCity} to ${toCity}?`, a: `Prices start at ₹12/km. Total estimated cost from ${fromCity} to ${toCity}: ₹${(distanceKm * 12).toLocaleString()} onwards depending on vehicle type.` },
    { q: `What vehicles are available for ${fromCity} to ${toCity} route?`, a: `We offer pickups, mini trucks, 6-wheeler trucks, and container trucks for the ${fromCity} to ${toCity} route.` },
    { q: `How to book transport from ${fromCity} to ${toCity}?`, a: `Book online in 2 minutes or call ${PHONE} for immediate booking assistance.` },
    { q: `Is tracking available for ${fromCity} to ${toCity} shipments?`, a: `Yes, all shipments from ${fromCity} to ${toCity} come with real-time GPS tracking.` },
    { q: `Do you offer FTL from ${fromCity} to ${toCity}?`, a: `Yes, Full Truck Load services are available for the ${fromCity} to ${toCity} route for bulk cargo.` },
    { q: `Can I get a customized quote for ${fromCity} to ${toCity}?`, a: `Yes, contact us at ${PHONE} or use our online booking form for a customized quote based on your load type and requirements.` }
  ];
}

// ─── Related Content Generators ──────────────────────────
export function getRelatedStates(currentStateSlug, limit = 4) {
  const currentIdx = states.findIndex(s => s.slug === currentStateSlug);
  const related = [];
  // Get nearby states by region
  const regions = {
    'bihar': ['jharkhand', 'west-bengal', 'uttar-pradesh', 'assam'],
    'uttar-pradesh': ['delhi', 'bihar', 'madhya-pradesh', 'rajasthan'],
    'delhi': ['uttar-pradesh', 'haryana', 'punjab', 'rajasthan'],
    'punjab': ['haryana', 'himachal-pradesh', 'jammu-and-kashmir', 'delhi'],
    'haryana': ['delhi', 'punjab', 'uttar-pradesh', 'rajasthan'],
    'rajasthan': ['gujarat', 'madhya-pradesh', 'punjab', 'delhi'],
    'jharkhand': ['bihar', 'west-bengal', 'odisha', 'chhattisgarh'],
    'west-bengal': ['bihar', 'jharkhand', 'odisha', 'assam'],
    'maharashtra': ['gujarat', 'madhya-pradesh', 'karnataka', 'goa'],
    'gujarat': ['rajasthan', 'madhya-pradesh', 'maharashtra', 'goa'],
    'madhya-pradesh': ['uttar-pradesh', 'rajasthan', 'gujarat', 'maharashtra'],
    'tamil-nadu': ['karnataka', 'kerala', 'andhra-pradesh', 'telangana'],
    'karnataka': ['maharashtra', 'kerala', 'tamil-nadu', 'andhra-pradesh'],
    'andhra-pradesh': ['telangana', 'tamil-nadu', 'karnataka', 'odisha'],
    'telangana': ['andhra-pradesh', 'maharashtra', 'karnataka', 'chhattisgarh'],
    'kerala': ['tamil-nadu', 'karnataka', 'goa', 'maharashtra'],
    'odisha': ['west-bengal', 'jharkhand', 'chhattisgarh', 'andhra-pradesh'],
    'assam': ['west-bengal', 'bihar', 'arunachal-pradesh', 'nagaland'],
    'chhattisgarh': ['madhya-pradesh', 'odisha', 'jharkhand', 'telangana'],
    'himachal-pradesh': ['punjab', 'uttarakhand', 'jammu-and-kashmir', 'haryana'],
    'uttarakhand': ['uttar-pradesh', 'himachal-pradesh', 'delhi', 'haryana'],
    'goa': ['maharashtra', 'karnataka', 'kerala', 'tamil-nadu'],
    'jammu-and-kashmir': ['himachal-pradesh', 'punjab', 'uttarakhand', 'delhi'],
    'arunachal-pradesh': ['assam', 'nagaland', 'meghalaya', 'manipur'],
    'manipur': ['assam', 'nagaland', 'mizoram', 'tripura'],
    'meghalaya': ['assam', 'arunachal-pradesh', 'nagaland', 'manipur'],
    'mizoram': ['assam', 'manipur', 'tripura', 'meghalaya'],
    'nagaland': ['assam', 'arunachal-pradesh', 'manipur', 'meghalaya'],
    'sikkim': ['west-bengal', 'assam', 'bihar', 'jharkhand'],
    'tripura': ['assam', 'mizoram', 'meghalaya', 'manipur']
  };
  const relatedSlugs = regions[currentStateSlug] || [];
  relatedSlugs.forEach(slug => {
    const s = states.find(st => st.slug === slug);
    if (s) related.push(s);
  });
  if (related.length < limit) {
    states.filter(s => s.slug !== currentStateSlug).forEach(s => {
      if (!related.find(r => r.slug === s.slug) && related.length < limit) {
        related.push(s);
      }
    });
  }
  return related.slice(0, limit);
}

export function getRelatedCities(currentCitySlug, limit = 6) {
  const current = cities.find(c => c.slug === currentCitySlug);
  if (!current) return [];
  // Same state cities first
  const sameState = cities.filter(c => c.state === current.state && c.slug !== currentCitySlug);
  const result = sameState.slice(0, limit);
  // Fill remaining with other cities
  if (result.length < limit) {
    cities.filter(c => c.state !== current.state && !result.find(r => r.slug === c.slug))
      .forEach(c => { if (result.length < limit) result.push(c); });
  }
  return result;
}

export function getRelatedRoutes(currentRoute, limit = 6) {
  const result = [];
  // Same origin
  routes.filter(r => r.from === currentRoute.from && r.to !== currentRoute.to)
    .forEach(r => { if (result.length < limit) result.push(r); });
  // Same destination
  routes.filter(r => r.to === currentRoute.to && r.from !== currentRoute.from)
    .forEach(r => { if (result.length < limit) result.push(r); });
  // Fill with nearby
  if (result.length < limit) {
    routes.filter(r => r.fromState === currentRoute.fromState && r.id !== currentRoute.id)
      .forEach(r => { if (result.length < limit && !result.find(rt => rt.id === r.id)) result.push(r); });
  }

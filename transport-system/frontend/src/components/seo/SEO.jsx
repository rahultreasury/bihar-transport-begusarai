/**
 * SEO — Reusable Helmet wrapper for page-level metadata, Open Graph, Twitter Cards, and JSON-LD.
 *
 * Usage:
 *   <SEO
 *     title="Home | Bihar Transport"
 *     description="..."
 *     canonical="https://bihartransport.in/"
 *     schema={[...]}   // optional array of JSON-LD objects
 *   />
 *
 * Each page must pass its own unique metadata.  Do NOT import this component once
 * and set metadata globally — metadata must be unique per route.
 */

import { Helmet } from 'react-helmet-async';

const SITE_NAME = 'Bihar Transport';
const SITE_URL = 'https://bihartransport.in';
const DEFAULT_OG_IMAGE = '/assets/logo.png';
const TWITTER_HANDLE = '@BiharTransport';

export default function SEO({
  title,
  description,
  keywords,
  canonical,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = 'website',
  locale = 'en_IN',
  schema = [],
  noindex = false,
  children,
}) {
  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : `${SITE_NAME} | Pan India Truck Booking & Logistics Services`;

  const fullDescription =
    description ||
    'Book trucks online with Bihar Transport. Reliable logistics, FTL, PTL, industrial transportation, Pan India transport services since 1998.';

  const canonicalUrl = canonical || SITE_URL;

  // Default schemas always included
  const defaultSchema = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Bihar Transport',
      url: SITE_URL,
      logo: `${SITE_URL}/assets/logo.png`,
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
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Main Road, Begusarai',
        addressLocality: 'Begusarai',
        addressRegion: 'Bihar',
        postalCode: '851101',
        addressCountry: 'IN',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      name: 'Bihar Transport',
      image: `${SITE_URL}/assets/logo.png`,
      telephone: '+91-8210931799',
      email: 'info@bihartransport.in',
      foundingDate: '1998',
      openingHours: 'Mo-Sa 08:00-20:00, Su 09:00-17:00',
      areaServed: ['Begusarai', 'Patna', 'Bihar', 'India'],
      priceRange: '₹₹',
      url: SITE_URL,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: SITE_NAME,
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  const allSchema = [...defaultSchema, ...schema];

  return (
    <Helmet>
      {/* Primary Meta */}
      <title>{fullTitle}</title>
      <meta name="description" content={fullDescription} />
      {keywords && <meta name="keywords" content={keywords} />}
      <meta name="robots" content={noindex ? 'noindex, nofollow' : 'index, follow'} />
      <meta name="googlebot" content="index, follow" />
      <meta name="language" content={locale} />
      <meta name="theme-color" content="#1e3a5f" />
      <meta name="geo.region" content="IN-BR" />
      <meta name="geo.placename" content="Begusarai" />
      <meta name="geo.position" content="25.4200;85.9900" />
      <meta name="ICBM" content="25.4200, 85.9900" />

      {/* Canonical */}
      <link rel="canonical" href={canonicalUrl} />

      {/* Open Graph */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={fullDescription} />
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content={locale} />
      <meta property="og:image" content={`${SITE_URL}${ogImage}`} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content={fullTitle} />

      {/* Twitter Card */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content={TWITTER_HANDLE} />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={fullDescription} />
      <meta name="twitter:image" content={`${SITE_URL}${ogImage}`} />

      {/* JSON-LD Structured Data */}
      {allSchema.map((s, i) => (
        <script key={i} type="application/ld+json">
          {JSON.stringify(s)}
        </script>
      ))}

      {/* Children allow extra page-specific tags */}
      {children}
    </Helmet>
  );
}


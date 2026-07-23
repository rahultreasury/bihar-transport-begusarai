/**
 * Blog — Transport & logistics blog
 * Scalable architecture: listing page now, individual article pages later
 * SEO-optimized for /blog
 */
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';

// Initial blog posts — can be moved to a CMS/data file later
const blogPosts = [
  {
    id: 1,
    title: 'Complete Guide to Goods Transport from Bihar to Rest of India',
    excerpt: 'Everything you need to know about transporting goods from Bihar to major cities across India. Compare FTL vs PTL, pricing, and transit times.',
    slug: 'goods-transport-bihar-guide',
    date: '2024-01-15',
    category: 'Transport Guide',
    readTime: '5 min read',
  },
  {
    id: 2,
    title: 'Truck Loading Tips: How to Maximize Load Efficiency',
    excerpt: 'Learn how to pack and load your goods efficiently to save on transport costs. Best practices for FTL and PTL shipments.',
    slug: 'truck-loading-efficiency-tips',
    date: '2024-01-10',
    category: 'Tips & Tricks',
    readTime: '4 min read',
  },
  {
    id: 3,
    title: 'Understanding Transport Charges: per km rates explained',
    excerpt: 'A breakdown of how transport charges are calculated — per km rates, loading/unloading fees, toll charges, and GST.',
    slug: 'transport-charges-per-km-guide',
    date: '2024-01-05',
    category: 'Pricing',
    readTime: '6 min read',
  },
  {
    id: 4,
    title: 'Top 10 Transport Routes from Patna for Business Shipments',
    excerpt: 'Discover the busiest and most cost-effective transport routes from Patna for business goods movement across India.',
    slug: 'top-transport-routes-from-patna',
    date: '2023-12-28',
    category: 'Routes',
    readTime: '4 min read',
  },
  {
    id: 5,
    title: 'How GPS Tracking Improves Your Goods Transport Experience',
    excerpt: 'Real-time GPS tracking gives you complete visibility of your shipment. Learn how it works and why it matters.',
    slug: 'gps-tracking-goods-transport-benefits',
    date: '2023-12-20',
    category: 'Technology',
    readTime: '3 min read',
  },
  {
    id: 6,
    title: 'Bihar Transport Begusarai: 25+ Years of Logistics Excellence',
    excerpt: 'The story of Bihar Transport — from a small local business to a trusted Pan India logistics partner serving thousands of customers.',
    slug: 'bihar-transport-begusarai-history',
    date: '2023-12-15',
    category: 'Company',
    readTime: '5 min read',
  },
];

export default function Blog() {
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://bihartransport.com/' },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: 'https://bihartransport.com/blog' },
    ],
  };

  const blogSchema = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: 'Bihar Transport Blog',
    description: 'Transport and logistics guides, tips, and industry insights from Bihar Transport.',
    url: 'https://bihartransport.com/blog',
  };

  return (
    <>
      <SEO
        title="Transport & Logistics Blog"
        description="Expert guides, tips, and insights on goods transport, truck booking, logistics across India. Stay updated with Bihar Transport Blog."
        keywords="transport blog, logistics blog, goods transport tips, truck booking guide, Bihar Transport blog"
        canonical="https://bihartransport.com/blog"
        schema={[breadcrumbSchema, blogSchema]}
      />

      <div className="min-h-screen bg-gray-50">
        {/* Hero */}
        <section className="hero-gradient py-16">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl font-bold text-white mb-4">
              Transport & Logistics Blog
            </h1>
            <p className="text-blue-100 text-lg max-w-2xl mx-auto">
              Expert guides, tips, and insights on goods transportation across India. 
              Stay informed with the latest from Bihar Transport.
            </p>
          </div>
        </section>

        {/* Blog Posts Grid */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {blogPosts.map((post) => (
              <article
                key={post.id}
                className="bg-white rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden flex flex-col"
              >
                <div className="p-6 flex flex-col flex-1">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                      {post.category}
                    </span>
                    <span className="text-xs text-gray-400">{post.readTime}</span>
                  </div>
                  <h2 className="text-lg font-bold text-gray-900 mb-2 line-clamp-2">
                    {post.title}
                  </h2>
                  <p className="text-gray-600 text-sm mb-4 flex-1 line-clamp-3">
                    {post.excerpt}
                  </p>
                  <div className="flex items-center justify-between mt-auto pt-4 border-t border-gray-100">
                    <span className="text-xs text-gray-400">{post.date}</span>
                    <span className="text-amber-600 text-sm font-medium hover:text-amber-700 transition-colors inline-flex items-center gap-1">
                      Read More
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </span>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* CTA Section */}
          <div className="mt-16 bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-3">
              Need Transport Services?
            </h2>
            <p className="text-gray-600 mb-6 max-w-lg mx-auto">
              Skip the reading and get straight to booking. Get an instant quote for your goods transport needs.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                to="/book-transport"
                className="btn-primary inline-flex items-center justify-center"
              >
                Book Transport Now
              </Link>
              <a
                href="tel:+918210931799"
                className="btn-outline inline-flex items-center justify-center"
              >
                Call +91 82109 31799
              </a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}


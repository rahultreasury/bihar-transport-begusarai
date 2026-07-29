/**
 * NotFound — 404 page
 * Shown when a route does not match any existing page.
 */
import { Link } from 'react-router-dom';
import SEO from '../components/seo/SEO';

export default function NotFound() {
  return (
    <>
      <SEO
        title="Page Not Found"
        description="The page you are looking for does not exist. Return to Bihar Transport homepage."
        noindex={true}
      />
      <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white flex items-center justify-center px-4">
        <div className="text-center max-w-lg">
          <div className="text-8xl font-black text-amber-500 mb-4">404</div>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Page Not Found</h1>
          <p className="text-gray-600 mb-8 text-lg">
            The page you are looking for might have been moved or deleted. 
            Let us help you find what you need.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/"
              className="px-6 py-3 bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 transition-colors"
            >
              Go to Homepage
            </Link>
            <Link
              to="/book-transport"
              className="px-6 py-3 border-2 border-amber-500 text-amber-600 rounded-xl font-semibold hover:bg-amber-50 transition-colors"
            >
              Book Transport
            </Link>
            <a
              href="tel:+918210931799"
              className="px-6 py-3 border-2 border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors"
            >
              Call Us
            </a>
          </div>
        </div>
      </div>
    </>
  );
}


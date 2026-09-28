import { useContext } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AuthContext } from '../contexts/AuthContext';

const ADMIN_ROLES = ['admin', 'super_admin'];

/**
 * ProtectedRoute
 * Route guard that protects admin routes.
 *
 * Behavior:
 *  - authLoading true  → show a clean loading screen (no admin UI flash)
 *  - not authenticated → <Navigate to="/login" replace />
 *  - authenticated but wrong role → redirect appropriately
 *  - authenticated + authorized → render the protected page
 *
 * Never renders the protected page first and redirects afterward.
 */
export default function ProtectedRoute({
  children,
  roles = ADMIN_ROLES,
  loginPath = '/login',
  unauthorizedPath,
}) {
  const { user, authLoading } = useContext(AuthContext);
  const location = useLocation();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-amber-500" />
          <p className="text-sm text-muted">Checking authentication…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to={loginPath} replace state={{ from: location.pathname }} />;
  }

  if (roles && roles.length > 0 && !roles.includes(user.role)) {
    if (unauthorizedPath) {
      return <Navigate to={unauthorizedPath} replace />;
    }
    // Preserve the existing role-aware redirects for shared protected routes.
    if (user.role === 'customer') return <Navigate to="/dashboard" replace />;
    if (user.role === 'driver') return <Navigate to="/driver-dashboard" replace />;
    return <Navigate to={loginPath} replace />;
  }

  return children;
}

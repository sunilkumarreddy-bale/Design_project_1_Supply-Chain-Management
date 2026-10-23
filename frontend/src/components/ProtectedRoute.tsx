import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAppSelector } from '../app/store';
import type { Role } from '../types';

/** Redirects to /login without a token, to /forbidden when the role is not allowed. */
export default function ProtectedRoute({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { token, user } = useAppSelector((s) => s.auth);
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (!user) {
    return (
      <div className="page-loading" aria-busy="true">
        Loading your workspace...
      </div>
    );
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
}

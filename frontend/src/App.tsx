import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore, PortalRole } from './store/authStore';
import { LoginPage } from './pages/LoginPage';
import { DriverApp } from './portals/DriverApp/DriverApp';
import { CompanyDashboard } from './portals/CompanyDashboard/CompanyDashboard';
import { PublicTrackingPage } from './portals/PublicTracking/PublicTrackingPage';
import { BackendUnreachableBanner } from './components/ui/BackendUnreachableBanner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// Protected Route wrapper with isolated portal session resolution
interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  portalRole?: PortalRole;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children, allowedRoles, portalRole }) => {
  const { initialize, getPortalSession } = useAuthStore();

  const targetRole: PortalRole =
    portalRole || (allowedRoles?.includes('FLEET_MANAGER') ? 'FLEET_MANAGER' : 'DRIVER');

  const session = getPortalSession(targetRole);

  useEffect(() => {
    initialize(targetRole);
  }, [targetRole, initialize]);

  if (!session.isAuthenticated || !session.user || !session.token) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(session.user.role)) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  const { initialize } = useAuthStore();

  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <BackendUnreachableBanner />
        <Routes>
          {/* Public Authentication */}
          <Route path="/login" element={<LoginPage />} />

          {/* Ephemeral Public Tracking Link (No Authentication) */}
          <Route path="/track/:token" element={<PublicTrackingPage />} />

          {/* Driver Mobile Portal */}
          <Route
            path="/driver"
            element={
              <ProtectedRoute allowedRoles={['DRIVER', 'ADMIN']} portalRole="DRIVER">
                <DriverApp />
              </ProtectedRoute>
            }
          />

          {/* Company Management Console */}
          <Route
            path="/company/*"
            element={
              <ProtectedRoute allowedRoles={['FLEET_MANAGER', 'ADMIN']} portalRole="FLEET_MANAGER">
                <CompanyDashboard />
              </ProtectedRoute>
            }
          />

          {/* Alias /dashboard/* directly to Company Dashboard */}
          <Route
            path="/dashboard/*"
            element={
              <ProtectedRoute allowedRoles={['FLEET_MANAGER', 'ADMIN']} portalRole="FLEET_MANAGER">
                <CompanyDashboard />
              </ProtectedRoute>
            }
          />

          {/* Default Root Redirect */}
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

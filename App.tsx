import AuthPage from "./pages/AuthPage";
import React, { Suspense, useEffect } from 'react';
import { supabase } from './lib/supabase';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { HomePage } from './pages/HomePage';
import { SubscriptionPlansPage } from './pages/SubscriptionPlansPage';
import { PricingPage } from './pages/PricingPage';
import { UserDashboard } from './pages/UserDashboard';
import { AuthGuard } from './components/AuthGuard';
import { AdminGuard } from './components/AdminGuard';
import { UserGuard } from './components/UserGuard';
import { SubscriptionGuard } from './components/SubscriptionGuard';
import { ProfileCompleteGuard } from './components/ProfileCompleteGuard';

const Onboarding = React.lazy(() =>
  import('./pages/Onboarding').then(m => ({ default: m.Onboarding }))
);
import { AdminDashboard } from './pages/AdminDashboard';
import { ActivityLogPage } from './pages/ActivityLogPage';
import { SettingsPage } from './pages/SettingsPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { LinkedInCallback } from './pages/LinkedInCallback';
import { DevNavigation } from './components/DevNavigation';

function App() {
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      console.log('Session:', data.session);
    });
  }, []);

  return (
    <HashRouter>
      <DevNavigation />
      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/landing" element={<SubscriptionPlansPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/checkout/:planId" element={<AuthGuard><CheckoutPage /></AuthGuard>} />
        
        {/* OAuth Callbacks */}
        <Route path="/auth/linkedin/callback" element={<LinkedInCallback />} />
        
        {/* Auth */}
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/login" element={<Navigate to="/landing" replace />} />
        
        {/* App Routes (protected: require session + active subscription) */}
        <Route path="/app/onboarding" element={<Navigate to="/app/profile-setup" replace />} />
        <Route path="/app/profile-setup" element={
          <UserGuard>
            <SubscriptionGuard>
              <Suspense fallback={
                <div className="min-h-screen flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
                </div>
              }>
                <Onboarding />
              </Suspense>
            </SubscriptionGuard>
          </UserGuard>
        } />
        <Route path="/app/dashboard" element={
          <UserGuard>
            <SubscriptionGuard>
              <ProfileCompleteGuard>
                <UserDashboard />
              </ProfileCompleteGuard>
            </SubscriptionGuard>
          </UserGuard>
        } />
        <Route path="/app/logs" element={
          <UserGuard>
            <SubscriptionGuard>
              <ProfileCompleteGuard>
                <ActivityLogPage />
              </ProfileCompleteGuard>
            </SubscriptionGuard>
          </UserGuard>
        } />
        <Route path="/app/settings" element={
          <UserGuard>
            <SubscriptionGuard>
              <ProfileCompleteGuard>
                <SettingsPage />
              </ProfileCompleteGuard>
            </SubscriptionGuard>
          </UserGuard>
        } />
        <Route path="/app" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="/app/*" element={<Navigate to="/app/dashboard" replace />} />

        {/* Admin Routes - protected: requires auth_role === 'admin' */}
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
        <Route path="/admin/users" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
        <Route path="/admin/billing" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
        <Route path="/admin/posts" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
        <Route path="/admin/logs" element={<AdminGuard><AdminDashboard /></AdminGuard>} />
        <Route path="/admin/*" element={<Navigate to="/admin/dashboard" replace />} />
      </Routes>
    </HashRouter>
  );
}

export default App;

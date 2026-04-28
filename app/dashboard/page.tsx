'use client';

import { useEffect } from 'react';

/**
 * Next.js route /dashboard redirects to the SPA dashboard (hash route).
 */
export default function DashboardPage() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.location.replace('/#/app/dashboard');
    }
  }, []);
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
    </div>
  );
}

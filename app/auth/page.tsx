'use client';

import { useEffect } from 'react';

/**
 * Next.js /auth route: redirect to SPA hash route so the Travel Connect
 * sign-in/sign-up page (AuthPage) is used with full Supabase auth.
 */
export default function AuthPage() {
  useEffect(() => {
    const base = typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '';
    window.location.replace(base + '#/auth');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-amber-500 border-t-transparent" />
    </div>
  );
}

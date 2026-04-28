import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { getUserAuthRole } from '../lib/api';

type AdminGuardProps = {
  children: React.ReactNode;
};

/**
 * Protects /admin/* routes.
 * - No session → redirect to /auth
 * - Session but auth_role !== 'admin' → redirect to /app/dashboard
 * - auth_role === 'admin' → render children
 */
export const AdminGuard: React.FC<AdminGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  // undefined = still checking, null = not authorized, 'admin' = authorized
  const [status, setStatus] = useState<'loading' | 'authorized' | 'unauthorized'>('loading');

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (cancelled) return;

      if (error || !session?.user) {
        navigate('/auth', { replace: true });
        return;
      }

      const authRole = await getUserAuthRole(session.user.id);
      if (cancelled) return;

      if (authRole !== 'admin') {
        navigate('/app/dashboard', { replace: true });
        return;
      }

      setStatus('authorized');
    };

    void check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      if (!session) {
        navigate('/auth', { replace: true });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <div className="text-gray-600 text-sm">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
};

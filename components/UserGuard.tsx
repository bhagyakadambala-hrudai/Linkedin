import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getUserAuthRole } from '../lib/api';

type UserGuardProps = {
  children: React.ReactNode;
};

/**
 * Protects /app/* routes.
 * - No session → redirect to /auth
 * - Session but auth_role === 'admin' → redirect to /admin/dashboard
 * - Regular user → render children
 */
export const UserGuard: React.FC<UserGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [status, setStatus] = useState<'loading' | 'authorized'>('loading');
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const { data: { session: s }, error } = await supabase.auth.getSession();
      if (cancelled) return;
      initialCheckDone.current = true;

      if (error || !s?.user) {
        setSession(null);
        return;
      }

      const authRole = await getUserAuthRole(s.user.id);
      if (cancelled) return;

      if (authRole === 'admin') {
        navigate('/admin/dashboard', { replace: true });
        return;
      }

      setSession(s);
      setStatus('authorized');
    };

    void check();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!initialCheckDone.current || cancelled) return;
      setSession(newSession ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  useEffect(() => {
    if (session === null) {
      navigate('/auth', { replace: true });
    }
  }, [session, navigate]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <div className="text-gray-600 text-sm">Loading...</div>
      </div>
    );
  }

  return (
    <React.Fragment key={session?.user.id}>
      {children}
    </React.Fragment>
  );
};

import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthGuardProps = {
  children: React.ReactNode;
};

/** Redirects to /auth if there is no Supabase session; otherwise renders children. */
export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const initialCheckDone = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      const { data: { session: s }, error } = await supabase.auth.getSession();
      if (cancelled) return;
      if (error) {
        console.error('[AuthGuard] getSession error:', error);
      }
      initialCheckDone.current = true;
      setSession(s ?? null);
    };

    void checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        if (!initialCheckDone.current) return;
        if (cancelled) return;
        setSession(newSession ?? null);
      }
    );

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session === undefined) return;
    if (!session) {
      navigate('/auth', { replace: true });
    }
  }, [session, navigate]);

  if (session === undefined) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <div className="text-gray-600 text-sm">Loading...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return (
    <React.Fragment key={session.user.id}>
      {children}
    </React.Fragment>
  );
};

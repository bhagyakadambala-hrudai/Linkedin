import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSupabaseSettings, requireSessionUserId } from '../lib/api';
import { isProfileComplete } from '../lib/profileCompletion';
import { supabase } from '../lib/supabase';

type ProfileCompleteGuardProps = { children: React.ReactNode };

/** Sends users with incomplete required profile fields to profile setup before app pages. */
export const ProfileCompleteGuard: React.FC<ProfileCompleteGuardProps> = ({ children }) => {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      let sessionUserId: string;
      try {
        sessionUserId = await requireSessionUserId();
      } catch {
        setAllowed(false);
        setReady(true);
        return;
      }
      if (cancelled) return;

      const settings = await getSupabaseSettings(sessionUserId);
      if (cancelled) return;

      if (!isProfileComplete(settings)) {
        navigate('/app/profile-setup', { replace: true });
        setReady(true);
        return;
      }

      setAllowed(true);
      setReady(true);
    };

    void run();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAllowed(false);
        setReady(true);
        return;
      }
      if (event === 'INITIAL_SESSION') return;
      if (event !== 'SIGNED_IN' && event !== 'TOKEN_REFRESHED') return;
      if (cancelled) return;
      setReady(false);
      void run();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [navigate]);

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        <div className="text-gray-600 text-sm">Loading...</div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  return <>{children}</>;
};

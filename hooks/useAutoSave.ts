// Debounced auto-save to Supabase only (no localStorage — avoids cross-account profile leakage)

import { useEffect, useRef, useState, useCallback } from 'react';
import { ProfileSetupData } from '../types';
import { requireSessionUserId, upsertOnboardingProgress } from '../lib/api';
import { supabase } from '../lib/supabase';

const SUPABASE_DEBOUNCE_MS = 10000;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type UseAutoSaveOptions = {
  /** When false, debounced saves are skipped (e.g. until profile is hydrated from Supabase). */
  enabled?: boolean;
};

export function useAutoSave(
  data: ProfileSetupData,
  onSaved?: () => void | Promise<void>,
  options?: UseAutoSaveOptions
) {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const supabaseTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const dataRef = useRef(data);
  const onSavedRef = useRef(onSaved);
  const enabledRef = useRef(options?.enabled !== false);
  onSavedRef.current = onSaved;

  dataRef.current = data;
  enabledRef.current = options?.enabled !== false;

  const saveToSupabase = useCallback(async (formData: ProfileSetupData) => {
    setSaveStatus('saving');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !session.user) {
        console.error('User not authenticated');
        setSaveStatus('error');
        return;
      }
      const userId = await requireSessionUserId();
      console.log('Saving profile for user:', userId);
      console.log('Saving profile:', formData);

      const resumePayload =
        formData.resumeUploaded && formData.resumeUrl
          ? {
              resumeUrl: formData.resumeUrl,
              fileName: formData.resumeUrl.split('/').pop(),
              role: formData.role,
              skills: formData.skills,
              topics: formData.topics,
            }
          : undefined;

      await upsertOnboardingProgress(userId, session.user.email ?? null, {
        role: formData.role,
        skills: formData.skills,
        topics: formData.topics,
        portfolio_url: formData.portfolio_url || undefined,
        linkedin_connected: formData.linkedInConnected,
        ...(resumePayload ? { resume_data: resumePayload, resume_url: formData.resumeUrl.trim() } : {}),
      });

      setSaveStatus('saved');
      setLastSaved(new Date());
      try {
        await onSavedRef.current?.();
      } catch (_) {}
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Profile update failed:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 5000);
    }
  }, []);

  useEffect(() => {
    if (supabaseTimerRef.current) clearTimeout(supabaseTimerRef.current);
    if (!enabledRef.current) {
      return () => {
        if (supabaseTimerRef.current) clearTimeout(supabaseTimerRef.current);
      };
    }
    supabaseTimerRef.current = setTimeout(() => {
      void saveToSupabase(dataRef.current);
    }, SUPABASE_DEBOUNCE_MS);

    return () => {
      if (supabaseTimerRef.current) clearTimeout(supabaseTimerRef.current);
    };
  }, [data, saveToSupabase, options?.enabled]);

  const saveNow = useCallback(async () => {
    if (!enabledRef.current) return;
    if (supabaseTimerRef.current) clearTimeout(supabaseTimerRef.current);
    await saveToSupabase(dataRef.current);
  }, [saveToSupabase]);

  return { saveStatus, lastSaved, saveNow };
}

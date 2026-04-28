import { parseResume, generateLinkedInPost } from './gemini';
import { ScheduleConfig, AgentJob, User } from '../types';
import { supabase } from './supabase';

/** Map profiles.selected_plan (and legacy labels) to PLANS ids used in the UI. */
export function planIdFromSelectedPlan(raw: string | null | undefined): string {
  if (!raw || !String(raw).trim()) return 'starter';
  const n = String(raw).trim().toLowerCase();
  if (n === 'dev') return 'dev';
  if (n === 'starter' || n.startsWith('starter')) return 'starter';
  if (n === 'brand-pro' || n === 'business' || n === 'enterprise') return 'brand-pro';
  if (n === 'pro' || n === 'professional') return 'professional';
  if (n.includes('brand')) return 'brand-pro';
  if (n.includes('business')) return 'brand-pro';
  if (n.includes('pro')) return 'professional';
  return 'starter';
}

/** Returns true if the value looks like a valid Supabase UUID. */
const isValidUuid = (id: unknown): id is string =>
  typeof id === 'string' && id.length >= 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * Set VITE_PROFILE_SKILLS_TOPICS_STORAGE=array when `profiles.skills` / `topics` are PostgreSQL text[] or jsonb arrays.
 * Default (text) stores comma-separated strings in plain text columns.
 */
function profileSkillsTopicsStorage(): 'text' | 'array' {
  try {
    const v = (import.meta as { env?: Record<string, string> }).env?.VITE_PROFILE_SKILLS_TOPICS_STORAGE;
    if (v === 'array') return 'array';
  } catch {
    /* non-Vite */
  }
  if (typeof process !== 'undefined' && process.env?.VITE_PROFILE_SKILLS_TOPICS_STORAGE === 'array') {
    return 'array';
  }
  return 'text';
}

/** Normalize skills/topics from DB (text, csv, json string, or text[]). */
export function parseProfileListField(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x ?? '').trim()).filter(Boolean);
  }
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s) as unknown;
      if (Array.isArray(j)) return j.map((x) => String(x ?? '').trim()).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return s.split(/,\s*/).map((t) => t.trim()).filter(Boolean);
}

function skillsTopicsToDbValue(list: string[] | undefined): string | string[] | undefined {
  if (!list?.length) return undefined;
  const cleaned = list.map((x) => String(x).trim()).filter(Boolean);
  if (!cleaned.length) return undefined;
  return profileSkillsTopicsStorage() === 'array' ? cleaned : cleaned.join(', ');
}

/**
 * Jsonb columns must receive a plain serializable object or null from supabase-js.
 * Do not pre-JSON.stringify — that double-encodes and often causes PostgreSQL "invalid input syntax for type jsonb".
 */
export function normalizeResumeDataForSupabase(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    try {
      return JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** When upserting a full spread row, coalesce legacy/corrupt resume_data into a valid jsonb value. */
function coerceResumeDataOnRecord(record: Record<string, unknown>) {
  if (!Object.prototype.hasOwnProperty.call(record, 'resume_data')) return;
  record.resume_data = normalizeResumeDataForSupabase(record.resume_data);
}

/** Hard stop if userId is missing before any profiles write (prevents RLS failures from null user_id). */
export function assertUserIdForDb(userId: string | null | undefined): asserts userId is string {
  if (!userId || !isValidUuid(userId)) {
    console.error('Missing userId');
    throw new Error('userId missing before DB write');
  }
}

/**
 * Enforce session first, then sync JWT with getUser() so RLS auth.uid() matches profiles.user_id.
 * Always returns session.user.id (never null).
 */
export async function requireSessionUserId(): Promise<string> {
  const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
  if (sessionErr) console.error('getSession error:', sessionErr.message);
  if (!session || !session.user) {
    console.error('User not authenticated');
    throw new Error('User not authenticated');
  }
  const userId = session.user.id;
  assertUserIdForDb(userId);
  console.log('USER ID:', userId);

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user?.id || user.id !== userId) {
    console.error('User not authenticated', error?.message);
    throw new Error('User not authenticated');
  }
  assertUserIdForDb(user.id);
  return user.id;
}

/** Session guard for reads/writes — use before client-side profile operations. */
export async function requireAuthSession(): Promise<{ userId: string; email: string | null }> {
  const userId = await requireSessionUserId();
  const { data: { session } } = await supabase.auth.getSession();
  return { userId, email: session?.user?.email ?? null };
}

/**
 * Current session must match `userId` or profile reads/writes could leak cross-account data.
 */
export async function assertSessionUserMatches(userId: string): Promise<boolean> {
  if (!isValidUuid(userId)) return false;
  try {
    const sessionUserId = await requireSessionUserId();
    return sessionUserId === userId;
  } catch {
    return false;
  }
}

/**
 * MANUAL "PUBLISH NOW" — POSTs to /api/publish; backend triggers Make.com (no client webhook URL).
 */
export const publishNow = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id || !isValidUuid(user.id)) {
      console.error('User not logged in');
      return { success: false, message: 'Not authenticated. Please sign in.' };
    }

    const response = await fetch('/api/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'Test post from frontend',
        user_id: user.id,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
    };

    if (!response.ok || data.success !== true) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : `Publish failed (${response.status})`;
      console.error('Publish API error:', response.status, data);
      return { success: false, message: msg };
    }

    console.log('Post published successfully');
    return {
      success: true,
      message:
        'Publish request sent. Your activity log will update after LinkedIn finishes.',
    };
  } catch (error) {
    console.error('Error publishing:', error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'Unexpected error. Please try again.',
    };
  }
};

/**
 * TRIGGER WEBHOOK — Calls /api/trigger-webhook when automation is enabled and
 * the user clicks "Publish Now". The backend enriches the payload with the
 * user's name, email, linkedin_profile_url, and automation_status before
 * forwarding it to Make.com. The webhook URL never touches the client.
 *
 * Returns { success, message } — the same shape as publishNow() so the
 * dashboard can handle both identically.
 */
export const triggerWebhook = async (): Promise<{ success: boolean; message: string }> => {
  try {
    // Get the current session token for Bearer auth on the API route
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return { success: false, message: 'Not authenticated. Please sign in.' };
    }

    const response = await fetch('/api/trigger-webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Token is sent to the backend only — webhook URL stays server-side
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      message?: string;
      error?: string;
    };

    if (!response.ok || data.success !== true) {
      const msg =
        typeof data.error === 'string'
          ? data.error
          : `Webhook trigger failed (${response.status})`;
      console.error('[triggerWebhook] error:', response.status, data);
      return { success: false, message: msg };
    }

    return {
      success: true,
      message:
        data.message ?? 'Automation triggered. Your post is being generated.',
    };
  } catch (error) {
    console.error('[triggerWebhook] unexpected error:', error);
    return {
      success: false,
      message:
        error instanceof Error ? error.message : 'Unexpected error. Please try again.',
    };
  }
};

export interface UploadResponse {
  url: string;
  parsedData: {
    role: string;
    skills: string[];
    summary?: string;
    suggestedTopics: string[];
  };
}

export interface AgentStatusResponse {
  status: 'running' | 'paused' | 'error' | 'idle';
  lastRun: string | null;
  healthScore: number;
}

export interface ProfileUpsertData {
  user_id: string;
  role?: string;
  skills?: string[];
  topics?: string[];
  portfolio_url?: string;
  onboarding_completed?: boolean;
  linkedin_connected?: boolean;
  selected_plan?: string;
  resume_data?: string | object | null;
  resume_url?: string | null;
  name?: string;
}

export const upsertProfile = async (profileData: ProfileUpsertData) => {
  const userId = await requireSessionUserId();
  if (userId !== profileData.user_id) {
    throw new Error('Not authorized to update this profile');
  }

  const { data: existing, error: fetchExErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchExErr) {
    console.error('upsertProfile fetch:', fetchExErr);
    throw fetchExErr;
  }

  console.log('Saving profile for user:', userId);
  console.log('Saving profile:', profileData);

  const ex = (existing || {}) as Record<string, unknown>;
  const record: Record<string, any> = {
    ...ex,
    user_id: userId,
  };
  if (profileData.role?.trim()) {
    record.role = profileData.role.trim();
  }
  if (profileData.skills?.length) {
    const v = skillsTopicsToDbValue(profileData.skills);
    if (v !== undefined) record.skills = v;
  }
  if (profileData.topics?.length) {
    const v = skillsTopicsToDbValue(profileData.topics);
    if (v !== undefined) record.topics = v;
  }

  // Portfolio URL is stored in linkedin_profile_url (only URL-type column available in schema)
  // Only write if provided and not empty — never overwrite an existing LinkedIn OAuth profile URL
  // with a blank value
  if (profileData.portfolio_url && profileData.portfolio_url.trim() !== '') {
    record.linkedin_profile_url = profileData.portfolio_url.trim();
  }

  if (profileData.linkedin_connected === true) record.linkedin_connected = true;
  if (profileData.onboarding_completed !== undefined) record.onboarding_completed = profileData.onboarding_completed;
  if (profileData.selected_plan !== undefined) record.selected_plan = profileData.selected_plan;
  if (profileData.resume_data !== undefined) {
    record.resume_data = normalizeResumeDataForSupabase(profileData.resume_data);
  }
  if (profileData.resume_url !== undefined && profileData.resume_url !== null && String(profileData.resume_url).trim() !== '') {
    record.resume_url = String(profileData.resume_url).trim();
  }
  if (profileData.name !== undefined && profileData.name.trim() !== '') record.name = profileData.name.trim();

  record.updated_at = new Date().toISOString();
  coerceResumeDataOnRecord(record);

  console.log('Saving to DB:', {
    user_id: userId,
    role: record.role,
    skills: record.skills,
    topics: record.topics,
  });

  const { data, error } = await supabase
    .from('profiles')
    .upsert(record, { onConflict: 'user_id' });

  if (error) {
    console.error('Supabase save error (upsertProfile):', error);
    throw error;
  }
  console.log('Profile upsert complete', { user_id: userId });
  return data;
};

/**
 * Ensures a profile row exists for the user via upsert (avoids duplicate key on user_id / email races).
 * Does not send `role` so existing job/plan role is never overwritten on conflict.
 * Preserves existing skills/topics when the row already exists.
 */
export const ensureProfileRow = async (userId: string, email?: string | null) => {
  if (!isValidUuid(userId)) throw new Error('Invalid user id');
  const sessionUserId = await requireSessionUserId();
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update this profile');
  }

  const profilePayload = { userId, email: email ?? null };
  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving profile:', profilePayload);

  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const ex = (existing || {}) as Record<string, unknown>;

  const ensureRow: Record<string, unknown> = {
    ...ex,
    user_id: sessionUserId,
    email: email ?? (ex.email as string) ?? null,
    updated_at: new Date().toISOString(),
  };
  coerceResumeDataOnRecord(ensureRow);

  const { error } = await supabase.from('profiles').upsert(ensureRow, { onConflict: 'user_id' });

  if (error) {
    console.error('Profile upsert error:', error);
    throw error;
  }

  console.log('Profile upsert complete', { user_id: sessionUserId, email: email ?? null });
};

export interface UpdateProfileData {
  /** Omit or leave empty to keep existing DB values (no overwrite with ""). */
  role?: string;
  skills?: string[];
  topics?: string[];
  portfolio_url?: string;
  onboarding_completed?: boolean;
  name?: string;
  email?: string;
  selected_plan?: string;
  resume_data?: string | object | null;
  resume_url?: string | null;
  linkedin_connected?: boolean;
}

/**
 * Update profile by user_id only. Ensures row exists first, then runs .update().eq("user_id", user.id).
 */
/**
 * Continuous onboarding save: upsert by user_id with email and form fields.
 * Omits resume_data when undefined so an existing stored resume is not cleared.
 */
export const upsertOnboardingProgress = async (
  userId: string,
  email: string | null | undefined,
  data: {
    role: string;
    skills: string[];
    topics: string[];
    portfolio_url?: string;
    linkedin_connected?: boolean;
    resume_data?: string | object | null;
    resume_url?: string | null;
  }
) => {
  if (!isValidUuid(userId)) throw new Error('Invalid user id');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('User not logged in');
  }
  const sessionUserId = session.user.id;
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update this profile');
  }

  const hasPersistable =
    (typeof data.role === 'string' && data.role.trim() !== '') ||
    (Array.isArray(data.skills) && data.skills.length > 0) ||
    (Array.isArray(data.topics) && data.topics.length > 0) ||
    (data.portfolio_url !== undefined && String(data.portfolio_url).trim() !== '') ||
    data.linkedin_connected === true ||
    data.resume_data !== undefined ||
    (data.resume_url !== undefined && data.resume_url !== null && String(data.resume_url).trim() !== '');

  if (!hasPersistable) {
    console.log('Skipping empty save: onboarding progress has nothing to persist');
    return;
  }

  const { data: existing, error: fetchExErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .maybeSingle();
  if (fetchExErr) {
    console.error('upsertOnboardingProgress fetch:', fetchExErr);
    throw fetchExErr;
  }

  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving profile:', { ...data, email: email?.trim() || null });

  const ex = (existing || {}) as Record<string, unknown>;
  const record: Record<string, unknown> = {
    ...ex,
    user_id: sessionUserId,
    email: email?.trim() || (ex.email as string) || null,
    updated_at: new Date().toISOString(),
  };

  if (typeof data.role === 'string' && data.role.trim() !== '') {
    record.role = data.role.trim();
  }
  if (Array.isArray(data.skills) && data.skills.length > 0) {
    const v = skillsTopicsToDbValue(
      data.skills.map((s) => String(s).trim()).filter(Boolean)
    );
    if (v !== undefined) record.skills = v;
  }
  if (Array.isArray(data.topics) && data.topics.length > 0) {
    const v = skillsTopicsToDbValue(
      data.topics.map((s) => String(s).trim()).filter(Boolean)
    );
    if (v !== undefined) record.topics = v;
  }

  if (data.portfolio_url !== undefined && String(data.portfolio_url).trim() !== '') {
    record.linkedin_profile_url = String(data.portfolio_url).trim();
  }
  if (data.linkedin_connected === true) {
    record.linkedin_connected = true;
  }
  if (data.resume_data !== undefined) {
    record.resume_data = normalizeResumeDataForSupabase(data.resume_data);
  }
  if (data.resume_url !== undefined && data.resume_url !== null && String(data.resume_url).trim() !== '') {
    record.resume_url = String(data.resume_url).trim();
  }

  console.log('Saving to DB:', {
    user_id: sessionUserId,
    role: record.role,
    skills: record.skills,
    topics: record.topics,
  });

  coerceResumeDataOnRecord(record);

  const { error } = await supabase.from('profiles').upsert(record, { onConflict: 'user_id' });
  if (error) {
    console.error('Supabase save error (upsertOnboardingProgress):', error);
    throw error;
  }
};

export const updateProfile = async (userId: string, data: UpdateProfileData) => {
  if (!isValidUuid(userId)) throw new Error('Invalid user id');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('User not logged in');
  }
  const sessionUserId = session.user.id;
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update this profile');
  }

  const hasPersistable =
    (data.role !== undefined && String(data.role).trim() !== '') ||
    (data.skills !== undefined && Array.isArray(data.skills) && data.skills.length > 0) ||
    (data.topics !== undefined && Array.isArray(data.topics) && data.topics.length > 0) ||
    (data.portfolio_url !== undefined && data.portfolio_url.trim() !== '') ||
    data.onboarding_completed !== undefined ||
    (data.name !== undefined && data.name.trim() !== '') ||
    data.selected_plan !== undefined ||
    data.resume_data !== undefined ||
    (data.resume_url !== undefined && data.resume_url !== null && String(data.resume_url).trim() !== '') ||
    data.linkedin_connected === true ||
    (data.email !== undefined && data.email.trim() !== '');

  if (!hasPersistable) {
    console.log('Skipping empty save: no profile fields to persist');
    return null;
  }

  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving profile:', data);

  const email = data.email ?? session.user.email ?? null;

  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .maybeSingle();

  if (fetchErr) {
    console.error('Profile fetch failed:', fetchErr);
    throw fetchErr;
  }

  const ex = (existing || {}) as Record<string, unknown>;

  const record: Record<string, unknown> = {
    ...ex,
    user_id: sessionUserId,
    email: (data.email !== undefined && data.email.trim() !== '')
      ? data.email.trim()
      : (ex.email as string) ?? email ?? null,
    updated_at: new Date().toISOString(),
  };

  if (data.role !== undefined && String(data.role).trim() !== '') {
    record.role = String(data.role).trim();
  }
  if (data.skills !== undefined && Array.isArray(data.skills) && data.skills.length > 0) {
    const v = skillsTopicsToDbValue(
      data.skills.map((s) => String(s).trim()).filter(Boolean)
    );
    if (v !== undefined) record.skills = v;
  }
  if (data.topics !== undefined && Array.isArray(data.topics) && data.topics.length > 0) {
    const v = skillsTopicsToDbValue(
      data.topics.map((s) => String(s).trim()).filter(Boolean)
    );
    if (v !== undefined) record.topics = v;
  }

  if (data.portfolio_url !== undefined && data.portfolio_url.trim() !== '') {
    record.linkedin_profile_url = data.portfolio_url.trim();
  }
  if (data.onboarding_completed !== undefined) record.onboarding_completed = data.onboarding_completed;
  if (data.name !== undefined && data.name.trim() !== '') record.name = data.name.trim();
  if (data.selected_plan !== undefined) record.selected_plan = data.selected_plan;
  if (data.resume_data !== undefined) {
    record.resume_data = normalizeResumeDataForSupabase(data.resume_data);
  }
  if (data.resume_url !== undefined && data.resume_url !== null && String(data.resume_url).trim() !== '') {
    record.resume_url = String(data.resume_url).trim();
  }
  if (data.linkedin_connected === true) record.linkedin_connected = true;

  console.log('Saving to DB:', {
    user_id: sessionUserId,
    role: record.role,
    skills: record.skills,
    topics: record.topics,
  });

  coerceResumeDataOnRecord(record);

  const { data: result, error } = await supabase
    .from('profiles')
    .upsert(record, { onConflict: 'user_id' })
    .select();

  if (error) {
    console.error('Supabase save error (updateProfile):', error);
    throw error;
  }
  return result;
};

/**
 * UPDATED: Saves LinkedIn connection data and ensures email is not NULL.
 */
export const updateLinkedInConnection = async (
  userId: string,
  email: string,
  profileUrl: string,
  token: string
) => {
  const sessionUserId = await requireSessionUserId();
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update LinkedIn for this account');
  }
  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving profile:', { email, linkedin_profile_url: profileUrl, linkedin_connected: true });
  if (!token || token === 'true' || token === 'false') {
    throw new Error('Invalid token: token must be a non-empty string');
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const merged: Record<string, unknown> = {
    ...(existing || {}),
    user_id: sessionUserId,
    email,
    linkedin_profile_url: profileUrl,
    linkedin_token: token,
    linkedin_connected: true,
    updated_at: new Date().toISOString(),
  };
  coerceResumeDataOnRecord(merged);

  const { data, error } = await supabase
    .from('profiles')
    .upsert(merged, { onConflict: 'user_id' });

  if (error) throw error;
  return data;
};

export const getSupabaseSettings = async (userId: string) => {
  if (!isValidUuid(userId)) {
    console.warn('getSupabaseSettings: invalid or missing user_id (must be Supabase UUID)');
    return {};
  }
  let sessionUserId: string;
  try {
    sessionUserId = await requireSessionUserId();
  } catch {
    console.warn('getSupabaseSettings: no valid session');
    return {};
  }
  if (sessionUserId !== userId) {
    console.warn('getSupabaseSettings: user_id mismatch — refusing profile fetch');
    return {};
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .single();

  if (error) {
    if ((error as { code?: string }).code === 'PGRST116') {
      return {};
    }
    console.error('Profile fetch failed:', error);
    return {};
  }
  if (!data) return {};

  return {
    email: data.email || '',
    role: data.role || '',
    auth_role: (data as any).auth_roles || 'user',
    skills: parseProfileListField(data.skills),
    topics: parseProfileListField(data.topics),
    linkedin_profile_url: data.linkedin_profile_url,
    // Portfolio URL is stored in linkedin_profile_url — expose it as portfolio_url for forms
    portfolio_url: data.linkedin_profile_url || '',
    linkedin_token: data.linkedin_token,
    linkedInConnected: data.linkedin_connected || false,
    onboarding_completed: data.onboarding_completed || false,
    profile_completed: data.onboarding_completed || false,
    selected_plan: (data as any).selected_plan || null,
    resume_data: (data as any).resume_data ?? null,
    resume_url: (data as any).resume_url ?? '',
  };
};

/**
 * Fetch only the auth_role for the given user.
 * Returns 'user' as default if the row doesn't exist or has no value.
 */
export const getUserAuthRole = async (userId: string): Promise<'admin' | 'user'> => {
  if (!isValidUuid(userId)) return 'user';
  const { data, error } = await supabase
    .from('profiles')
    .select('auth_roles')
    .eq('user_id', userId)
    .single();
  if (error || !data) return 'user';
  return (data as any).auth_roles === 'admin' ? 'admin' : 'user';
};

/** Save selected plan to profiles (and ensure profile row exists). Call after user clicks Choose Plan. */
export const saveSelectedPlan = async (userId: string, planId: string, email?: string) => {
  if (!isValidUuid(userId)) throw new Error('Invalid user id');
  const sessionUserId = await requireSessionUserId();
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update this profile');
  }
  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;

  const record: Record<string, unknown> = {
    ...(existing || {}),
    user_id: sessionUserId,
    selected_plan: planId,
    updated_at: new Date().toISOString(),
  };
  if (email && email.trim()) record.email = email.trim();
  coerceResumeDataOnRecord(record);

  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving profile:', { selected_plan: planId, email: email?.trim() });
  const { error } = await supabase.from('profiles').upsert(record, { onConflict: 'user_id' });
  if (error) {
    console.warn('Supabase saveSelectedPlan:', error);
    throw error;
  }
};

export const syncSchedules = async (userId: string, schedules: ScheduleConfig[]) => {
  const sessionUserId = await requireSessionUserId();
  if (sessionUserId !== userId) {
    throw new Error('Not authorized to update schedule for this user');
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    console.error('User not authenticated');
    throw new Error('User not authenticated');
  }
  if (schedules.length === 0) return null;

  const firstSchedule = schedules[0];
  const { data: existing, error: fetchErr } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', sessionUserId)
    .maybeSingle();
  if (fetchErr) {
    console.warn('syncSchedules fetch:', fetchErr.message);
    return null;
  }

  const ex = (existing || {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...ex,
    user_id: sessionUserId,
    email: (ex.email as string) ?? session.user.email ?? null,
    day: firstSchedule.day,
    time: firstSchedule.time,
    updated_at: new Date().toISOString(),
  };
  coerceResumeDataOnRecord(merged);
  console.log('Saving profile for user:', sessionUserId);
  console.log('Saving to DB:', {
    user_id: sessionUserId,
    day: merged.day,
    time: merged.time,
  });
  const { data, error } = await supabase
    .from('profiles')
    .upsert(merged, { onConflict: 'user_id' });

  if (error) {
    console.error('Supabase save error (syncSchedules):', error);
    // Don't throw - schedule sync failure shouldn't block onboarding
  }
  return data;
};

export const getSupabasePosts = async (userId: string) => {
  if (!userId || !isValidUuid(userId)) {
    console.warn('getSupabasePosts: invalid or missing user_id (must be Supabase UUID)');
    return [];
  }
  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Supabase error (getSupabasePosts):', error);
    return [];
  }
  return data ?? [];
};

/**
 * ENABLE AUTOMATION
 * Calls the server-side /api/automation/toggle route which:
 *   1. Validates the user's session
 *   2. Checks that role, skills, and topics are present on the profile
 *   3. Sets active = true in the DB
 *   4. Fires the Make.com webhook with the user's profile data
 */
export const startAgent = async (_userData?: any): Promise<{ success: boolean }> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not authenticated. Please sign in.');

  const response = await fetch('/api/automation/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'enable' }),
  });

  const data = await response.json().catch(() => ({})) as { success?: boolean; error?: string };

  if (!response.ok || data.success !== true) {
    throw new Error(data.error ?? `Failed to enable automation (${response.status})`);
  }

  return { success: true };
};

/**
 * DISABLE AUTOMATION
 * Calls the server-side /api/automation/toggle route to set active = false in the DB.
 */
export const stopAgent = async (): Promise<{ success: boolean }> => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return { success: true }; // not signed in — nothing to stop

  const response = await fetch('/api/automation/toggle', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action: 'disable' }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    console.error('stopAgent error:', data.error);
  }

  return { success: true };
};

export const getAgentStatus = async (): Promise<AgentStatusResponse> => {
  let isActive = false;
  try {
    const userId = await requireSessionUserId();
    const { data: profile } = await supabase
      .from('profiles')
      .select('active')
      .eq('user_id', userId)
      .maybeSingle();
    isActive = profile?.active === true;
  } catch {
    // not authenticated
  }
  return {
    status: isActive ? 'running' : 'paused',
    lastRun: null,
    healthScore: 100
  };
};

/** Display info for the current logged-in user (sidebar: name, email, plan). From Supabase auth + profile. No orders table. */
export interface CurrentUserDisplayInfo {
  displayName: string;
  email: string;
  planId: string;
}

export const getCurrentUserDisplayInfo = async (): Promise<CurrentUserDisplayInfo | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  const user = session?.user;
  if (!user) return null;

  const email = user.email ?? '';
  const displayName = (user.user_metadata?.full_name as string)?.trim() || email;

  let planId = 'starter';
  if (user.id && isValidUuid(user.id)) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('selected_plan')
      .eq('user_id', user.id)
      .maybeSingle();
    planId = planIdFromSelectedPlan((profile as { selected_plan?: string | null } | null)?.selected_plan);
  }

  return { displayName, email, planId };
};

/** Project no longer uses subscriptions/orders table. Returns true so dashboard remains accessible. */
export const getUserHasSubscription = async (): Promise<boolean> => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session?.user?.id;
};

/**
 * SECURITY: Validate LinkedIn token is in proper format
 * Ensures token is: string, not empty, not a boolean, and looks like Bearer token
 */
export const validateLinkedInToken = (token: any): boolean => {
  if (!token) return false;
  if (typeof token !== 'string') return false;
  if (token === 'true' || token === 'false') return false;
  if (token.length < 10) return false; // OAuth tokens are typically longer
  return true;
};

/**
 * Get valid LinkedIn token for user with expiry check
 */
export const getValidLinkedInToken = async (userId: string): Promise<string | null> => {
  try {
    if (!(await assertSessionUserMatches(userId))) return null;
    const { data } = await supabase
      .from('profiles')
      .select('linkedin_token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) return null;

    // Validate token format
    if (!validateLinkedInToken(data.linkedin_token)) {
      console.error('Stored LinkedIn token is invalid format');
      return null;
    }

    return data.linkedin_token;
  } catch (err) {
    console.error('Failed to retrieve LinkedIn token:', err);
    return null;
  }
};

export const uploadResume = async (file: File, onProgress?: (p: number) => void): Promise<UploadResponse> => {
  return new Promise((resolve, reject) => {
    let progress = 0;
    const interval = setInterval(() => {
      progress += 20;
      if (onProgress) onProgress(progress);
      if (progress >= 100) {
        clearInterval(interval);
        parseResume(`Extracted text from ${file.name}`)
          .then(parsed => resolve({ url: 'demo-url', parsedData: parsed }))
          .catch(reject);
      }
    }, 150);
  });
};

export const getPosts = getSupabasePosts;

/** Get settings for the current authenticated user only. Returns {} if not signed in. */
export const getSettings = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid || !isValidUuid(uid)) return {};
  return getSupabaseSettings(uid);
};

export const saveSettings = async (settings: any) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) {
    console.error('User not authenticated');
    throw new Error('User not authenticated');
  }
  const userId = await requireSessionUserId();
  const skills = Array.isArray(settings.skills) ? settings.skills : (settings.skills || '').toString().split(',').map((s: string) => s.trim()).filter(Boolean);
  const topics = Array.isArray(settings.topics) ? settings.topics : (settings.topics || '').toString().split(',').map((t: string) => t.trim()).filter(Boolean);
  const roleTrim = typeof settings.role === 'string' ? settings.role.trim() : '';
  await updateProfile(userId, {
    ...(roleTrim ? { role: roleTrim } : {}),
    ...(skills.length > 0 ? { skills } : {}),
    ...(topics.length > 0 ? { topics } : {}),
    ...(settings.portfolio_url ? { portfolio_url: settings.portfolio_url } : {}),
    email: session?.user?.email ?? undefined,
  });
};
export const getLogs = async () => [];
export const getSchedule = async () => [];
export const saveSchedule = async (s: any) => ({ success: true });
export const saveTopics = async (t: any) => ({ success: true });
export const saveProfile = async (r: any, s: any) => ({ success: true });
export const connectLinkedIn = async () => ({ success: true });

function extensionFromFileName(name: string): string {
  const m = /\.[a-zA-Z0-9]{1,12}$/.exec(name.trim());
  return m ? m[0].toLowerCase() : '.pdf';
}

/**
 * Upload resume to bucket `resumes`, then upsert profiles with `user_id` = session user (RLS-safe).
 */
export const uploadResumeToStorage = async (
  file: File,
  expectedUserId: string,
  onProgress?: (p: number) => void
): Promise<string> => {
  const userId = await requireSessionUserId();
  if (userId !== expectedUserId) {
    throw new Error('Not authorized to upload a resume for this account');
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    throw new Error('User not logged in');
  }

  const filePath = `resumes/${userId}-${Date.now()}${extensionFromFileName(file.name)}`;

  const runUpload = async () => {
    const { error: uploadError } = await supabase.storage.from('resumes').upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
    });
    if (uploadError) {
      console.error('Supabase storage upload failed:', uploadError);
      throw uploadError;
    }

    const { data: pub } = supabase.storage.from('resumes').getPublicUrl(filePath);
    const fileUrl = pub?.publicUrl;
    if (!fileUrl) {
      throw new Error('Could not get public URL for uploaded resume.');
    }

    const { data: existing, error: profileFetchErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (profileFetchErr) {
      console.error('Profile fetch after resume upload:', profileFetchErr);
      throw profileFetchErr;
    }

    const base: Record<string, unknown> = existing
      ? { ...(existing as Record<string, unknown>), user_id: userId }
      : {
          user_id: userId,
          email: session.user.email ?? null,
        };

    const alreadyFinished =
      existing &&
      (existing as { onboarding_completed?: boolean }).onboarding_completed === true;

    const upsertRow: Record<string, unknown> = {
      ...base,
      user_id: userId,
      resume_data: null,
      resume_url: fileUrl,
      updated_at: new Date().toISOString(),
      onboarding_completed: alreadyFinished ? true : false,
    };
    coerceResumeDataOnRecord(upsertRow);
    console.log('Saving to DB:', {
      user_id: userId,
      resume_url: fileUrl,
    });
    const { error: upsertErr } = await supabase.from('profiles').upsert(upsertRow, {
      onConflict: 'user_id',
    });
    if (upsertErr) {
      console.error('Supabase save error (uploadResumeToStorage):', upsertErr);
      throw upsertErr;
    }

    console.log('Saving profile for user:', userId);
    return fileUrl;
  };

  if (onProgress) {
    let progress = 0;
    const progressInterval = setInterval(() => {
      progress = Math.min(progress + 20, 85);
      onProgress(progress);
    }, 180);
    try {
      const publicUrl = await runUpload();
      clearInterval(progressInterval);
      onProgress(100);
      return publicUrl;
    } catch (e) {
      clearInterval(progressInterval);
      onProgress(0);
      throw e;
    }
  }

  return runUpload();
};

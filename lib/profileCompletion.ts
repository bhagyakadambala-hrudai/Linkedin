/** Persisted in profiles.resume_data (JSON). */
export type StoredResumePayload = {
  resumeUrl?: string;
  fileName?: string;
  role?: string;
  skills?: string[];
  topics?: string[];
};

export function parseStoredResumeData(raw: unknown): StoredResumePayload | null {
  if (raw == null) return null;
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!obj || typeof obj !== 'object') return null;
    const resumeUrl =
      typeof (obj as StoredResumePayload).resumeUrl === 'string'
        ? (obj as StoredResumePayload).resumeUrl.trim()
        : '';
    if (!resumeUrl) return null;
    return obj as StoredResumePayload;
  } catch {
    return null;
  }
}

export type ProfileLikeForCompletion = {
  role?: string | null;
  skills?: string[] | string | null;
  topics?: string[] | string | null;
  resume_data?: unknown;
  /** Optional column mirroring resume URL (may exist alongside resume_data). */
  resume_url?: string | null;
  /** Set true only after the user finishes the full setup wizard (incl. LinkedIn). */
  onboarding_completed?: boolean | null;
  /** DB column — same meaning as `linkedInConnected` from `getSupabaseSettings`. */
  linkedin_connected?: boolean | null;
  /** Normalized field from `getSupabaseSettings` (preferred). */
  linkedInConnected?: boolean | null;
};

function isLinkedInMarkedConnected(profile: ProfileLikeForCompletion): boolean {
  return (
    profile.linkedin_connected === true ||
    (profile as {linkedInConnected?: boolean}).linkedInConnected === true
  );
}

/**
 * Resume + designation sections filled (used inside the setup wizard).
 * Does **not** require `onboarding_completed` — use `isProfileComplete` for routing.
 */
export function isResumeProfileFilled(
  profile: ProfileLikeForCompletion | null | undefined
): boolean {
  if (!profile) return false;

  const role = typeof profile.role === 'string' ? profile.role.trim() : '';
  if (!role) return false;

  let skillsList: string[] = [];
  if (Array.isArray(profile.skills)) {
    skillsList = profile.skills.map((s) => String(s ?? '').trim()).filter(Boolean);
  } else if (typeof profile.skills === 'string' && profile.skills.trim() !== '') {
    skillsList = profile.skills.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (skillsList.length === 0) return false;

  if (typeof profile.topics === 'string') {
    if (profile.topics.trim() === '') return false;
  } else if (Array.isArray(profile.topics)) {
    if (profile.topics.length === 0) return false;
  } else {
    return false;
  }

  const hasResumePayload = parseStoredResumeData(profile.resume_data) !== null;
  const urlCol =
    typeof profile.resume_url === 'string' ? profile.resume_url.trim() : '';
  if (!hasResumePayload && !urlCol) return false;

  return true;
}

/**
 * Eligible for dashboard / post-login redirect: resume fields present **and**
 * onboarding finished **and** LinkedIn marked connected in DB (guards against
 * `onboarding_completed` true from defaults / legacy data while LinkedIn is still pending).
 */
export function isProfileComplete(
  profile: ProfileLikeForCompletion | null | undefined
): boolean {
  if (!profile || !isResumeProfileFilled(profile)) return false;
  if (profile.onboarding_completed !== true) return false;
  if (!isLinkedInMarkedConnected(profile)) return false;
  return true;
}

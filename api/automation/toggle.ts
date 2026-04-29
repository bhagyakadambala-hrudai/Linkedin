import { runAutomation } from '../../lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  ''
).trim();

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return (value as unknown[]).filter(Boolean).map(String);
  if (typeof value === 'string' && value.trim()) {
    try {
      const p = JSON.parse(value) as unknown;
      return Array.isArray(p) ? p.filter(Boolean).map(String) : [value.trim()];
    } catch {
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

async function supabaseFetch(
  path: string,
  method: string,
  key: string,
  body?: unknown
): Promise<{ data: unknown; ok: boolean }> {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Prefer: 'return=representation',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { data, ok: res.ok };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // 1. Validate Bearer token
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7);

  // 2. Resolve user
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!authRes.ok) return json({ error: 'Unauthorized' }, 401);
  const authData = (await authRes.json()) as { id?: string };
  const userId = authData?.id;
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  // 3. Parse action
  const body = (await req.json().catch(() => ({}))) as { action?: unknown };
  const action = typeof body.action === 'string' ? body.action : '';
  if (action !== 'enable' && action !== 'disable') {
    return json({ error: 'Invalid action. Must be "enable" or "disable".' }, 400);
  }

  // DISABLE path
  if (action === 'disable') {
    await supabaseFetch(
      `/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`,
      'PATCH',
      SERVICE_ROLE_KEY,
      { active: false, status: 'paused' }
    );
    return json({ success: true, message: 'Automation disabled.' }, 200);
  }

  // ENABLE path — fetch and validate profile
  const profileRes = await supabaseFetch(
    `/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=role,skills,topics,linkedin_connected,onboarding_completed`,
    'GET',
    SERVICE_ROLE_KEY
  );
  if (!profileRes.ok) return json({ error: 'Failed to fetch profile.' }, 500);

  const rows = profileRes.data as Array<{
    role?: string;
    skills?: unknown;
    topics?: unknown;
    linkedin_connected?: boolean | null;
    onboarding_completed?: boolean | null;
  }>;
  const profile = rows?.[0];
  if (!profile) return json({ error: 'Profile not found. Complete your profile setup first.' }, 404);

  const role = typeof profile.role === 'string' ? profile.role.trim() : '';
  const skills = parseList(profile.skills);
  const topics = parseList(profile.topics);

  const missing: string[] = [];
  if (!role) missing.push('role');
  if (skills.length === 0) missing.push('skills');
  if (topics.length === 0) missing.push('topics');
  if (!profile.linkedin_connected) missing.push('LinkedIn connection');
  if (!profile.onboarding_completed) missing.push('onboarding');

  if (missing.length > 0) {
    return json(
      { error: `Complete your profile before enabling automation. Missing: ${missing.join(', ')}.`, missing },
      422
    );
  }

  // Mark active
  const updateRes = await supabaseFetch(
    `/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}`,
    'PATCH',
    SERVICE_ROLE_KEY,
    { active: true, status: 'active' }
  );
  if (!updateRes.ok) return json({ error: 'Failed to update automation status.' }, 500);

  // Reset rotation — start from step 1, post_type 1 (text) on fresh enable
  await supabaseFetch(
    `/rest/v1/automation_rotation?user_id=eq.${encodeURIComponent(userId)}`,
    'DELETE',
    SERVICE_ROLE_KEY
  );
  await supabaseFetch('/rest/v1/automation_rotation', 'POST', SERVICE_ROLE_KEY, {
    user_id: userId,
    current_step: 1,
    post_type: 1,
  });

  // Kick off first post immediately (non-blocking)
  runAutomation(userId).catch((err) =>
    console.error('[automation/toggle] Initial post error:', err)
  );

  return json(
    { success: true, message: 'Automation enabled. Your first post is being generated and published.' },
    200
  );
}

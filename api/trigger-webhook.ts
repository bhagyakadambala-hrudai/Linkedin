import { runAutomation } from '../lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim();

const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function resolveUserId(token: string): Promise<string | null> {
  if (!SUPABASE_URL || !ANON_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { id?: string };
  return data?.id ?? null;
}

async function validateProfile(userId: string): Promise<{ ok: false; message: string } | { ok: true }> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: true };
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=linkedin_connected,onboarding_completed`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) return { ok: false, message: 'Could not verify profile.' };
  const rows = (await res.json()) as Array<{
    linkedin_connected?: boolean | null;
    onboarding_completed?: boolean | null;
  }>;
  const row = rows[0];
  if (!row) return { ok: false, message: 'Profile not found. Complete onboarding first.' };
  if (!row.linkedin_connected) return { ok: false, message: 'LinkedIn is not connected. Connect it in Settings.' };
  if (!row.onboarding_completed) return { ok: false, message: 'Finish onboarding before publishing.' };
  return { ok: true };
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);
  const token = authHeader.slice(7).trim();

  const userId = await resolveUserId(token);
  if (!userId) return json({ error: 'Unauthorized' }, 401);

  const check = await validateProfile(userId);
  if (!check.ok) return json({ success: false, error: check.message }, 422);

  const result = await runAutomation(userId);
  if (!result.success) return json(result, 422);

  return json({
    success: true,
    message: 'Post generated and published to LinkedIn.',
    topic: result.topic,
    post_url: result.post_url,
  }, 200);
}

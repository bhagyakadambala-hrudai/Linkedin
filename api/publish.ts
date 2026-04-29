import { runAutomation } from '../lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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
  if (!res.ok) return { ok: false, message: 'Could not verify profile. Try again.' };
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

  const body = (await req.json().catch(() => ({}))) as { user_id?: unknown };
  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';

  if (!userId || !UUID_RE.test(userId)) {
    return json({ success: false, error: 'Valid user_id is required' }, 400);
  }

  const check = await validateProfile(userId);
  if (!check.ok) return json({ success: false, error: check.message }, 400);

  const result = await runAutomation(userId);
  if (!result.success) return json(result, 422);

  return json({
    success: true,
    message: 'Post generated and published to LinkedIn.',
    topic: result.topic,
    post_url: result.post_url,
  }, 200);
}

/**
 * GET /api/cron/daily-posts
 *
 * Called by Vercel Cron every day at 8:00 AM UTC.
 * Fetches every user with active automation and runs the post engine for each.
 * Secured with CRON_SECRET so only Vercel can trigger it.
 */

import { runAutomation } from '../../lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const CRON_SECRET = process.env.CRON_SECRET ?? '';

export default async function handler(req: Request): Promise<Response> {
  // Only allow GET (Vercel cron calls GET)
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify Vercel cron secret
  const authHeader = req.headers.get('authorization') ?? '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Fetch all users with automation active
  const profilesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?active=eq.true&select=user_id`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        Accept: 'application/json',
      },
    }
  );

  if (!profilesRes.ok) {
    return new Response(JSON.stringify({ error: 'Failed to fetch active users' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const users = (await profilesRes.json()) as Array<{ user_id: string }>;
  console.log(`[cron/daily-posts] Running for ${users.length} active user(s)`);

  const results: Array<{ user_id: string; success: boolean; error?: string }> = [];

  // Run automation for each user sequentially to avoid rate limits
  for (const { user_id } of users) {
    try {
      const result = await runAutomation(user_id);
      results.push({ user_id, success: result.success, error: result.error });
      console.log(
        `[cron/daily-posts] user=${user_id} success=${result.success} type=${result.post_type} topic="${result.topic}"`
      );
    } catch (err: any) {
      const error = err?.message ?? 'Unknown error';
      results.push({ user_id, success: false, error });
      console.error(`[cron/daily-posts] user=${user_id} failed:`, error);
    }
  }

  const succeeded = results.filter((r) => r.success).length;
  const failed = results.length - succeeded;

  return new Response(
    JSON.stringify({
      ran_at: new Date().toISOString(),
      total: results.length,
      succeeded,
      failed,
      results,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

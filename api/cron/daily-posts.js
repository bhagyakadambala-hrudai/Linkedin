'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const now = new Date();
  console.log(`[cron] Daily run at ${now.toISOString()}`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all active users with their posts_per_day setting
  const { data: users, error } = await admin
    .from('profiles')
    .select('user_id, posts_per_day')
    .eq('active', true);

  if (error) {
    console.error('[cron] Failed to fetch users:', error.message);
    return res.status(500).json({ error: 'Failed to fetch active users' });
  }

  if (!users || users.length === 0) {
    return res.status(200).json({ ran_at: now.toISOString(), total: 0, succeeded: 0, failed: 0 });
  }

  const { runAutomation } = require('../../lib/automation.cjs');
  const results = [];

  for (const { user_id, posts_per_day } of users) {
    // Publish posts_per_day posts for each active user
    const count = Math.min(Math.max(Number(posts_per_day) || 1, 1), 3);
    for (let i = 0; i < count; i++) {
      try {
        const result = await runAutomation(user_id);
        results.push({ user_id, post: i + 1, success: result.success, error: result.error });
        console.log(`[cron] user=${user_id} post=${i + 1}/${count} success=${result.success} topic="${result.topic}"`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ user_id, post: i + 1, success: false, error: msg });
        console.error(`[cron] user=${user_id} post=${i + 1}/${count} failed:`, msg);
      }
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return res.status(200).json({
    ran_at: now.toISOString(),
    active_users: users.length,
    total_posts_attempted: results.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
};

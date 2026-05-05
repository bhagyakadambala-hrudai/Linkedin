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

  // Verify Vercel cron secret
  const authHeader = req.headers.authorization || '';
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Current UTC hour as zero-padded string e.g. "08", "14"
  const now = new Date();
  const utcHour = String(now.getUTCHours()).padStart(2, '0');
  console.log(`[cron] Running at UTC hour ${utcHour}`);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Fetch all active users with their schedule settings
  const { data: users, error } = await admin
    .from('profiles')
    .select('user_id, post_times, posts_per_day')
    .eq('active', true);

  if (error) {
    console.error('[cron] Failed to fetch users:', error.message);
    return res.status(500).json({ error: 'Failed to fetch active users' });
  }

  if (!users || users.length === 0) {
    return res.status(200).json({ ran_at: now.toISOString(), total: 0, succeeded: 0, failed: 0 });
  }

  // Filter users whose schedule includes the current UTC hour
  const dueUsers = users.filter(u => {
    const times = Array.isArray(u.post_times) ? u.post_times : ['08'];
    return times.includes(utcHour) || times.includes(String(now.getUTCHours()));
  });

  console.log(`[cron] ${dueUsers.length} user(s) scheduled for hour ${utcHour} out of ${users.length} active`);

  const { runAutomation } = require('../../lib/automation.cjs');
  const results = [];

  for (const { user_id } of dueUsers) {
    try {
      const result = await runAutomation(user_id);
      results.push({ user_id, success: result.success, error: result.error });
      console.log(`[cron] user=${user_id} success=${result.success} topic="${result.topic}"`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ user_id, success: false, error: msg });
      console.error(`[cron] user=${user_id} failed:`, msg);
    }
  }

  const succeeded = results.filter(r => r.success).length;
  return res.status(200).json({
    ran_at: now.toISOString(),
    utc_hour: utcHour,
    active_users: users.length,
    due_users: dueUsers.length,
    succeeded,
    failed: results.length - succeeded,
    results,
  });
};

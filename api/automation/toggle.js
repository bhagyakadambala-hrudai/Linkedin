const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();

function parseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string' && value.trim()) {
    try {
      const p = JSON.parse(value);
      return Array.isArray(p) ? p.filter(Boolean).map(String) : [value.trim()];
    } catch {
      return value.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check env vars
  const missingVars = [];
  if (!SUPABASE_URL) missingVars.push('SUPABASE_URL');
  if (!SERVICE_ROLE_KEY) missingVars.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!ANON_KEY) missingVars.push('SUPABASE_ANON_KEY');
  if (missingVars.length > 0) {
    console.error('[toggle] Missing env vars:', missingVars.join(', '));
    return res.status(500).json({ error: `Server misconfigured. Missing: ${missingVars.join(', ')}` });
  }

  try {
    // 1. Validate Bearer token
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7);

    // 2. Resolve user via Supabase auth
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const authData = await authRes.json();
    const userId = authData?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // 3. Parse action
    const body = req.body || {};
    const action = typeof body.action === 'string' ? body.action : '';
    if (action !== 'enable' && action !== 'disable') {
      return res.status(400).json({ error: 'Invalid action. Must be "enable" or "disable".' });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // DISABLE path
    if (action === 'disable') {
      await admin.from('profiles')
        .update({ active: false, status: 'paused' })
        .eq('user_id', userId);
      return res.status(200).json({ success: true, message: 'Automation disabled.' });
    }

    // ENABLE path — fetch and validate profile
    const { data: rows, error: profileErr } = await admin
      .from('profiles')
      .select('role,skills,topics,linkedin_connected,onboarding_completed')
      .eq('user_id', userId);

    if (profileErr) {
      console.error('[toggle] Profile fetch error:', profileErr);
      return res.status(500).json({ error: `Failed to fetch profile: ${profileErr.message}` });
    }

    const profile = rows && rows[0];
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found. Complete your profile setup first.' });
    }

    const role = typeof profile.role === 'string' ? profile.role.trim() : '';
    const skills = parseList(profile.skills);
    const topics = parseList(profile.topics);

    const missing = [];
    if (!role) missing.push('role');
    if (skills.length === 0) missing.push('skills');
    if (topics.length === 0) missing.push('topics');
    if (!profile.linkedin_connected) missing.push('LinkedIn connection');
    if (!profile.onboarding_completed) missing.push('onboarding');

    if (missing.length > 0) {
      return res.status(422).json({
        error: `Complete your profile before enabling automation. Missing: ${missing.join(', ')}.`,
        missing,
      });
    }

    // Mark active
    const { error: updateErr } = await admin
      .from('profiles')
      .update({ active: true, status: 'active' })
      .eq('user_id', userId);

    if (updateErr) {
      return res.status(500).json({ error: `Failed to update automation status: ${updateErr.message}` });
    }

    // Reset rotation
    await admin.from('automation_rotation').delete().eq('user_id', userId);
    await admin.from('automation_rotation').insert({
      user_id: userId,
      current_step: 1,
      post_type: 1,
    });

    // Kick off first post (non-blocking, fire and forget)
    const { runAutomation } = require('../../lib/automation.cjs');
    setImmediate(() => {
      runAutomation(userId).catch((err) =>
        console.error('[toggle] Initial post error:', err)
      );
    });

    return res.status(200).json({
      success: true,
      message: 'Automation enabled. Your first post is being generated and published.',
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[toggle] Unhandled error:', msg);
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
};

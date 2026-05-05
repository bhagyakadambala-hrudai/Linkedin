'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function validateProfile(userId) {
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
  const rows = await res.json();
  const row = rows[0];
  if (!row) return { ok: false, message: 'Profile not found. Complete onboarding first.' };
  if (!row.linkedin_connected) return { ok: false, message: 'LinkedIn is not connected. Connect it in Settings.' };
  if (!row.onboarding_completed) return { ok: false, message: 'Finish onboarding before publishing.' };
  return { ok: true };
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch (_) {}

  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';

  if (!userId || !UUID_RE.test(userId)) {
    return res.status(400).json({ success: false, error: 'Valid user_id is required' });
  }

  const check = await validateProfile(userId);
  if (!check.ok) {
    return res.status(400).json({ success: false, error: check.message });
  }

  const { runAutomation } = require('../lib/automation.cjs');
  const result = await runAutomation(userId);

  if (!result.success) {
    return res.status(422).json(result);
  }

  return res.status(200).json({
    success: true,
    message: 'Post generated and published to LinkedIn.',
    topic: result.topic,
    post_url: result.post_url,
  });
};

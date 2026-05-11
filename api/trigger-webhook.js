// v4 — OpenRouter, production-ready error handling
const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/,'');

const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();

function isLinkedInError(msg) {
  const m = msg.toLowerCase();
  return m.includes('linkedin') || m.includes('ugcposts') || m.includes('registerupload') ||
    m.includes('li:person') || m.includes('digitalmedia');
}

function isQuotaError(msg) {
  if (isLinkedInError(msg)) return false;
  const m = msg.toLowerCase();
  return msg.includes('429') || m.includes('quota') || m.includes('rate limit') ||
    m.includes('too many') || m.includes('exhausted');
}

function isAuthError(msg) {
  return msg.includes('401') || msg.includes('403') || msg.includes('400') ||
    msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid') ||
    msg.toLowerCase().includes('not configured') || msg.toLowerCase().includes('forbidden') ||
    msg.toLowerCase().includes('no auth') || msg.toLowerCase().includes('api key');
}

function friendlyError(msg) {
  if (msg.toLowerCase().includes('not configured')) {
    return 'OPENROUTER_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.';
  }
  if (isLinkedInError(msg)) {
    return 'LinkedIn publishing failed. Please reconnect your LinkedIn account in Settings.';
  }
  if (isQuotaError(msg)) {
    return 'AI rate limit hit. Please wait a minute and try again.';
  }
  if (isAuthError(msg)) {
    return 'OpenRouter API key is invalid or expired. Check OPENROUTER_API_KEY in Vercel → Settings → Environment Variables.';
  }
  return 'Post generation failed. Please try again in a moment.';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = authHeader.slice(7).trim();

    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const authData = await authRes.json();
    const userId = authData?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { runAutomation } = require('../lib/automation.cjs');
    const result = await runAutomation(userId);

    if (!result.success) {
      const msg = result.error || 'Automation failed';
      console.error('[trigger-webhook] runAutomation failed:', msg);
      const status = isQuotaError(msg) ? 429 : isLinkedInError(msg) ? 422 : 500;
      return res.status(status).json({ success: false, error: friendlyError(msg) });
    }

    return res.status(200).json({
      success: true,
      message: 'Post generated and published to LinkedIn.',
      topic: result.topic,
      post_url: result.post_url,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[trigger-webhook] Caught error:', msg);
    const status = isLinkedInError(msg) ? 422 : isQuotaError(msg) ? 429 : isAuthError(msg) ? 401 : 500;
    return res.status(status).json({ success: false, error: friendlyError(msg) });
  }
};

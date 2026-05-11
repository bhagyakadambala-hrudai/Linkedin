// v3 — model fallback chain, LinkedIn/Gemini 429 correctly distinguished
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

function isGeminiQuotaError(msg) {
  if (isLinkedInError(msg)) return false;
  const m = msg.toLowerCase();
  return msg.includes('429') || m.includes('quota') || m.includes('rate') ||
    m.includes('too many') || m.includes('exhausted') || m.includes('resource_exhausted');
}

function friendlyError(msg) {
  if (msg.toLowerCase().includes('not configured')) {
    return 'OPENROUTER_API_KEY is not set. Add it in Vercel → Settings → Environment Variables, then redeploy.';
  }
  // LinkedIn check FIRST — LinkedIn also returns 429 for rate limits
  if (isLinkedInError(msg)) {
    return 'LinkedIn publishing failed. Please check your LinkedIn connection in Settings.';
  }
  if (isGeminiQuotaError(msg)) {
    return 'AI quota exceeded. Please check your OPENROUTER_API_KEY in Vercel settings and try again.';
  }
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid')) {
    return 'OpenRouter API key is invalid or expired. Check OPENROUTER_API_KEY in Vercel settings.';
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
      return res.status(isGeminiQuotaError(msg) ? 429 : 422).json({
        success: false,
        error: friendlyError(msg),
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Post generated and published to LinkedIn.',
      topic: result.topic,
      post_url: result.post_url,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[trigger-webhook] Error:', msg);
    const status = isLinkedInError(msg) ? 422 : isGeminiQuotaError(msg) ? 429 : 500;
    return res.status(status).json({ success: false, error: friendlyError(msg) });
  }
};

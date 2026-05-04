const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const ANON_KEY = (process.env.SUPABASE_ANON_KEY || '').trim();
const SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

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

    // Resolve user from token
    const authRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!authRes.ok) return res.status(401).json({ error: 'Unauthorized' });
    const authData = await authRes.json();
    const userId = authData?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    // Run automation
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

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[trigger-webhook] Error:', msg);
    return res.status(500).json({ error: `Server error: ${msg}` });
  }
};

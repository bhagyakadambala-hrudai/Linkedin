// Vercel serverless function: GET /api/admin/users
// Uses the service role key to bypass RLS and return ALL users from profiles.
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  // CORS headers so the SPA can call this from any origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    console.error('[admin/users] Missing env vars');
    return res.status(503).json({
      error: 'Server misconfigured. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel env vars.',
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, email, auth_roles, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/users] Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[admin/users] returning ${data?.length ?? 0} users`);
  return res.status(200).json({ users: data ?? [] });
};

// Vercel serverless function: GET /api/admin/stats
// Returns { totalUsers, totalPosts } counts using the service role key.
const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const serviceKey  = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (!supabaseUrl || !serviceKey) {
    console.error('[admin/stats] Missing env vars');
    return res.status(503).json({
      error: 'Server misconfigured. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel env vars.',
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [usersRes, postsRes] = await Promise.all([
    supabase.from('profiles').select('user_id', { count: 'exact', head: true }),
    supabase.from('posts').select('id',      { count: 'exact', head: true }),
  ]);

  if (usersRes.error) {
    console.error('[admin/stats] users count error:', usersRes.error.message);
    return res.status(500).json({ error: usersRes.error.message });
  }
  if (postsRes.error) {
    console.error('[admin/stats] posts count error:', postsRes.error.message);
    return res.status(500).json({ error: postsRes.error.message });
  }

  const stats = { totalUsers: usersRes.count ?? 0, totalPosts: postsRes.count ?? 0 };
  console.log(`[admin/stats] totalUsers=${stats.totalUsers} totalPosts=${stats.totalPosts}`);
  return res.status(200).json(stats);
};

// Vercel serverless function: GET /api/admin/posts
// Uses the service role key to bypass RLS and return ALL posts from ALL users.
// No status filter — admin sees every row in the posts table.
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
    console.error('[admin/posts] Missing env vars');
    return res.status(503).json({
      error: 'Server misconfigured. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Vercel env vars.',
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Select all columns matching the posts table schema exactly.
  // No .eq('status','posted') filter — admin must see ALL posts.
  const { data, error } = await supabase
    .from('posts')
    .select('id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/posts] Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  console.log(`[admin/posts] returning ${data?.length ?? 0} posts`);
  return res.status(200).json({ posts: data ?? [] });
};

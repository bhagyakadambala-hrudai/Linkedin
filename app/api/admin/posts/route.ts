import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    console.error("[admin/posts] Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "Server misconfigured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel env vars." },
      { status: 503 }
    );
  }

  // Service role key bypasses RLS — returns ALL posts from ALL users
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Select every column that exists in the posts table schema.
  // No status filter — admin sees all posts regardless of status.
  const { data, error } = await supabase
    .from("posts")
    .select("id, user_id, content, post_url, created_at, updated_at, post_id, posted_at, status")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/posts] Supabase error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[admin/posts] Returning ${data?.length ?? 0} posts`);
  return NextResponse.json({ posts: data ?? [] });
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    console.error("[admin/stats] Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "Server misconfigured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel env vars." },
      { status: 503 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const [usersResult, postsResult] = await Promise.all([
    supabase.from("profiles").select("user_id", { count: "exact", head: true }),
    supabase.from("posts").select("id",      { count: "exact", head: true }),
  ]);

  if (usersResult.error)
    return NextResponse.json({ error: usersResult.error.message }, { status: 500 });
  if (postsResult.error)
    return NextResponse.json({ error: postsResult.error.message }, { status: 500 });

  const stats = {
    totalUsers: usersResult.count ?? 0,
    totalPosts: postsResult.count ?? 0,
  };
  console.log(`[admin/stats] totalUsers=${stats.totalUsers} totalPosts=${stats.totalPosts}`);
  return NextResponse.json(stats);
}

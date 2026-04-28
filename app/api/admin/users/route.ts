import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    console.error("[admin/users] Missing env vars: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return NextResponse.json(
      { error: "Server misconfigured — add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Vercel env vars." },
      { status: 503 }
    );
  }

  // Service role key bypasses RLS — returns ALL rows from ALL users
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("profiles")
    .select("user_id, email, auth_roles, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/users] Supabase error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[admin/users] Returning ${data?.length ?? 0} users`);
  return NextResponse.json({ users: data ?? [] });
}

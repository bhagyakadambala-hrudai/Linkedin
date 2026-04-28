import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

export async function GET() {
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const { data, error } = await supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const logs = (data ?? []).map((post: { id: string; created_at: string; content?: string | null; status?: string }) => ({
    id: post.id,
    posted_date: post.created_at,
    content_preview: post.content ? String(post.content).substring(0, 80) : "",
    status: post.status ?? "—",
    action: "View",
  }));

  return NextResponse.json({ logs });
}

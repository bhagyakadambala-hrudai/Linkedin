export const config = {
  runtime: "edge",
};

const webhookUrl =
  "https://hook.us2.make.com/wkbb1u2cki5tlcxtmgaxq9efu56vg3ql";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProfileData {
  linkedin_connected?: boolean | null;
  onboarding_completed?: boolean | null;
  role?: string | null;
  skills?: unknown;
  topics?: unknown;
  linkedin_token?: string | null;
  linkedin_profile_id?: string | null;
  name?: string | null;
  email?: string | null;
  linkedin_profile_url?: string | null;
}

function parseListField(raw: unknown): string[] {
  if (Array.isArray(raw)) return (raw as unknown[]).map(String).filter(Boolean);
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) return p.map(String).filter(Boolean);
      } catch { /* fall through */ }
    }
    return s.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

async function fetchProfile(
  userId: string
): Promise<{ ok: true; profile: ProfileData } | { ok: false; message: string }> {
  const supabaseUrl = (
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    ""
  ).replace(/\/$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) {
    // Can't verify or enrich — allow through with empty profile
    return { ok: true, profile: {} };
  }

  const url = `${supabaseUrl}/rest/v1/profiles?user_id=eq.${encodeURIComponent(
    userId
  )}&select=linkedin_connected,onboarding_completed,role,skills,topics,linkedin_token,linkedin_profile_id,name,email,linkedin_profile_url`;

  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
      Prefer: "return=representation",
    },
  });

  if (!res.ok) {
    return {
      ok: false,
      message: "Could not verify your profile. Try again in a moment.",
    };
  }

  const rows = (await res.json()) as ProfileData[];
  const row = rows[0];
  if (!row) {
    return { ok: false, message: "Profile not found. Complete onboarding first." };
  }
  if (!row.linkedin_connected) {
    return { ok: false, message: "LinkedIn is not connected. Connect it in Settings." };
  }
  if (!row.onboarding_completed) {
    return { ok: false, message: "Finish onboarding before publishing." };
  }

  return { ok: true, profile: row };
}

function json(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      content?: unknown;
      user_id?: unknown;
    };
    const content =
      typeof body.content === "string" && body.content.trim() !== ""
        ? body.content
        : "Test post";
    const userId =
      typeof body.user_id === "string" && body.user_id.trim() !== ""
        ? body.user_id.trim()
        : null;

    if (!userId) {
      return json(
        { success: false, error: "user_id is required for publish" },
        400
      );
    }

    if (!UUID_RE.test(userId)) {
      return json({ success: false, error: "Invalid user_id" }, 400);
    }

    const profileResult = await fetchProfile(userId);
    if (!profileResult.ok) {
      return json({ success: false, error: profileResult.message }, 400);
    }

    const profile = profileResult.profile;
    console.log("Sending to Make webhook with full profile data");

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        user_id: userId,
        timestamp: new Date().toISOString(),
        // Full profile data so Make.com can post without querying Supabase separately
        role:                typeof profile.role === "string" ? profile.role.trim() : "",
        skills:              parseListField(profile.skills),
        topics:              parseListField(profile.topics),
        linkedin_token:      typeof profile.linkedin_token === "string" ? profile.linkedin_token : "",
        linkedin_profile_id: typeof profile.linkedin_profile_id === "string" ? profile.linkedin_profile_id : "",
        name:                typeof profile.name === "string" ? profile.name.trim() : "",
        email:               typeof profile.email === "string" ? profile.email.trim() : "",
        linkedin_profile_url: typeof profile.linkedin_profile_url === "string" ? profile.linkedin_profile_url : "",
      }),
    });

    console.log("Webhook response status:", response.status);

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error("Publish error: Make returned non-OK", response.status, detail);
      return json({ success: false, error: "Make webhook failed" }, 502);
    }

    return json({ success: true }, 200);
  } catch (error) {
    console.error("Publish error:", error);
    return json({ success: false }, 500);
  }
}

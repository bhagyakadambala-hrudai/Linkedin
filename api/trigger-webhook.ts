export const config = { runtime: "edge" };

const MAKE_WEBHOOK_URL =
  process.env.MAKE_WEBHOOK_URL ||
  "https://hook.us2.make.com/wkbb1u2cki5tlcxtmgaxq9efu56vg3ql";

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/$/, "");

const ANON_KEY = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();

const SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();

const FALLBACK_DATA = {
  user_id: "",
  email: "demo@gmail.com",
  name: "Demo User",
  role: "",
  skills: [] as string[],
  topics: [] as string[],
  linkedin_token: "",
  linkedin_profile_id: "",
  linkedin_profile_url: "",
  automation_status: "enabled",
  profile_available: false,
  timestamp: "",
};

function parseListField(raw: unknown): string[] {
  try {
    if (Array.isArray(raw)) return (raw as unknown[]).map(String).filter(Boolean);
    if (typeof raw === "string") {
      const s = raw.trim();
      if (!s) return [];
      if (s.startsWith("[")) {
        const p = JSON.parse(s) as unknown;
        if (Array.isArray(p)) return p.map(String).filter(Boolean);
      }
      return s.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
    }
  } catch (e) {
    console.log("[trigger-webhook] parseListField error:", e);
  }
  return [];
}

async function getUserFromToken(token: string): Promise<{ id: string; email: string; name: string } | null> {
  try {
    if (!SUPABASE_URL || !ANON_KEY) {
      console.log("[trigger-webhook] Supabase env vars missing — skipping user fetch");
      return null;
    }
    console.log("[trigger-webhook] Fetching user from Supabase Auth …");
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      console.log("[trigger-webhook] Auth fetch failed:", res.status);
      return null;
    }
    const data = await res.json() as { id?: string; email?: string; user_metadata?: { full_name?: string } };
    console.log("[trigger-webhook] Auth user resolved:", data?.id);
    return {
      id: data?.id ?? "",
      email: data?.email ?? "",
      name: data?.user_metadata?.full_name ?? "",
    };
  } catch (e) {
    console.log("[trigger-webhook] getUserFromToken error:", e);
    return null;
  }
}

async function getProfileFromSupabase(userId: string, token: string): Promise<Record<string, unknown> | null> {
  const SELECT =
    "name,email,linkedin_profile_url,active,role,skills,topics," +
    "linkedin_token,linkedin_profile_id,linkedin_connected,onboarding_completed";
  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(userId)}&select=${SELECT}`;

  // Attempt 1: anon key + user JWT
  try {
    console.log("[trigger-webhook] Profile fetch attempt 1 (anon + JWT) …");
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Prefer: "return=representation",
      },
    });
    if (res.ok) {
      const rows = await res.json() as Record<string, unknown>[];
      console.log("[trigger-webhook] Profile fetch 1 OK, rows:", rows.length);
      if (rows.length > 0) return rows[0];
    } else {
      console.log("[trigger-webhook] Profile fetch 1 failed:", res.status);
    }
  } catch (e) {
    console.log("[trigger-webhook] Profile fetch 1 error:", e);
  }

  // Attempt 2: service-role key (bypasses RLS)
  if (SERVICE_ROLE_KEY) {
    try {
      console.log("[trigger-webhook] Profile fetch attempt 2 (service-role) …");
      const res = await fetch(url, {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          Accept: "application/json",
          Prefer: "return=representation",
        },
      });
      if (res.ok) {
        const rows = await res.json() as Record<string, unknown>[];
        console.log("[trigger-webhook] Profile fetch 2 OK, rows:", rows.length);
        if (rows.length > 0) return rows[0];
      } else {
        console.log("[trigger-webhook] Profile fetch 2 failed:", res.status);
      }
    } catch (e) {
      console.log("[trigger-webhook] Profile fetch 2 error:", e);
    }
  }

  console.log("[trigger-webhook] All profile fetch attempts failed — using fallback");
  return null;
}

export default async function handler(req: Request): Promise<Response> {
  console.log("[trigger-webhook] ── Request received ──", req.method);

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build the payload — always starts with fallback, then gets overwritten
  // with real data progressively so the webhook ALWAYS fires.
  let payload = {
    ...FALLBACK_DATA,
    timestamp: new Date().toISOString(),
  };

  try {
    // ── Step 1: Extract Bearer token ────────────────────────────────────────
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    console.log("[trigger-webhook] Token present:", !!token, "length:", token.length);

    // ── Step 2: Resolve user from JWT ────────────────────────────────────────
    if (token) {
      const user = await getUserFromToken(token);

      if (user && user.id) {
        console.log("[trigger-webhook] User resolved:", user.id);
        payload = {
          ...payload,
          user_id: user.id,
          email: user.email || payload.email,
          name: user.name || user.email || payload.name,
        };

        // ── Step 3: Fetch profile from Supabase ──────────────────────────────
        const profile = await getProfileFromSupabase(user.id, token);

        if (profile) {
          console.log("[trigger-webhook] Profile found — enriching payload");
          payload = {
            ...payload,
            email:
              (typeof profile.email === "string" ? profile.email : "") ||
              user.email ||
              payload.email,
            name:
              (typeof profile.name === "string" ? profile.name.trim() : "") ||
              user.name ||
              payload.name,
            role:
              typeof profile.role === "string" ? profile.role.trim() : "",
            skills:             parseListField(profile.skills),
            topics:             parseListField(profile.topics),
            linkedin_token:
              typeof profile.linkedin_token === "string"
                ? profile.linkedin_token
                : "",
            linkedin_profile_id:
              typeof profile.linkedin_profile_id === "string"
                ? profile.linkedin_profile_id
                : "",
            linkedin_profile_url:
              typeof profile.linkedin_profile_url === "string"
                ? profile.linkedin_profile_url
                : "",
            automation_status:
              profile.active === true ? "enabled" : "disabled",
            profile_available: true,
          };
        } else {
          console.log("[trigger-webhook] Profile null — keeping fallback for profile fields");
        }
      } else {
        console.log("[trigger-webhook] Could not resolve user — using full fallback");
      }
    } else {
      console.log("[trigger-webhook] No token — using full fallback data");
    }
  } catch (e) {
    // If anything above throws unexpectedly, log it and continue with fallback
    console.log("[trigger-webhook] Unexpected error building payload:", e);
  }

  console.log("[trigger-webhook] Final payload summary:", {
    user_id: payload.user_id || "(fallback)",
    email: payload.email,
    profile_available: payload.profile_available,
    linkedin_token_present: !!payload.linkedin_token,
    linkedin_profile_id_present: !!payload.linkedin_profile_id,
    role: payload.role || "(empty)",
    skills_count: Array.isArray(payload.skills) ? payload.skills.length : 0,
    topics_count: Array.isArray(payload.topics) ? payload.topics.length : 0,
  });

  // ── Step 4: Fire Make.com webhook ─────────────────────────────────────────
  // This block is ALWAYS reached — even if every step above failed.
  try {
    console.log("[trigger-webhook] Firing Make.com webhook …");

    const webhookRes = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await webhookRes.text().catch(() => "");
    console.log("[trigger-webhook] Make.com response:", webhookRes.status, responseText);

    if (webhookRes.ok) {
      console.log("[trigger-webhook] ✓ Webhook fired successfully");
      return new Response(
        JSON.stringify({
          success: true,
          message: "Automation triggered. Make.com is generating and posting your content.",
          webhook_status: webhookRes.status,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("[trigger-webhook] ✗ Make.com returned non-OK:", webhookRes.status);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Make.com webhook returned an error. Please try again.",
        webhook_status: webhookRes.status,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.log("[trigger-webhook] ✗ Webhook fetch error:", e);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Could not reach automation service. Please try again.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }
}

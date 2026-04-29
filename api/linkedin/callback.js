const { createClient } = require("@supabase/supabase-js");

const REDIRECT_URI = "https://linkedin-theta-seven.vercel.app/api/linkedin/callback";
const FRONTEND_BASE = "https://linkedin-theta-seven.vercel.app";

// Whitelist of allowed origins — prevents open redirect attacks
const ALLOWED_ORIGINS = [
  "https://linkedin-theta-seven.vercel.app",
  "https://linkedin-saas-git-dev-hrudai.vercel.app",
  "http://localhost:5173",
  "http://localhost:3000",
];

function redirect(res, status, url) {
  res.writeHead(status, { Location: url });
  res.end();
}

async function handler(req, res) {
  // Default fallbacks — overridden once we parse state
  let appOrigin = FRONTEND_BASE;
  let returnPath = "/app/profile-setup";

  const makeSuccessUrl = () => `${appOrigin}/#${returnPath}?linkedin=connected`;
  const makeErrorUrl   = (code = "linkedin_failed") => `${appOrigin}/#/auth?error=${code}`;

  try {
    if (req.method !== "GET") {
      redirect(res, 302, makeErrorUrl());
      return;
    }

    const code = req.query.code;
    const state = req.query.state;

    if (!code) {
      redirect(res, 302, makeErrorUrl("no_code"));
      return;
    }

    if (!state) {
      console.error("[LinkedIn callback] No state found");
      redirect(res, 302, makeErrorUrl());
      return;
    }

    let userEmail;
    let userId;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
      userEmail = decoded && decoded.email;
      userId = decoded && decoded.userId;

      // Resolve origin — validate against whitelist to prevent open redirect
      if (decoded.appOrigin && ALLOWED_ORIGINS.includes(decoded.appOrigin)) {
        appOrigin = decoded.appOrigin;
      }
      if (decoded.returnPath && decoded.returnPath.startsWith("/")) {
        returnPath = decoded.returnPath;
      }
    } catch (e) {
      console.error("[LinkedIn callback] Invalid state:", e.message);
      redirect(res, 302, makeErrorUrl());
      return;
    }

    if (!userEmail || typeof userEmail !== "string" || !userEmail.trim()) {
      console.error("[LinkedIn callback] No email in state");
      redirect(res, 302, makeErrorUrl());
      return;
    }

    const supabaseUrl = process.env.SUPABASE_URL && String(process.env.SUPABASE_URL).trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY && String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim();
    const clientId = process.env.LINKEDIN_CLIENT_ID && String(process.env.LINKEDIN_CLIENT_ID).trim();
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET && String(process.env.LINKEDIN_CLIENT_SECRET).trim();

    if (!supabaseUrl || !serviceKey || !clientId || !clientSecret) {
      console.error("[LinkedIn callback] Missing env");
      redirect(res, 302, makeErrorUrl());
      return;
    }

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));
    const accessToken = tokenData && tokenData.access_token;

    if (!accessToken || typeof accessToken !== "string") {
      console.error("[LinkedIn callback] No access_token in response", tokenData);
      redirect(res, 302, makeErrorUrl());
      return;
    }

    console.log("Saving token for:", userEmail, "userId:", userId || "unknown");
    console.log("Token:", accessToken ? "[REDACTED]" : "missing");

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve userId from state, or fall back to looking up by email in auth.users
    let resolvedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;

    if (!resolvedUserId) {
      // Fallback: look up user_id from profiles table by email
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("email", userEmail.trim())
        .maybeSingle();
      resolvedUserId = profileRow?.user_id ?? null;
    }

    let saveError = null;

    if (resolvedUserId) {
      // Preferred path: upsert by user_id (guaranteed to work)
      const { error } = await supabase
        .from("profiles")
        .upsert(
          { user_id: resolvedUserId, linkedin_token: accessToken, linkedin_connected: true },
          { onConflict: "user_id" }
        );
      saveError = error;
    } else {
      // Last resort: update by email
      const { error } = await supabase
        .from("profiles")
        .update({ linkedin_token: accessToken, linkedin_connected: true })
        .eq("email", userEmail.trim());
      saveError = error;
    }

    if (saveError) {
      console.error("[LinkedIn callback] Supabase save error:", saveError);
      redirect(res, 302, makeErrorUrl());
      return;
    }

    console.log("[LinkedIn callback] Saved token for:", userEmail, "userId:", resolvedUserId, "origin:", appOrigin);

    redirect(res, 302, makeSuccessUrl());
  } catch (err) {
    console.error("[LinkedIn callback] Unhandled error:", err);
    redirect(res, 302, makeErrorUrl());
  }
}

module.exports = handler;

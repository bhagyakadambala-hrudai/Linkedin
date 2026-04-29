const { createClient } = require("@supabase/supabase-js");

const REDIRECT_URI = "https://linkedin-theta-seven.vercel.app/api/linkedin/callback";
const FRONTEND_BASE = "https://linkedin-theta-seven.vercel.app";

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
  let appOrigin = FRONTEND_BASE;
  let returnPath = "/app/profile-setup";

  const makeSuccessUrl = () => `${appOrigin}/#${returnPath}?linkedin=connected`;
  const makeErrorUrl = (code = "linkedin_failed", detail = "") =>
    `${appOrigin}/#/app/profile-setup?linkedin_error=${encodeURIComponent(code)}${detail ? `&msg=${encodeURIComponent(detail)}` : ""}`;

  try {
    if (req.method !== "GET") {
      redirect(res, 302, makeErrorUrl("method_not_allowed"));
      return;
    }

    const code = req.query.code;
    const state = req.query.state;

    // LinkedIn denied access or returned an error
    if (req.query.error) {
      console.error("[LinkedIn callback] LinkedIn error:", req.query.error, req.query.error_description);
      redirect(res, 302, makeErrorUrl("linkedin_denied", req.query.error_description || req.query.error));
      return;
    }

    if (!code) {
      redirect(res, 302, makeErrorUrl("no_code"));
      return;
    }

    if (!state) {
      console.error("[LinkedIn callback] No state found");
      redirect(res, 302, makeErrorUrl("no_state"));
      return;
    }

    let userEmail = null;
    let userId = null;
    try {
      const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
      userEmail = (decoded && decoded.email) || null;
      userId = (decoded && decoded.userId) || null;

      if (decoded.appOrigin && ALLOWED_ORIGINS.includes(decoded.appOrigin)) {
        appOrigin = decoded.appOrigin;
      }
      if (decoded.returnPath && decoded.returnPath.startsWith("/")) {
        returnPath = decoded.returnPath;
      }
    } catch (e) {
      console.error("[LinkedIn callback] Invalid state:", e.message);
      redirect(res, 302, makeErrorUrl("bad_state"));
      return;
    }

    // Need at least one identifier to save the token
    if (!userId && !userEmail) {
      console.error("[LinkedIn callback] No userId or email in state");
      redirect(res, 302, makeErrorUrl("no_identity"));
      return;
    }

    const supabaseUrl = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/$/, "");
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    const clientId = (process.env.LINKEDIN_CLIENT_ID || "").trim();
    const clientSecret = (process.env.LINKEDIN_CLIENT_SECRET || "").trim();

    const missing = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!serviceKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!clientId) missing.push("LINKEDIN_CLIENT_ID");
    if (!clientSecret) missing.push("LINKEDIN_CLIENT_SECRET");

    if (missing.length > 0) {
      console.error("[LinkedIn callback] Missing env vars:", missing.join(", "));
      redirect(res, 302, makeErrorUrl("config_error", `Missing: ${missing.join(", ")}`));
      return;
    }

    // Exchange code for LinkedIn access token
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
      const errDetail = tokenData.error_description || tokenData.error || `HTTP ${tokenRes.status}`;
      console.error("[LinkedIn callback] No access_token:", errDetail, tokenData);
      redirect(res, 302, makeErrorUrl("token_failed", errDetail));
      return;
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve userId — use from state directly, or fall back to email lookup in profiles
    let resolvedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;

    if (!resolvedUserId && userEmail) {
      const { data: profileRow } = await supabase
        .from("profiles")
        .select("user_id")
        .eq("email", userEmail.trim())
        .maybeSingle();
      resolvedUserId = profileRow?.user_id ?? null;
    }

    // If still no userId, look up from Supabase auth by email
    if (!resolvedUserId && userEmail) {
      const authLookup = await fetch(
        `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(userEmail.trim())}`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
      );
      if (authLookup.ok) {
        const authData = await authLookup.json().catch(() => ({}));
        resolvedUserId = authData?.users?.[0]?.id ?? null;
      }
    }

    if (!resolvedUserId) {
      console.error("[LinkedIn callback] Could not resolve user_id for", userEmail);
      redirect(res, 302, makeErrorUrl("user_not_found", "Could not find your account. Please sign in again."));
      return;
    }

    const { error: saveError } = await supabase
      .from("profiles")
      .upsert(
        { user_id: resolvedUserId, linkedin_token: accessToken, linkedin_connected: true },
        { onConflict: "user_id" }
      );

    if (saveError) {
      console.error("[LinkedIn callback] Supabase save error:", saveError);
      redirect(res, 302, makeErrorUrl("db_error", saveError.message));
      return;
    }

    console.log("[LinkedIn callback] Token saved. userId:", resolvedUserId, "origin:", appOrigin);
    redirect(res, 302, makeSuccessUrl());
  } catch (err) {
    console.error("[LinkedIn callback] Unhandled error:", err);
    redirect(res, 302, makeErrorUrl("server_error", err.message || "Unexpected error"));
  }
}

module.exports = handler;

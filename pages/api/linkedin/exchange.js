const { createClient } = require("@supabase/supabase-js");

async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { code, redirect_uri } = req.body;

    if (!code) {
      return res.status(400).json({ error: "No code provided" });
    }

    const tokenRedirectUri =
      (typeof redirect_uri === "string" && redirect_uri.trim()) ||
      process.env.LINKEDIN_REDIRECT_URI ||
      "https://linkedin-theta-seven.vercel.app/api/linkedin/callback";

    const authHeader = req.headers.authorization;
    const accessToken = authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!accessToken) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const supabaseUrl = process.env.SUPABASE_URL && String(process.env.SUPABASE_URL).trim();
    const anonKey = process.env.SUPABASE_ANON_KEY && String(process.env.SUPABASE_ANON_KEY).trim();
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY && String(process.env.SUPABASE_SERVICE_ROLE_KEY).trim();

    if (!supabaseUrl || !anonKey || !serviceKey) {
      return res.status(500).json({ error: "Server configuration error" });
    }

    const supabaseAuth = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await supabaseAuth.auth.getUser(accessToken);

    if (authError || !user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: tokenRedirectUri,
        client_id: process.env.LINKEDIN_CLIENT_ID,
        client_secret: process.env.LINKEDIN_CLIENT_SECRET,
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenData.access_token) {
      return res.status(400).json({
        error: tokenData.error_description || "Failed to get token",
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({
        linkedin_token: tokenData.access_token,
        linkedin_connected: true,
      })
      .eq("user_id", user.id);

    if (updateError) {
      console.error("Exchange profile update error:", updateError);
      return res.status(500).json({ error: "Failed to save token" });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Exchange error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

module.exports = handler;

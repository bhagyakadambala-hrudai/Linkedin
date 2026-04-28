/**
 * POST /api/trigger-webhook
 *
 * Triggered when a user has automation enabled and clicks "Publish".
 * Validates the user session, fetches enriched profile data from Supabase,
 * then fires the Make.com webhook with a full user payload.
 *
 * Security: The Make.com webhook URL is read only from env vars — never exposed to the client.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// ── Env config ────────────────────────────────────────────────────────────────
const MAKE_WEBHOOK_URL =
  process.env.MAKE_WEBHOOK_URL ??
  'https://hook.us2.make.com/wkbb1u2cki5tlcxtmgaxq9efu56vg3ql';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
).replace(/\/$/, '');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────
interface WebhookPayload {
  user_id: string;
  name: string;
  email: string;
  linkedin_profile_url: string;
  automation_status: 'enabled' | 'disabled';
  timestamp: string;
}

// ── Retry helper ──────────────────────────────────────────────────────────────
/**
 * Send a POST request to Make.com with exponential-backoff retry.
 * Retries up to `maxRetries` times on network errors or 5xx responses.
 * Immediately returns on 4xx (client error — retrying won't help).
 */
async function sendToMakeWithRetry(
  payload: WebhookPayload,
  maxRetries = 2
): Promise<{ ok: boolean; status?: number; detail?: string }> {
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(MAKE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        return { ok: true, status: res.status };
      }

      const detail = await res.text().catch(() => '');
      console.error(
        `[trigger-webhook] Make.com attempt ${attempt + 1} failed — status ${res.status}:`,
        detail
      );

      // 4xx = bad request; retrying won't fix it
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, detail };
      }

      lastError = `HTTP ${res.status}: ${detail}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(
        `[trigger-webhook] Make.com attempt ${attempt + 1} threw:`,
        lastError
      );
    }

    // Exponential backoff before the next retry (500 ms, 1000 ms …)
    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }

  return { ok: false, detail: lastError ?? 'Max retries exceeded' };
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    // ── 1. Require Bearer token ───────────────────────────────────────────────
    const authHeader = request.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const token = authHeader.slice(7);

    // Guard: Supabase must be configured
    if (!SUPABASE_URL || !ANON_KEY) {
      console.error('[trigger-webhook] Supabase env vars missing');
      return NextResponse.json(
        { success: false, error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // ── 2. Verify the token and get the authenticated user ────────────────────
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user?.id) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const userId = user.id;
    const userEmail = user.email ?? '';

    // ── 3. Fetch enriched profile data via service role ───────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select(
        'name, linkedin_profile_url, active, status, linkedin_connected, onboarding_completed'
      )
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('[trigger-webhook] Profile fetch error:', profileError);
      return NextResponse.json(
        { success: false, error: 'Failed to fetch profile. Try again.' },
        { status: 500 }
      );
    }

    if (!profile) {
      return NextResponse.json(
        {
          success: false,
          error: 'Profile not found. Complete onboarding first.',
        },
        { status: 404 }
      );
    }

    // ── 4. Validate publish preconditions ─────────────────────────────────────
    if (!profile.linkedin_connected) {
      return NextResponse.json(
        {
          success: false,
          error: 'LinkedIn is not connected. Connect it in Settings.',
        },
        { status: 422 }
      );
    }

    if (!profile.onboarding_completed) {
      return NextResponse.json(
        { success: false, error: 'Finish onboarding before publishing.' },
        { status: 422 }
      );
    }

    // ── 5. Build the enriched Make.com payload ────────────────────────────────
    const automationStatus: 'enabled' | 'disabled' =
      profile.active === true ? 'enabled' : 'disabled';

    const payload: WebhookPayload = {
      user_id: userId,
      name:
        (typeof profile.name === 'string' && profile.name.trim()) ||
        (user.user_metadata?.full_name as string | undefined) ||
        'Unknown',
      email: userEmail,
      linkedin_profile_url:
        typeof profile.linkedin_profile_url === 'string'
          ? profile.linkedin_profile_url
          : '',
      automation_status: automationStatus,
      timestamp: new Date().toISOString(),
    };

    // ── 6. Validate required payload fields ───────────────────────────────────
    const missing: string[] = [];
    if (!payload.user_id) missing.push('user_id');
    if (!payload.email) missing.push('email');
    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing required fields: ${missing.join(', ')}`,
        },
        { status: 422 }
      );
    }

    if (!MAKE_WEBHOOK_URL) {
      console.error('[trigger-webhook] MAKE_WEBHOOK_URL env var not set');
      return NextResponse.json(
        { success: false, error: 'Webhook not configured on server.' },
        { status: 500 }
      );
    }

    // ── 7. Fire Make.com webhook (with retry) ─────────────────────────────────
    console.log(
      `[trigger-webhook] Firing Make.com webhook — user: ${userId} | automation: ${automationStatus}`
    );

    const result = await sendToMakeWithRetry(payload);

    if (!result.ok) {
      console.error(
        '[trigger-webhook] Make.com webhook failed after retries:',
        result
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to reach automation service. Please try again.',
        },
        { status: 502 }
      );
    }

    console.log(
      `[trigger-webhook] Make.com webhook succeeded — user: ${userId}`
    );

    return NextResponse.json({
      success: true,
      message:
        'Automation triggered. Make.com is generating and posting your content.',
    });
  } catch (error) {
    console.error('[trigger-webhook] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Unexpected server error.' },
      { status: 500 }
    );
  }
}

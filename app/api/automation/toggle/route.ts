import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL ?? '';

/** Parse a profile field that may be a JSON string, array, or null into a string[]. */
function parseListField(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [trimmed];
    } catch {
      // Comma-separated fallback
      return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    // ── 1. Validate Bearer token ──────────────────────────────────────────────
    const authHeader = request.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice(7);

    // ── 2. Resolve the user from the token ────────────────────────────────────
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = user.id;

    // ── 3. Parse request body ─────────────────────────────────────────────────
    const body = await request.json().catch(() => ({}));
    const action: string = body?.action ?? '';
    if (action !== 'enable' && action !== 'disable') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "enable" or "disable".' },
        { status: 400 }
      );
    }

    // ── 4. Service-role client for all DB writes ──────────────────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // ── DISABLE path ──────────────────────────────────────────────────────────
    if (action === 'disable') {
      await admin
        .from('profiles')
        .update({ active: false, status: 'paused' })
        .eq('user_id', userId);

      return NextResponse.json({
        success: true,
        message: 'Automation disabled.',
      });
    }

    // ── ENABLE path ───────────────────────────────────────────────────────────

    // 5. Fetch the user's profile
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role, skills, topics, linkedin_connected, onboarding_completed')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      console.error('Profile fetch error:', profileError);
      return NextResponse.json(
        { error: 'Failed to fetch profile. Please try again.' },
        { status: 500 }
      );
    }

    if (!profile) {
      return NextResponse.json(
        { error: 'Profile not found. Complete your profile setup first.' },
        { status: 404 }
      );
    }

    // 6. Validate required fields
    const role = typeof profile.role === 'string' ? profile.role.trim() : '';
    const skills = parseListField(profile.skills);
    const topics = parseListField(profile.topics);

    const missing: string[] = [];
    if (!role) missing.push('role');
    if (skills.length === 0) missing.push('skills');
    if (topics.length === 0) missing.push('topics');
    if (!profile.linkedin_connected) missing.push('LinkedIn connection');
    if (!profile.onboarding_completed) missing.push('onboarding');

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Complete your profile before enabling automation. Missing: ${missing.join(', ')}.`,
          missing,
        },
        { status: 422 }
      );
    }

    // 7. Mark profile as active in DB
    const { error: updateError } = await admin
      .from('profiles')
      .update({ active: true, status: 'active' })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Profile update error:', updateError);
      return NextResponse.json(
        { error: 'Failed to update automation status. Please try again.' },
        { status: 500 }
      );
    }

    // 8. Ensure automation_rotation row exists
    await admin
      .from('automation_rotation')
      .upsert(
        { user_id: userId, current_step: 1 },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    // 9. Fire Make.com webhook — awaited so serverless function does not terminate before the request completes
    if (!MAKE_WEBHOOK_URL) {
      console.warn('MAKE_WEBHOOK_URL is not configured — skipping webhook.');
    } else {
      const webhookPayload = {
        user_id: userId,
        role,
        skills,
        topics,
      };

      try {
        const webhookRes = await fetch(MAKE_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(webhookPayload),
        });
        if (!webhookRes.ok) {
          const detail = await webhookRes.text().catch(() => '');
          console.error(`Make.com webhook returned ${webhookRes.status}:`, detail);
        } else {
          console.log('Make.com webhook triggered successfully.');
        }
      } catch (err) {
        console.error('Make.com webhook trigger failed:', err);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Automation enabled. Make.com will generate and post your content shortly.',
    });
  } catch (error: any) {
    console.error('Automation toggle unexpected error:', error);
    return NextResponse.json(
      { error: 'Unexpected server error. Please try again.' },
      { status: 500 }
    );
  }
}

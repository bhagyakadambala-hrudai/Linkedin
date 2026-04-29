import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAutomation } from '@/lib/automation';

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    const t = value.trim();
    if (!t) return [];
    try {
      const p = JSON.parse(t);
      return Array.isArray(p) ? p.filter(Boolean) : [t];
    } catch {
      return t.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

export async function POST(request: NextRequest) {
  try {
    // 1. Validate Bearer token
    const authHeader = request.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice(7);

    // 2. Resolve user from token
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

    // 3. Parse action
    const body = await request.json().catch(() => ({}));
    const action: string = body?.action ?? '';
    if (action !== 'enable' && action !== 'disable') {
      return NextResponse.json(
        { error: 'Invalid action. Must be "enable" or "disable".' },
        { status: 400 }
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // DISABLE path
    if (action === 'disable') {
      await admin
        .from('profiles')
        .update({ active: false, status: 'paused' })
        .eq('user_id', userId);

      return NextResponse.json({ success: true, message: 'Automation disabled.' });
    }

    // ENABLE path

    // 4. Fetch profile
    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('role, skills, topics, linkedin_connected, onboarding_completed')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
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

    // 5. Validate required fields
    const role = typeof profile.role === 'string' ? profile.role.trim() : '';
    const skills = parseList(profile.skills);
    const topics = parseList(profile.topics);

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

    // 6. Mark profile as active
    const { error: updateError } = await admin
      .from('profiles')
      .update({ active: true, status: 'active' })
      .eq('user_id', userId);

    if (updateError) {
      return NextResponse.json(
        { error: 'Failed to update automation status. Please try again.' },
        { status: 500 }
      );
    }

    // 7. Ensure rotation row exists
    await admin
      .from('automation_rotation')
      .upsert(
        { user_id: userId, current_step: 1 },
        { onConflict: 'user_id', ignoreDuplicates: true }
      );

    // 8. Kick off first post immediately (non-blocking — log errors but don't fail the response)
    runAutomation(userId).catch((err) =>
      console.error('[automation/toggle] Initial post failed:', err)
    );

    return NextResponse.json({
      success: true,
      message: 'Automation enabled. Your first post is being generated and published.',
    });
  } catch (error: any) {
    console.error('[automation/toggle] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Unexpected server error. Please try again.' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/trigger-webhook
 *
 * Validates the user session, checks publish preconditions,
 * then runs the automation engine directly (Gemini + LinkedIn).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAutomation } from '@/lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
).replace(/\/$/, '');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? '';

export async function POST(request: NextRequest) {
  try {
    // 1. Require Bearer token
    const authHeader = request.headers.get('authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    const token = authHeader.slice(7);

    if (!SUPABASE_URL || !ANON_KEY) {
      return NextResponse.json(
        { success: false, error: 'Server configuration error.' },
        { status: 500 }
      );
    }

    // 2. Verify the token
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

    // 3. Fetch profile and validate preconditions
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data: profile, error: profileError } = await admin
      .from('profiles')
      .select('linkedin_connected, onboarding_completed')
      .eq('user_id', userId)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json(
        { success: false, error: 'Failed to fetch profile. Try again.' },
        { status: 500 }
      );
    }
    if (!profile) {
      return NextResponse.json(
        { success: false, error: 'Profile not found. Complete onboarding first.' },
        { status: 404 }
      );
    }
    if (!profile.linkedin_connected) {
      return NextResponse.json(
        { success: false, error: 'LinkedIn is not connected. Connect it in Settings.' },
        { status: 422 }
      );
    }
    if (!profile.onboarding_completed) {
      return NextResponse.json(
        { success: false, error: 'Finish onboarding before publishing.' },
        { status: 422 }
      );
    }

    // 4. Run automation
    console.log(`[trigger-webhook] Running automation for user: ${userId}`);
    const result = await runAutomation(userId);

    if (!result.success) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      message: 'Post generated and published to LinkedIn.',
      topic: result.topic,
      post_url: result.post_url,
    });
  } catch (error) {
    console.error('[trigger-webhook] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Unexpected server error.' },
      { status: 500 }
    );
  }
}

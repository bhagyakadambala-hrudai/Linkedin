import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runAutomation } from '@/lib/automation';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function profileReadyForPublish(
  userId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return { ok: true };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: row } = await admin
    .from('profiles')
    .select('linkedin_connected, onboarding_completed')
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) return { ok: false, message: 'Profile not found. Complete onboarding first.' };
  if (!row.linkedin_connected)
    return { ok: false, message: 'LinkedIn is not connected. Connect it in Settings.' };
  if (!row.onboarding_completed)
    return { ok: false, message: 'Finish onboarding before publishing.' };

  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      user_id?: unknown;
    };

    const userId =
      typeof body.user_id === 'string' ? body.user_id.trim() : null;

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json(
        { success: false, error: 'Valid user_id is required' },
        { status: 400 }
      );
    }

    const ready = await profileReadyForPublish(userId);
    if (!ready.ok) {
      return NextResponse.json(
        { success: false, error: ready.message },
        { status: 400 }
      );
    }

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
  } catch (error: any) {
    console.error('[publish] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Unexpected server error.' },
      { status: 500 }
    );
  }
}

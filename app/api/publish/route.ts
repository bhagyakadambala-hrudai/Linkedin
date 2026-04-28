import { NextRequest, NextResponse } from 'next/server';

const MAKE_WEBHOOK_URL =
  process.env.MAKE_WEBHOOK_URL ?? 'https://hook.us2.make.com/wkbb1u2cki5tlcxtmgaxq9efu56vg3ql';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
).replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function profileReadyForPublish(
  userId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    // Can't verify — allow through
    return { ok: true };
  }

  const url = `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${encodeURIComponent(
    userId
  )}&select=linkedin_connected,onboarding_completed`;

  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    return { ok: false, message: 'Could not verify your profile. Try again in a moment.' };
  }

  const rows = (await res.json()) as Array<{
    linkedin_connected?: boolean | null;
    onboarding_completed?: boolean | null;
  }>;

  const row = rows[0];
  if (!row) {
    return { ok: false, message: 'Profile not found. Complete onboarding first.' };
  }
  if (!row.linkedin_connected) {
    return { ok: false, message: 'LinkedIn is not connected. Connect it in Settings.' };
  }
  if (!row.onboarding_completed) {
    return { ok: false, message: 'Finish onboarding before publishing.' };
  }

  return { ok: true };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      content?: unknown;
      user_id?: unknown;
    };

    const userId =
      typeof body.user_id === 'string' && body.user_id.trim()
        ? body.user_id.trim()
        : null;

    if (!userId) {
      return NextResponse.json({ success: false, error: 'user_id is required' }, { status: 400 });
    }

    if (!UUID_RE.test(userId)) {
      return NextResponse.json({ success: false, error: 'Invalid user_id' }, { status: 400 });
    }

    const ready = await profileReadyForPublish(userId);
    if (!ready.ok) {
      return NextResponse.json({ success: false, error: ready.message }, { status: 400 });
    }

    if (!MAKE_WEBHOOK_URL) {
      return NextResponse.json(
        { success: false, error: 'Make.com webhook URL is not configured.' },
        { status: 500 }
      );
    }

    console.log('Triggering Make.com publish webhook for user:', userId);

    const webhookRes = await fetch(MAKE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: userId,
        timestamp: new Date().toISOString(),
      }),
    });

    console.log('Make.com webhook response status:', webhookRes.status);

    if (!webhookRes.ok) {
      const detail = await webhookRes.text().catch(() => '');
      console.error('Make.com publish webhook failed:', webhookRes.status, detail);
      return NextResponse.json({ success: false, error: 'Make.com webhook failed.' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      message: 'Make.com is generating and posting your content.',
    });
  } catch (error) {
    console.error('Publish route error:', error);
    return NextResponse.json({ success: false, error: 'Unexpected server error.' }, { status: 500 });
  }
}

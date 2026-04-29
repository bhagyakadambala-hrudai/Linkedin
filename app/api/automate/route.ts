import { NextRequest, NextResponse } from 'next/server';
import { runAutomation } from '@/lib/automation';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const userId =
      typeof body.user_id === 'string' ? body.user_id.trim() : '';

    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json(
        { success: false, error: 'Valid user_id is required' },
        { status: 400 }
      );
    }

    const result = await runAutomation(userId);

    if (!result.success) {
      return NextResponse.json(result, { status: 422 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[automate] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: error.message ?? 'Automation failed' },
      { status: 500 }
    );
  }
}

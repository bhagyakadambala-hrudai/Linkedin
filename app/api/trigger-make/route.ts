
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { payload } = body;
    const webhookUrl = process.env.MAKE_WEBHOOK_URL;

    if (!webhookUrl) {
      return NextResponse.json({ error: 'Configuration Error: MAKE_WEBHOOK_URL missing' }, { status: 500 });
    }

    // Forward the payload to Make.com
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      console.warn(`Make.com webhook returned status: ${response.status}`);
    }

    // Always return success to frontend to avoid blocking UI
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Proxy Error:", error);
    return NextResponse.json({ error: 'Failed to trigger automation' }, { status: 500 });
  }
}

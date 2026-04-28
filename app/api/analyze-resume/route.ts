import { createRequire } from 'module';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
/** Vercel / Next: allow PDF + OpenAI (set OPENAI_API_KEY + optional OPENAI_FETCH_TIMEOUT_MS in project env). */
export const maxDuration = 60;

const require = createRequire(import.meta.url);
const { analyzeResumeFromUrl } = require('../../../lib/analyzeResumeOpenAI.cjs') as {
  analyzeResumeFromUrl: (fileUrl: string) => Promise<{
    success: boolean;
    role: string;
    skills: string[];
    topics: string[];
    error?: string;
  }>;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { fileUrl?: string } | null;

    console.log('Incoming request:', body);

    if (
      !body ||
      typeof body !== 'object' ||
      !body.fileUrl ||
      typeof body.fileUrl !== 'string' ||
      !body.fileUrl.trim()
    ) {
      return NextResponse.json(
        { success: false, role: '', skills: [], topics: [] },
        { status: 200 }
      );
    }

    const result = await analyzeResumeFromUrl(body.fileUrl.trim());
    const payload: Record<string, unknown> = {
      success: result.success === true,
      role: result.role || '',
      skills: Array.isArray(result.skills) ? result.skills : [],
      topics: Array.isArray(result.topics) ? result.topics : [],
    };
    if (result.error) {
      payload.error = result.error;
    }
    return NextResponse.json(payload, { status: 200 });
  } catch (error: unknown) {
    console.error('Analyze Resume Error:', error);
    return NextResponse.json(
      {
        success: false,
        role: '',
        skills: [],
        topics: [],
      },
      { status: 200 }
    );
  }
}

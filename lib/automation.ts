/**
 * Core automation engine — replaces Make.com.
 * Generates a LinkedIn post with Gemini AI and publishes it directly
 * to the LinkedIn API using the user's stored OAuth token.
 */

import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const SUPABASE_URL = (
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  ''
).replace(/\/$/, '');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ?? process.env.API_KEY ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AutomateResult {
  success: boolean;
  error?: string;
  topic?: string;
  post_id?: string;
  post_url?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

async function generatePost(
  role: string,
  skills: string[],
  topic: string
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

  const prompt = `You are an expert LinkedIn ghostwriter.
Write a high-impact LinkedIn post for a ${role} specialising in ${skills.join(', ')}.
Topic: ${topic}
Tone: Professional and engaging.
Requirements:
- Compelling first sentence (hook)
- Value-driven body with bullet points or short paragraphs
- Strong call to action
- 3–5 relevant hashtags
Keep it under 3000 characters.`;

  const response = await model.generateContent(prompt);
  return response.response.text();
}

async function getLinkedInPersonId(accessToken: string): Promise<string> {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn userinfo ${res.status}: ${detail}`);
  }
  const data = await res.json();
  // `sub` is the raw person ID returned by the OpenID Connect userinfo endpoint
  const sub: string = data.sub ?? '';
  if (!sub) throw new Error('LinkedIn userinfo returned no sub claim');
  return sub;
}

async function publishToLinkedIn(
  accessToken: string,
  personId: string,
  content: string
): Promise<{ postId: string; postUrl: string }> {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      author: `urn:li:person:${personId}`,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn ugcPosts ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const postId: string = data.id ?? '';
  const postUrl = postId
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`
    : '';
  return { postId, postUrl };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runAutomation(userId: string): Promise<AutomateResult> {
  if (!userId) return { success: false, error: 'user_id is required' };
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY)
    return { success: false, error: 'Server configuration error' };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // 1. Fetch profile
  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('role, skills, topics, linkedin_token')
    .eq('user_id', userId)
    .maybeSingle();

  if (profileErr || !profile)
    return { success: false, error: 'Profile not found' };

  if (!profile.linkedin_token)
    return { success: false, error: 'LinkedIn is not connected' };

  const role: string =
    typeof profile.role === 'string' ? profile.role.trim() : 'Professional';
  const skills = parseList(profile.skills);
  const topics = parseList(profile.topics);

  if (topics.length === 0)
    return { success: false, error: 'No topics configured in profile' };

  // 2. Pick topic by rotating through the list
  const { data: rotation } = await admin
    .from('automation_rotation')
    .select('current_step')
    .eq('user_id', userId)
    .maybeSingle();

  const currentStep: number = rotation?.current_step ?? 1;
  const topicIndex = (currentStep - 1) % topics.length;
  const topic = topics[topicIndex];
  const nextStep = (currentStep % topics.length) + 1;

  // 3. Generate post with Gemini
  const content = await generatePost(role, skills, topic);

  // 4. Get LinkedIn person ID and publish
  const personId = await getLinkedInPersonId(profile.linkedin_token);
  const { postId, postUrl } = await publishToLinkedIn(
    profile.linkedin_token,
    personId,
    content
  );

  // 5. Persist the post record
  await admin.from('posts').insert({
    user_id: userId,
    content,
    status: 'published',
    post_id: postId,
    post_url: postUrl,
    posted_at: new Date().toISOString(),
  });

  // 6. Advance rotation
  await admin
    .from('automation_rotation')
    .upsert({ user_id: userId, current_step: nextStep }, { onConflict: 'user_id' });

  console.log(`[automation] published for user=${userId} topic="${topic}" post_id=${postId}`);

  return { success: true, topic, post_id: postId, post_url: postUrl };
}

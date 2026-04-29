/**
 * Core automation engine.
 * Generates LinkedIn posts with Gemini AI (3 rotating types) and publishes
 * directly to LinkedIn via the ugcPosts API.
 *
 * Post types:
 *   1 = Text only
 *   2 = Image / infographic structured content
 *   3 = Text + Image combined
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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? process.env.API_KEY ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PostType = 1 | 2 | 3;

export interface AutomateResult {
  success: boolean;
  error?: string;
  topic?: string;
  post_type?: PostType;
  post_id?: string;
  post_url?: string;
}

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildTextPrompt(role: string, skills: string[], topic: string): string {
  return `You are a professional LinkedIn content writer.

Write a LinkedIn post for the following user profile:

Role: ${role}
Skills: ${skills.join(', ')}
Topics of interest: ${topic}

Rules:
- Professional and friendly tone
- 80–120 words
- Use role-related emojis within the text (not at the start)
- Do not add emojis at the very beginning
- 5 to 6 relevant hashtags at the end
- Clear, human-sounding content
- Vary the style and angle every time — never give the same type of content
- Return the result in one paragraph only without line breaks
- Do not use quotation marks`;
}

function buildImagePrompt(role: string, topic: string): string {
  return `Generate a LinkedIn carousel-style infographic post.

Topic: ${topic}
Role: ${role}

Requirements:
- Create content suitable for an image-based LinkedIn post
- Use short bullet points
- Add headings and sections
- Make it visually structured like a poster
- Keep it concise and engaging
- Add emojis for each section heading
- Include a strong title at the top
- Add a conclusion or key takeaway at the end

Output format (use exactly this structure):
TITLE: [strong title here]

SECTION 1: [heading with emoji]
• [bullet point]
• [bullet point]

SECTION 2: [heading with emoji]
• [bullet point]
• [bullet point]

SECTION 3: [heading with emoji]
• [bullet point]
• [bullet point]

TAKEAWAY: [one-line conclusion]`;
}

function buildCombinedPrompt(role: string, skills: string[], topic: string): string {
  return `You are a professional LinkedIn content writer.

Create a combined LinkedIn post with both a written text caption AND a structured infographic.

Role: ${role}
Skills: ${skills.join(', ')}
Topics of interest: ${topic}

--- TEXT CAPTION ---
Rules:
- Professional and friendly tone
- 80–120 words
- Use role-related emojis within the text (not at the start)
- 5 to 6 relevant hashtags at the end
- Clear, human-sounding, one paragraph, no line breaks
- Do not use quotation marks

--- IMAGE CONTENT ---
Requirements:
- Suitable for an image-based LinkedIn post
- Short bullet points with headings
- Visually structured like a poster
- Emojis for each section heading
- Strong title at the top
- Key takeaway at the end

Output format (use exactly this structure):

TEXT:
[the text caption paragraph with hashtags]

IMAGE:
TITLE: [strong title]

SECTION 1: [heading with emoji]
• [bullet]
• [bullet]

SECTION 2: [heading with emoji]
• [bullet]
• [bullet]

SECTION 3: [heading with emoji]
• [bullet]
• [bullet]

TAKEAWAY: [one-line conclusion]`;
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

function nextPostType(current: PostType): PostType {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 1;
}

async function generateContent(
  postType: PostType,
  role: string,
  skills: string[],
  topic: string
): Promise<string> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');

  const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });

  let prompt: string;
  if (postType === 1) prompt = buildTextPrompt(role, skills, topic);
  else if (postType === 2) prompt = buildImagePrompt(role, topic);
  else prompt = buildCombinedPrompt(role, skills, topic);

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

  // 2. Fetch rotation state (topic step + post type)
  const { data: rotation } = await admin
    .from('automation_rotation')
    .select('current_step, post_type')
    .eq('user_id', userId)
    .maybeSingle();

  const currentStep: number = rotation?.current_step ?? 1;
  const postType: PostType = (rotation?.post_type as PostType) ?? 1;

  // Pick topic by rotating through list
  const topicIndex = (currentStep - 1) % topics.length;
  const topic = topics[topicIndex];
  const nextStep = (currentStep % topics.length) + 1;
  const nextType = nextPostType(postType);

  // 3. Generate content with Gemini
  const content = await generateContent(postType, role, skills, topic);

  // 4. Get LinkedIn person ID and publish
  const personId = await getLinkedInPersonId(profile.linkedin_token);
  const { postId, postUrl } = await publishToLinkedIn(
    profile.linkedin_token,
    personId,
    content
  );

  // 5. Save post record with post_type
  await admin.from('posts').insert({
    user_id: userId,
    content,
    status: 'published',
    post_id: postId,
    post_url: postUrl,
    posted_at: new Date().toISOString(),
    topic,
    post_type: postType,
  });

  // 6. Advance rotation — next topic step AND next post type
  await admin
    .from('automation_rotation')
    .upsert(
      { user_id: userId, current_step: nextStep, post_type: nextType },
      { onConflict: 'user_id' }
    );

  console.log(
    `[automation] user=${userId} post_type=${postType} topic="${topic}" post_id=${postId}`
  );

  return { success: true, topic, post_type: postType, post_id: postId, post_url: postUrl };
}

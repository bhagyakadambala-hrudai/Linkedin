'use strict';

const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

// Roboto TTF font paths — bundled in lib/fonts/ so they work on Vercel Lambda
// where there are no system fonts installed.
const FONT_REGULAR = path.join(__dirname, 'fonts', 'Roboto-Regular.ttf');
const FONT_BOLD = path.join(__dirname, 'fonts', 'Roboto-Bold.ttf');

const SUPABASE_URL = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ''
).replace(/\/$/, '');

const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || '';

// ── Prompts ───────────────────────────────────────────────────────────────────

function buildTextPrompt(role, skills, topic, angle) {
  return `You are a professional LinkedIn content writer.

Write a LinkedIn post for the following user profile:

Role: ${role}
Skills: ${skills.join(', ')}
Topic: ${topic}
Angle for this post: ${angle}

Rules:
- Professional and friendly tone
- 80–120 words
- The angle MUST shape the entire post — do not ignore it
- Use role-related emojis within the text (not at the start)
- Do not add emojis at the very beginning
- 5 to 6 relevant hashtags at the end
- Clear, human-sounding content
- Return the result in one paragraph only without line breaks
- Do not use quotation marks
- Do NOT include any labels like "TEXT:" or "IMAGE:"`;
}

function buildImagePrompt(role, topic, angle) {
  return `Generate structured content for a LinkedIn infographic image.

Topic: ${topic}
Role: ${role}
Angle for this infographic: ${angle}

Output ONLY this exact format (no other text before or after):
TITLE: [strong 3-5 word title in uppercase style]

SECTION 1: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 2: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 3: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

SECTION 4: [short heading, no emoji]
• [bullet point]
• [bullet point]
• [bullet point]

TAKEAWAY: [one-line insight]`;
}

function buildCombinedPrompt(role, skills, topic, angle) {
  return `You are a professional LinkedIn content writer.

Create content for a LinkedIn post that has a text caption AND an infographic image.

Role: ${role}
Skills: ${skills.join(', ')}
Topic: ${topic}
Angle for this post: ${angle}

Output ONLY this exact format:

TEXT:
[Write a 80-120 word professional LinkedIn caption here. One paragraph, no line breaks, emojis within text, 5-6 hashtags at end. No quotation marks.]

IMAGE:
TITLE: [strong 3-5 word title in uppercase style]

SECTION 1: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 2: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 3: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

SECTION 4: [short heading, no emoji]
• [bullet]
• [bullet]
• [bullet]

TAKEAWAY: [one-line insight]`;
}

// ── Content helpers ───────────────────────────────────────────────────────────

function parseList(value) {
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

function parseImageSection(raw) {
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const result = { title: '', sections: [], takeaway: '' };
  let currentSection = null;

  for (const line of lines) {
    if (/^TITLE:/i.test(line)) {
      result.title = line.replace(/^TITLE:\s*/i, '').trim();
    } else if (/^SECTION \d+:/i.test(line)) {
      currentSection = { heading: line.replace(/^SECTION \d+:\s*/i, '').trim(), bullets: [] };
      result.sections.push(currentSection);
    } else if (/^[•\-\*]/.test(line)) {
      if (currentSection) currentSection.bullets.push(line.slice(1).trim());
    } else if (/^TAKEAWAY:/i.test(line)) {
      result.takeaway = line.replace(/^TAKEAWAY:\s*/i, '').trim();
    }
  }

  return result;
}

function parsePostContent(postType, raw) {
  const content = raw.trim();

  if (postType === 1) {
    return { text: content, imageData: null };
  }

  if (postType === 2) {
    const imageData = parseImageSection(content);
    const text = [imageData.title, imageData.takeaway].filter(Boolean).join('\n\n');
    return { text, imageData };
  }

  // postType === 3 — split TEXT: and IMAGE: sections
  const textMatch = content.match(/TEXT:\s*\n([\s\S]+?)(?=\n\s*IMAGE:|$)/i);
  const imageMatch = content.match(/IMAGE:\s*\n([\s\S]+)/i);

  const text = textMatch ? textMatch[1].trim() : content;
  const imageData = imageMatch ? parseImageSection(imageMatch[1]) : null;
  return { text, imageData };
}

function nextPostType(current) {
  if (current === 1) return 2;
  if (current === 2) return 3;
  return 1;
}

// ── SVG Infographic Generator ─────────────────────────────────────────────────

function escapeXml(str) {
  return String(str || '')
    .replace(/[^ -￿]/g, '') // strip surrogate-pair emoji (not renderable in SVG)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (test.length <= maxChars) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word.length > maxChars ? word.slice(0, maxChars) : word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

// ── Layout 1: "Steps" — 4-column horizontal flow ─────────────────────────────
function layoutSteps(imageData) {
  const W = 1200, H = 628;
  const { title, sections, takeaway } = imageData;
  const FONT = 'Roboto,sans-serif';
  const COLORS = ['#0077b5', '#00875a', '#d97706', '#7c3aed'];
  const BG = '#fafaf8', DARK = '#1a1a1a', MUTED = '#555555';

  let e = '';
  e += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  e += `<rect width="${W}" height="8" fill="#0077b5"/>`;

  // Title
  const tLines = wrapText(escapeXml(title.toUpperCase()), 52).slice(0, 2);
  const tSize = tLines.length === 1 ? 52 : 44;
  const TITLE_Y = 44 + tSize;
  tLines.forEach((l, i) => {
    e += `<text x="${W/2}" y="${TITLE_Y + i*(tSize+6)}" font-family="${FONT}" font-size="${tSize}" font-weight="700" fill="${DARK}" text-anchor="middle">${l}</text>`;
  });
  const titleBottom = TITLE_Y + tLines.length * (tSize + 6) + 10;
  e += `<line x1="100" y1="${titleBottom}" x2="${W-100}" y2="${titleBottom}" stroke="#d0d0d0" stroke-width="1.5"/>`;

  // 4 columns
  const COL_Y = titleBottom + 20;
  const COL_H = H - COL_Y - 50;
  const CW = W / 4;
  sections.slice(0, 4).forEach((sec, i) => {
    const cx = i * CW;
    const color = COLORS[i];
    // Column bg tint on odd
    if (i % 2 === 1) e += `<rect x="${cx}" y="${COL_Y-10}" width="${CW}" height="${COL_H+30}" fill="${color}" fill-opacity="0.04"/>`;
    // Vertical divider
    if (i > 0) e += `<line x1="${cx}" y1="${COL_Y}" x2="${cx}" y2="${H-40}" stroke="#d0d0d0" stroke-width="1"/>`;
    // Big number
    e += `<text x="${cx+34}" y="${COL_Y+52}" font-family="${FONT}" font-size="56" font-weight="700" fill="${color}" fill-opacity="0.18">${i+1}</text>`;
    // Heading
    const hLines = wrapText(escapeXml(sec.heading), 22).slice(0, 2);
    let cy = COL_Y + 34;
    hLines.forEach((l, li) => {
      e += `<text x="${cx+28}" y="${cy + li*24}" font-family="${FONT}" font-size="18" font-weight="700" fill="${DARK}">${l}</text>`;
    });
    // Color underline
    cy += hLines.length * 24 + 6;
    e += `<rect x="${cx+28}" y="${cy}" width="48" height="3" rx="2" fill="${color}"/>`;
    cy += 16;
    // Bullets
    sec.bullets.slice(0, 4).forEach(b => {
      const bLines = wrapText(escapeXml(b), 24).slice(0, 2);
      e += `<circle cx="${cx+32}" cy="${cy-4}" r="3.5" fill="${color}"/>`;
      bLines.forEach((bl, li) => {
        e += `<text x="${cx+44}" y="${cy+li*20}" font-family="${FONT}" font-size="14.5" fill="${MUTED}">${bl}</text>`;
      });
      cy += bLines.length * 20 + 8;
    });
  });

  // Takeaway
  const tak = wrapText(escapeXml(takeaway), 95).slice(0, 1).join('');
  e += `<text x="${W/2}" y="${H-14}" font-family="${FONT}" font-size="12.5" fill="#999" text-anchor="middle" font-style="italic">${tak}</text>`;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${e}</svg>`;
}

// ── Layout 2: "Split Panel" — dark left title, structured right content ───────
function layoutSplit(imageData) {
  const W = 1200, H = 628;
  const { title, sections, takeaway } = imageData;
  const FONT = 'Roboto,sans-serif';
  const COLORS = ['#38bdf8', '#4ade80', '#fb923c', '#c084fc'];
  const LEFT_W = 360;

  let e = '';
  // Dark left panel
  e += `<rect width="${LEFT_W}" height="${H}" fill="#0f172a"/>`;
  // Blue accent border between panels
  e += `<rect x="${LEFT_W}" width="5" height="${H}" fill="#0077b5"/>`;
  // White right panel
  e += `<rect x="${LEFT_W+5}" width="${W-LEFT_W-5}" height="${H}" fill="#ffffff"/>`;
  // Top accent bar on right
  e += `<rect x="${LEFT_W+5}" y="0" width="${W-LEFT_W-5}" height="6" fill="#0077b5"/>`;

  // Left: vertical centered title
  const tLines = wrapText(escapeXml(title.toUpperCase()), 16).slice(0, 4);
  const tSize = tLines.length <= 2 ? 42 : 34;
  const totalTH = tLines.length * (tSize + 8);
  const startTY = (H - totalTH) / 2 + tSize;
  tLines.forEach((l, i) => {
    e += `<text x="${LEFT_W/2}" y="${startTY + i*(tSize+8)}" font-family="${FONT}" font-size="${tSize}" font-weight="700" fill="#ffffff" text-anchor="middle">${l}</text>`;
  });
  // Blue underline on left panel
  e += `<rect x="${LEFT_W/2-40}" y="${startTY + tLines.length*(tSize+8)+8}" width="80" height="4" rx="2" fill="#0077b5"/>`;
  // Takeaway on left bottom
  const takL = wrapText(escapeXml(takeaway), 20).slice(0, 2);
  takL.forEach((l, i) => {
    e += `<text x="${LEFT_W/2}" y="${H-30+i*18}" font-family="${FONT}" font-size="11.5" fill="#94a3b8" text-anchor="middle" font-style="italic">${l}</text>`;
  });

  // Right: 4 rows
  const RX = LEFT_W + 5 + 36;
  const ROW_H = (H - 6) / 4;
  sections.slice(0, 4).forEach((sec, i) => {
    const ry = 6 + i * ROW_H;
    const color = COLORS[i];
    if (i > 0) e += `<line x1="${LEFT_W+5}" y1="${ry}" x2="${W}" y2="${ry}" stroke="#f0f0f0" stroke-width="1"/>`;
    let cy = ry + 22;
    // Badge
    e += `<rect x="${RX}" y="${cy}" width="26" height="26" rx="5" fill="${color}"/>`;
    e += `<text x="${RX+13}" y="${cy+19}" font-family="${FONT}" font-size="14" font-weight="700" fill="#0f172a" text-anchor="middle">${i+1}</text>`;
    // Heading
    const hLines = wrapText(escapeXml(sec.heading), 28).slice(0, 2);
    hLines.forEach((l, li) => {
      e += `<text x="${RX+36}" y="${cy+18+li*22}" font-family="${FONT}" font-size="17" font-weight="700" fill="#1a1a1a">${l}</text>`;
    });
    cy += Math.max(28, hLines.length*22) + 8;
    // Bullets inline
    const bx = [RX, RX+270, RX+540];
    sec.bullets.slice(0, 3).forEach((b, bi) => {
      const bLine = wrapText(escapeXml(b), 24)[0];
      e += `<circle cx="${bx[bi]+5}" cy="${cy-4}" r="3" fill="${color}"/>`;
      e += `<text x="${bx[bi]+16}" y="${cy}" font-family="${FONT}" font-size="14" fill="#444444">${bLine}</text>`;
    });
  });
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${e}</svg>`;
}

// ── Layout 3: "Card Grid" — 2×2 cards with colored top border ────────────────
function layoutGrid(imageData) {
  const W = 1200, H = 628;
  const { title, sections, takeaway } = imageData;
  const FONT = 'Roboto,sans-serif';
  const COLORS = ['#0077b5', '#00875a', '#d97706', '#7c3aed'];
  const BG = '#f8f8f5', DARK = '#1a1a1a', TEXT = '#444444';

  let e = '';
  e += `<rect width="${W}" height="${H}" fill="${BG}"/>`;
  e += `<rect width="${W}" height="8" fill="#0077b5"/>`;

  // Title
  const tLines = wrapText(escapeXml(title.toUpperCase()), 40).slice(0, 2);
  const tSize = tLines.length === 1 ? 54 : 46;
  const TITLE_Y = 38 + tSize;
  tLines.forEach((l, i) => {
    e += `<text x="${W/2}" y="${TITLE_Y + i*(tSize+6)}" font-family="${FONT}" font-size="${tSize}" font-weight="700" fill="${DARK}" text-anchor="middle">${l}</text>`;
  });
  const divY = TITLE_Y + tLines.length*(tSize+6) + 12;
  e += `<line x1="80" y1="${divY}" x2="${W-80}" y2="${divY}" stroke="#d0d0d0" stroke-width="1.5"/>`;

  // 2x2 cards
  const GRID_TOP = divY + 14, GRID_BOTTOM = H - 36;
  const GH = GRID_BOTTOM - GRID_TOP, MX = W/2, MY = GRID_TOP + GH/2;
  const PAD = 30, CARD_R = 10;

  // Card backgrounds
  const cards = [
    { x: 60, y: GRID_TOP, w: MX-80, h: GH/2-8 },
    { x: MX+20, y: GRID_TOP, w: W-MX-80, h: GH/2-8 },
    { x: 60, y: MY+8, w: MX-80, h: GH/2-8 },
    { x: MX+20, y: MY+8, w: W-MX-80, h: GH/2-8 },
  ];
  cards.forEach(({ x, y, w, h }, i) => {
    const color = COLORS[i];
    e += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${CARD_R}" fill="#ffffff" filter="url(#shadow)"/>`;
    e += `<rect x="${x}" y="${y}" width="${w}" height="4" rx="${CARD_R}" fill="${color}"/>`;
  });

  // Section content
  sections.slice(0, 4).forEach((sec, i) => {
    const { x, y } = cards[i];
    const color = COLORS[i];
    const px = x + PAD, py = y + 20;
    let cy = py;
    // Heading
    const hLines = wrapText(escapeXml(sec.heading), 27).slice(0, 2);
    hLines.forEach((l, li) => {
      e += `<text x="${px}" y="${cy+li*23}" font-family="${FONT}" font-size="18" font-weight="700" fill="${DARK}">${l}</text>`;
    });
    cy += hLines.length * 23 + 10;
    // Bullets
    sec.bullets.slice(0, 3).forEach(b => {
      const bLines = wrapText(escapeXml(b), 30).slice(0, 2);
      e += `<circle cx="${px+5}" cy="${cy-5}" r="4" fill="${color}"/>`;
      bLines.forEach((bl, li) => {
        e += `<text x="${px+18}" y="${cy+li*21}" font-family="${FONT}" font-size="15" fill="${TEXT}">${bl}</text>`;
      });
      cy += bLines.length*21 + 7;
    });
  });

  // Takeaway
  const tak = wrapText(escapeXml(takeaway), 90).slice(0, 1).join('');
  e += `<text x="${W/2}" y="${H-12}" font-family="${FONT}" font-size="12.5" fill="#999" text-anchor="middle" font-style="italic">${tak}</text>`;
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${e}</svg>`;
}

function generateInfographicSVG(imageData) {
  const layouts = [layoutSteps, layoutSplit, layoutGrid];
  return layouts[Math.floor(Math.random() * layouts.length)](imageData);
}

async function generateInfographicPNG(imageData) {
  const { Resvg } = require('@resvg/resvg-js');
  const svg = generateInfographicSVG(imageData);

  const fontFiles = [FONT_REGULAR, FONT_BOLD].filter(fs.existsSync);

  const resvg = new Resvg(svg, {
    font: {
      loadSystemFonts: false,
      fontFiles,
      defaultFontFamily: 'Roboto',
    },
  });

  return Buffer.from(resvg.render().asPng());
}

// ── LinkedIn Image Upload ─────────────────────────────────────────────────────

async function uploadImageToLinkedIn(accessToken, personId, pngBuffer) {
  // Step 1: Register upload
  const regRes = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: `urn:li:person:${personId}`,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  });

  if (!regRes.ok) {
    const detail = await regRes.text().catch(() => '');
    throw new Error(`LinkedIn registerUpload ${regRes.status}: ${detail}`);
  }

  const regData = await regRes.json();
  const mech = regData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'];
  const uploadUrl = mech?.uploadUrl;
  const asset = regData.value?.asset;

  if (!uploadUrl || !asset) {
    throw new Error('LinkedIn registerUpload: missing uploadUrl or asset');
  }

  // Step 2: Upload PNG bytes (no Authorization header — URL is pre-signed)
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: pngBuffer,
  });

  if (!upRes.ok && upRes.status !== 201) {
    const detail = await upRes.text().catch(() => '');
    throw new Error(`LinkedIn image PUT ${upRes.status}: ${detail}`);
  }

  return asset; // e.g. "urn:li:digitalmediaAsset:XXXXXXXXXX"
}

// ── Gemini Content Generation ─────────────────────────────────────────────────

// Angles to rotate through so each post feels different
const POST_ANGLES = [
  'share a personal lesson learned',
  'give a practical how-to tip',
  'highlight a common mistake to avoid',
  'share an inspiring industry trend',
  'give a step-by-step beginner guide',
  'compare two approaches or tools',
  'share a surprising insight or statistic',
  'give an actionable career advice',
];

async function generateContent(postType, role, skills, topic) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured');
  const ai = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = ai.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const angle = POST_ANGLES[Math.floor(Math.random() * POST_ANGLES.length)];

  let prompt;
  if (postType === 1) prompt = buildTextPrompt(role, skills, topic, angle);
  else if (postType === 2) prompt = buildImagePrompt(role, topic, angle);
  else prompt = buildCombinedPrompt(role, skills, topic, angle);

  // Retry up to 2 times with backoff for transient 429 rate-limit errors
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      const response = await model.generateContent(prompt);
      return response.response.text();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const m = msg.toLowerCase();
      const isQuota = msg.includes('429') || m.includes('quota') || m.includes('too many') ||
        m.includes('exhausted') || m.includes('resource_exhausted');
      if (isQuota && attempt < 2) {
        await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
        continue;
      }
      throw err;
    }
  }
}

// ── LinkedIn Post Publisher ───────────────────────────────────────────────────

async function getLinkedInPersonId(accessToken) {
  const res = await fetch('https://api.linkedin.com/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn userinfo ${res.status}: ${detail}`);
  }
  const data = await res.json();
  const sub = data.sub || '';
  if (!sub) throw new Error('LinkedIn userinfo returned no sub claim');
  return sub;
}

async function publishToLinkedIn(accessToken, personId, text, imageAsset) {
  const shareContent = imageAsset
    ? {
        shareCommentary: { text },
        shareMediaCategory: 'IMAGE',
        media: [{ status: 'READY', media: imageAsset }],
      }
    : {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      };

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
      specificContent: { 'com.linkedin.ugc.ShareContent': shareContent },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`LinkedIn ugcPosts ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const postId = data.id || '';
  const postUrl = postId
    ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}/`
    : '';
  return { postId, postUrl };
}

// ── Main export ───────────────────────────────────────────────────────────────

async function runAutomation(userId) {
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

  if (profileErr || !profile) return { success: false, error: 'Profile not found' };
  if (!profile.linkedin_token) return { success: false, error: 'LinkedIn is not connected' };

  const role = typeof profile.role === 'string' ? profile.role.trim() : 'Professional';
  const skills = parseList(profile.skills);
  const topics = parseList(profile.topics);
  if (topics.length === 0) return { success: false, error: 'No topics configured in profile' };

  // 2. Fetch rotation state
  const { data: rotation } = await admin
    .from('automation_rotation')
    .select('current_step, post_type')
    .eq('user_id', userId)
    .maybeSingle();

  const currentStep = rotation?.current_step ?? 1;
  const postType = rotation?.post_type ?? 1;
  const topicIndex = (currentStep - 1) % topics.length;
  const topic = topics[topicIndex];
  const nextStep = (currentStep % topics.length) + 1;
  const nextType = nextPostType(postType);

  // 3. Generate content via Gemini
  const rawContent = await generateContent(postType, role, skills, topic);

  // 4. Parse into text caption + optional image data
  const { text, imageData } = parsePostContent(postType, rawContent);

  // 5. Get LinkedIn person ID
  const personId = await getLinkedInPersonId(profile.linkedin_token);

  // 6. Generate & upload infographic PNG if needed
  let imageAsset = null;
  if (imageData && imageData.title) {
    try {
      const pngBuffer = await generateInfographicPNG(imageData);
      imageAsset = await uploadImageToLinkedIn(profile.linkedin_token, personId, pngBuffer);
    } catch (imgErr) {
      console.error('[automation] Image generation/upload failed, posting text only:', imgErr.message);
      // Fall through and post text-only rather than failing entirely
    }
  }

  // 7. Publish post
  const { postId, postUrl } = await publishToLinkedIn(
    profile.linkedin_token,
    personId,
    text,
    imageAsset
  );

  // 8. Save post record
  await admin.from('posts').insert({
    user_id: userId,
    content: text,
    status: 'published',
    post_id: postId,
    post_url: postUrl,
    posted_at: new Date().toISOString(),
    topic,
    post_type: postType,
  });

  // 9. Advance rotation
  await admin
    .from('automation_rotation')
    .upsert(
      { user_id: userId, current_step: nextStep, post_type: nextType },
      { onConflict: 'user_id' }
    );

  console.log(`[automation] user=${userId} post_type=${postType} topic="${topic}" post_id=${postId} image=${!!imageAsset}`);
  return { success: true, topic, post_type: postType, post_id: postId, post_url: postUrl };
}

module.exports = { runAutomation };

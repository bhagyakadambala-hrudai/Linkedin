'use strict';

const { assertAllowedStorageUrl } = require('./storageUrlAllowlist.cjs');

const httpFetch =
  typeof fetch === 'function'
    ? (...args) => fetch(...args)
    : (...args) => require('node-fetch')(...args);

/** Only use env — never hardcode keys. */
function getOpenAiKey() {
  return process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim();
}

function normalizeProfile(parsed) {
  const role = String(parsed.role ?? '').trim();
  const skills = Array.isArray(parsed.skills)
    ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 10)
    : [];
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics.map((s) => String(s).trim()).filter(Boolean).slice(0, 5)
    : [];
  return { role, skills, topics };
}

/**
 * Safe parse for OpenAI chat content (markdown fences, extra prose — avoids JSON.parse "Unexpected token").
 */
function parseProfileJson(content) {
  const raw = String(content || '').trim();
  if (!raw) {
    return { role: '', skills: [], topics: [] };
  }

  console.log('RAW AI:', raw);

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let clean = raw
    .replace(/`json/gi, '')
    .replace(/`/g, '')
    .trim();
  let obj = tryParse(clean);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return normalizeProfile(obj);
  }

  clean = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/g, '')
    .trim();

  const fence = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    clean = fence[1].trim();
  }

  clean = clean.replace(/^[`]+|[`]+$/g, '').trim();

  obj = tryParse(clean);
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return normalizeProfile(obj);
  }

  const jsonMatch = clean.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    obj = tryParse(jsonMatch[0]);
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      return normalizeProfile(obj);
    }
  }

  console.error('Parse failed:', raw);
  console.error('Parsing failed (preview):', raw.slice(0, 400));
  return { role: '', skills: [], topics: [] };
}

function pathnameLower(fileUrl) {
  try {
    return new URL(fileUrl).pathname.toLowerCase();
  } catch {
    return String(fileUrl).split('?')[0].toLowerCase();
  }
}

function detectKind(fileUrl, contentType) {
  const pathOnly = pathnameLower(fileUrl);
  if (pathOnly.endsWith('.pdf')) return 'pdf';
  if (pathOnly.endsWith('.docx')) return 'docx';
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('pdf')) return 'pdf';
  if (ct.includes('wordprocessingml') || ct.includes('officedocument')) return 'docx';
  return 'unknown';
}

async function extractTextFromBuffer(buffer, kind) {
  if (kind === 'pdf') {
    const { PDFParse } = require('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const pdfData = await parser.getText();
      return String(pdfData.text || '').trim();
    } finally {
      await parser.destroy();
    }
  }
  if (kind === 'docx') {
    const mammoth = require('mammoth');
    const docxData = await mammoth.extractRawText({ buffer });
    return String(docxData.value || '').trim();
  }
  return '';
}

function emptyResult(extra) {
  return {
    success: false,
    role: '',
    skills: [],
    topics: [],
    ...extra,
  };
}

function openAiTimeoutMs() {
  const n = Number(process.env.OPENAI_FETCH_TIMEOUT_MS);
  if (Number.isFinite(n) && n > 0) return n;
  return 10000;
}

async function callOpenAIChat(extractedText, systemHint) {
  const apiKey = getOpenAiKey();
  console.log('OPENAI KEY EXISTS:', !!apiKey);

  if (!apiKey) {
    return { ok: false, error: 'OPENAI_API_KEY is not configured' };
  }

  const trimmedText = String(extractedText).slice(0, 8000);
  const userContent = `${systemHint || ''}
Extract:

* Role (single job title)
* Skills (top 10)
* Topics (5 domains)

STRICT:

* Return ONLY JSON
* No explanation
* No text outside JSON

Format:

{
"role": "string",
"skills": ["skill1"],
"topics": ["topic1"]
}

Resume:
${trimmedText}`;

  const timeoutMs = openAiTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let aiResponse;
  try {
    aiResponse = await httpFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: 'You are a strict JSON generator. Only output valid JSON.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const name = err && err.name;
    if (name === 'AbortError') {
      console.error('OpenAI request timed out after', timeoutMs, 'ms');
      return { ok: false, error: 'OpenAI request timed out' };
    }
    console.error('OpenAI fetch error:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'OpenAI request failed' };
  }
  clearTimeout(timeout);

  const aiData = await aiResponse.json().catch(() => ({}));
  if (!aiResponse.ok) {
    const msg = aiData?.error?.message || `OpenAI HTTP ${aiResponse.status}`;
    console.error('OpenAI API error:', msg, aiData?.error);
    return { ok: false, error: msg };
  }

  const raw = aiData?.choices?.[0]?.message?.content || '';
  if (!String(raw).trim()) {
    return { ok: false, error: 'Empty model response' };
  }

  const n = parseProfileJson(raw);
  if (!n.role || n.skills.length === 0) {
    console.error('AI returned empty result');
  }
  return { ok: true, role: n.role, skills: n.skills, topics: n.topics };
}

/** Retry when role or skills missing — topics alone is not enough for onboarding. */
function outputInsufficient(ai) {
  return (
    !String(ai.role || '').trim() ||
    !Array.isArray(ai.skills) ||
    ai.skills.length === 0
  );
}

/**
 * Download resume, extract PDF/DOCX text, call OpenAI. Never throws — returns structured result.
 */
async function analyzeResumeFromUrl(fileUrl) {
  try {
    console.log('OPENAI KEY EXISTS:', !!getOpenAiKey());

    const url = String(fileUrl || '').trim();
    if (!url) {
      return emptyResult();
    }

    console.log('File URL:', url);

    assertAllowedStorageUrl(url);

    const fileResponse = await httpFetch(url);
    if (!fileResponse.ok) {
      console.error('Resume download failed:', fileResponse.status);
      return emptyResult({ error: `Failed to download resume (${fileResponse.status})` });
    }

    const fileBuffer = Buffer.from(await fileResponse.arrayBuffer());
    const ct = fileResponse.headers.get('content-type') || '';
    const kind = detectKind(url, ct);

    if (kind === 'unknown') {
      return emptyResult({ error: 'Unsupported file type' });
    }

    let extractedText = await extractTextFromBuffer(fileBuffer, kind);
    console.log('Text length:', extractedText ? extractedText.length : 0);

    if (!extractedText || extractedText.length < 50) {
      return emptyResult({ error: 'Failed to extract text' });
    }

    console.log('Resume text extracted');

    let ai = await callOpenAIChat(extractedText, '');
    if (!ai.ok) {
      return emptyResult({ error: ai.error });
    }

    if (outputInsufficient(ai)) {
      const ai2 = await callOpenAIChat(
        extractedText,
        'The previous answer was empty or incomplete. Infer role (one job title), at least 5 skills, and topics from the resume text. '
      );
      if (!ai2.ok) {
        return emptyResult({ error: ai2.error });
      }
      ai = ai2;
    }

    if (outputInsufficient(ai)) {
      return emptyResult({ error: 'Could not extract role, skills, or topics' });
    }

    return {
      success: true,
      role: String(ai.role || '').trim(),
      skills: Array.isArray(ai.skills) ? ai.skills : [],
      topics: Array.isArray(ai.topics) ? ai.topics : [],
    };
  } catch (error) {
    console.error('API ERROR:', error);
    return emptyResult({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

/**
 * Plain-text resume → structured profile (OpenAI). Safe for serverless: no pdf-parse at module load.
 */
async function generateProfileFromPlainText(resumeText) {
  let ai = await callOpenAIChat(resumeText, '');
  if (!ai.ok) {
    throw new Error(ai.error || 'OpenAI profile generation failed');
  }
  if (outputInsufficient(ai)) {
    const ai2 = await callOpenAIChat(
      resumeText,
      'The previous answer was empty or incomplete. Infer role (one job title), at least 5 skills, and topics from the resume text. '
    );
    if (ai2.ok && !outputInsufficient(ai2)) {
      ai = ai2;
    }
  }
  if (outputInsufficient(ai)) {
    throw new Error('Could not extract role, skills, or topics from resume text');
  }
  return {
    role: String(ai.role || '').trim(),
    skills: Array.isArray(ai.skills) ? ai.skills : [],
    topics: Array.isArray(ai.topics) ? ai.topics : [],
  };
}

module.exports = {
  analyzeResumeFromUrl,
  parseProfileJson,
  generateProfileFromPlainText,
};

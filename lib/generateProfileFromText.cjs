'use strict';

/**
 * Text-only profile extraction for /api/generate-profile.
 * Does NOT load pdf-parse (avoids Vercel FUNCTION_INVOCATION_FAILED on cold start).
 *
 * Order: Gemini (if GEMINI_API_KEY or API_KEY starts with AIza) → OpenAI (OPENAI_API_KEY).
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { generateProfileFromPlainText } = require('./analyzeResumeOpenAI.cjs');

function parseJsonFromGeminiText(raw) {
  const text = String(raw || '');
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const slice = jsonMatch ? jsonMatch[0] : text;
  return JSON.parse(slice);
}

function geminiApiKey() {
  const g = process.env.GEMINI_API_KEY && String(process.env.GEMINI_API_KEY).trim();
  if (g) return g;
  const api = process.env.API_KEY && String(process.env.API_KEY).trim();
  if (api && api.startsWith('AIza')) return api;
  return '';
}

function geminiModelList() {
  const raw =
    process.env.GEMINI_MODEL ||
    'gemini-2.0-flash,gemini-1.5-flash,gemini-1.5-flash-latest,gemini-pro';
  return raw.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

async function generateWithGemini(resumeText, apiKey) {
  const ai = new GoogleGenerativeAI(apiKey);
  const prompt = `You are an expert recruiter and career coach. Read the resume text and return ONLY valid JSON (no markdown) with this exact shape:
{"role":"string — target or current job title","skills":["5-12 concise technical or professional skills"],"topics":["5-8 LinkedIn content themes this person could post about"]}

Resume text:
${String(resumeText).slice(0, 8000)}`;

  let lastErr;
  for (const modelName of geminiModelList()) {
    try {
      const model = ai.getGenerativeModel({ model: modelName });
      const response = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.35,
          topK: 40,
          topP: 0.95,
        },
      });
      const outText = response.response.text();
      let parsed;
      try {
        parsed = parseJsonFromGeminiText(outText);
      } catch (e) {
        console.error('[Gemini] JSON parse failed', modelName, String(outText || '').slice(0, 400));
        lastErr = e;
        continue;
      }
      const role = String(parsed.role || '').trim();
      const skills = Array.isArray(parsed.skills)
        ? parsed.skills.map((s) => String(s).trim()).filter(Boolean).slice(0, 15)
        : [];
      const topics = Array.isArray(parsed.topics)
        ? parsed.topics.map((s) => String(s).trim()).filter(Boolean).slice(0, 12)
        : [];
      return { role, skills, topics };
    } catch (e) {
      console.error('[Gemini] model failed', modelName, e instanceof Error ? e.message : e);
      lastErr = e;
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr || 'Gemini failed');
  throw new Error(msg);
}

async function generateProfileFromText(resumeText) {
  const trimmed = String(resumeText || '').trim();
  if (!trimmed) {
    throw new Error('Resume text is empty');
  }

  const gKey = geminiApiKey();
  if (gKey) {
    try {
      return await generateWithGemini(trimmed, gKey);
    } catch (e) {
      console.error('[generateProfileFromText] Gemini failed, falling back to OpenAI:', e);
    }
  }

  const openai =
    process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim();
  if (!openai) {
    throw new Error(
      'Configure OPENAI_API_KEY (recommended) or GEMINI_API_KEY on the server for resume AI.'
    );
  }

  return await generateProfileFromPlainText(trimmed);
}

module.exports = { generateProfileFromText };

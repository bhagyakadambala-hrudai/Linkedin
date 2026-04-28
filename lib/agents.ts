// AI pipeline helpers — client-side only (Gemini + Supabase profile reads). No Supabase Edge Functions.

import { parseResume } from './gemini';
import { supabase } from './supabase';
import type {
  ResumeParserInput,
  ResumeParserOutput,
  ResumeParserData,
  SkillsExtractorInput,
  SkillsExtractorOutput,
  ExperienceStructurerInput,
  ExperienceStructurerOutput,
  LinkedInValidatorInput,
  LinkedInValidatorOutput,
  TopicRecommenderInput,
  TopicRecommenderOutput,
} from './agent-types';

function emptyResumeData(): ResumeParserData {
  return {
    full_name: '',
    current_role: '',
    experience_level: 'mid',
    years_of_experience: 0,
    summary: '',
    raw_skills: [],
    education: [],
    work_history: [],
    certifications: [],
    industry: '',
    linkedin_headline_suggestion: '',
    portfolio_url: null,
    linkedin_url: null,
  };
}

function mapExperienceLevel(level: string | undefined): ResumeParserData['experience_level'] {
  const s = (level || '').toLowerCase();
  if (s.includes('exec') || s.includes('chief')) return 'executive';
  if (s.includes('lead') || s.includes('principal')) return 'lead';
  if (s.includes('senior') || s.includes('sr')) return 'senior';
  if (s.includes('entry') || s.includes('junior') || s.includes('intern')) return 'entry';
  return 'mid';
}

export async function invokeResumeParser(
  input: ResumeParserInput
): Promise<ResumeParserOutput> {
  try {
    const raw = await parseResume(input.resume_text);
    const skillsArr = Array.isArray(raw.skills)
      ? raw.skills
      : typeof raw.skills === 'string'
        ? [raw.skills]
        : [];
    const fallbackSkills = input.resume_text
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);

    const data: ResumeParserData = {
      ...emptyResumeData(),
      current_role: (raw.role as string) || 'Professional',
      experience_level: mapExperienceLevel(raw.experienceLevel as string | undefined),
      summary: (raw.summary as string) || '',
      raw_skills: skillsArr.length ? skillsArr : fallbackSkills,
      linkedin_headline_suggestion: raw.role
        ? `${raw.role} | Building impactful work`
        : '',
    };

    return { success: true, data };
  } catch {
    return {
      success: false,
      data: emptyResumeData(),
      error: 'Resume parsing failed. Please fill in details manually.',
    };
  }
}

export async function invokeSkillsExtractor(
  input: SkillsExtractorInput
): Promise<SkillsExtractorOutput> {
  const technical = [...(input.raw_skills || [])];
  return {
    success: true,
    data: {
      categorized_skills: {
        technical,
        domain: [],
        leadership: [],
        soft: [],
      },
      top_skills: technical.slice(0, 10),
      content_angle_skills: technical.slice(0, 5),
    },
  };
}

export async function invokeExperienceStructurer(
  input: ExperienceStructurerInput
): Promise<ExperienceStructurerOutput> {
  const wh = input.work_history || [];
  const summaryLine = wh.map((w) => `${w.title} at ${w.company}`).join('; ');
  return {
    success: true,
    data: {
      career_trajectory: wh.length ? `${input.current_role} career path` : 'Growing professional',
      industry_sectors: [],
      notable_achievements: [],
      content_authority_areas: input.current_role ? [input.current_role] : [],
      experience_summary: summaryLine || `${input.years_of_experience || 0}+ years experience`,
      seniority_score: 5,
      recommended_content_tone: 'practitioner',
      recommended_post_frequency: 3,
    },
  };
}

export async function invokeLinkedInValidator(
  input: LinkedInValidatorInput
): Promise<LinkedInValidatorOutput> {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('linkedin_connected, linkedin_profile_url, linkedin_token_expires_at')
      .eq('user_id', input.user_id)
      .maybeSingle();

    if (error) throw error;

    const connected = profile?.linkedin_connected === true;
    const expiresRaw = profile?.linkedin_token_expires_at ?? null;
    let expired = false;
    if (expiresRaw) {
      const t = new Date(String(expiresRaw)).getTime();
      expired = Number.isFinite(t) && t < Date.now();
    }
    const token_valid = connected && !expired;
    /** Only when they were connected but the stored token is past expiry — not "never connected". */
    const needs_reconnect = connected && expired;

    return {
      success: true,
      data: {
        is_connected: connected,
        token_valid,
        token_expires_at: expiresRaw != null ? String(expiresRaw) : null,
        profile_url: profile?.linkedin_profile_url ?? null,
        needs_reconnect,
      },
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Could not read LinkedIn status.';
    return {
      success: false,
      data: {
        is_connected: false,
        token_valid: false,
        token_expires_at: null,
        profile_url: null,
        needs_reconnect: false,
      },
      error: msg,
    };
  }
}

export async function invokeTopicRecommender(
  input: TopicRecommenderInput
): Promise<TopicRecommenderOutput> {
  const seeds = [
    ...input.top_skills,
    ...input.content_angle_skills,
    ...input.content_authority_areas,
  ].filter(Boolean);

  const suggested_topics = seeds.slice(0, 8).map((seed, i) => ({
    topic: `${seed} in context of ${input.current_role || 'your field'}`,
    relevance_score: Math.max(0.5, 0.9 - i * 0.05),
    trending: false,
    category: 'skill' as const,
    reasoning: 'Suggested from your profile (local, no cloud function).',
  }));

  return {
    success: true,
    data: {
      suggested_topics,
      topic_clusters: input.industry
        ? [{ cluster_name: input.industry, topics: input.top_skills.slice(0, 5) }]
        : [],
    },
  };
}

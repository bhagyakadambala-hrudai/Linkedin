import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Upload, Briefcase, Code2, TrendingUp, Linkedin,
  Loader2, CheckCircle2, AlertCircle, ShieldCheck, Zap, Save,
} from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Layout } from '../components/Layout';
import { AccordionSection, SectionStatus } from '../components/ui/AccordionSection';
import { CircularProgress } from '../components/ui/CircularProgress';
import { FileUploadZone } from '../components/ui/FileUploadZone';
import { SkillPillInput } from '../components/ui/SkillPillInput';
import { TopicSelector } from '../components/ui/TopicSelector';
import { SkeletonLoader } from '../components/ui/SkeletonLoader';
import { AIInsightsPanel } from '../components/AIInsightsPanel';
import { useAgentPipeline } from '../hooks/useAgentPipeline';
import { useResumeExtractor } from '../hooks/useResumeExtractor';
import { useAutoSave } from '../hooks/useAutoSave';
import { updateProfile, uploadResumeToStorage, syncSchedules, startAgent, getSupabaseSettings } from '../lib/api';
import {
  isProfileComplete,
  isResumeProfileFilled,
  parseStoredResumeData,
} from '../lib/profileCompletion';
import { generateTopics } from '../lib/onboardingTopics';
import { inferProfileFromPlainText } from '../lib/resumeTextHeuristics';
import { getOnboardingDraft, clearOnboardingDraft } from '../lib/store';
import { supabase } from '../lib/supabase';
import { ProfileSetupData } from '../types';
import type { SuggestedTopic, ExperienceStructurerData } from '../lib/agent-types';

// --- Constants ---
const TARGET_AUDIENCE_OPTIONS = [
  'Hiring Managers', 'Fellow Engineers', 'Startup Founders',
  'Tech Leads', 'Career Changers', 'Recruiters', 'C-suite Executives',
];

const CONTENT_GOAL_OPTIONS = [
  'Build Thought Leadership', 'Attract Job Offers', 'Grow Network',
  'Share Knowledge', 'Promote My Business', 'Industry Influence',
];

/** Vercel/server errors often return HTML; `response.json()` then throws a confusing parse error. */
async function readApiJson<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  if (!text?.trim()) {
    throw new Error(`${label}: empty response (HTTP ${res.status})`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const hint = text.slice(0, 180).replace(/\s+/g, ' ').trim();
    throw new Error(
      `${label}: server returned non-JSON (HTTP ${res.status}). ${hint || 'No body'}`
    );
  }
}

const TONE_OPTIONS = [
  'Professional & Insightful', 'Casual & Conversational',
  'Bold & Opinionated', 'Educational & Helpful', 'Inspirational & Motivational',
];

/** Matches API + DB: arrays, comma-separated strings, JSON string arrays. */
function normalizeStringList(value: unknown): string[] {
  if (value == null) return [];
  const flattenCsv = (arr: string[]): string[] => {
    const out: string[] = [];
    for (const x of arr) {
      const p = x.split(/,\s*/).map((t) => t.trim()).filter(Boolean);
      out.push(...p);
    }
    return out;
  };
  if (Array.isArray(value)) {
    return flattenCsv(value.map((x) => String(x ?? '').trim()).filter(Boolean));
  }
  const s = String(value).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const j = JSON.parse(s) as unknown;
      if (Array.isArray(j)) {
        return flattenCsv(j.map((x) => String(x ?? '').trim()).filter(Boolean));
      }
    } catch {
      /* fall through */
    }
  }
  return s.split(/,\s*/).map((t) => t.trim()).filter(Boolean);
}

function experienceInsightsAreMeaningful(data: ExperienceStructurerData): boolean {
  if ((data.experience_summary ?? '').trim()) return true;
  if ((data.career_trajectory ?? '').trim()) return true;
  if (normalizeStringList(data.content_authority_areas).length > 0) return true;
  if (normalizeStringList(data.industry_sectors).length > 0) return true;
  if (normalizeStringList(data.notable_achievements).length > 0) return true;
  return false;
}

const INITIAL_FORM_DATA: ProfileSetupData = {
  resumeUploaded: false,
  resumeUrl: '',
  role: '',
  skills: [],
  topics: [],
  linkedInConnected: false,
  company_name: '',
  headline: '',
  target_audience: [],
  content_goals: [],
  preferred_tone: '',
  notable_achievements: '',
  schedule: [
    { day: 'Monday', time: '09:00' },
    { day: 'Wednesday', time: '09:00' },
    { day: 'Friday', time: '10:00' },
  ],
};

// --- Section IDs ---
type SectionId = 'resume' | 'designation' | 'skills' | 'topics' | 'linkedin';

const SECTIONS: { id: SectionId; title: string; required: boolean }[] = [
  { id: 'resume', title: 'Upload Resume', required: true },
  { id: 'designation', title: 'Target Designation', required: true },
  { id: 'skills', title: 'Skills & Expertise', required: true },
  { id: 'topics', title: 'Topics', required: true },
  { id: 'linkedin', title: 'Connect LinkedIn', required: true },
];

const ROLE_MANUAL_PLACEHOLDER = 'Enter your role';
const SKILLS_MANUAL_PLACEHOLDER = 'Enter your skills — type a skill and press Enter';

function buildFormStateFromProfile(
  existing: Awaited<ReturnType<typeof getSupabaseSettings>>
): ProfileSetupData {
  const resumeInfo = parseStoredResumeData(existing.resume_data);
  const urlFromColumn = (existing as { resume_url?: string }).resume_url?.trim() ?? '';
  const effectiveResumeUrl = resumeInfo?.resumeUrl ?? urlFromColumn;
  return {
    ...INITIAL_FORM_DATA,
    resumeUploaded: !!(resumeInfo || effectiveResumeUrl),
    resumeUrl: effectiveResumeUrl,
    role: (existing.role ?? '').trim(),
    skills: normalizeStringList(existing.skills),
    topics: normalizeStringList(existing.topics),
    linkedInConnected: existing.linkedInConnected === true,
    schedule: INITIAL_FORM_DATA.schedule,
  };
}

/** Fill gaps from local draft only when DB did not already provide that slice. */
function mergeDraftPreferringDb(base: ProfileSetupData, draft: ProfileSetupData): ProfileSetupData {
  return {
    ...base,
    role: base.role || (draft.role ?? '').trim() || '',
    skills: base.skills.length ? base.skills : normalizeStringList(draft.skills),
    topics: base.topics.length ? base.topics : normalizeStringList(draft.topics),
    resumeUploaded: base.resumeUploaded || !!draft.resumeUploaded,
    resumeUrl: base.resumeUrl || (draft.resumeUrl ?? '').trim() || '',
    linkedInConnected: base.linkedInConnected || !!draft.linkedInConnected,
    company_name: base.company_name || draft.company_name || '',
    headline: base.headline || draft.headline || '',
    target_audience: base.target_audience.length ? base.target_audience : draft.target_audience ?? [],
    content_goals: base.content_goals.length ? base.content_goals : draft.content_goals ?? [],
    preferred_tone: base.preferred_tone || draft.preferred_tone || '',
    notable_achievements: base.notable_achievements || draft.notable_achievements || '',
    schedule: draft.schedule?.length ? draft.schedule : base.schedule,
  };
}

type AiGeneratedFlags = { role: boolean; skills: boolean; topics: boolean };

export const Onboarding: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  // --- Form state ---
  const [formData, setFormData] = useState<ProfileSetupData>(INITIAL_FORM_DATA);
  const [error, setError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);

  // --- Accordion state ---
  const [openSections, setOpenSections] = useState<Set<SectionId>>(new Set(['resume']));

  // --- Upload state ---
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'analyzing' | 'complete' | 'error'>('idle');
  const [uploadStatusText, setUploadStatusText] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');

  // --- AI state ---
  const [suggestedTopics, setSuggestedTopics] = useState<SuggestedTopic[]>([]);
  /** Template topic prompts from role + skills (not from the topic LLM). */
  const [heuristicTopicStrings, setHeuristicTopicStrings] = useState<string[]>([]);
  const [experienceData, setExperienceData] = useState<ExperienceStructurerData | null>(null);
  const [resumeIndustry, setResumeIndustry] = useState('');

  /** True only when the latest successful agent run filled the field (hidden after user edits). */
  const [aiGenerated, setAiGenerated] = useState<AiGeneratedFlags>({
    role: false,
    skills: false,
    topics: false,
  });

  // --- Re-fetch profile after save so UI updates immediately ---
  const refetchProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user?.id) return;
    const existing = await getSupabaseSettings(user.id);
    if (isProfileComplete(existing)) {
      navigate('/app/dashboard', { replace: true });
      return;
    }
    const resumeInfo = parseStoredResumeData(existing.resume_data);
    const urlFromColumn = (existing as { resume_url?: string }).resume_url?.trim() ?? '';
    setAiGenerated({ role: false, skills: false, topics: false });
    setSuggestedTopics([]);
    const refetchRole = (existing.role ?? '').trim();
    const refetchSkills = normalizeStringList(existing.skills);
    const refetchTopics = normalizeStringList(existing.topics);
    const heurRestore = generateTopics(refetchRole, refetchSkills);
    setHeuristicTopicStrings(
      heurRestore.length > 0 && refetchTopics.some(t => heurRestore.includes(t))
        ? heurRestore
        : []
    );
    setFormData(prev => ({
      ...prev,
      role: refetchRole || '',
      skills: refetchSkills,
      topics: refetchTopics,
      linkedInConnected: existing.linkedInConnected === true || prev.linkedInConnected,
      resumeUploaded: !!resumeInfo?.resumeUrl || !!urlFromColumn || prev.resumeUploaded,
      resumeUrl: (resumeInfo?.resumeUrl?.trim() || urlFromColumn || prev.resumeUrl || '').trim(),
    }));
    const effectiveResume = resumeInfo?.resumeUrl?.trim() || urlFromColumn;
    if (effectiveResume) {
      const name = resumeInfo?.fileName || effectiveResume.split('/').pop();
      if (name) setUploadedFileName(name);
      setUploadStatus('complete');
    }
  }, [navigate]);

  // --- Hooks ---
  const { checkLinkedIn, agentStates, results, isProcessing } = useAgentPipeline();
  const { extractText, isExtracting } = useResumeExtractor();
  const { saveStatus, saveNow } = useAutoSave(formData, refetchProfile, {
    enabled: !bootstrapping,
  });

  // --- Refs ---
  const sectionRefs = useRef<Record<SectionId, HTMLDivElement | null>>({
    resume: null, designation: null, skills: null,
    topics: null, linkedin: null,
  });

  // --- Hydrate from Supabase on mount / when returning to this route; skip if onboarding already done ---
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setBootstrapping(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!user?.id) return;

        const existing = await getSupabaseSettings(user.id);
        if (isProfileComplete(existing)) {
          navigate('/app/dashboard', { replace: true });
          return;
        }

        const base = buildFormStateFromProfile(existing);
        const draft = getOnboardingDraft();
        const merged = draft ? mergeDraftPreferringDb(base, draft) : base;

        if (cancelled) return;
        setAiGenerated({ role: false, skills: false, topics: false });
        setFormData(merged);

        const resumeInfoForOpen = parseStoredResumeData(existing.resume_data);
        setOpenSections(() => {
          const next = new Set<SectionId>();
          if (!resumeInfoForOpen && !merged.resumeUploaded) next.add('resume');
          if (!(merged.role ?? '').trim()) next.add('designation');
          if (merged.skills.length === 0) next.add('skills');
          if (merged.topics.length === 0) next.add('topics');
          if (!merged.linkedInConnected) next.add('linkedin');
          return next;
        });

        const resumeInfo = parseStoredResumeData(existing.resume_data);
        if (resumeInfo?.resumeUrl || merged.resumeUploaded) {
          setUploadStatus('complete');
          const fn = resumeInfo?.fileName || merged.resumeUrl.split('/').pop() || '';
          if (fn) setUploadedFileName(fn);
        }

        const queryString =
          window.location.search ||
          (window.location.hash.includes('?') ? window.location.hash.split('?')[1] || '' : '');
        const searchParams = new URLSearchParams(queryString);
        if (searchParams.get('linkedin') === 'connected') {
          await refetchProfile();
          if (!cancelled) {
            window.history.replaceState(
              {},
              '',
              window.location.pathname + window.location.search + '#/app/profile-setup'
            );
          }
        }

        checkLinkedIn().then(linkedinData => {
          if (cancelled) return;
          if (linkedinData?.is_connected) {
            setFormData(prev => ({ ...prev, linkedInConnected: true }));
          }
        });
      } catch {
        console.warn('Failed to load existing profile data');
      } finally {
        if (!cancelled) setBootstrapping(false);
      }

      if (cancelled) return;

      const hash = window.location.hash;
      const queryStart = hash.indexOf('?');
      const urlParams =
        queryStart !== -1
          ? new URLSearchParams(hash.substring(queryStart + 1))
          : new URLSearchParams(window.location.search);

      if (
        urlParams.get('linkedin') === 'connected' ||
        urlParams.get('linkedin_connected') === 'true' ||
        urlParams.get('success') === 'true'
      ) {
        setFormData(prev => ({ ...prev, linkedInConnected: true }));
        void (async () => {
          const { data: { session } } = await supabase.auth.getSession();
          const user = session?.user;
          if (!user?.id) return;
          const existing = await getSupabaseSettings(user.id);
          if (existing.linkedInConnected === true) {
            setFormData(prev => ({ ...prev, linkedInConnected: true }));
          }
        })();
        localStorage.removeItem('li_return_path');
        localStorage.removeItem('li_auth_state');
        localStorage.removeItem('li_oauth_pending');
        const cleanHash = hash.split('?')[0];
        window.history.replaceState({}, '', window.location.pathname + cleanHash);
      }

      if (urlParams.get('error')) {
        const errorMsg = urlParams.get('msg') || 'Failed to connect LinkedIn';
        setError(decodeURIComponent(errorMsg));
        setTimeout(() => {
          const cleanHash = hash.split('?')[0];
          window.history.replaceState({}, '', window.location.pathname + cleanHash);
        }, 100);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate, refetchProfile, checkLinkedIn]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setFormData(INITIAL_FORM_DATA);
        setBootstrapping(false);
        setError(null);
        setSuggestedTopics([]);
        setHeuristicTopicStrings([]);
        setExperienceData(null);
        setResumeIndustry('');
        setAiGenerated({ role: false, skills: false, topics: false });
        setUploadProgress(0);
        setUploadStatus('idle');
        setUploadStatusText('');
        setUploadedFileName('');
        setOpenSections(new Set(['resume']));
        return;
      }
      if (event === 'SIGNED_IN' && session?.user?.id) {
        void refetchProfile();
      }
    });
    return () => subscription.unsubscribe();
  }, [refetchProfile]);

  // --- Update form from pipeline results (only after successful agent runs — failures ship placeholder data) ---
  useEffect(() => {
    if (!results.resumeParser || agentStates['resume-parser'].status !== 'complete') return;

    const rp = results.resumeParser;
    const aiRole = (rp.current_role ?? '').trim();

    setFormData(prev => ({
      ...prev,
      role: aiRole || prev.role,
      headline: (rp.linkedin_headline_suggestion ?? '').trim() || prev.headline,
      company_name: (rp.work_history?.[0]?.company ?? '').trim() || prev.company_name,
      ...(rp.linkedin_url && !prev.linkedInConnected ? { linkedInProfileUrl: rp.linkedin_url } : {}),
    }));
    setResumeIndustry((rp.industry ?? '').trim());
    setAiGenerated(prev => ({ ...prev, role: aiRole.length > 0 }));
  }, [results.resumeParser, agentStates['resume-parser'].status]);

  useEffect(() => {
    if (!results.skillsExtractor || agentStates['skills-extractor'].status !== 'complete') return;

    const top = normalizeStringList(results.skillsExtractor.top_skills);
    setFormData(prev => ({
      ...prev,
      skills: top.length > 0 ? top : prev.skills,
    }));
    setAiGenerated(prev => ({ ...prev, skills: top.length > 0 }));
  }, [results.skillsExtractor, agentStates['skills-extractor'].status]);

  useEffect(() => {
    const st = agentStates['experience-structurer'].status;

    if (!results.experienceStructurer) {
      if (st === 'error' || (st === 'idle' && !isProcessing)) {
        setExperienceData(null);
      }
      return;
    }

    if (st !== 'complete') {
      if (st === 'error') setExperienceData(null);
      return;
    }

    const exp = results.experienceStructurer;
    setExperienceData(exp);
    const achievements = normalizeStringList(exp.notable_achievements);
    setFormData(prev => ({
      ...prev,
      preferred_tone: exp.recommended_content_tone || prev.preferred_tone,
      notable_achievements: achievements.length > 0 ? achievements.join('\n') : prev.notable_achievements,
    }));
  }, [results.experienceStructurer, agentStates['experience-structurer'].status, isProcessing]);

  useEffect(() => {
    const trStatus = agentStates['topic-recommender'].status;

    if (trStatus === 'error') {
      setSuggestedTopics([]);
      const role = (results.resumeParser?.current_role ?? '').trim();
      const skills = normalizeStringList(results.skillsExtractor?.top_skills ?? []);
      const heur = generateTopics(role, skills);
      setHeuristicTopicStrings(heur);
      setFormData(prev => {
        if (prev.topics.length > 0) return prev;
        if (heur.length === 0) return prev;
        return { ...prev, topics: heur.slice(0, 5) };
      });
      setAiGenerated(prev => ({ ...prev, topics: false }));
      return;
    }

    if (!results.topicRecommender || trStatus !== 'complete') return;

    const valid = (results.topicRecommender.suggested_topics ?? []).filter(t => (t?.topic ?? '').trim());
    setSuggestedTopics(valid);

    const topThree = [...valid]
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, 3)
      .map(t => t.topic.trim())
      .filter(Boolean);

    const role = (results.resumeParser?.current_role ?? '').trim();
    const skills = normalizeStringList(results.skillsExtractor?.top_skills ?? []);
    const heur = generateTopics(role, skills);

    if (topThree.length > 0) {
      setHeuristicTopicStrings([]);
      setFormData(prev =>
        prev.topics.length > 0 ? prev : { ...prev, topics: topThree }
      );
      setAiGenerated(prev => ({ ...prev, topics: true }));
      return;
    }

    setHeuristicTopicStrings(heur);
    setFormData(prev => {
      if (prev.topics.length > 0) return prev;
      if (heur.length === 0) return { ...prev, topics: [] };
      return { ...prev, topics: heur.slice(0, 5) };
    });
    setAiGenerated(prev => ({ ...prev, topics: false }));
  }, [
    results.topicRecommender,
    results.resumeParser,
    results.skillsExtractor,
    agentStates['topic-recommender'].status,
  ]);

  useEffect(() => {
    if (results.linkedinValidator) {
      // DB is the source of truth — ONLY promote to connected, never reset it.
      // If the validator says connected + valid, reflect that. If not, leave the DB value alone.
      if (results.linkedinValidator.is_connected && results.linkedinValidator.token_valid) {
        setFormData(prev => ({ ...prev, linkedInConnected: true }));
      }
    }
  }, [results.linkedinValidator]);

  // --- Section helpers ---
  const toggleSection = useCallback((id: SectionId) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const openSection = useCallback((id: SectionId) => {
    setOpenSections(prev => new Set(prev).add(id));
    setTimeout(() => {
      sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }, []);

  // --- Section status ---
  const getSectionStatus = useCallback((id: SectionId): SectionStatus => {
    switch (id) {
      case 'resume':
        if (uploadStatus === 'complete') return 'complete';
        if (uploadStatus === 'uploading' || uploadStatus === 'analyzing') return 'active';
        return 'pending';
      case 'designation':
        if (agentStates['resume-parser'].status === 'running') return 'active';
        if (!formData.role.trim()) return 'pending';
        return aiGenerated.role ? 'ai-filled' : 'complete';
      case 'skills':
        if (agentStates['skills-extractor'].status === 'running') return 'active';
        if (formData.skills.length < 1) return 'pending';
        return aiGenerated.skills ? 'ai-filled' : 'complete';
      case 'topics':
        if (agentStates['topic-recommender'].status === 'running') return 'active';
        if (formData.topics.length < 1) return 'pending';
        return aiGenerated.topics ? 'ai-filled' : 'complete';
      case 'linkedin':
        if (agentStates['linkedin-validator'].status === 'running') return 'active';
        if (formData.linkedInConnected && !results.linkedinValidator?.needs_reconnect) {
          return 'complete';
        }
        return 'pending';
      default:
        return 'pending';
    }
  }, [formData, uploadStatus, agentStates, aiGenerated, results.linkedinValidator]);

  const getSectionSummary = useCallback((id: SectionId): string => {
    switch (id) {
      case 'resume': return uploadedFileName || 'Resume uploaded';
      case 'designation': return formData.role || '';
      case 'skills': return `${formData.skills.length} skills`;
      case 'topics': return `${formData.topics.length} topics selected`;
      case 'linkedin':
        if (results.linkedinValidator?.needs_reconnect) return 'Reconnect';
        return formData.linkedInConnected ? 'Connected' : '';
      default: return '';
    }
  }, [formData, uploadedFileName, results.linkedinValidator?.needs_reconnect]);

  // --- Completeness ---
  const completedCount = SECTIONS.filter(s => {
    const status = getSectionStatus(s.id);
    return status === 'complete' || status === 'ai-filled';
  }).length;

  const requiredComplete = SECTIONS.filter(s => s.required).every(s => {
    const status = getSectionStatus(s.id);
    return status === 'complete' || status === 'ai-filled';
  });

  // --- File upload handler ---
  const handleFileUpload = async (file: File) => {
    setError(null);
    setSuggestedTopics([]);
    setHeuristicTopicStrings([]);
    setExperienceData(null);
    setUploadStatus('uploading');
    setUploadedFileName(file.name);
    setUploadProgress(0);
    setUploadStatusText('Uploading resume...');

    /** Plain text from server/client parse — used for heuristic fill if AI omits fields. */
    let extractedPlainText = '';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setUploadStatus('error');
        setError('User not logged in');
        return;
      }
      const user = session.user;
      if (!user?.id) {
        setUploadStatus('error');
        setError('Please sign in to upload your resume.');
        return;
      }
      if (!session.access_token) {
        setUploadStatus('error');
        setError('Session expired. Please sign in again.');
        return;
      }
      const userId = user.id;

      const publicUrl = await uploadResumeToStorage(file, userId, (p) => {
        setUploadProgress(Math.min(p, 35));
      });

      setUploadProgress(40);
      setUploadStatus('analyzing');
      setUploadStatusText('Analyzing your resume with AI...');

      setFormData(prev => ({
        ...prev,
        resumeUploaded: true,
        resumeUrl: publicUrl,
      }));

      setTimeout(() => openSection('designation'), 200);
      setTimeout(() => openSection('skills'), 400);
      setTimeout(() => openSection('topics'), 600);

      type AnalyzeOk = {
        success?: boolean;
        role?: string;
        skills?: string[];
        topics?: string[];
        resume_url?: string;
        error?: string;
      };

      const analyzeRes = await fetch('/api/analyze-resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileUrl: publicUrl }),
      });

      let data: AnalyzeOk = {
        success: false,
        role: '',
        skills: [],
        topics: [],
      };
      try {
        data = await readApiJson<AnalyzeOk>(analyzeRes, 'analyze-resume');
      } catch (e) {
        console.warn('analyze-resume response unusable:', e);
      }

      if (data.success) {
        setError(null);
        const aiRole = String(data.role ?? '').trim();
        const aiSkills = normalizeStringList(data.skills);
        const aiTopics = normalizeStringList(data.topics);
        setFormData(prev => ({
          ...prev,
          role: aiRole || prev.role,
          skills: aiSkills.length ? aiSkills : prev.skills,
          topics: aiTopics.length ? aiTopics : prev.topics,
          headline: aiRole ? `${aiRole} | Building impactful work` : prev.headline,
        }));
        try {
          await updateProfile(userId, {
            ...(aiRole ? { role: aiRole } : {}),
            ...(aiSkills.length ? { skills: aiSkills } : {}),
            ...(aiTopics.length ? { topics: aiTopics } : {}),
            resume_url: publicUrl,
            resume_data: {
              resumeUrl: publicUrl,
              fileName: file.name,
              ...(aiRole ? { role: aiRole } : {}),
              ...(aiSkills.length ? { skills: aiSkills } : {}),
              ...(aiTopics.length ? { topics: aiTopics } : {}),
            },
          });
        } catch (persistErr) {
          console.warn('Persist profile after analyze-resume:', persistErr);
        }
      }

      let analyzeJson = data;

      if (!analyzeJson.success) {
        console.warn('analyze-resume failed, falling back to parse + generate:', analyzeJson.error);
        setUploadStatusText('Reading your resume...');
        let text = '';
        try {
          const parseRes = await fetch('/api/parse-resume', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileUrl: publicUrl }),
          });
          const parseJson = await readApiJson<{ text?: string; error?: string }>(
            parseRes,
            'parse-resume'
          );
          if (!parseRes.ok) {
            throw new Error(parseJson.error || `parse-resume failed (${parseRes.status})`);
          }
          text = (parseJson.text ?? '').trim();
        } catch (parseErr) {
          console.warn('Server parse-resume failed, trying client-side extraction:', parseErr);
          setUploadStatusText('Extracting text in browser...');
          text = (await extractText(file)).trim();
        }
        if (text.length < 50) {
          throw new Error(analyzeJson.error || 'Could not extract enough text from this file. Try another PDF/DOCX or fill fields manually.');
        }
        extractedPlainText = text;
        setUploadProgress(65);
        setUploadStatusText('Generating profile with AI...');
        try {
          const aiResponse = await fetch('/api/generate-profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const profileData = await readApiJson<{
            role?: string;
            skills?: string[];
            topics?: string[];
            error?: string;
          }>(aiResponse, 'generate-profile');
          if (!aiResponse.ok) {
            throw new Error(
              profileData.error || analyzeJson.error || `generate-profile failed (${aiResponse.status})`
            );
          }

          analyzeJson = {
            success: true,
            role: profileData.role,
            skills: profileData.skills,
            topics: profileData.topics,
            resume_url: publicUrl,
          };
          const fbRole = String(profileData.role ?? '').trim();
          const fbSkills = normalizeStringList(profileData.skills);
          const fbTopics = normalizeStringList(profileData.topics);
          await updateProfile(userId, {
            ...(fbRole ? { role: fbRole } : {}),
            ...(fbSkills.length ? { skills: fbSkills } : {}),
            ...(fbTopics.length ? { topics: fbTopics } : {}),
            resume_url: publicUrl,
            resume_data: {
              resumeUrl: publicUrl,
              fileName: file.name,
              ...(fbRole ? { role: fbRole } : {}),
              ...(fbSkills.length ? { skills: fbSkills } : {}),
              ...(fbTopics.length ? { topics: fbTopics } : {}),
            },
          });
          setError(null);
        } catch (genErr: unknown) {
          const msg = genErr instanceof Error ? genErr.message : 'Profile AI unavailable.';
          console.warn('generate-profile failed; continuing with extracted text heuristics:', genErr);
          setUploadStatusText('AI profile step skipped — fill role & skills below (text was extracted).');
          analyzeJson = { success: false, role: '', skills: [], topics: [], resume_url: publicUrl };
          try {
            await updateProfile(userId, {
              resume_url: publicUrl,
              resume_data: {
                resumeUrl: publicUrl,
                fileName: file.name,
                extractionNote: 'ai_profile_failed',
              },
            });
          } catch (persistFallbackErr) {
            console.warn('Persist after generate-profile failure:', persistFallbackErr);
          }
          setError(null);
        }
      }

      let finalRole = (analyzeJson.role ?? '').trim();
      let topSkills = normalizeStringList(analyzeJson.skills);
      let topicList = normalizeStringList(analyzeJson.topics);

      if (topSkills.length === 0 && finalRole) {
        topSkills = normalizeStringList(finalRole.split(/[\s,]+/).filter(Boolean).slice(0, 5));
      }

      if (!finalRole && topSkills.length > 0) {
        finalRole = `${topSkills[0]} Professional`;
      }

      let plainForHeuristic = extractedPlainText;
      if ((!finalRole || topSkills.length < 1) && plainForHeuristic.length < 50) {
        try {
          const local = (await extractText(file)).trim();
          if (local.length >= 50) plainForHeuristic = local;
        } catch {
          /* ignore */
        }
      }

      let filledByHeuristic = false;
      if (plainForHeuristic.length >= 50 && (!finalRole || topSkills.length < 1)) {
        const guessed = inferProfileFromPlainText(plainForHeuristic);
        const hadRole = !!(finalRole ?? '').trim();
        const hadSkills = topSkills.length >= 1;
        if (!hadRole && guessed.role) {
          finalRole = guessed.role;
          filledByHeuristic = true;
        }
        if (!hadSkills && guessed.skills.length) {
          topSkills = guessed.skills;
          filledByHeuristic = true;
        }
      }

      if (!finalRole && topSkills.length > 0) {
        finalRole = `${topSkills[0]} Professional`;
      }

      let heuristicStrings: string[] = [];
      if (topicList.length === 0) {
        const heur = generateTopics(finalRole, topSkills);
        if (heur.length > 0) {
          topicList = heur.slice(0, 5);
          heuristicStrings = heur;
        }
      }

      if (filledByHeuristic && (finalRole || topSkills.length || topicList.length)) {
        try {
          await updateProfile(userId, {
            ...((finalRole ?? '').trim() ? { role: (finalRole ?? '').trim() } : {}),
            ...(topSkills.length ? { skills: topSkills } : {}),
            ...(topicList.length ? { topics: topicList } : {}),
            resume_url: publicUrl,
            resume_data: {
              resumeUrl: publicUrl,
              fileName: file.name,
              source: 'text_heuristic',
              role: (finalRole ?? '').trim() || undefined,
              skills: topSkills,
              topics: topicList,
            },
          });
        } catch (persistHeur) {
          console.warn('Persist heuristic profile:', persistHeur);
        }
      }

      const aiTopicRows: SuggestedTopic[] = topicList.map((topic, i) => ({
        topic,
        relevance_score: Math.max(0.5, 0.95 - i * 0.05),
        trending: false,
        category: 'skill',
        reasoning: 'Suggested from your resume',
      }));

      setSuggestedTopics(aiTopicRows.filter(t => t.topic.trim()));
      setHeuristicTopicStrings(heuristicStrings);

      setFormData(prev => ({
        ...prev,
        resumeUploaded: true,
        resumeUrl: publicUrl,
        role: finalRole || prev.role,
        skills: topSkills.length ? topSkills : prev.skills,
        topics: topicList.length ? topicList : prev.topics,
        headline: finalRole ? `${finalRole} | Building impactful work` : prev.headline,
      }));
      setResumeIndustry('');
      setAiGenerated({
        role: finalRole.length > 0,
        skills: topSkills.length > 0,
        topics: topicList.length > 0,
      });

      setUploadProgress(100);
      setUploadStatus('complete');
      setUploadStatusText('Resume analyzed — review your role, skills, and topics below.');
      setError(null);

      setOpenSections(prev => {
        const next = new Set(prev);
        next.delete('resume');
        return next;
      });

    } catch (err: any) {
      setUploadStatus('error');
      setError(err.message || 'Failed to process resume. You can fill in details manually.');
    }
  };

  // --- Complete onboarding ---
  const handleComplete = async () => {
    setError(null);

    const role = (formData.role ?? '').trim();
    const skills = normalizeStringList(formData.skills);
    const topics = normalizeStringList(formData.topics);

    const { data: { session } } = await supabase.auth.getSession();
    const userEarly = session?.user;
    if (!userEarly?.id) {
      setError('Not authenticated. Please sign in.');
      return;
    }
    if (!role || skills.length === 0) {
      setError('Please enter role and skills to continue');
      if (!role) openSection('designation');
      else openSection('skills');
      return;
    }

    const existingForSubmit = await getSupabaseSettings(userEarly.id);
    const resumePayloadForSubmit =
      formData.resumeUploaded && formData.resumeUrl
        ? {
            resumeUrl: formData.resumeUrl,
            fileName: uploadedFileName || formData.resumeUrl.split('/').pop() || '',
            role,
            skills,
            topics,
          }
        : undefined;
    const effectiveResume =
      resumePayloadForSubmit ?? existingForSubmit.resume_data ?? null;

    if (
      !isResumeProfileFilled({
        role,
        skills,
        topics,
        resume_data: effectiveResume,
      })
    ) {
      setError('Please complete all required fields');
      if (!parseStoredResumeData(effectiveResume)) openSection('resume');
      else if (!role) openSection('designation');
      else if (skills.length === 0) openSection('skills');
      else if (topics.length === 0) openSection('topics');
      return;
    }

    if (!formData.linkedInConnected || results.linkedinValidator?.needs_reconnect) {
      setError(
        results.linkedinValidator?.needs_reconnect
          ? 'Your LinkedIn session expired. Please reconnect.'
          : 'Please connect your LinkedIn account.'
      );
      openSection('linkedin');
      return;
    }

    setFormData(prev => ({ ...prev, role, skills, topics }));
    setCompleting(true);

    try {
      const user = userEarly;
      const userId = user.id;

      const resumePayload = formData.resumeUploaded && formData.resumeUrl
        ? {
            resumeUrl: formData.resumeUrl,
            fileName: uploadedFileName || formData.resumeUrl.split('/').pop() || '',
            role,
            skills,
            topics,
          }
        : undefined;

      const persistedResume =
        resumePayload ??
        (parseStoredResumeData(existingForSubmit.resume_data)
          ? existingForSubmit.resume_data
          : undefined);

      await updateProfile(userId, {
        role,
        skills,
        topics,
        onboarding_completed: true,
        linkedin_connected: formData.linkedInConnected,
        resume_data: persistedResume,
        resume_url: formData.resumeUrl?.trim() || undefined,
        name: user?.user_metadata?.full_name as string | undefined,
      });

      // Save schedule
      await syncSchedules(userId, formData.schedule);

      // Start agent (uses auth user from Supabase inside startAgent)
      await startAgent({ ...formData, id: userId, role, skills, topics });

      clearOnboardingDraft();
      navigate('/app/dashboard', { replace: true });
    } catch (err: any) {
      setError('Failed to complete setup: ' + (err.message || 'Unknown error'));
    } finally {
      setCompleting(false);
    }
  };

  // --- LinkedIn connect: pass user email in state for callback to save token to correct profile ---
  const handleConnectLinkedIn = async () => {
    const clientId = import.meta.env.VITE_LINKEDIN_CLIENT_ID;
    if (!clientId) {
      alert("LinkedIn client ID not configured");
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    const email = user?.email;
    if (!email) {
      setError("Please sign in to connect LinkedIn.");
      return;
    }

    const state = btoa(JSON.stringify({
      email,
      appOrigin: window.location.origin,
      returnPath: "/app/profile-setup",
    }));
    const redirectUri = encodeURIComponent(
      "https://linkedin-theta-seven.vercel.app/api/linkedin/callback"
    );
    const scope = encodeURIComponent("openid profile email w_member_social");
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}&state=${encodeURIComponent(state)}`;

    console.log("Redirecting to LinkedIn...");
    window.location.replace(url);
  };

  const designationPlaceholder =
    agentStates['resume-parser'].status === 'running'
      ? 'e.g. Senior Software Engineer'
      : formData.resumeUploaded && !aiGenerated.role && !formData.role.trim()
        ? ROLE_MANUAL_PLACEHOLDER
        : 'e.g. Senior Software Engineer';

  const topicSuggestionsEmptyMessage = (() => {
    if (heuristicTopicStrings.length > 0) {
      return 'Pick from the prompts above or add your own topics below.';
    }
    if (!formData.resumeUploaded) {
      return 'Upload your resume to get topic suggestions, or add topics manually below.';
    }
    const tr = agentStates['topic-recommender'].status;
    if (tr === 'error') {
      return 'Could not load AI topic suggestions. Add your own topics below.';
    }
    if (tr === 'complete' && suggestedTopics.length === 0) {
      return 'No AI topic suggestions for this resume. Add topics manually below.';
    }
    if (suggestedTopics.length === 0 && (tr === 'running' || (tr === 'idle' && isProcessing))) {
      return 'Generating topic suggestions… You can add custom topics below anytime.';
    }
    return 'Add topics manually below, or wait for suggestions after upload.';
  })();

  const showAiInsights =
    !!experienceData &&
    agentStates['experience-structurer'].status === 'complete' &&
    experienceInsightsAreMeaningful(experienceData);

  // --- Render ---
  if (bootstrapping) {
    return (
      <Layout>
        <div className="max-w-3xl mx-auto py-16 px-4 flex flex-col items-center gap-3 text-gray-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
          <p className="text-sm">Loading your profile…</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-3xl mx-auto py-6 px-4 pb-28">
        {/* Page Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Set Up Your Profile</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Let our AI learn your voice so every post sounds authentically you.
            </p>
          </div>
          <CircularProgress completed={completedCount} total={SECTIONS.length} />
        </div>

        {/* Auto-save indicator */}
        <div className="flex items-center gap-1.5 mb-6 text-xs text-gray-400">
          {saveStatus === 'saving' && <><Loader2 className="w-3 h-3 animate-spin text-indigo-500" /> Saving...</>}
          {saveStatus === 'saved' && <><CheckCircle2 className="w-3 h-3 text-green-500" /> All changes saved</>}
          {saveStatus === 'error' && <><AlertCircle className="w-3 h-3 text-red-500" /> Save failed</>}
        </div>

        {/* Accordion Sections */}
        <div className="space-y-3">
          {/* Section 1: Resume Upload */}
          <div ref={el => { sectionRefs.current.resume = el; }}>
            <AccordionSection
              title="Upload Resume"
              icon={<Upload className="w-5 h-5" />}
              status={getSectionStatus('resume')}
              isOpen={openSections.has('resume')}
              onToggle={() => toggleSection('resume')}
              summary={getSectionSummary('resume')}
              required
            >
              <FileUploadZone
                onFileSelect={handleFileUpload}
                progress={uploadProgress}
                status={uploadStatus}
                statusText={uploadStatusText}
                fileName={uploadedFileName}
                fileUrl={formData.resumeUrl}
                disabled={isProcessing}
              />
            </AccordionSection>
          </div>

          {/* Section 2: Target Designation */}
          <div ref={el => { sectionRefs.current.designation = el; }}>
            <AccordionSection
              title="Target Designation"
              icon={<Briefcase className="w-5 h-5" />}
              status={getSectionStatus('designation')}
              isOpen={openSections.has('designation')}
              onToggle={() => toggleSection('designation')}
              summary={getSectionSummary('designation')}
              required
            >
              {agentStates['resume-parser'].status === 'running' ? (
                <SkeletonLoader variant="text" lines={2} />
              ) : (
                <div className="space-y-4">
                  {aiGenerated.role && formData.role.trim() !== '' && (
                    <div className="flex items-center gap-1 mb-1">
                      <Zap className="w-3 h-3 text-indigo-500" />
                      <span className="text-xs text-indigo-600 font-medium">AI Suggested</span>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">
                      Target Designation
                    </label>
                    <input
                      type="text"
                      placeholder={designationPlaceholder}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      value={formData.role}
                      onChange={(e) => {
                        setAiGenerated(prev => ({ ...prev, role: false }));
                        setFormData(prev => ({ ...prev, role: e.target.value }));
                      }}
                    />
                  </div>
                </div>
              )}
            </AccordionSection>
          </div>

          {/* Section 3: Skills & Expertise */}
          <div ref={el => { sectionRefs.current.skills = el; }}>
            <AccordionSection
              title="Skills & Expertise"
              icon={<Code2 className="w-5 h-5" />}
              status={getSectionStatus('skills')}
              isOpen={openSections.has('skills')}
              onToggle={() => toggleSection('skills')}
              summary={getSectionSummary('skills')}
              required
            >
              {agentStates['skills-extractor'].status === 'running' ? (
                <SkeletonLoader variant="pills" />
              ) : (
                <SkillPillInput
                  skills={formData.skills}
                  onChange={(skills) => {
                    setAiGenerated(prev => ({ ...prev, skills: false }));
                    setFormData(prev => ({ ...prev, skills: normalizeStringList(skills) }));
                  }}
                  aiSuggested={aiGenerated.skills}
                  minRequired={1}
                  manualFallbackPlaceholder={SKILLS_MANUAL_PLACEHOLDER}
                />
              )}
            </AccordionSection>
          </div>

          {/* Section 4: Topics */}
          <div ref={el => { sectionRefs.current.topics = el; }}>
            <AccordionSection
              title="Topics"
              icon={<TrendingUp className="w-5 h-5" />}
              status={getSectionStatus('topics')}
              isOpen={openSections.has('topics')}
              onToggle={() => toggleSection('topics')}
              summary={getSectionSummary('topics')}
              required
            >
              {agentStates['topic-recommender'].status === 'running' ? (
                <SkeletonLoader variant="pills" />
              ) : (
                <TopicSelector
                  suggestedTopics={suggestedTopics}
                  heuristicTopicStrings={heuristicTopicStrings}
                  selectedTopics={formData.topics}
                  onChange={(topics) => {
                    setAiGenerated(prev => ({ ...prev, topics: false }));
                    setFormData(prev => ({ ...prev, topics: normalizeStringList(topics) }));
                  }}
                  emptySuggestionsMessage={topicSuggestionsEmptyMessage}
                />
              )}
            </AccordionSection>
          </div>

          {/* Section 5: LinkedIn Connection */}
          <div ref={el => { sectionRefs.current.linkedin = el; }}>
            <AccordionSection
              title="Connect LinkedIn"
              icon={<Linkedin className="w-5 h-5" />}
              status={getSectionStatus('linkedin')}
              isOpen={openSections.has('linkedin')}
              onToggle={() => toggleSection('linkedin')}
              summary={getSectionSummary('linkedin')}
              required
            >
              <div className="text-center py-6">
                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4 ${
                  formData.linkedInConnected ? 'bg-green-50' : 'bg-[#0077b5]/10'
                }`}>
                  <Linkedin className={`w-8 h-8 ${
                    formData.linkedInConnected ? 'text-green-600' : 'text-[#0077b5]'
                  }`} />
                </div>

                <h3 className="text-lg font-bold mb-2 text-gray-900">LinkedIn Bridge</h3>
                <p className="text-sm text-gray-500 mb-6 max-w-xs mx-auto">
                  Connect your account to allow AI agents to post directly on your behalf.
                </p>

                <Button
                  size="lg"
                  className={`${
                    formData.linkedInConnected && !results.linkedinValidator?.needs_reconnect
                      ? 'bg-green-600 hover:bg-green-700'
                      : 'bg-[#0077b5] hover:bg-[#006097]'
                  } shadow-lg`}
                  onClick={handleConnectLinkedIn}
                  disabled={
                    formData.linkedInConnected === true &&
                    results.linkedinValidator?.needs_reconnect !== true
                  }
                  type="button"
                >
                  {formData.linkedInConnected && !results.linkedinValidator?.needs_reconnect ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 mr-2" /> Already connected
                    </>
                  ) : (
                    <>
                      <Linkedin className="w-5 h-5 mr-2" />
                      {results.linkedinValidator?.needs_reconnect
                        ? 'Reconnect LinkedIn Account'
                        : 'Connect LinkedIn Account'}
                    </>
                  )}
                </Button>

                {!(formData.linkedInConnected && !results.linkedinValidator?.needs_reconnect) && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>You'll be redirected to LinkedIn to authorize. Data encrypted & never shared.</span>
                  </div>
                )}

                {results.linkedinValidator?.needs_reconnect && (
                  <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-xl text-sm text-amber-700">
                    <AlertCircle className="w-4 h-4 inline mr-1" />
                    Your LinkedIn token has expired. Please reconnect.
                  </div>
                )}
              </div>
            </AccordionSection>
          </div>

        </div>

        {/* AI Insights Panel — only real, non-placeholder structurer output */}
        {showAiInsights && (
          <div className="mt-6">
            <AIInsightsPanel
              data={experienceData!}
              industry={resumeIndustry}
              visible
            />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-6 p-4 bg-red-50 text-red-700 text-sm rounded-xl border border-red-100 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* Sticky Footer */}
      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-white border-t border-gray-200 px-6 py-4 z-40">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {completedCount === SECTIONS.length ? (
              <span className="text-green-600 font-semibold">All sections done!</span>
            ) : (
              <span>{completedCount} of {SECTIONS.length} complete</span>
            )}
            {completedCount >= 5 && completedCount < SECTIONS.length && (
              <span className="ml-2 text-indigo-600 font-medium">Almost there!</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={saveNow}
              disabled={completing}
              type="button"
            >
              <Save className="w-4 h-4 mr-1.5" />
              Save Draft
            </Button>
            <Button
              onClick={handleComplete}
              disabled={!requiredComplete || completing || isProcessing}
              className={`min-w-[180px] ${
                requiredComplete && !completing ? 'shadow-lg shadow-indigo-500/30' : ''
              }`}
              type="button"
            >
              {completing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Complete Setup ({completedCount}/{SECTIONS.length})
                  <CheckCircle2 className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
};

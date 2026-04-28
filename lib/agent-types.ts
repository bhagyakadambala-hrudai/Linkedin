// ============================================
// AI Agent Input/Output Type Contracts
// ============================================

// --- Agent 1: Resume Parser ---

export interface ResumeParserInput {
  resume_text: string;
  user_id: string;
  file_name?: string;
  file_type?: string;
}

export interface ResumeParserData {
  full_name: string;
  current_role: string;
  experience_level: 'entry' | 'mid' | 'senior' | 'lead' | 'executive';
  years_of_experience: number;
  summary: string;
  raw_skills: string[];
  education: Array<{
    degree: string;
    institution: string;
    year?: string;
  }>;
  work_history: Array<{
    title: string;
    company: string;
    duration: string;
    highlights: string[];
  }>;
  certifications: string[];
  industry: string;
  linkedin_headline_suggestion: string;
  portfolio_url?: string | null;
  linkedin_url?: string | null;
}

export interface ResumeParserOutput {
  success: boolean;
  data: ResumeParserData;
  error?: string;
}

// --- Agent 2: Skills Extraction ---

export interface SkillsExtractorInput {
  raw_skills: string[];
  work_history: Array<{
    title: string;
    company: string;
    duration: string;
    highlights: string[];
  }>;
  current_role: string;
  industry: string;
}

export interface CategorizedSkills {
  technical: string[];
  domain: string[];
  leadership: string[];
  soft: string[];
}

export interface SkillsExtractorData {
  categorized_skills: CategorizedSkills;
  top_skills: string[];
  content_angle_skills: string[];
}

export interface SkillsExtractorOutput {
  success: boolean;
  data: SkillsExtractorData;
  error?: string;
}

// --- Agent 3: Experience Structurer ---

export interface ExperienceStructurerInput {
  work_history: Array<{
    title: string;
    company: string;
    duration: string;
    highlights: string[];
  }>;
  education: Array<{
    degree: string;
    institution: string;
    year?: string;
  }>;
  certifications: string[];
  current_role: string;
  years_of_experience: number;
}

export type ContentTone = 'thought-leader' | 'practitioner' | 'educator' | 'storyteller';

export interface ExperienceStructurerData {
  career_trajectory: string;
  industry_sectors: string[];
  notable_achievements: string[];
  content_authority_areas: string[];
  experience_summary: string;
  seniority_score: number;
  recommended_content_tone: ContentTone;
  recommended_post_frequency: number;
}

export interface ExperienceStructurerOutput {
  success: boolean;
  data: ExperienceStructurerData;
  error?: string;
}

// --- Agent 4: LinkedIn Validator ---

export interface LinkedInValidatorInput {
  user_id: string;
}

export interface LinkedInValidatorData {
  is_connected: boolean;
  token_valid: boolean;
  token_expires_at: string | null;
  profile_url: string | null;
  needs_reconnect: boolean;
}

export interface LinkedInValidatorOutput {
  success: boolean;
  data: LinkedInValidatorData;
  error?: string;
}

// --- Agent 5: Topic Recommender ---

export interface TopicRecommenderInput {
  current_role: string;
  top_skills: string[];
  industry: string;
  content_authority_areas: string[];
  content_angle_skills: string[];
  existing_topics?: string[];
}

export interface SuggestedTopic {
  topic: string;
  relevance_score: number;
  trending: boolean;
  category: 'industry' | 'skill' | 'career' | 'thought-leadership';
  reasoning: string;
}

export interface TopicCluster {
  cluster_name: string;
  topics: string[];
}

export interface TopicRecommenderData {
  suggested_topics: SuggestedTopic[];
  topic_clusters: TopicCluster[];
}

export interface TopicRecommenderOutput {
  success: boolean;
  data: TopicRecommenderData;
  error?: string;
}

// --- Agent Pipeline State ---

export type AgentName =
  | 'resume-parser'
  | 'skills-extractor'
  | 'experience-structurer'
  | 'linkedin-validator'
  | 'topic-recommender';

export type AgentRunStatus = 'idle' | 'running' | 'complete' | 'error';

export interface AgentState {
  status: AgentRunStatus;
  error?: string;
}

export type AgentPipelineState = Record<AgentName, AgentState>;

export interface AgentPipelineResults {
  resumeParser?: ResumeParserData;
  skillsExtractor?: SkillsExtractorData;
  experienceStructurer?: ExperienceStructurerData;
  linkedinValidator?: LinkedInValidatorData;
  topicRecommender?: TopicRecommenderData;
}

/** Returned by `triggerPipeline` so the client can tell real extractions from empty fallbacks. */
export interface PipelineStageSuccess {
  resumeParser: boolean;
  skillsExtractor: boolean;
  topicRecommender: boolean;
}

export interface PipelineTriggerResult extends AgentPipelineResults {
  pipelineMeta: PipelineStageSuccess;
}


export type PlanType = 'starter' | 'professional' | 'brand-pro' | 'dev';

export interface Plan {
  id: PlanType;
  name: string;
  price: number;
  features: string[];
  postLimit: number;
}

export interface User {
  id: string;
  name: string;
  email: string;
  plan: PlanType;
  linkedInConnected: boolean;
  role?: string;
  skills?: string[];
  topics?: string[];
  tone?: string;
  notifications?: boolean;
  schedule?: ScheduleConfig[];
  agentActive?: boolean;
  agentStatus?: 'running' | 'paused' | 'error' | 'idle';
  lastAgentRun?: string;
  // Profile setup fields
  experience_level?: string;
  years_of_experience?: number;
  industry?: string;
  summary?: string;
  headline?: string;
  company_name?: string;
  target_audience?: string;
  content_goals?: string[];
  preferred_tone?: string;
  notable_achievements?: string[];
  portfolio_url?: string;
  resume_url?: string;
  onboarding_completed?: boolean;
}

export interface ScheduleConfig {
  day: string;
  time: string;
}

export type JobStatus = 'scheduled' | 'processing' | 'posted' | 'failed';

export interface AgentJob {
  id: string;
  userId: string;
  scheduledTime: string; // ISO string
  status: JobStatus;
  topic: string;
  type: 'text' | 'image' | 'carousel';
  generatedContent?: string;
  linkedInPostId?: string;
  error?: string;
}

export interface StatMetric {
  label: string;
  value: string | number;
  change: number; // percentage
  trend: 'up' | 'down';
}

// Profile setup page form state
export interface ProfileSetupData {
  // Section 1: Resume
  resumeUploaded: boolean;
  resumeUrl: string;
  // Section 2: Target Designation
  role: string;
  // Section 3: Skills
  skills: string[];
  // Section 4: Topics
  topics: string[];
  // Section 5: Custom Topics (merged into topics)
  // Section 6: LinkedIn
  linkedInConnected: boolean;
  // Section 7: Professional Details
  company_name: string;
  headline: string;
  target_audience: string[];
  content_goals: string[];
  preferred_tone: string;
  notable_achievements: string;
  portfolio_url: string;
  // Schedule (carried from existing flow)
  schedule: ScheduleConfig[];
}

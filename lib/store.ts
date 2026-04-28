
import { AgentJob, ProfileSetupData } from '../types';
import { MOCK_JOBS } from '../constants';

const STORAGE_KEYS = {
  JOBS: 'autolink_jobs',
};

export const getStoredJobs = (): AgentJob[] => {
  const stored = localStorage.getItem(STORAGE_KEYS.JOBS);
  return stored ? JSON.parse(stored) : MOCK_JOBS;
};

export const saveJobs = (jobs: AgentJob[]) => {
  localStorage.setItem(STORAGE_KEYS.JOBS, JSON.stringify(jobs));
};

export const addJob = (job: AgentJob) => {
  const jobs = getStoredJobs();
  const updated = [job, ...jobs];
  saveJobs(updated);
  return updated;
};

/** Profile/onboarding form data must not live in localStorage (cross-account leakage). Use Supabase only. */
export const getOnboardingDraft = (): ProfileSetupData | null => null;

export const saveOnboardingDraft = (_data: ProfileSetupData): void => {};

export const clearOnboardingDraft = (): void => {};

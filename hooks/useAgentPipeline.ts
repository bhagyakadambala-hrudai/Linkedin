// Orchestrates all 5 AI agents: sequential/parallel calls, state tracking, error handling

import { useState, useCallback, useRef } from 'react';
import type {
  AgentPipelineState,
  AgentPipelineResults,
  PipelineTriggerResult,
  PipelineStageSuccess,
  ResumeParserData,
} from '../lib/agent-types';
import {
  invokeResumeParser,
  invokeSkillsExtractor,
  invokeExperienceStructurer,
  invokeLinkedInValidator,
  invokeTopicRecommender,
} from '../lib/agents';
import { supabase } from '../lib/supabase';

const INITIAL_PIPELINE_STATE: AgentPipelineState = {
  'resume-parser': { status: 'idle' },
  'skills-extractor': { status: 'idle' },
  'experience-structurer': { status: 'idle' },
  'linkedin-validator': { status: 'idle' },
  'topic-recommender': { status: 'idle' },
};

export function useAgentPipeline() {
  const [agentStates, setAgentStates] = useState<AgentPipelineState>(INITIAL_PIPELINE_STATE);
  const [results, setResults] = useState<AgentPipelineResults>({});
  const [isProcessing, setIsProcessing] = useState(false);
  const abortRef = useRef(false);

  const updateAgentState = (
    agent: keyof AgentPipelineState,
    status: AgentPipelineState[typeof agent]['status'],
    error?: string
  ) => {
    setAgentStates(prev => ({
      ...prev,
      [agent]: { status, error },
    }));
  };

  const triggerPipeline = useCallback(async (
    resumeText: string,
    fileName?: string
  ): Promise<PipelineTriggerResult> => {
    setIsProcessing(true);
    abortRef.current = false;
    setAgentStates(INITIAL_PIPELINE_STATE);
    setResults({});

    const pipelineResults: AgentPipelineResults = {};
    const pipelineMeta: PipelineStageSuccess = {
      resumeParser: false,
      skillsExtractor: false,
      topicRecommender: false,
    };

    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      if (!userId) {
        throw new Error('Sign in to run the AI pipeline on your profile.');
      }

      // --- Stage 1: Resume Parser ---
      updateAgentState('resume-parser', 'running');

      const resumeResult = await invokeResumeParser({
        resume_text: resumeText,
        user_id: userId,
        file_name: fileName,
      });

      pipelineResults.resumeParser = resumeResult.data;
      pipelineMeta.resumeParser = resumeResult.success;
      updateAgentState('resume-parser', resumeResult.success ? 'complete' : 'error', resumeResult.error);
      setResults(prev => ({ ...prev, resumeParser: resumeResult.data }));

      if (abortRef.current) return { ...pipelineResults, pipelineMeta };

      // --- Stage 2: Parallel (Skills + Experience + LinkedIn) ---
      updateAgentState('skills-extractor', 'running');
      updateAgentState('experience-structurer', 'running');
      updateAgentState('linkedin-validator', 'running');

      const resumeData: ResumeParserData = resumeResult.data;

      const [skillsResult, experienceResult, linkedinResult] = await Promise.all([
        invokeSkillsExtractor({
          raw_skills: resumeData.raw_skills,
          work_history: resumeData.work_history,
          current_role: resumeData.current_role,
          industry: resumeData.industry,
        }),
        invokeExperienceStructurer({
          work_history: resumeData.work_history,
          education: resumeData.education,
          certifications: resumeData.certifications,
          current_role: resumeData.current_role,
          years_of_experience: resumeData.years_of_experience,
        }),
        invokeLinkedInValidator({ user_id: userId }),
      ]);

      pipelineResults.skillsExtractor = skillsResult.data;
      pipelineResults.experienceStructurer = experienceResult.data;
      pipelineResults.linkedinValidator = linkedinResult.data;
      pipelineMeta.skillsExtractor = skillsResult.success;

      updateAgentState('skills-extractor', skillsResult.success ? 'complete' : 'error', skillsResult.error);
      updateAgentState('experience-structurer', experienceResult.success ? 'complete' : 'error', experienceResult.error);
      updateAgentState('linkedin-validator', linkedinResult.success ? 'complete' : 'error', linkedinResult.error);

      setResults(prev => ({
        ...prev,
        skillsExtractor: skillsResult.data,
        experienceStructurer: experienceResult.data,
        linkedinValidator: linkedinResult.data,
      }));

      if (abortRef.current) return { ...pipelineResults, pipelineMeta };

      // --- Stage 3: Topic Recommender (depends on Skills + Experience) ---
      updateAgentState('topic-recommender', 'running');

      const topicResult = await invokeTopicRecommender({
        current_role: resumeData.current_role,
        top_skills: skillsResult.data.top_skills,
        industry: resumeData.industry,
        content_authority_areas: experienceResult.data.content_authority_areas,
        content_angle_skills: skillsResult.data.content_angle_skills,
      });

      pipelineResults.topicRecommender = topicResult.data;
      pipelineMeta.topicRecommender = topicResult.success;
      updateAgentState('topic-recommender', topicResult.success ? 'complete' : 'error', topicResult.error);
      setResults(prev => ({ ...prev, topicRecommender: topicResult.data }));

    } catch (err: any) {
      console.error('Agent pipeline error:', err);
    } finally {
      setIsProcessing(false);
    }

    return { ...pipelineResults, pipelineMeta };
  }, []);

  const checkLinkedIn = useCallback(async () => {
    updateAgentState('linkedin-validator', 'running');

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id;
    if (!userId) {
      updateAgentState('linkedin-validator', 'error', 'Not signed in');
      return undefined;
    }

    const result = await invokeLinkedInValidator({ user_id: userId });

    updateAgentState('linkedin-validator', result.success ? 'complete' : 'error', result.error);
    setResults(prev => ({ ...prev, linkedinValidator: result.data }));

    return result.data;
  }, []);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  return {
    triggerPipeline,
    checkLinkedIn,
    abort,
    agentStates,
    results,
    isProcessing,
  };
}

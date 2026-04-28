import React from 'react';
import { Sparkles, TrendingUp, Briefcase, BarChart3 } from 'lucide-react';
import type { ExperienceStructurerData } from '../lib/agent-types';

interface AIInsightsPanelProps {
  data: ExperienceStructurerData;
  industry?: string;
  visible: boolean;
}

const toneLabels: Record<string, string> = {
  'thought-leader': 'Thought Leader',
  'practitioner': 'Practitioner',
  'educator': 'Educator',
  'storyteller': 'Storyteller',
  'professional': 'Professional',
};

export const AIInsightsPanel: React.FC<AIInsightsPanelProps> = ({
  data,
  industry,
  visible,
}) => {
  if (!visible) return null;

  const industryTrimmed = (industry ?? '').trim();
  const toneLabel = data.recommended_content_tone
    ? toneLabels[data.recommended_content_tone] ?? data.recommended_content_tone
    : null;

  return (
    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-2xl p-6 animate-fade-in">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-indigo-600" />
        <h3 className="font-bold text-indigo-900">AI Profile Insights</h3>
      </div>

      <p className="text-sm text-indigo-700 mb-5">
        Based on your resume, here&apos;s what our AI agents found:
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="flex items-start gap-3 p-3 bg-white/60 rounded-xl">
          <BarChart3 className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase">Seniority Score</p>
            <p className="text-sm font-semibold text-gray-900">{data.seniority_score}/10</p>
          </div>
        </div>

        {industryTrimmed ? (
          <div className="flex items-start gap-3 p-3 bg-white/60 rounded-xl">
            <Briefcase className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase">Industry</p>
              <p className="text-sm font-semibold text-gray-900">{industryTrimmed}</p>
            </div>
          </div>
        ) : null}

        {toneLabel ? (
          <div className="flex items-start gap-3 p-3 bg-white/60 rounded-xl">
            <TrendingUp className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase">Content Tone</p>
              <p className="text-sm font-semibold text-gray-900">{toneLabel}</p>
            </div>
          </div>
        ) : null}

        <div className="flex items-start gap-3 p-3 bg-white/60 rounded-xl">
          <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-gray-500 uppercase">Recommended Frequency</p>
            <p className="text-sm font-semibold text-gray-900">
              {data.recommended_post_frequency}x per week
            </p>
          </div>
        </div>
      </div>

      {data.content_authority_areas.length > 0 && (
        <div className="mt-4 pt-4 border-t border-indigo-100">
          <p className="text-xs font-bold text-indigo-600 uppercase mb-2">Your Authority Areas</p>
          <div className="flex flex-wrap gap-2">
            {data.content_authority_areas.map(area => (
              <span
                key={area}
                className="px-3 py-1 bg-white/80 border border-indigo-200 rounded-full text-xs font-medium text-indigo-700"
              >
                {area}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.experience_summary && (
        <div className="mt-4 pt-4 border-t border-indigo-100">
          <p className="text-xs font-bold text-indigo-600 uppercase mb-1">Career Summary</p>
          <p className="text-sm text-indigo-800 leading-relaxed">{data.experience_summary}</p>
        </div>
      )}
    </div>
  );
};

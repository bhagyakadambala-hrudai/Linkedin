import React, { useState, useRef } from 'react';
import { X, Zap } from 'lucide-react';

interface SkillPillInputProps {
  skills: string[];
  onChange: (skills: string[]) => void;
  placeholder?: string;
  /** Shown when there is no AI suggestion (`aiSuggested` false) and the input is empty */
  manualFallbackPlaceholder?: string;
  maxSkills?: number;
  aiSuggested?: boolean;
  minRequired?: number;
}

export const SkillPillInput: React.FC<SkillPillInputProps> = ({
  skills,
  onChange,
  placeholder = 'Type a skill and press Enter',
  manualFallbackPlaceholder,
  maxSkills = 30,
  aiSuggested = false,
  minRequired = 0,
}) => {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const emptyHint =
    !aiSuggested && manualFallbackPlaceholder ? manualFallbackPlaceholder : placeholder;

  const addSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (trimmed && !skills.includes(trimmed) && skills.length < maxSkills) {
      onChange([...skills, trimmed]);
    }
    setInputValue('');
  };

  const removeSkill = (skill: string) => {
    onChange(skills.filter(s => s !== skill));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSkill(inputValue);
    } else if (e.key === 'Backspace' && !inputValue && skills.length > 0) {
      removeSkill(skills[skills.length - 1]);
    }
  };

  return (
    <div>
      {aiSuggested && skills.length > 0 && (
        <div className="flex items-center gap-1 mb-2">
          <Zap className="w-3 h-3 text-indigo-500" />
          <span className="text-xs text-indigo-600 font-medium">AI Suggested</span>
        </div>
      )}

      <div
        className="min-h-[52px] w-full px-3 py-2 border border-gray-200 rounded-xl bg-white focus-within:ring-2 focus-within:ring-indigo-500 focus-within:border-transparent transition-all cursor-text flex flex-wrap gap-2 items-center"
        onClick={() => inputRef.current?.focus()}
      >
        {skills.map(skill => (
          <span
            key={skill}
            className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-600 text-white rounded-full text-sm font-medium"
          >
            {skill}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeSkill(skill); }}
              className="hover:bg-indigo-700 rounded-full p-0.5 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={skills.length === 0 ? emptyHint : ''}
          className="flex-1 min-w-[120px] outline-none text-sm text-gray-700 bg-transparent"
          disabled={skills.length >= maxSkills}
        />
      </div>

      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-gray-400">
          {skills.length} skill{skills.length !== 1 ? 's' : ''} added
          {minRequired > 0 && ` (minimum ${minRequired})`}
        </p>
        {skills.length >= maxSkills && (
          <p className="text-xs text-amber-600">Maximum {maxSkills} skills reached</p>
        )}
      </div>
    </div>
  );
};

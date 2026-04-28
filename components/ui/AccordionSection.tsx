import React from 'react';
import { ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

export type SectionStatus = 'pending' | 'active' | 'ai-filled' | 'complete' | 'skipped';

interface AccordionSectionProps {
  title: string;
  icon: React.ReactNode;
  status: SectionStatus;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  summary?: string;
  statusBadge?: string;
  required?: boolean;
}

const statusBadgeStyles: Record<SectionStatus, string> = {
  pending: 'bg-gray-100 text-gray-500',
  active: 'bg-indigo-50 text-indigo-600',
  'ai-filled': 'bg-indigo-50 text-indigo-600',
  complete: 'bg-green-50 text-green-700',
  skipped: 'bg-gray-100 text-gray-400',
};

const statusBadgeLabels: Record<SectionStatus, string> = {
  pending: 'Pending',
  active: 'In Progress',
  'ai-filled': 'AI Filled',
  complete: 'Complete',
  skipped: 'Skipped',
};

export const AccordionSection: React.FC<AccordionSectionProps> = ({
  title,
  icon,
  status,
  isOpen,
  onToggle,
  children,
  summary,
  statusBadge,
  required = false,
}) => {
  const isComplete = status === 'complete';

  const containerClasses = cn(
    'rounded-xl border transition-all duration-200',
    isOpen && 'border-2 border-indigo-200 ring-1 ring-indigo-100 shadow-md',
    !isOpen && isComplete && 'border-green-200 bg-green-50/30',
    !isOpen && !isComplete && 'border-gray-200 bg-white shadow-sm',
    isOpen && 'bg-white'
  );

  return (
    <div className={containerClasses}>
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-4 p-5 text-left"
      >
        <div className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center shrink-0',
          isComplete ? 'bg-green-50' : 'bg-gray-50'
        )}>
          {isComplete ? (
            <CheckCircle2 className="w-5 h-5 text-green-600" />
          ) : (
            <span className="text-gray-500">{icon}</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">{title}</span>
            {required && !isComplete && (
              <span className="text-[10px] text-red-400 font-medium">Required</span>
            )}
          </div>
          {!isOpen && summary && (
            <p className="text-sm text-gray-500 truncate mt-0.5">{summary}</p>
          )}
        </div>

        <span className={cn(
          'px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0',
          statusBadgeStyles[status]
        )}>
          {statusBadge || statusBadgeLabels[status]}
        </span>

        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-gray-400 shrink-0" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-400 shrink-0" />
        )}
      </button>

      {isOpen && (
        <div className="px-5 pb-5 animate-fade-in">
          <div className="border-t border-gray-100 pt-5">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};

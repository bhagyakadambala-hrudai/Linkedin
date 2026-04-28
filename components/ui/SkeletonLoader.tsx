import React from 'react';

interface SkeletonLoaderProps {
  variant?: 'text' | 'pills' | 'card';
  lines?: number;
}

export const SkeletonLoader: React.FC<SkeletonLoaderProps> = ({
  variant = 'text',
  lines = 3,
}) => {
  if (variant === 'pills') {
    return (
      <div className="animate-pulse flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-8 bg-gray-200 rounded-full"
            style={{ width: `${60 + Math.random() * 60}px` }}
          />
        ))}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="animate-pulse space-y-4 p-4 border border-gray-100 rounded-xl">
        <div className="h-4 bg-gray-200 rounded w-1/3" />
        <div className="h-3 bg-gray-200 rounded w-2/3" />
        <div className="h-3 bg-gray-200 rounded w-1/2" />
      </div>
    );
  }

  // Default: text lines
  return (
    <div className="animate-pulse space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-gray-200 rounded"
          style={{ width: `${50 + Math.random() * 50}%` }}
        />
      ))}
    </div>
  );
};

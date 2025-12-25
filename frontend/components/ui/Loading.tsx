/**
 * Loading State Component - Reusable Loading Indicators
 * Production-ready loading states for async operations
 */

import React from 'react';

export type LoadingSize = 'sm' | 'md' | 'lg';
export type LoadingVariant = 'spinner' | 'pulse' | 'skeleton';

interface LoadingProps {
  size?: LoadingSize;
  variant?: LoadingVariant;
  text?: string;
  className?: string;
}

const SIZE_STYLES: Record<LoadingSize, { spinner: string; text: string }> = {
  sm: { spinner: 'w-4 h-4', text: 'text-xs' },
  md: { spinner: 'w-8 h-8', text: 'text-sm' },
  lg: { spinner: 'w-12 h-12', text: 'text-base' },
};

export const Loading: React.FC<LoadingProps> = ({
  size = 'md',
  variant = 'spinner',
  text,
  className = '',
}) => {
  const sizeConfig = SIZE_STYLES[size];

  if (variant === 'spinner') {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 ${className}`}>
        <div
          className={`
            ${sizeConfig.spinner} border-4 border-cyan-500/30 
            border-t-cyan-500 rounded-full animate-spin
          `}
        />
        {text && (
          <p className={`${sizeConfig.text} text-gray-500 font-medium`}>
            {text}
          </p>
        )}
      </div>
    );
  }

  if (variant === 'pulse') {
    return (
      <div className={`flex items-center justify-center gap-2 ${className}`}>
        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse" />
        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse delay-100" />
        <div className="w-2 h-2 bg-cyan-500 rounded-full animate-pulse delay-200" />
        {text && (
          <p className={`ml-2 ${sizeConfig.text} text-gray-500 font-medium`}>
            {text}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className={`animate-pulse space-y-3 ${className}`}>
      <div className="h-4 bg-gray-700 rounded w-3/4" />
      <div className="h-4 bg-gray-700 rounded w-1/2" />
    </div>
  );
};

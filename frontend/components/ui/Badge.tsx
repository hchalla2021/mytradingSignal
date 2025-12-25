/**
 * Badge Component - Reusable Status Badge
 * Production-ready, configurable status indicator
 */

import React from 'react';
const BACKGROUNDS = {
  success: 'bg-green-600',
  warning: 'bg-yellow-500',
  error: 'bg-red-600',
  info: 'bg-blue-600',
  neutral: 'bg-gray-600',
};

const BORDERS = {
  success: 'border-green-700',
  warning: 'border-yellow-600',
  error: 'border-red-700',
  info: 'border-blue-700',
  neutral: 'border-gray-700',
};

const SHADOWS = {
  sm: 'shadow-sm',
  md: 'shadow',
  lg: 'shadow-lg',
};
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';
export type BadgeSize = 'sm' | 'md' | 'lg';

interface BadgeProps {
  variant: BadgeVariant;
  size?: BadgeSize;
  children: React.ReactNode;
  animated?: boolean;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  success: 'bg-gradient-to-r from-teal-500/10 to-emerald-500/10 border-teal-400/30 text-teal-300',
  warning: 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 border-amber-400/30 text-amber-300',
  error: 'bg-gradient-to-r from-rose-500/10 to-red-500/10 border-rose-400/30 text-rose-400',
  info: 'bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-400/30 text-blue-300',
  neutral: 'bg-gradient-to-r from-gray-500/10 to-gray-600/10 border-gray-400/30 text-gray-300',
};

const DOT_STYLES: Record<BadgeVariant, string> = {
  success: 'bg-teal-400',
  warning: 'bg-amber-400',
  error: 'bg-rose-500',
  info: 'bg-blue-400',
  neutral: 'bg-gray-400',
};

const SIZE_STYLES: Record<BadgeSize, { container: string; dot: string; text: string }> = {
  sm: {
    container: 'px-2 py-1 gap-1',
    dot: 'w-1.5 h-1.5',
    text: 'text-[9px]',
  },
  md: {
    container: 'px-2.5 py-1.5 gap-1.5',
    dot: 'w-2 h-2 sm:w-2.5 sm:h-2.5',
    text: 'text-[9px] sm:text-xs',
  },
  lg: {
    container: 'px-3 py-2 gap-2',
    dot: 'w-2.5 h-2.5',
    text: 'text-xs',
  },
};

export const Badge: React.FC<BadgeProps> = ({
  variant,
  size = 'md',
  children,
  animated = false,
  className = '',
}) => {
  const variantClass = VARIANT_STYLES[variant];
  const dotClass = DOT_STYLES[variant];
  const sizeConfig = SIZE_STYLES[size];

  return (
    <div
      className={`
        flex items-center ${sizeConfig.container}
        rounded-lg border-2 ${variantClass}
        ${className}
      `}
    >
      <div
        className={`
          ${sizeConfig.dot} rounded-full ${dotClass}
          ${animated ? 'animate-pulse' : ''}
        `}
      />
      <span className={`${sizeConfig.text} font-bold tracking-wider`}>
        {children}
      </span>
    </div>
  );
};

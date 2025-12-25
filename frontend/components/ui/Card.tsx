/**
 * Card Component - Reusable Container
 * Production-ready, responsive card wrapper
 */

import React from 'react';
import { BORDERS, SHADOWS, BACKGROUNDS, ANIMATIONS } from '@/lib/constants/theme';

export type CardVariant = 'default' | 'success' | 'warning' | 'error' | 'neutral';
export type CardSize = 'sm' | 'md' | 'lg';

interface CardProps {
  children: React.ReactNode;
  variant?: CardVariant;
  size?: CardSize;
  hover?: boolean;
  className?: string;
}

const VARIANT_BORDERS: Record<CardVariant, string> = {
  default: BORDERS.emerald,
  success: 'border-green-500/30',
  warning: 'border-amber-500/30',
  error: 'border-red-500/30',
  neutral: 'border-gray-600/30',
};

const VARIANT_SHADOWS: Record<CardVariant, string> = {
  default: SHADOWS.emerald,
  success: 'shadow-lg shadow-green-500/10',
  warning: 'shadow-lg shadow-amber-500/10',
  error: 'shadow-lg shadow-red-500/10',
  neutral: 'shadow-lg shadow-gray-500/10',
};

const SIZE_PADDING: Record<CardSize, string> = {
  sm: 'p-3',
  md: 'p-6',
  lg: 'p-8',
};

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'default',
  size = 'md',
  hover = false,
  className = '',
}) => {
  const borderClass = VARIANT_BORDERS[variant];
  const shadowClass = VARIANT_SHADOWS[variant];
  const paddingClass = SIZE_PADDING[size];

  return (
    <div
      className={`
        ${BACKGROUNDS.card}
        rounded-2xl border-2 ${borderClass}
        ${paddingClass} shadow-2xl ${shadowClass}
        ${hover ? `${ANIMATIONS.transition} ${ANIMATIONS.hover}` : ''}
        ${className}
      `}
    >
      {children}
    </div>
  );
};

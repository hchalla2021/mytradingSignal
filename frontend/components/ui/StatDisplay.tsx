/**
 * Stat Display Component - Reusable Metric Display
 * Production-ready component for displaying key metrics
 */

import React from 'react';
import { formatCurrency, formatPercentage, formatLargeNumber } from '@/lib/utils/format';

export type StatType = 'currency' | 'percentage' | 'number' | 'custom';
export type StatStatus = 'positive' | 'negative' | 'neutral';

interface StatDisplayProps {
  label: string;
  value: number | string | null;
  type?: StatType;
  status?: StatStatus;
  size?: 'sm' | 'md' | 'lg';
  showBorder?: boolean;
  className?: string;
}

const STATUS_COLORS: Record<StatStatus, string> = {
  positive: 'text-bullish',
  negative: 'text-bearish',
  neutral: 'text-gray-400',
};

const SIZE_STYLES = {
  sm: {
    label: 'text-[9px]',
    value: 'text-[10px]',
  },
  md: {
    label: 'text-xs',
    value: 'text-sm',
  },
  lg: {
    label: 'text-sm',
    value: 'text-lg',
  },
};

export const StatDisplay: React.FC<StatDisplayProps> = ({
  label,
  value,
  type = 'custom',
  status = 'neutral',
  size = 'md',
  showBorder = true,
  className = '',
}) => {
  const formatValue = (): string => {
    if (value === null || value === undefined) return '—';
    
    if (typeof value === 'string') return value;
    
    switch (type) {
      case 'currency':
        return formatCurrency(value);
      case 'percentage':
        return formatPercentage(value);
      case 'number':
        return formatLargeNumber(value);
      default:
        return String(value);
    }
  };

  const sizeConfig = SIZE_STYLES[size];
  const statusColor = STATUS_COLORS[status];

  return (
    <div
      className={`
        ${showBorder ? 'bg-black/50 rounded-lg p-3 border border-gray-800' : ''}
        ${className}
      `}
    >
      <div className={`${sizeConfig.label} text-gray-500 mb-1 font-medium`}>
        {label}
      </div>
      <div className={`${sizeConfig.value} font-bold ${statusColor}`}>
        {formatValue()}
      </div>
    </div>
  );
};

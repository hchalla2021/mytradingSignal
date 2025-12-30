/**
 * TechnicalIndicator - Display individual technical indicators
 * Reusable component with status colors
 */

import React from 'react';

interface TechnicalIndicatorProps {
  label: string;
  value: string | number;
  status?: 'positive' | 'negative' | 'neutral';
  prefix?: string;
  suffix?: string;
  showArrow?: boolean;
  size?: 'sm' | 'md';
}

export const TechnicalIndicator: React.FC<TechnicalIndicatorProps> = ({
  label,
  value,
  status = 'neutral',
  prefix = '',
  suffix = '',
  showArrow = true,
  size = 'md',
}) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'positive':
        return {
          color: 'text-green-400',
          bg: 'bg-green-950/30',
          border: 'border-green-500/40',
          shadow: 'shadow-green-500/20',
          arrow: '▲',
        };
      case 'negative':
        return {
          color: 'text-red-400',
          bg: 'bg-red-950/30',
          border: 'border-red-500/40',
          shadow: 'shadow-red-500/20',
          arrow: '▼',
        };
      default:
        return {
          color: 'text-gray-400',
          bg: 'bg-gray-950/30',
          border: 'border-gray-500/40',
          shadow: 'shadow-gray-500/20',
          arrow: '━',
        };
    }
  };

  const config = getStatusConfig();
  const sizeClasses = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex items-center justify-between ${sizeClasses} p-2 rounded ${config.bg}`}>
      <span className="text-gray-500 font-medium">{label}</span>
      <div className={`flex items-center gap-1.5 ${config.color} font-bold px-3 py-1.5 rounded-lg border-2 ${config.border} shadow-md ${config.shadow}`}>
        {showArrow && status !== 'neutral' && (
          <span className="text-xs">{config.arrow}</span>
        )}
        <span>
          {prefix}
          {typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value}
          {suffix}
        </span>
      </div>
    </div>
  );
};

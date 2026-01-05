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
  highlight?: 'normal' | 'warning' | 'critical';
  isPCR?: boolean; // Special flag for PCR to use yellow instead of gray
}

export const TechnicalIndicator: React.FC<TechnicalIndicatorProps> = ({
  label,
  value,
  status = 'neutral',
  prefix = '',
  suffix = '',
  showArrow = true,
  size = 'md',
  highlight = 'normal',
  isPCR = false,
}) => {
  const getStatusConfig = () => {
    // Check for critical/warning highlights - SOFTER, SLOWER animations
    const highlightClass = highlight === 'critical' 
      ? 'animate-pulse-slow' // Changed from animate-ping-fast to slower pulse
      : highlight === 'warning' 
      ? 'animate-pulse-slow' // Slowed down warning too
      : '';

    switch (status) {
      case 'positive':
        return {
          color: 'text-green-400',
          bg: highlight === 'critical' ? 'bg-green-900/20' : highlight === 'warning' ? 'bg-green-950/15' : 'bg-green-950/10', // Much lighter green background
          border: highlight === 'critical' ? 'border-green-500/40' : highlight === 'warning' ? 'border-green-500/30' : 'border-green-500/20', // Softer borders
          shadow: highlight === 'critical' ? 'shadow-green-500/20' : highlight === 'warning' ? 'shadow-green-500/15' : 'shadow-green-500/10', // Softer shadows
          arrow: '▲',
          highlightClass,
        };
      case 'negative':
        return {
          color: 'text-red-400',
          bg: highlight === 'critical' ? 'bg-red-900/20' : highlight === 'warning' ? 'bg-red-950/15' : 'bg-red-950/10', // Much lighter red background
          border: highlight === 'critical' ? 'border-red-500/40' : highlight === 'warning' ? 'border-red-500/30' : 'border-red-500/20', // Softer borders
          shadow: highlight === 'critical' ? 'shadow-red-500/20' : highlight === 'warning' ? 'shadow-red-500/15' : 'shadow-red-500/10', // Softer shadows
          arrow: '▼',
          highlightClass,
        };
      default:
        // PCR gets yellow, everything else gets soft gray
        if (isPCR) {
          return {
            color: 'text-yellow-400',
            bg: highlight === 'critical' ? 'bg-yellow-900/30' : highlight === 'warning' ? 'bg-yellow-950/35' : 'bg-yellow-950/30',
            border: highlight === 'critical' ? 'border-yellow-500/60' : highlight === 'warning' ? 'border-yellow-500/50' : 'border-yellow-500/40',
            shadow: highlight === 'critical' ? 'shadow-yellow-500/30' : highlight === 'warning' ? 'shadow-yellow-500/25' : 'shadow-yellow-500/20',
            arrow: '━',
            highlightClass: highlight === 'critical' || highlight === 'warning' ? highlightClass : '',
          };
        }
        return {
          color: 'text-gray-300',
          bg: 'bg-gray-800/10',
          border: 'border-gray-600/20',
          shadow: 'shadow-gray-500/10',
          arrow: '━',
          highlightClass: '',
        };
    }
  };

  const config = getStatusConfig();
  const sizeClasses = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex items-center justify-between ${sizeClasses} p-2 rounded ${config.bg}`}>
      <span className="text-gray-500 font-medium">{label}</span>
      <div className={`flex items-center gap-1.5 ${config.color} font-bold px-3 py-1.5 rounded-lg border-2 ${config.border} shadow-md ${config.shadow} transition-all ${config.highlightClass}`}>
        {showArrow && status !== 'neutral' && (
          <span className="text-xs">{config.arrow}</span>
        )}
        <span>
          {prefix}
          {typeof value === 'number' ? value.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : value}
          {suffix}
        </span>
        {highlight === 'critical' && <span className="ml-1 text-xs opacity-70">🔥</span>}
        {highlight === 'warning' && <span className="ml-1 text-xs opacity-60">⚠️</span>}
      </div>
    </div>
  );
};

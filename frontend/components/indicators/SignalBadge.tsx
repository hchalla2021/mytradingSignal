/**
 * SignalBadge - Visual signal indicator with animations
 * Shows BUY/SELL signals with confidence and styling
 */

import React from 'react';
import { SignalType } from '@/types/analysis';

interface SignalBadgeProps {
  signal: SignalType;
  confidence: number;
  size?: 'sm' | 'md' | 'lg';
  showConfidence?: boolean;
  animated?: boolean;
}

export const SignalBadge: React.FC<SignalBadgeProps> = ({
  signal,
  confidence,
  size = 'md',
  showConfidence = true,
  animated = true,
}) => {
  const getSignalConfig = () => {
    switch (signal) {
      case SignalType.STRONG_BUY:
        return {
          label: '🚀 STRONG BUY',
          bg: 'bg-emerald-900',
          text: 'text-emerald-300',
          border: 'border-emerald-800',
          glow: 'shadow-emerald-900/30',
          pulse: true,
        };
      case SignalType.BUY_SIGNAL:
        return {
          label: '✅ BUY',
          bg: 'bg-green-900',
          text: 'text-green-300',
          border: 'border-green-800',
          glow: 'shadow-green-900/30',
          pulse: false,
        };
      case SignalType.STRONG_SELL:
        return {
          label: '🔻 STRONG SELL',
          bg: 'bg-rose-900',
          text: 'text-rose-300',
          border: 'border-rose-800',
          glow: 'shadow-rose-900/30',
          pulse: true,
        };
      case SignalType.SELL_SIGNAL:
        return {
          label: '❌ SELL',
          bg: 'bg-red-900',
          text: 'text-red-300',
          border: 'border-red-800',
          glow: 'shadow-red-900/30',
          pulse: false,
        };
      case SignalType.NO_TRADE:
        return {
          label: '⛔ NO TRADE',
          bg: 'bg-gray-900',
          text: 'text-gray-400',
          border: 'border-gray-800',
          glow: 'shadow-gray-900/20',
          pulse: false,
        };
      case SignalType.WAIT:
      default:
        return {
          label: '⏸️ WAIT',
          bg: 'bg-amber-900',
          text: 'text-amber-300',
          border: 'border-amber-800',
          glow: 'shadow-amber-900/30',
          pulse: false,
        };
    }
  };

  const config = getSignalConfig();
  
  const sizeClasses = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-lg',
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`
          ${config.bg} ${config.text} ${sizeClasses[size]}
          border-2 border-green-500/40
          rounded-lg font-bold
          shadow-lg shadow-green-500/20
          ${animated && config.pulse ? 'animate-pulse' : ''}
          transition-all duration-300
          flex items-center gap-2
          bg-green-950/10
        `}
      >
        <span>{config.label}</span>
        {showConfidence && (
          <span className="text-xs opacity-90 border-2 border-green-500/40 rounded px-1.5 py-0.5 bg-green-950/10">
            {confidence < 0.05 ? 0 : Math.round(confidence * 100)}%
          </span>
        )}
      </div>
    </div>
  );
};

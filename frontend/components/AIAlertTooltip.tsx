"use client";

import { useEffect, useState } from 'react';
import type { AIAlertTooltipData, AlertLevel } from '@/types/ai';

interface Props {
  data: AIAlertTooltipData;
  onDismiss?: () => void;
}

const ALERT_COLORS: Record<AlertLevel, { bg: string; border: string; text: string }> = {
  CRITICAL: {
    bg: 'bg-red-950/90',
    border: 'border-red-500',
    text: 'text-red-400',
  },
  HIGH: {
    bg: 'bg-orange-950/90',
    border: 'border-orange-500',
    text: 'text-orange-400',
  },
  MEDIUM: {
    bg: 'bg-yellow-950/90',
    border: 'border-yellow-500',
    text: 'text-yellow-400',
  },
  INFO: {
    bg: 'bg-blue-950/90',
    border: 'border-blue-500',
    text: 'text-blue-400',
  },
};

export default function AIAlertTooltip({ data, onDismiss }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (data.showAlert) {
      setVisible(true);
      
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        handleDismiss();
      }, 5000);
      
      return () => clearTimeout(timer);
    } else {
      setVisible(false);
    }
  }, [data.showAlert, data.message]);

  const handleDismiss = () => {
    setVisible(false);
    onDismiss?.();
  };

  if (!visible || !data.showAlert) return null;

  const colors = ALERT_COLORS[data.level] || ALERT_COLORS.INFO;

  return (
    <div
      className={`absolute top-2 right-2 z-50 ${colors.bg} ${colors.border} border-2 rounded-lg 
        p-3 shadow-2xl animate-pulse-slow backdrop-blur-sm min-w-[200px] max-w-[300px]`}
      onClick={handleDismiss}
    >
      {/* Fire Icon with Level Badge */}
      <div className="flex items-start gap-2">
        <div className="flex-shrink-0">
          <div className="text-2xl animate-bounce">🔥</div>
        </div>
        
        <div className="flex-1">
          {/* Alert Level */}
          <div className={`text-xs font-bold ${colors.text} mb-1`}>
            {data.level} ALERT
          </div>
          
          {/* Message */}
          <div className="text-white text-sm font-medium mb-2">
            {data.message}
          </div>
          
          {/* Signal Strength (if available) */}
          {data.signalStrength !== undefined && data.signalStrength >= 80 && (
            <div className="flex items-center gap-2 mb-2">
              <div className="text-xs text-gray-400">Signal Strength:</div>
              <div className={`text-sm font-bold ${colors.text}`}>
                {data.signalStrength}%
              </div>
            </div>
          )}
          
          {/* Dismiss hint */}
          <div className="text-xs text-gray-500 italic">
            Click to dismiss
          </div>
        </div>
        
        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-gray-400 hover:text-white transition-colors"
          aria-label="Dismiss alert"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

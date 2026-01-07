'use client';

import React, { memo } from 'react';
import { Wifi, WifiOff, Loader2, AlertCircle, Zap } from 'lucide-react';

interface LiveStatusProps {
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  isConnected: boolean;
}

const LiveStatus: React.FC<LiveStatusProps> = memo(({ status, isConnected }) => {
  const getStatusConfig = () => {
    switch (status) {
      case 'connected':
        return {
          icon: <Wifi className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Connected to market feed',
          shortText: 'Connected',
          bgColor: 'bg-gradient-to-r from-teal-500/15 to-emerald-500/10',
          textColor: 'text-teal-300',
          borderColor: 'border-bullish/40',
          glowClass: 'shadow-md shadow-bullish/20',
        };
      case 'connecting':
        return {
          icon: <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />,
          text: 'Connecting to market feed...',
          shortText: 'Connecting...',
          bgColor: 'bg-gradient-to-r from-amber-500/15 to-yellow-500/10',
          textColor: 'text-amber-300',
          borderColor: 'border-bullish/40',
          glowClass: 'shadow-md shadow-bullish/20',
        };
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Connection error - retrying...',
          shortText: 'Retrying...',
          bgColor: 'bg-gradient-to-r from-rose-500/15 to-red-500/10',
          textColor: 'text-rose-300',
          borderColor: 'border-bullish/40',
          glowClass: 'shadow-md shadow-bullish/20',
        };
      default:
        return {
          icon: <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Disconnected - reconnecting...',
          shortText: 'Reconnecting',
          bgColor: 'bg-gradient-to-r from-slate-500/15 to-gray-500/10',
          textColor: 'text-slate-300',
          borderColor: 'border-bullish/40',
          glowClass: 'shadow-md shadow-bullish/20',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <div
      className={`
        flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm sm:text-base font-semibold
        border-2 transition-all duration-200
        ${config.bgColor} ${config.borderColor} ${config.textColor} ${config.glowClass}
      `}
    >
      {config.icon}
      <span className="hidden sm:inline font-bold">{config.text}</span>
      <span className="sm:hidden font-bold">{config.shortText}</span>
      
      {isConnected && (
        <span className="ml-auto flex items-center gap-1.5 text-xs sm:text-sm text-teal-300 font-black">
          <Zap className="w-4 h-4 fill-teal-400 text-teal-400" />
          Live
        </span>
      )}
    </div>
  );
});

LiveStatus.displayName = 'LiveStatus';

export default LiveStatus;

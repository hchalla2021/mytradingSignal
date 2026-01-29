'use client';

import React, { memo } from 'react';
import { Wifi, WifiOff, Loader2, AlertCircle, Zap } from 'lucide-react';

interface LiveStatusProps {
  status: 'CONNECTING' | 'CONNECTED' | 'SUBSCRIBED' | 'LIVE' | 'RECONNECTING' | 'STALE' | 'NO_TICKS' | 'ERROR' | 'FAILED' | 'DISCONNECTED' | 'MOBILE_SLOW' | 'OFFLINE' | 'WAITING' | 'connecting' | 'connected' | 'disconnected' | 'error';
  isConnected: boolean;
}

const LiveStatus: React.FC<LiveStatusProps> = memo(({ status, isConnected }) => {
  const getStatusConfig = () => {
    // Normalize status to handle both old and new formats
    const normalizedStatus = status.toLowerCase();
    
    switch (status) {
      case 'LIVE':
        return {
          icon: <Zap className="w-4 h-4 sm:w-5 sm:h-5 fill-bullish text-bullish" />,
          text: 'Live market data',
          shortText: 'Live',
          bgColor: 'bg-gradient-to-r from-emerald-500/15 to-teal-500/10',
          textColor: 'text-emerald-300',
          borderColor: 'border-bullish/40',
          glowClass: 'shadow-md shadow-bullish/20',
        };
      case 'CONNECTED':
      case 'SUBSCRIBED':
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
      case 'CONNECTING':
      case 'connecting':
        return {
          icon: <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />,
          text: 'Connecting to market feed...',
          shortText: 'Connecting...',
          bgColor: 'bg-gradient-to-r from-amber-500/15 to-yellow-500/10',
          textColor: 'text-amber-300',
          borderColor: 'border-amber-500/40',
          glowClass: 'shadow-md shadow-amber-500/20',
        };
      case 'RECONNECTING':
        return {
          icon: <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />,
          text: 'Reconnecting to market feed...',
          shortText: 'Reconnecting...',
          bgColor: 'bg-gradient-to-r from-orange-500/15 to-amber-500/10',
          textColor: 'text-orange-300',
          borderColor: 'border-orange-500/40',
          glowClass: 'shadow-md shadow-orange-500/20',
        };
      case 'STALE':
      case 'NO_TICKS':
      case 'MOBILE_SLOW':
        return {
          icon: <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Connection slow - checking data...',
          shortText: 'Slow Connection',
          bgColor: 'bg-gradient-to-r from-yellow-500/15 to-orange-500/10',
          textColor: 'text-yellow-300',
          borderColor: 'border-yellow-500/40',
          glowClass: 'shadow-md shadow-yellow-500/20',
        };
      case 'ERROR':
      case 'FAILED':
      case 'error':
        return {
          icon: <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Connection error - retrying...',
          shortText: 'Error',
          bgColor: 'bg-gradient-to-r from-rose-500/15 to-red-500/10',
          textColor: 'text-rose-300',
          borderColor: 'border-rose-500/40',
          glowClass: 'shadow-md shadow-rose-500/20',
        };
      case 'DISCONNECTED':
      case 'disconnected':
      default:
        return {
          icon: <WifiOff className="w-4 h-4 sm:w-5 sm:h-5" />,
          text: 'Disconnected - reconnecting...',
          shortText: 'Disconnected',
          bgColor: 'bg-gradient-to-r from-slate-500/15 to-gray-500/10',
          textColor: 'text-slate-300',
          borderColor: 'border-slate-500/40',
          glowClass: 'shadow-md shadow-slate-500/20',
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
        <span className="ml-auto flex items-center gap-1.5 text-xs sm:text-sm font-black">
          <Zap className="w-4 h-4 fill-teal-400 text-teal-400" />
          <span className="text-teal-300">Live</span>
        </span>
      )}
    </div>
  );
});

LiveStatus.displayName = 'LiveStatus';

export default LiveStatus;

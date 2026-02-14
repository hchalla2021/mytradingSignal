'use client';

import React, { useMemo } from 'react';

export type WebSocketStatus = 
  | 'OFFLINE' 
  | 'CONNECTING' 
  | 'CONNECTED' 
  | 'SUBSCRIBED'
  | 'LIVE' 
  | 'STALE' 
  | 'NO_TICKS'
  | 'WAITING'
  | 'RECONNECTING'
  | 'ERROR'
  | 'FAILED';

interface ProductionLiveStatusProps {
  status: WebSocketStatus;
  message: string;
  isReceivingData: boolean;
  connectionQuality: 'excellent' | 'good' | 'connecting' | 'poor' | 'offline';
  lastTickTime: number | null;
  tickCount: number;
  onReconnect?: () => void;
}

export default function ProductionLiveStatus({
  status,
  message,
  isReceivingData,
  connectionQuality,
  lastTickTime,
  tickCount,
  onReconnect
}: ProductionLiveStatusProps) {
  
  const timeSinceLastTick = useMemo(() => {
    if (!lastTickTime) return null;
    const diff = Date.now() - lastTickTime;
    const minutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    
    if (minutes > 0) {
      return `${minutes}m ${seconds}s ago`;
    }
    return `${seconds}s ago`;
  }, [lastTickTime]);

  const statusConfig = useMemo(() => {
    switch (status) {
      case 'LIVE':
        return {
          text: 'LIVE DATA',
          description: 'Receiving real-time market ticks',
          bgColor: 'bg-green-900/40',
          borderColor: 'border-green-500/60',
          textColor: 'text-green-300',
          pulseColor: 'bg-green-500',
          showReconnect: false,
        };
      
      case 'CONNECTED':
      case 'SUBSCRIBED':
        return {
          text: 'CONNECTED',
          description: 'Connected, waiting for market data...',
          bgColor: 'bg-blue-900/40',
          borderColor: 'border-blue-500/60', 
          textColor: 'text-blue-300',
          pulseColor: 'bg-blue-500',
          showReconnect: false,
        };
        
      case 'WAITING':
        return {
          text: 'WAITING',
          description: 'Waiting for market start',
          bgColor: 'bg-amber-900/40',
          borderColor: 'border-amber-500/60',
          textColor: 'text-amber-300',
          pulseColor: 'bg-amber-500',
          showReconnect: false,
        };
        
      case 'CONNECTING':
      case 'RECONNECTING':
        return {
          text: status === 'CONNECTING' ? 'CONNECTING' : 'RECONNECTING',
          description: 'Establishing connection to Zerodha...',
          bgColor: 'bg-yellow-900/40',
          borderColor: 'border-yellow-500/60',
          textColor: 'text-yellow-300',
          pulseColor: 'bg-yellow-500',
          showReconnect: false,
        };
        
      case 'STALE':
      case 'NO_TICKS':
        return {
          text: 'SILENT CONNECTION',
          description: 'Connected but no data',
          bgColor: 'bg-orange-900/40',
          borderColor: 'border-orange-500/60',
          textColor: 'text-orange-300',
          pulseColor: 'bg-orange-500',
          showReconnect: true,
        };
        
      case 'ERROR':
      case 'FAILED':
        return {
          text: 'ERROR',
          description: 'Connection failed',
          bgColor: 'bg-red-900/40',
          borderColor: 'border-red-500/60',
          textColor: 'text-red-300',
          pulseColor: 'bg-red-500',
          showReconnect: true,
        };
        
      default:
        return {
          text: 'OFFLINE',
          description: 'Not connected',
          bgColor: 'bg-gray-900/40',
          borderColor: 'border-gray-500/60',
          textColor: 'text-gray-400',
          pulseColor: 'bg-gray-500',
          showReconnect: true,
        };
    }
  }, [status]);

  return (
    <div className={`
      relative overflow-hidden rounded-xl border-2 p-4 transition-all duration-300
      ${statusConfig.bgColor} ${statusConfig.borderColor}
      hover:shadow-lg hover:scale-[1.02]
    `}>
      {isReceivingData && (
        <div className="absolute inset-0 bg-gradient-to-r from-green-500/5 via-green-500/10 to-green-500/5 animate-pulse" />
      )}
      
      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="text-2xl font-bold text-white">[{status}]</div>
            <div className={`
              absolute -top-1 -right-1 w-3 h-3 rounded-full
              ${statusConfig.pulseColor}
              ${(status === 'CONNECTING' || status === 'RECONNECTING' || status === 'LIVE') ? 'animate-pulse' : ''}
            `} />
          </div>
          
          <div>
            <div className={`font-bold text-lg ${statusConfig.textColor}`}>
              {statusConfig.text}
            </div>
            <div className="text-sm text-gray-400">
              {statusConfig.description}
            </div>
            {message && (
              <div className="text-xs text-gray-500 mt-1">
                {message}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="text-right">
            {tickCount > 0 && (
              <div className="text-sm font-bold text-gray-300">
                {tickCount.toLocaleString()} ticks
              </div>
            )}
            {timeSinceLastTick && (
              <div className="text-xs text-gray-500">
                Last: {timeSinceLastTick}
              </div>
            )}
          </div>
          
          {statusConfig.showReconnect && onReconnect && (
            <button
              onClick={onReconnect}
              className="
                px-4 py-2 text-sm font-bold
                bg-blue-600/80 hover:bg-blue-600 
                text-white rounded-lg
                border border-blue-500/50
                transition-colors duration-200
                hover:shadow-lg
              "
            >
              Reconnect
            </button>
          )}
        </div>
      </div>
      
      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-gray-500">Quality:</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4].map((level) => {
            const isActive = (() => {
              switch (connectionQuality) {
                case 'excellent': return level <= 4;
                case 'good': return level <= 3;
                case 'connecting': return level <= 2;
                case 'poor': return level <= 1;
                default: return false;
              }
            })();
            
            return (
              <div
                key={level}
                className={`
                  w-2 h-4 rounded-sm transition-colors
                  ${isActive 
                    ? connectionQuality === 'excellent' ? 'bg-green-500'
                      : connectionQuality === 'good' ? 'bg-blue-500'
                      : connectionQuality === 'connecting' ? 'bg-yellow-500'
                      : 'bg-orange-500'
                    : 'bg-gray-600'
                  }
                `}
              />
            );
          })}
        </div>
        
        <span className={`
          text-xs font-medium
          ${connectionQuality === 'excellent' ? 'text-green-400'
            : connectionQuality === 'good' ? 'text-blue-400'
            : connectionQuality === 'connecting' ? 'text-yellow-400'
            : connectionQuality === 'poor' ? 'text-orange-400'
            : 'text-gray-500'
          }
        `}>
          {connectionQuality.charAt(0).toUpperCase() + connectionQuality.slice(1)}
        </span>
        
        <div className="ml-auto">
          <div className="text-xs text-gray-500">
            {new Date().toLocaleTimeString('en-IN', {
              timeZone: 'Asia/Kolkata',
              hour12: false
            })} IST
          </div>
        </div>
      </div>
    </div>
  );
}

ProductionLiveStatus.displayName = 'ProductionLiveStatus';

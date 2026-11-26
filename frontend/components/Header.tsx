'use client';

import React, { useState, useEffect, memo } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface HeaderProps {
  isConnected: boolean;
  marketStatus: 'LIVE' | 'PRE_OPEN' | 'FREEZE' | 'CLOSED' | 'OFFLINE';
}

const Header: React.FC<HeaderProps> = memo(({ isConnected, marketStatus }) => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

  const { isAuthenticated, isValidating, user, login } = useAuth();

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        })
      );
      setCurrentDate(
        now.toLocaleDateString('en-IN', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      );
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);

    return () => clearInterval(interval);
  }, []);



  return (
    <header className="sticky top-0 z-50 border-b border-sky-500/25 bg-gradient-to-r from-dark-card via-dark-card to-dark-surface shadow-xl shadow-black/40 backdrop-blur-md">
      <div className="w-full px-3 sm:px-5 lg:px-7 py-3 sm:py-3.5">
        <div className="mx-auto flex w-full max-w-[1820px] items-center justify-between gap-3 sm:gap-4">
          {/* Logo */}
          <div className="flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3.5">
            {/* Icon with soft cool glow effect */}
            <a href="/" className="relative flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-400/30 via-teal-400/20 to-indigo-400/30 rounded-xl blur-lg"></div>
              <div className="relative h-10 w-10 sm:h-11 sm:w-11 bg-gradient-to-br from-sky-500 via-teal-500 to-indigo-500 rounded-xl flex items-center justify-center border-2 border-white/15 shadow-xl shadow-sky-500/20">
                <TrendingUp className="h-4 w-4 sm:h-5.5 sm:w-5.5 text-white drop-shadow-lg" />
              </div>
            </a>
            {/* Brand Name - Responsive for mobile */}
            <div className="min-w-0 overflow-hidden leading-none">
              <h1 className="truncate text-[18px] sm:text-[26px] lg:text-[30px] font-black tracking-tight">
                <span className="text-sky-300">My</span>
                <span className="text-teal-300">Daily</span>
                <span className="text-cyan-300">Trading</span>
                <span className="text-indigo-300">Signals</span>
              </h1>
              <p className="mt-1 hidden xs:block text-[8px] sm:text-[10px] font-semibold tracking-[0.1em] uppercase whitespace-nowrap">
                <span className="text-sky-400/60">Real</span>
                <span className="text-white/20"> • </span>
                <span className="text-teal-400/60">Time</span>
                <span className="text-white/20"> • </span>
                <span className="text-cyan-400/60">Market</span>
                <span className="text-white/20"> • </span>
                <span className="text-indigo-400/60">Intelligence</span>
              </p>
            </div>
          </div>

          {/* Live Status - Based on actual market data from Zerodha */}
          <div className="flex flex-shrink-0 items-center gap-2 sm:gap-2.5">
            {/* Zerodha Login Button - Shows only when not authenticated */}
            {!isAuthenticated && !isValidating && (
              <button
                onClick={login}
                className="flex items-center gap-1.5 rounded-xl border border-blue-400/35 bg-gradient-to-r from-blue-500/12 to-indigo-500/12 px-3 py-2 sm:px-3.5 sm:py-2 transition-all hover:border-blue-300/60 hover:bg-blue-500/20 active:scale-95 shadow-lg shadow-blue-500/10"
              >
                <span className="text-[10px] sm:text-xs font-bold tracking-wider text-blue-200">
                  🔑 LOGIN
                </span>
              </button>
            )}
            
            {/* Validating State */}
            {isValidating && (
              <div className="flex items-center gap-1.5 rounded-xl border border-blue-400/25 bg-blue-500/10 px-2.5 py-1.5">
                <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-blue-400" />
                <span className="text-[8px] sm:text-[10px] font-medium text-blue-300/80">Checking...</span>
              </div>
            )}
            
            {/* Authenticated User Badge */}
            {isAuthenticated && user && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-xl border border-green-400/30 bg-green-500/10 px-2.5 py-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[10px] font-semibold text-green-300 truncate max-w-[100px]">
                  {user.userName || user.userId}
                </span>
              </div>
            )}


            
            {(() => {
              const isMarketLive = marketStatus === 'LIVE' && isConnected;
              const isPreOpen = marketStatus === 'PRE_OPEN' && isConnected;
              const isFreeze = marketStatus === 'FREEZE' && isConnected;
              const isMarketClosed = marketStatus === 'CLOSED';
              const isOffline = marketStatus === 'OFFLINE';
              const isDisconnected = !isConnected;

              let statusConfig;

              if (isDisconnected) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-rose-500/10 to-red-500/10',
                  borderClass: 'border-rose-400/30',
                  dotClass: 'bg-rose-500',
                  textClass: 'text-rose-400',
                  label: 'CONNECTION LOST'
                };
              } else if (isMarketLive) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-teal-500/10 to-emerald-500/10',
                  borderClass: 'border-teal-400/30 shadow-lg shadow-teal-500/10',
                  dotClass: 'bg-teal-400 animate-pulse shadow-lg shadow-teal-400/50',
                  textClass: 'text-teal-300',
                  label: 'LIVE'
                };
              } else if (isPreOpen) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-yellow-500/10 to-amber-500/10',
                  borderClass: 'border-yellow-400/30 shadow-lg shadow-yellow-500/10',
                  dotClass: 'bg-yellow-400 animate-pulse shadow-lg shadow-yellow-400/50',
                  textClass: 'text-yellow-300',
                  label: 'PRE-OPEN'
                };
              } else if (isFreeze) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-orange-500/10 to-yellow-500/10',
                  borderClass: 'border-orange-400/30 shadow-lg shadow-orange-500/10',
                  dotClass: 'bg-orange-400 animate-pulse shadow-lg shadow-orange-400/50',
                  textClass: 'text-orange-300',
                  label: 'FREEZE'
                };
              } else if (isMarketClosed) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-amber-500/10 to-orange-500/10',
                  borderClass: 'border-amber-400/30',
                  dotClass: 'bg-amber-400',
                  textClass: 'text-amber-300',
                  label: 'MARKET CLOSED'
                };
              } else if (isOffline) {
                // OFFLINE = connected to backend but no tick data yet
                // Show "CONNECTING..." instead of misleading "MARKET CLOSED"
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-blue-500/10 to-cyan-500/10',
                  borderClass: 'border-blue-400/30',
                  dotClass: 'bg-blue-400 animate-pulse',
                  textClass: 'text-blue-300',
                  label: 'WAITING FOR DATA'
                };
              } else {
                // Default fallback - should never happen but ensures label is never blank
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-blue-500/10 to-cyan-500/10',
                  borderClass: 'border-blue-400/30',
                  dotClass: 'bg-blue-400 animate-pulse',
                  textClass: 'text-blue-300',
                  label: 'WAITING FOR DATA'
                };
              }

              return (
                <div suppressHydrationWarning className={`flex items-center gap-1.5 sm:gap-2 rounded-xl border px-2.5 py-1.5 sm:px-3 sm:py-2 ${statusConfig.bgClass} ${statusConfig.borderClass}`}>
                  <div className={`h-2 w-2 sm:h-2.5 sm:w-2.5 rounded-full ${statusConfig.dotClass}`} />
                  <span suppressHydrationWarning className={`text-[10px] sm:text-xs font-bold tracking-[0.08em] ${statusConfig.textClass}`}>
                    {statusConfig.label}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Time & Date - Hidden on very small screens */}
          <div className="hidden md:block text-right flex-shrink-0 rounded-xl border border-sky-500/25 bg-gradient-to-br from-dark-surface/90 to-dark-bg/70 px-3 py-2 shadow-lg">
            <div suppressHydrationWarning className="text-base sm:text-lg font-mono font-black tracking-wide">
              <span suppressHydrationWarning className="text-sky-300">{currentTime.split(':')[0]}</span>
              <span suppressHydrationWarning className="text-white/40">:</span>
              <span suppressHydrationWarning className="text-teal-300">{currentTime.split(':')[1]}</span>
              <span suppressHydrationWarning className="text-white/40">:</span>
              <span suppressHydrationWarning className="text-indigo-300">{currentTime.split(':')[2]}</span>
            </div>
            <div suppressHydrationWarning className="mt-0.5 text-[10px] font-semibold tracking-wide flex items-center justify-end gap-1">
              <span className="text-amber-400/80">📅</span>
              <span suppressHydrationWarning className="text-slate-300">{currentDate}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

export default Header;

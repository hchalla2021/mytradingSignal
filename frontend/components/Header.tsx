'use client';

import React, { useState, useEffect, memo } from 'react';
import { Activity, TrendingUp } from 'lucide-react';

interface HeaderProps {
  isConnected: boolean;
  marketStatus: 'LIVE' | 'OFFLINE' | 'DEMO';
}

const Header: React.FC<HeaderProps> = memo(({ isConnected, marketStatus }) => {
  const [currentTime, setCurrentTime] = useState<string>('');
  const [currentDate, setCurrentDate] = useState<string>('');

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
    <header className="bg-gradient-to-r from-dark-card via-dark-card to-dark-surface border-b-2 border-sky-500/20 sticky top-0 z-50 shadow-xl shadow-black/40">
      <div className="w-full px-2 sm:px-4 lg:px-6 py-2.5 sm:py-3">
        <div className="flex items-center justify-between gap-2 sm:gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-shrink">
            {/* Icon with soft cool glow effect */}
            <a href="/" className="relative flex-shrink-0">
              <div className="absolute inset-0 bg-gradient-to-br from-sky-400/30 via-teal-400/20 to-indigo-400/30 rounded-xl blur-lg"></div>
              <div className="relative w-9 h-9 sm:w-11 sm:h-11 bg-gradient-to-br from-sky-500 via-teal-500 to-indigo-500 rounded-xl flex items-center justify-center border-2 border-white/15 shadow-xl shadow-sky-500/20">
                <TrendingUp className="w-4 h-4 sm:w-6 sm:h-6 text-white drop-shadow-lg" />
              </div>
            </a>
            {/* Brand Name - Responsive for mobile */}
            <div className="min-w-0 overflow-hidden">
              <h1 className="text-[10px] xs:text-xs sm:text-lg lg:text-xl font-black tracking-tight">
                <span className="text-sky-300">My</span>
                <span className="text-teal-300">Daily</span>
                <span className="text-cyan-300">Trading</span>
                <span className="text-indigo-300">Signals</span>
              </h1>
              <p className="text-[5.5px] xs:text-[7px] sm:text-[9px] font-semibold tracking-[0.02em] xs:tracking-[0.06em] sm:tracking-[0.15em] uppercase whitespace-nowrap">
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
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* Zerodha Login Button */}
            {!isConnected && (
              <a 
                href="/login"
                className="flex items-center gap-1 px-2 py-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border-2 bg-gradient-to-r from-blue-500/10 to-indigo-500/10 border-blue-400/30 hover:border-blue-400/50 transition-all"
              >
                <span className="text-[9px] sm:text-xs font-bold tracking-wider text-blue-300">
                  🔑 LOGIN
                </span>
              </a>
            )}
            
            {(() => {
              const isMarketLive = marketStatus === 'LIVE' && isConnected;
              const isMarketClosed = marketStatus === 'OFFLINE';
              const isDemo = marketStatus === 'DEMO';
              const isDisconnected = !isConnected;

              let statusConfig = {
                bgClass: '',
                borderClass: '',
                dotClass: '',
                textClass: '',
                label: ''
              };

              if (isDisconnected) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-rose-500/10 to-red-500/10',
                  borderClass: 'border-rose-400/30',
                  dotClass: 'bg-rose-500',
                  textClass: 'text-rose-400',
                  label: 'OFFLINE'
                };
              } else if (isMarketLive) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-teal-500/10 to-emerald-500/10',
                  borderClass: 'border-teal-400/30 shadow-lg shadow-teal-500/10',
                  dotClass: 'bg-teal-400 animate-pulse shadow-lg shadow-teal-400/50',
                  textClass: 'text-teal-300',
                  label: 'LIVE'
                };
              } else if (isMarketClosed) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-amber-500/10 to-orange-500/10',
                  borderClass: 'border-amber-400/30',
                  dotClass: 'bg-amber-400',
                  textClass: 'text-amber-300',
                  label: 'MARKET CLOSED'
                };
              } else if (isDemo) {
                statusConfig = {
                  bgClass: 'bg-gradient-to-r from-purple-500/10 to-violet-500/10',
                  borderClass: 'border-purple-400/30',
                  dotClass: 'bg-purple-400 animate-pulse',
                  textClass: 'text-purple-300',
                  label: 'DEMO'
                };
              }

              return (
                <div className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg border-2 ${statusConfig.bgClass} ${statusConfig.borderClass}`}>
                  <div className={`w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full ${statusConfig.dotClass}`} />
                  <span className={`text-[9px] sm:text-xs font-bold tracking-wider ${statusConfig.textClass}`}>
                    {statusConfig.label}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Time & Date - Hidden on very small screens */}
          <div className="hidden xs:block text-right flex-shrink-0 bg-gradient-to-br from-dark-surface/90 to-dark-bg/70 px-2 sm:px-3 py-1.5 sm:py-2 rounded-xl border-2 border-sky-500/20 shadow-lg">
            <div className="text-sm sm:text-lg font-mono font-black tracking-wide">
              <span className="text-sky-300">{currentTime.split(':')[0]}</span>
              <span className="text-white/40">:</span>
              <span className="text-teal-300">{currentTime.split(':')[1]}</span>
              <span className="text-white/40">:</span>
              <span className="text-indigo-300">{currentTime.split(':')[2]}</span>
            </div>
            <div className="text-[8px] sm:text-[10px] font-semibold tracking-wide flex items-center justify-end gap-1">
              <span className="text-amber-400/80">📅</span>
              <span className="text-slate-300">{currentDate}</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

export default Header;

'use client';

import { useState, useEffect } from 'react';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import Header from '@/components/Header';
import IndexCard from '@/components/IndexCard';
import LiveStatus from '@/components/LiveStatus';

export default function Home() {
  const { marketData, isConnected, connectionStatus } = useMarketSocket();
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-IN'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine market status from actual data
  const marketStatus = marketData.NIFTY?.status || marketData.BANKNIFTY?.status || marketData.SENSEX?.status || 'OFFLINE';

  return (
    <main className="min-h-screen bg-[#0d0d12]">
      {/* Header */}
      <Header isConnected={isConnected} marketStatus={marketStatus} />

      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-6 py-1.5">
        <LiveStatus status={connectionStatus} isConnected={isConnected} />
      </div>

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-6 py-3 sm:py-4">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
          <div>
            <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white flex items-center gap-2 tracking-tight">
              <span className="w-1 h-4 sm:h-5 bg-gradient-to-b from-bullish to-bullish/50 rounded-full" />
              Live Market Indices
            </h2>
            <p className="text-dark-muted text-[10px] sm:text-xs mt-0.5 ml-3 font-medium">Real-time NSE & BSE Index Data</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-dark-muted ml-3 sm:ml-0">
            <span className="font-mono bg-dark-surface px-2 py-1 rounded-md text-[10px] border border-dark-border/60 text-dark-text/80 shadow-sm">
              {currentTime || '--:--:--'}
            </span>
          </div>
        </div>
        
        {/* Index Cards Grid - Full Width Responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
          <IndexCard
            symbol="NIFTY"
            name="NIFTY 50"
            data={marketData.NIFTY}
            isConnected={isConnected}
          />
          <IndexCard
            symbol="BANKNIFTY"
            name="BANK NIFTY"
            data={marketData.BANKNIFTY}
            isConnected={isConnected}
          />
          <IndexCard
            symbol="SENSEX"
            name="SENSEX"
            data={marketData.SENSEX}
            isConnected={isConnected}
          />
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-dark-border/50 mt-auto py-2 sm:py-3 bg-dark-card/30">
        <div className="w-full px-2 sm:px-4 lg:px-6 flex items-center justify-between text-dark-muted text-[10px] sm:text-xs font-medium">
          <span>MyDailyTradingSignals © {new Date().getFullYear()}</span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 bg-bullish rounded-full animate-pulse" />
            Built for Harikrishna Challa
          </span>
        </div>
      </footer>
    </main>
  );
}

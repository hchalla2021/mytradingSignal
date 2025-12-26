'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import Header from '@/components/Header';
import IndexCard from '@/components/IndexCard';
import LiveStatus from '@/components/LiveStatus';
import { AnalysisCard } from '@/components/AnalysisCard';

export default function Home() {
  const { marketData, isConnected, connectionStatus } = useMarketSocket();
  const { alertData, loading: aiLoading, error: aiError } = useAIAnalysis();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [updateCounter, setUpdateCounter] = useState(0);

  // ✅ INSTANT: Extract analysis from marketData (comes via WebSocket)
  const analyses = useMemo(() => {
    const niftyAnalysis = marketData.NIFTY?.analysis;
    const bankniftyAnalysis = marketData.BANKNIFTY?.analysis;
    const sensexAnalysis = marketData.SENSEX?.analysis;
    
    // Only return if at least one analysis exists
    if (!niftyAnalysis && !bankniftyAnalysis && !sensexAnalysis) {
      return null;
    }
    
    return {
      NIFTY: niftyAnalysis || null,
      BANKNIFTY: bankniftyAnalysis || null,
      SENSEX: sensexAnalysis || null,
    };
  }, [marketData.NIFTY?.analysis, marketData.BANKNIFTY?.analysis, marketData.SENSEX?.analysis]);

  // Update current time
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-IN'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine market status from actual data (memoized)
  const marketStatus = useMemo(
    () => marketData.NIFTY?.status || marketData.BANKNIFTY?.status || marketData.SENSEX?.status || 'OFFLINE',
    [marketData.NIFTY?.status, marketData.BANKNIFTY?.status, marketData.SENSEX?.status]
  );

  return (
    <main className="min-h-screen">
      {/* Header */}
      <Header isConnected={isConnected} marketStatus={marketStatus} />

      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <LiveStatus status={connectionStatus} isConnected={isConnected} />
      </div>

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-4 sm:py-6">
        {/* Section Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 sm:mb-6">
          <div>
            <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
              <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-bullish to-bullish-dark rounded-full shadow-lg shadow-bullish/30" />
              Live Market Indices
              <span className="relative ml-2 px-4 py-1.5 text-xs sm:text-sm font-bold bg-gradient-to-r from-accent via-accent-secondary to-accent rounded-xl shadow-xl animate-pulse-slow border border-accent/30">
                <span className="relative z-10 flex items-center gap-2">
                  <span className="text-base sm:text-lg">🤖</span>
                  <span className="bg-gradient-to-r from-white via-cyan-100 to-white bg-clip-text text-transparent font-extrabold tracking-wide">AI POWERED</span>
                  <span className="text-base sm:text-lg">✨</span>
                </span>
                <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent-secondary to-accent blur-xl opacity-40 rounded-xl"></span>
              </span>
            </h2>
            <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">Real-time NSE & BSE Index Data with GPT-4 Intelligence</p>
          </div>
        </div>
        
        {/* Index Cards Grid - Full Width Responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 lg:gap-5">
          <IndexCard
            symbol="NIFTY"
            name="NIFTY 50"
            data={marketData.NIFTY}
            isConnected={isConnected}
            aiAlertData={alertData.NIFTY}
          />
          <IndexCard
            symbol="BANKNIFTY"
            name="BANK NIFTY"
            data={marketData.BANKNIFTY}
            isConnected={isConnected}
            aiAlertData={alertData.BANKNIFTY}
          />
          <IndexCard
            symbol="SENSEX"
            name="SENSEX"
            data={marketData.SENSEX}
            isConnected={isConnected}
            aiAlertData={alertData.SENSEX}
          />
        </div>

        {/* Intraday Analysis Section */}
        <div className="mt-10 sm:mt-12 lg:mt-14">
          
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5 sm:mb-7">
            <div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-accent to-accent-secondary rounded-full shadow-lg shadow-accent/30" />
                Intraday Technical Analysis
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                AI-Powered Signals • VWAP • EMA • Support/Resistance • Volume • Momentum • PCR
              </p>
            </div>
            <div className="flex items-center gap-2 ml-4 sm:ml-0">
              <div className={`flex items-center gap-2 text-xs sm:text-sm px-4 py-2 rounded-xl border-2 font-bold shadow-lg transition-all duration-300 ${
                isConnected 
                  ? 'bg-bullish/10 border-bullish/30 text-bullish shadow-bullish/20 hover:shadow-bullish/30' 
                  : 'bg-bearish/10 border-bearish/30 text-bearish shadow-bearish/20'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-bullish' : 'bg-bearish'} animate-pulse`} />
                <span className="tracking-wide">{isConnected ? 'Analysis Live' : 'Disconnected'}</span>
              </div>
            </div>
          </div>

          {/* Analysis Cards Grid - ULTRA-FAST RENDER */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 sm:gap-5 lg:gap-6 xl:gap-7">
            <AnalysisCard analysis={analyses?.NIFTY || null} />
            <AnalysisCard analysis={analyses?.BANKNIFTY || null} />
            <AnalysisCard analysis={analyses?.SENSEX || null} />
          </div>

          {/* Analysis Info Banner */}
          <div className="mt-6 p-5 bg-black/40 border-2 border-green-500/40 rounded-xl shadow-lg shadow-green-500/20">
            <div className="flex items-start gap-4">
              <div className="text-3xl flex-shrink-0">�</div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-white mb-2 flex items-center gap-2.5">
                  LIVE Market Data Analysis
                  <span className={`text-xs px-2.5 py-1 rounded-full font-extrabold shadow-md ${
                    marketStatus === 'LIVE' 
                      ? 'bg-cyan-900/60 text-cyan-300 border-2 border-cyan-500/60 shadow-cyan-500/40 animate-pulse' 
                      : 'bg-red-900/60 text-red-300 border-2 border-red-500/60 shadow-red-500/40'
                  }`}>
                    {marketStatus === 'LIVE' ? '● LIVE' : '● OFFLINE'}
                  </span>
                </h3>
                <p className="text-xs text-gray-300 leading-relaxed mb-2.5">
                  Real-time analysis using <strong className="text-cyan-400 font-bold">LIVE market data from Zerodha KiteTicker</strong>. 
                  All technical indicators are calculated on actual price movements, volume, and order flow.
                </p>
                <p className="text-xs text-gray-300 leading-relaxed">
                  <strong className="text-cyan-400 font-bold">Data Source:</strong> Direct integration with Zerodha Kite API - NO dummy or simulated data. 
                  All prices are actual traded values from NSE/BSE exchanges.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-dark-border/40 mt-auto py-4 sm:py-5 bg-gradient-to-r from-dark-surface/50 to-dark-card/50 backdrop-blur-sm">
        <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 flex items-center justify-between text-dark-muted text-xs sm:text-sm font-medium">
          <span className="tracking-wide">MyDailyTradingSignals © {new Date().getFullYear()}</span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-bullish rounded-full animate-pulse shadow-md shadow-bullish" />
            <span className="hidden sm:inline">Built for</span> Harikrishna Challa
          </span>
        </div>
      </footer>
    </main>
  );
}

'use client';

import { useState, useEffect } from 'react';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import Header from '@/components/Header';
import IndexCard from '@/components/IndexCard';
import LiveStatus from '@/components/LiveStatus';
import { AnalysisCard } from '@/components/AnalysisCard';

export default function Home() {
  const { marketData, isConnected, connectionStatus } = useMarketSocket();
  const { analyses, isConnected: isAnalysisConnected } = useAnalysis();
  const { alertData, loading: aiLoading, error: aiError } = useAIAnalysis();
  const [currentTime, setCurrentTime] = useState<string>('');

  // Debug logging
  useEffect(() => {
    console.log('📊 Analysis State:', { analyses, isAnalysisConnected });
    console.log('🤖 AI Alert Data:', alertData);
  }, [analyses, isAnalysisConnected, alertData]);

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
              <span className="relative ml-2 px-3 py-1 text-xs font-extrabold bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 rounded-lg shadow-lg animate-pulse-slow">
                <span className="relative z-10 flex items-center gap-1.5">
                  <span className="text-base">🤖</span>
                  <span className="bg-gradient-to-r from-white via-cyan-200 to-white bg-clip-text text-transparent">AI POWERED</span>
                  <span className="text-base">✨</span>
                </span>
                <span className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-600 to-blue-600 blur-md opacity-50 rounded-lg"></span>
              </span>
            </h2>
            <p className="text-dark-muted text-[10px] sm:text-xs mt-0.5 ml-3 font-medium">Real-time NSE & BSE Index Data with GPT-4 Intelligence</p>
          </div>
        </div>
        
        {/* Index Cards Grid - Full Width Responsive */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3 lg:gap-4">
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
        <div className="mt-8 sm:mt-10">
          
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 sm:mb-5">
            <div>
              <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white flex items-center gap-2 tracking-tight">
                <span className="w-1 h-4 sm:h-5 bg-gradient-to-b from-emerald-500 to-emerald-600/50 rounded-full shadow-md shadow-emerald-500/50" />
                Intraday Technical Analysis
              </h2>
              <p className="text-white text-[10px] sm:text-xs mt-0.5 ml-3 font-medium">
                AI-Powered Signals • VWAP • EMA • Support/Resistance • Volume • Momentum • PCR
              </p>
            </div>
            <div className="flex items-center gap-2 ml-3 sm:ml-0">
              <div className={`flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-lg border-2 font-bold shadow-md ${
                isAnalysisConnected 
                  ? 'bg-emerald-950/50 border-emerald-500/50 text-emerald-400 shadow-emerald-500/20' 
                  : 'bg-red-950/50 border-red-500/50 text-red-400 shadow-red-500/20'
              }`}>
                <span className={`w-2 h-2 rounded-full ${
                  isAnalysisConnected ? 'bg-emerald-400 animate-pulse shadow-md shadow-emerald-500' : 'bg-red-500'
                }`} />
                {isAnalysisConnected ? 'Analysis Live' : 'Connecting...'}
              </div>
            </div>
          </div>

          {/* Analysis Cards Grid - Always Visible */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4 sm:gap-5 lg:gap-6">
            <AnalysisCard 
              analysis={analyses?.NIFTY || null} 
              isLoading={false}
            />
            <AnalysisCard 
              analysis={analyses?.BANKNIFTY || null} 
              isLoading={false}
            />
            <AnalysisCard 
              analysis={analyses?.SENSEX || null} 
              isLoading={false}
            />
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

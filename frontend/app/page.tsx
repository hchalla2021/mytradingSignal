'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { useOverallMarketOutlook } from '@/hooks/useOverallMarketOutlook';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/Header';
import IndexCard from '@/components/IndexCard';
import LiveStatus from '@/components/LiveStatus';
import { AnalysisCard } from '@/components/AnalysisCard';
import VolumePulseCard from '@/components/VolumePulseCard';
import TrendBaseCard from '@/components/TrendBaseCard';
import ZoneControlCard from '@/components/ZoneControlCard';

export default function Home() {
  const { marketData, isConnected, connectionStatus } = useMarketSocket();
  const { alertData, loading: aiLoading, error: aiError } = useAIAnalysis();
  const { outlookData, loading: outlookLoading } = useOverallMarketOutlook();
  const { isAuthenticated } = useAuth();
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
      
      {/* 🔥 GLOBAL TOKEN ALERT - Shows when token expired for ALL sections */}
      {!isAuthenticated && (
        <div className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-b-2 border-amber-500/50 py-3 px-4 sm:px-6 backdrop-blur-sm sticky top-[72px] z-40">
          <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔑</span>
              <div>
                <p className="text-sm font-bold text-amber-300">Token Expired - All Features Using Cached Data</p>
                <p className="text-[10px] text-amber-200/80">Click LOGIN to refresh from .env • Takes 10 seconds • No restart needed</p>
              </div>
            </div>
            <button
              onClick={() => {
                const loginUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000'}/api/auth/login`;
                window.open(loginUrl, '_blank', 'width=600,height=700');
                setTimeout(() => window.location.reload(), 15000);
              }}
              className="flex-shrink-0 px-4 py-2 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white font-bold rounded-lg transition-all active:scale-95 shadow-lg text-xs whitespace-nowrap"
            >
              🔑 LOGIN NOW
            </button>
          </div>
        </div>
      )}

      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <LiveStatus status={connectionStatus} isConnected={isConnected} />
      </div>

      {/* Overall Market Outlook - Comprehensive Aggregated Analysis */}
      {outlookData && (outlookData.NIFTY || outlookData.BANKNIFTY || outlookData.SENSEX) && (
        <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
          <div className="bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm rounded-xl border-2 border-emerald-500/30 p-3 sm:p-4 shadow-xl shadow-emerald-500/10">
            <h3 className="text-sm sm:text-base font-bold text-dark-text mb-3 flex items-center gap-2">
              <span className="text-lg">📊</span>
              Overall Market Outlook
              <span className="text-[10px] sm:text-xs text-dark-tertiary font-normal ml-2">
                (Aggregated: Technical 30% • Zone Control 25% • Volume 20% • Trend 15% • Market Indices 10%)
              </span>
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* NIFTY Outlook */}
              {outlookData.NIFTY && (
                <div className="bg-dark-surface/40 rounded-lg p-3 border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm sm:text-base font-bold text-dark-text">NIFTY 50</span>
                    <span className={`px-2 py-1 text-xs font-bold rounded-md border-2 ${
                      outlookData.NIFTY.riskLevel === 'LOW' 
                        ? 'bg-green-950/20 text-green-400 border-green-500/40'
                        : outlookData.NIFTY.riskLevel === 'HIGH'
                        ? 'bg-red-950/20 text-red-400 border-red-500/40'
                        : 'bg-yellow-950/20 text-yellow-400 border-yellow-500/40'
                    }`}>
                      {outlookData.NIFTY.riskLevel} RISK
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`flex-1 px-2.5 py-1.5 text-xs font-bold rounded-md border-2 text-center ${
                      outlookData.NIFTY.overallSignal === 'STRONG_BUY'
                        ? 'bg-green-950/20 text-green-300 border-green-500/50'
                        : outlookData.NIFTY.overallSignal === 'BUY'
                        ? 'bg-green-900/20 text-green-400 border-green-500/40'
                        : outlookData.NIFTY.overallSignal === 'STRONG_SELL'
                        ? 'bg-red-950/20 text-red-300 border-red-500/50'
                        : outlookData.NIFTY.overallSignal === 'SELL'
                        ? 'bg-red-900/20 text-red-400 border-red-500/40'
                        : 'bg-gray-900/20 text-gray-400 border-gray-500/40'
                    }`}>
                      {outlookData.NIFTY.overallSignal.replace('_', ' ')}
                    </span>
                    <span className="text-lg font-bold text-emerald-400 bg-emerald-950/20 border-2 border-emerald-500/30 rounded px-2 py-1">
                      {outlookData.NIFTY.overallConfidence}%
                    </span>
                  </div>
                  <p className={`text-[10px] leading-tight font-bold ${
                    outlookData.NIFTY.tradeRecommendation.includes('WAIT') || outlookData.NIFTY.tradeRecommendation.includes('Mixed')
                      ? 'text-white'
                      : outlookData.NIFTY.tradeRecommendation.includes('BUY')
                      ? 'text-emerald-300'
                      : outlookData.NIFTY.tradeRecommendation.includes('SELL')
                      ? 'text-rose-300'
                      : 'text-dark-tertiary'
                  }`}>
                    {outlookData.NIFTY.tradeRecommendation}
                  </p>
                </div>
              )}

              {/* BANKNIFTY Outlook */}
              {outlookData.BANKNIFTY && (
                <div className="bg-dark-surface/40 rounded-lg p-3 border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm sm:text-base font-bold text-dark-text">BANK NIFTY</span>
                    <span className={`px-2 py-1 text-xs font-bold rounded-md border-2 ${
                      outlookData.BANKNIFTY.riskLevel === 'LOW' 
                        ? 'bg-green-950/20 text-green-400 border-green-500/40'
                        : outlookData.BANKNIFTY.riskLevel === 'HIGH'
                        ? 'bg-red-950/20 text-red-400 border-red-500/40'
                        : 'bg-yellow-950/20 text-yellow-400 border-yellow-500/40'
                    }`}>
                      {outlookData.BANKNIFTY.riskLevel} RISK
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`flex-1 px-2.5 py-1.5 text-xs font-bold rounded-md border-2 text-center ${
                      outlookData.BANKNIFTY.overallSignal === 'STRONG_BUY'
                        ? 'bg-green-950/20 text-green-300 border-green-500/50'
                        : outlookData.BANKNIFTY.overallSignal === 'BUY'
                        ? 'bg-green-900/20 text-green-400 border-green-500/40'
                        : outlookData.BANKNIFTY.overallSignal === 'STRONG_SELL'
                        ? 'bg-red-950/20 text-red-300 border-red-500/50'
                        : outlookData.BANKNIFTY.overallSignal === 'SELL'
                        ? 'bg-red-900/20 text-red-400 border-red-500/40'
                        : 'bg-gray-900/20 text-gray-400 border-gray-500/40'
                    }`}>
                      {outlookData.BANKNIFTY.overallSignal.replace('_', ' ')}
                    </span>
                    <span className="text-lg font-bold text-emerald-400 bg-emerald-950/20 border-2 border-emerald-500/30 rounded px-2 py-1">
                      {outlookData.BANKNIFTY.overallConfidence}%
                    </span>
                  </div>
                  <p className={`text-[10px] leading-tight font-bold ${
                    outlookData.BANKNIFTY.tradeRecommendation.includes('WAIT') || outlookData.BANKNIFTY.tradeRecommendation.includes('Mixed')
                      ? 'text-white'
                      : outlookData.BANKNIFTY.tradeRecommendation.includes('BUY')
                      ? 'text-emerald-300'
                      : outlookData.BANKNIFTY.tradeRecommendation.includes('SELL')
                      ? 'text-rose-300'
                      : 'text-dark-tertiary'
                  }`}>
                    {outlookData.BANKNIFTY.tradeRecommendation}
                  </p>
                </div>
              )}

              {/* SENSEX Outlook */}
              {outlookData.SENSEX && (
                <div className="bg-dark-surface/40 rounded-lg p-3 border-2 border-emerald-500/30 shadow-lg shadow-emerald-500/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm sm:text-base font-bold text-dark-text">SENSEX</span>
                    <span className={`px-2 py-1 text-xs font-bold rounded-md border-2 ${
                      outlookData.SENSEX.riskLevel === 'LOW' 
                        ? 'bg-green-950/20 text-green-400 border-green-500/40'
                        : outlookData.SENSEX.riskLevel === 'HIGH'
                        ? 'bg-red-950/20 text-red-400 border-red-500/40'
                        : 'bg-yellow-950/20 text-yellow-400 border-yellow-500/40'
                    }`}>
                      {outlookData.SENSEX.riskLevel} RISK
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`flex-1 px-2.5 py-1.5 text-xs font-bold rounded-md border-2 text-center ${
                      outlookData.SENSEX.overallSignal === 'STRONG_BUY'
                        ? 'bg-green-950/20 text-green-300 border-green-500/50'
                        : outlookData.SENSEX.overallSignal === 'BUY'
                        ? 'bg-green-900/20 text-green-400 border-green-500/40'
                        : outlookData.SENSEX.overallSignal === 'STRONG_SELL'
                        ? 'bg-red-950/20 text-red-300 border-red-500/50'
                        : outlookData.SENSEX.overallSignal === 'SELL'
                        ? 'bg-red-900/20 text-red-400 border-red-500/40'
                        : 'bg-gray-900/20 text-gray-400 border-gray-500/40'
                    }`}>
                      {outlookData.SENSEX.overallSignal.replace('_', ' ')}
                    </span>
                    <span className="text-lg font-bold text-emerald-400 bg-emerald-950/20 border-2 border-emerald-500/30 rounded px-2 py-1">
                      {outlookData.SENSEX.overallConfidence}%
                    </span>
                  </div>
                  <p className={`text-[10px] leading-tight font-bold ${
                    outlookData.SENSEX.tradeRecommendation.includes('WAIT') || outlookData.SENSEX.tradeRecommendation.includes('Mixed')
                      ? 'text-white'
                      : outlookData.SENSEX.tradeRecommendation.includes('BUY')
                      ? 'text-emerald-300'
                      : outlookData.SENSEX.tradeRecommendation.includes('SELL')
                      ? 'text-rose-300'
                      : 'text-dark-tertiary'
                  }`}>
                    {outlookData.SENSEX.tradeRecommendation}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4">
        {/* Live Market Indices - With Border */}
        <div className="border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
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
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-3">
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
        </div>

        {/* Intraday Analysis Section - With Border */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
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
                isConnected && analyses
                  ? 'bg-bullish/10 border-bullish/30 text-bullish shadow-bullish/20 hover:shadow-bullish/30' 
                  : isConnected && !analyses
                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 shadow-yellow-500/20'
                  : 'bg-bearish/10 border-bearish/30 text-bearish shadow-bearish/20'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected && analyses ? 'bg-bullish' : isConnected ? 'bg-yellow-500' : 'bg-bearish'} animate-pulse`} />
                <span className="tracking-wide">
                  {isConnected && analyses ? 'Analysis Live' : isConnected ? 'Loading Data...' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>

          {/* Analysis Cards Grid - ULTRA-FAST RENDER */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3">
            <AnalysisCard analysis={analyses?.NIFTY || null} />
            <AnalysisCard analysis={analyses?.BANKNIFTY || null} />
            <AnalysisCard analysis={analyses?.SENSEX || null} />
          </div>
        </div>

        {/* Zone Control Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-orange-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-orange-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-orange-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-orange-500 to-orange-600 rounded-full shadow-lg shadow-orange-500/30" />
                Zone Control & Breakdown Risk
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Advanced support/resistance zones • Breakdown risk assessment • Key levels
              </p>
            </div>
          </div>

          {/* Zone Control Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3">
            <ZoneControlCard symbol="NIFTY" name="NIFTY 50" />
            <ZoneControlCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <ZoneControlCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Volume Pulse Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-purple-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full shadow-lg shadow-purple-500/30" />
                Volume Pulse (Candle Volume)
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Real-time buying/selling pressure • Green vs Red candle volume tracking
              </p>
            </div>
          </div>

          {/* Volume Pulse Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3">
            <VolumePulseCard symbol="NIFTY" name="NIFTY 50" />
            <VolumePulseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <VolumePulseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Trend Base Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-blue-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-blue-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-blue-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full shadow-lg shadow-blue-500/30" />
                Trend Base (Higher-Low Structure)
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Advanced swing structure analysis • Higher-high/higher-low detection
              </p>
            </div>
          </div>

          {/* Trend Base Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3">
            <TrendBaseCard symbol="NIFTY" name="NIFTY 50" />
            <TrendBaseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <TrendBaseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Analysis Info Banner */}
        <div className="mt-4 p-4 bg-black/40 border-2 border-green-500/40 rounded-xl shadow-lg shadow-green-500/20">
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

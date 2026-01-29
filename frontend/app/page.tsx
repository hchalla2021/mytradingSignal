'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { useOverallMarketOutlook } from '@/hooks/useOverallMarketOutlook';
import { useAuth } from '@/hooks/useAuth';
import Header from '@/components/Header';

// Import status component for both mobile and desktop
const LiveStatus = dynamic(() => import('@/components/LiveStatus'), { 
  ssr: false,
  loading: () => (
    <div className="bg-dark-surface/60 rounded-xl p-4 animate-pulse border border-emerald-500/20">
      <div className="h-4 bg-gray-700 rounded mb-2"></div>
      <div className="h-3 bg-gray-700 rounded w-3/4"></div>
    </div>
  )
});

const SystemStatusBanner = dynamic(() => import('@/components/SystemStatusBanner'), { 
  ssr: false 
});

// Dynamic imports for components that use live data - prevents SSR issues
const IndexCard = dynamic(() => import('@/components/IndexCard'), { 
  ssr: false,
  loading: () => (
    <div className="bg-dark-surface/60 rounded-xl p-6 animate-pulse border border-emerald-500/20">
      <div className="h-6 bg-gray-700 rounded mb-4"></div>
      <div className="h-4 bg-gray-700 rounded mb-2"></div>
      <div className="h-4 bg-gray-700 rounded w-3/4"></div>
    </div>
  )
});

const AnalysisCard = dynamic(() => import('@/components/AnalysisCard').then(mod => ({ default: mod.AnalysisCard })), { 
  ssr: false,
  loading: () => (
    <div className="bg-dark-surface/60 rounded-xl p-6 animate-pulse border border-emerald-500/20">
      <div className="h-4 bg-gray-700 rounded mb-3"></div>
      <div className="h-3 bg-gray-700 rounded mb-2"></div>
      <div className="h-3 bg-gray-700 rounded w-2/3"></div>
    </div>
  )
});

const VWMAEMAFilterCard = dynamic(() => import('@/components/VWMAEMAFilterCard'), { ssr: false });
const VolumePulseCard = dynamic(() => import('@/components/VolumePulseCard'), { ssr: false });
const TrendBaseCard = dynamic(() => import('@/components/TrendBaseCard'), { ssr: false });
const ZoneControlCard = dynamic(() => import('@/components/ZoneControlCard'), { ssr: false });
const CandleIntentCard = dynamic(() => import('@/components/CandleIntentCard'), { ssr: false });
const PivotSectionUnified = dynamic(() => import('@/components/PivotSectionUnified'), { ssr: false });
const PivotDetailedDisplay = dynamic(() => import('@/components/PivotDetailedDisplay'), { ssr: false });

export default function Home() {
  // 🔥 Force fresh mount on page load - fixes desktop browser caching
  const [mountKey, setMountKey] = useState(0);
  const [currentYear, setCurrentYear] = useState(2026); // Static default for SSR
  const [marketConfidence, setMarketConfidence] = useState(50); // Default value for SSR
  const [bankniftyConfidence, setBankniftyConfidence] = useState(50);
  const [sensexConfidence, setSensexConfidence] = useState(50);
  
  // Use standard WebSocket hook
  const {
    marketData,
    connectionStatus,
    isConnected,
    reconnect
  } = useMarketSocket();
  const { alertData, loading: aiLoading, error: aiError } = useAIAnalysis();
  const { outlookData, loading: outlookLoading } = useOverallMarketOutlook();
  const { isAuthenticated } = useAuth();
  const [currentTime, setCurrentTime] = useState<string>('');
  const [updateCounter, setUpdateCounter] = useState(0);

  // 🔥 Clear browser cache on mount (desktop browsers cache aggressively)
  useEffect(() => {
    // Force service worker to update
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(reg => reg.update());
      });
    }
  }, []);

  // Check for auth callback success - guarded for SSR
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Set mount key and current year on client
    setMountKey(Date.now());
    setCurrentYear(new Date().getFullYear());
    
    const params = new URLSearchParams(window.location.search);
    const authStatus = params.get('auth');
    
    if (authStatus === 'success') {
      // Clean URL and reload after 2 seconds
      window.history.replaceState({}, '', '/');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } else if (authStatus === 'error') {
      // Clean URL
      window.history.replaceState({}, '', '/');
    }
  }, []);

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

  // Calculate market confidence on client-side to prevent hydration errors
  useEffect(() => {
    if (!analyses) return;
    
    const calculateIndexConfidence = (indexData) => {
      if (!indexData) return 50;
      
      const confidenceValues = [
        indexData.indicators?.vwma_ema_confidence || (indexData.indicators?.vwma_above_ema200 ? 85 : 25),
        indexData.indicators?.rsi_confidence || (indexData.indicators?.rsi ? 78 : 22),
        indexData.indicators?.ema200_confidence || (indexData.indicators?.is_above_ema200 ? 85 : 20),
        indexData.indicators?.vwap_confidence || (indexData.indicators?.vwap_signal ? 88 : 18),
        indexData.indicators?.ema_alignment_confidence || (indexData.indicators?.ema_alignment ? 75 : 28),
        indexData.indicators?.camarilla_confidence || (indexData.indicators?.camarilla_signal ? 72 : 24),
        indexData.indicators?.supertrend_confidence || (indexData.indicators?.supertrend ? 80 : 15),
        indexData.indicators?.sar_confidence || (indexData.indicators?.sar_signal ? 77 : 21),
        indexData.indicators?.orb_confidence || (indexData.indicators?.orb_signal ? 83 : 19),
        indexData.indicators?.pivot_confidence || (indexData.indicators?.pivot_signal ? 76 : 23),
        indexData.indicators?.zone_confidence || (indexData.analysis?.zoneControl ? 74 : 26),
        indexData.volume?.volume_confidence || (indexData.volume?.buying_pressure || indexData.volume?.selling_pressure ? 72 : 20),
        indexData.indicators?.trend_confidence || (indexData.indicators?.trend_structure ? 78 : 25)
      ].filter(val => val && !isNaN(val));
      
      return confidenceValues.length > 0 
        ? Math.round(confidenceValues.reduce((sum, val) => sum + val, 0) / confidenceValues.length)
        : 50;
    };

    setMarketConfidence(calculateIndexConfidence(analyses.NIFTY));
    setBankniftyConfidence(calculateIndexConfidence(analyses.BANKNIFTY));
    setSensexConfidence(calculateIndexConfidence(analyses.SENSEX));
  }, [analyses]);

  // 🔥🔥🔥 AGGREGATED MARKET SIGNAL CALCULATION - Performance Optimized 🔥🔥🔥
  // This calculates the total BUY/SELL % based on all section confidences
  const aggregatedMarketSignal = useMemo(() => {
    // Use both analyses AND direct marketData for comprehensive signal detection
    const calculateAggregatedSignal = (analysisData: any, directData: any, symbol: string) => {
      // Get indicators from analysis OR from direct market data
      const ind = analysisData?.indicators || {};
      const tick = directData || {};
      
      // Get price from multiple sources
      const price = ind.price || tick.price || 0;
      
      // If no price data at all, return neutral
      if (price === 0) {
        return { buyPercent: 50, sellPercent: 50, totalConfidence: 50, signal: 'NEUTRAL', sectionCount: 0 };
      }
      
      // 🔥 ACCURATE AGGREGATION: Based on ACTUAL available data
      let buyCount = 0;
      let sellCount = 0;
      let neutralCount = 0;
      let totalConfidenceSum = 0;
      let sectionCount = 0;

      // Section 1: Main Signal (from analysis.signal OR tick.trend)
      sectionCount++;
      const mainSignal = String(analysisData?.signal || '').toUpperCase();
      const tickTrend = String(tick.trend || '').toLowerCase();
      if (mainSignal.includes('BUY') || tickTrend === 'bullish') { 
        buyCount++; totalConfidenceSum += 85; 
      } else if (mainSignal.includes('SELL') || tickTrend === 'bearish') { 
        sellCount++; totalConfidenceSum += 85; 
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 2: Price Change Direction (Using tick.change)
      sectionCount++;
      const priceChange = tick.change || 0;
      const changePercent = tick.changePercent || 0;
      if (changePercent > 0.3) { buyCount++; totalConfidenceSum += 78; }
      else if (changePercent < -0.3) { sellCount++; totalConfidenceSum += 78; }
      else { neutralCount++; totalConfidenceSum += 50; }

      // Section 3: RSI 
      sectionCount++;
      const rsi = Number(ind.rsi) || 50;
      if (rsi > 55) { buyCount++; totalConfidenceSum += Math.min(85, 50 + (rsi - 50)); }
      else if (rsi < 45) { sellCount++; totalConfidenceSum += Math.min(85, 50 + (50 - rsi)); }
      else { neutralCount++; totalConfidenceSum += 50; }

      // Section 4: VWMA 20 vs Price
      sectionCount++;
      const vwma20 = ind.vwma_20 || 0;
      if (price > 0 && vwma20 > 0) {
        if (price > vwma20) { buyCount++; totalConfidenceSum += 75; }
        else if (price < vwma20) { sellCount++; totalConfidenceSum += 75; }
        else { neutralCount++; totalConfidenceSum += 50; }
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 5: EMA200 Position
      sectionCount++;
      const ema200 = ind.ema_200 || 0;
      if (price > 0 && ema200 > 0) {
        if (price > ema200) { buyCount++; totalConfidenceSum += 80; }
        else if (price < ema200) { sellCount++; totalConfidenceSum += 80; }
        else { neutralCount++; totalConfidenceSum += 50; }
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 6: VWAP Position
      sectionCount++;
      const vwap = ind.vwap || 0;
      if (price > 0 && vwap > 0) {
        if (price > vwap) { buyCount++; totalConfidenceSum += 78; }
        else if (price < vwap) { sellCount++; totalConfidenceSum += 78; }
        else { neutralCount++; totalConfidenceSum += 50; }
      } else {
        const vwapPos = String(ind.vwap_position || '').toUpperCase();
        if (vwapPos.includes('ABOVE')) { buyCount++; totalConfidenceSum += 75; }
        else if (vwapPos.includes('BELOW')) { sellCount++; totalConfidenceSum += 75; }
        else { neutralCount++; totalConfidenceSum += 50; }
      }

      // Section 7: Price vs Open (Intraday direction)
      sectionCount++;  
      const openPrice = tick.open || ind.open || 0;
      if (price > 0 && openPrice > 0) {
        if (price > openPrice) { buyCount++; totalConfidenceSum += 72; }
        else if (price < openPrice) { sellCount++; totalConfidenceSum += 72; }
        else { neutralCount++; totalConfidenceSum += 50; }
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 8: Price vs Day High/Low (Position in range)
      sectionCount++;
      const dayHigh = tick.high || ind.high || 0;
      const dayLow = tick.low || ind.low || 0;
      if (price > 0 && dayHigh > dayLow && dayLow > 0) {
        const range = dayHigh - dayLow;
        const positionInRange = range > 0 ? (price - dayLow) / range : 0.5;
        if (positionInRange > 0.7) { buyCount++; totalConfidenceSum += 75; } // Near high (strength)
        else if (positionInRange < 0.3) { sellCount++; totalConfidenceSum += 75; } // Near low (weakness)
        else { neutralCount++; totalConfidenceSum += 50; }
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 9: Trend Direction from indicators
      sectionCount++;
      const trend = String(ind.trend || '').toUpperCase();
      if (trend.includes('UP') || trend === 'UPTREND') { buyCount++; totalConfidenceSum += 80; }
      else if (trend.includes('DOWN') || trend === 'DOWNTREND') { sellCount++; totalConfidenceSum += 80; }
      else { neutralCount++; totalConfidenceSum += 50; }

      // Section 10: Volume Analysis (using tick volume)
      sectionCount++;
      const volume = tick.volume || ind.volume || 0;
      const volStrength = String(ind.volume_strength || '').toUpperCase();
      if (volStrength.includes('STRONG') && (tickTrend === 'bullish' || trend.includes('UP'))) {
        buyCount++; totalConfidenceSum += 75;
      } else if (volStrength.includes('STRONG') && (tickTrend === 'bearish' || trend.includes('DOWN'))) {
        sellCount++; totalConfidenceSum += 75;
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 11: Price vs Prev Day Close
      sectionCount++;
      const prevClose = tick.close || ind.prev_day_close || 0;
      if (price > 0 && prevClose > 0) {
        const gapPercent = ((price - prevClose) / prevClose) * 100;
        if (gapPercent > 0.5) { buyCount++; totalConfidenceSum += 78; }
        else if (gapPercent < -0.5) { sellCount++; totalConfidenceSum += 78; }
        else { neutralCount++; totalConfidenceSum += 50; }
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Section 12: Candle Strength
      sectionCount++;
      const candleStrength = Number(ind.candle_strength) || 50;
      if (candleStrength > 60) { buyCount++; totalConfidenceSum += 70; }
      else if (candleStrength < 40) { sellCount++; totalConfidenceSum += 70; }
      else { neutralCount++; totalConfidenceSum += 50; }

      // Section 13: Overall Analysis Confidence
      sectionCount++;
      const confidence = Number(analysisData?.confidence) || 0.5;
      if ((mainSignal.includes('BUY') || tickTrend === 'bullish') && confidence > 0.5) { 
        buyCount++; totalConfidenceSum += 80; 
      } else if ((mainSignal.includes('SELL') || tickTrend === 'bearish') && confidence > 0.5) { 
        sellCount++; totalConfidenceSum += 80; 
      } else { neutralCount++; totalConfidenceSum += 50; }

      // Calculate percentages
      const totalSignals = buyCount + sellCount + neutralCount;
      const buyPercent = totalSignals > 0 ? Math.round(((buyCount + neutralCount * 0.5) / totalSignals) * 100) : 50;
      const sellPercent = 100 - buyPercent;
      const avgConfidence = sectionCount > 0 ? Math.round(totalConfidenceSum / sectionCount) : 50;

      // Determine overall signal strength
      let signal = 'NEUTRAL';
      if (buyPercent >= 70) signal = 'STRONG_BUY';
      else if (buyPercent >= 55) signal = 'BUY';
      else if (sellPercent >= 70) signal = 'STRONG_SELL';
      else if (sellPercent >= 55) signal = 'SELL';

      return { buyPercent, sellPercent, totalConfidence: avgConfidence, signal, sectionCount };
    };

    return {
      NIFTY: calculateAggregatedSignal(analyses?.NIFTY, marketData.NIFTY, 'NIFTY'),
      BANKNIFTY: calculateAggregatedSignal(analyses?.BANKNIFTY, marketData.BANKNIFTY, 'BANKNIFTY'),
      SENSEX: calculateAggregatedSignal(analyses?.SENSEX, marketData.SENSEX, 'SENSEX')
    };
  }, [analyses, marketData]);

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
  const marketStatus = useMemo(() => {
    const status = marketData.NIFTY?.status || marketData.BANKNIFTY?.status || marketData.SENSEX?.status || 'OFFLINE';
    // Filter out 'DEMO' status as Header component doesn't expect it
    return status === 'DEMO' ? 'OFFLINE' : status as 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN';
  }, [marketData.NIFTY?.status, marketData.BANKNIFTY?.status, marketData.SENSEX?.status]);

  return (
    <main className="min-h-screen">
      {/* Header */}
      <Header isConnected={isConnected} marketStatus={marketStatus} />
      
      {/* 🔥 NEW: Professional System Status Banner */}
      <SystemStatusBanner />
      
      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        {/* Use same status component for both mobile and desktop */}
        <LiveStatus status={connectionStatus} isConnected={isConnected} />
      </div>

      {/* Overall Market Outlook - ALWAYS VISIBLE (Comprehensive Aggregated Analysis) */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <div className="bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm rounded-xl border-2 border-emerald-500/30 p-3 sm:p-4 shadow-xl shadow-emerald-500/10">
          
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm sm:text-base font-bold text-dark-text flex items-center gap-2">
              <span className="text-lg">📊</span>
              Overall Market Outlook
              <span className="text-[10px] sm:text-xs text-dark-tertiary font-normal ml-2">
                (13 Section Signals Aggregated)
              </span>
            </h3>
          </div>
          
          {/* Individual Symbol Confidence Sections - Enhanced with BUY/SELL % */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
            {/* NIFTY 50 Confidence Section */}
            <div className={`bg-dark-surface/60 rounded-xl p-4 sm:p-5 border-2 shadow-xl hover:shadow-2xl transition-all duration-300 ${
              aggregatedMarketSignal.NIFTY.buyPercent >= 55 
                ? 'border-green-400/70 ring-2 ring-green-400/30 hover:border-green-300/90 hover:ring-green-300/40'
                : aggregatedMarketSignal.NIFTY.sellPercent >= 55
                ? 'border-red-400/70 ring-2 ring-red-400/30 hover:border-red-300/90 hover:ring-red-300/40'
                : 'border-yellow-400/50 ring-2 ring-yellow-400/20'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 sm:mb-3">
                <span className="text-sm sm:text-lg font-bold text-dark-text mb-1 sm:mb-0">NIFTY 50</span>
                <div className={`text-xs sm:text-sm font-bold px-2 py-0.5 rounded ${
                  aggregatedMarketSignal.NIFTY.signal === 'STRONG_BUY' ? 'bg-green-500/30 text-green-300' :
                  aggregatedMarketSignal.NIFTY.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' :
                  aggregatedMarketSignal.NIFTY.signal === 'STRONG_SELL' ? 'bg-red-500/30 text-red-300' :
                  aggregatedMarketSignal.NIFTY.signal === 'SELL' ? 'bg-rose-500/20 text-rose-300' :
                  'bg-yellow-500/20 text-yellow-300'
                }`}>
                  {aggregatedMarketSignal.NIFTY.signal.replace('_', ' ')}
                </div>
              </div>
              
              {/* BUY/SELL Percentage Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className="text-green-400">🟢 BUY {aggregatedMarketSignal.NIFTY.buyPercent}%</span>
                  <span className="text-red-400">SELL {aggregatedMarketSignal.NIFTY.sellPercent}% 🔴</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                  <div 
                    className="bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.NIFTY.buyPercent}%` }}
                  />
                  <div 
                    className="bg-gradient-to-r from-rose-400 to-red-500 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.NIFTY.sellPercent}%` }}
                  />
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">Avg Confidence: {aggregatedMarketSignal.NIFTY.totalConfidence}%</span>
                <span className="text-[10px] text-emerald-300 font-bold">{aggregatedMarketSignal.NIFTY.sectionCount}/13 signals</span>
              </div>
            </div>

            {/* BANK NIFTY Confidence Section */}
            <div className={`bg-dark-surface/60 rounded-xl p-4 sm:p-5 border-2 shadow-xl hover:shadow-2xl transition-all duration-300 ${
              aggregatedMarketSignal.BANKNIFTY.buyPercent >= 55 
                ? 'border-green-400/70 ring-2 ring-green-400/30 hover:border-green-300/90 hover:ring-green-300/40'
                : aggregatedMarketSignal.BANKNIFTY.sellPercent >= 55
                ? 'border-red-400/70 ring-2 ring-red-400/30 hover:border-red-300/90 hover:ring-red-300/40'
                : 'border-yellow-400/50 ring-2 ring-yellow-400/20'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 sm:mb-3">
                <span className="text-sm sm:text-lg font-bold text-dark-text mb-1 sm:mb-0">BANK NIFTY</span>
                <div className={`text-xs sm:text-sm font-bold px-2 py-0.5 rounded ${
                  aggregatedMarketSignal.BANKNIFTY.signal === 'STRONG_BUY' ? 'bg-green-500/30 text-green-300' :
                  aggregatedMarketSignal.BANKNIFTY.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' :
                  aggregatedMarketSignal.BANKNIFTY.signal === 'STRONG_SELL' ? 'bg-red-500/30 text-red-300' :
                  aggregatedMarketSignal.BANKNIFTY.signal === 'SELL' ? 'bg-rose-500/20 text-rose-300' :
                  'bg-yellow-500/20 text-yellow-300'
                }`}>
                  {aggregatedMarketSignal.BANKNIFTY.signal.replace('_', ' ')}
                </div>
              </div>
              
              {/* BUY/SELL Percentage Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className="text-green-400">🟢 BUY {aggregatedMarketSignal.BANKNIFTY.buyPercent}%</span>
                  <span className="text-red-400">SELL {aggregatedMarketSignal.BANKNIFTY.sellPercent}% 🔴</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                  <div 
                    className="bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.BANKNIFTY.buyPercent}%` }}
                  />
                  <div 
                    className="bg-gradient-to-r from-rose-400 to-red-500 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.BANKNIFTY.sellPercent}%` }}
                  />
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">Avg Confidence: {aggregatedMarketSignal.BANKNIFTY.totalConfidence}%</span>
                <span className="text-[10px] text-emerald-300 font-bold">{aggregatedMarketSignal.BANKNIFTY.sectionCount}/13 signals</span>
              </div>
            </div>

            {/* SENSEX Confidence Section */}
            <div className={`bg-dark-surface/60 rounded-xl p-4 sm:p-5 border-2 shadow-xl hover:shadow-2xl transition-all duration-300 ${
              aggregatedMarketSignal.SENSEX.buyPercent >= 55 
                ? 'border-green-400/70 ring-2 ring-green-400/30 hover:border-green-300/90 hover:ring-green-300/40'
                : aggregatedMarketSignal.SENSEX.sellPercent >= 55
                ? 'border-red-400/70 ring-2 ring-red-400/30 hover:border-red-300/90 hover:ring-red-300/40'
                : 'border-yellow-400/50 ring-2 ring-yellow-400/20'
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-2 sm:mb-3">
                <span className="text-sm sm:text-lg font-bold text-dark-text mb-1 sm:mb-0">SENSEX</span>
                <div className={`text-xs sm:text-sm font-bold px-2 py-0.5 rounded ${
                  aggregatedMarketSignal.SENSEX.signal === 'STRONG_BUY' ? 'bg-green-500/30 text-green-300' :
                  aggregatedMarketSignal.SENSEX.signal === 'BUY' ? 'bg-emerald-500/20 text-emerald-300' :
                  aggregatedMarketSignal.SENSEX.signal === 'STRONG_SELL' ? 'bg-red-500/30 text-red-300' :
                  aggregatedMarketSignal.SENSEX.signal === 'SELL' ? 'bg-rose-500/20 text-rose-300' :
                  'bg-yellow-500/20 text-yellow-300'
                }`}>
                  {aggregatedMarketSignal.SENSEX.signal.replace('_', ' ')}
                </div>
              </div>
              
              {/* BUY/SELL Percentage Bar */}
              <div className="mb-3">
                <div className="flex justify-between text-[10px] font-bold mb-1">
                  <span className="text-green-400">🟢 BUY {aggregatedMarketSignal.SENSEX.buyPercent}%</span>
                  <span className="text-red-400">SELL {aggregatedMarketSignal.SENSEX.sellPercent}% 🔴</span>
                </div>
                <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                  <div 
                    className="bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.SENSEX.buyPercent}%` }}
                  />
                  <div 
                    className="bg-gradient-to-r from-rose-400 to-red-500 transition-all duration-500"
                    style={{ width: `${aggregatedMarketSignal.SENSEX.sellPercent}%` }}
                  />
                </div>
              </div>
              
              <div className="flex justify-between items-center">
                <span className="text-[10px] text-slate-400">Avg Confidence: {aggregatedMarketSignal.SENSEX.totalConfidence}%</span>
                <span className="text-[10px] text-emerald-300 font-bold">{aggregatedMarketSignal.SENSEX.sectionCount}/13 signals</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4">
        {/* Live Market Indices - With Border */}
        <div className="border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            {/* Main Header */}
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-bullish to-bullish-dark rounded-full shadow-lg shadow-bullish/30" />
              <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-dark-text tracking-tight whitespace-nowrap">
                Live Market Indices
              </h2>
              <span className="relative px-2 sm:px-3 py-1 text-[9px] sm:text-xs font-bold bg-gradient-to-r from-accent via-accent-secondary to-accent rounded-lg shadow-xl animate-pulse-slow border border-accent/30 whitespace-nowrap">
                <span className="relative z-10 flex items-center gap-1">
                  <span className="text-xs sm:text-sm">🤖</span>
                  <span className="bg-gradient-to-r from-white via-cyan-100 to-white bg-clip-text text-transparent font-extrabold">AI POWERED</span>
                  <span className="text-xs sm:text-sm">✨</span>
                </span>
                <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent-secondary to-accent blur-xl opacity-40 rounded-lg"></span>
              </span>
            </div>

            {/* Trading Parameters - Premium Section */}
            <div className="p-1.5 sm:p-3 bg-gradient-to-r from-slate-800/40 via-slate-900/40 to-slate-800/40 rounded-lg sm:rounded-xl border border-slate-700/50 shadow-lg">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                {/* Trade Time Label */}
                <span className="text-amber-400 font-bold text-[10px] sm:text-sm whitespace-nowrap flex items-center gap-0.5">
                  <span>⏰</span>
                  <span className="hidden sm:inline">Trade Time:</span>
                </span>
                
                {/* Trade Times */}
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-amber-500/20 to-amber-600/20 border border-amber-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-amber-300 font-bold text-[10px] sm:text-sm">🥇</span>
                  <span className="text-amber-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">9:20-10:45</span>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-emerald-500/20 to-emerald-600/20 border border-emerald-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-emerald-300 font-bold text-[10px] sm:text-sm">🥈</span>
                  <span className="text-emerald-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">10:45-11:30</span>
                </div>
                <div className="flex items-center gap-0.5 sm:gap-1.5 px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-blue-500/20 to-blue-600/20 border border-blue-500/40 rounded-md sm:rounded-lg shadow-md">
                  <span className="text-blue-300 font-bold text-[10px] sm:text-sm">⚠️</span>
                  <span className="text-blue-100 font-bold text-[10px] sm:text-sm whitespace-nowrap">1:45-2:45</span>
                </div>

                {/* Separator - Desktop Only */}
                <div className="hidden sm:block w-px h-8 bg-gradient-to-b from-transparent via-slate-600 to-transparent mx-1"></div>

                {/* Timeframes - Compact for Mobile */}
                <div className="flex items-center gap-0.5 sm:gap-2 whitespace-nowrap">
                  <span className="text-purple-400 font-bold text-[10px] sm:text-sm">📊</span>
                  <div className="px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-purple-500/20 to-purple-600/20 border border-purple-500/40 rounded-md sm:rounded-lg shadow-md">
                    <span className="text-purple-100 font-bold text-[10px] sm:text-sm">15m</span>
                  </div>
                  <span className="text-pink-400 font-bold text-[10px] sm:text-sm">🎯</span>
                  <div className="px-1.5 sm:px-3 py-0.5 sm:py-1.5 bg-gradient-to-r from-pink-500/20 to-pink-600/20 border border-pink-500/40 rounded-md sm:rounded-lg shadow-md">
                    <span className="text-pink-100 font-bold text-[10px] sm:text-sm">5m</span>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-dark-tertiary text-[10px] sm:text-xs ml-4 sm:ml-5 font-medium tracking-wide">Real-time NSE & BSE Index Data with GPT-4 Intelligence</p>
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
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-bullish' : 'bg-bearish'} animate-pulse`} />
                <span className="tracking-wide">
                  {isConnected ? 'Analysis Live' : 'Disconnected'}
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
      </div>

      {/* Trading Sections Container */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        {/* VWMA 20 • Entry Filter Section */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                VWMA 20 • Entry Filter
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Volume-weighted moving average • Institutional reference level • Professional entry signals
              </p>
            </div>
            
            {/* Market Status & Confidence Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.vwma_ema_signal === 'STRONG_BUY' || analyses?.NIFTY?.indicators?.vwma_ema_signal === 'BUY' 
                  ? 'bg-bullish/20 text-bullish border-bullish/40' :
                analyses?.NIFTY?.indicators?.vwma_ema_signal === 'STRONG_SELL' || analyses?.NIFTY?.indicators?.vwma_ema_signal === 'SELL'
                  ? 'bg-bearish/20 text-bearish border-bearish/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.vwma_ema_signal === 'STRONG_BUY' ? '🟢 STRONG BUY' :
                 analyses?.NIFTY?.indicators?.vwma_ema_signal === 'BUY' ? '🟢 BUY' :
                 analyses?.NIFTY?.indicators?.vwma_ema_signal === 'STRONG_SELL' ? '🔴 STRONG SELL' :
                 analyses?.NIFTY?.indicators?.vwma_ema_signal === 'SELL' ? '🔴 SELL' :
                 ''}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <VWMAEMAFilterCard analysis={analyses?.NIFTY || null} marketStatus={marketStatus as any} symbol="NIFTY" />
            <VWMAEMAFilterCard analysis={analyses?.BANKNIFTY || null} marketStatus={marketStatus as any} symbol="BANKNIFTY" />
            <VWMAEMAFilterCard analysis={analyses?.SENSEX || null} marketStatus={marketStatus as any} symbol="SENSEX" />
          </div>
        </div>

          {/* RSI 60/40 Momentum Section */}
          <div className="mt-6 sm:mt-6 border-2 border-purple-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-500/10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                  <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full shadow-lg shadow-purple-500/30" />
                  RSI 60/40 Momentum
                </h3>
                <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                  Overbought/Oversold signals • Trend confirmation • Entry signals
                </p>
              </div>
              
              {/* Market Status Panel - Without Confidence */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
                {/* Market Status Indicator */}
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                  analyses?.NIFTY?.indicators?.rsi_signal === 'MOMENTUM_BUY' || analyses?.NIFTY?.indicators?.rsi_signal === 'PULLBACK_BUY'
                    ? 'bg-bullish/20 text-bullish border-bullish/40' :
                  analyses?.NIFTY?.indicators?.rsi_signal === 'REJECTION_SHORT' || analyses?.NIFTY?.indicators?.rsi_signal === 'BREAKDOWN_SELL'
                    ? 'bg-bearish/20 text-bearish border-bearish/40' :
                    'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                }`}>
                  {analyses?.NIFTY?.indicators?.rsi_signal === 'MOMENTUM_BUY' ? '🟢 BUY MOMENTUM' :
                   analyses?.NIFTY?.indicators?.rsi_signal === 'PULLBACK_BUY' ? '🟢 PULLBACK BUY' :
                   analyses?.NIFTY?.indicators?.rsi_signal === 'REJECTION_SHORT' ? '🔴 SELL SIGNAL' :
                   analyses?.NIFTY?.indicators?.rsi_signal === 'BREAKDOWN_SELL' ? '🔴 BREAKDOWN' :
                   ''}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={item.symbol} className="border-2 border-emerald-500/30 rounded-xl bg-dark-surface/30 p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm">
                {/* Title & Confidence */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight">
                    {item.symbol} • RSI 60/40
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary">
                      Confidence: {Math.round(
                        item.data?.indicators?.rsi_confidence || 
                        (() => {
                          const rsi = item.data?.indicators?.rsi || 50;
                          const rsiSignal = item.data?.indicators?.rsi_signal;
                          let confidence = 50; // Base confidence
                          
                          // RSI Zone Confidence
                          if (rsi > 70) confidence += 25; // Strong overbought
                          else if (rsi > 60) confidence += 15; // Overbought
                          else if (rsi < 30) confidence += 25; // Strong oversold
                          else if (rsi < 40) confidence += 15; // Oversold
                          else if (rsi >= 45 && rsi <= 55) confidence -= 10; // Neutral zone
                          
                          // Signal Confidence
                          if (rsiSignal === 'MOMENTUM_BUY' || rsiSignal === 'REJECTION_SHORT') confidence += 20;
                          else if (rsiSignal === 'PULLBACK_BUY' || rsiSignal === 'BREAKDOWN_SELL') confidence += 15;
                          
                          // Market status adjustment
                          const marketStatus = item.data?.status;
                          if (marketStatus === 'LIVE') confidence += 10;
                          else if (marketStatus === 'CLOSED') confidence -= 5;
                          
                          return Math.min(95, Math.max(15, confidence));
                        })()
                      )}%
                    </span>
                    {/* RSI Badge */}
                    {item.data?.indicators?.rsi && (
                      <span className={`text-xs sm:text-sm font-bold px-2.5 py-1 rounded-lg whitespace-nowrap ${
                        item.data.indicators.rsi > 60 ? 'bg-bullish/20 text-bullish border border-bullish/40' :
                        item.data.indicators.rsi < 40 ? 'bg-bearish/20 text-bearish border border-bearish/40' :
                        'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                      }`}>
                        RSI {Math.round(item.data.indicators.rsi)}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-2.5">
                    {/* RSI Zone */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-dark-secondary font-medium">Zone:</span>
                      <span className={`font-bold ${
                        item.data.indicators.rsi_zone === '60_ABOVE' ? 'text-bullish' :
                        item.data.indicators.rsi_zone === '50_TO_60' ? 'text-yellow-300' :
                        item.data.indicators.rsi_zone === '40_TO_50' ? 'text-yellow-300' :
                        'text-bearish'
                      }`}>
                        {item.data.indicators.rsi_zone === '60_ABOVE' ? '60+ (Overbought)' :
                         item.data.indicators.rsi_zone === '50_TO_60' ? '50-60 (Bullish)' :
                         item.data.indicators.rsi_zone === '40_TO_50' ? '40-50 (Neutral)' :
                         '< 40 (Oversold)'}
                      </span>
                    </div>

                    {/* Signal */}
                    {item.data.indicators.rsi_signal && (
                      <div className="rounded-lg bg-dark-surface/50 border border-emerald-500/30 p-2.5">
                        <div className="text-[10px] font-bold text-dark-secondary uppercase tracking-wider opacity-70 mb-1">Signal</div>
                        <div className={`text-sm sm:text-base font-bold ${
                          item.data.indicators.rsi_signal === 'MOMENTUM_BUY' ? 'text-bullish' :
                          item.data.indicators.rsi_signal === 'REJECTION_SHORT' ? 'text-bearish' :
                          item.data.indicators.rsi_signal === 'PULLBACK_BUY' ? 'text-yellow-300' :
                          'text-dark-text'
                        }`}>
                          {item.data.indicators.rsi_signal === 'MOMENTUM_BUY' ? '📈 MOMENTUM BUY' :
                           item.data.indicators.rsi_signal === 'REJECTION_SHORT' ? '📉 REJECTION SHORT' :
                           item.data.indicators.rsi_signal === 'PULLBACK_BUY' ? '⏳ PULLBACK BUY' :
                           item.data.indicators.rsi_signal.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )}

                    {/* Action Description */}
                    {item.data.indicators.rsi_action && (
                      <div className="text-xs text-dark-tertiary leading-relaxed italic bg-dark-surface/40 border-l-2 border-emerald-500/30 pl-2.5 py-2">
                        {item.data.indicators.rsi_action}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-dark-tertiary text-xs">
                    Loading RSI analysis...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

          {/* EMA200 Touch Entry Filter Section - Professional Redesign */}
          <div className="mt-6 sm:mt-6 border-2 border-cyan-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-cyan-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-cyan-500/10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                  <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-cyan-500 to-cyan-600 rounded-full shadow-lg shadow-cyan-500/30" />
                  EMA200 Touch Entry Filter
                </h3>
                <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                  Entry confirmation at moving average • Touch & bounce detection • Breakout validation
                </p>
              </div>
              
              {/* Market Status Panel - Without Confidence */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
                {/* Market Status Indicator */}
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                  analyses?.NIFTY?.indicators?.ema200_touch_signal === 'BULLISH_BOUNCE'
                    ? 'bg-bullish/20 text-bullish border-bullish/40' :
                  analyses?.NIFTY?.indicators?.ema200_touch_signal === 'BEARISH_BREAKDOWN'
                    ? 'bg-bearish/20 text-bearish border-bearish/40' :
                    'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                }`}>
                  {analyses?.NIFTY?.indicators?.ema200_touch_signal === 'BULLISH_BOUNCE' ? '🟢 BULLISH' :
                   analyses?.NIFTY?.indicators?.ema200_touch_signal === 'BEARISH_BREAKDOWN' ? '🔴 BEARISH' :
                   ''}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`ema200_${item.symbol}`} className="border-2 border-dark-border/40 rounded-xl bg-dark-surface/30 p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm">
                {/* Title & Confidence */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight">
                    {item.symbol} • EMA200
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary">
                      Confidence: {Math.round(
                        item.data?.indicators?.ema200_touch_confidence || 
                        (() => {
                          const ema200Touch = item.data?.indicators?.ema200_touch;
                          const ema200TouchSignal = item.data?.indicators?.ema200_touch_signal;
                          const ema200Action = item.data?.indicators?.ema200_action;
                          let confidence = 45; // Base confidence
                          
                          // Touch Status Confidence
                          if (ema200Touch === 'TOUCHING') confidence += 30; // High probability at touch
                          else if (ema200Touch === 'ABOVE' || ema200Touch === 'BELOW') confidence += 15;
                          
                          // Signal Confidence
                          if (ema200TouchSignal === 'BULLISH_BOUNCE' || ema200TouchSignal === 'BEARISH_BREAKDOWN') confidence += 25;
                          else if (ema200TouchSignal === 'FIRST_TOUCH_BOUNCE' || ema200TouchSignal === 'REJECTION') confidence += 20;
                          
                          // Action Confirmation
                          if (ema200Action && ema200Action.includes('CONFIRMED')) confidence += 15;
                          else if (ema200Action && ema200Action.includes('POTENTIAL')) confidence += 10;
                          
                          // Market status adjustment
                          const marketStatus = item.data?.status;
                          if (marketStatus === 'LIVE') confidence += 10;
                          else if (marketStatus === 'CLOSED') confidence -= 5;
                          
                          return Math.min(95, Math.max(20, confidence));
                        })()
                      )}%
                    </span>
                    {/* Status Badge */}
                    {item.data?.indicators?.ema200_touch && (
                      <span className={`text-xs sm:text-sm font-bold px-2.5 py-1 rounded-lg whitespace-nowrap ${
                        item.data.indicators.ema200_touch === 'TOUCHING' ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' :
                        item.data.indicators.ema200_touch === 'ABOVE' ? 'bg-bullish/20 text-bullish border border-bullish/40' :
                        'bg-bearish/20 text-bearish border border-bearish/40'
                      }`}>
                        {item.data.indicators.ema200_touch === 'TOUCHING' ? '🎯 TOUCHING' : item.data.indicators.ema200_touch === 'ABOVE' ? '📈 ABOVE' : '📉 BELOW'}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* Price Levels Box */}
                    <div className="bg-dark-surface/50 border border-dark-border/40 rounded-lg p-2.5 space-y-2">
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="text-dark-secondary font-medium">Price:</span>
                        <span className={`font-bold ${
                          item.data.indicators.price > item.data.indicators.ema_200 ? 'text-bullish' :
                          item.data.indicators.price < item.data.indicators.ema_200 ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          ₹{item.data.indicators.price?.toFixed(2) || 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="text-dark-secondary font-medium">EMA200:</span>
                        <span className="font-bold text-dark-text">₹{item.data.indicators.ema_200?.toFixed(2) || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs sm:text-sm pt-1 border-t border-dark-secondary/20">
                        <span className="text-dark-secondary font-medium">Distance:</span>
                        <span className={`font-bold ${
                          Math.abs(item.data.indicators.price - item.data.indicators.ema_200) < 50 ? 'text-yellow-300' :
                          item.data.indicators.price > item.data.indicators.ema_200 ? 'text-bullish' :
                          'text-bearish'
                        }`}>
                          {((item.data.indicators.price - item.data.indicators.ema_200) / item.data.indicators.ema_200 * 100).toFixed(2)}% {item.data.indicators.price > item.data.indicators.ema_200 ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {/* Touch Type */}
                    {item.data.indicators.ema200_touch_type && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-dark-secondary font-medium">Type:</span>
                        <span className={`font-bold px-2 py-0.5 rounded ${
                          item.data.indicators.ema200_touch_type === 'FROM_ABOVE' 
                            ? 'bg-bullish/10 text-bullish border border-bullish/30' 
                            : 'bg-bearish/10 text-bearish border border-bearish/30'
                        }`}>
                          {item.data.indicators.ema200_touch_type === 'FROM_ABOVE' ? '🔽 Support Test' : '🔼 Resistance Test'}
                        </span>
                      </div>
                    )}

                    {/* Entry Filter Signal Box */}
                    {item.data.indicators.ema200_entry_filter && (
                      <div className="rounded-lg bg-dark-surface/50 border border-dark-border/40 p-2.5">
                        <div className="text-[10px] font-bold text-dark-secondary uppercase tracking-wider opacity-70 mb-1">Entry Filter</div>
                        <div className={`text-sm sm:text-base font-bold ${
                          item.data.indicators.ema200_entry_filter === 'FIRST_TOUCH_BOUNCE' ? 'text-bullish' :
                          item.data.indicators.ema200_entry_filter === 'EMA200_BREAKOUT' ? 'text-bullish' :
                          item.data.indicators.ema200_entry_filter === 'FIRST_TOUCH_REJECTION' ? 'text-bearish' :
                          item.data.indicators.ema200_entry_filter === 'SUPPORT_FAIL' ? 'text-bearish' :
                          item.data.indicators.ema200_entry_filter === 'ABOVE_BOTH' ? 'text-cyan-300' :
                          item.data.indicators.ema200_entry_filter === 'BELOW_BOTH' ? 'text-cyan-300' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.ema200_entry_filter === 'FIRST_TOUCH_BOUNCE' ? '✅ Touch Bounce' :
                           item.data.indicators.ema200_entry_filter === 'EMA200_BREAKOUT' ? '📈 Breakout' :
                           item.data.indicators.ema200_entry_filter === 'FIRST_TOUCH_REJECTION' ? '❌ Touch Rejection' :
                           item.data.indicators.ema200_entry_filter === 'SUPPORT_FAIL' ? '⚠️ Support Fail' :
                           item.data.indicators.ema200_entry_filter === 'ABOVE_BOTH' ? '🟢 Above EMA200' :
                           item.data.indicators.ema200_entry_filter === 'BELOW_BOTH' ? '🔴 Below EMA200' :
                           item.data.indicators.ema200_entry_filter === 'TOUCH_WATCH' ? '👁️ Watch Touch' :
                           item.data.indicators.ema200_entry_filter === 'BREAKOUT_WATCH' ? '👁️ Watch Breakout' :
                           item.data.indicators.ema200_entry_filter.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )}

                    {/* Confirmation Note */}
                    {item.data.indicators.ema200_confirmation && (
                      <div className="text-xs text-dark-tertiary leading-relaxed italic bg-dark-surface/40 border-l-2 border-cyan-500/30 pl-2.5 py-2">
                        {item.data.indicators.ema200_confirmation}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-dark-tertiary text-xs">
                    ⏳ Loading EMA200 analysis...
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>

          {/* VWAP Intraday Filter Section - Professional Redesign */}
          <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                  <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                  VWAP Intraday Filter
                </h3>
                <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                  Volume-weighted average price • Institutional reference level • Entry & support validation
                </p>
              </div>
              
              {/* Market Status Panel - Without Confidence */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
                {/* Market Status Indicator */}
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                  analyses?.NIFTY?.indicators?.vwap_position === 'ABOVE'
                    ? 'bg-bullish/20 text-bullish border-bullish/40' :
                  analyses?.NIFTY?.indicators?.vwap_position === 'BELOW'
                    ? 'bg-bearish/20 text-bearish border-bearish/40' :
                    'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                }`}>
                  {analyses?.NIFTY?.indicators?.vwap_position === 'ABOVE' ? '🟢 BULLISH' :
                   analyses?.NIFTY?.indicators?.vwap_position === 'BELOW' ? '🔴 BEARISH' :
                   ''}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`vwap_${item.symbol}`} className="border-2 border-dark-border/40 rounded-xl bg-dark-surface/30 p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm">
                {/* Title & Confidence */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight">
                    {item.symbol} • VWAP
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary">
                      Confidence: {Math.round(
                        item.data?.indicators?.vwap_confidence || 
                        (() => {
                          const vwapPosition = item.data?.indicators?.vwap_position;
                          const vwapBias = item.data?.indicators?.vwap_bias;
                          const vwapSignal = item.data?.indicators?.vwap_signal;
                          const vwapRole = item.data?.indicators?.vwap_role;
                          let confidence = 50; // Base confidence
                          
                          // Position Confidence
                          if (vwapPosition === 'ABOVE' || vwapPosition === 'BELOW') confidence += 20;
                          else if (vwapPosition === 'AT_VWAP') confidence += 25; // High probability at VWAP
                          
                          // Bias Strength
                          if (vwapBias === 'LONG_ONLY' || vwapBias === 'SHORT_ONLY') confidence += 20;
                          else if (vwapBias === 'NEUTRAL') confidence += 5;
                          
                          // Signal Confirmation
                          if (vwapSignal && vwapSignal.includes('BUY')) confidence += 15;
                          else if (vwapSignal && vwapSignal.includes('SELL')) confidence += 15;
                          else if (vwapSignal && vwapSignal.includes('DIP_TO_VWAP')) confidence += 25;
                          
                          // VWAP Role
                          if (vwapRole === 'SUPPORT' || vwapRole === 'RESISTANCE') confidence += 15;
                          else if (vwapRole === 'EQUILIBRIUM') confidence += 5;
                          
                          // Market status adjustment
                          const marketStatus = item.data?.status;
                          if (marketStatus === 'LIVE') confidence += 10;
                          else if (marketStatus === 'CLOSED') confidence -= 5;
                          
                          return Math.min(95, Math.max(25, confidence));
                        })()
                      )}%
                    </span>
                    {/* Bias Badge */}
                    {item.data?.indicators?.vwap_bias && (
                      <span className={`text-xs sm:text-sm font-bold px-2.5 py-1 rounded-lg whitespace-nowrap ${
                        item.data.indicators.vwap_bias === 'LONG_ONLY' ? 'bg-bullish/20 text-bullish border border-bullish/40' :
                        item.data.indicators.vwap_bias === 'SHORT_ONLY' ? 'bg-bearish/20 text-bearish border border-bearish/40' :
                        'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                      }`}>
                        {item.data.indicators.vwap_bias === 'LONG_ONLY' ? '📈 LONG BIAS' : 
                         item.data.indicators.vwap_bias === 'SHORT_ONLY' ? '📉 SHORT BIAS' : 
                         '⚖️ NEUTRAL'}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* Price vs VWAP Box */}
                    <div className="bg-dark-surface/50 border border-dark-border/40 rounded-lg p-2.5 space-y-2">
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="text-dark-secondary font-medium">Price:</span>
                        <span className={`font-bold ${
                          item.data.indicators.price > item.data.indicators.vwap ? 'text-bullish' :
                          item.data.indicators.price < item.data.indicators.vwap ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          ₹{item.data.indicators.price?.toFixed(2) || 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs sm:text-sm">
                        <span className="text-dark-secondary font-medium">VWAP:</span>
                        <span className="font-bold text-dark-text">₹{item.data.indicators.vwap?.toFixed(2) || 'N/A'}</span>
                      </div>
                      <div className="flex justify-between items-center text-xs sm:text-sm pt-1 border-t border-dark-secondary/20">
                        <span className="text-dark-secondary font-medium">Distance:</span>
                        <span className={`font-bold ${
                          Math.abs(item.data.indicators.price - item.data.indicators.vwap) < 30 ? 'text-yellow-300' :
                          item.data.indicators.price > item.data.indicators.vwap ? 'text-bullish' :
                          'text-bearish'
                        }`}>
                          {((item.data.indicators.price - item.data.indicators.vwap) / item.data.indicators.vwap * 100).toFixed(2)}% {item.data.indicators.price > item.data.indicators.vwap ? '▲' : '▼'}
                        </span>
                      </div>
                    </div>

                    {/* VWAP Position & Role */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center justify-between bg-dark-surface/40 border border-dark-border/40 rounded-lg px-2 py-2">
                        <span className="text-dark-secondary font-medium">Position:</span>
                        <span className={`font-bold ${
                          item.data.indicators.vwap_position === 'ABOVE_VWAP' ? 'text-bullish' :
                          item.data.indicators.vwap_position === 'BELOW_VWAP' ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.vwap_position === 'ABOVE_VWAP' ? '📈' : item.data.indicators.vwap_position === 'BELOW_VWAP' ? '📉' : '➡️'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between bg-dark-surface/40 border border-dark-border/40 rounded-lg px-2 py-2">
                        <span className="text-dark-secondary font-medium">Role:</span>
                        <span className={`font-bold ${
                          item.data.indicators.vwap_role === 'SUPPORT' ? 'text-bullish' :
                          item.data.indicators.vwap_role === 'RESISTANCE' ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.vwap_role === 'SUPPORT' ? '🟢' : item.data.indicators.vwap_role === 'RESISTANCE' ? '🔴' : '⚪'}
                        </span>
                      </div>
                    </div>

                    {/* Signal Box */}
                    {item.data.indicators.vwap_signal && (
                      <div className="rounded-lg bg-dark-surface/50 border border-dark-border/40 p-2.5">
                        <div className="text-[10px] font-bold text-dark-secondary uppercase tracking-wider opacity-70 mb-1">Signal</div>
                        <div className={`text-sm sm:text-base font-bold ${
                          item.data.indicators.vwap_signal?.includes('BUY') || item.data.indicators.vwap_signal?.includes('BREAKOUT') ? 'text-bullish' :
                          item.data.indicators.vwap_signal?.includes('SELL') || item.data.indicators.vwap_signal?.includes('BREAKDOWN') ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.vwap_signal === 'DIP_TO_VWAP_BUY' ? '📊 Dip To VWAP Buy' :
                           item.data.indicators.vwap_signal === 'PULLBACK_TO_VWAP_SELL' ? '📊 Pullback To VWAP Sell' :
                           item.data.indicators.vwap_signal === 'R3_BREAKOUT_ABOVE_VWAP' ? '🚀 R3 Breakout Above' :
                           item.data.indicators.vwap_signal === 'S3_BREAKDOWN_BELOW_VWAP' ? '⬇️ S3 Breakdown Below' :
                           item.data.indicators.vwap_signal?.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )}

                    {/* R3/S3 + VWAP Combo */}
                    {item.data.indicators.vwap_r3_s3_combo && (
                      <div className={`text-xs leading-relaxed font-semibold border-l-2 pl-2.5 py-2 ${
                        item.data.indicators.vwap_r3_s3_combo?.includes('DEADLY') 
                          ? 'border-bullish/60 text-bullish/90 bg-bullish/5'
                          : 'border-emerald-500/30 text-dark-tertiary bg-dark-surface/40'
                      }`}>
                        {item.data.indicators.vwap_r3_s3_combo}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-dark-tertiary text-xs">
                    ⏳ Loading VWAP analysis...
                  </div>
                )}
              </div>
            ))}
            </div>
          </div>

          {/* EMA 20/50/100 Traffic Light - Professional Redesign */}
          <div className="mt-6 sm:mt-6 border-2 border-indigo-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-indigo-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-indigo-500/10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                  <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-indigo-500 to-indigo-600 rounded-full shadow-lg shadow-indigo-500/30" />
                  EMA Traffic Light 20/50/100
                </h3>
                <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                  Moving average alignment • Pullback entry confirmation • Trend status indicator
                </p>
              </div>
              
              {/* Market Status Panel - Without Confidence */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
                {/* Market Status Indicator */}
                <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                  analyses?.NIFTY?.indicators?.ema_alignment === 'ALL_BULLISH'
                    ? 'bg-bullish/20 text-bullish border-bullish/40' :
                  analyses?.NIFTY?.indicators?.ema_alignment === 'ALL_BEARISH'
                    ? 'bg-bearish/20 text-bearish border-bearish/40' :
                    'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
                }`}>
                  {analyses?.NIFTY?.indicators?.ema_alignment === 'ALL_BULLISH' ? '🟢 BULLISH' :
                   analyses?.NIFTY?.indicators?.ema_alignment === 'ALL_BEARISH' ? '🔴 BEARISH' :
                   analyses?.NIFTY?.indicators?.ema_alignment === 'COMPRESSION' ? '🟡 COMPRESSION' :
                   '🟡 NEUTRAL'}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`ema_${item.symbol}`} className="border-2 border-emerald-500/30 rounded-xl bg-dark-surface/30 p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm">
                {/* Title & Confidence */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight">
                    {item.symbol} • EMA Light
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary">
                      Confidence: {Math.round(
                        item.data?.indicators?.ema_alignment_confidence || 
                        (() => {
                          const emaAlignment = item.data?.indicators?.ema_alignment;
                          const trendStatus = item.data?.indicators?.trend_status;
                          const buyAllowed = item.data?.indicators?.buy_allowed;
                          const momentumShift = item.data?.indicators?.momentum_shift;
                          let confidence = 50; // Base confidence
                          
                          // EMA Alignment Confidence
                          if (emaAlignment === 'ALL_BULLISH' || emaAlignment === 'ALL_BEARISH') confidence += 30;
                          else if (emaAlignment && emaAlignment.includes('PARTIAL')) confidence += 15;
                          
                          // Trend Strength
                          if (trendStatus === 'STRONG_UPTREND' || trendStatus === 'STRONG_DOWNTREND') confidence += 25;
                          else if (trendStatus && trendStatus.includes('WEAK')) confidence += 10;
                          
                          // Buy Signal Confirmation
                          if (buyAllowed) confidence += 15;
                          else confidence -= 10;
                          
                          // Momentum Confirmation
                          if (momentumShift && momentumShift.includes('CONFIRMED')) confidence += 15;
                          else if (momentumShift && momentumShift === 'MOMENTUM_SHIFT') confidence += 5;
                          
                          // Market status adjustment
                          const marketStatus = item.data?.status;
                          if (marketStatus === 'LIVE') confidence += 10;
                          else if (marketStatus === 'CLOSED') confidence -= 5;
                          
                          return Math.min(95, Math.max(20, confidence));
                        })()
                      )}%
                    </span>
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* Trend Status Box */}
                    <div className="bg-dark-surface/50 border border-emerald-500/30 rounded-lg p-2.5">
                      <div className="text-[10px] font-bold text-dark-secondary uppercase tracking-wider opacity-70 mb-1">Trend Status</div>
                      <div className={`text-sm sm:text-base font-bold ${
                        item.data.indicators.trend_status === 'STRONG_UPTREND' || item.data.indicators.trend_status === 'WEAK_UPTREND' ? 'text-bullish' :
                        item.data.indicators.trend_status === 'STRONG_DOWNTREND' || item.data.indicators.trend_status === 'WEAK_DOWNTREND' ? 'text-bearish' :
                        'text-yellow-300'
                      }`}>
                        {item.data.indicators.trend_status === 'STRONG_UPTREND' ? '📈 Strong Uptrend' :
                         item.data.indicators.trend_status === 'STRONG_DOWNTREND' ? '📉 Strong Downtrend' :
                         item.data.indicators.trend_status === 'WEAK_UPTREND' ? '� Weak Uptrend' :
                         item.data.indicators.trend_status === 'WEAK_DOWNTREND' ? '🔴 Weak Downtrend' :
                         item.data.indicators.trend_status === 'COMPRESSION' ? '🟡 Compression' :
                         item.data.indicators.trend_status === 'TRANSITION' ? '🟡 Transition' :
                         '🟡 ' + item.data.indicators.trend_status.replace(/_/g, ' ')}
                      </div>
                    </div>

                    {/* Entry Status */}
                    <div className="flex items-center justify-between bg-dark-surface/40 border border-emerald-500/30 rounded-lg px-3 py-2">
                      <span className="text-xs sm:text-sm text-dark-secondary font-medium">Entries:</span>
                      <span className={`text-xs sm:text-sm font-bold ${
                        item.data.indicators.buy_allowed ? 'text-bullish' : 
                        item.data.indicators.trend_status === 'COMPRESSION' || item.data.indicators.trend_status === 'TRANSITION' ? 'text-yellow-300' :
                        'text-bearish'
                      }`}>
                        {item.data.indicators.buy_allowed ? '✅ ALLOWED' : 
                         item.data.indicators.trend_status === 'COMPRESSION' || item.data.indicators.trend_status === 'TRANSITION' ? '🟡 WAIT' :
                         '❌ AVOID'}
                      </span>
                    </div>

                    {/* EMA Levels Grid */}
                    <div className="grid grid-cols-3 gap-2 bg-dark-surface/50 border border-emerald-500/30 rounded-lg p-2">
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary font-medium">EMA20</div>
                        <div className="font-bold text-xs text-indigo-300">₹{item.data.indicators.ema_20?.toFixed(2) || 'N/A'}</div>
                      </div>
                      <div className="text-center border-l border-r border-emerald-500/30">
                        <div className="text-xs text-dark-secondary font-medium">EMA50</div>
                        <div className="font-bold text-xs text-indigo-300">₹{item.data.indicators.ema_50?.toFixed(2) || 'N/A'}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary font-medium">EMA100</div>
                        <div className="font-bold text-xs text-indigo-300">₹{item.data.indicators.ema_100?.toFixed(2) || 'N/A'}</div>
                      </div>
                    </div>

                    {/* Pullback Level */}
                    {item.data.indicators.pullback_level && item.data.indicators.pullback_level !== 'NONE' && (
                      <div className="flex items-center justify-between bg-dark-surface/40 border border-emerald-500/30 rounded-lg px-3 py-2">
                        <span className="text-xs sm:text-sm text-dark-secondary font-medium">Pullback:</span>
                        <span className={`text-xs sm:text-sm font-bold ${
                          item.data.indicators.pullback_level === 'PULLBACK' ? 'text-bullish' :
                          item.data.indicators.pullback_level === 'EXTENSION' ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>{item.data.indicators.pullback_level}</span>
                      </div>
                    )}

                    {/* Entry Signal Box */}
                    {item.data.indicators.pullback_entry && (
                      <div className="rounded-lg bg-dark-surface/50 border border-emerald-500/30 p-2.5">
                        <div className="text-[10px] font-bold text-dark-secondary uppercase tracking-wider opacity-70 mb-1">Entry Signal</div>
                        <div className={`text-sm sm:text-base font-bold ${
                          item.data.indicators.pullback_entry?.includes('BUY') ? 'text-bullish' :
                          item.data.indicators.pullback_entry?.includes('SELL') ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.pullback_entry.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )}

                    {/* EMA Support Zone */}
                    {item.data.indicators.ema_support_zone && (
                      <div className="text-xs text-dark-tertiary leading-relaxed italic bg-dark-surface/40 border-l-2 border-emerald-500/30 pl-2.5 py-2">
                        {item.data.indicators.ema_support_zone}
                      </div>
                    )}

                    {/* Momentum Shift */}
                    {item.data.indicators.momentum_shift && item.data.indicators.momentum_shift !== 'MIXED' && (
                      <div className="flex items-center justify-between bg-dark-surface/40 border border-emerald-500/30 rounded-lg px-3 py-2">
                        <span className="text-xs sm:text-sm text-dark-secondary font-medium">Momentum:</span>
                        <span className={`text-xs sm:text-sm font-bold ${
                          item.data.indicators.momentum_shift?.includes('BULLISH') ? 'text-bullish' :
                          item.data.indicators.momentum_shift?.includes('BEARISH') ? 'text-bearish' :
                          'text-yellow-300'
                        }`}>
                          {item.data.indicators.momentum_shift.replace(/_/g, ' ')}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8 text-dark-tertiary text-xs">
                    ⏳ Loading EMA analysis...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Camarilla R3/S3 + CPR Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Camarilla R3/S3 • CPR Zones
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Gate level detection • Trending vs Range classification • Trend day signals
              </p>
            </div>
            
            {/* Market Status Panel - Without Confidence */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.camarilla_zone === 'ABOVE_TC'
                  ? 'bg-bullish/20 text-bullish border-bullish/40' :
                analyses?.NIFTY?.indicators?.camarilla_zone === 'BELOW_BC'
                  ? 'bg-bearish/20 text-bearish border-bearish/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.camarilla_zone === 'ABOVE_TC' ? '🟢 BULLISH' :
                 analyses?.NIFTY?.indicators?.camarilla_zone === 'BELOW_BC' ? '🔴 BEARISH' :
                 ''}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`camarilla_${item.symbol}`} className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-dark-surface/30">
                {/* Title & Confidence - Responsive Layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight flex-shrink-0">
                    {item.symbol} • R3/S3
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary whitespace-nowrap">
                      Confidence: {Math.round(
                        item.data?.indicators?.camarilla_confidence || 
                        (() => {
                          const camarillaZone = item.data?.indicators?.camarilla_zone;
                          const camarillaSignal = item.data?.indicators?.camarilla_signal;
                          const trendDaySignal = item.data?.indicators?.trend_day_signal;
                          const trendDayConfidence = item.data?.indicators?.trend_day_confidence || 0;
                          const cprClassification = item.data?.indicators?.cpr_classification;
                          let confidence = 50; // Base confidence
                          
                          // Zone Position Confidence
                          if (camarillaZone === 'ABOVE_TC' || camarillaZone === 'BELOW_BC') confidence += 25; // Clear breakout/breakdown
                          else if (camarillaZone === 'INSIDE_CPR') confidence += 15; // Inside range
                          
                          // Signal Strength
                          if (camarillaSignal && camarillaSignal.includes('_CONFIRMED')) confidence += 20;
                          else if (camarillaSignal && (camarillaSignal.includes('R3_BREAKOUT') || camarillaSignal.includes('S3_BREAKDOWN'))) confidence += 15;
                          
                          // Trend Day Analysis
                          if (trendDaySignal && trendDaySignal.includes('HIGH_PROB')) confidence += 20;
                          else if (trendDaySignal && !trendDaySignal.includes('CHOPPY')) confidence += 10;
                          
                          // CPR Type (Narrow = trending, Wide = ranging)
                          if (cprClassification === 'NARROW') confidence += 15; // Better for breakouts
                          else if (cprClassification === 'WIDE') confidence += 5;
                          
                          // Use backend trend day confidence if available
                          if (trendDayConfidence > 0) {
                            confidence += Math.min(15, trendDayConfidence / 6); // Scale 0-90 to 0-15
                          }
                          
                          // Market status adjustment
                          const marketStatus = item.data?.status;
                          if (marketStatus === 'LIVE') confidence += 10;
                          else if (marketStatus === 'CLOSED') confidence -= 5;
                          
                          return Math.min(95, Math.max(25, confidence));
                        })()
                      )}%
                    </span>
                    {/* Zone Badge */}
                    {item.data?.indicators?.camarilla_zone && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
                        item.data.indicators.camarilla_zone === 'ABOVE_TC' ? 'bg-bullish/20 text-bullish' :
                        item.data.indicators.camarilla_zone === 'BELOW_BC' ? 'bg-bearish/20 text-bearish' :
                        'bg-emerald-500/20 text-emerald-400'
                      }`}>
                        {item.data.indicators.camarilla_zone.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-2.5">
                    {/* Zone Status */}
                    {item.data.indicators.camarilla_zone_status && (
                      <div className="text-xs text-dark-tertiary leading-snug italic border-l-2 border-orange-500/50 pl-2 py-1">
                        {item.data.indicators.camarilla_zone_status}
                      </div>
                    )}

                    {/* CPR Classification */}
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs">
                      <span className="text-dark-secondary font-medium">CPR Type:</span>
                      <span className={`font-bold break-words ${
                        item.data.indicators.cpr_classification === 'NARROW' ? 'text-emerald-400' : 'text-yellow-400'
                      }`}>
                        {item.data.indicators.cpr_classification} ({item.data.indicators.cpr_width_pct?.toFixed(3)}%)
                      </span>
                    </div>

                    {/* CPR Description */}
                    {item.data.indicators.cpr_description && (
                      <div className="text-xs text-dark-tertiary italic">
                        {item.data.indicators.cpr_description}
                      </div>
                    )}

                    {/* Camarilla Signal */}
                    {item.data.indicators.camarilla_signal && (
                      <div className="space-y-1 pt-1 border-t border-dark-secondary/20">
                        <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                          <span className="text-dark-secondary font-medium text-xs">Signal:</span>
                          <span className={`font-bold text-xs break-words ${
                            item.data.indicators.camarilla_signal?.includes('R3_BREAKOUT') ? 'text-bullish' :
                            item.data.indicators.camarilla_signal?.includes('S3_BREAKDOWN') ? 'text-bearish' :
                            'text-orange-400'
                          }`}>
                            {item.data.indicators.camarilla_signal.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Signal Description */}
                    {item.data.indicators.camarilla_signal_desc && (
                      <div className="text-xs text-dark-tertiary leading-snug border-l-2 border-orange-500/30 pl-2 py-1">
                        {item.data.indicators.camarilla_signal_desc}
                      </div>
                    )}

                    {/* Trend Day Signal */}
                    {item.data.indicators.trend_day_signal && (
                      <div className="space-y-1 pt-2 border-t border-dark-secondary/20">
                        <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                          <span className="text-dark-secondary font-medium text-xs">Trend Day:</span>
                          <div className="flex flex-col gap-0.5">
                            <div className={`font-bold text-xs break-words ${
                              item.data.indicators.trend_day_signal?.includes('BULLISH') ? 'text-bullish' :
                              item.data.indicators.trend_day_signal?.includes('BEARISH') ? 'text-bearish' :
                              'text-orange-400'
                            }`}>
                              {item.data.indicators.trend_day_signal.replace(/_/g, ' ')}
                            </div>
                            {item.data.indicators.trend_day_confidence > 0 && (
                              <div className={`text-xs font-semibold ${
                                item.data.indicators.trend_day_confidence >= 80 ? 'text-emerald-400' : 'text-yellow-400'
                              }`}>
                                {item.data.indicators.trend_day_confidence}% confidence
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CPR & Gate Levels */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-dark-secondary/20">
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary">TC (R3)</div>
                        <div className="font-bold text-xs text-bullish">₹{item.data.indicators.cpr_top_central}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary">BC (S3)</div>
                        <div className="font-bold text-xs text-bearish">₹{item.data.indicators.cpr_bottom_central}</div>
                      </div>
                      <div className="text-center col-span-2">
                        <div className="text-xs text-dark-secondary">Pivot (P)</div>
                        <div className="font-bold text-xs text-orange-400">₹{item.data.indicators.cpr_pivot}</div>
                      </div>
                    </div>

                    {/* CPR Width */}
                    <div className="bg-dark-secondary/20 rounded-md p-1.5 text-xs">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-dark-secondary">CPR Width:</span>
                        <span className="font-bold text-orange-400 break-words">₹{item.data.indicators.cpr_width} ({item.data.indicators.cpr_width_pct?.toFixed(3)}%)</span>
                      </div>
                    </div>

                    {/* Price vs CPR */}
                    <div className={`text-xs text-center py-1.5 rounded-md font-bold ${
                      item.data.indicators.camarilla_zone === 'ABOVE_TC' ? 'bg-bullish/20 text-bullish' :
                      item.data.indicators.camarilla_zone === 'BELOW_BC' ? 'bg-bearish/20 text-bearish' :
                      'bg-orange-500/20 text-orange-400'
                    }`}>
                      Price: ₹{item.data.indicators.price}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-dark-tertiary text-xs">
                    Loading Camarilla analysis...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Parabolic SAR - Trend Following Section */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Parabolic SAR • Trend Following
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Real-time trailing stops • Trend mode detection • Flip signals  
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.sar_position === 'BELOW'
                  ? 'bg-bullish/20 text-bullish border-bullish/40' :
                analyses?.NIFTY?.indicators?.sar_position === 'ABOVE'
                  ? 'bg-bearish/20 text-bearish border-bearish/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.sar_position === 'BELOW' ? '🟢 BULLISH' :
                 analyses?.NIFTY?.indicators?.sar_position === 'ABOVE' ? '🔴 BEARISH' :
                 ''}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`sar_${item.symbol}`} className={`border-2 border-emerald-500/30 rounded-xl p-3 transition-all duration-300 backdrop-blur-sm ${
                !item.data 
                  ? 'bg-dark-card/30'
                  : item.data.indicators?.sar_position === 'BELOW'
                  ? 'bg-bullish/5 shadow-lg shadow-bullish/20'
                  : item.data.indicators?.sar_position === 'ABOVE'
                  ? 'bg-bearish/5 shadow-lg shadow-bearish/20'
                  : 'bg-purple-500/5 shadow-lg shadow-purple-500/20'
              }`}>
                {/* Title & Position - Responsive Layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight flex-shrink-0">
                    {item.symbol} • SAR
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary whitespace-nowrap">
                      Confidence: {Math.round(item.data?.indicators?.sar_signal_strength || (item.data?.indicators?.sar_position ? 65 : 30))}%
                    </span>
                    {/* Position Badge - Only show when valid position exists */}
                    {item.data?.indicators?.sar_position && (item.data.indicators.sar_position === 'BELOW' || item.data.indicators.sar_position === 'ABOVE') && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
                        item.data.indicators.sar_position === 'BELOW' ? 'bg-bullish/20 text-bullish' :
                        'bg-bearish/20 text-bearish'
                      }`}>
                        {item.data.indicators.sar_position === 'BELOW' ? '📈 Bullish' : '📉 Bearish'}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-2.5">
                    {/* SAR Trend Status */}
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-1 text-xs">
                      <span className="text-dark-secondary font-medium">Trend:</span>
                      <span className={`font-bold break-words ${
                        item.data.indicators.sar_trend === 'BULLISH' ? 'text-bullish' :
                        item.data.indicators.sar_trend === 'BEARISH' ? 'text-bearish' :
                        'text-purple-400'
                      }`}>
                        {item.data.indicators.sar_trend}
                      </span>
                    </div>

                    {/* SAR Signal */}
                    {item.data.indicators.sar_signal && (
                      <div className="space-y-1">
                        <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                          <span className="text-dark-secondary font-medium text-xs">Signal:</span>
                          <span className={`font-bold text-xs break-words ${
                            item.data.indicators.sar_signal?.includes('BUY_VALID_STRONG') ? 'text-bullish' :
                            item.data.indicators.sar_signal?.includes('SELL_VALID_STRONG') ? 'text-bearish' :
                            item.data.indicators.sar_signal?.includes('BUY_VALID') ? 'text-emerald-400' :
                            item.data.indicators.sar_signal?.includes('SELL_VALID') ? 'text-orange-400' :
                            'text-yellow-400'
                          }`}>
                            {item.data.indicators.sar_signal.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* SAR Signal Strength */}
                    {item.data.indicators.sar_signal_strength > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-dark-secondary font-medium">Strength:</span>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all ${
                                item.data.indicators.sar_signal_strength >= 80 ? 'bg-bullish' :
                                item.data.indicators.sar_signal_strength >= 60 ? 'bg-emerald-500' :
                                'bg-yellow-500'
                              }`}
                              style={{ width: `${item.data.indicators.sar_signal_strength}%` }}
                            />
                          </div>
                          <span className="font-bold text-xs text-dark-text w-6 text-right">
                            {item.data.indicators.sar_signal_strength}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* SAR Flip Warning */}
                    {item.data.indicators.sar_flip && item.data.indicators.sar_flip_type && (
                      <div className={`text-xs p-1.5 rounded-md font-bold border-l-4 ${
                        item.data.indicators.sar_flip_type?.includes('BUY') 
                          ? 'border-emerald-500/50 bg-bullish/10 text-bullish' 
                          : 'border-emerald-500/50 bg-bearish/10 text-bearish'
                      }`}>
                        🔄 {item.data.indicators.sar_flip_type.replace(/_/g, ' ')}
                      </div>
                    )}

                    {/* Confirmation Status */}
                    {item.data.indicators.sar_confirmation_status && (
                      <div className="text-xs text-dark-tertiary leading-snug italic border-l-2 border-emerald-500/50 pl-2 py-1">
                        {item.data.indicators.sar_confirmation_status}
                      </div>
                    )}

                    {/* Trailing Stop Loss & Distance */}
                    <div className="bg-dark-secondary/20 border border-emerald-500/30 rounded-md p-2 space-y-1">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-dark-secondary text-xs">Trailing SL:</span>
                        <span className={`font-bold text-xs break-words ${
                          item.data.indicators.sar_position === 'BELOW' ? 'text-bullish' :
                          item.data.indicators.sar_position === 'ABOVE' ? 'text-bearish' :
                          'text-purple-400'
                        }`}>
                          ₹{item.data.indicators.trailing_sl}
                        </span>
                      </div>
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1">
                        <span className="text-dark-secondary text-xs">Distance:</span>
                        <span className="font-bold text-dark-text text-xs break-words">
                          ₹{item.data.indicators.distance_to_sar} ({item.data.indicators.distance_to_sar_pct?.toFixed(3)}%)
                        </span>
                      </div>
                    </div>

                    {/* Current Price vs SAR */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-500/30">
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary">Current Price</div>
                        <div className="font-bold text-xs text-purple-400">₹{item.data.indicators.price}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-dark-secondary">SAR</div>
                        <div className={`font-bold text-xs ${
                          item.data.indicators.sar_position === 'BELOW' ? 'text-bullish' :
                          item.data.indicators.sar_position === 'ABOVE' ? 'text-bearish' :
                          'text-dark-tertiary'
                        }`}>
                          ₹{item.data.indicators.sar_value}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-dark-tertiary text-xs">
                    Loading SAR analysis...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* SuperTrend (10,2) - Professional Intraday + Combined Confirmation Section */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                SuperTrend (10,2) • Trend Following
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Pure SuperTrend signals • Clear trend direction • Simple buy/sell alerts
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.supertrend_10_2_signal === 'BUY'
                  ? 'bg-green-900/20 text-green-400 border-green-500/40' :
                analyses?.NIFTY?.indicators?.supertrend_10_2_signal === 'SELL'
                  ? 'bg-red-900/20 text-red-400 border-red-500/40' :
                  'bg-yellow-900/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.supertrend_10_2_signal === 'BUY' ? '🟢 BUY SIGNAL' :
                 analyses?.NIFTY?.indicators?.supertrend_10_2_signal === 'SELL' ? '🔴 SELL SIGNAL' :
                 '🟡 NEUTRAL'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`st_${item.symbol}`} className={`border-2 border-emerald-500/30 rounded-xl p-3 transition-all duration-300 backdrop-blur-sm ${
                !item.data 
                  ? 'bg-dark-card/30'
                  : item.data.indicators?.supertrend_10_2_trend === 'BULLISH'
                  ? 'bg-green-900/10 shadow-lg shadow-green-500/10'
                  : item.data.indicators?.supertrend_10_2_trend === 'BEARISH'
                  ? 'bg-red-900/10 shadow-lg shadow-red-500/10'
                  : 'bg-yellow-900/10 shadow-lg shadow-yellow-500/10'
              }`}>
                {/* Title & Signal - Responsive Layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight flex-shrink-0">
                    {item.symbol} • ST(10,2)
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary whitespace-nowrap">
                      Confidence: {Math.round(item.data?.indicators?.supertrend_10_2_confidence || Math.min(Math.abs(item.data?.indicators?.supertrend_10_2_distance_pct || 0) * 15, 95))}%
                    </span>
                    {/* Signal Badge - Only show when valid signal exists */}
                    {item.data?.indicators?.supertrend_10_2_signal && (item.data.indicators.supertrend_10_2_signal === 'BUY' || item.data.indicators.supertrend_10_2_signal === 'SELL') && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
                        item.data.indicators.supertrend_10_2_signal === 'BUY' ? 'bg-green-900/20 text-green-400' :
                        'bg-red-900/20 text-red-400'
                      }`}>
                        {item.data.indicators.supertrend_10_2_signal === 'BUY' ? '🟢 BUY' : '🔴 SELL'}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* SuperTrend Status */}
                    <div className={`p-3 rounded-xl border-2 text-center ${
                      item.data.indicators.supertrend_10_2_trend === 'BULLISH' 
                        ? 'bg-green-900/20 border-green-500/30 text-green-400' 
                        : item.data.indicators.supertrend_10_2_trend === 'BEARISH'
                        ? 'bg-red-900/20 border-red-500/30 text-red-400'
                        : 'bg-yellow-900/20 border-yellow-500/30 text-yellow-300'
                    }`}>
                      <div className="text-lg font-bold">
                        {item.data.indicators.supertrend_10_2_trend === 'BULLISH' ? '📈 BULLISH TREND' :
                         item.data.indicators.supertrend_10_2_trend === 'BEARISH' ? '📉 BEARISH TREND' :
                         '🟡 NEUTRAL TREND'}
                      </div>
                      <div className="text-xs mt-1 opacity-80">
                        SuperTrend is {item.data.indicators.supertrend_10_2_trend === 'BULLISH' ? 'bullish' :
                                      item.data.indicators.supertrend_10_2_trend === 'BEARISH' ? 'bearish' : 'neutral'}
                      </div>
                    </div>

                    {/* Current Price vs SuperTrend */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-dark-surface/40 border border-emerald-500/30 rounded-lg p-3 text-center">
                        <div className="text-xs text-dark-secondary mb-1">Current Price</div>
                        <div className="font-bold text-sm text-purple-400">₹{item.data.indicators.price}</div>
                      </div>
                      <div className="bg-dark-surface/40 border border-emerald-500/30 rounded-lg p-3 text-center">
                        <div className="text-xs text-dark-secondary mb-1">SuperTrend Level</div>
                        <div className={`font-bold text-sm ${
                          item.data.indicators.supertrend_10_2_trend === 'BULLISH' ? 'text-green-400' :
                          item.data.indicators.supertrend_10_2_trend === 'BEARISH' ? 'text-red-400' :
                          'text-yellow-300'
                        }`}>
                          ₹{item.data.indicators.supertrend_10_2_value}
                        </div>
                      </div>
                    </div>

                    {/* Distance Analysis */}
                    <div className="bg-dark-surface/30 border border-emerald-500/30 rounded-lg p-3">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-1 mb-2">
                        <span className="text-xs text-dark-secondary">Distance from SuperTrend:</span>
                        <span className="text-xs font-bold text-dark-text break-words">
                          ₹{item.data.indicators.supertrend_10_2_distance} ({item.data.indicators.supertrend_10_2_distance_pct?.toFixed(2)}%)
                        </span>
                      </div>
                      <div className={`text-xs p-2 rounded border-l-4 ${
                        Math.abs(item.data.indicators.supertrend_10_2_distance_pct) < 0.5 
                          ? 'border-yellow-500/50 bg-yellow-900/10 text-yellow-300' 
                          : item.data.indicators.supertrend_10_2_trend === 'BULLISH'
                          ? 'border-green-500/50 bg-green-900/10 text-green-400'
                          : 'border-red-500/50 bg-red-900/10 text-red-400'
                      }`}>
                        {Math.abs(item.data.indicators.supertrend_10_2_distance_pct) < 0.5 
                          ? '🟡 Very close to SuperTrend line - Watch for trend change'
                          : item.data.indicators.supertrend_10_2_trend === 'BULLISH'
                          ? '🟢 Good distance above SuperTrend - Strong uptrend'
                          : '🔴 Good distance below SuperTrend - Strong downtrend'
                        }
                      </div>
                    </div>

                    {/* Simple Entry/Exit Guide */}
                    <div className={`p-3 rounded-lg border-l-4 ${
                      item.data.indicators.supertrend_10_2_signal === 'BUY' 
                        ? 'border-green-500/50 bg-green-900/10 text-green-400'
                        : item.data.indicators.supertrend_10_2_signal === 'SELL'
                        ? 'border-red-500/50 bg-red-900/10 text-red-400'
                        : 'border-yellow-500/50 bg-yellow-900/10 text-yellow-300'
                    }`}>
                      <div className="font-bold text-sm mb-1">
                        {item.data.indicators.supertrend_10_2_signal === 'BUY' ? '🟢 BUY SIGNAL ACTIVE' :
                         item.data.indicators.supertrend_10_2_signal === 'SELL' ? '🔴 SELL SIGNAL ACTIVE' :
                         '🟡 HOLD - NO CLEAR SIGNAL'}
                      </div>
                      <div className="text-xs opacity-90">
                        {item.data.indicators.supertrend_10_2_signal === 'BUY' ? 'Price above SuperTrend line - Consider long positions' :
                         item.data.indicators.supertrend_10_2_signal === 'SELL' ? 'Price below SuperTrend line - Consider short positions' :
                         'Wait for clear SuperTrend signal before entering'}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-xs text-dark-secondary italic">Loading SuperTrend data...</div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Opening Range Breakout (ORB) - Intraday Breakout System */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Opening Range Breakout (ORB)
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                First 5-min range capture • Breakout/Breakdown detection • Risk/Reward setup
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.orb_status === 'BREAKOUT_UP'
                  ? 'bg-bullish/20 text-bullish border-bullish/40' :
                analyses?.NIFTY?.indicators?.orb_status === 'BREAKOUT_DOWN'
                  ? 'bg-bearish/20 text-bearish border-bearish/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.orb_status === 'BREAKOUT_UP' ? '🟢 BULLISH' :
                 analyses?.NIFTY?.indicators?.orb_status === 'BREAKOUT_DOWN' ? '🔴 BEARISH' :
                 ''}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => (
              <div key={`orb_${item.symbol}`} className={`border-2 border-emerald-500/30 rounded-xl p-3 transition-all duration-300 backdrop-blur-sm ${
                !item.data 
                  ? 'bg-dark-card/30'
                  : item.data.indicators?.orb_position === 'ABOVE_HIGH'
                  ? 'bg-bullish/5 shadow-lg shadow-bullish/20'
                  : item.data.indicators?.orb_position === 'BELOW_LOW'
                  ? 'bg-bearish/5 shadow-lg shadow-bearish/20'
                  : 'bg-amber-500/5 shadow-lg shadow-amber-500/20'
              }`}>
                {/* Title & Position - Responsive Layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
                  <h4 className="font-bold text-dark-text text-sm sm:text-base tracking-tight flex-shrink-0">
                    {item.symbol} • ORB
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Confidence Percentage */}
                    <span className="text-xs font-bold text-dark-secondary whitespace-nowrap">
                      Confidence: {Math.round(
                        item.data?.indicators?.orb_confidence ||
                        item.data?.indicators?.orb_strength ||
                        (() => {
                          const orbStatus = item.data?.indicators?.orb_status;
                          const orbPosition = item.data?.indicators?.orb_position;
                          const marketStatus = item.data?.status;
                          
                          let confidence = 45; // Base confidence
                          
                          // Position-based confidence
                          if (orbPosition === 'ABOVE_HIGH' || orbPosition === 'BELOW_LOW') {
                            confidence += 25; // Clear breakout
                          } else if (orbPosition === 'INSIDE_RANGE') {
                            confidence += 5; // Inside range - waiting
                          }
                          
                          // Status-based confidence
                          if (orbStatus && orbStatus.includes('Breakout')) {
                            confidence += 15; // Confirmed breakout
                          }
                          
                          // Market status adjustment
                          if (marketStatus === 'LIVE') {
                            confidence += 10; // Live market boost
                          } else if (marketStatus === 'CLOSED') {
                            confidence -= 10; // Reduce for closed market
                          }
                          
                          return Math.min(90, Math.max(30, confidence));
                        })()
                      )}%
                    </span>
                    {/* Position Badge - Only show when valid position exists */}
                    {item.data?.indicators?.orb_position && (item.data.indicators.orb_position === 'ABOVE_HIGH' || item.data.indicators.orb_position === 'BELOW_LOW' || item.data.indicators.orb_position === 'INSIDE_RANGE') && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
                        item.data.indicators.orb_position === 'ABOVE_HIGH' ? 'bg-bullish/20 text-bullish' :
                        item.data.indicators.orb_position === 'BELOW_LOW' ? 'bg-bearish/20 text-bearish' :
                        'bg-amber-500/20 text-amber-400'
                      }`}>
                        {item.data.indicators.orb_position === 'ABOVE_HIGH' ? '📈 Above' :
                         item.data.indicators.orb_position === 'BELOW_LOW' ? '📉 Below' :
                         '⊡ Inside'}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-2.5">
                    {/* ORB Status Signal */}
                    {item.data.indicators.orb_status && (
                      <div className={`text-xs sm:text-sm font-bold p-2 rounded-md text-center border-l-4 ${
                        item.data.indicators.orb_position === 'ABOVE_HIGH' 
                          ? 'bg-bullish/20 text-bullish border-emerald-500/50' 
                          : item.data.indicators.orb_position === 'BELOW_LOW'
                          ? 'bg-bearish/20 text-bearish border-emerald-500/50'
                          : 'bg-amber-500/20 text-amber-400 border-emerald-500/50'
                      }`}>
                        {item.data.indicators.orb_status}
                      </div>
                    )}

                    {/* ORB Levels Grid */}
                    <div className="grid grid-cols-2 gap-2 bg-dark-secondary/20 border border-emerald-500/30 rounded-md p-2">
                      <div>
                        <div className="text-xs text-dark-secondary font-medium">ORB High</div>
                        <div className="font-bold text-xs text-bullish">₹{item.data.indicators.orb_high}</div>
                      </div>
                      <div>
                        <div className="text-xs text-dark-secondary font-medium">ORB Low</div>
                        <div className="font-bold text-xs text-bearish">₹{item.data.indicators.orb_low}</div>
                      </div>
                    </div>

                    {/* ORB Range */}
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-dark-secondary font-medium">ORB Range:</span>
                      <span className="font-bold text-dark-text">₹{item.data.indicators.orb_range}</span>
                    </div>

                    {/* Current Price Position */}
                    <div className="flex justify-between items-center text-xs bg-dark-secondary/20 border border-emerald-500/30 p-1.5 rounded">
                      <span className="text-dark-secondary">Current Price:</span>
                      <span className="font-bold text-amber-400">₹{item.data.indicators.price}</span>
                    </div>

                    {/* Distances to ORB Levels */}
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-dark-secondary">Distance to ORB High:</span>
                        <span className="font-bold text-bullish">{item.data.indicators.distance_to_orb_high}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-dark-secondary">Distance to ORB Low:</span>
                        <span className="font-bold text-bearish">{item.data.indicators.distance_to_orb_low}</span>
                      </div>
                    </div>

                    {/* ORB Strength Meter */}
                    {item.data.indicators.orb_strength > 0 && (
                      <div className="flex justify-between items-center text-xs">
                        <span className="text-dark-secondary font-medium">Strength:</span>
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
                            <div 
                              className={`h-full transition-all ${
                                item.data.indicators.orb_strength >= 80 ? 'bg-bullish' :
                                item.data.indicators.orb_strength >= 70 ? 'bg-emerald-500' :
                                'bg-yellow-500'
                              }`}
                              style={{ width: `${item.data.indicators.orb_strength}%` }}
                            />
                          </div>
                          <span className="font-bold text-xs text-dark-text w-6 text-right">
                            {item.data.indicators.orb_strength}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Confirmation Message */}
                    {item.data.indicators.orb_confirmation && (
                      <div className="text-xs text-dark-tertiary italic border-l-2 border-emerald-500/50 pl-2 py-1 bg-amber-500/10 rounded">
                        {item.data.indicators.orb_confirmation}
                      </div>
                    )}

                    {/* Risk/Reward Ratio */}
                    {item.data.indicators.orb_reward_risk_ratio && (
                      <div className="flex justify-between items-center text-xs bg-dark-secondary/20 border border-emerald-500/30 p-1.5 rounded">
                        <span className="text-dark-secondary font-medium">Risk/Reward:</span>
                        <span className={`font-bold ${
                          item.data.indicators.orb_reward_risk_ratio >= 2 ? 'text-bullish' :
                          item.data.indicators.orb_reward_risk_ratio >= 1.5 ? 'text-emerald-400' :
                          'text-yellow-400'
                        }`}>
                          1 : {item.data.indicators.orb_reward_risk_ratio}
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-dark-secondary italic py-2">Waiting for data...</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Pivot Points
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Classic Pivots (S3/R3) • Camarilla Zones (S3/R3)
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator - Placeholder for consistency */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm bg-emerald-500/20 text-emerald-300 border-emerald-500/40`}>
                📊 Classic & Camarilla
              </div>
            </div>
          </div>

          {/* Unified Pivot Section - All Symbols */}
          <PivotSectionUnified updates={updateCounter} />
        </div>

        {/* Candle Intent Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Candle Intent (Candle Structure)
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Advanced candle pattern analysis • Wick dominance • Volume-price efficiency
              </p>
            </div>
          </div>

          {/* Candle Intent Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <CandleIntentCard symbol="NIFTY" name="NIFTY 50" />
            <CandleIntentCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <CandleIntentCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Zone Control Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Zone Control & Breakdown Risk
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Advanced support/resistance zones • Breakdown risk assessment • Key levels
            </p>
          </div>

          {/* Zone Control Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <ZoneControlCard symbol="NIFTY" name="NIFTY 50" />
            <ZoneControlCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <ZoneControlCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Volume Pulse Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Volume Pulse (Candle Volume)
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Real-time buying/selling pressure • Green vs Red candle volume tracking
            </p>
          </div>

          {/* Volume Pulse Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <VolumePulseCard symbol="NIFTY" name="NIFTY 50" />
            <VolumePulseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <VolumePulseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Trend Base Section - NEW */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-emerald-500 to-emerald-600 rounded-full shadow-lg shadow-emerald-500/30" />
                Trend Base (Higher-Low Structure)
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Advanced swing structure analysis • Higher-high/higher-low detection
            </p>
            
            {/* Market Status & Confidence Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.trend_structure === 'HIGHER_HIGHS_LOWS' 
                  ? 'bg-bullish/20 text-bullish border-bullish/40' :
                analyses?.NIFTY?.indicators?.trend_structure === 'LOWER_HIGHS_LOWS'
                  ? 'bg-bearish/20 text-bearish border-bearish/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.trend_structure === 'HIGHER_HIGHS_LOWS' ? '🟢 UPTREND' :
                 analyses?.NIFTY?.indicators?.trend_structure === 'LOWER_HIGHS_LOWS' ? '🔴 DOWNTREND' :
                 analyses?.NIFTY?.indicators?.trend_structure === 'SIDEWAYS' ? '🟡 SIDEWAYS' :
                 ''}
              </div>
            </div>
          </div>

          {/* Trend Base Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-3">
            <TrendBaseCard symbol="NIFTY" name="NIFTY 50" />
            <TrendBaseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <TrendBaseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>
      </div>
      

      {/* Analysis Info Banner */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <div className="mt-4 p-4 bg-black/40 border-2 border-green-500/40 rounded-xl shadow-lg shadow-green-500/20">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">📊</div>
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
          <span className="tracking-wide">MyDailyTradingSignals © {currentYear}</span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-bullish rounded-full animate-pulse shadow-md shadow-bullish" />
            <span className="hidden sm:inline">Built for</span> Harikrishna Challa
          </span>
        </div>
      </footer>
    </main>
  );
}

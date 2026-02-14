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
const MarketStructure = dynamic(() => import('@/components/MarketStructure'), { ssr: false });
const InstitutionalMarketView = dynamic(() => import('@/components/InstitutionalMarketView'), { ssr: false });
const CandleQualityAnalysis = dynamic(() => import('@/components/CandleQualityAnalysis'), { ssr: false });

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

      // Section 5: REMOVED - EMA200 Position (EMA Traffic Light integration removed)

      // Section 6: REMOVED - VWAP Position (section removed from calculation)

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

      // Section 14: RANGE STRENGTH - Market Structure (Professional Trader Signal)
      sectionCount++;
      const dayHigh14 = tick.high || ind.high || 0;
      const dayLow14 = tick.low || ind.low || 0;
      const price14 = price;
      if (price14 > 0 && dayHigh14 > dayLow14) {
        const rangeSpan = dayHigh14 - dayLow14;
        const positionFromLow = rangeSpan > 0 ? (price14 - dayLow14) / rangeSpan : 0.5;
        
        // Professional trader logic: 70%+ = Strong bullish, 30%- = Strong bearish
        if (positionFromLow > 0.7) { 
          buyCount++; 
          // Higher confidence for strong range positions
          const rangeConfidence = Math.min(95, 75 + (positionFromLow - 0.7) * 100);
          totalConfidenceSum += rangeConfidence;
        } else if (positionFromLow < 0.3) { 
          sellCount++; 
          const rangeConfidence = Math.min(95, 75 + (0.3 - positionFromLow) * 100);
          totalConfidenceSum += rangeConfidence;
        } else { 
          neutralCount++; 
          totalConfidenceSum += 50; 
        }
      } else { 
        neutralCount++; 
        totalConfidenceSum += 50; 
      }

      // Section 15: REMOVED - VWAP REACTION (section removed from calculation)

      // Section 16: VERY GOOD VOLUME - Candle Quality Assessment (Professional Volume Confirmation)
      sectionCount++;
      const candleOpen = tick.open || ind.open || price;
      const candleClose = price;
      const candleHigh = tick.high || ind.high || 0;
      const candleLow = tick.low || ind.low || 0;
      const candleVolume = tick.volume || ind.volume || 0;
      const last5VolumeAvg = analysisData?.volume?.last_5_avg || (candleVolume * 0.78);
      
      if (candleHigh > candleLow && candleLow > 0) {
        const candleRange = candleHigh - candleLow;
        const candleBody = Math.abs(candleClose - candleOpen);
        const bodyPercent = (candleBody / candleRange) * 100;
        const volumeRatio = last5VolumeAvg > 0 ? candleVolume / last5VolumeAvg : 1;
        
        const candleDir = candleClose > candleOpen ? 'BULLISH' : candleClose < candleOpen ? 'BEARISH' : 'DOJI';
        
        // 🔥 VERY GOOD VOLUME: All 3 conditions met (professional institutional signal)
        const meetsMinVolume = candleVolume > 50000;
        const meetsRatioThreshold = volumeRatio > 1.8;
        const meetsBodyStrength = bodyPercent > 60;
        const isVeryGoodVolume = meetsMinVolume && meetsRatioThreshold && meetsBodyStrength;
        
        // 🚨 FAKE SPIKE: High volume but weak body (liquidation trap)
        const isFakeSpike = candleVolume > (last5VolumeAvg * 2.5) && bodyPercent < 40;
        
        if (isVeryGoodVolume) {
          if (candleDir === 'BULLISH') {
            buyCount++;
            // VERY GOOD VOLUME on bullish = 95-98% confidence (institutional-grade conviction)
            const volumeConfidence = Math.min(98, 95 + (Math.min(bodyPercent - 60, 20) * 0.1));
            totalConfidenceSum += volumeConfidence;
          } else if (candleDir === 'BEARISH') {
            sellCount++;
            // VERY GOOD VOLUME on bearish = 95-98% confidence
            const volumeConfidence = Math.min(98, 95 + (Math.min(bodyPercent - 60, 20) * 0.1));
            totalConfidenceSum += volumeConfidence;
          } else {
            neutralCount++;
            totalConfidenceSum += 50;
          }
        } else if (isFakeSpike) {
          // FAKE SPIKE: High volume but weak body = OPPOSITE signal (reversal imminent)
          if (candleDir === 'BULLISH') {
            sellCount++; // Fake bull = upcoming correction
            totalConfidenceSum += 75; // High confidence it's a trap
          } else if (candleDir === 'BEARISH') {
            buyCount++; // Fake bear = upcoming bounce
            totalConfidenceSum += 75;
          } else {
            neutralCount++;
            totalConfidenceSum += 50;
          }
        } else {
          neutralCount++;
          totalConfidenceSum += 50;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

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
                (13 Signals • Volume • Momentum • Support/Resistance • PCR)
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

        {/* 🏗️ MARKET STRUCTURE - Trader's Perspective (25% Analysis Component) */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-600/15">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-emerald-400 to-emerald-500 rounded-full shadow-lg shadow-emerald-500/40" />
                Support/Resistance Zones • Institutional Levels
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Price Structure • Trend • Liquidity Zones • Classical Analysis • Previous Day Levels
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <MarketStructure symbol="NIFTY" name="NIFTY 50" data={marketData.NIFTY} analysis={analyses?.NIFTY} />
            <MarketStructure symbol="BANKNIFTY" name="BANK NIFTY" data={marketData.BANKNIFTY} analysis={analyses?.BANKNIFTY} />
            <MarketStructure symbol="SENSEX" name="SENSEX" data={marketData.SENSEX} analysis={analyses?.SENSEX} />
          </div>
        </div>

        {/* Institutional Market View Section - Professional Analysis */}
        <div className="mt-6 sm:mt-6 border-2 border-purple-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-600/15">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-purple-400 to-purple-500 rounded-full shadow-lg shadow-purple-500/40" />
                Smart Money Flow • Order Structure Intelligence
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Order Flow • Institutional Positioning • Fair Value Gaps • Order Blocks • Market Imbalances
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <InstitutionalMarketView symbol="NIFTY" name="NIFTY 50" analysis={analyses?.NIFTY} marketData={marketData.NIFTY} />
            <InstitutionalMarketView symbol="BANKNIFTY" name="BANK NIFTY" analysis={analyses?.BANKNIFTY} marketData={marketData.BANKNIFTY} />
            <InstitutionalMarketView symbol="SENSEX" name="SENSEX" analysis={analyses?.SENSEX} marketData={marketData.SENSEX} />
          </div>
        </div>

        
        {/* Candle Quality & Volume Integrity Section */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-600/15">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-emerald-400 to-emerald-500 rounded-full shadow-lg shadow-emerald-500/40" />
                High Volume Candle Scanner
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Fake Spike Detection • Body Strength • Very Good Volume • Conviction Moves • Volume Filter Logic
              </p>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <CandleQualityAnalysis symbol="NIFTY" name="NIFTY 50" data={marketData.NIFTY} analysis={analyses?.NIFTY} />
            <CandleQualityAnalysis symbol="BANKNIFTY" name="BANK NIFTY" data={marketData.BANKNIFTY} analysis={analyses?.BANKNIFTY} />
            <CandleQualityAnalysis symbol="SENSEX" name="SENSEX" data={marketData.SENSEX} analysis={analyses?.SENSEX} />
          </div>
        </div>

        {/* Intraday Analysis Section - With Border */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div className="flex-1">
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-accent to-accent-secondary rounded-full shadow-lg shadow-accent/30" />
                Intraday Technical Analysis
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                AI-Powered Signals • VWAP • EMA • Support/Resistance • Volume • Momentum • PCR
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 ml-4 sm:ml-0">
              {/* Confidence Indicators - Synced with Overall Market Outlook */}
              <div className="flex items-center gap-2">
                {/* NIFTY Confidence */}
                <div className={`px-3 py-2 rounded-lg border-2 shadow-md transition-all duration-300 ${
                  (analyses?.NIFTY?.confidence || 0) >= 80 
                    ? 'bg-[#00C087]/20 border-[#00C087]/50 shadow-[#00C087]/20' 
                    : (analyses?.NIFTY?.confidence || 0) >= 60
                    ? 'bg-emerald-500/15 border-emerald-500/40 shadow-emerald-500/20'
                    : 'bg-amber-500/15 border-amber-500/40 shadow-amber-500/20'
                }`}>
                  <div className="text-[9px] sm:text-[10px] text-slate-300 font-semibold mb-0.5">NIFTY</div>
                  <div className={`text-xs sm:text-sm font-bold ${
                    (analyses?.NIFTY?.confidence || 0) >= 80 ? 'text-[#00D09C]' :
                    (analyses?.NIFTY?.confidence || 0) >= 60 ? 'text-emerald-300' :
                    'text-amber-300'
                  }`}>
                    {Math.round((analyses?.NIFTY?.confidence || 0) * 100)}%
                  </div>
                </div>

                {/* BANK NIFTY Confidence */}
                <div className={`px-3 py-2 rounded-lg border-2 shadow-md transition-all duration-300 ${
                  (analyses?.BANKNIFTY?.confidence || 0) >= 80 
                    ? 'bg-[#00C087]/20 border-[#00C087]/50 shadow-[#00C087]/20' 
                    : (analyses?.BANKNIFTY?.confidence || 0) >= 60
                    ? 'bg-emerald-500/15 border-emerald-500/40 shadow-emerald-500/20'
                    : 'bg-amber-500/15 border-amber-500/40 shadow-amber-500/20'
                }`}>
                  <div className="text-[9px] sm:text-[10px] text-slate-300 font-semibold mb-0.5">BNIFTY</div>
                  <div className={`text-xs sm:text-sm font-bold ${
                    (analyses?.BANKNIFTY?.confidence || 0) >= 80 ? 'text-[#00D09C]' :
                    (analyses?.BANKNIFTY?.confidence || 0) >= 60 ? 'text-emerald-300' :
                    'text-amber-300'
                  }`}>
                    {Math.round((analyses?.BANKNIFTY?.confidence || 0) * 100)}%
                  </div>
                </div>

                {/* SENSEX Confidence */}
                <div className={`px-3 py-2 rounded-lg border-2 shadow-md transition-all duration-300 ${
                  (analyses?.SENSEX?.confidence || 0) >= 80 
                    ? 'bg-[#00C087]/20 border-[#00C087]/50 shadow-[#00C087]/20' 
                    : (analyses?.SENSEX?.confidence || 0) >= 60
                    ? 'bg-emerald-500/15 border-emerald-500/40 shadow-emerald-500/20'
                    : 'bg-amber-500/15 border-amber-500/40 shadow-amber-500/20'
                }`}>
                  <div className="text-[9px] sm:text-[10px] text-slate-300 font-semibold mb-0.5">SENSEX</div>
                  <div className={`text-xs sm:text-sm font-bold ${
                    (analyses?.SENSEX?.confidence || 0) >= 80 ? 'text-[#00D09C]' :
                    (analyses?.SENSEX?.confidence || 0) >= 60 ? 'text-emerald-300' :
                    'text-amber-300'
                  }`}>
                    {Math.round((analyses?.SENSEX?.confidence || 0) * 100)}%
                  </div>
                </div>
              </div>

              {/* Live Status Indicator */}
              <div className={`flex items-center gap-2 text-xs sm:text-sm px-4 py-2 rounded-xl border-2 font-bold shadow-lg transition-all duration-300 ${
                isConnected && analyses
                  ? 'bg-bullish/10 border-bullish/30 text-bullish shadow-bullish/20 hover:shadow-bullish/30' 
                  : isConnected && !analyses
                  ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400 shadow-yellow-500/20'
                  : 'bg-bearish/10 border-bearish/30 text-bearish shadow-bearish/20'
              }`}>
                <span className={`w-2.5 h-2.5 rounded-full ${isConnected ? 'bg-bullish' : 'bg-bearish'} animate-pulse`} />
                <span className="tracking-wide">
                  {isConnected ? 'Live' : 'Offline'}
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

          {/* RSI 60/40 Momentum Section - ENHANCED */}
          <div className="mt-6 sm:mt-6 border border-green-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/10 via-green-950/5 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
            {/* Section Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
              <div>
                <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                  <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                  RSI 60/40 Momentum
                </h3>
                <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                  Live overbought/oversold detection • Momentum confirmation • Precise entry signals
                </p>
              </div>
              
              {/* Market Status Panel - Without Confidence */}
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
                {/* Market Status Indicator */}
                <div className={`px-3 py-2 rounded-lg text-xs font-bold border shadow-sm ${
                  analyses?.NIFTY?.indicators?.rsi_signal === 'MOMENTUM_BUY' || analyses?.NIFTY?.indicators?.rsi_signal === 'PULLBACK_BUY'
                    ? 'bg-green-500/12 text-white border-green-500/30' :
                  analyses?.NIFTY?.indicators?.rsi_signal === 'REJECTION_SHORT' || analyses?.NIFTY?.indicators?.rsi_signal === 'BREAKDOWN_SELL'
                    ? 'bg-rose-500/12 text-white border-rose-500/30' :
                    'bg-yellow-500/12 text-white border-yellow-500/30'
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
              <div key={item.symbol} className="border border-green-500/30 rounded-xl bg-gradient-to-br from-green-900/10 to-green-950/5 p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm hover:border-green-500/40 hover:shadow-green-500/20 shadow-xl shadow-green-500/10">
                {/* Title & Confidence */}
                <div className="flex items-center justify-between gap-3 mb-4">
                  <h4 className="font-bold text-white text-base sm:text-lg tracking-tight">
                    {item.symbol} • RSI 60/40
                  </h4>
                  <div className="flex items-center gap-2">
                    {/* Confidence Percentage */}
                    <span className="text-sm font-bold text-white">
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
                      <span className={`text-sm sm:text-base font-bold px-3 py-2 rounded-xl whitespace-nowrap border ${
                        item.data.indicators.rsi > 60 ? 'bg-green-500/12 text-white border-green-500/30' :
                        item.data.indicators.rsi < 40 ? 'bg-rose-500/12 text-white border-rose-500/30' :
                        'bg-yellow-500/12 text-white border-yellow-500/30'
                      }`}>
                        RSI {Math.round(item.data.indicators.rsi)}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* RSI Zone */}
                    <div className="flex justify-between items-center p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                      <span className="text-white font-semibold text-sm">Zone:</span>
                      <span className={`font-bold text-base ${
                        item.data.indicators.rsi_zone === '60_ABOVE' ? 'text-green-400' :
                        item.data.indicators.rsi_zone === '50_TO_60' ? 'text-yellow-300' :
                        item.data.indicators.rsi_zone === '40_TO_50' ? 'text-yellow-300' :
                        'text-rose-400'
                      }`}>
                        {item.data.indicators.rsi_zone === '60_ABOVE' ? '60+ (Overbought)' :
                         item.data.indicators.rsi_zone === '50_TO_60' ? '50-60 (Bullish)' :
                         item.data.indicators.rsi_zone === '40_TO_50' ? '40-50 (Neutral)' :
                         '< 40 (Oversold)'}
                      </span>
                    </div>

                    {/* Signal */}
                    {item.data.indicators.rsi_signal && (
                      <div className="rounded-xl bg-green-500/5 border border-green-500/30 p-3 shadow-lg">
                        <div className="text-xs font-bold text-white uppercase tracking-wider mb-2">SIGNAL</div>
                        <div className={`text-base sm:text-lg font-bold ${
                          item.data.indicators.rsi_signal === 'MOMENTUM_BUY' ? 'text-green-400' :
                          item.data.indicators.rsi_signal === 'REJECTION_SHORT' ? 'text-rose-400' :
                          item.data.indicators.rsi_signal === 'PULLBACK_BUY' ? 'text-yellow-300' :
                          'text-white'
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
                      <div className="text-sm text-white leading-relaxed italic bg-green-500/5 border-l-4 border-green-500/50 pl-3 py-3 rounded-r-lg">
                        {item.data.indicators.rsi_action}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-white text-sm font-semibold">
                    Loading RSI analysis...
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Camarilla R3/S3 + CPR Section - ENHANCED */}
        <div className="mt-6 sm:mt-6 border border-green-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/10 via-green-950/5 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                Camarilla R3/S3 • CPR Zones
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Live gate level detection • Trending vs Range classification • High-probability trend day signals
              </p>
            </div>
            
            {/* Market Status Panel - Without Confidence */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator */}
              <div className={`px-3 py-2 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.camarilla_zone === 'ABOVE_TC'
                  ? 'bg-green-500/12 text-white border-green-500/30' :
                analyses?.NIFTY?.indicators?.camarilla_zone === 'BELOW_BC'
                  ? 'bg-rose-500/12 text-white border-rose-500/30' :
                  'bg-yellow-500/12 text-white border-yellow-500/30'
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
              <div key={`camarilla_${item.symbol}`} className="border border-green-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-green-900/10 to-green-950/5 hover:border-green-500/40 hover:shadow-green-500/20 shadow-xl shadow-green-500/10">
                {/* Title & Confidence - Responsive Layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                  <h4 className="font-bold text-white text-base sm:text-lg tracking-tight flex-shrink-0">
                    {item.symbol} • R3/S3
                  </h4>
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Confidence Percentage */}
                    <span className="text-sm font-bold text-white whitespace-nowrap">
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
                      <span className={`text-sm font-bold px-3 py-2 rounded-xl whitespace-nowrap flex-shrink-0 border ${
                        item.data.indicators.camarilla_zone === 'ABOVE_TC' ? 'bg-green-500/12 text-white border-green-500/30' :
                        item.data.indicators.camarilla_zone === 'BELOW_BC' ? 'bg-rose-500/12 text-white border-rose-500/30' :
                        'bg-green-500/12 text-white border-green-500/30'
                      }`}>
                        {item.data.indicators.camarilla_zone.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* Zone Status */}
                    {item.data.indicators.camarilla_zone_status && (
                      <div className="text-sm text-white leading-relaxed italic border-l-4 border-orange-500/50 pl-3 py-2 bg-green-500/5 rounded-r-lg">
                        {item.data.indicators.camarilla_zone_status}
                      </div>
                    )}

                    {/* CPR Classification */}
                    <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                      <span className="text-white font-semibold text-sm">CPR Type:</span>
                      <span className={`font-bold break-words text-base ${
                        item.data.indicators.cpr_classification === 'NARROW' ? 'text-green-400' : 'text-yellow-300'
                      }`}>
                        {item.data.indicators.cpr_classification} ({item.data.indicators.cpr_width_pct?.toFixed(3)}%)
                      </span>
                    </div>

                    {/* CPR Description */}
                    {item.data.indicators.cpr_description && (
                      <div className="text-sm text-white italic leading-relaxed bg-green-500/5 p-2 rounded-lg border border-green-500/20">
                        {item.data.indicators.cpr_description}
                      </div>
                    )}

                    {/* Camarilla Signal */}
                    {item.data.indicators.camarilla_signal && (
                      <div className="space-y-2 pt-3 border-t-2 border-green-500/30">
                        <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                          <span className="text-white font-semibold text-sm">Signal:</span>
                          <span className={`font-bold text-base break-words ${
                            item.data.indicators.camarilla_signal?.includes('R3_BREAKOUT') ? 'text-green-400' :
                            item.data.indicators.camarilla_signal?.includes('S3_BREAKDOWN') ? 'text-rose-400' :
                            'text-orange-300'
                          }`}>
                            {item.data.indicators.camarilla_signal.replace(/_/g, ' ')}
                          </span>
                        </div>
                      </div>
                    )}

                    {/* Signal Description */}
                    {item.data.indicators.camarilla_signal_desc && (
                      <div className="text-sm text-white leading-relaxed border-l-4 border-orange-500/50 pl-3 py-2 bg-green-500/5 rounded-r-lg">
                        {item.data.indicators.camarilla_signal_desc}
                      </div>
                    )}

                    {/* Trend Day Signal */}
                    {item.data.indicators.trend_day_signal && (
                      <div className="space-y-2 pt-3 border-t-2 border-green-500/30">
                        <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                          <span className="text-white font-semibold text-sm">Trend Day:</span>
                          <div className="flex flex-col gap-1">
                            <div className={`font-bold text-base break-words ${
                              item.data.indicators.trend_day_signal?.includes('BULLISH') ? 'text-green-400' :
                              item.data.indicators.trend_day_signal?.includes('BEARISH') ? 'text-rose-400' :
                              'text-orange-300'
                            }`}>
                              {item.data.indicators.trend_day_signal.replace(/_/g, ' ')}
                            </div>
                            {item.data.indicators.trend_day_confidence > 0 && (
                              <div className={`text-sm font-semibold ${
                                item.data.indicators.trend_day_confidence >= 80 ? 'text-green-300' : 'text-yellow-300'
                              }`}>
                                {item.data.indicators.trend_day_confidence}% confidence
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* CPR & Gate Levels */}
                    <div className="grid grid-cols-2 gap-3 pt-3 border-t-2 border-green-500/30">
                      <div className="text-center p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                        <div className="text-sm text-white font-semibold mb-1">TC (R3)</div>
                        <div className="font-bold text-base text-green-400">₹{item.data.indicators.cpr_top_central}</div>
                      </div>
                      <div className="text-center p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                        <div className="text-sm text-white font-semibold mb-1">BC (S3)</div>
                        <div className="font-bold text-base text-rose-400">₹{item.data.indicators.cpr_bottom_central}</div>
                      </div>
                      <div className="text-center col-span-2 p-3 bg-green-500/5 rounded-lg border border-green-500/30">
                        <div className="text-sm text-white font-semibold mb-1">Pivot (P)</div>
                        <div className="font-bold text-base text-orange-300">₹{item.data.indicators.cpr_pivot}</div>
                      </div>
                    </div>

                    {/* CPR Width */}
                    <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/30">
                      <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                        <span className="text-white font-semibold text-sm">CPR Width:</span>
                        <span className="font-bold text-orange-300 break-words text-base">₹{item.data.indicators.cpr_width} ({item.data.indicators.cpr_width_pct?.toFixed(3)}%)</span>
                      </div>
                    </div>

                    {/* Price vs CPR */}
                    <div className={`text-base text-center py-3 rounded-xl font-bold border ${
                      item.data.indicators.camarilla_zone === 'ABOVE_TC' ? 'bg-green-500/12 text-white border-green-500/30' :
                      item.data.indicators.camarilla_zone === 'BELOW_BC' ? 'bg-rose-500/12 text-white border-rose-500/30' :
                      'bg-orange-500/12 text-white border-orange-500/30'
                    }`}>
                      Price: ₹{item.data.indicators.price}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-white text-sm font-semibold">
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
                Live trailing stops • Clear trend signals • Simple entry/exit guidance for all traders
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
                  <div className="space-y-3">
                    {/* Live Price Display with Change */}
                    <div className="bg-gradient-to-br from-dark-surface/80 to-dark-card/50 border-2 border-emerald-500/40 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-dark-secondary font-bold uppercase tracking-wider">Live Price</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                          (item.data.indicators.change || 0) > 0 
                            ? 'bg-[#00C087]/20 text-[#00C087]' 
                            : (item.data.indicators.change || 0) < 0 
                            ? 'bg-[#EB5B3C]/20 text-[#EB5B3C]'
                            : 'bg-gray-500/20 text-gray-300'
                        }`}>
                          {(item.data.indicators.change || 0) > 0 ? '▲' : (item.data.indicators.change || 0) < 0 ? '▼' : '●'} {Math.abs(item.data.indicators.change || 0).toFixed(2)} ({(item.data.indicators.changePercent || 0).toFixed(2)}%)
                        </span>
                      </div>
                      <div className={`text-2xl font-black tracking-tight ${
                        item.data.indicators.sar_position === 'BELOW' ? 'text-[#00C087]' : 'text-[#EB5B3C]'
                      }`}>
                        ₹{item.data.indicators.price?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </div>
                    </div>

                    {/* SAR Level Display */}
                    <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 border border-emerald-500/30 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-secondary font-semibold">SAR Trailing Stop</span>
                        <span className={`text-base font-black ${
                          item.data.indicators.sar_position === 'BELOW' ? 'text-emerald-300' : 'text-orange-300'
                        }`}>
                          ₹{item.data.indicators.sar_value?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                      </div>
                    </div>

                    {/* SAR Signal Card - Visual */}
                    {(() => {
                      const position = item.data.indicators.sar_position;
                      const strength = item.data.indicators.sar_signal_strength || 65;
                      const distance = item.data.indicators.distance_to_sar;
                      const distancePct = item.data.indicators.distance_to_sar_pct;
                      
                      if (position === 'BELOW') {
                        return (
                          <div className="bg-gradient-to-r from-green-900/30 to-green-950/20 border-2 border-[#00C087]/50 rounded-xl p-4 shadow-lg shadow-green-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">🚀</span>
                              <div>
                                <div className="text-sm font-black text-[#00C087]">BULLISH TREND</div>
                                <div className="text-xs text-[#00C087]/80 font-medium">Price above SAR - Uptrend active</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-green-300">₹{distance?.toFixed(2)}</div>
                              </div>
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-green-300">{strength}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-green-200 bg-green-900/30 rounded-lg p-2">
                              ✅ <strong>Action:</strong> Strong bullish signal. Price is above SAR trailing stop at ₹{item.data.indicators.sar_value?.toFixed(0)}. Hold longs with stop below SAR. Trail stops as SAR moves up.
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="bg-gradient-to-r from-green-900/15 to-green-950/10 border-2 border-green-500/40 rounded-xl p-4 shadow-lg shadow-green-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">📉</span>
                              <div>
                                <div className="text-sm font-black text-[#EB5B3C]">BEARISH TREND</div>
                                <div className="text-xs text-[#EB5B3C]/80 font-medium">Price below SAR - Downtrend active</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-green-900/20 rounded-lg p-2 text-center border border-green-500/30">
                                <div className="text-xs text-green-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-[#EB5B3C]">₹{distance?.toFixed(2)}</div>
                              </div>
                              <div className="bg-green-900/20 rounded-lg p-2 text-center border border-green-500/30">
                                <div className="text-xs text-green-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-[#EB5B3C]">{strength}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-slate-200 bg-green-900/20 rounded-lg p-2 border border-green-500/30">
                              ⛔ <strong className="text-[#EB5B3C]">Action:</strong> Bearish signal. Price is below SAR trailing stop at ₹{item.data.indicators.sar_value?.toFixed(0)}. Avoid longs. Consider shorts with stop above SAR.
                            </div>
                          </div>
                        );
                      }
                    })()}

                    {/* SAR Flip Alert */}
                    {item.data.indicators.sar_flip && item.data.indicators.sar_flip_type && (
                      <div className={`rounded-lg p-3 border-2 ${
                        item.data.indicators.sar_flip_type?.includes('BUY') 
                          ? 'bg-green-900/20 border-green-500/50' 
                          : 'bg-orange-900/20 border-orange-500/50'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-lg">🔄</span>
                          <span className={`text-xs font-black ${
                            item.data.indicators.sar_flip_type?.includes('BUY') ? 'text-green-300' : 'text-orange-300'
                          }`}>
                            TREND FLIP SIGNAL
                          </span>
                        </div>
                        <div className={`text-xs ${
                          item.data.indicators.sar_flip_type?.includes('BUY') ? 'text-green-200' : 'text-orange-200'
                        }`}>
                          {item.data.indicators.sar_flip_type.replace(/_/g, ' ')}
                        </div>
                      </div>
                    )}

                    {/* Distance Meter */}
                    <div className="bg-dark-surface/50 border border-dark-border/40 rounded-lg p-3">
                      <div className="text-xs text-dark-secondary font-semibold uppercase tracking-wider mb-2">Distance from SAR</div>
                      <div className="relative h-6 bg-gray-800 rounded-full overflow-hidden">
                        <div 
                          className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                            item.data.indicators.sar_position === 'BELOW' 
                              ? 'bg-gradient-to-r from-green-500 to-emerald-400' 
                              : 'bg-gradient-to-r from-red-500 to-rose-400'
                          }`}
                          style={{ width: `${Math.min(Math.abs(item.data.indicators.distance_to_sar_pct || 0) * 20, 100)}%` }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-white drop-shadow-lg">
                            {(item.data.indicators.distance_to_sar_pct || 0).toFixed(2)}% away
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Quick Summary */}
                    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">📋 Trading Status</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Trend:</span>
                          <span className={`font-bold ${
                            item.data.indicators.sar_position === 'BELOW' ? 'text-[#00C087]' : 'text-[#EB5B3C]'
                          }`}>
                            {item.data.indicators.sar_trend || (item.data.indicators.sar_position === 'BELOW' ? 'BULLISH' : 'BEARISH')}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Signal:</span>
                          <span className={`font-bold ${
                            item.data.indicators.sar_position === 'BELOW' ? 'text-[#00C087]' : 'text-[#EB5B3C]'
                          }`}>
                            {item.data.indicators.sar_position === 'BELOW' ? 'BUY' : 'SELL'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-xs text-dark-secondary italic">Loading SAR data...</div>
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
                Live trend detection • Clear buy/sell signals • Real-time price tracking • Easy-to-follow guidance for all traders
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator - Based on NIFTY position vs ST */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                (() => {
                  const niftyData = analyses?.NIFTY?.indicators;
                  if (!niftyData) return 'bg-gray-900/20 text-gray-300 border-gray-500/40';
                  
                  const price = niftyData.price;
                  const stLevel = niftyData.supertrend_10_2_value;
                  const distance = Math.abs(price - stLevel);
                  const isAbove = price > stLevel;
                  const isVeryClose = distance < (stLevel * 0.0005);
                  
                  if (isVeryClose) {
                    return 'bg-yellow-900/20 text-yellow-300 border-yellow-500/40';
                  } else if (isAbove) {
                    return 'bg-green-900/20 text-green-400 border-green-500/40';
                  } else {
                    return 'bg-red-900/20 text-red-400 border-red-500/40';
                  }
                })()
              }`}>
                {(() => {
                  const niftyData = analyses?.NIFTY?.indicators;
                  if (!niftyData) return '○ LOADING';
                  
                  const price = niftyData.price;
                  const stLevel = niftyData.supertrend_10_2_value;
                  const distance = Math.abs(price - stLevel);
                  const isAbove = price > stLevel;
                  const isVeryClose = distance < (stLevel * 0.0005);
                  
                  if (isVeryClose) {
                    return '🟡 AT SUPERTREND';
                  } else if (isAbove) {
                    return '🟢 ABOVE SUPERTREND';
                  } else {
                    return '🔴 BELOW SUPERTREND';
                  }
                })()}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {analyses && Object.keys(analyses)
              .filter(symbol => analyses[symbol] && analyses[symbol].indicators && analyses[symbol].indicators.supertrend_10_2_value) // Only indices with SuperTrend data
              .sort((a, b) => {
                // Priority order: NIFTY first, BANKNIFTY second, SENSEX third, then alphabetically
                const priority: { [key: string]: number } = { 'NIFTY': 1, 'BANKNIFTY': 2, 'SENSEX': 3 };
                return (priority[a] || 999) - (priority[b] || 999) || a.localeCompare(b);
              })
              .map((symbol) => {
                const item = { symbol, data: analyses[symbol] };
                return (
              <div key={`st_${item.symbol}`} className={`border-2 border-emerald-500/30 rounded-xl p-3 transition-all duration-300 backdrop-blur-sm ${
                (() => {
                  if (!item.data?.indicators) {
                    return 'bg-dark-card/30';
                  }
                  
                  const price = item.data.indicators.price;
                  const stLevel = item.data.indicators.supertrend_10_2_value;
                  const distance = Math.abs(price - stLevel);
                  const isAbove = price > stLevel;
                  const isVeryClose = distance < (stLevel * 0.0005);
                  
                  if (isVeryClose) {
                    return 'bg-yellow-900/10 shadow-lg shadow-yellow-500/10';
                  } else if (isAbove) {
                    return 'bg-green-900/10 shadow-lg shadow-green-500/10';
                  } else {
                    return 'bg-red-900/10 shadow-lg shadow-red-500/10';
                  }
                })()
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
                    {/* Signal Badge - Color based on price vs ST level */}
                    {item.data?.indicators && (
                      <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
                        (() => {
                          const price = item.data.indicators.price;
                          const stLevel = item.data.indicators.supertrend_10_2_value;
                          const distance = Math.abs(price - stLevel);
                          const isAbove = price > stLevel;
                          const isVeryClose = distance < (stLevel * 0.0005);
                          
                          if (isVeryClose) {
                            return 'bg-yellow-900/20 text-yellow-300';
                          } else if (isAbove) {
                            return 'bg-green-900/20 text-green-400';
                          } else {
                            return 'bg-red-900/20 text-red-400';
                          }
                        })()
                      }`}>
                        {(() => {
                          const price = item.data.indicators.price;
                          const stLevel = item.data.indicators.supertrend_10_2_value;
                          const distance = Math.abs(price - stLevel);
                          const isAbove = price > stLevel;
                          const isVeryClose = distance < (stLevel * 0.0005);
                          
                          if (isVeryClose) {
                            return '🟡 AT LEVEL';
                          } else if (isAbove) {
                            return '🟢 ABOVE';
                          } else {
                            return '🔴 BELOW';
                          }
                        })()}
                      </span>
                    )}
                  </div>
                </div>

                {item.data?.indicators ? (
                  <div className="space-y-3">
                    {/* Live Price Display with Change Indicator */}
                    <div className="bg-gradient-to-br from-dark-surface/80 to-dark-card/50 border-2 border-emerald-500/40 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-dark-secondary font-bold uppercase tracking-wider">Live Price</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                          (item.data.indicators.change || 0) > 0 
                            ? 'bg-[#00C087]/20 text-[#00C087]' 
                            : (item.data.indicators.change || 0) < 0 
                            ? 'bg-[#EB5B3C]/20 text-[#EB5B3C]'
                            : 'bg-gray-500/20 text-gray-300'
                        }`}>
                          {(item.data.indicators.change || 0) > 0 ? '▲' : (item.data.indicators.change || 0) < 0 ? '▼' : '●'} {Math.abs(item.data.indicators.change || 0).toFixed(2)} ({(item.data.indicators.changePercent || 0).toFixed(2)}%)
                        </span>
                      </div>
                      <div className={`text-2xl font-black tracking-tight ${
                        (() => {
                          const price = item.data.indicators.price;
                          const stLevel = item.data.indicators.supertrend_10_2_value;
                          const isAbove = price > stLevel;
                          const isVeryClose = Math.abs(price - stLevel) < (stLevel * 0.0005);
                          return isVeryClose ? 'text-yellow-300' : isAbove ? 'text-[#00C087]' : 'text-[#EB5B3C]';
                        })()
                      }`}>
                        ₹{item.data.indicators.price?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </div>
                    </div>

                    {/* SuperTrend Level Display */}
                    <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 border border-emerald-500/30 rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-dark-secondary font-semibold">SuperTrend Level</span>
                        <span className="text-lg font-black text-emerald-300">
                          ₹{item.data.indicators.supertrend_10_2_value?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                      </div>
                    </div>

                    {/* Trend Signal - Simple and Clear */}
                    {(() => {
                      const price = item.data.indicators.price;
                      const stLevel = item.data.indicators.supertrend_10_2_value;
                      const distance = Math.abs(price - stLevel);
                      const distancePct = Math.abs(item.data.indicators.supertrend_10_2_distance_pct || 0);
                      const isAbove = price > stLevel;
                      const isVeryClose = distance < (stLevel * 0.0005);
                      
                      if (isVeryClose) {
                        return (
                          <div className="bg-gradient-to-r from-yellow-900/30 to-yellow-950/20 border-2 border-yellow-500/50 rounded-xl p-4 shadow-lg shadow-yellow-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">⚠️</span>
                              <div>
                                <div className="text-sm font-black text-yellow-300">CAUTION ZONE</div>
                                <div className="text-xs text-yellow-300/80 font-medium">Price at SuperTrend level</div>
                              </div>
                            </div>
                            <div className="text-xs text-yellow-200 bg-yellow-900/30 rounded-lg p-2 mt-2">
                              ⏳ <strong>Wait & Watch:</strong> Price is testing the SuperTrend line. Wait for a clear breakout above or breakdown below before taking action.
                            </div>
                          </div>
                        );
                      } else if (isAbove) {
                        return (
                          <div className="bg-gradient-to-r from-green-900/30 to-green-950/20 border-2 border-[#00C087]/50 rounded-xl p-4 shadow-lg shadow-green-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">🚀</span>
                              <div>
                                <div className="text-sm font-black text-[#00C087]">BULLISH TREND</div>
                                <div className="text-xs text-[#00C087]/80 font-medium">Price above SuperTrend</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-green-300">₹{Math.abs(item.data.indicators.supertrend_10_2_distance || 0).toFixed(2)}</div>
                              </div>
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-green-300">{distancePct.toFixed(2)}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-green-200 bg-green-900/30 rounded-lg p-2">
                              ✅ <strong>Action:</strong> {distancePct > 0.5 ? 'Strong uptrend confirmed. Hold longs or look for pullback entries near SuperTrend level.' : 'Early uptrend signal. Wait for confirmation with more distance from SuperTrend.'}
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="bg-gradient-to-r from-green-900/15 to-green-950/10 border-2 border-green-500/40 rounded-xl p-4 shadow-lg shadow-green-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">📉</span>
                              <div>
                                <div className="text-sm font-black text-[#EB5B3C]">BEARISH TREND</div>
                                <div className="text-xs text-[#EB5B3C]/80 font-medium">Price below SuperTrend</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-green-900/20 rounded-lg p-2 text-center border border-green-500/30">
                                <div className="text-xs text-green-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-[#EB5B3C]">₹{Math.abs(item.data.indicators.supertrend_10_2_distance || 0).toFixed(2)}</div>
                              </div>
                              <div className="bg-green-900/20 rounded-lg p-2 text-center border border-green-500/30">
                                <div className="text-xs text-green-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-[#EB5B3C]">{distancePct.toFixed(2)}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-slate-200 bg-green-900/20 rounded-lg p-2 border border-green-500/30">
                              ⛔ <strong className="text-[#EB5B3C]">Action:</strong> {distancePct > 0.5 ? 'Strong downtrend confirmed. Avoid longs or look for short opportunities.' : 'Early downtrend signal. Wait for confirmation with more distance from SuperTrend.'}
                            </div>
                          </div>
                        );
                      }
                    })()}

                    {/* Visual Distance Indicator */}
                    {(() => {
                      const price = item.data.indicators.price;
                      const stLevel = item.data.indicators.supertrend_10_2_value;
                      const isAbove = price > stLevel;
                      const distancePct = Math.abs(item.data.indicators.supertrend_10_2_distance_pct || 0);
                      const barWidth = Math.min(distancePct * 20, 100); // Scale for visual representation
                      
                      return (
                        <div className="bg-dark-surface/50 border border-dark-border/40 rounded-lg p-3">
                          <div className="text-xs text-dark-secondary font-semibold uppercase tracking-wider mb-2">Price Distance Meter</div>
                          <div className="relative h-6 bg-gray-800 rounded-full overflow-hidden">
                            <div 
                              className={`absolute left-0 top-0 h-full transition-all duration-500 ${
                                isAbove ? 'bg-gradient-to-r from-green-500 to-emerald-400' : 'bg-gradient-to-r from-red-500 to-rose-400'
                              }`}
                              style={{ width: `${barWidth}%` }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center">
                              <span className="text-xs font-bold text-white drop-shadow-lg">
                                {isAbove ? '↑' : '↓'} {distancePct.toFixed(2)}% away
                              </span>
                            </div>
                          </div>
                          <div className="flex justify-between mt-1 text-xs text-dark-secondary">
                            <span>Close</span>
                            <span>Far</span>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Quick Summary */}
                    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">📋 Quick Summary</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Status:</span>
                          <span className={`font-bold ${
                            (() => {
                              const price = item.data.indicators.price;
                              const stLevel = item.data.indicators.supertrend_10_2_value;
                              const isAbove = price > stLevel;
                              const isVeryClose = Math.abs(price - stLevel) < (stLevel * 0.0005);
                              return isVeryClose ? 'text-yellow-300' : isAbove ? 'text-[#00C087]' : 'text-[#EB5B3C]';
                            })()
                          }`}>
                            {(() => {
                              const price = item.data.indicators.price;
                              const stLevel = item.data.indicators.supertrend_10_2_value;
                              const isAbove = price > stLevel;
                              const isVeryClose = Math.abs(price - stLevel) < (stLevel * 0.0005);
                              return isVeryClose ? 'NEUTRAL' : isAbove ? 'BULLISH' : 'BEARISH';
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Signal:</span>
                          <span className={`font-bold ${
                            (() => {
                              const price = item.data.indicators.price;
                              const stLevel = item.data.indicators.supertrend_10_2_value;
                              const isAbove = price > stLevel;
                              const isVeryClose = Math.abs(price - stLevel) < (stLevel * 0.0005);
                              return isVeryClose ? 'text-yellow-300' : isAbove ? 'text-[#00C087]' : 'text-[#EB5B3C]';
                            })()
                          }`}>
                            {(() => {
                              const price = item.data.indicators.price;
                              const stLevel = item.data.indicators.supertrend_10_2_value;
                              const isAbove = price > stLevel;
                              const isVeryClose = Math.abs(price - stLevel) < (stLevel * 0.0005);
                              return isVeryClose ? 'WAIT' : isAbove ? 'BUY' : 'SELL';
                            })()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="text-xs text-dark-secondary italic">Loading SuperTrend data...</div>
                  </div>
                )}
              </div>
            );
              })}
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
                Live first 5-min range tracking • Clear breakout signals • Simple entry guidance for all traders
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
                  <div className="space-y-3">
                    {/* Live Price Display with Change */}
                    <div className="bg-gradient-to-br from-dark-surface/80 to-dark-card/50 border-2 border-emerald-500/40 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-dark-secondary font-bold uppercase tracking-wider">Live Price</span>
                        <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                          (item.data.indicators.change || 0) > 0 
                            ? 'bg-[#00C087]/20 text-[#00C087]' 
                            : (item.data.indicators.change || 0) < 0 
                            ? 'bg-[#EB5B3C]/20 text-[#EB5B3C]'
                            : 'bg-gray-500/20 text-gray-300'
                        }`}>
                          {(item.data.indicators.change || 0) > 0 ? '▲' : (item.data.indicators.change || 0) < 0 ? '▼' : '●'} {Math.abs(item.data.indicators.change || 0).toFixed(2)} ({(item.data.indicators.changePercent || 0).toFixed(2)}%)
                        </span>
                      </div>
                      <div className={`text-2xl font-black tracking-tight ${
                        (() => {
                          const pos = item.data.indicators.orb_position;
                          return pos === 'ABOVE_HIGH' ? 'text-[#00C087]' : pos === 'BELOW_LOW' ? 'text-[#EB5B3C]' : 'text-yellow-300';
                        })()
                      }`}>
                        ₹{item.data.indicators.price?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                      </div>
                    </div>

                    {/* ORB Range Display */}
                    <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 border border-emerald-500/30 rounded-lg p-3 space-y-2">
                      <div className="text-xs text-dark-secondary font-semibold uppercase tracking-wider mb-2">Opening Range (First 5 Min)</div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-green-900/20 rounded-lg p-2 border border-green-500/30">
                          <div className="text-xs text-green-300/70 font-semibold">HIGH</div>
                          <div className="text-sm font-black text-green-300">₹{item.data.indicators.orb_high?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                        </div>
                        <div className="bg-red-900/20 rounded-lg p-2 border border-red-500/30">
                          <div className="text-xs text-red-300/70 font-semibold">LOW</div>
                          <div className="text-sm font-black text-red-300">₹{item.data.indicators.orb_low?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                        </div>
                      </div>
                      <div className="flex justify-between items-center text-xs pt-2 border-t border-emerald-500/20">
                        <span className="text-dark-secondary font-medium">Range Size:</span>
                        <span className="font-bold text-emerald-300">₹{item.data.indicators.orb_range?.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Visual Range Position Bar */}
                    <div className="bg-dark-surface/50 border border-dark-border/40 rounded-lg p-3">
                      <div className="text-xs text-dark-secondary font-semibold uppercase tracking-wider mb-2">Price Position</div>
                      <div className="relative h-12 bg-gradient-to-r from-red-900/30 via-yellow-900/30 to-green-900/30 rounded-lg border border-emerald-500/30 overflow-hidden">
                        {/* Range markers */}
                        <div className="absolute left-0 top-0 h-full w-1 bg-red-500"></div>
                        <div className="absolute right-0 top-0 h-full w-1 bg-green-500"></div>
                        <div className="absolute left-1/2 top-0 h-full w-0.5 bg-yellow-500 opacity-50"></div>
                        
                        {/* Current price indicator */}
                        {(() => {
                          const orbHigh = item.data.indicators.orb_high || 0;
                          const orbLow = item.data.indicators.orb_low || 0;
                          const price = item.data.indicators.price || 0;
                          const range = orbHigh - orbLow;
                          
                          let position = 50; // Default to middle
                          if (range > 0) {
                            if (price > orbHigh) {
                              // Above range - position above 100%
                              const aboveDist = price - orbHigh;
                              position = 100 + Math.min((aboveDist / range) * 20, 20);
                            } else if (price < orbLow) {
                              // Below range - position below 0%
                              const belowDist = orbLow - price;
                              position = Math.max(0 - ((belowDist / range) * 20), -20);
                            } else {
                              // Inside range
                              position = ((price - orbLow) / range) * 100;
                            }
                          }
                          
                          const clampedPos = Math.max(5, Math.min(95, position));
                          
                          return (
                            <div 
                              className="absolute top-1/2 -translate-y-1/2 transition-all duration-300"
                              style={{ left: `${clampedPos}%` }}
                            >
                              <div className="relative -translate-x-1/2">
                                <div className={`w-3 h-8 rounded-full ${
                                  price > orbHigh ? 'bg-green-500' : price < orbLow ? 'bg-red-500' : 'bg-yellow-400'
                                } shadow-lg`}></div>
                                <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-xs font-bold text-white whitespace-nowrap drop-shadow-lg">
                                  NOW
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="flex justify-between mt-1 text-xs text-dark-secondary">
                        <span>ORB Low</span>
                        <span>ORB High</span>
                      </div>
                    </div>

                    {/* Breakout Signal Card */}
                    {(() => {
                      const price = item.data.indicators.price || 0;
                      const orbHigh = item.data.indicators.orb_high || 0;
                      const orbLow = item.data.indicators.orb_low || 0;
                      const position = item.data.indicators.orb_position;
                      const distToHigh = Math.abs(price - orbHigh);
                      const distToLow = Math.abs(price - orbLow);
                      
                      if (position === 'ABOVE_HIGH') {
                        return (
                          <div className="bg-gradient-to-r from-green-900/30 to-green-950/20 border-2 border-[#00C087]/50 rounded-xl p-4 shadow-lg shadow-green-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">🚀</span>
                              <div>
                                <div className="text-sm font-black text-[#00C087]">BREAKOUT ABOVE</div>
                                <div className="text-xs text-[#00C087]/80 font-medium">Price broke above opening range</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-green-300">₹{distToHigh.toFixed(2)}</div>
                              </div>
                              <div className="bg-green-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-green-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-green-300">{item.data.indicators.orb_strength || 75}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-green-200 bg-green-900/30 rounded-lg p-2">
                              ✅ <strong>Action:</strong> Strong bullish signal. Price broke above the opening range high. Consider long positions with stop loss below ORB High (₹{orbHigh.toFixed(2)}).
                            </div>
                          </div>
                        );
                      } else if (position === 'BELOW_LOW') {
                        return (
                          <div className="bg-gradient-to-r from-red-900/30 to-red-950/20 border-2 border-[#EB5B3C]/50 rounded-xl p-4 shadow-lg shadow-red-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">📉</span>
                              <div>
                                <div className="text-sm font-black text-[#EB5B3C]">BREAKDOWN BELOW</div>
                                <div className="text-xs text-[#EB5B3C]/80 font-medium">Price broke below opening range</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-red-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-red-300/70 font-semibold">DISTANCE</div>
                                <div className="text-sm font-black text-red-300">₹{distToLow.toFixed(2)}</div>
                              </div>
                              <div className="bg-red-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-red-300/70 font-semibold">STRENGTH</div>
                                <div className="text-sm font-black text-red-300">{item.data.indicators.orb_strength || 75}%</div>
                              </div>
                            </div>
                            <div className="text-xs text-red-200 bg-red-900/30 rounded-lg p-2">
                              ⛔ <strong>Action:</strong> Strong bearish signal. Price broke below the opening range low. Avoid long positions or consider shorts with stop loss above ORB Low (₹{orbLow.toFixed(2)}).
                            </div>
                          </div>
                        );
                      } else {
                        return (
                          <div className="bg-gradient-to-r from-yellow-900/30 to-yellow-950/20 border-2 border-yellow-500/50 rounded-xl p-4 shadow-lg shadow-yellow-500/20">
                            <div className="flex items-center gap-3 mb-2">
                              <span className="text-2xl">⏳</span>
                              <div>
                                <div className="text-sm font-black text-yellow-300">INSIDE RANGE</div>
                                <div className="text-xs text-yellow-300/80 font-medium">Price within opening range</div>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              <div className="bg-yellow-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-yellow-300/70 font-semibold">TO HIGH</div>
                                <div className="text-sm font-black text-yellow-300">₹{distToHigh.toFixed(2)}</div>
                              </div>
                              <div className="bg-yellow-900/30 rounded-lg p-2 text-center">
                                <div className="text-xs text-yellow-300/70 font-semibold">TO LOW</div>
                                <div className="text-sm font-black text-yellow-300">₹{distToLow.toFixed(2)}</div>
                              </div>
                            </div>
                            <div className="text-xs text-yellow-200 bg-yellow-900/30 rounded-lg p-2">
                              ⏳ <strong>Wait & Watch:</strong> Price is still within the opening range. Wait for a clear breakout above ₹{orbHigh.toFixed(2)} (bullish) or breakdown below ₹{orbLow.toFixed(2)} (bearish).
                            </div>
                          </div>
                        );
                      }
                    })()}

                    {/* Risk/Reward Display */}
                    {item.data.indicators.orb_reward_risk_ratio && (
                      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-slate-400 font-semibold">Risk/Reward Ratio:</span>
                          <span className={`text-base font-black ${
                            item.data.indicators.orb_reward_risk_ratio >= 2 ? 'text-[#00C087]' :
                            item.data.indicators.orb_reward_risk_ratio >= 1.5 ? 'text-emerald-400' :
                            'text-yellow-400'
                          }`}>
                            1 : {item.data.indicators.orb_reward_risk_ratio}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mt-1">
                          {item.data.indicators.orb_reward_risk_ratio >= 2 ? '✅ Excellent risk/reward' :
                           item.data.indicators.orb_reward_risk_ratio >= 1.5 ? '✅ Good risk/reward' :
                           '⚠️ Moderate risk/reward'}
                        </div>
                      </div>
                    )}

                    {/* Quick Summary */}
                    <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">📋 Trading Status</div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Position:</span>
                          <span className={`font-bold ${
                            item.data.indicators.orb_position === 'ABOVE_HIGH' ? 'text-[#00C087]' :
                            item.data.indicators.orb_position === 'BELOW_LOW' ? 'text-[#EB5B3C]' :
                            'text-yellow-300'
                          }`}>
                            {item.data.indicators.orb_position === 'ABOVE_HIGH' ? 'ABOVE' :
                             item.data.indicators.orb_position === 'BELOW_LOW' ? 'BELOW' :
                             'INSIDE'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Signal:</span>
                          <span className={`font-bold ${
                            item.data.indicators.orb_position === 'ABOVE_HIGH' ? 'text-[#00C087]' :
                            item.data.indicators.orb_position === 'BELOW_LOW' ? 'text-[#EB5B3C]' :
                            'text-yellow-300'
                          }`}>
                            {item.data.indicators.orb_position === 'ABOVE_HIGH' ? 'BUY' :
                             item.data.indicators.orb_position === 'BELOW_LOW' ? 'SELL' :
                             'WAIT'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-dark-secondary italic py-2">Waiting for data...</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6 sm:mt-6 border-2 border-green-500/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/15 via-green-950/10 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                Pivot Points
              </h3>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                Live support/resistance levels • Clear buy/sell zones • Simple entry/exit guidance for all traders
              </p>
            </div>
            
            {/* Market Status Panel */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-center">
              {/* Market Status Indicator - Placeholder for consistency */}
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm bg-green-500/20 text-green-300 border-green-500/40`}>
                📊 Classic & Camarilla
              </div>
            </div>
          </div>

          {/* Unified Pivot Section - All Symbols */}
          <PivotSectionUnified updates={updateCounter} />
        </div>

        {/* Candle Intent Section - ENHANCED */}
        <div className="mt-6 sm:mt-6 border border-green-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/10 via-green-950/5 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                Candle Intent (Candle Structure)
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live candle pattern analysis • Wick dominance signals • Volume-price efficiency • Professional insights
            </p>
          </div>

          {/* Candle Intent Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <CandleIntentCard symbol="NIFTY" name="NIFTY 50" />
            <CandleIntentCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <CandleIntentCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Zone Control Section - ENHANCED */}
        <div className="mt-6 sm:mt-6 border border-green-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/10 via-green-950/5 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                Zone Control & Breakdown Risk
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live support/resistance zones • Breakdown & bounce probability • Critical trading levels
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

        {/* Trend Base Section - ENHANCED */}
        <div className="mt-6 sm:mt-6 border-2 border-green-500/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-green-900/15 via-green-950/10 to-green-900/5 backdrop-blur-sm shadow-xl shadow-green-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full shadow-lg shadow-green-500/30" />
                Trend Base (Higher-Low Structure)
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live swing structure analysis • Higher-high/higher-low detection • Clear trend signals
            </p>
            
            {/* Market Status Indicator */}
            <div className="flex items-center gap-2">
              <div className={`px-3 py-1.5 rounded-lg text-xs font-bold border shadow-sm ${
                analyses?.NIFTY?.indicators?.trend_structure === 'HIGHER_HIGHS_LOWS' 
                  ? 'bg-green-500/20 text-green-300 border-green-500/40' :
                analyses?.NIFTY?.indicators?.trend_structure === 'LOWER_HIGHS_LOWS'
                  ? 'bg-[#EB5B3C]/20 text-[#EB5B3C] border-[#EB5B3C]/40' :
                  'bg-yellow-500/20 text-yellow-300 border-yellow-500/40'
              }`}>
                {analyses?.NIFTY?.indicators?.trend_structure === 'HIGHER_HIGHS_LOWS' ? '🟢 UPTREND' :
                 analyses?.NIFTY?.indicators?.trend_structure === 'LOWER_HIGHS_LOWS' ? '🔴 DOWNTREND' :
                 analyses?.NIFTY?.indicators?.trend_structure === 'SIDEWAYS' ? '🟡 SIDEWAYS' :
                 '⚪ ANALYZING'}
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

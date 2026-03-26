'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useAIAnalysis } from '@/hooks/useAIAnalysis';
import { useOverallMarketOutlook } from '@/hooks/useOverallMarketOutlook';
import { useAuth } from '@/hooks/useAuth';
import { useLiquiditySocket, type LiquidityIndex } from '@/hooks/useLiquiditySocket';
import { useCompassSocket, type CompassIndex } from '@/hooks/useCompassSocket';
import { useICTSocket, type ICTIndex } from '@/hooks/useICTSocket';
import { useIndiaVIX } from '@/hooks/useIndiaVIX';

// Dynamic import for Header to prevent SSR hydration errors with time/date
const Header = dynamic(() => import('@/components/Header'), { ssr: false });
const IndiaVIXBadge = dynamic(() => import('@/components/IndiaVIXBadge'), { ssr: false });

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

const VolumePulseCard = dynamic(() => import('@/components/VolumePulseCard'), { ssr: false });
const TrendBaseCard = dynamic(() => import('@/components/TrendBaseCard'), { ssr: false });
const SectionTitle = dynamic(() => import('@/components/SectionTitle'), { ssr: false });
const TradeSupportResistance = dynamic(() => import('@/components/TradeSupportResistance'), { ssr: false });
const InstitutionalMarketView = dynamic(() => import('@/components/InstitutionalMarketView'), { ssr: false });
const InstitutionalCompass = dynamic(() => import('@/components/InstitutionalCompass'), {
  ssr: false,
  loading: () => (
    <div className="rounded-3xl border border-slate-700/50 bg-slate-800/50 p-5 animate-pulse">
      <div className="h-5 w-64 bg-slate-700 rounded mb-4" />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="rounded-2xl bg-slate-700/30 h-64" />
        ))}
      </div>
    </div>
  )
});

const LiquidityIntelligence = dynamic(() => import('@/components/LiquidityIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-slate-700/40 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-4 w-56 bg-slate-700 rounded mb-3" />
      <div className="flex flex-col lg:flex-row gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 rounded-xl bg-slate-700/25 h-80" />
        ))}
      </div>
    </div>
  )
});

const CRTBTSTCard = dynamic(() => import('@/components/CRTBTSTCard'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-orange-500/30 bg-slate-800/40 p-4 animate-pulse">
      <div className="h-5 w-32 bg-slate-700 rounded mb-3" />
      <div className="h-20 bg-slate-700/30 rounded-xl mb-2" />
      <div className="grid grid-cols-2 gap-1.5">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-14 bg-slate-700/25 rounded-lg" />
        ))}
      </div>
    </div>
  )
});

const ICTIntelligence = dynamic(() => import('@/components/ICTIntelligence'), {
  ssr: false,
  loading: () => (
    <div className="rounded-2xl border border-amber-500/30 bg-slate-800/30 p-5 animate-pulse">
      <div className="h-4 w-56 bg-slate-700 rounded mb-3" />
      <div className="flex flex-col lg:flex-row gap-4">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex-1 rounded-xl bg-slate-700/25 h-80" />
        ))}
      </div>
    </div>
  )
});

export default function Home() {
  // 🔥 Force fresh mount on page load - fixes desktop browser caching
  const [mountKey, setMountKey] = useState(0);
  const [currentYear, setCurrentYear] = useState(() => 
    typeof window !== 'undefined' ? new Date().getFullYear() : 2026
  );
  const [marketConfidence, setMarketConfidence] = useState(50); // Default value for SSR
  const [bankniftyConfidence, setBankniftyConfidence] = useState(50);
  const [sensexConfidence, setSensexConfidence] = useState(50);
  const [isClient, setIsClient] = useState(false);
  
  // Mark when we're on the client
  useEffect(() => {
    setIsClient(true);
  }, []);
  
  // Use standard WebSocket hook
  const {
    marketData,
    connectionStatus,
    isConnected,
    reconnect
  } = useMarketSocket();
  const { alertData, loading: aiLoading, error: aiError } = useAIAnalysis();
  const { outlookData, loading: outlookLoading } = useOverallMarketOutlook();
  const { vixData, loading: vixLoading } = useIndiaVIX();
  const { isAuthenticated } = useAuth();
  const { liquidityData } = useLiquiditySocket();
  const { compassData } = useCompassSocket();
  const { ictData } = useICTSocket();
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

  // ✅ FETCH: Use REST API hook instead of WebSocket analysis (more reliable)
  const { analyses: apiAnalyses } = useAnalysis({
    autoConnect: true,
    pollingInterval: 2000 // Poll every 2 seconds for fresh data
  });

  // ✅ INSTANT: Combine API analysis with WebSocket data (live data only — no fabricated fallbacks)
  const analyses = useMemo(() => {
    if (apiAnalyses) return apiAnalyses;

    const niftyAnalysis = marketData.NIFTY?.analysis ?? null;
    const bankniftyAnalysis = marketData.BANKNIFTY?.analysis ?? null;
    const sensexAnalysis = marketData.SENSEX?.analysis ?? null;

    if (!niftyAnalysis && !bankniftyAnalysis && !sensexAnalysis) return null;

    return {
      NIFTY: niftyAnalysis,
      BANKNIFTY: bankniftyAnalysis,
      SENSEX: sensexAnalysis,
    };
  }, [apiAnalyses, marketData.NIFTY?.analysis, marketData.BANKNIFTY?.analysis, marketData.SENSEX?.analysis]);

  // Calculate market confidence on client-side to prevent hydration errors
  useEffect(() => {
    if (!analyses) return;
    
    const calculateIndexConfidence = (indexData) => {
      if (!indexData) return 50;
      
      const confidenceValues = [
        indexData.indicators?.ema200_confidence || (indexData.indicators?.is_above_ema200 ? 85 : 20),
        indexData.indicators?.vwap_confidence || (indexData.indicators?.vwap_signal ? 88 : 18),
        indexData.indicators?.ema_alignment_confidence || (indexData.indicators?.ema_alignment ? 75 : 28),
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
    // 🔥 COMPREHENSIVE AGGREGATION: ALL 9 UI SECTIONS INTEGRATED
    const calculateAggregatedSignal = (
      analysisData: any,
      directData: any,
      symbol: string,
      liquidityIndex: LiquidityIndex | null,
      compassIndex: CompassIndex | null,
      ictIndex: ICTIndex | null,
    ) => {
      const ind = analysisData?.indicators || {};
      const tick = directData || {};
      const price = ind.price || tick.price || 0;
      
      if (price === 0) {
        return { buyPercent: 50, sellPercent: 50, totalConfidence: 50, signal: 'NEUTRAL', sectionCount: 0, pred5mConf: 50, pred5mBuyPct: 50, pred5mDir: 'FLAT' as const };
      }
      
      let buyCount = 0;
      let sellCount = 0;
      let neutralCount = 0;
      let totalConfidenceSum = 0;
      let sectionCount = 0;

      // ═══════════════════════════════════════════════════════════════
      // SECTION 1: Trade Zones • Buy/Sell Signals (5min + 15min Trend)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const trend5min = String(ind.trend_5min || ind.trend || '').toUpperCase();
      const trend15min = String(ind.trend_15min || '').toUpperCase();
      const support = ind.support || 0;
      const resistance = ind.resistance || 0;
      const distanceToSupport = support > 0 ? Math.abs((price - support) / price * 100) : 100;
      const distanceToResistance = resistance > 0 ? Math.abs((resistance - price) / price * 100) : 100;
      
      if (trend5min.includes('UP') && trend15min.includes('UP') && distanceToSupport <= 2) {
        buyCount++;
        totalConfidenceSum += 95; // STRONG BUY setup
      } else if (trend5min.includes('DOWN') && trend15min.includes('DOWN') && distanceToResistance <= 2) {
        sellCount++;
        totalConfidenceSum += 95; // STRONG SELL setup
      } else if (trend5min.includes('UP')) {
        buyCount++;
        totalConfidenceSum += 70;
      } else if (trend5min.includes('DOWN')) {
        sellCount++;
        totalConfidenceSum += 70;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 2: Smart Money • Order Logic
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const bosBullish = ind.bos_bullish === true;
      const bosBearish = ind.bos_bearish === true;
      const fvgBullish = ind.fvg_bullish === true;
      const fvgBearish = ind.fvg_bearish === true;
      const orderBlockBull = Number(ind.order_block_bullish || 0);
      const orderBlockBear = Number(ind.order_block_bearish || 0);
      const smFlowStrength = Number(ind.order_flow_strength || 50);

      const smBullish = bosBullish || fvgBullish || (orderBlockBull > 0 && price > orderBlockBull);
      const smBearish = bosBearish || fvgBearish || (orderBlockBear > 0 && price < orderBlockBear);
      if (smBullish && !smBearish) {
        buyCount++;
        totalConfidenceSum += Math.min(90, 50 + smFlowStrength * 0.4);
      } else if (smBearish && !smBullish) {
        sellCount++;
        totalConfidenceSum += Math.min(90, 50 + (100 - smFlowStrength) * 0.4);
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 3: Intraday Technical Analysis (AI Signals + VWAP + EMA)
      // ═══════════════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════════════
      // SECTION 3: ICT Smart Money Intelligence
      // Order Blocks · Fair Value Gaps · Market Structure · Liquidity Sweeps
      // Sourced from dedicated ICT engine (own WebSocket + API).
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      if (ictIndex) {
        const ictConf = Math.max(1, Math.min(99, ictIndex.confidence));
        if (ictIndex.direction === 'BULLISH') {
          buyCount++;
          totalConfidenceSum += ictConf;
        } else if (ictIndex.direction === 'BEARISH') {
          sellCount++;
          totalConfidenceSum += ictConf;
        } else {
          neutralCount++;
          totalConfidenceSum += ictConf;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 5: Volume Pulse (Candle Volume Analysis)
      // Backend field: buy_volume_ratio (0-100 %) — not buy_volume
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      // buy_volume_ratio is already a percentage (0-100) from instant_analysis
      const buyVolumeRatio = Number(ind.buy_volume_ratio ?? 50);

      if (buyVolumeRatio > 65) {
        buyCount++; // Strong buying pressure
        totalConfidenceSum += Math.min(95, 50 + (buyVolumeRatio - 50) * 0.9);
      } else if (buyVolumeRatio > 55) {
        buyCount++; // Moderate buying pressure
        totalConfidenceSum += 68;
      } else if (buyVolumeRatio < 35) {
        sellCount++; // Strong selling pressure
        totalConfidenceSum += Math.min(95, 50 + (50 - buyVolumeRatio) * 0.9);
      } else if (buyVolumeRatio < 45) {
        sellCount++; // Moderate selling pressure
        totalConfidenceSum += 68;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 6: Trend Base (Higher-Low Structure)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const marketStructure = String(ind.market_structure || '').toUpperCase();
      const swingPattern = String(ind.swing_pattern || '').toUpperCase();
      const structureConfidence = ind.structure_confidence || 60;
      
      if (marketStructure.includes('HIGHER_HIGH') || swingPattern.includes('HIGHER_LOW')) {
        buyCount++; // Bullish structure
        totalConfidenceSum += structureConfidence;
      } else if (marketStructure.includes('LOWER_LOW') || swingPattern.includes('LOWER_HIGH')) {
        sellCount++; // Bearish structure
        totalConfidenceSum += structureConfidence;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 7: Pure Liquidity Intelligence (OI / PCR / Options Flow)
      // Sourced from the dedicated liquidity engine (separate WebSocket).
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      if (liquidityIndex) {
        const liqConf = liquidityIndex.confidence; // 1–99
        if (liquidityIndex.direction === 'BULLISH') {
          buyCount++;
          totalConfidenceSum += liqConf;
        } else if (liquidityIndex.direction === 'BEARISH') {
          sellCount++;
          totalConfidenceSum += liqConf;
        } else {
          neutralCount++;
          totalConfidenceSum += liqConf;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 8: Institutional Market Compass
      // AI-powered VWAP · EMA · Swing · Futures Premium · RSI · Volume
      // 6-factor weighted direction engine.
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      if (compassIndex) {
        const cmpConf = compassIndex.confidence; // 1–99
        if (compassIndex.direction === 'BULLISH') {
          buyCount++;
          totalConfidenceSum += cmpConf;
        } else if (compassIndex.direction === 'BEARISH') {
          sellCount++;
          totalConfidenceSum += cmpConf;
        } else {
          neutralCount++;
          totalConfidenceSum += cmpConf;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // 5-MIN PREDICTION ENGINE
      // All 9 UI sections contribute a factor (F1–F9).
      // ZERO extra API calls — all values already computed above.
      //   totalConfidence = average certainty of all 9 static signals
      //   pred5mConf      = certainty of the SHORT-TERM directional move
      // ═══════════════════════════════════════════════════════════════
      let p5Buy = 0, p5Sell = 0, p5ConfSum = 0, p5N = 0;

      // ── TIER 1: Fastest-moving real-time signals (weight ×2 / ×1) ──

      // F2 (S5): Volume Pulse — buying/selling pressure right now
      const f2 = buyVolumeRatio > 60 ? 2 : buyVolumeRatio > 52 ? 1
               : buyVolumeRatio < 40 ? -2 : buyVolumeRatio < 48 ? -1 : 0;
      if (f2 > 0) p5Buy += f2; else if (f2 < 0) p5Sell += Math.abs(f2);
      p5ConfSum += Math.min(90, 40 + Math.abs(buyVolumeRatio - 50) * 1.2); p5N++;

      // F3 (S7): Pure Liquidity 5-min prediction (OI velocity + PCR momentum)
      if (liquidityIndex) {
        const lq5m = liquidityIndex.prediction5m;
        const lq5mConf = liquidityIndex.pred5mConf; // 1–99
        const lqF = lq5m === 'STRONG_BUY' ? 2 : lq5m === 'BUY' ? 1
                  : lq5m === 'STRONG_SELL' ? -2 : lq5m === 'SELL' ? -1 : 0;
        if (lqF > 0) p5Buy += lqF; else if (lqF < 0) p5Sell += Math.abs(lqF);
        p5ConfSum += lq5mConf; p5N++;
      }

      // F4 (S8): Institutional Compass 5-min forecast (VWAP · EMA · Futures · RSI)
      if (compassIndex) {
        const cp5m = compassIndex.spot.prediction5m;
        const cp5mConf = compassIndex.spot.prediction5mConf; // 40–92
        const cpF = cp5m === 'STRONG_BUY' ? 2 : cp5m === 'BUY' ? 1
                  : cp5m === 'STRONG_SELL' ? -2 : cp5m === 'SELL' ? -1 : 0;
        if (cpF > 0) p5Buy += cpF; else if (cpF < 0) p5Sell += Math.abs(cpF);
        p5ConfSum += cp5mConf; p5N++;
      }

      // F5 (S3): ICT Smart Money 5-min prediction (Order Blocks · FVG · Structure)
      if (ictIndex) {
        const ict5m = ictIndex.prediction5m;
        const ict5mConf = Math.max(20, Math.min(95, ictIndex.pred5mConf));
        const ictF = ict5m === 'STRONG_BUY' ? 2 : ict5m === 'BUY' ? 1
                   : ict5m === 'STRONG_SELL' ? -2 : ict5m === 'SELL' ? -1 : 0;
        if (ictF > 0) p5Buy += ictF; else if (ictF < 0) p5Sell += Math.abs(ictF);
        p5ConfSum += ict5mConf; p5N++;
      }

      // ── TIER 2: Structural / slower-moving confirms ──

      // F7 (S1): Trade Zones — trend alignment across 5min + 15min
      const f7 = trend5min.includes('UP') && trend15min.includes('UP') ? 2
                : trend5min.includes('UP') ? 1
                : trend5min.includes('DOWN') && trend15min.includes('DOWN') ? -2
                : trend5min.includes('DOWN') ? -1 : 0;
      if (f7 > 0) p5Buy += f7; else if (f7 < 0) p5Sell += Math.abs(f7);
      p5ConfSum += (trend5min.includes('UP') || trend5min.includes('DOWN')) ? 72 : 48; p5N++;

      // F8 (S2): Smart Money Flow — BOS / FVG institutional positioning
      const f8 = (smBullish && !smBearish) ? 1 : (!smBullish && smBearish) ? -1 : 0;
      if (f8 > 0) p5Buy += f8; else if (f8 < 0) p5Sell += Math.abs(f8);
      p5ConfSum += Math.min(90, 50 + smFlowStrength * 0.4); p5N++;

      // F9 (S6): Trend Base — higher-high / higher-low structure
      const f9 = marketStructure.includes('HIGHER_HIGH') || swingPattern.includes('HIGHER_LOW') ?  1
                : marketStructure.includes('LOWER_LOW')   || swingPattern.includes('LOWER_HIGH') ? -1 : 0;
      if (f9 > 0) p5Buy += f9; else if (f9 < 0) p5Sell += Math.abs(f9);
      p5ConfSum += f9 !== 0 ? Math.min(85, structureConfidence) : 50; p5N++;

      const p5Total      = p5Buy + p5Sell;
      const pred5mBuyPct = p5Total > 0 ? Math.round((p5Buy / p5Total) * 100) : 50;
      const pred5mConf   = p5N > 0 ? Math.round(Math.min(90, Math.max(35, p5ConfSum / p5N))) : 50;
      const pred5mDir    = pred5mBuyPct >= 58 ? 'UP' : pred5mBuyPct <= 42 ? 'DOWN' : 'FLAT';

      // ═══════════════════════════════════════════════════════════════
      // FINAL CALCULATION
      // ═══════════════════════════════════════════════════════════════
      const totalSignals = buyCount + sellCount + neutralCount;
      const buyPercent = totalSignals > 0 ? Math.round(((buyCount + neutralCount * 0.5) / totalSignals) * 100) : 50;
      const sellPercent = 100 - buyPercent;
      const avgConfidence = sectionCount > 0 ? Math.round(totalConfidenceSum / sectionCount) : 50;

      let signal = 'NEUTRAL';
      if (buyPercent >= 70) signal = 'STRONG_BUY';
      else if (buyPercent >= 55) signal = 'BUY';
      else if (sellPercent >= 70) signal = 'STRONG_SELL';
      else if (sellPercent >= 55) signal = 'SELL';

      return { buyPercent, sellPercent, totalConfidence: avgConfidence, signal, sectionCount, pred5mConf, pred5mBuyPct, pred5mDir };
    };

    return {
      NIFTY:     calculateAggregatedSignal(analyses?.NIFTY,     marketData.NIFTY,     'NIFTY',     liquidityData.NIFTY     ?? null, compassData.NIFTY     ?? null, ictData.NIFTY     ?? null),
      BANKNIFTY: calculateAggregatedSignal(analyses?.BANKNIFTY, marketData.BANKNIFTY, 'BANKNIFTY', liquidityData.BANKNIFTY ?? null, compassData.BANKNIFTY ?? null, ictData.BANKNIFTY ?? null),
      SENSEX:    calculateAggregatedSignal(analyses?.SENSEX,    marketData.SENSEX,    'SENSEX',    liquidityData.SENSEX    ?? null, compassData.SENSEX    ?? null, ictData.SENSEX    ?? null),
    };
  }, [analyses, marketData, liquidityData, compassData, ictData]);

  // Update current time
  useEffect(() => {
    const updateTime = () => {
      setCurrentTime(new Date().toLocaleTimeString('en-IN'));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Determine market status from actual data, with client-side IST fallback
  // so the UI never shows "MARKET CLOSED" when the Indian market is actually open
  const marketStatus = useMemo(() => {
    const dataStatus = marketData.NIFTY?.status || marketData.BANKNIFTY?.status || marketData.SENSEX?.status;

    // If we have a status from backend tick data, trust it (it uses server IST clock)
    if (dataStatus && dataStatus !== 'DEMO') {
      return dataStatus as 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
    }

    // Fallback: compute market phase client-side using IST
    // This prevents showing "MARKET CLOSED" when backend ticks haven't arrived yet
    try {
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const day = nowIST.getDay(); // 0=Sun, 6=Sat
      const h = nowIST.getHours();
      const m = nowIST.getMinutes();
      const mins = h * 60 + m; // minutes since midnight IST

      if (day === 0 || day === 6) return 'CLOSED';       // weekends
      if (mins >= 540 && mins < 555) return 'PRE_OPEN';  // 9:00-9:15
      if (mins >= 555 && mins <= 930) return 'LIVE';      // 9:15-15:30
    } catch {
      // toLocaleString may fail in exotic envs; ignore
    }

    return 'OFFLINE';
  }, [marketData.NIFTY?.status, marketData.BANKNIFTY?.status, marketData.SENSEX?.status]);

  // Derive a display-ready connection status.
  // Upgrades to LIVE when WS is connected AND live tick data is flowing.
  // Downgrades alarming RECONNECTING to calmer messages outside trading hours.
  const hasLiveData = !!(marketData.NIFTY?.price || marketData.BANKNIFTY?.price || marketData.SENSEX?.price);

  const displayStatus = useMemo(() => {
    // WS connected + live tick data + market LIVE → show "Live market data ⚡"
    if (connectionStatus === 'connected' && hasLiveData && marketStatus === 'LIVE') {
      return 'LIVE' as const;
    }

    // WS connected but no live data yet, or market not LIVE → CONNECTED (teal)
    if (connectionStatus === 'connected') return 'CONNECTED' as const;

    // Market closed / offline → calm "Waiting for market to open"
    if (marketStatus === 'CLOSED' || marketStatus === 'OFFLINE') {
      if (connectionStatus === 'RECONNECTING' || connectionStatus === 'connecting' || connectionStatus === 'disconnected') {
        return 'WAITING' as const;
      }
    }

    // Pre-market or freeze → gentle "Connecting…" instead of alarming RECONNECTING
    if (marketStatus === 'PRE_OPEN' || marketStatus === 'FREEZE') {
      if (connectionStatus === 'RECONNECTING') {
        return 'CONNECTING' as const;
      }
    }

    // During LIVE with no data yet, convert RECONNECTING → CONNECTING (less alarming)
    if (marketStatus === 'LIVE' && !hasLiveData && connectionStatus === 'RECONNECTING') {
      return 'CONNECTING' as const;
    }

    // Pass through actual status
    return connectionStatus;
  }, [connectionStatus, marketStatus, hasLiveData]);

  // Show loading until client is mounted to prevent hydration errors
  if (!isClient) {
    return (
      <main className="min-h-screen bg-dark-bg flex items-center justify-center">
        <div className="text-center">
          {/* Simple Professional Spinner */}
          <div className="relative w-16 h-16 mx-auto mb-4">
            <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-transparent border-t-emerald-500 rounded-full animate-spin"></div>
          </div>
          
          {/* Brand Name */}
          <h2 className="text-lg font-semibold text-white">MyDailyTradingSignals</h2>
        </div>
      </main>
    );
  }

  return (
    <main suppressHydrationWarning className="min-h-screen">
      {/* Header */}
      <Header isConnected={isConnected} marketStatus={marketStatus} />
      
      {/* 🔥 NEW: Professional System Status Banner */}
      <SystemStatusBanner />
      
      {/* Connection Status Bar */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        {/* Use same status component for both mobile and desktop */}
        <LiveStatus status={displayStatus} isConnected={isConnected} />
      </div>

      {/* Overall Market Outlook */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <div className="rounded-2xl border border-white/[0.09] bg-[#06090e] overflow-hidden shadow-2xl shadow-black/60">

          {/* Header */}
          <div className="px-3 sm:px-5 py-3 flex items-center gap-1.5 sm:gap-3 bg-teal-500/[0.04] rounded-xl border border-emerald-400/25">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="w-[3px] h-7 sm:h-9 rounded-full bg-gradient-to-b from-teal-300 to-teal-600 shrink-0 shadow-sm shadow-teal-500/20" />
              <h2 className="text-[12px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug whitespace-nowrap">Overall Market Outlook</h2>
            </div>
            <IndiaVIXBadge
              value={vixData.value}
              changePercent={vixData.changePercent}
              volatilityLevel={vixData.volatilityLevel}
              marketFearScore={vixData.marketFearScore}
              loading={vixLoading}
            />
            <div className="flex items-center gap-2 ml-auto">
              <span className="hidden sm:inline text-[9px] text-white/60 font-bold">{aggregatedMarketSignal.NIFTY.sectionCount} Signals</span>
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse" />
              <span className="text-[9px] text-teal-400/50 font-bold">LIVE</span>
            </div>
          </div>

          {/* Index Cards */}
          <div suppressHydrationWarning className="grid grid-cols-1 lg:grid-cols-3 gap-2.5 p-3">
            {(['NIFTY','BANKNIFTY','SENSEX'] as const).map((sym) => {
              const s = aggregatedMarketSignal[sym];
              const isBull = s.buyPercent >= 55, isBear = s.sellPercent >= 55;

              const accentDot = isBull ? 'bg-teal-400 shadow-teal-400/60' : isBear ? 'bg-rose-400 shadow-rose-400/60' : 'bg-amber-400 shadow-amber-400/60';
              const sigPill   = isBull ? 'text-teal-300 border-teal-400/30 bg-teal-500/15' : isBear ? 'text-rose-300 border-rose-400/30 bg-rose-500/15' : 'text-amber-300 border-amber-400/30 bg-amber-500/15';
              const name      = sym === 'NIFTY' ? 'NIFTY 50' : sym === 'BANKNIFTY' ? 'BANK NIFTY' : 'SENSEX';

              const p5 = { conf: s.pred5mConf, buyPct: s.pred5mBuyPct, dir: s.pred5mDir };
              const p5SellPct = 100 - p5.buyPct;
              const p5Bull = p5.dir === 'UP', p5Bear = p5.dir === 'DOWN';
              const p5DirIcon = p5Bull ? '▲' : p5Bear ? '▼' : '◆';
              const p5DirColor = p5Bull ? 'text-teal-400' : p5Bear ? 'text-rose-400' : 'text-amber-400';
              const p5ConfColor = p5Bull ? 'text-teal-300' : p5Bear ? 'text-rose-300' : 'text-amber-300';
              const p5Signal = p5Bull ? (p5.buyPct >= 65 ? 'STRONG BUY' : 'BUY') : p5Bear ? (p5SellPct >= 65 ? 'STRONG SELL' : 'SELL') : 'NEUTRAL';
              const p5SigColor = p5Bull ? 'text-teal-300 border-teal-400/20 bg-teal-500/[0.06]' : p5Bear ? 'text-rose-300 border-rose-400/20 bg-rose-500/[0.06]' : 'text-amber-300 border-amber-400/20 bg-amber-500/[0.06]';

              const cardBorder = isBull ? 'border-teal-500/20 hover:border-teal-500/35' : isBear ? 'border-rose-500/20 hover:border-rose-500/35' : 'border-white/[0.08] hover:border-white/[0.14]';
              const cardBg = isBull ? 'bg-teal-500/[0.03]' : isBear ? 'bg-rose-500/[0.03]' : 'bg-white/[0.015]';

              return (
                <div key={sym} suppressHydrationWarning
                  className={`rounded-xl border overflow-hidden transition-all duration-200 flex flex-col ${cardBorder} ${cardBg}`}>

                  {/* Card Header — index name + signal pill */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.05]">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-[0_0_6px_2px] ${accentDot}`} />
                      <span className="text-sm font-black text-white tracking-tight px-3 py-1.5 rounded-md border border-emerald-400/30 bg-emerald-500/[0.08]">{name}</span>
                    </div>
                    <span suppressHydrationWarning className={`text-[11px] font-black px-3 py-1.5 rounded-md border tracking-wider min-w-[58px] text-center ${sigPill}`}>
                      {s.signal.replace('_', ' ')}
                    </span>
                  </div>

                  {/* Confidence Signals */}
                  <div className="px-4 pt-3.5 pb-3 flex-1">
                    <div className="mb-2.5">
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">{s.sectionCount} Signals</span>
                    </div>
                    <div suppressHydrationWarning className="h-2.5 rounded-full overflow-hidden flex bg-white/[0.06] mb-3">
                      <div className="bg-gradient-to-r from-teal-700 to-teal-400 transition-all duration-700 ease-out" style={{ width: `${s.buyPercent}%` }} />
                      <div className="bg-gradient-to-r from-rose-400 to-rose-700 flex-1" />
                    </div>
                    <div className="flex items-center justify-between text-[12px] font-bold">
                      <span suppressHydrationWarning className="text-teal-400 tabular-nums">
                        <span className="text-white/30 mr-1.5">BUY</span>
                        <span className="inline-block min-w-[32px] text-left">{s.buyPercent}%</span>
                        <span className="ml-1">▲</span>
                      </span>
                      <span suppressHydrationWarning className="text-rose-400 tabular-nums">
                        <span className="mr-1">▼</span>
                        <span className="inline-block min-w-[32px] text-right">{s.sellPercent}%</span>
                        <span className="text-white/30 ml-1.5">SELL</span>
                      </span>
                    </div>
                  </div>

                  {/* 5-Min Forecast */}
                  <div className="mx-3 mb-3 rounded-lg border border-dashed border-white/[0.08] bg-black/25 px-3.5 py-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-cyan-300/50 uppercase tracking-[0.12em]">5-Min</span>
                        <span suppressHydrationWarning className={`text-[12px] font-black min-w-[50px] ${p5DirColor}`}>{p5DirIcon} {p5.dir}</span>
                      </div>
                      <span suppressHydrationWarning className={`text-[10px] font-black px-2 py-1 rounded border min-w-[72px] text-center ${p5SigColor}`}>
                        {p5Signal}
                      </span>
                    </div>
                    <div suppressHydrationWarning className="h-[6px] rounded-full overflow-hidden flex bg-white/[0.06] mb-2.5">
                      <div className="bg-gradient-to-r from-teal-600 to-teal-400 transition-all duration-700 ease-out" style={{ width: `${p5.buyPct}%` }} />
                      <div className="bg-gradient-to-r from-rose-400 to-rose-600 flex-1" />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span suppressHydrationWarning className="text-teal-400/80 tabular-nums">
                        <span className="text-white/25 mr-1.5">BUY</span>
                        <span className="inline-block min-w-[32px] text-left">{p5.buyPct}%</span>
                        <span className="ml-1">▲</span>
                      </span>
                      <span suppressHydrationWarning className="text-rose-400/80 tabular-nums">
                        <span className="mr-1">▼</span>
                        <span className="inline-block min-w-[32px] text-right">{p5SellPct}%</span>
                        <span className="text-white/25 ml-1.5">SELL</span>
                      </span>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Dashboard - Full Width */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4">
        {/* Live Market Indices - With Border */}
        <div className="border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          {/* Section Header */}
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <SectionTitle
              title="Live Market Indices"
              accentColor="emerald"
              badge={
                <span className="relative inline-flex items-center px-2 sm:px-2.5 py-0.5 sm:py-1 text-[9px] sm:text-[10px] font-bold bg-gradient-to-r from-accent via-accent-secondary to-accent rounded-md shadow-lg animate-pulse-slow border border-accent/30 whitespace-nowrap leading-none align-middle">
                  <span className="relative z-10 inline-flex items-center gap-0.5">
                    <span>🤖</span>
                    <span className="bg-gradient-to-r from-white via-cyan-100 to-white bg-clip-text text-transparent font-extrabold">AI POWERED</span>
                    <span>✨</span>
                  </span>
                  <span className="absolute inset-0 bg-gradient-to-r from-accent via-accent-secondary to-accent blur-xl opacity-40 rounded-md"></span>
                </span>
              }
            />

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

        {/* P1: ⚡ PURE LIQUIDITY INTELLIGENCE */}
        <LiquidityIntelligence />

        {/* P4: Smart Money • Order Logic */}
        <div className="mt-6 sm:mt-6 border-2 border-purple-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-600/15">
          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <SectionTitle
              title="Smart Money • Order Logic"
              subtitle="Order Flow • Institutional Positioning • Fair Value Gaps • Order Blocks • Market Imbalances"
              accentColor="purple"
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <InstitutionalMarketView symbol="NIFTY" />
            <InstitutionalMarketView symbol="BANKNIFTY" />
            <InstitutionalMarketView symbol="SENSEX" />
          </div>
        </div>

        {/* P2: Trend Base Section */}
        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-1 mb-3 sm:mb-4">
            <SectionTitle
              title="Trend Base (Higher-Low Structure)"
              subtitle="Live swing structure · 8-factor analysis · 5-min prediction"
              accentColor="green"
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <TrendBaseCard symbol="NIFTY" name="NIFTY 50" />
            <TrendBaseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <TrendBaseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* P2b: Volume Pulse Section */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-500/10">
          <div className="flex flex-col gap-3 mb-3 sm:mb-4">
            <SectionTitle
              title="Volume Pulse (Candle Volume)"
              subtitle="Real-time buying/selling pressure • Green vs Red candle volume tracking"
              accentColor="emerald"
            />
          </div>

          {/* Volume Pulse Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <VolumePulseCard symbol="NIFTY" name="NIFTY 50" />
            <VolumePulseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <VolumePulseCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* P3: 🏦 ICT SMART MONEY INTELLIGENCE */}
        <ICTIntelligence />

        {/* P5: 🧭 INSTITUTIONAL MARKET COMPASS */}
        <InstitutionalCompass />

        {/* P7: 🎯 TRADE ZONES – Buy/Sell Signals (Multi-factor, dual timeframe) */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-600/15">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <SectionTitle
              title="Trade Zones • Buy/Sell Signals"
              subtitle="5min Entry + 15min Trend • 8-Factor Scoring • Live Confidence • 5-Min Prediction"
              accentColor="emerald"
            />
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <TradeSupportResistance 
              symbol="NIFTY" 
              symbolName="NIFTY 50" 
              data={marketData.NIFTY} 
              analysis={analyses?.NIFTY}
              marketStatus={marketStatus}
            />
            <TradeSupportResistance 
              symbol="BANKNIFTY" 
              symbolName="BANK NIFTY" 
              data={marketData.BANKNIFTY} 
              analysis={analyses?.BANKNIFTY}
              marketStatus={marketStatus}
            />
            <TradeSupportResistance 
              symbol="SENSEX" 
              symbolName="SENSEX" 
              data={marketData.SENSEX} 
              analysis={analyses?.SENSEX}
              marketStatus={marketStatus}
            />
          </div>
        </div>

        {/* P10: 🕯️ CRT-BASED BTST STRATEGIES */}
        <div className="mt-6 sm:mt-6 border-2 border-orange-500/35 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-orange-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-orange-500/10">
          <div className="flex flex-col gap-1 mb-3 sm:mb-4">
            <SectionTitle
              title="CRT-Based BTST Strategies"
              subtitle="Candle Range Theory • 8-Factor Scoring • PDH/PDL Sweep Detection • AMD Pattern • Evening BTST Signals"
              accentColor="amber"
              badge={
                <span className="relative inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-gradient-to-r from-orange-600/80 to-amber-600/80 rounded-md shadow-lg border border-orange-400/30 whitespace-nowrap leading-none">
                  <span className="relative z-10 inline-flex items-center gap-0.5">
                    <span>🕯️</span>
                    <span className="bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-transparent font-extrabold">BTST ENGINE</span>
                  </span>
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <CRTBTSTCard symbol="NIFTY" name="NIFTY 50" data={marketData.NIFTY} />
            <CRTBTSTCard symbol="BANKNIFTY" name="BANK NIFTY" data={marketData.BANKNIFTY} />
            <CRTBTSTCard symbol="SENSEX" name="SENSEX" data={marketData.SENSEX} />
          </div>
        </div>

      </div>

      {/* Analysis Info Banner */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <div className="mt-4 p-4 bg-black/40 border-2 border-green-500/40 rounded-xl shadow-lg shadow-green-500/20">
          <div className="flex items-start gap-4">
            <div className="text-3xl flex-shrink-0">📊</div>
            <div className="flex-1">
              <h3 className="text-[17px] sm:text-[19px] lg:text-[22px] font-bold text-slate-50 tracking-[-0.01em] mb-2 flex items-center gap-2.5">
                LIVE Market Data Analysis
                <span className={`text-xs px-2.5 py-1 rounded-full font-extrabold shadow-md ${
                  marketStatus === 'LIVE' 
                    ? 'bg-cyan-900/60 text-cyan-300 border-2 border-cyan-500/60 shadow-cyan-500/40 animate-pulse' 
                    : 'bg-red-900/60 text-red-300 border-2 border-red-500/60 shadow-red-500/40'
                }`}>
                  {marketStatus === 'LIVE' ? '● LIVE' : marketStatus === 'PRE_OPEN' ? '● Pre-Open' : marketStatus === 'FREEZE' ? '● Freeze' : '● Market Closed'}
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
          <span suppressHydrationWarning className="tracking-wide">MyDailyTradingSignals © {currentYear}</span>
          <span className="flex items-center gap-2">
            <span className="w-2 h-2 bg-bullish rounded-full animate-pulse shadow-md shadow-bullish" />
            <span className="hidden sm:inline">Built for</span> Harikrishna Challa
          </span>
        </div>
      </footer>
    </main>
  );
}

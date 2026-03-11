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
import { useOIMomentumLive, type OIMomentumLiveData } from '@/hooks/useOIMomentumLive';
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

const VWMAEMAFilterCard = dynamic(() => import('@/components/VWMAEMAFilterCard'), { ssr: false });
const MarketPositioningCard = dynamic(() => import('@/components/MarketPositioningCard'), { ssr: false });
const OIMomentumCard = dynamic(() => import('@/components/OIMomentumCard'), { 
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
const CandleIntentCard = dynamic(() => import('@/components/CandleIntentCard'), { ssr: false });
const PivotSectionUnified = dynamic(() => import('@/components/PivotSectionUnified'), { ssr: false });
const TradeSupportResistance = dynamic(() => import('@/components/TradeSupportResistance'), { ssr: false });
const InstitutionalMarketView = dynamic(() => import('@/components/InstitutionalMarketView'), { ssr: false });
const CandleQualityAnalysis = dynamic(() => import('@/components/CandleQualityAnalysis'), { ssr: false });
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
  // OI Momentum — one hook per symbol, shares global WS + in-memory cache
  const { data: oiNifty }     = useOIMomentumLive('NIFTY');
  const { data: oiBankNifty } = useOIMomentumLive('BANKNIFTY');
  const { data: oiSensex }    = useOIMomentumLive('SENSEX');
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
        indexData.indicators?.vwma_ema_confidence || (indexData.indicators?.vwma_above_ema200 ? 85 : 25),
        indexData.indicators?.rsi_confidence || (indexData.indicators?.rsi ? 78 : 22),
        indexData.indicators?.ema200_confidence || (indexData.indicators?.is_above_ema200 ? 85 : 20),
        indexData.indicators?.vwap_confidence || (indexData.indicators?.vwap_signal ? 88 : 18),
        indexData.indicators?.ema_alignment_confidence || (indexData.indicators?.ema_alignment ? 75 : 28),
        indexData.indicators?.camarilla_confidence || (indexData.indicators?.camarilla_signal ? 72 : 24),
        indexData.indicators?.supertrend_confidence || (indexData.indicators?.supertrend ? 80 : 15),
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
    // 🔥 COMPREHENSIVE AGGREGATION: ALL 17 SECTIONS INTEGRATED
    const calculateAggregatedSignal = (
      analysisData: any,
      directData: any,
      symbol: string,
      liquidityIndex: LiquidityIndex | null,
      compassIndex: CompassIndex | null,
      oiData: OIMomentumLiveData | null,
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
      // SECTION 2: Smart Money Flow • Order Structure Intelligence
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
      // SECTION 3: High Volume Candle Scanner (VERY GOOD VOLUME Logic)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const candleOpen = tick.open || ind.open || price;
      const candleClose = price;
      const candleHigh = tick.high || ind.high || 0;
      const candleLow = tick.low || ind.low || 0;
      const candleVolume = tick.volume || ind.volume || 0;
      const last5VolumeAvg = analysisData?.volume?.last_5_avg || (candleVolume * 0.8);
      const volumeRatio = last5VolumeAvg > 0 ? candleVolume / last5VolumeAvg : 1;
      const candleRange = candleHigh - candleLow;
      const candleBody = Math.abs(candleClose - candleOpen);
      const bodyPercent = candleRange > 0 ? (candleBody / candleRange) * 100 : 0;
      
      const isVeryGoodVolume = candleVolume > 50000 && volumeRatio > 1.8 && bodyPercent > 60;
      const isFakeSpike = volumeRatio > 2.5 && bodyPercent < 40;
      
      if (isVeryGoodVolume && candleClose > candleOpen) {
        buyCount++;
        totalConfidenceSum += 98; // Conviction move
      } else if (isVeryGoodVolume && candleClose < candleOpen) {
        sellCount++;
        totalConfidenceSum += 98;
      } else if (isFakeSpike && candleClose > candleOpen) {
        sellCount++; // Fake bull trap
        totalConfidenceSum += 75;
      } else if (isFakeSpike && candleClose < candleOpen) {
        buyCount++; // Fake bear trap
        totalConfidenceSum += 75;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 4: Intraday Technical Analysis (AI Signals + VWAP + EMA)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const aiSignal = String(analysisData?.signal || '').toUpperCase();
      const vwap = ind.vwap || 0;
      const ema200 = ind.ema_200 || 0;
      const aiConfidence = Number(analysisData?.confidence || 0.5);
      
      if ((aiSignal.includes('BUY') && price > vwap && price > ema200) && aiConfidence > 0.6) {
        buyCount++;
        totalConfidenceSum += Math.round(aiConfidence * 100);
      } else if ((aiSignal.includes('SELL') && price < vwap && price < ema200) && aiConfidence > 0.6) {
        sellCount++;
        totalConfidenceSum += Math.round(aiConfidence * 100);
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 5: VWMA 20 • Entry Filter
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const vwma20 = ind.vwma_20 || 0;
      if (vwma20 > 0) {
        if (price > vwma20) {
          buyCount++;
          totalConfidenceSum += 75;
        } else {
          sellCount++;
          totalConfidenceSum += 75;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 6: Camarilla R3/S3 • CPR Zones
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const camarillaR3 = ind.camarilla_r3 || 0;
      const camarillaS3 = ind.camarilla_s3 || 0;
      const cprTC = ind.cpr_tc || 0;
      const cprBC = ind.cpr_bc || 0;
      const camarillaConfidence = ind.camarilla_confidence || 50;
      
      if (price > camarillaR3 && camarillaR3 > 0) {
        buyCount++; // Breakout above R3
        totalConfidenceSum += camarillaConfidence;
      } else if (price < camarillaS3 && camarillaS3 > 0) {
        sellCount++; // Breakdown below S3
        totalConfidenceSum += camarillaConfidence;
      } else if (price > cprTC && cprTC > 0) {
        buyCount++; // Above CPR top
        totalConfidenceSum += Math.max(50, camarillaConfidence - 10);
      } else if (price < cprBC && cprBC > 0) {
        sellCount++; // Below CPR bottom
        totalConfidenceSum += Math.max(50, camarillaConfidence - 10);
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 7: RSI 60/40 Momentum
      // Backend provides single 'rsi' field derived from momentum
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const rsiValue = Number(ind.rsi || 50);

      if (rsiValue < 35) {
        buyCount++; // Oversold — potential bounce
        totalConfidenceSum += 88;
      } else if (rsiValue < 40) {
        buyCount++; // Approaching oversold
        totalConfidenceSum += 72;
      } else if (rsiValue > 65) {
        sellCount++; // Overbought — potential reversal
        totalConfidenceSum += 88;
      } else if (rsiValue > 60) {
        sellCount++; // Approaching overbought
        totalConfidenceSum += 72;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 9: SuperTrend (10,2) • Trend Following
      // Backend field: supertrend_10_2_value (not supertrend_10_2)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const supertrendValue = Number(ind.supertrend_10_2_value || 0);
      const supertrendSignal = String(ind.supertrend_10_2_signal || '').toUpperCase();
      const supertrendTrend  = String(ind.supertrend_10_2_trend  || '').toUpperCase();
      const supertrendDistPct = Math.abs(Number(ind.supertrend_10_2_distance_pct || 0));
      const supertrendConf = Math.min(93, 50 + supertrendDistPct * 15);

      if (supertrendSignal === 'BUY' || supertrendTrend === 'BULLISH' || (supertrendValue > 0 && price > supertrendValue)) {
        buyCount++;
        totalConfidenceSum += supertrendConf;
      } else if (supertrendSignal === 'SELL' || supertrendTrend === 'BEARISH' || (supertrendValue > 0 && price < supertrendValue)) {
        sellCount++;
        totalConfidenceSum += supertrendConf;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 10: Pivot Points (Support/Resistance Levels)
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const pivotR1 = ind.pivot_r1 || 0;
      const pivotS1 = ind.pivot_s1 || 0;
      const pivotR2 = ind.pivot_r2 || 0;
      const pivotS2 = ind.pivot_s2 || 0;
      
      if (pivotR1 > 0 && price > pivotR1) {
        buyCount++; // Above R1 resistance
        totalConfidenceSum += 75;
      } else if (pivotS1 > 0 && price < pivotS1) {
        sellCount++; // Below S1 support
        totalConfidenceSum += 75;
      } else if (pivotR2 > 0 && pivotS2 > 0 && price > (pivotR2 + pivotS2) / 2) {
        buyCount++; // Above pivot midpoint
        totalConfidenceSum += 60;
      } else if (pivotR2 > 0 && pivotS2 > 0 && price < (pivotR2 + pivotS2) / 2) {
        sellCount++; // Below pivot midpoint
        totalConfidenceSum += 60;
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 12: Candle Intent (Candle Structure Analysis)
      // Derived from tick + OHLC — candle_intent separate endpoint;
      // infer from body position vs range using available tick fields
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      const ciHigh   = Number(tick.high  || ind.high  || price);
      const ciLow    = Number(tick.low   || ind.low   || price);
      const ciOpen   = Number(tick.open  || ind.open  || price);
      const ciRange  = ciHigh - ciLow;
      const ciBody   = Math.abs(price - ciOpen);
      const ciBodyPct = ciRange > 0 ? (ciBody / ciRange) * 100 : 0;
      const ciUpperWick = ciHigh - Math.max(price, ciOpen);
      const ciLowerWick = Math.min(price, ciOpen) - ciLow;
      const ciBodyConf = Math.min(85, 50 + ciBodyPct * 0.35);

      if (price > ciOpen && ciLowerWick > ciUpperWick * 1.5 && ciBodyPct > 40) {
        buyCount++; // Bullish: lower wick rejection + green body
        totalConfidenceSum += ciBodyConf;
      } else if (price > ciOpen && ciBodyPct > 55) {
        buyCount++; // Strong green candle
        totalConfidenceSum += Math.min(80, 55 + ciBodyPct * 0.25);
      } else if (price < ciOpen && ciUpperWick > ciLowerWick * 1.5 && ciBodyPct > 40) {
        sellCount++; // Bearish: upper wick rejection + red body
        totalConfidenceSum += ciBodyConf;
      } else if (price < ciOpen && ciBodyPct > 55) {
        sellCount++; // Strong red candle
        totalConfidenceSum += Math.min(80, 55 + ciBodyPct * 0.25);
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // SECTION 13: Volume Pulse (Candle Volume Analysis)
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
      // SECTION 14: Trend Base (Higher-Low Structure)
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
      // SECTION 15: Pure Liquidity Intelligence (OI / PCR / Options Flow)
      // Sourced from the dedicated liquidity engine — zero overlap with
      // the 14 price-action sections above.
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
      // SECTION 16: Institutional Market Compass
      // AI-powered VWAP · EMA · Swing · Futures Premium · RSI · Volume
      // 6-factor weighted direction engine — orthogonal to price-action.
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
      // SECTION 17: OI Momentum Signals
      // LONG_BUILDUP / SHORT_COVERING / SHORT_BUILDUP / LONG_UNWINDING
      // Sourced from the dedicated OI momentum engine (separate API).
      // ═══════════════════════════════════════════════════════════════
      sectionCount++;
      if (oiData) {
        const oiConf = Math.max(1, Math.min(99, oiData.confidence));
        const oiSig  = (oiData.final_signal ?? '').toUpperCase();
        if (oiSig === 'LONG_BUILDUP' || oiSig === 'SHORT_COVERING') {
          buyCount++;
          totalConfidenceSum += oiConf;
        } else if (oiSig === 'SHORT_BUILDUP' || oiSig === 'LONG_UNWINDING') {
          sellCount++;
          totalConfidenceSum += oiConf;
        } else {
          neutralCount++;
          totalConfidenceSum += oiConf;
        }
      } else {
        neutralCount++;
        totalConfidenceSum += 50;
      }

      // ═══════════════════════════════════════════════════════════════
      // 5-MIN PREDICTION ENGINE
      // Every one of the 15 sections contributes a factor here.
      // ZERO extra API calls — all values already computed above.
      //   totalConfidence = average certainty of all 15 static signals
      //   pred5mConf      = certainty of the SHORT-TERM directional move
      // ═══════════════════════════════════════════════════════════════
      let p5Buy = 0, p5Sell = 0, p5ConfSum = 0, p5N = 0;

      // ── TIER 1: Fastest-moving real-time signals (weight ×2 / ×1) ──

      // F1 (S12): Candle Intent — most immediate price-action signal
      const f1 = price > ciOpen && ciBodyPct > 40 ? 2 : price > ciOpen ? 1
               : price < ciOpen && ciBodyPct > 40 ? -2 : price < ciOpen ? -1 : 0;
      if (f1 > 0) p5Buy += f1; else if (f1 < 0) p5Sell += Math.abs(f1);
      p5ConfSum += Math.min(88, 50 + ciBodyPct * 0.4); p5N++;

      // F2 (S13): Volume Pulse — buying/selling pressure right now
      const f2 = buyVolumeRatio > 60 ? 2 : buyVolumeRatio > 52 ? 1
               : buyVolumeRatio < 40 ? -2 : buyVolumeRatio < 48 ? -1 : 0;
      if (f2 > 0) p5Buy += f2; else if (f2 < 0) p5Sell += Math.abs(f2);
      p5ConfSum += Math.min(90, 40 + Math.abs(buyVolumeRatio - 50) * 1.2); p5N++;

      // F3 (S7): RSI 60/40 momentum direction
      const f3 = rsiValue < 40 ? 1 : rsiValue > 60 ? -1 : 0;
      if (f3 > 0) p5Buy += f3; else if (f3 < 0) p5Sell += Math.abs(f3);
      p5ConfSum += rsiValue > 65 || rsiValue < 35 ? 82 : rsiValue > 60 || rsiValue < 40 ? 68 : 50; p5N++;

      // F5 (S9): SuperTrend (10,2) short-term trend
      const f5 = supertrendSignal === 'BUY' || supertrendTrend === 'BULLISH' ? 1
               : supertrendSignal === 'SELL' || supertrendTrend === 'BEARISH' ? -1 : 0;
      if (f5 > 0) p5Buy += f5; else if (f5 < 0) p5Sell += Math.abs(f5);
      p5ConfSum += supertrendConf || 50; p5N++;

      // F6 (S15): Pure Liquidity 5-min prediction (OI velocity + PCR momentum)
      if (liquidityIndex) {
        const lq5m = liquidityIndex.prediction5m;
        const lq5mConf = liquidityIndex.pred5mConf; // 1–99
        const lqF = lq5m === 'STRONG_BUY' ? 2 : lq5m === 'BUY' ? 1
                  : lq5m === 'STRONG_SELL' ? -2 : lq5m === 'SELL' ? -1 : 0;
        if (lqF > 0) p5Buy += lqF; else if (lqF < 0) p5Sell += Math.abs(lqF);
        p5ConfSum += lq5mConf; p5N++;
      }

      // F8 (S16): Institutional Compass 5-min forecast (VWAP · EMA · Futures · RSI)
      if (compassIndex) {
        const cp5m = compassIndex.spot.prediction5m;
        const cp5mConf = compassIndex.spot.prediction5mConf; // 40–92
        const cpF = cp5m === 'STRONG_BUY' ? 2 : cp5m === 'BUY' ? 1
                  : cp5m === 'STRONG_SELL' ? -2 : cp5m === 'SELL' ? -1 : 0;
        if (cpF > 0) p5Buy += cpF; else if (cpF < 0) p5Sell += Math.abs(cpF);
        p5ConfSum += cp5mConf; p5N++;
      }

      // F9 (S17): OI Momentum 5-min signal (LONG_BUILDUP / SHORT_BUILDUP / etc.)
      if (oiData) {
        const oi5mSig = (oiData.signal_5m ?? '').toUpperCase();
        const oiConf5 = Math.max(20, Math.min(95, oiData.confidence));
        const oiF = oi5mSig === 'LONG_BUILDUP'  ?  2
                  : oi5mSig === 'SHORT_COVERING' ?  1
                  : oi5mSig === 'SHORT_BUILDUP'  ? -2
                  : oi5mSig === 'LONG_UNWINDING' ? -1 : 0;
        if (oiF > 0) p5Buy += oiF; else if (oiF < 0) p5Sell += Math.abs(oiF);
        p5ConfSum += oiConf5; p5N++;
      }

      // ── TIER 2: Structural / slower-moving confirms ──

      // F10 (S1): Trade Zones — trend alignment across 5min + 15min
      const f10 = trend5min.includes('UP') && trend15min.includes('UP') ? 2
                : trend5min.includes('UP') ? 1
                : trend5min.includes('DOWN') && trend15min.includes('DOWN') ? -2
                : trend5min.includes('DOWN') ? -1 : 0;
      if (f10 > 0) p5Buy += f10; else if (f10 < 0) p5Sell += Math.abs(f10);
      p5ConfSum += (trend5min.includes('UP') || trend5min.includes('DOWN')) ? 72 : 48; p5N++;

      // F11 (S2): Smart Money — BOS / FVG institutional positioning
      const f11 = (smBullish && !smBearish) ? 1 : (!smBullish && smBearish) ? -1 : 0;
      if (f11 > 0) p5Buy += f11; else if (f11 < 0) p5Sell += Math.abs(f11);
      p5ConfSum += Math.min(90, 50 + smFlowStrength * 0.4); p5N++;

      // F12 (S3): High Volume Candle conviction
      const f12 = isVeryGoodVolume && candleClose > candleOpen ?  2
                : isVeryGoodVolume && candleClose < candleOpen ? -2
                : isFakeSpike && candleClose > candleOpen      ? -1
                : isFakeSpike && candleClose < candleOpen      ?  1 : 0;
      if (f12 > 0) p5Buy += f12; else if (f12 < 0) p5Sell += Math.abs(f12);
      p5ConfSum += (isVeryGoodVolume || isFakeSpike) ? 82 : 50; p5N++;

      // F13 (S4): Intraday AI signal + VWAP/EMA confirmation
      const f13 = (aiSignal.includes('BUY') && price > vwap)  ?  1
                : (aiSignal.includes('SELL') && price < vwap) ? -1 : 0;
      if (f13 > 0) p5Buy += f13; else if (f13 < 0) p5Sell += Math.abs(f13);
      p5ConfSum += aiSignal !== '' ? Math.round(aiConfidence * 100) : 50; p5N++;

      // F14 (S5): VWMA 20 — price above/below institutional MA
      if (vwma20 > 0) {
        const f14 = price > vwma20 ? 1 : -1;
        if (f14 > 0) p5Buy += f14; else p5Sell += Math.abs(f14);
        p5ConfSum += 68; p5N++;
      }

      // F15 (S6): Camarilla — CPR zone bias
      const camBull = (cprTC > 0 && price > cprTC) || (camarillaR3 > 0 && price > camarillaR3);
      const camBear = (cprBC > 0 && price < cprBC) || (camarillaS3 > 0 && price < camarillaS3);
      const f15 = camBull ? 1 : camBear ? -1 : 0;
      if (f15 > 0) p5Buy += f15; else if (f15 < 0) p5Sell += Math.abs(f15);
      p5ConfSum += (camBull || camBear) ? Math.max(50, camarillaConfidence - 5) : 48; p5N++;

      // F16 (S11): Pivot Points — classic S/R zones
      const pivotBull = (pivotR1 > 0 && price > pivotR1);
      const pivotBear = (pivotS1 > 0 && price < pivotS1);
      const f16 = pivotBull ? 1 : pivotBear ? -1 : 0;
      if (f16 > 0) p5Buy += f16; else if (f16 < 0) p5Sell += Math.abs(f16);
      p5ConfSum += (pivotBull || pivotBear) ? 70 : 50; p5N++;

      // F17 (S14): Trend Base — higher-high / higher-low structure
      const f17 = marketStructure.includes('HIGHER_HIGH') || swingPattern.includes('HIGHER_LOW') ?  1
                : marketStructure.includes('LOWER_LOW')   || swingPattern.includes('LOWER_HIGH') ? -1 : 0;
      if (f17 > 0) p5Buy += f17; else if (f17 < 0) p5Sell += Math.abs(f17);
      p5ConfSum += f17 !== 0 ? Math.min(85, structureConfidence) : 50; p5N++;

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
      NIFTY:     calculateAggregatedSignal(analyses?.NIFTY,     marketData.NIFTY,     'NIFTY',     liquidityData.NIFTY     ?? null, compassData.NIFTY     ?? null, oiNifty     ?? null),
      BANKNIFTY: calculateAggregatedSignal(analyses?.BANKNIFTY, marketData.BANKNIFTY, 'BANKNIFTY', liquidityData.BANKNIFTY ?? null, compassData.BANKNIFTY ?? null, oiBankNifty ?? null),
      SENSEX:    calculateAggregatedSignal(analyses?.SENSEX,    marketData.SENSEX,    'SENSEX',    liquidityData.SENSEX    ?? null, compassData.SENSEX    ?? null, oiSensex    ?? null),
    };
  }, [analyses, marketData, liquidityData, compassData, oiNifty, oiBankNifty, oiSensex]);

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
          <div className="px-4 sm:px-5 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3 bg-white/[0.015] border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <span className="w-[3px] h-5 rounded-full bg-gradient-to-b from-teal-300 to-teal-600 shadow-[0_0_8px_2px] shadow-teal-500/40" />
              <span className="text-xs sm:text-sm font-black text-white tracking-tight">Overall Market Outlook</span>
            </div>
            <IndiaVIXBadge
              value={vixData.value}
              changePercent={vixData.changePercent}
              volatilityLevel={vixData.volatilityLevel}
              marketFearScore={vixData.marketFearScore}
              loading={vixLoading}
            />
            <div className="flex items-center gap-2 ml-auto">
              <span className="hidden sm:inline text-[9px] text-white/60 font-bold">15 Signals</span>
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

                  {/* 15 Signals Confidence */}
                  <div className="px-4 pt-3.5 pb-3 flex-1">
                    <div className="mb-2.5">
                      <span className="text-[10px] font-bold text-white/40 uppercase tracking-[0.15em]">15 Signals</span>
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

        {/* ⚡ PURE LIQUIDITY INTELLIGENCE */}
        <LiquidityIntelligence />

        {/* 🥇 MARKET POSITIONING INTELLIGENCE */}
        <MarketPositioningCard liveData={marketData} />

        {/* Volume Pulse Section */}
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

        {/* 🧭 INSTITUTIONAL MARKET COMPASS */}
        <InstitutionalCompass />

        {/* 🔮 OI MOMENTUM - Pure Data Buy/Sell Signals */}
        <div className="mt-4 sm:mt-6 border-2 border-purple-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-purple-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-purple-500/10">
          {/* Section Header */}
          <div className="flex flex-col gap-2 mb-3 sm:mb-4">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-purple-400 to-purple-500 rounded-full shadow-lg shadow-purple-500/30" />
              <h2 className="text-base sm:text-xl lg:text-2xl font-bold text-dark-text tracking-tight whitespace-nowrap">
                OI Momentum Signals
              </h2>
            </div>
            
            {/* Strategy Info - Compact */}
            <div className="ml-4 sm:ml-5 p-2 sm:p-3 bg-slate-900/40 rounded-lg border border-slate-700/30">
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[9px] sm:text-xs">
                <span className="px-2 py-1 bg-purple-500/20 border border-purple-500/30 rounded-md text-purple-200 font-bold">
                  5m Entry Timing
                </span>
                <span className="text-slate-600">+</span>
                <span className="px-2 py-1 bg-indigo-500/20 border border-indigo-500/30 rounded-md text-indigo-200 font-bold">
                  15m Trend Direction
                </span>
                <span className="text-slate-600">=</span>
                <span className="px-2 py-1 bg-emerald-500/20 border border-emerald-500/30 rounded-md text-emerald-200 font-bold">
                  Final Signal
                </span>
              </div>
            </div>
          </div>
          
          {/* OI Momentum Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-3">
            <OIMomentumCard 
              symbol="NIFTY" 
              name="NIFTY 50" 
              livePrice={marketData.NIFTY?.price}
              liveChangePct={marketData.NIFTY?.changePercent}
              marketStatus={marketStatus}
            />
            <OIMomentumCard 
              symbol="BANKNIFTY" 
              name="BANK NIFTY"
              livePrice={marketData.BANKNIFTY?.price}
              liveChangePct={marketData.BANKNIFTY?.changePercent}
              marketStatus={marketStatus}
            />
            <OIMomentumCard 
              symbol="SENSEX" 
              name="SENSEX"
              livePrice={marketData.SENSEX?.price}
              liveChangePct={marketData.SENSEX?.changePercent}
              marketStatus={marketStatus}
            />
          </div>
        </div>

        {/* 🎯 TRADE ZONES – Buy/Sell Signals (Multi-factor, dual timeframe) */}
        <div className="mt-6 sm:mt-6 border-2 border-emerald-600/40 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-xl shadow-emerald-600/15">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 sm:mb-4">
            <div>
              <h2 className="text-lg sm:text-xl lg:text-2xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
                <span className="w-1.5 h-6 sm:h-7 bg-gradient-to-b from-emerald-400 to-emerald-500 rounded-full shadow-lg shadow-emerald-500/40" />
                Trade Zones • Buy/Sell Signals
              </h2>
              <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 sm:ml-5 font-medium tracking-wide">
                5min Entry + 15min Trend • 8-Factor Scoring • Live Confidence • 5 Min Prediction
              </p>
            </div>
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
            <InstitutionalMarketView symbol="NIFTY" marketStatus={marketStatus} livePrice={marketData.NIFTY?.price} />
            <InstitutionalMarketView symbol="BANKNIFTY" marketStatus={marketStatus} livePrice={marketData.BANKNIFTY?.price} />
            <InstitutionalMarketView symbol="SENSEX" marketStatus={marketStatus} livePrice={marketData.SENSEX?.price} />
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
            <CandleQualityAnalysis symbol="NIFTY" />
            <CandleQualityAnalysis symbol="BANKNIFTY" />
            <CandleQualityAnalysis symbol="SENSEX" />
          </div>
        </div>

      {/* Trading Sections Container */}
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        {/* VWMA 20 • Entry Filter Section */}
        <div className="mt-6 sm:mt-6">
          {/* Section Header */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight px-2 sm:px-0">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full shadow-lg shadow-blue-500/30" />
                VWMA 20 • Entry Filter
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide px-2 sm:px-0">
              Volume-weighted moving average • Institutional reference level • Professional entry signals
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <VWMAEMAFilterCard analysis={analyses?.NIFTY || null} marketStatus={marketStatus as any} symbol="NIFTY" />
            <VWMAEMAFilterCard analysis={analyses?.BANKNIFTY || null} marketStatus={marketStatus as any} symbol="BANKNIFTY" />
            <VWMAEMAFilterCard analysis={analyses?.SENSEX || null} marketStatus={marketStatus as any} symbol="SENSEX" />
          </div>
        </div>

        {/* Camarilla R3/S3 + CPR Section */}
        <div className="mt-6 sm:mt-6">
          {/* Section Header */}
          <div className="flex flex-col gap-3 mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight px-2 sm:px-0">
                <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-purple-500 to-purple-600 rounded-full shadow-lg shadow-purple-500/30" />
                Camarilla R3/S3 • CPR Zones
              </h3>
            </div>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide px-2 sm:px-0">
              Central Pivot Range • Institutional-level support/resistance • Professional zone signals
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => {
              // Calculate Camarilla status for this card
              const camarillaZone = item.data?.indicators?.camarilla_zone;
              const camarillaSignal = item.data?.indicators?.camarilla_signal;
              const camarillaConfidence = Math.round(item.data?.indicators?.camarilla_confidence || 50);
              const trendDaySignal = item.data?.indicators?.trend_day_signal;
              
              let statusLabel = '⚪ NEUTRAL';
              let statusColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
              let badgeEmoji = '⚪';
              
              if ((camarillaZone === 'ABOVE_TC' && camarillaSignal?.includes('R3_BREAKOUT')) && 
                  camarillaConfidence >= 75 && trendDaySignal?.includes('BULLISH')) {
                statusLabel = '🚀 STRONG BUY';
                statusColor = 'bg-green-500/20 border-green-500/50 text-green-300';
                badgeEmoji = '🚀';
              } else if ((camarillaZone === 'ABOVE_TC' && camarillaSignal?.includes('R3_BREAKOUT')) && camarillaConfidence >= 80) {
                statusLabel = '🚀 STRONG BUY';
                statusColor = 'bg-green-500/20 border-green-500/50 text-green-300';
                badgeEmoji = '🚀';
              } else if ((camarillaZone === 'ABOVE_TC' || camarillaSignal?.includes('R3_BREAKOUT')) && camarillaConfidence >= 65) {
                statusLabel = '📈 BUY';
                statusColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
                badgeEmoji = '📈';
              } else if (camarillaZone === 'BELOW_BC' && camarillaConfidence >= 65) {
                statusLabel = '📉 SELL';
                statusColor = 'bg-red-500/20 border-red-500/40 text-red-300';
                badgeEmoji = '📉';
              }
              
              const isBuyCam = statusLabel.includes('BUY');
              const isSellCam = statusLabel.includes('SELL');
              const camAccentBorder = isBuyCam ? 'border-teal-500/30' : isSellCam ? 'border-rose-500/25' : 'border-amber-500/25';
              const camAccentText = isBuyCam ? 'text-teal-300' : isSellCam ? 'text-rose-300' : 'text-amber-300';
              const camAccentBar = isBuyCam ? 'bg-teal-500' : isSellCam ? 'bg-rose-500' : 'bg-amber-500';
              const camSignalLabel = isBuyCam ? (statusLabel.includes('STRONG') ? '▲ STRONG BUY' : '▲ BUY') : isSellCam ? '▼ SELL' : '◆ NEUTRAL';

              return (
                <div key={`camarilla_${item.symbol}`} className={`relative rounded-2xl overflow-hidden border ${camAccentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>
                  {/* Top shimmer */}
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                  {/* Corner glow */}
                  <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[7%] ${camAccentBar} pointer-events-none`} />

                  {/* HEADER */}
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{item.symbol}</span>
                      {(item.data?.status || marketStatus) === 'LIVE' && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/25">
                          <span className="w-1 h-1 rounded-full bg-teal-400 animate-pulse" />
                          <span className="text-[9px] text-teal-300 font-bold">LIVE</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-white/30 font-medium">CAMARILLA • CPR</span>
                  </div>

                  {/* REFLECTOR SIGNAL PANEL */}
                  <div className="mx-3 mb-3 rounded-xl bg-[#0d1117]/80 border border-white/[0.05] overflow-hidden">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className={`text-xl font-black tracking-tight ${camAccentText}`}>{camSignalLabel}</div>
                        <div className="text-[10px] text-white/40 mt-0.5">
                          {camarillaZone?.replace(/_/g, ' ') || 'Loading zone...'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-white/40 mb-0.5">CONFIDENCE</div>
                        <div className={`text-2xl font-black ${camAccentText}`}>{camarillaConfidence}%</div>
                      </div>
                    </div>
                    <div className="mx-4 mb-3 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${camAccentBar}`} style={{ width: `${camarillaConfidence}%` }} />
                    </div>
                  </div>

                  {/* CONFERENCE GRID — 2×2 */}
                  <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Zone</div>
                      <div className={`text-sm font-bold ${isBuyCam ? 'text-teal-300' : isSellCam ? 'text-rose-300' : 'text-amber-300'}`}>
                        {camarillaZone?.replace(/_/g, ' ') || '—'}
                      </div>
                      <div className="text-[9px] text-white/30 mt-0.5">Cam level</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">CPR Type</div>
                      <div className={`text-sm font-bold ${item.data?.indicators?.cpr_classification === 'NARROW' ? 'text-teal-300' : 'text-amber-300'}`}>
                        {item.data?.indicators?.cpr_classification || '—'}
                      </div>
                      <div className="text-[9px] text-white/30 mt-0.5">{item.data?.indicators?.cpr_width_pct?.toFixed(3)}%</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">TC / BC</div>
                      <div className="text-sm font-bold text-teal-300">₹{item.data?.indicators?.cpr_top_central}</div>
                      <div className="text-[9px] text-rose-300 mt-0.5">₹{item.data?.indicators?.cpr_bottom_central}</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Pivot</div>
                      <div className="text-sm font-bold text-amber-300">₹{item.data?.indicators?.cpr_pivot}</div>
                      <div className={`text-[9px] mt-0.5 ${isBuyCam ? 'text-teal-300' : isSellCam ? 'text-rose-300' : 'text-white/35'}`}>
                        Price: ₹{item.data?.indicators?.price}
                      </div>
                    </div>
                  </div>

                  {/* ══════════════════════════════════════════════════════════
                      5 MIN PREDICTION
                  ══════════════════════════════════════════════════════════ */}
                  <div className="mx-3 mb-3 rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    <div className="p-4 space-y-3">
                      {(() => {
                        // ── Multi-factor Camarilla confidence ──────────────────────
                        const trendDayConf   = item.data?.indicators?.trend_day_confidence ?? 0;
                        const trendDaySig    = (item.data?.indicators?.trend_day_signal ?? '').toUpperCase();
                        const cprClass       = (item.data?.indicators?.cpr_classification ?? '').toUpperCase();
                        const camSig         = (camarillaSignal ?? '').toUpperCase();
                        const camZone        = (camarillaZone ?? '').toUpperCase();

                        // Zone confirms direction
                        const zoneConfirms   = (isBuyCam && camZone.includes('ABOVE')) || (isSellCam && camZone.includes('BELOW'));
                        const zoneConflicts  = (isBuyCam && camZone.includes('BELOW')) || (isSellCam && camZone.includes('ABOVE'));

                        // Cam gate breakout confirms
                        const gateBreak      = (isBuyCam && (camSig.includes('R3') || camSig.includes('BREAK'))) ||
                                               (isSellCam && (camSig.includes('S3') || camSig.includes('BREAK') || camSig.includes('DOWN')));

                        // Trend-day signal aligns
                        const trendDayAligns = (isBuyCam && trendDaySig.includes('BULL')) ||
                                               (isSellCam && trendDaySig.includes('BEAR'));
                        const trendDayOpp    = (isBuyCam && trendDaySig.includes('BEAR')) ||
                                               (isSellCam && trendDaySig.includes('BULL'));

                        // CPR width
                        const cprNarrow      = cprClass === 'NARROW';
                        const cprWide        = cprClass === 'WIDE';

                        // Confidence adjustment
                        let adjConf = camarillaConfidence;
                        if (zoneConflicts) {
                          adjConf = Math.round(adjConf * 0.82);
                        } else {
                          const cnt = [zoneConfirms, gateBreak, trendDayAligns, cprNarrow].filter(Boolean).length;
                          if (cnt >= 3)      adjConf = Math.round(adjConf * 1.10);
                          else if (cnt === 2) adjConf = Math.round(adjConf * 1.06);
                          else if (cnt === 1) adjConf = Math.round(adjConf * 1.03);
                        }
                        if (trendDayOpp) adjConf = Math.round(adjConf * 0.90);
                        if (cprWide)     adjConf = Math.round(adjConf * 0.94);
                        if (marketStatus !== 'LIVE') adjConf = Math.round(Math.max(30, adjConf * 0.88));
                        adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

                        // Actual market confidence from structural alignment
                        const actualMarketConf = Math.round(
                          Math.min(95, Math.max(30,
                            (zoneConfirms ? 30 : 15) +
                            (gateBreak ? 25 : 10) +
                            (trendDayAligns ? 20 : 0) +
                            (cprNarrow ? 15 : cprWide ? -10 : 5)
                          ))
                        );

                        // Direction
                        const predDir   = isBuyCam ? 'LONG' : isSellCam ? 'SHORT' : 'FLAT';
                        const dirIcon   = isBuyCam ? '▲' : isSellCam ? '▼' : '─';
                        const dirColor  = isBuyCam ? 'text-teal-300'  : isSellCam ? 'text-rose-300'  : 'text-amber-300';
                        const dirBorder = isBuyCam ? 'border-teal-500/40' : isSellCam ? 'border-rose-500/35' : 'border-amber-500/30';
                        const dirBg     = isBuyCam ? 'bg-teal-500/[0.07]' : isSellCam ? 'bg-rose-500/[0.07]' : 'bg-amber-500/[0.05]';
                        const barColor  = isBuyCam ? 'bg-teal-500' : isSellCam ? 'bg-rose-500' : 'bg-amber-500';

                        // Context note
                        const confirms = [
                          zoneConfirms   && 'Zone',
                          gateBreak      && (isBuyCam ? 'R3 break' : 'S3 break'),
                          trendDayAligns && 'Trend Day',
                          cprNarrow      && 'Narrow CPR',
                        ].filter(Boolean) as string[];
                        const ctxNote = zoneConflicts
                          ? '⚠ Zone vs signal conflict'
                          : confirms.length >= 2 ? `${confirms.slice(0, 2).join(' + ')} confirm`
                          : confirms.length === 1 ? `${confirms[0]} confirms`
                          : 'Watching CPR levels…';

                        return (
                          <>
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-widest">5 Min Prediction</span>
                              <span className={`text-[10px] font-bold tabular-nums px-2 py-1 rounded ${
                                isBuyCam ? 'bg-teal-500/25 text-teal-300' :
                                isSellCam ? 'bg-rose-500/25 text-rose-300' :
                                'bg-amber-500/15 text-amber-300'
                              }`}>
                                {adjConf}% CONFIDENCE
                              </span>
                            </div>

                            {/* Dual Confidence Display */}
                            <div className="grid grid-cols-2 gap-2">
                              <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">CONFIDENCE</span>
                                <span className="text-[13px] font-black text-emerald-300 tabular-nums mt-0.5">{adjConf}%</span>
                                <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
                                  <div
                                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700 rounded-full"
                                    style={{ width: `${Math.min(100, adjConf)}%` }}
                                  />
                                </div>
                              </div>

                              <div className="flex flex-col bg-gray-900/50 rounded-lg px-2 py-1.5 border border-gray-700/30">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Actual Market</span>
                                <span className="text-[13px] font-black text-teal-300 tabular-nums mt-0.5">{actualMarketConf}%</span>
                                <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden mt-1">
                                  <div
                                    className="h-full bg-gradient-to-r from-teal-500 to-teal-400 transition-all duration-700 rounded-full"
                                    style={{ width: `${Math.min(100, actualMarketConf)}%` }}
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Direction + CPR Status */}
                            <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className={`text-sm font-black ${dirColor}`}>
                                  {dirIcon} {predDir}
                                </span>
                                <span className="text-[9px] text-gray-400 flex-1">{ctxNote}</span>
                                <span className={`text-sm font-black tabular-nums ${dirColor}`}>{adjConf}%</span>
                              </div>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/5">
                                <div
                                  className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                                  style={{ width: `${adjConf}%` }}
                                />
                              </div>
                            </div>

                            {/* CPR Zone Momentum Indicators */}
                            <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-2.5 border border-gray-700/20">
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Camarilla Gate</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  isBuyCam ? 'bg-teal-500/25 text-teal-300' :
                                  isSellCam ? 'bg-rose-500/25 text-rose-300' :
                                  'bg-gray-700/40 text-gray-400'
                                }`}>
                                  {isBuyCam ? '▲ R3 Break' : isSellCam ? '▼ S3 Break' : '─ Inside'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">CPR Classification</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  cprNarrow ? 'bg-teal-500/25 text-teal-300' :
                                  cprWide ? 'bg-rose-500/25 text-rose-300' :
                                  'bg-amber-500/15 text-amber-300'
                                }`}>
                                  {cprClass || '—'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Zone Status</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                  zoneConfirms ? 'bg-teal-500/25 text-teal-300' :
                                  zoneConflicts ? 'bg-rose-500/25 text-rose-300' :
                                  'bg-amber-500/15 text-amber-300'
                                }`}>
                                  {zoneConfirms ? '✓ Confirms' : zoneConflicts ? '⚠ Conflicts' : 'N/A'}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wide">Trend Day Alignment</span>
                                <span className={`text-[10px] font-bold tabular-nums px-2 py-0.5 rounded ${
                                  trendDayAligns ? 'bg-teal-500/25 text-teal-300' :
                                  trendDayOpp ? 'bg-rose-500/25 text-rose-300' :
                                  'bg-gray-700/40 text-gray-400'
                                }`}>
                                  {trendDayConf ? `${trendDayConf}%` : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Movement Probability Distribution */}
                            {(() => {
                              const camBull = isBuyCam ? Math.max(5, Math.min(95, adjConf)) : isSellCam ? Math.max(5, 100 - adjConf) : 50;
                              const camBear = 100 - camBull;
                              return (
                                <div className="space-y-2">
                                  <p className="text-[9px] font-bold text-gray-500 uppercase tracking-wide">Movement Probability</p>
                                  <div className="flex items-center h-6 rounded-md overflow-hidden bg-gray-950/50 border border-gray-700/30">
                                    <div
                                      className="h-full bg-gradient-to-r from-teal-600 to-teal-500 transition-all duration-700 flex items-center justify-center"
                                      style={{ width: `${camBull}%` }}
                                    >
                                      <span className="text-[8px] font-bold text-white tabular-nums px-1 truncate whitespace-nowrap">
                                        {camBull}%↑
                                      </span>
                                    </div>
                                    <div
                                      className="h-full bg-gradient-to-l from-rose-600 to-rose-500 transition-all duration-700 flex items-center justify-center"
                                      style={{ width: `${camBear}%` }}
                                    >
                                      <span className="text-[8px] font-bold text-white tabular-nums px-1 truncate whitespace-nowrap">
                                        {camBear}%↓
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Early Signal Detection */}
                            <div className={`min-h-[24px] pt-2 border-t border-gray-700/20 ${(adjConf >= 75 || ([zoneConfirms, gateBreak, trendDayAligns, cprNarrow].filter(Boolean).length >= 3)) ? '' : 'invisible'}`}>
                              <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wide">
                                ⚡ {adjConf >= 85 ? 'STRONG' : 'CONFIRMED'} CPR Zone Signal Ready
                              </span>
                            </div>

                            {/* CPR Confirmation Summary */}
                            <div className="rounded-lg bg-gray-900/20 px-2.5 py-2 border border-gray-700/20">
                              <p className="text-[9px] text-gray-500 font-bold uppercase tracking-wide mb-1">Confirmations</p>
                              <div className="flex flex-wrap gap-1">
                                {confirms.length > 0 ? (
                                  confirms.map((confirm) => (
                                    <span key={confirm} className="text-[8px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">
                                      ✓ {confirm}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[8px] text-gray-500">Monitoring CPR structure…</span>
                                )}
                              </div>
                            </div>

                            {/* Summary line */}
                            <div className={`text-center text-[10px] font-bold tabular-nums rounded-lg py-1.5 border ${
                              isBuyCam ? 'bg-teal-500/10 border-teal-500/30 text-teal-300' :
                              isSellCam ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' :
                              'bg-amber-500/10 border-amber-500/20 text-amber-300'
                            }`}>
                              {predDir} · {adjConf}% Pred · {actualMarketConf}% Market · {confirms.length} Confirms
                            </div>
                          </>
                        );
                      })()}
                    </div>
                    <div className="h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                  </div>

                  {/* Bottom shimmer */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
                </div>
              );
            })}
          </div>
        </div>

        {/* RSI 60/40 Momentum - Simple & Clean Layman Trading Signals */}
        <div className="mt-6 sm:mt-6 px-0">
          {/* Section Header - Minimal & Professional */}
          <div className="px-2 sm:px-0 mb-4">
            <h2 className="text-lg sm:text-xl font-black text-white flex items-center gap-2 tracking-tight">
              <span className="w-1.5 h-6 bg-gradient-to-b from-blue-500 to-blue-600 rounded-full shadow-lg shadow-blue-500/40" />
              RSI 60/40 Momentum
            </h2>
            <p className="text-dark-tertiary text-xs sm:text-sm mt-1.5 ml-4 font-medium tracking-wide">
              Oversold/Overbought Entry Signals • 5-Min Entry + 15-Min Trend • Confidence-Based Trading
            </p>
          </div>

          {/* Three Cards Grid - NIFTY, BANKNIFTY, SENSEX */}
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
            {[
              { symbol: 'NIFTY', data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX', data: analyses?.SENSEX }
            ].map((item) => {
              const rsi = item.data?.indicators?.rsi || 50;
              const rsiZone = item.data?.indicators?.rsi_zone || 'NEUTRAL';
              const rsiSignal = item.data?.indicators?.rsi_signal || 'WATCH';
              const rsiAction = item.data?.indicators?.rsi_action || '';
              const momentum = item.data?.indicators?.momentum || 50;
              const volumeRatio = item.data?.indicators?.volume_ratio || 1.0;
              
              // Map backend rsi_signal to simple UI signals
              let uiSignal = 'NEUTRAL';
              let badgeEmoji = '⚪';
              let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
              let confidence = 50;
              
              if (rsiSignal === 'MOMENTUM_BUY' || rsiSignal === 'PULLBACK_BUY') {
                uiSignal = 'BUY';
                badgeEmoji = '📈';
                signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
                confidence = 75;
              } else if (rsiSignal === 'REJECTION_SHORT' || rsiSignal === 'BREAKDOWN_SELL' || rsiSignal === 'DOWNTREND_STRONG') {
                uiSignal = 'SELL';
                badgeEmoji = '📉';
                signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
                confidence = 75;
              } else if (rsi > 70 && (rsiSignal === 'MOMENTUM_BUY' || rsiZone === '60_ABOVE')) {
                uiSignal = 'STRONG BUY';
                badgeEmoji = '🚀';
                signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
                confidence = 85;
              } else if (rsi < 30 && (rsiSignal === 'REJECTION_SHORT' || rsiZone === '40_BELOW')) {
                uiSignal = 'STRONG SELL';
                badgeEmoji = '🔴';
                signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
                confidence = 85;
              } else {
                uiSignal = 'NEUTRAL';
                badgeEmoji = '⚪';
                confidence = 50;
              }
              
              const isBuyRsi  = uiSignal === 'BUY' || uiSignal === 'STRONG BUY';
              const isSellRsi = uiSignal === 'SELL' || uiSignal === 'STRONG SELL';

              // ── Continuous confidence: RSI deviation from threshold ──────────────
              // Replaces the hard-coded 50/75/85 tiers.
              // BUY zone: deviation = RSI − 60 (0 at boundary → +to-right grows)
              // SELL zone: deviation = 40 − RSI (0 at boundary → grows deeper)
              // dev=0 (RSI=60/40)  → 52%  |  dev=5 (65/35) → 62%
              // dev=10 (70/30)     → 71%  |  dev=15 (75/25) → 81%
              // dev=20 (80/20)     → 90%  (cap)
              {
                const _rsiDev = isBuyRsi
                  ? Math.max(0, rsi - 60)
                  : isSellRsi ? Math.max(0, 40 - rsi) : 0;
                confidence = (isBuyRsi || isSellRsi)
                  ? Math.min(90, Math.round(52 + _rsiDev * 1.9))
                  : 33;  // NEUTRAL: low base

                // Momentum multiplier — direction-aware, proportional
                const _momOpp  = (isBuyRsi && momentum < 40) || (isSellRsi && momentum > 60);
                const _momConf = (isBuyRsi && momentum > 60) || (isSellRsi && momentum < 40);
                confidence = Math.round(confidence * (_momOpp ? 0.91 : _momConf ? 1.07 : 1.0));

                // Volume multiplier — proportional, no flat cliffs
                confidence = Math.round(confidence * (volumeRatio >= 1.3 ? 1.05 : volumeRatio < 0.85 ? 0.94 : 1.0));
                confidence = Math.min(95, Math.max(30, confidence));
              }
              const rsiAccentBorder = isBuyRsi ? 'border-teal-500/30' : isSellRsi ? 'border-rose-500/25' : 'border-amber-500/25';
              const rsiAccentText = isBuyRsi ? 'text-teal-300' : isSellRsi ? 'text-rose-300' : 'text-amber-300';
              const rsiAccentBar = isBuyRsi ? 'bg-teal-500' : isSellRsi ? 'bg-rose-500' : 'bg-amber-500';
              const rsiSignalLabel = isBuyRsi ? (uiSignal === 'STRONG BUY' ? '▲ STRONG BUY' : '▲ BUY') : isSellRsi ? (uiSignal === 'STRONG SELL' ? '▼ STRONG SELL' : '▼ SELL') : '◆ NEUTRAL';

              return (
                <div key={item.symbol} className={`relative rounded-2xl overflow-hidden border ${rsiAccentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>
                  {/* Top shimmer */}
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                  {/* Corner glow */}
                  <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[7%] ${rsiAccentBar} pointer-events-none`} />

                  {/* HEADER */}
                  <div className="flex items-center justify-between px-4 pt-4 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{item.symbol}</span>
                      {(item.data?.status || marketStatus) === 'LIVE' && (
                        <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/25">
                          <span className="w-1 h-1 rounded-full bg-teal-400 animate-pulse" />
                          <span className="text-[9px] text-teal-300 font-bold">LIVE</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] text-white/30 font-medium">RSI 60/40</span>
                  </div>

                  {/* REFLECTOR SIGNAL PANEL */}
                  <div className="mx-3 mb-3 rounded-xl bg-[#0d1117]/80 border border-white/[0.05] overflow-hidden">
                    <div className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <div className={`text-xl font-black tracking-tight ${rsiAccentText}`}>{rsiSignalLabel}</div>
                        <div className="text-[10px] text-white/40 mt-0.5">
                          RSI {Math.round(rsi)} • {rsiZone?.replace(/_/g, '-') || 'Loading...'}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-white/40 mb-0.5">CONFIDENCE</div>
                        <div className={`text-2xl font-black ${rsiAccentText}`}>{confidence}%</div>
                      </div>
                    </div>
                    <div className="mx-4 mb-3 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-700 ${rsiAccentBar}`} style={{ width: `${confidence}%` }} />
                    </div>
                  </div>

                  {/* CONFERENCE GRID — 2×2 */}
                  <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">RSI Value</div>
                      <div className={`text-sm font-bold ${rsi >= 60 ? 'text-teal-300' : rsi <= 40 ? 'text-rose-300' : 'text-amber-300'}`}>{Math.round(rsi)}</div>
                      <div className="text-[9px] text-white/30 mt-0.5">{rsi >= 60 ? 'Overbought zone' : rsi <= 40 ? 'Oversold zone' : 'Neutral zone'}</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Zone</div>
                      <div className={`text-sm font-bold truncate ${rsiAccentText}`}>{rsiZone?.replace(/_/g, '-') || '—'}</div>
                      <div className="text-[9px] text-white/30 mt-0.5">RSI band</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Momentum</div>
                      <div className={`text-sm font-bold ${momentum >= 60 ? 'text-teal-300' : momentum <= 40 ? 'text-rose-300' : 'text-amber-300'}`}>{Math.round(momentum)}</div>
                      <div className="text-[9px] text-white/30 mt-0.5">Price pressure</div>
                    </div>
                    <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                      <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Vol Ratio</div>
                      <div className={`text-sm font-bold ${volumeRatio >= 1.3 ? 'text-teal-300' : volumeRatio < 0.9 ? 'text-rose-300' : 'text-amber-300'}`}>{volumeRatio.toFixed(2)}x</div>
                      <div className="text-[9px] text-white/30 mt-0.5">Avg volume</div>
                    </div>
                  </div>

                  {/* 5-MIN PREDICTION */}
                  <div className="mx-3 mb-3 rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
                    <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    {(() => {
                      // ── ENHANCED Multi-factor RSI 60/40 confidence engine ────────────
                      const rsiSigUp   = rsiSignal === 'MOMENTUM_BUY';   // strongest bull signal
                      const rsiSigDown = rsiSignal === 'DOWNTREND_STRONG'; // strongest bear signal
                      const rsiZoneUp  = rsiZone === '60_ABOVE' || rsiZone === '60_STRONG';
                      const rsiZoneDown= rsiZone === '40_BELOW' || rsiZone === '40_STRONG';
                      const rsiExtreme = (isBuyRsi && rsi > 65) || (isSellRsi && rsi < 35);
                      const rsiVeryExt = (isBuyRsi && rsi > 70) || (isSellRsi && rsi < 30);
                      const momConfirms= (isBuyRsi && momentum > 60) || (isSellRsi && momentum < 40);
                      const momOpposes = (isBuyRsi && momentum < 40) || (isSellRsi && momentum > 60);
                      const volStrong  = volumeRatio >= 1.3;
                      const volWeak    = volumeRatio < 0.85;
                      const nearBoundary = (isBuyRsi && rsi < 55) || (isSellRsi && rsi > 45);

                      // Proportional multiplier chain — no flat ± cliffs
                      let adjConf = confidence;
                      if (momOpposes) {
                        adjConf = Math.round(adjConf * 0.88);
                      } else {
                        const cnt = [
                          rsiExtreme || rsiVeryExt,
                          momConfirms,
                          volStrong,
                        ].filter(Boolean).length;
                        if (cnt >= 3)      adjConf = Math.round(adjConf * 1.08);
                        else if (cnt === 2) adjConf = Math.round(adjConf * 1.05);
                        else if (cnt === 1) adjConf = Math.round(adjConf * 1.03);
                      }
                      if (nearBoundary) adjConf = Math.round(adjConf * 0.92);
                      if (volWeak)      adjConf = Math.round(adjConf * 0.94);
                      if (marketStatus !== 'LIVE') adjConf = Math.round(Math.max(30, adjConf * 0.88));
                      adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

                      // ── ACTUAL MARKET CONFIDENCE (independent calculation) ──
                      // Base from RSI zone + momentum alignment + volume confirmation
                      let actualMarketConf = 50;
                      if (isBuyRsi) {
                        actualMarketConf = Math.min(95, Math.max(30, (rsiExtreme ? 35 : 20) + (momConfirms ? 25 : 10) + (volStrong ? 15 : volWeak ? -10 : 5)));
                      } else if (isSellRsi) {
                        actualMarketConf = Math.min(95, Math.max(30, (rsiExtreme ? 35 : 20) + (momConfirms ? 25 : 10) + (volStrong ? 15 : volWeak ? -10 : 5)));
                      } else {
                        actualMarketConf = 33;
                      }

                      // Direction
                      const predDir   = isBuyRsi ? 'LONG' : isSellRsi ? 'SHORT' : 'FLAT';
                      const dirIcon   = isBuyRsi ? '▲' : isSellRsi ? '▼' : '─';
                      const dirColor  = isBuyRsi ? 'text-teal-300'  : isSellRsi ? 'text-rose-300'  : 'text-amber-300';
                      const dirBorder = isBuyRsi ? 'border-teal-500/40' : isSellRsi ? 'border-rose-500/35' : 'border-amber-500/30';
                      const dirBg     = isBuyRsi ? 'bg-teal-500/[0.07]' : isSellRsi ? 'bg-rose-500/[0.07]' : 'bg-amber-500/[0.05]';

                      // Movement probability distribution
                      const bullishProb = isBuyRsi ? Math.max(5, Math.min(95, adjConf)) : Math.max(5, Math.min(95, 50 - Math.abs(adjConf - 50)));
                      const bearishProb = 100 - bullishProb;

                      // Confirmations list
                      const confirms = [
                        rsiExtreme && `RSI ${Math.round(rsi)} extreme`,
                        momConfirms && 'Momentum confirms',
                        volStrong && 'Vol expanding',
                        rsiSigUp && 'Buy signal',
                        rsiSigDown && 'Sell signal',
                      ].filter(Boolean) as string[];

                      // Early signal detection
                      const multiFactorAlign = [rsiExtreme, momConfirms, volStrong].filter(Boolean).length >= 2;
                      const showEarlySignal = adjConf >= 75 || multiFactorAlign;
                      const earlySignalText = adjConf >= 85 ? `⚡ STRONG RSI ${predDir} Signal Ready` : `⚡ CONFIRMED RSI ${predDir} Signal Ready`;

                      return (
                        <div className="px-4 py-3 space-y-3">
                          {/* 1. HEADER */}
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-gray-400 uppercase">5 Min Prediction</span>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded ${isBuyRsi ? 'bg-teal-500/25 text-teal-300' : isSellRsi ? 'bg-rose-500/25 text-rose-300' : 'bg-amber-500/25 text-amber-300'}`}>
                              {adjConf}% CONFIDENCE
                            </span>
                          </div>

                          {/* 2. DUAL CONFIDENCE DISPLAY */}
                          <div className="grid grid-cols-2 gap-2">
                            {/* Predicted confidence */}
                            <div className="flex flex-col bg-gray-900/50 rounded-lg px-2.5 py-2 border border-gray-700/30">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">CONFIDENCE</span>
                              <span className={`text-[13px] font-black ${dirColor}`}>{adjConf}%</span>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full rounded-full transition-all duration-500 ${rsiAccentBar}`} style={{ width: `${adjConf}%` }} />
                              </div>
                            </div>

                            {/* Actual Market confidence */}
                            <div className="flex flex-col bg-gray-900/50 rounded-lg px-2.5 py-2 border border-gray-700/30">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">Actual Market</span>
                              <span className={`text-[13px] font-black ${isBuyRsi ? 'text-teal-400' : isSellRsi ? 'text-rose-400' : 'text-amber-400'}`}>{actualMarketConf}%</span>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-1.5">
                                <div className={`h-full rounded-full transition-all duration-500 ${isBuyRsi ? 'bg-teal-500' : isSellRsi ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${actualMarketConf}%` }} />
                              </div>
                            </div>
                          </div>

                          {/* 3. DIRECTION + STATUS */}
                          <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                            <div className="flex items-center justify-between">
                              <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                              <span className="text-[9px] text-gray-400">{momOpposes ? '⚠ Divergence' : nearBoundary ? '⚠ Boundary risk' : 'Zone aligned'}</span>
                              <span className={`text-sm font-black ${dirColor}`}>{adjConf}%</span>
                            </div>
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/5 mt-2">
                              <div className={`h-full rounded-full transition-all duration-500 bg-gradient-to-r ${isBuyRsi ? 'from-teal-500 to-teal-400' : isSellRsi ? 'from-rose-500 to-rose-400' : 'from-amber-500 to-amber-400'}`} style={{ width: `${adjConf}%` }} />
                            </div>
                          </div>

                          {/* 4. RSI MOMENTUM INDICATORS (4-row grid) */}
                          <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-3 border border-gray-700/20">
                            {/* RSI Status */}
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">RSI Status</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${rsiExtreme ? (isBuyRsi ? 'bg-teal-500/25 text-teal-300' : 'bg-rose-500/25 text-rose-300') : 'bg-gray-700/30 text-gray-300'}`}>
                                {rsiVeryExt ? 'VERY EXTREME' : rsiExtreme ? 'EXTREME' : nearBoundary ? 'BOUNDARY' : 'NORMAL'}
                              </span>
                            </div>

                            {/* RSI Zone Classification */}
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">RSI Zone</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${rsi >= 60 ? 'bg-teal-500/25 text-teal-300' : rsi <= 40 ? 'bg-rose-500/25 text-rose-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                {Math.round(rsi)} {rsi >= 60 ? 'Overbought' : rsi <= 40 ? 'Oversold' : 'Neutral'}
                              </span>
                            </div>

                            {/* Momentum Alignment */}
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">Momentum</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${momConfirms ? (isBuyRsi ? 'bg-teal-500/25 text-teal-300' : 'bg-rose-500/25 text-rose-300') : momOpposes ? 'bg-red-500/25 text-red-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                {momConfirms ? 'Confirms' : momOpposes ? 'Diverges' : 'Mixed'} ({Math.round(momentum)}%)
                              </span>
                            </div>

                            {/* Volume Status */}
                            <div className="flex items-center justify-between">
                              <span className="text-[9px] text-gray-500 font-bold uppercase">Volume</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${volStrong ? 'bg-teal-500/25 text-teal-300' : volWeak ? 'bg-rose-500/25 text-rose-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                {volStrong ? 'Strong' : volWeak ? 'Weak' : 'Normal'} ({volumeRatio.toFixed(2)}x)
                              </span>
                            </div>
                          </div>

                          {/* 5. MOVEMENT PROBABILITY DISTRIBUTION */}
                          <div className="space-y-1.5">
                            <p className="text-[9px] font-bold text-gray-500 uppercase">Movement Probability</p>
                            <div className="flex items-center gap-0.5 h-6 rounded-md overflow-hidden bg-gray-950/50 border border-gray-700/30">
                              {/* Bullish probability */}
                              <div className="h-full bg-gradient-to-r from-teal-600 to-teal-500 flex items-center justify-center transition-all duration-500" style={{ width: `${bullishProb}%` }}>
                                {bullishProb >= 15 && <span className="text-[8px] font-bold text-white">{bullishProb}%↑</span>}
                              </div>
                              {/* Bearish probability */}
                              <div className="h-full bg-gradient-to-l from-rose-600 to-rose-500 flex items-center justify-center transition-all duration-500 ml-auto" style={{ width: `${bearishProb}%` }}>
                                {bearishProb >= 15 && <span className="text-[8px] font-bold text-white">{bearishProb}%↓</span>}
                              </div>
                            </div>
                          </div>

                          {/* 6. EARLY SIGNAL DETECTION */}
                          {showEarlySignal && (
                            <div className="pt-2 border-t border-gray-700/30">
                              <span className="text-[9px] font-bold text-amber-400 uppercase inline-block">
                                {earlySignalText}
                              </span>
                            </div>
                          )}

                          {/* 7. CONFIRMATION SUMMARY */}
                          {confirms.length > 0 && (
                            <div className="rounded-lg bg-gray-900/20 px-3 py-2 border border-gray-700/20">
                              <p className="text-[9px] text-gray-500 font-bold uppercase mb-1.5">Confirmations</p>
                              <div className="flex flex-wrap gap-1">
                                {confirms.map((c, idx) => (
                                  <span key={idx} className="text-[8px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">
                                    ✓ {c}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* 8. SUMMARY LINE */}
                          <div className={`text-center text-[10px] font-bold rounded-lg py-2 border ${dirBorder} ${dirBg}`}>
                            {predDir} · {adjConf}% Pred · {actualMarketConf}% Market · {confirms.length} Confirms
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Bottom shimmer */}
                  <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
                </div>
              );
            })}
          </div>
        </div>
        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-2 mb-4 px-2 sm:px-0">
            <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
              <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full shadow-lg shadow-teal-500/30" />
              SuperTrend (10,2) • Trend Following
            </h3>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live trend detection • Clear buy/sell signals • Real-time price tracking
            </p>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            {[
              { symbol: 'NIFTY',     data: analyses?.NIFTY },
              { symbol: 'BANKNIFTY', data: analyses?.BANKNIFTY },
              { symbol: 'SENSEX',    data: analyses?.SENSEX }
            ].map((item) => {
                const stPrice       = item.data?.indicators?.price ?? 0;
                const stLevel       = item.data?.indicators?.supertrend_10_2_value ?? 0;
                const stHasData     = stLevel > 0;
                const stDistancePct = Math.abs(item.data?.indicators?.supertrend_10_2_distance_pct ?? 0);
                const stIsAbove     = stHasData && stPrice > stLevel;
                const stIsVeryClose = stHasData && Math.abs(stPrice - stLevel) < (stLevel * 0.0005);
                const stConfidence  = Math.round(item.data?.indicators?.supertrend_10_2_confidence || (stHasData ? Math.min(50 + stDistancePct * 15, 95) : 30));
                const stIsBuy  = stHasData && stIsAbove && !stIsVeryClose;
                const stIsSell = stHasData && !stIsAbove && !stIsVeryClose;
                const stAccentBorder = stIsBuy ? 'border-teal-500/30' : stIsSell ? 'border-rose-500/25' : 'border-amber-500/25';
                const stAccentText = stIsBuy ? 'text-teal-300' : stIsSell ? 'text-rose-300' : 'text-amber-300';
                const stAccentBar = stIsBuy ? 'bg-teal-500' : stIsSell ? 'bg-rose-500' : 'bg-amber-500';
                const stSignalLabel = stIsBuy ? '▲ BULLISH TREND' : stIsSell ? '▼ BEARISH TREND' : '◆ AT SUPERTREND';

                return (
                  <div key={`st_${item.symbol}`} className={`relative rounded-2xl overflow-hidden border ${stAccentBorder} shadow-lg bg-[#0b0f1a] backdrop-blur-xl`}>
                    {/* Top shimmer */}
                    <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
                    {/* Corner glow */}
                    <div className={`absolute top-0 right-0 w-14 h-14 rounded-bl-full opacity-[7%] ${stAccentBar} pointer-events-none`} />

                    {/* HEADER */}
                    <div className="flex items-center justify-between px-4 pt-4 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{item.symbol}</span>
                        {(item.data?.status || marketStatus) === 'LIVE' && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/25">
                            <span className="w-1 h-1 rounded-full bg-teal-400 animate-pulse" />
                            <span className="text-[9px] text-teal-300 font-bold">LIVE</span>
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/30 font-medium">ST(10,2)</span>
                    </div>

                    {/* REFLECTOR SIGNAL PANEL */}
                    <div className="mx-3 mb-3 rounded-xl bg-[#0d1117]/80 border border-white/[0.05] overflow-hidden">
                      <div className="px-4 py-3 flex items-center justify-between">
                        <div>
                          <div className={`text-xl font-black tracking-tight ${stAccentText}`}>{stSignalLabel}</div>
                          <div className="text-[10px] text-white/40 mt-0.5">
                            ST @ ₹{stLevel?.toLocaleString('en-IN', {maximumFractionDigits: 0})} • {stDistancePct.toFixed(2)}% away
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] text-white/40 mb-0.5">CONFIDENCE</div>
                          <div className={`text-2xl font-black ${stAccentText}`}>{stConfidence}%</div>
                        </div>
                      </div>
                      <div className="mx-4 mb-3 h-1 rounded-full bg-white/[0.05] overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-700 ${stAccentBar}`} style={{ width: `${Math.min(stConfidence, 100)}%` }} />
                      </div>
                    </div>

                    {/* CONFERENCE GRID — 2×2 */}
                    <div className="mx-3 mb-3 grid grid-cols-2 gap-2">
                      <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                        <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Position</div>
                        <div className={`text-sm font-bold ${stAccentText}`}>{stIsVeryClose ? 'AT LEVEL' : stIsAbove ? 'ABOVE' : 'BELOW'}</div>
                        <div className="text-[9px] text-white/30 mt-0.5">{stIsBuy ? 'Uptrend' : stIsSell ? 'Downtrend' : 'Caution'}</div>
                      </div>
                      <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                        <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">ST Level</div>
                        <div className={`text-sm font-bold ${stAccentText}`}>₹{stLevel?.toLocaleString('en-IN', {maximumFractionDigits: 0})}</div>
                        <div className="text-[9px] text-white/30 mt-0.5">Trend line</div>
                      </div>
                      <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                        <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Distance</div>
                        <div className={`text-sm font-bold ${stAccentText}`}>₹{Math.abs(item.data?.indicators?.supertrend_10_2_distance ?? 0).toFixed(0)}</div>
                        <div className="text-[9px] text-white/30 mt-0.5">{stDistancePct.toFixed(2)}%</div>
                      </div>
                      <div className="bg-[#0d1117] border border-white/[0.06] p-2.5 rounded-lg">
                        <div className="text-[9px] text-white/35 uppercase tracking-widest mb-1">Strength</div>
                        <div className={`text-sm font-bold ${stAccentText}`}>{stDistancePct > 0.5 ? 'Strong' : 'Weak'}</div>
                        <div className="text-[9px] text-white/30 mt-0.5">{stDistancePct.toFixed(2)}% gap</div>
                      </div>
                    </div>

                    {/* 5-MIN PREDICTION */}
                    <div className="mx-3 mb-3 rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
                      <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                      {(() => {
                        // ── ENHANCED Multi-factor SuperTrend confidence engine ────────────
                        const distStrong    = stDistancePct > 0.5;
                        const distMedium    = stDistancePct > 0.2 && stDistancePct <= 0.5;
                        const distVStrong   = stDistancePct > 1.0;
                        const distWeak      = stDistancePct < 0.2 && stHasData;
                        const sigStrong     = stConfidence >= 75;

                        let adjConf = stHasData ? stConfidence : 30;
                        // Highest-risk condition evaluated first
                        if (stIsVeryClose) {
                          adjConf = Math.round(adjConf * 0.83); // at ST level — flip imminent
                        } else if (distWeak) {
                          adjConf = Math.round(adjConf * 0.90); // near ST line — reversal risk
                        } else if (distVStrong) {
                          adjConf = Math.round(adjConf * 1.08); // very wide gap — strong trend
                        } else if (distStrong) {
                          adjConf = Math.round(adjConf * 1.05); // well clear of ST line
                        } else if (distMedium) {
                          adjConf = Math.round(adjConf * 1.03); // moderate distance
                        }
                        if (marketStatus !== 'LIVE') adjConf = Math.round(Math.max(30, adjConf * 0.88));
                        adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

                        // ── ACTUAL MARKET CONFIDENCE (independent calculation) ──
                        // Base from distance quality + position + signal strength
                        let actualMarketConf = 50;
                        if (stIsBuy) {
                          actualMarketConf = Math.min(95, Math.max(30, (distVStrong ? 40 : distStrong ? 30 : distMedium ? 20 : 10) + (stHasData ? 20 : 0) + (sigStrong ? 15 : 0)));
                        } else if (stIsSell) {
                          actualMarketConf = Math.min(95, Math.max(30, (distVStrong ? 40 : distStrong ? 30 : distMedium ? 20 : 10) + (stHasData ? 20 : 0) + (sigStrong ? 15 : 0)));
                        } else {
                          actualMarketConf = 33;
                        }

                        // Direction
                        const predDir   = stIsBuy ? 'LONG' : stIsSell ? 'SHORT' : 'FLAT';
                        const dirIcon   = stIsBuy ? '▲' : stIsSell ? '▼' : '─';
                        const dirColor  = stIsBuy ? 'text-teal-300'  : stIsSell ? 'text-rose-300'  : 'text-amber-300';
                        const dirBorder = stIsBuy ? 'border-teal-500/40' : stIsSell ? 'border-rose-500/35' : 'border-amber-500/30';
                        const dirBg     = stIsBuy ? 'bg-teal-500/[0.07]' : stIsSell ? 'bg-rose-500/[0.07]' : 'bg-amber-500/[0.05]';

                        // Movement probability distribution
                        const bullishProb = stIsBuy ? Math.max(5, Math.min(95, adjConf)) : Math.max(5, Math.min(95, 50 - Math.abs(adjConf - 50)));
                        const bearishProb = 100 - bullishProb;

                        // Confirmations list
                        const confirms = [
                          distVStrong && 'Gap > 1.0%',
                          distStrong && !distVStrong && 'Gap > 0.5%',
                          stHasData && 'Established',
                          sigStrong && 'Strong signal',
                        ].filter(Boolean) as string[];

                        // Early signal detection
                        const multiFactorAlign = [distVStrong || distStrong, stHasData, sigStrong].filter(Boolean).length >= 2;
                        const showEarlySignal = adjConf >= 75 || (multiFactorAlign && !stIsVeryClose);
                        const earlySignalText = adjConf >= 85 ? `⚡ STRONG ST ${predDir} Signal Ready` : `⚡ CONFIRMED ST ${predDir} Signal Ready`;

                        return (
                          <div className="px-4 py-3 space-y-3">
                            {/* 1. HEADER */}
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] font-bold text-gray-400 uppercase">5 Min Prediction</span>
                              <span className={`text-[10px] font-bold tabular-nums px-2 py-1 rounded ${stIsBuy ? 'bg-teal-500/25 text-teal-300' : stIsSell ? 'bg-rose-500/25 text-rose-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                {adjConf}% CONFIDENCE
                              </span>
                            </div>

                            {/* 2. DUAL CONFIDENCE DISPLAY */}
                            <div className="grid grid-cols-2 gap-2">
                              {/* Predicted confidence */}
                              <div className="flex flex-col bg-gray-900/50 rounded-lg px-2.5 py-2 border border-gray-700/30">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">CONFIDENCE</span>
                                <span className={`text-[13px] font-black tabular-nums ${dirColor}`}>{adjConf}%</span>
                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-1.5">
                                  <div className={`h-full rounded-full transition-all duration-700 ${stAccentBar}`} style={{ width: `${adjConf}%` }} />
                                </div>
                              </div>

                              {/* Actual Market confidence */}
                              <div className="flex flex-col bg-gray-900/50 rounded-lg px-2.5 py-2 border border-gray-700/30">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">Actual Market</span>
                                <span className={`text-[13px] font-black tabular-nums ${stIsBuy ? 'text-teal-400' : stIsSell ? 'text-rose-400' : 'text-amber-400'}`}>{actualMarketConf}%</span>
                                <div className="h-2 bg-gray-800 rounded-full overflow-hidden mt-1.5">
                                  <div className={`h-full rounded-full transition-all duration-700 ${stIsBuy ? 'bg-teal-500' : stIsSell ? 'bg-rose-500' : 'bg-amber-500'}`} style={{ width: `${actualMarketConf}%` }} />
                                </div>
                              </div>
                            </div>

                            {/* 3. DIRECTION + STATUS */}
                            <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                              <div className="flex items-center justify-between">
                                <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                                <span className="text-[9px] text-gray-400">{stIsVeryClose ? '⚠ At ST level' : distWeak ? '⚠ Near ST' : 'Trend clear'}</span>
                                <span className={`text-sm font-black tabular-nums ${dirColor}`}>{adjConf}%</span>
                              </div>
                              <div className="h-2 bg-gray-800 rounded-full overflow-hidden border border-white/5 mt-2">
                                <div className={`h-full rounded-full transition-all duration-700 bg-gradient-to-r ${stIsBuy ? 'from-teal-500 to-teal-400' : stIsSell ? 'from-rose-500 to-rose-400' : 'from-amber-500 to-amber-400'}`} style={{ width: `${adjConf}%` }} />
                              </div>
                            </div>

                            {/* 4. SUPERTREND MOMENTUM INDICATORS (4-row grid) */}
                            <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-3 border border-gray-700/20">
                              {/* ST Position */}
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">ST Position</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stIsBuy ? 'bg-teal-500/25 text-teal-300' : stIsSell ? 'bg-rose-500/25 text-rose-300' : 'bg-gray-700/30 text-gray-300'}`}>
                                  {stIsVeryClose ? 'At Level (Flip Risk)' : stIsAbove ? 'Above (Uptrend)' : stIsSell ? 'Below (Downtrend)' : 'Neutral'}
                                </span>
                              </div>

                              {/* Distance Quality */}
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">Distance</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${distVStrong ? (stIsBuy ? 'bg-teal-500/25 text-teal-300' : 'bg-rose-500/25 text-rose-300') : distWeak ? 'bg-red-500/25 text-red-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                  {distVStrong ? 'Very Strong' : distStrong ? 'Strong' : distMedium ? 'Moderate' : distWeak ? 'Close Risk' : 'N/A'} ({stDistancePct?.toFixed(2)}%)
                                </span>
                              </div>

                              {/* ST Stability */}
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">Stability</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${stHasData && !stIsVeryClose ? 'bg-teal-500/25 text-teal-300' : 'bg-amber-500/25 text-amber-300'}`}>
                                  {stHasData ? (!stIsVeryClose ? '✓ Established' : 'Reversal Risk') : 'No Data'}
                                </span>
                              </div>

                              {/* Signal Strength */}
                              <div className="flex items-center justify-between">
                                <span className="text-[9px] text-gray-500 font-bold uppercase">Strength</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${sigStrong ? (stIsBuy ? 'bg-teal-500/25 text-teal-300' : 'bg-rose-500/25 text-rose-300') : 'bg-amber-500/25 text-amber-300'}`}>
                                  {sigStrong ? 'Strong' : 'Moderate'} ({stConfidence}%)
                                </span>
                              </div>
                            </div>

                            {/* 5. MOVEMENT PROBABILITY DISTRIBUTION */}
                            <div className="space-y-1.5">
                              <p className="text-[9px] font-bold text-gray-500 uppercase">Movement Probability</p>
                              <div className="flex items-center h-6 rounded-md overflow-hidden bg-gray-950/50 border border-gray-700/30">
                                {/* Bullish probability */}
                                <div className="h-full bg-gradient-to-r from-teal-600 to-teal-500 flex items-center justify-center transition-all duration-700" style={{ width: `${bullishProb}%` }}>
                                  {bullishProb >= 15 && <span className="text-[8px] font-bold text-white tabular-nums">{bullishProb}%↑</span>}
                                </div>
                                {/* Bearish probability */}
                                <div className="h-full bg-gradient-to-l from-rose-600 to-rose-500 flex items-center justify-center transition-all duration-700" style={{ width: `${bearishProb}%` }}>
                                  {bearishProb >= 15 && <span className="text-[8px] font-bold text-white tabular-nums">{bearishProb}%↓</span>}
                                </div>
                              </div>
                            </div>

                            {/* 6. EARLY SIGNAL DETECTION */}
                            <div className={`min-h-[24px] pt-2 border-t border-gray-700/30 ${showEarlySignal ? '' : 'invisible'}`}>
                              <span className="text-[9px] font-bold text-amber-400 uppercase inline-block">
                                {earlySignalText}
                              </span>
                            </div>

                            {/* 7. CONFIRMATION SUMMARY */}
                            {confirms.length > 0 && (
                              <div className="rounded-lg bg-gray-900/20 px-3 py-2 border border-gray-700/20">
                                <p className="text-[9px] text-gray-500 font-bold uppercase mb-1.5">Confirmations</p>
                                <div className="flex flex-wrap gap-1">
                                  {confirms.map((c, idx) => (
                                    <span key={idx} className="text-[8px] bg-teal-500/20 text-teal-300 px-2 py-0.5 rounded">
                                      ✓ {c}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* 8. SUMMARY LINE */}
                            <div className={`text-center text-[10px] font-bold rounded-lg py-2 border ${dirBorder} ${dirBg}`}>
                              {predDir} · {adjConf}% Pred · {actualMarketConf}% Market · {confirms.length} Confirms
                            </div>
                          </div>
                        );
                      })()}
                    </div>

                    {/* Bottom shimmer */}
                    <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/8 to-transparent pointer-events-none" />
                  </div>
                );
              })}
          </div>
        </div>

        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-2 mb-4 px-2 sm:px-0">
            <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
              <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full shadow-lg shadow-teal-500/30" />
              Pivot Points
            </h3>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live support/resistance levels • Classic & Camarilla pivots
            </p>
          </div>
          <PivotSectionUnified updates={updateCounter} analyses={analyses} marketStatus={marketStatus} />
        </div>

        {/* Candle Intent Section */}
        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-2 mb-4 px-2 sm:px-0">
            <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
              <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-teal-500 to-teal-600 rounded-full shadow-lg shadow-teal-500/30" />
              Candle Intent (Candle Structure)
            </h3>
            <p className="text-dark-tertiary text-xs sm:text-sm ml-4 sm:ml-5 font-medium tracking-wide">
              Live candle pattern analysis • Wick dominance signals • Volume-price efficiency
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
            <CandleIntentCard symbol="NIFTY" name="NIFTY 50" />
            <CandleIntentCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <CandleIntentCard symbol="SENSEX" name="SENSEX" />
          </div>
        </div>

        {/* Trend Base Section */}
        <div className="mt-6 sm:mt-6">
          <div className="flex flex-col gap-1 mb-3 sm:mb-4">
            <h3 className="text-base sm:text-lg lg:text-xl font-bold text-dark-text flex items-center gap-3 tracking-tight">
              <span className="w-1.5 h-5 sm:h-6 bg-gradient-to-b from-green-500 to-green-600 rounded-full" />
              Trend Base (Higher-Low Structure)
            </h3>
            <p className="text-dark-tertiary text-[11px] sm:text-xs ml-4 sm:ml-5">
              Live swing structure · 8-factor analysis · 5-min prediction
            </p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
            <TrendBaseCard symbol="NIFTY" name="NIFTY 50" />
            <TrendBaseCard symbol="BANKNIFTY" name="BANK NIFTY" />
            <TrendBaseCard symbol="SENSEX" name="SENSEX" />
          </div>
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

/**
 * useOverallMarketOutlook - Aggregated Market Analysis
 * Combines ALL analysis sections to determine overall trading confidence
 * 
 * Data Sources:
 * 1. Technical Analysis (VWAP, EMA, Support/Resistance)
 * 2. Zone Control (Breakdown Risk, Bounce Probability)
 * 3. Volume Pulse (Green/Red Candle Volume Ratio)
 * 4. Trend Base (Higher-Low Structure)
 * 5. Market Structure (Order Flow, FVG, Order Blocks, Smart Money)
 * 6. Candle Intent (Candle Pattern Analysis)
 * 7. Market Indices (PCR, Sentiment)
 * 8. Pivot Points (Supertrend, Support/Resistance)
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface SignalWeight {
  technical: number;
  zoneControl: number;
  volumePulse: number;
  trendBase: number;
  marketStructure: number; // 🏗️ Order Flow, FVG, Order Blocks positioning
  candleIntent: number; // Candle structure patterns
  marketIndices: number; // Live Market Indices momentum
  pcr: number; // Put-Call Ratio - Market sentiment indicator
  pivot: number; // Pivot Points & Supertrend
  // 🔥 NEW: 5 Additional Components
  orb: number; // Opening Range Breakout
  supertrend: number; // SuperTrend Indicator
  sar: number; // Parabolic SAR - Trailing Stops
  camarilla: number; // Camarilla CPR - Zone Breaks
  rsi60_40: number; // RSI 60/40 Momentum
  smartMoney: number; // Smart Money Flow
  oiMomentum: number; // OI Momentum
}

interface SymbolOutlook {
  overallConfidence: number;
  overallSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  tradeRecommendation: string;
  signalBreakdown: {
    technical: { signal: string; confidence: number; weight: number };
    zoneControl: { signal: string; confidence: number; weight: number };
    volumePulse: { signal: string; confidence: number; weight: number };
    trendBase: { signal: string; confidence: number; weight: number };
    marketStructure: { signal: string; confidence: number; weight: number };
    candleIntent: { signal: string; confidence: number; weight: number };
    marketIndices: { signal: string; confidence: number; weight: number };
    pcr: { signal: string; confidence: number; weight: number };
    pivot: { signal: string; confidence: number; weight: number };
    // 🔥 NEW: 5 Additional Components for Complete Integration
    orb: { signal: string; confidence: number; weight: number };
    supertrend: { signal: string; confidence: number; weight: number };
    sar: { signal: string; confidence: number; weight: number };
    camarilla: { signal: string; confidence: number; weight: number };
    rsi60_40: { signal: string; confidence: number; weight: number };
    smartMoney: { signal: string; confidence: number; weight: number };
    oiMomentum: { signal: string; confidence: number; weight: number };
  };
  // 🔥 MASTER TRADE - 9 Golden Rules Status
  masterTradeStatus: {
    qualified: boolean;
    rulesPassed: number;
    rules: {
      rule1_trendStructure: boolean;
      rule2_trendActive: boolean;
      rule3_candleBuy: boolean;
      rule4_volumeEfficiency: boolean;
      rule5_volumePulse: boolean;
      rule6_nearSupport: boolean;
      rule7_breakdownLow: boolean;
      rule8_momentum: boolean;
      rule9_bigThreeAlign: boolean;
    };
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdownRiskPercent: number;
  timestamp: string;
  // 🔥 PIVOT CRITICAL ALERTS
  pivotCriticalAlert: {
    isCrossing: boolean; // Supertrend crossed/broken
    isTouchingPivot: boolean; // Price touching support/resistance
    touchCount: number; // How many times touched
    crossingType: 'BUY_CROSS' | 'SELL_CROSS' | 'NONE';
    nearestLevel: string;
    sharpHighlight: boolean; // Should show sharp red/green highlight
  };
}

interface OverallOutlookData {
  NIFTY: SymbolOutlook | null;
  BANKNIFTY: SymbolOutlook | null;
  SENSEX: SymbolOutlook | null;
}

const API_BASE_URL = API_CONFIG.baseUrl;
const SYMBOLS = (process.env.NEXT_PUBLIC_MARKET_SYMBOLS || 'NIFTY,BANKNIFTY,SENSEX').split(',').filter(Boolean);

// Signal strength weights (total = 100%) - 14 component sources integrated
const SIGNAL_WEIGHTS: SignalWeight = {
  technical: 12,           // 12% weight - Technical Analysis (VWAP, EMA, Support/Resistance)
  zoneControl: 10,         // 10% weight - Zone Control (Breakdown Risk, Bounce Probability)
  volumePulse: 9,          // 9% weight - Volume Pulse (Green/Red Candle Volume Ratio)
  trendBase: 8,            // 8% weight - Trend Base (Higher-Low Structure)
  marketStructure: 8,      // 8% weight - Market Structure (Order Flow, FVG, Order Blocks)
  candleIntent: 8,         // 8% weight - Candle Intent (Candle Pattern Analysis)
  marketIndices: 5,        // 5% weight - Market Indices (PCR, Sentiment)
  pcr: 4,                  // 4% weight - Put-Call Ratio (market sentiment)
  pivot: 7,                // 7% weight - Pivot Points (Supertrend, Support/Resistance)
  // 🔥 NEW: 5 Additional Components (totaling 21% for operational signals)
  orb: 5,                  // 5% weight - ORB (Opening Range Breakout)
  supertrend: 5,           // 5% weight - SuperTrend (Trend Following)
  sar: 4,                  // 4% weight - SAR (Parabolic SAR - Trailing Stops)
  camarilla: 4,            // 4% weight - Camarilla CPR (Zone Breaks)
  rsi60_40: 5,             // 5% weight - RSI 60/40 Momentum (Entry Signal)
  smartMoney: 5,           // 5% weight - Smart Money Flow (Institutional Positioning)
  oiMomentum: 5,           // 5% weight - OI Momentum (5m/15m Signal Alignment)
}

// 🔥🔥🔥 INSTANT DEFAULT VALUES - Start at 0%, load real data immediately
const createDefaultOutlook = (symbol: string): SymbolOutlook => ({
  overallConfidence: 0,
  overallSignal: 'NEUTRAL',
  tradeRecommendation: '⏳ Calculating...',
  signalBreakdown: {
    technical: { signal: 'NEUTRAL', confidence: 0, weight: 12 },
    zoneControl: { signal: 'NEUTRAL', confidence: 0, weight: 10 },
    volumePulse: { signal: 'NEUTRAL', confidence: 0, weight: 9 },
    trendBase: { signal: 'NEUTRAL', confidence: 0, weight: 8 },
    marketStructure: { signal: 'NEUTRAL', confidence: 0, weight: 8 },
    candleIntent: { signal: 'NEUTRAL', confidence: 0, weight: 8 },
    marketIndices: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
    pcr: { signal: 'NEUTRAL', confidence: 0, weight: 4 },
    pivot: { signal: 'NEUTRAL', confidence: 0, weight: 7 },
    // 🔥 NEW: 5 Additional Components
    orb: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
    supertrend: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
    sar: { signal: 'NEUTRAL', confidence: 0, weight: 4 },
    camarilla: { signal: 'NEUTRAL', confidence: 0, weight: 4 },
    rsi60_40: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
    smartMoney: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
    oiMomentum: { signal: 'NEUTRAL', confidence: 0, weight: 5 },
  },
  masterTradeStatus: {
    qualified: false,
    rulesPassed: 0,
    rules: {
      rule1_trendStructure: false,
      rule2_trendActive: false,
      rule3_candleBuy: false,
      rule4_volumeEfficiency: false,
      rule5_volumePulse: false,
      rule6_nearSupport: false,
      rule7_breakdownLow: false,
      rule8_momentum: false,
      rule9_bigThreeAlign: false,
    },
  },
  riskLevel: 'MEDIUM',
  breakdownRiskPercent: 50,
  pivotCriticalAlert: {
    isCrossing: false,
    isTouchingPivot: false,
    touchCount: 0,
    crossingType: 'NONE' as const,
    nearestLevel: '',
    sharpHighlight: false,
  },
  timestamp: new Date().toISOString(),
});

// 🔥 NO GLOBAL CACHE - Force fresh data every time
// Desktop browsers cache modules aggressively, causing stale data
// Mobile browsers reload modules more frequently
let lastFetchTime = 0;
let isFetching = false;

// 🔥 FORCE RESET: Clear any cached values on module load
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('mytradingsignal_last_outlook_data');
    sessionStorage.removeItem('mytradingsignal_last_outlook_data');
  } catch {}
}

export const useOverallMarketOutlook = () => {
  // 🔥 FIX HYDRATION: Always start with defaults, load cache in useEffect
  const [outlookData, setOutlookData] = useState<OverallOutlookData>({
    NIFTY: createDefaultOutlook('NIFTY'),
    BANKNIFTY: createDefaultOutlook('BANKNIFTY'),
    SENSEX: createDefaultOutlook('SENSEX')
  });
  const [loading, setLoading] = useState(true);

  // Convert signal string to numeric score (-100 to +100)
  // 🔥 USER-FRIENDLY: Clear scoring with confidence-based amplification
  const signalToScore = (signal: string | null | undefined, confidence: number): number => {
    // 🔥 FIX: Ensure signal is always a string
    const safeSignal = typeof signal === 'string' ? signal : 'NEUTRAL';
    const upperSignal = safeSignal.toUpperCase();
    let baseScore = 0;
    
    if (upperSignal.includes('STRONG_BUY') || upperSignal === 'STRONG BUY') baseScore = 100;
    else if (upperSignal.includes('BUY') || upperSignal === 'BULLISH') baseScore = 75;
    else if (upperSignal.includes('STRONG_SELL') || upperSignal === 'STRONG SELL') baseScore = -100;
    else if (upperSignal.includes('SELL') || upperSignal === 'BEARISH') baseScore = -75;
    else if (upperSignal.includes('NEUTRAL') || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') baseScore = 0;
    else baseScore = 0; // Default to neutral
    
    // 🔥 Amplify score based on confidence: score * (confidence / 100)
    // This ensures high-confidence signals have more weight
    return baseScore * (confidence / 100);
  };

  // Calculate aggregated confidence score with ALL 14 COMPONENTS
  const calculateOverallOutlook = useCallback((
    technical: any,
    zoneControl: any,
    volumePulse: any,
    trendBase: any,
    candleIntent: any,
    marketIndicesData: any,
    pivotIndicators: any,
    // 🔥 NEW: 5 Additional Components
    orb: any,
    supertrend: any,
    sar: any,
    camarilla: any,
    rsi60_40: any,
    smartMoney: any,
    oiMomentum: any
  ): SymbolOutlook => {
    // 🔥 PERMANENT FIX: ALWAYS calculate and show data
    // Market status is informational only, never block display
    const marketStatus = marketIndicesData?.status || 'UNKNOWN';
    
    // 🔥🔥🔥 NEVER SHOW "LOADING" - Always proceed with calculation
    // Even with no data, show neutral values (no loading text ever!)
    
    // 🔥 PERMANENT FIX: Signal Availability Check - ALWAYS SHOW DATA
    // Count available signals for informational purposes only
    const availableSignals = [
      technical?.signal,
      zoneControl?.signal,
      volumePulse?.signal,
      trendBase?.signal,
      // 🏗️ Market Structure signals from technical.indicators
      technical?.indicators?.fvg_bullish || technical?.indicators?.fvg_bearish || 
      technical?.indicators?.bos_bullish || technical?.indicators?.bos_bearish ? 'MARKET_STRUCTURE' : null,
      candleIntent?.professional_signal || candleIntent?.signal,  // Check both fields
      marketIndicesData?.change !== undefined,
      marketIndicesData?.pcr !== undefined && marketIndicesData?.pcr > 0
    ].filter(Boolean).length;

    // 🔥🔥🔥 PERMANENT FIX: ALWAYS PROCEED WITH CALCULATION
    // Even with 0 signals, show the section with appropriate message
    // This ensures the Overall Market Outlook section ALWAYS appears in UI
    // The signal quality warning is shown in the recommendation text instead
    
    // Extract signals and confidence
    const techSignal = technical?.signal || 'WAIT';
    const techConfidence = technical?.confidence ? technical.confidence * 100 : 0;

    const zoneSignal = zoneControl?.signal || 'NEUTRAL';
    const zoneConfidence = zoneControl?.confidence || 0;

    const volumeSignal = volumePulse?.signal || 'NEUTRAL';
    const volumeConfidence = volumePulse?.confidence || 0;

    const trendSignal = trendBase?.signal || 'NEUTRAL';
    const trendConfidence = trendBase?.confidence || 0;

    // Extract Candle Intent signal and confidence
    const candleSignal = candleIntent?.professional_signal || candleIntent?.signal || 'NEUTRAL';
    const candleConfidence = candleIntent?.pattern?.confidence || candleIntent?.confidence || 0;

    // 🎯 PIVOT POINTS & SUPERTREND INTEGRATION
    // Extract key parameters and enhance signals with pivot analysis
    let pivotEnhancedTechSignal = techSignal;
    let pivotEnhancedTechConfidence = techConfidence;
    let pivotEnhancedZoneSignal = zoneSignal;
    let pivotEnhancedCandleSignal = candleSignal;
    let pivotEnhancedCandleConfidence = candleConfidence;
    
    if (pivotIndicators && pivotIndicators.status !== 'OFFLINE') {
      const price = pivotIndicators.current_price || 0;
      const st10 = pivotIndicators.supertrend_10_3 || {};
      const classic = pivotIndicators.classic_pivots || {};
      const camarilla = pivotIndicators.camarilla_pivots || {};
      const bias = pivotIndicators.overall_bias || 'NEUTRAL';
      
      // TECHNICAL ANALYSIS ENHANCEMENT (22%): Price action vs key levels
      // Strong signal if price is above major pivots or EMA trends are aligned
      if (bias === 'BULLISH' && price > (classic.pivot || 0)) {
        pivotEnhancedTechSignal = techSignal === 'SELL' || techSignal === 'STRONG_SELL' ? 'NEUTRAL' : techSignal;
        pivotEnhancedTechConfidence = Math.min(100, techConfidence + 15); // Boost confidence
      } else if (bias === 'BEARISH' && price < (classic.pivot || 0)) {
        pivotEnhancedTechSignal = techSignal === 'BUY' || techSignal === 'STRONG_BUY' ? 'NEUTRAL' : techSignal;
        pivotEnhancedTechConfidence = Math.min(100, techConfidence + 10);
      }
      
      // ZONE CONTROL ENHANCEMENT (18%): Support/Resistance proximity
      // Alert if price is approaching H3 (resistance) or L3 (support)
      const nearH3 = camarilla.h3 && price && Math.abs(price - camarilla.h3) / camarilla.h3 < 0.01;
      const nearL3 = camarilla.l3 && price && Math.abs(price - camarilla.l3) / camarilla.l3 < 0.01;
      if (nearH3 || nearL3) {
        pivotEnhancedZoneSignal = nearH3 ? 'SELL' : 'BUY';
      }
      
      // CANDLE INTENT ENHANCEMENT (16%): Supertrend confirmation
      // If supertrend signals strong momentum, enhance candle analysis
      if (st10.signal === 'BUY' && st10.trend === 'BULLISH') {
        pivotEnhancedCandleSignal = candleSignal === 'SELL' ? 'NEUTRAL' : (candleSignal === 'BUY' ? 'STRONG_BUY' : 'BUY');
        pivotEnhancedCandleConfidence = Math.min(100, candleConfidence + 20);
      } else if (st10.signal === 'SELL' && st10.trend === 'BEARISH') {
        pivotEnhancedCandleSignal = candleSignal === 'BUY' ? 'NEUTRAL' : (candleSignal === 'SELL' ? 'STRONG_SELL' : 'SELL');
        pivotEnhancedCandleConfidence = Math.min(100, candleConfidence + 15);
      }
      
    }
    
    // Use enhanced signals with pivot integration
    const finalTechSignal = pivotEnhancedTechSignal;
    const finalTechConfidence = pivotEnhancedTechConfidence;
    const finalZoneSignal = pivotEnhancedZoneSignal;
    const finalCandleSignal = pivotEnhancedCandleSignal;
    const finalCandleConfidence = pivotEnhancedCandleConfidence;

    // Calculate market indices momentum signal from price change
    // BUYER-FRIENDLY: Lower thresholds for BUY signals, higher thresholds for SELL signals
    const priceChange = marketIndicesData?.change || 0;
    const priceChangePercent = marketIndicesData?.changePercent || 0;
    let marketIndicesSignal = 'NEUTRAL';
    let marketIndicesConfidence = 0;
    
    if (priceChangePercent >= 1.5) {
      marketIndicesSignal = 'STRONG_BUY';
      marketIndicesConfidence = 95;
    } else if (priceChangePercent >= 0.7) {
      marketIndicesSignal = 'BUY';
      marketIndicesConfidence = 85;
    } else if (priceChangePercent >= 0.2) {
      marketIndicesSignal = 'BUY';
      marketIndicesConfidence = 70;
    } else if (priceChangePercent <= -2) {
      marketIndicesSignal = 'STRONG_SELL';
      marketIndicesConfidence = 90;
    } else if (priceChangePercent <= -1.2) {
      marketIndicesSignal = 'SELL';
      marketIndicesConfidence = 75;
    } else if (priceChangePercent <= -0.5) {
      marketIndicesSignal = 'SELL';
      marketIndicesConfidence = 60;
    } else {
      marketIndicesSignal = 'NEUTRAL';
      marketIndicesConfidence = 50;
    }

    // const aiSignal = ai?.signal?.direction || 'NEUTRAL'; // COMMENTED OUT
    // const aiConfidence = ai?.signal?.strength || 0; // COMMENTED OUT

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔥🔥🔥 TREND STRUCTURE VALIDATION 🔥🔥🔥
    // ═══════════════════════════════════════════════════════════════════════════════
    // ALL 7 CONDITIONS MUST BE MET FOR QUALIFIED STATUS:
    // 1. Risk = LOW
    // Extract Trend Base data for structure validation
    // 🔥 FIX: structure can be an object with {type, integrity_score} or a string
    const rawStructure = trendBase?.structure;
    let trendStructure = 'UNKNOWN';
    if (typeof rawStructure === 'string') {
      trendStructure = rawStructure;
    } else if (rawStructure && typeof rawStructure === 'object') {
      // API returns {type: "HIGHER-HIGH-LOWER-LOW", integrity_score: 45}
      trendStructure = rawStructure.type || rawStructure.trend_structure || 'UNKNOWN';
    }
    trendStructure = String(trendStructure || 'UNKNOWN').toUpperCase();
    
    const trendIntegrity = trendBase?.structure?.integrity_score || trendBase?.integrity || trendBase?.confidence || 0;
    
    // Condition checks for Trend Structure validation
    // 🔥 FIX: Safe string check - trendStructure is already uppercase string
    const isUptrendStructure = trendStructure === 'HIGHER_HIGH_HIGHER_LOW' || 
                               trendStructure === 'HH_HL' || 
                               trendStructure.includes('HIGHER') ||
                               trendStructure.includes('UPTREND') ||
                               trendSignal === 'BUY' || trendSignal === 'STRONG_BUY';
    const isDowntrendStructure = trendStructure === 'LOWER_HIGH_LOWER_LOW' || 
                                 trendStructure === 'LH_LL' || 
                                 trendStructure.includes('LOWER') ||
                                 trendStructure.includes('DOWNTREND') ||
                                 trendSignal === 'SELL' || trendSignal === 'STRONG_SELL';
    const isTrendIntegrityStrong = trendIntegrity >= 65;

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔥🔥🔥 MASTER TRADE VALIDATION - 9 GOLDEN RULES 🔥🔥🔥
    // ALL conditions must align for QUALIFIED TRADE ENTRY
    // ═══════════════════════════════════════════════════════════════════════════════
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 1 & 2: TREND BASE - Structure + Status Validation
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const trendStatus = trendBase?.status || trendBase?.trend_status || 'UNKNOWN';
    const trendDirection = trendBase?.trend || trendBase?.direction || 'NEUTRAL';
    
    // Rule 1: Structure = HH+HL (for BUY), Integrity ≥ 65%
    const rule1_trendStructureValid = isUptrendStructure && isTrendIntegrityStrong;
    // Rule 2: Status = ACTIVE, Trend = UPTREND
    const rule2_trendActive = (trendStatus === 'ACTIVE' || trendStatus === 'CONFIRMED') && 
                              (trendDirection === 'UPTREND' || trendDirection === 'BULLISH' || trendSignal === 'BUY' || trendSignal === 'STRONG_BUY');
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 3 & 4: CANDLE INTENT - Signal + Volume Efficiency
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const rawCandleBodyStructure = candleIntent?.body_structure || candleIntent?.pattern?.body_type || 'UNKNOWN';
    const candleBodyStructure = typeof rawCandleBodyStructure === 'string' ? rawCandleBodyStructure.toUpperCase() : 'UNKNOWN';
    
    // 🔥 FIX: Extract volume metrics from volume_analysis (backend returns efficiency there, not top-level volume_efficiency)
    const candleVolumeRatio = candleIntent?.volume_analysis?.volume_ratio || 0;
    const candleEfficiency = candleIntent?.volume_analysis?.efficiency || '';
    
    // Rule 3: Signal = BUY/STRONG_BUY, Body = STRONG, Confidence ≥ 80%
    const rule3_candleBuySignal = (candleSignal === 'BUY' || candleSignal === 'STRONG_BUY' || candleSignal === 'BULLISH') && 
                                   candleConfidence >= 80 &&
                                   (candleBodyStructure === 'STRONG' || candleBodyStructure === 'STRONG_BODY' || candleBodyStructure.includes('STRONG'));
    // Rule 4: High volume with strong conviction - check volume_ratio >= 1.5x OR ABSORPTION pattern
    const rule4_volumeEfficiency = candleVolumeRatio >= 1.5 || candleEfficiency === 'ABSORPTION';
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 5: VOLUME PULSE - Not Bearish
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const volumePulseScore = volumePulse?.pulse_score || volumePulse?.score || 50;
    const volumePulseTrend = volumePulse?.trend || volumePulse?.bias || 'NEUTRAL';
    const greenVolumePercent = volumePulse?.green_percent || volumePulse?.buying_pressure || 50;
    
    // Rule 5: Pulse ≥ 55%, Trend = Neutral/Bullish, Green ≥ 45%
    const rule5_volumePulseOk = volumePulseScore >= 55 && 
                                 (volumePulseTrend !== 'BEARISH' && volumePulseTrend !== 'SELLING') &&
                                 greenVolumePercent >= 45;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 6 & 7: ZONE CONTROL - Support + Breakdown Risk
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const distanceToSupport = zoneControl?.distance_to_support || zoneControl?.support_distance || 999;
    const supportStrength = zoneControl?.support_strength || zoneControl?.support?.strength || 0;
    const bounceProb = zoneControl?.bounce_probability || zoneControl?.risk_metrics?.bounce_probability || 0;
    const breakdownProb = zoneControl?.breakdown_probability || zoneControl?.risk_metrics?.breakdown_risk || 100;
    
    // Rule 6: Distance ≤ 0.30%, Support Strength ≥ 50, Bounce > Breakdown
    const rule6_nearSupport = distanceToSupport <= 0.30 && supportStrength >= 50 && bounceProb > breakdownProb;
    // Rule 7: Breakdown Risk < 50%
    const rule7_breakdownLow = breakdownProb < 50;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 8: MOMENTUM - Bullish with consistency
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const isMomentumBullish = trendSignal === 'BUY' || trendSignal === 'STRONG_BUY';
    const isMomentumConsistent = trendConfidence >= 65;
    const rule8_momentumBullish = isMomentumBullish && isMomentumConsistent;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 9: FINAL ALIGNMENT CHECK - The Big 3 Must Agree
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const big3_trendBaseAligned = rule1_trendStructureValid && rule2_trendActive;
    const big3_candleIntentAligned = rule3_candleBuySignal; // Rule 4 is bonus
    const big3_zoneControlAligned = rule7_breakdownLow && bounceProb > breakdownProb;
    
    const rule9_allThreeAlign = big3_trendBaseAligned && big3_candleIntentAligned && big3_zoneControlAligned;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MASTER TRADE QUALIFICATION - Count passed rules
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const rulesStatus = {
      rule1: rule1_trendStructureValid,
      rule2: rule2_trendActive,
      rule3: rule3_candleBuySignal,
      rule4: rule4_volumeEfficiency,
      rule5: rule5_volumePulseOk,
      rule6: rule6_nearSupport,
      rule7: rule7_breakdownLow,
      rule8: rule8_momentumBullish,
      rule9: rule9_allThreeAlign
    };
    
    const rulesPassed = Object.values(rulesStatus).filter(Boolean).length;
    const isMasterTradeQualified = rulesPassed >= 6 && rule9_allThreeAlign; // Need 6+ rules AND Big 3 aligned
    const isPartiallyQualified = rulesPassed >= 4 && big3_zoneControlAligned; // 4+ rules with safe zone

    // Calculate PCR (Put-Call Ratio) signal
    // PCR > 1.0 = More puts (fear) = Bullish contrarian signal (good for buyers)
    // PCR < 0.7 = More calls (greed) = Bearish/cautious (risky for buyers)
    const pcr = marketIndicesData?.pcr || 0;
    let pcrSignal = 'NEUTRAL';
    let pcrConfidence = 0;
    
    if (pcr >= 1.5 && pcr <= 2.5) {
      pcrSignal = 'STRONG_BUY';
      pcrConfidence = 90; // High fear = Great buying opportunity
    } else if (pcr >= 1.2 && pcr < 1.5) {
      pcrSignal = 'BUY';
      pcrConfidence = 75; // Moderate fear = Good buying opportunity
    } else if (pcr >= 0.9 && pcr < 1.2) {
      pcrSignal = 'BUY';
      pcrConfidence = 60; // Balanced market = Safe to buy
    } else if (pcr >= 0.7 && pcr < 0.9) {
      pcrSignal = 'NEUTRAL';
      pcrConfidence = 50; // Slight greed = Wait
    } else if (pcr < 0.7 && pcr > 0) {
      pcrSignal = 'SELL';
      pcrConfidence = 70; // Excessive greed = Caution
    } else if (pcr > 2.5) {
      pcrSignal = 'NEUTRAL';
      pcrConfidence = 40; // Extreme fear = Wait for stabilization
    } else {
      pcrSignal = 'NEUTRAL';
      pcrConfidence = 0; // No PCR data available
    }

    // 🔥 PIVOT POINTS & SUPERTREND - Independent 10% Signal
    // Isolated extraction from pivot data - doesn't override other signals
    let pivotSignal = 'NEUTRAL';
    let pivotConfidence = 0;
    
    if (pivotIndicators && pivotIndicators.status !== 'OFFLINE') {
      const price = pivotIndicators.current_price || 0;
      const st10 = pivotIndicators.supertrend_10_3 || {};
      const classic = pivotIndicators.classic_pivots || {};
      const camarilla = pivotIndicators.camarilla_pivots || {};
      const bias = pivotIndicators.overall_bias || 'NEUTRAL';
      
      // Primary signal: Supertrend 10-3 (60% of pivot confidence)
      const stSignal = (st10 as any)?.signal || 'NEUTRAL';
      const stTrend = (st10 as any)?.trend || 'NEUTRAL';
      
      // Secondary: Distance to critical levels (40% of pivot confidence)
      const pivot = (classic as any)?.pivot || 0;
      const r2 = (classic as any)?.r2 || 0;
      const s2 = (classic as any)?.s2 || 0;
      const h3 = (camarilla as any)?.h3 || 0;
      const l3 = (camarilla as any)?.l3 || 0;
      
      // Supertrend signal strength
      if (stSignal === 'BUY' && stTrend === 'BULLISH') {
        pivotSignal = 'STRONG_BUY';
        pivotConfidence = 85; // Strong supertrend buy + bullish trend
      } else if (stSignal === 'BUY') {
        pivotSignal = 'BUY';
        pivotConfidence = 70; // Supertrend buy signal
      } else if (stSignal === 'SELL' && stTrend === 'BEARISH') {
        pivotSignal = 'STRONG_SELL';
        pivotConfidence = 85; // Strong supertrend sell + bearish trend
      } else if (stSignal === 'SELL') {
        pivotSignal = 'SELL';
        pivotConfidence = 70; // Supertrend sell signal
      }
      
      // Adjust confidence based on proximity to critical levels
      const nearR2 = r2 && Math.abs(price - r2) / r2 < 0.015; // Within 1.5%
      const nearS2 = s2 && Math.abs(price - s2) / s2 < 0.015;
      const nearH3 = h3 && Math.abs(price - h3) / h3 < 0.015;
      const nearL3 = l3 && Math.abs(price - l3) / l3 < 0.015;
      
      if ((stSignal === 'BUY' && (nearS2 || nearL3)) || (stSignal === 'SELL' && (nearR2 || nearH3))) {
        // Supertrend signal aligned with resistance/support = high confidence
        pivotConfidence = Math.min(95, pivotConfidence + 15);
      } else if ((stSignal === 'BUY' && (nearR2 || nearH3)) || (stSignal === 'SELL' && (nearS2 || nearL3))) {
        // Supertrend signal against nearest level = lower confidence
        pivotConfidence = Math.max(40, pivotConfidence - 20);
      }
      
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // MARKET STRUCTURE - Order Flow, FVG, Order Blocks, Smart Money
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    let marketStructureSignal = 'NEUTRAL';
    let marketStructureConfidence = 50;
    
    if (technical) {
      const indicators = technical.indicators || technical;
      
      // Extract market structure signals
      const fvg_bullish = indicators.fvg_bullish === true;
      const fvg_bearish = indicators.fvg_bearish === true;
      const bos_bullish = indicators.bos_bullish === true;
      const bos_bearish = indicators.bos_bearish === true;
      const order_block_bullish = indicators.order_block_bullish;
      const order_block_bearish = indicators.order_block_bearish;
      
      // Count bullish vs bearish signals
      let bullishSignals = 0;
      let bearishSignals = 0;
      let totalSignalStrength = 0;
      
      // FVG signals (bullish = price moving into gap)
      if (fvg_bullish) { bullishSignals += 2; totalSignalStrength += 2; }
      if (fvg_bearish) { bearishSignals += 2; totalSignalStrength += 2; }
      
      // Break of Structure (strongest signal)
      if (bos_bullish) { bullishSignals += 3; totalSignalStrength += 3; }
      if (bos_bearish) { bearishSignals += 3; totalSignalStrength += 3; }
      
      // Order Blocks (support/resistance structures)
      if (order_block_bullish) { bullishSignals += 2; totalSignalStrength += 2; }
      if (order_block_bearish) { bearishSignals += 2; totalSignalStrength += 2; }
      
      // Determine signal based on net strength
      const netSignal = bullishSignals - bearishSignals;
      
      if (bullishSignals > bearishSignals) {
        // Bullish structure confirmed
        if (bos_bullish) {
          marketStructureSignal = 'STRONG_BUY'; // BreakOut Structure = strong signal
          marketStructureConfidence = 88;
        } else if (bullishSignals >= 4) {
          marketStructureSignal = 'BUY';
          marketStructureConfidence = 78;
        } else {
          marketStructureSignal = 'BUY';
          marketStructureConfidence = 65;
        }
      } else if (bearishSignals > bullishSignals) {
        // Bearish structure confirmed
        if (bos_bearish) {
          marketStructureSignal = 'STRONG_SELL'; // BreakDown Structure = strong signal
          marketStructureConfidence = 88;
        } else if (bearishSignals >= 4) {
          marketStructureSignal = 'SELL';
          marketStructureConfidence = 78;
        } else {
          marketStructureSignal = 'SELL';
          marketStructureConfidence = 65;
        }
      } else if (totalSignalStrength > 0) {
        // Signals present but mixed
        marketStructureConfidence = 55;
      } else {
        // No clear structure signal
        marketStructureConfidence = 45;
      }
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔥 NEW: Extract 5 Additional Component Signals
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // ORB (Opening Range Breakout)
    let orbSignal = 'NEUTRAL';
    let orbConfidence = 0;
    if (orb) {
      orbSignal = orb.signal || orb.orb_signal || 'NEUTRAL';
      orbConfidence = (orb.confidence || orb.orb_confidence || 0) * 100;
    }
    
    // SuperTrend
    let supertrendSignal = 'NEUTRAL';
    let supertrendConfidence = 0;
    if (supertrend) {
      supertrendSignal = supertrend.signal || supertrend.supertrend_signal || 'NEUTRAL';
      supertrendConfidence = (supertrend.confidence || supertrend.st_confidence || 0) * 100;
    }
    
    // Parabolic SAR
    let sarSignal = 'NEUTRAL';
    let sarConfidence = 0;
    if (sar) {
      sarSignal = sar.signal || sar.sar_signal || 'NEUTRAL';
      sarConfidence = (sar.confidence || sar.sar_confidence || 0) * 100;
    }
    
    // Camarilla CPR
    let camarillaSignal = 'NEUTRAL';
    let camarillaConfidence = 0;
    if (camarilla) {
      camarillaSignal = camarilla.signal || camarilla.camarilla_signal || 'NEUTRAL';
      camarillaConfidence = (camarilla.confidence || camarilla.camarilla_confidence || 0) * 100;
    }
    
    // RSI 60/40 Momentum
    let rsi60_40Signal = 'NEUTRAL';
    let rsi60_40Confidence = 0;
    if (rsi60_40) {
      rsi60_40Signal = rsi60_40.rsi_momentum_status || rsi60_40.signal || 'NEUTRAL';
      rsi60_40Confidence = (rsi60_40.rsi_momentum_confidence || rsi60_40.confidence || 0);
    }
    
    // Smart Money Flow (Institutional)
    let smartMoneySignal = 'NEUTRAL';
    let smartMoneyConfidence = 0;
    if (smartMoney) {
      smartMoneySignal = smartMoney.signal || smartMoney.bos_signal || 'NEUTRAL';
      smartMoneyConfidence = (smartMoney.confidence || smartMoney.fvg_confidence || 0) * 100;
    }
    
    // OI Momentum (5m/15m Alignment)
    let oiMomentumSignal = 'NEUTRAL';
    let oiMomentumConfidence = 0;
    if (oiMomentum) {
      oiMomentumSignal = oiMomentum.final_signal || oiMomentum.signal || 'NEUTRAL';
      oiMomentumConfidence = oiMomentum.confidence || 0;
    }

    // Convert signals to confidence-weighted scores (-100 to +100)
    const techScore = signalToScore(finalTechSignal, finalTechConfidence);
    const zoneScore = signalToScore(finalZoneSignal, zoneConfidence);
    const volumeScore = signalToScore(volumeSignal, volumeConfidence);
    const trendScore = signalToScore(trendSignal, trendConfidence);
    const marketStructureScore = signalToScore(marketStructureSignal, marketStructureConfidence);
    const candleScore = signalToScore(finalCandleSignal, finalCandleConfidence);
    const marketIndicesScore = signalToScore(marketIndicesSignal, marketIndicesConfidence);
    const pcrScore = signalToScore(pcrSignal, pcrConfidence);
    const pivotScore = signalToScore(pivotSignal, pivotConfidence);
    // 🔥 NEW: Convert new component signals to scores
    const orbScore = signalToScore(orbSignal, orbConfidence);
    const supertrendScore = signalToScore(supertrendSignal, supertrendConfidence);
    const sarScore = signalToScore(sarSignal, sarConfidence);
    const camarillaScore = signalToScore(camarillaSignal, camarillaConfidence);
    const rsi60_40Score = signalToScore(rsi60_40Signal, rsi60_40Confidence);
    const smartMoneyScore = signalToScore(smartMoneySignal, smartMoneyConfidence);
    const oiMomentumScore = signalToScore(oiMomentumSignal, oiMomentumConfidence);
    
    //  SIMPLIFIED: Calculate weighted average score - NOW WITH 14 COMPONENTS
    const totalWeight = (
      SIGNAL_WEIGHTS.technical +
      SIGNAL_WEIGHTS.zoneControl +
      SIGNAL_WEIGHTS.volumePulse +
      SIGNAL_WEIGHTS.trendBase +
      SIGNAL_WEIGHTS.marketStructure +
      SIGNAL_WEIGHTS.candleIntent +
      SIGNAL_WEIGHTS.marketIndices +
      SIGNAL_WEIGHTS.pcr +
      SIGNAL_WEIGHTS.pivot +
      // 🔥 NEW: 5 Additional Components
      SIGNAL_WEIGHTS.orb +
      SIGNAL_WEIGHTS.supertrend +
      SIGNAL_WEIGHTS.sar +
      SIGNAL_WEIGHTS.camarilla +
      SIGNAL_WEIGHTS.rsi60_40 +
      SIGNAL_WEIGHTS.smartMoney +
      SIGNAL_WEIGHTS.oiMomentum
    );
    
    const totalWeightedScore = (
      (techScore * SIGNAL_WEIGHTS.technical) +
      (zoneScore * SIGNAL_WEIGHTS.zoneControl) +
      (volumeScore * SIGNAL_WEIGHTS.volumePulse) +
      (trendScore * SIGNAL_WEIGHTS.trendBase) +
      (marketStructureScore * SIGNAL_WEIGHTS.marketStructure) +
      (candleScore * SIGNAL_WEIGHTS.candleIntent) +
      (marketIndicesScore * SIGNAL_WEIGHTS.marketIndices) +
      (pcrScore * SIGNAL_WEIGHTS.pcr) +
      (pivotScore * SIGNAL_WEIGHTS.pivot) +
      // 🔥 NEW: 5 Additional Component Scores
      (orbScore * SIGNAL_WEIGHTS.orb) +
      (supertrendScore * SIGNAL_WEIGHTS.supertrend) +
      (sarScore * SIGNAL_WEIGHTS.sar) +
      (camarillaScore * SIGNAL_WEIGHTS.camarilla) +
      (rsi60_40Score * SIGNAL_WEIGHTS.rsi60_40) +
      (smartMoneyScore * SIGNAL_WEIGHTS.smartMoney) +
      (oiMomentumScore * SIGNAL_WEIGHTS.oiMomentum)
    ) / totalWeight;
    
    // Debug log removed for production

    // Calculate overall confidence (0-100) - SEPARATE from signal score - WITH 14 COMPONENTS
    // Confidence = weighted average of individual confidences (not signal scores)
    const overallConfidence = (
      (finalTechConfidence * SIGNAL_WEIGHTS.technical) +
      (zoneConfidence * SIGNAL_WEIGHTS.zoneControl) +
      (volumeConfidence * SIGNAL_WEIGHTS.volumePulse) +
      (trendConfidence * SIGNAL_WEIGHTS.trendBase) +
      (marketStructureConfidence * SIGNAL_WEIGHTS.marketStructure) +
      (finalCandleConfidence * SIGNAL_WEIGHTS.candleIntent) +
      (marketIndicesConfidence * SIGNAL_WEIGHTS.marketIndices) +
      (pcrConfidence * SIGNAL_WEIGHTS.pcr) +
      (pivotConfidence * SIGNAL_WEIGHTS.pivot) +
      // 🔥 NEW: 5 Additional Component Confidences
      (orbConfidence * SIGNAL_WEIGHTS.orb) +
      (supertrendConfidence * SIGNAL_WEIGHTS.supertrend) +
      (sarConfidence * SIGNAL_WEIGHTS.sar) +
      (camarillaConfidence * SIGNAL_WEIGHTS.camarilla) +
      (rsi60_40Confidence * SIGNAL_WEIGHTS.rsi60_40) +
      (smartMoneyConfidence * SIGNAL_WEIGHTS.smartMoney) +
      (oiMomentumConfidence * SIGNAL_WEIGHTS.oiMomentum)
    ) / totalWeight;
    
    // 🔥 BONUS: Add alignment bonus (when signals agree, confidence increases) - NOW 14 SIGNALS
    const allScores = [techScore, zoneScore, volumeScore, trendScore, marketStructureScore, candleScore, marketIndicesScore, pcrScore, pivotScore, orbScore, supertrendScore, sarScore, camarillaScore, rsi60_40Score, smartMoneyScore, oiMomentumScore];
    const bullishCount = allScores.filter(s => s > 0).length;
    const bearishCount = allScores.filter(s => s < 0).length;
    const alignmentBonus = Math.abs(bullishCount - bearishCount) * 2; // +2% per aligned signal (reduced for 14 signals)
    let finalConfidence = Math.min(100, overallConfidence + alignmentBonus);

    // 🔥 TRADER-FRIENDLY THRESHOLDS: More responsive and granular
    let overallSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
    if (totalWeightedScore >= 40) overallSignal = 'STRONG_BUY';     // Strong bullish: 40+
    else if (totalWeightedScore >= 12) overallSignal = 'BUY';       // Moderate bullish: 12-39
    else if (totalWeightedScore <= -40) overallSignal = 'STRONG_SELL'; // Strong bearish: -40 or lower
    else if (totalWeightedScore <= -12) overallSignal = 'SELL';     // Moderate bearish: -39 to -12
    else overallSignal = 'NEUTRAL';                                  // Range: -11 to +11
    
    // Debug log removed for production

    // 🔥 CRITICAL FIX #3: Minimum Confidence Threshold (prevent false signals)
    // Only downgrade to NEUTRAL if confidence is VERY low (< 35%)
    if (finalConfidence < 35 && overallSignal !== 'NEUTRAL') {
      // Debug log removed for production
      overallSignal = 'NEUTRAL';
    }
    
    // 🔥 CRITICAL FIX #4: Data Freshness Check (warn if data is stale)
    let dataFreshnessWarning = '';
    const marketTimestamp = marketIndicesData?.timestamp || new Date().toISOString();
    const dataAge = Date.now() - new Date(marketTimestamp).getTime();
    const isDataStale = dataAge > 300000; // 5 minutes
    
    if (isDataStale && marketStatus !== 'CLOSED') {
      dataFreshnessWarning = ' ⚠️ (Data may be stale - Last update: ' + Math.round(dataAge / 60000) + 'm ago)';
    }

    // 🔥 PERMANENT FIX: Signal Quality Warning (show when limited data)
    let signalQualityWarning = '';
    if (availableSignals < 4 && marketStatus !== 'CLOSED') {
      signalQualityWarning = `\n📊 ${availableSignals}/9 signals - Limited data`;
    }

    // Calculate risk level with MULTI-FACTOR ANALYSIS (not just zone control)
    // Factors: Breakdown Risk, Confidence Spread, Signal Alignment
    let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    const breakdownRisk = zoneControl?.risk_metrics?.breakdown_risk || 50;
    
    // Factor 1: Zone Control breakdown risk (40% weight)
    let riskScore = breakdownRisk * 0.4;
    
    // Factor 2: Confidence alignment (30% weight)
    const avgConfidence = (techConfidence + zoneConfidence + volumeConfidence + trendConfidence + marketIndicesConfidence) / 5;
    const confidenceSpread = Math.max(techConfidence, zoneConfidence, volumeConfidence, trendConfidence, marketIndicesConfidence) - 
                             Math.min(techConfidence, zoneConfidence, volumeConfidence, trendConfidence, marketIndicesConfidence);
    // High spread = high risk (conflicting signals)
    riskScore += (confidenceSpread * 0.3);
    
    // Factor 3: Signal alignment (30% weight) - reuse bullishCount/bearishCount from above
    const alignmentRisk = Math.abs(bullishCount - bearishCount) < 2 ? 70 : 30; // Mixed signals = higher risk
    riskScore += (alignmentRisk * 0.3);
    
    // Final risk level
    if (riskScore >= 65) {
      riskLevel = 'HIGH';
    } else if (riskScore <= 40) {
      riskLevel = 'LOW';
    } else {
      riskLevel = 'MEDIUM';
    }
    
    // Debug log to verify calculation
    // Debug log removed for production
    // console.log(`[RISK-DEBUG] Breakdown Risk: ${breakdownRisk}% → Risk Level: ${riskLevel}`);

    // Generate TRADER-FRIENDLY recommendation with clear action steps
    // 🔥🔥🔥 MASTER TRADE VALIDATION - 10 GOLDEN RULES STATUS
    let tradeRecommendation = '';
    const scoreDisplay = totalWeightedScore >= 0 ? `+${totalWeightedScore.toFixed(1)}` : totalWeightedScore.toFixed(1);
    const riskEmoji = riskLevel === 'LOW' ? '🟢' : riskLevel === 'MEDIUM' ? '🟡' : '🔴';
    
    // Build Master Trade Status indicator
    let masterTradeIndicator = '';
    if (isMasterTradeQualified) {
      masterTradeIndicator = `\n🏆 MASTER TRADE QUALIFIED (${rulesPassed}/9 Rules ✅)\n   Big 3: Trend ✅ • Candle ✅ • Zone ✅`;
    } else if (isPartiallyQualified) {
      const failedRules: string[] = [];
      if (!rule1_trendStructureValid) failedRules.push('Trend Structure');
      if (!rule2_trendActive) failedRules.push('Trend Active');
      if (!rule3_candleBuySignal) failedRules.push('Candle Signal');
      if (!rule7_breakdownLow) failedRules.push('Breakdown Risk');
      masterTradeIndicator = `\n⚡ PARTIAL SETUP (${rulesPassed}/9 Rules)\n   Missing: ${failedRules.slice(0, 2).join(', ')}`;
    } else if (rulesPassed >= 3) {
      masterTradeIndicator = `\n⏳ BUILDING (${rulesPassed}/9 Rules) - Wait for alignment`;
    }
    
    // Combine indicators
    const combinedIndicators = masterTradeIndicator;
    
    if (isMasterTradeQualified && overallSignal === 'STRONG_BUY') {
      tradeRecommendation = `🏆 MASTER TRADE • PERFECT ENTRY!\n${riskEmoji} Risk ${breakdownRisk}% • 💪 ${Math.round(finalConfidence)}% • ${rulesPassed}/9 Rules${combinedIndicators}` + dataFreshnessWarning;
    } else if (isMasterTradeQualified && (overallSignal === 'BUY' || overallSignal === 'NEUTRAL')) {
      tradeRecommendation = `🏆 MASTER TRADE READY • Enter Now!\n${riskEmoji} Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}% • ${rulesPassed}/9 Rules${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_BUY' && riskLevel === 'LOW') {
      tradeRecommendation = `🚀 STRONG BUY • Great Setup!\n${riskEmoji} Risk ${breakdownRisk}% • 💪 ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_BUY' && riskLevel === 'MEDIUM') {
      tradeRecommendation = `🚀 STRONG BUY • Good Setup!\n${riskEmoji} Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_BUY' && riskLevel === 'HIGH') {
      tradeRecommendation = `⚠️ BUY WITH CAUTION\n${riskEmoji} HIGH Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'BUY' && riskLevel === 'LOW') {
      tradeRecommendation = `✅ BUY OPPORTUNITY\n${riskEmoji} Safe Zone • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'BUY' && riskLevel === 'MEDIUM') {
      tradeRecommendation = `✅ BUY SIGNAL\n${riskEmoji} Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'BUY' && riskLevel === 'HIGH') {
      tradeRecommendation = `⚡ BUY (RISKY) • Use Stop-Loss!\n${riskEmoji} Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_SELL' && riskLevel === 'HIGH') {
      tradeRecommendation = `🔻 STRONG SELL • Exit NOW!\n${riskEmoji} Breakdown ${breakdownRisk}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_SELL') {
      tradeRecommendation = `🔻 STRONG SELL • Bearish!\n${riskEmoji} Risk ${breakdownRisk}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'SELL' && riskLevel === 'HIGH') {
      tradeRecommendation = `⚠️ SELL • Weakness!\n${riskEmoji} High Risk ${breakdownRisk}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (overallSignal === 'SELL') {
      tradeRecommendation = `⚠️ SELL • Bearish!\n${riskEmoji} Risk ${breakdownRisk}%${combinedIndicators}` + dataFreshnessWarning;
    } else if (finalConfidence < 35) {
      tradeRecommendation = `⏸️ WAIT • Signals Unclear\n${Math.round(finalConfidence)}% Confidence${combinedIndicators}` + dataFreshnessWarning + signalQualityWarning;
    } else if (totalWeightedScore >= 5 && totalWeightedScore < 12) {
      tradeRecommendation = `🟨 WEAK BULLISH • Wait\n${riskEmoji} ${breakdownRisk}% Risk • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning + signalQualityWarning;
    } else if (totalWeightedScore <= -5 && totalWeightedScore > -12) {
      tradeRecommendation = `🟦 WEAK BEARISH • Cautious\n${riskEmoji} ${breakdownRisk}% Risk${combinedIndicators}` + dataFreshnessWarning + signalQualityWarning;
    } else {
      tradeRecommendation = `⏸️ NEUTRAL • Wait for Setup\n${riskEmoji} ${breakdownRisk}% Risk • ${Math.round(finalConfidence)}%${combinedIndicators}` + dataFreshnessWarning + signalQualityWarning;
    }

    // 🔥 PIVOT CRITICAL ALERTS - Detect crossing and touching patterns
    let pivotCriticalAlert = {
      isCrossing: false,
      isTouchingPivot: false,
      touchCount: 0,
      crossingType: 'NONE' as 'BUY_CROSS' | 'SELL_CROSS' | 'NONE',
      nearestLevel: '',
      sharpHighlight: false
    };

    if (pivotIndicators && pivotIndicators.status !== 'OFFLINE') {
      const price = pivotIndicators.current_price || 0;
      const st10 = pivotIndicators.supertrend_10_3 || {};
      const classic = pivotIndicators.classic_pivots || {};
      const camarilla = pivotIndicators.camarilla_pivots || {};
      const bias = pivotIndicators.overall_bias || 'NEUTRAL';
      
      // Detect Supertrend crossing
      const isSupertrend10Crossing = st10.signal && (st10.signal === 'BUY' || st10.signal === 'SELL');
      const superTrendValue = st10.value || 0;
      const crossingSignal = st10.signal || 'NONE';
      
      // Detect price near pivot levels (within 0.5%)
      const pivot = classic.pivot || 0;
      const support1 = classic.support1 || 0;
      const resistance1 = classic.resistance1 || 0;
      const touchThreshold = price * 0.005; // 0.5% threshold
      
      const nearPivot = pivot && Math.abs(price - pivot) <= touchThreshold;
      const nearS1 = support1 && Math.abs(price - support1) <= touchThreshold;
      const nearR1 = resistance1 && Math.abs(price - resistance1) <= touchThreshold;
      const isTouchingPivot = nearPivot || nearS1 || nearR1;
      
      // Determine nearest level
      let nearestLevel = '';
      if (nearPivot) nearestLevel = 'PIVOT';
      else if (nearS1) nearestLevel = 'SUPPORT-1';
      else if (nearR1) nearestLevel = 'RESISTANCE-1';
      
      // Detect zone touches (Camarilla H3/L3 multiple touches = strong signals)
      const h3 = camarilla.h3 || 0;
      const l3 = camarilla.l3 || 0;
      const nearH3 = h3 && Math.abs(price - h3) <= touchThreshold;
      const nearL3 = l3 && Math.abs(price - l3) <= touchThreshold;
      
      // Touch count: How many times in critical zones
      const touchCount = [nearPivot, nearS1, nearR1, nearH3, nearL3].filter(Boolean).length;
      
      // Sharp highlight conditions:
      // 1. Supertrend crosses BUY (green highlight)
      // 2. Supertrend crosses SELL (red highlight)
      // 3. Price touches pivot/support/resistance MULTIPLE times (yellow sharp)
      const stCrossBuy = isSupertrend10Crossing && crossingSignal === 'BUY';
      const stCrossSell = isSupertrend10Crossing && crossingSignal === 'SELL';
      const multipleTouches = touchCount >= 2;
      
      pivotCriticalAlert = {
        isCrossing: isSupertrend10Crossing,
        isTouchingPivot: isTouchingPivot || multipleTouches,
        touchCount: touchCount,
        crossingType: (stCrossBuy ? 'BUY_CROSS' : stCrossSell ? 'SELL_CROSS' : 'NONE') as 'BUY_CROSS' | 'SELL_CROSS' | 'NONE',
        nearestLevel: nearestLevel,
        sharpHighlight: stCrossBuy || stCrossSell || multipleTouches
      };
      
    }

    return {
      overallConfidence: Math.round(finalConfidence),
      overallSignal,
      tradeRecommendation,
      signalBreakdown: {
        technical: { 
          signal: finalTechSignal,
          confidence: Math.round(finalTechConfidence), 
          weight: SIGNAL_WEIGHTS.technical 
        },
        zoneControl: { 
          signal: finalZoneSignal, 
          confidence: Math.round(zoneConfidence), 
          weight: SIGNAL_WEIGHTS.zoneControl 
        },
        volumePulse: { 
          signal: volumeSignal, 
          confidence: Math.round(volumeConfidence), 
          weight: SIGNAL_WEIGHTS.volumePulse 
        },
        trendBase: { 
          signal: trendSignal, 
          confidence: Math.round(trendConfidence), 
          weight: SIGNAL_WEIGHTS.trendBase 
        },
        marketStructure: {
          signal: marketStructureSignal,
          confidence: Math.round(marketStructureConfidence),
          weight: SIGNAL_WEIGHTS.marketStructure
        },
        candleIntent: {
          signal: finalCandleSignal,
          confidence: Math.round(finalCandleConfidence),
          weight: SIGNAL_WEIGHTS.candleIntent
        },
        marketIndices: {
          signal: marketIndicesSignal,
          confidence: Math.round(marketIndicesConfidence),
          weight: SIGNAL_WEIGHTS.marketIndices
        },
        pcr: {
          signal: pcrSignal,
          confidence: Math.round(pcrConfidence),
          weight: SIGNAL_WEIGHTS.pcr
        },
        pivot: {
          signal: pivotSignal,
          confidence: Math.round(pivotConfidence),
          weight: SIGNAL_WEIGHTS.pivot
        },
        // 🔥 NEW: 5 Additional Components for 14-Signal Integration
        orb: {
          signal: orbSignal,
          confidence: Math.round(orbConfidence),
          weight: SIGNAL_WEIGHTS.orb
        },
        supertrend: {
          signal: supertrendSignal,
          confidence: Math.round(supertrendConfidence),
          weight: SIGNAL_WEIGHTS.supertrend
        },
        sar: {
          signal: sarSignal,
          confidence: Math.round(sarConfidence),
          weight: SIGNAL_WEIGHTS.sar
        },
        camarilla: {
          signal: camarillaSignal,
          confidence: Math.round(camarillaConfidence),
          weight: SIGNAL_WEIGHTS.camarilla
        },
        rsi60_40: {
          signal: rsi60_40Signal,
          confidence: Math.round(rsi60_40Confidence),
          weight: SIGNAL_WEIGHTS.rsi60_40
        },
        smartMoney: {
          signal: smartMoneySignal,
          confidence: Math.round(smartMoneyConfidence),
          weight: SIGNAL_WEIGHTS.smartMoney
        },
        oiMomentum: {
          signal: oiMomentumSignal,
          confidence: Math.round(oiMomentumConfidence),
          weight: SIGNAL_WEIGHTS.oiMomentum
        },
      },
      // 🔥 9 GOLDEN RULES - Master Trade Status
      masterTradeStatus: {
        qualified: isMasterTradeQualified,
        rulesPassed: rulesPassed,
        rules: {
          rule1_trendStructure: rule1_trendStructureValid,
          rule2_trendActive: rule2_trendActive,
          rule3_candleBuy: rule3_candleBuySignal,
          rule4_volumeEfficiency: rule4_volumeEfficiency,
          rule5_volumePulse: rule5_volumePulseOk,
          rule6_nearSupport: rule6_nearSupport,
          rule7_breakdownLow: rule7_breakdownLow,
          rule8_momentum: rule8_momentumBullish,
          rule9_bigThreeAlign: rule9_allThreeAlign
        }
      },
      riskLevel,
      breakdownRiskPercent: breakdownRisk, // Include the actual percentage
      timestamp: new Date().toISOString(),
      // 🔥 PIVOT CRITICAL ALERTS
      pivotCriticalAlert,
    };
  }, []);

  // 🔥🔥🔥 INSTANT - First load from ws/cache (same as Live Market Indices - INSTANT!)
  const fetchInstantData = useCallback(async (symbol: string) => {
    try {
      const res = await Promise.race([
        fetch(`${API_BASE_URL}/ws/cache/${symbol}`, { cache: 'no-store' }),
        new Promise<Response>((_, reject) => setTimeout(() => reject(null), 300))
      ]);
      if (res.ok) {
        const data = await res.json();
        return data?.data || null;
      }
    } catch {}
    return null;
  }, []);

  // 🔥🔥🔥 ULTRA FAST: Use single aggregated endpoint instead of 7 separate calls!
  const fetchFullSymbolData = useCallback(async (symbol: string) => {
    const quickFetch = (url: string) => 
      Promise.race([
        fetch(url, { cache: 'no-store' }).then(r => {
          if (!r.ok) {
            console.error(`[OUTLOOK-${symbol}] Fetch failed for ${url}:`, r.status);
            return null;
          }
          return r.json();
        }).catch(err => {
          console.error(`[OUTLOOK-${symbol}] Error fetching ${url}:`, err);
          return null;
        }),
        new Promise<null>(r => setTimeout(() => {
          console.warn(`[OUTLOOK-${symbol}] Timeout for ${url}`);
          r(null);
        }, 15000)) // 🔥 Increased to 15 seconds for slow endpoints
      ]);

    // 🚀 OPTIMIZATION: Fetch ALL analysis endpoints in parallel (14 signals!)
    const [tech, allAdvanced, market, pivotData, orb, supertrend, sar, camarilla, rsi60_40, smartMoney, oiMomentum] = await Promise.all([
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`),
      quickFetch(`${API_BASE_URL}/api/advanced/all-analysis/${symbol}`), // ⚡ Zone, Volume, Trend, Candle
      quickFetch(`${API_BASE_URL}/ws/cache/${symbol}`).then(d => d?.data || null),
      quickFetch(`${API_BASE_URL}/api/advanced/pivot-indicators`).then(d => d?.[symbol] || null), // Pivot + Supertrend
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`).then(d => d?.orb || null), // ORB from analyze
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`).then(d => d?.supertrend || null), // SuperTrend from analyze
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`).then(d => d?.sar || null), // SAR from analyze
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`).then(d => d?.camarilla || null), // Camarilla from analyze
      quickFetch(`${API_BASE_URL}/api/analysis/rsi-momentum/${symbol}`), // RSI 60/40 dedicated endpoint
      quickFetch(`${API_BASE_URL}/api/analysis/smart-money/${symbol}`), // Smart Money dedicated endpoint
      quickFetch(`${API_BASE_URL}/api/analysis/oi-momentum/${symbol}`), // OI Momentum dedicated endpoint
    ]);

    // Extract individual sections from aggregated response
    const zone = allAdvanced?.zone_control || null;
    const volume = allAdvanced?.volume_pulse || null;
    const trend = allAdvanced?.trend_base || null;
    const candle = allAdvanced?.candle_intent || null;

    const result = calculateOverallOutlook(tech, zone, volume, trend, candle, market, pivotData, orb, supertrend, sar, camarilla, rsi60_40, smartMoney, oiMomentum);
    return result;
  }, [calculateOverallOutlook]);

  // 🔥 ALWAYS UPDATE - No cache, show real data immediately
  const silentUpdate = useCallback((symbol: keyof OverallOutlookData, newData: SymbolOutlook | null) => {
    if (!newData) return;
    
    // Direct state update - no global cache
    setOutlookData(prev => ({ ...prev, [symbol]: newData }));
  }, []);

  // 🔥🔥🔥 PRODUCTION: Fetch ONCE, keep values stable
  const fetchAllAnalysis = useCallback(async () => {
    const now = Date.now();
    if (isFetching) return;
    
    isFetching = true;
    lastFetchTime = now;

    // 🔥 FETCH ONCE: Get initial data and keep it stable
    try {
      // Fetch all 3 symbols in parallel
      const results = await Promise.all([
        fetchFullSymbolData('NIFTY').then(data => {
          if (data) silentUpdate('NIFTY', data);
          return data;
        }),
        fetchFullSymbolData('BANKNIFTY').then(data => {
          if (data) silentUpdate('BANKNIFTY', data);
          return data;
        }),
        fetchFullSymbolData('SENSEX').then(data => {
          if (data) silentUpdate('SENSEX', data);
          return data;
        }),
      ]);
      
    } catch (error) {
      console.error('[OUTLOOK] Fetch error:', error);
    } finally {
      isFetching = false;
      setLoading(false); // Data loaded, stop showing loading state
    }
  }, [fetchFullSymbolData, silentUpdate]);

  useEffect(() => {
    // Clear all browser storage
    try {
      localStorage.removeItem('mytradingsignal_last_outlook_data');
      sessionStorage.removeItem('mytradingsignal_last_outlook_data');
    } catch {}
    
    // Reset state to 0%
    setOutlookData({
      NIFTY: createDefaultOutlook('NIFTY'),
      BANKNIFTY: createDefaultOutlook('BANKNIFTY'),
      SENSEX: createDefaultOutlook('SENSEX')
    });
    
    lastFetchTime = 0;
    isFetching = false;
    
    fetchAllAnalysis();
    
    // 🔥 VISIBILITY CHANGE: Don't refetch when switching tabs
    // Only fetch on initial mount - let WebSocket handle live updates
    const handleVisibilityChange = () => {
      // Do nothing - prevent unnecessary refetches on tab switch
      // WebSocket handles all live updates automatically
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchAllAnalysis]);

  return { outlookData, loading };
};

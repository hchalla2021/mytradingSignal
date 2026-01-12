/**
 * useOverallMarketOutlook - Aggregated Market Analysis
 * Combines ALL analysis sections to determine overall trading confidence
 * 
 * Data Sources:
 * 1. Technical Analysis (VWAP, EMA, Support/Resistance)
 * 2. Zone Control (Breakdown Risk, Bounce Probability)
 * 3. Volume Pulse (Green/Red Candle Volume Ratio)
 * 4. Trend Base (Higher-Low Structure)
 * // 5. AI Analysis (GPT-4 Signal Strength) - COMMENTED OUT
 */

'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';

interface SignalWeight {
  technical: number;
  zoneControl: number;
  volumePulse: number;
  trendBase: number;
  candleIntent: number; // Candle structure patterns - Professional signals
  marketIndices: number; // Live Market Indices momentum
  pcr: number; // Put-Call Ratio - Market sentiment indicator
  earlyWarning: number; // Early Warning predictive signals - Pre-move detection
  // ai: number; // COMMENTED OUT - Not required
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
    candleIntent: { signal: string; confidence: number; weight: number };
    marketIndices: { signal: string; confidence: number; weight: number };
    pcr: { signal: string; confidence: number; weight: number };
    earlyWarning: { 
      signal: string; 
      confidence: number; 
      weight: number; 
      timeToTrigger?: number; 
      riskLevel?: string;
      qualified?: boolean;
      volumeBuildupActive?: boolean;
      volumeBuildupStrength?: number;
      momentumDirection?: string;
      momentumConsistency?: number;
      momentumAligned?: boolean;
      trendStructure?: string;
      trendIntegrity?: number;
      trendStructureAligned?: boolean;
    };
  };
  // 🔥 MASTER TRADE - 10 Golden Rules Status
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
      rule8_earlyWarning: boolean;
      rule9_momentum: boolean;
      rule10_bigThreeAlign: boolean;
    };
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdownRiskPercent: number;
  timestamp: string;
}

interface OverallOutlookData {
  NIFTY: SymbolOutlook | null;
  BANKNIFTY: SymbolOutlook | null;
  SENSEX: SymbolOutlook | null;
}

// 🔥 FIX: Use correct API URL with fallback
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'https://mydailytradesignals.com';
const SYMBOLS = (process.env.NEXT_PUBLIC_MARKET_SYMBOLS || 'NIFTY,BANKNIFTY,SENSEX').split(',').filter(Boolean);

// Signal strength weights (total = 100%) - AI REMOVED, Candle Intent, Market Indices, PCR & Early Warning ADDED
const SIGNAL_WEIGHTS: SignalWeight = {
  technical: 20,       // 20% weight - Core technical indicators
  zoneControl: 16,     // 16% weight - Support/Resistance zones
  volumePulse: 16,     // 16% weight - Volume analysis
  trendBase: 12,       // 12% weight - Trend structure
  candleIntent: 14,    // 14% weight - Candle patterns (rejection, absorption, breakout)
  marketIndices: 8,    // 8% weight - Live price momentum from indices
  pcr: 6,              // 6% weight - Put-Call Ratio (market sentiment)
  earlyWarning: 8,     // 8% weight - Pre-move detection (momentum buildup, volume accumulation)
  // ai: 10,           // COMMENTED OUT - Not required
};

// 🔥🔥🔥 INSTANT DEFAULT VALUES - Start at 0%, load real data immediately
const createDefaultOutlook = (symbol: string): SymbolOutlook => ({
  overallConfidence: 0,
  overallSignal: 'NEUTRAL',
  tradeRecommendation: '⏳ Calculating...',
  signalBreakdown: {
    technical: { signal: 'NEUTRAL', confidence: 0, weight: 20 },
    zoneControl: { signal: 'NEUTRAL', confidence: 0, weight: 16 },
    volumePulse: { signal: 'NEUTRAL', confidence: 0, weight: 16 },
    trendBase: { signal: 'NEUTRAL', confidence: 0, weight: 12 },
    candleIntent: { signal: 'NEUTRAL', confidence: 0, weight: 14 },
    marketIndices: { signal: 'NEUTRAL', confidence: 0, weight: 8 },
    pcr: { signal: 'NEUTRAL', confidence: 0, weight: 6 },
    earlyWarning: { signal: 'WAIT', confidence: 0, weight: 8 },
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
      rule8_earlyWarning: false,
      rule9_momentum: false,
      rule10_bigThreeAlign: false,
    },
  },
  riskLevel: 'MEDIUM',
  breakdownRiskPercent: 50,
  timestamp: new Date().toISOString(),
});

// 🔥 GLOBAL CACHE - ALWAYS RESET TO 0% ON IMPORT
let globalCache: OverallOutlookData = { 
  NIFTY: createDefaultOutlook('NIFTY'), 
  BANKNIFTY: createDefaultOutlook('BANKNIFTY'), 
  SENSEX: createDefaultOutlook('SENSEX') 
};
let lastFetchTime = 0;
let isFetching = false;

// 🔥 FORCE RESET: Clear any cached values on module load
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem('mytradingsignal_last_outlook_data');
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

  // Calculate aggregated confidence score
  const calculateOverallOutlook = useCallback((
    technical: any,
    zoneControl: any,
    volumePulse: any,
    trendBase: any,
    candleIntent: any,    // Candle structure patterns
    marketIndicesData: any, // Live Market Indices momentum
    earlyWarning: any     // Early Warning predictive signals
    // ai: any // COMMENTED OUT - Not required
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
      candleIntent?.professional_signal || candleIntent?.signal,  // Check both fields
      marketIndicesData?.change !== undefined,
      marketIndicesData?.pcr !== undefined && marketIndicesData?.pcr > 0,
      earlyWarning?.signal
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

    // 🔥🔥🔥 EARLY WARNING - STRICT 7-CONDITION VALIDATION 🔥🔥🔥
    // ALL 7 CONDITIONS MUST BE MET FOR QUALIFIED STATUS:
    // 1. Risk = LOW
    // 2. Signal = BUY or SELL (not WAIT)
    // 3. Volume Buildup = ACTIVE (is_building=true AND buildup_strength >= 30%)
    // 4. Momentum Direction = BULLISH (for BUY) or BEARISH (for SELL)
    // 5. Momentum Consistency >= 65%
    // 6. Trend Structure = Higher High + Higher Low (for BUY) or Lower High + Lower Low (for SELL)
    // 7. Trend Integrity >= 65%
    
    // Extract Early Warning data
    const rawEarlyWarningSignal = earlyWarning?.signal || 'WAIT';
    const earlyWarningConfidence = earlyWarning?.confidence || 0;
    const earlyWarningTimeToTrigger = earlyWarning?.time_to_trigger || 0;
    const earlyWarningRisk = earlyWarning?.fake_signal_risk || 'HIGH';
    const volumeBuildup = earlyWarning?.volume_buildup || { is_building: false, buildup_strength: 0 };
    const momentum = earlyWarning?.momentum || { direction: 'NEUTRAL', consistency: 0 };
    
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
    
    // Condition checks (1-5)
    const isVolumeBuildupActive = volumeBuildup.is_building && volumeBuildup.buildup_strength >= 30;
    const isMomentumBullish = momentum.direction === 'BULLISH';
    const isMomentumBearish = momentum.direction === 'BEARISH';
    const isMomentumConsistent = (momentum.consistency || 0) >= 65;
    
    // Condition checks (6-7): Trend Structure validation
    // For BUY: Need Higher High + Higher Low structure (uptrend)
    // For SELL: Need Lower High + Lower Low structure (downtrend)
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
    
    // Convert EARLY_BUY/EARLY_SELL to standard BUY/SELL signals
    const earlyWarningSignal = rawEarlyWarningSignal === 'EARLY_BUY' ? 'BUY' : 
                               rawEarlyWarningSignal === 'EARLY_SELL' ? 'SELL' : 'WAIT';
    
    // 🔥 STRICT VALIDATION: ALL 7 CONDITIONS MUST BE MET
    let adjustedEarlyWarningConfidence = 0; // Default to 0 (IGNORE)
    let earlyWarningWeight = 0; // Default to 0 weight
    let earlyWarningQualified = false;
    
    const isLowRisk = earlyWarningRisk === 'LOW';
    const hasActiveSignal = earlyWarningSignal === 'BUY' || earlyWarningSignal === 'SELL';
    
    // For BUY signal: Momentum must be BULLISH
    // For SELL signal: Momentum must be BEARISH
    const isMomentumAligned = (earlyWarningSignal === 'BUY' && isMomentumBullish) || 
                              (earlyWarningSignal === 'SELL' && isMomentumBearish);
    
    // For BUY signal: Trend must be Uptrend (HH+HL)
    // For SELL signal: Trend must be Downtrend (LH+LL)
    const isTrendStructureAligned = (earlyWarningSignal === 'BUY' && isUptrendStructure) || 
                                    (earlyWarningSignal === 'SELL' && isDowntrendStructure);
    
    // ALL 7 CONDITIONS CHECK
    const allConditionsMet = isLowRisk && hasActiveSignal && isVolumeBuildupActive && 
                             isMomentumAligned && isMomentumConsistent && 
                             isTrendStructureAligned && isTrendIntegrityStrong;
    
    if (allConditionsMet) {
      // ✅✅✅✅✅✅✅ ALL 7 CONDITIONS MET - FULL INTEGRATION
      earlyWarningQualified = true;
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 1.5; // +50% boost for fully qualified signal
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 3; // 3x weight for qualified signal
      
      // EXTRA BOOST: Imminent trigger (< 3 minutes)
      if (earlyWarningTimeToTrigger > 0 && earlyWarningTimeToTrigger <= 3) {
        adjustedEarlyWarningConfidence *= 1.4; // +40% boost for imminent trigger
        earlyWarningWeight *= 1.3; // +30% more weight
      }
      
      // EXTRA BOOST: Strong volume buildup (>= 60%)
      if (volumeBuildup.buildup_strength >= 60) {
        adjustedEarlyWarningConfidence *= 1.2; // +20% boost for strong volume
      }
      
      // EXTRA BOOST: Very high momentum consistency (>= 80%)
      if ((momentum.consistency || 0) >= 80) {
        adjustedEarlyWarningConfidence *= 1.15; // +15% boost for strong consistency
      }
      
      // EXTRA BOOST: Very high trend integrity (>= 80%)
      if (trendIntegrity >= 80) {
        adjustedEarlyWarningConfidence *= 1.15; // +15% boost for strong trend
      }
    } else if (isLowRisk && hasActiveSignal && isVolumeBuildupActive && isMomentumAligned && isMomentumConsistent && !isTrendStructureAligned) {
      // ⚠️ 5/7 conditions met but trend structure not aligned = Heavily reduced
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.15; // -85% penalty
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.15; // 15% weight
    } else if (isLowRisk && hasActiveSignal && isVolumeBuildupActive && isMomentumAligned && isMomentumConsistent && !isTrendIntegrityStrong) {
      // ⚠️ 6/7 conditions met but trend integrity too low = Reduced
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.3; // -70% penalty
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.3; // 30% weight
    } else if (isLowRisk && hasActiveSignal && isVolumeBuildupActive && !isMomentumAligned) {
      // ⚠️ Momentum direction wrong = Heavily reduced
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.1; // -90% penalty
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.1; // 10% weight
    } else if (isLowRisk && hasActiveSignal && isVolumeBuildupActive && !isMomentumConsistent) {
      // ⚠️ Momentum not consistent enough = Reduced
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.25; // -75% penalty
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.25; // 25% weight
    } else if (isLowRisk && hasActiveSignal && !isVolumeBuildupActive) {
      // ⚠️ LOW RISK + Signal but NO Volume Buildup = Reduced confidence
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.1; // -90% penalty
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.1; // 10% weight
    } else if (isLowRisk && !hasActiveSignal) {
      // ⏳ LOW RISK but WAIT signal = Minor inclusion (preparing)
      adjustedEarlyWarningConfidence = earlyWarningConfidence * 0.02; // -98% (almost ignored)
      earlyWarningWeight = SIGNAL_WEIGHTS.earlyWarning * 0.02;
    } else {
      // 🔴 MEDIUM/HIGH RISK = COMPLETELY IGNORE
      adjustedEarlyWarningConfidence = 0;
      earlyWarningWeight = 0;
    }
    
    adjustedEarlyWarningConfidence = Math.min(100, adjustedEarlyWarningConfidence); // Cap at 100

    // ═══════════════════════════════════════════════════════════════════════════════
    // 🔥🔥🔥 MASTER TRADE VALIDATION - 10 GOLDEN RULES 🔥🔥🔥
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
    const candleVolumeEfficiency = candleIntent?.volume_efficiency || candleIntent?.pattern?.volume_efficiency || 0;
    
    // Rule 3: Signal = BUY/STRONG_BUY, Body = STRONG, Confidence ≥ 80%
    const rule3_candleBuySignal = (candleSignal === 'BUY' || candleSignal === 'STRONG_BUY' || candleSignal === 'BULLISH') && 
                                   candleConfidence >= 80 &&
                                   (candleBodyStructure === 'STRONG' || candleBodyStructure === 'STRONG_BODY' || candleBodyStructure.includes('STRONG'));
    // Rule 4: Volume Efficiency ≥ 2x average
    const rule4_volumeEfficiency = candleVolumeEfficiency >= 2;
    
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
    // RULE 8, 9: EARLY WARNING - Already validated above (7 conditions)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const rule8_earlyWarningLowRisk = earlyWarningQualified; // Already has all 7 conditions
    const rule9_momentumBullish = isMomentumBullish && isMomentumConsistent;
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // RULE 10: FINAL ALIGNMENT CHECK - The Big 3 Must Agree
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const big3_trendBaseAligned = rule1_trendStructureValid && rule2_trendActive;
    const big3_candleIntentAligned = rule3_candleBuySignal; // Rule 4 is bonus
    const big3_zoneControlAligned = rule7_breakdownLow && bounceProb > breakdownProb;
    
    const rule10_allThreeAlign = big3_trendBaseAligned && big3_candleIntentAligned && big3_zoneControlAligned;
    
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
      rule8: rule8_earlyWarningLowRisk,
      rule9: rule9_momentumBullish,
      rule10: rule10_allThreeAlign
    };
    
    const rulesPassed = Object.values(rulesStatus).filter(Boolean).length;
    const isMasterTradeQualified = rulesPassed >= 7 && rule10_allThreeAlign; // Need 7+ rules AND Big 3 aligned
    const isPartiallyQualified = rulesPassed >= 5 && big3_zoneControlAligned; // 5+ rules with safe zone

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

    // Convert signals to confidence-weighted scores (-100 to +100)
    const techScore = signalToScore(techSignal, techConfidence);
    const zoneScore = signalToScore(zoneSignal, zoneConfidence);
    const volumeScore = signalToScore(volumeSignal, volumeConfidence);
    const trendScore = signalToScore(trendSignal, trendConfidence);
    const candleScore = signalToScore(candleSignal, candleConfidence);
    const marketIndicesScore = signalToScore(marketIndicesSignal, marketIndicesConfidence);
    const pcrScore = signalToScore(pcrSignal, pcrConfidence);
    const earlyWarningScore = signalToScore(earlyWarningSignal, adjustedEarlyWarningConfidence);
    // const aiScore = signalToScore(aiSignal, aiConfidence); // COMMENTED OUT
    
    // 🔍 DEBUG logs for troubleshooting
    console.log('[OUTLOOK-CALC] Signal Confidences:', {
      tech: techConfidence,
      zone: zoneConfidence,
      volume: volumeConfidence,
      trend: trendConfidence,
      candle: candleConfidence,
      market: marketIndicesConfidence,
      pcr: pcrConfidence,
      warning: adjustedEarlyWarningConfidence
    });
    console.log('[OUTLOOK-CALC] Available signals:', availableSignals + '/8');

    // 🔥 SIMPLIFIED: Calculate weighted average score (scores already confidence-adjusted)
    // 🔥 DYNAMIC WEIGHT CALCULATION: Adjust for LOW RISK Early Warning boost
    const totalWeight = (
      SIGNAL_WEIGHTS.technical +
      SIGNAL_WEIGHTS.zoneControl +
      SIGNAL_WEIGHTS.volumePulse +
      SIGNAL_WEIGHTS.trendBase +
      SIGNAL_WEIGHTS.candleIntent +
      SIGNAL_WEIGHTS.marketIndices +
      SIGNAL_WEIGHTS.pcr +
      earlyWarningWeight // Use dynamic weight (boosted for LOW RISK)
    );
    
    const totalWeightedScore = (
      (techScore * SIGNAL_WEIGHTS.technical) +
      (zoneScore * SIGNAL_WEIGHTS.zoneControl) +
      (volumeScore * SIGNAL_WEIGHTS.volumePulse) +
      (trendScore * SIGNAL_WEIGHTS.trendBase) +
      (candleScore * SIGNAL_WEIGHTS.candleIntent) +
      (marketIndicesScore * SIGNAL_WEIGHTS.marketIndices) +
      (pcrScore * SIGNAL_WEIGHTS.pcr) +
      (earlyWarningScore * earlyWarningWeight) // Use dynamic weight
      // + (aiScore * SIGNAL_WEIGHTS.ai) // COMMENTED OUT
    ) / totalWeight; // Divide by dynamic total weight
    
    // Debug log removed for production

    // Calculate overall confidence (0-100) - SEPARATE from signal score
    // Confidence = weighted average of individual confidences (not signal scores)
    // 🔥 DYNAMIC WEIGHT: Use earlyWarningWeight for LOW RISK boost
    const overallConfidence = (
      (techConfidence * SIGNAL_WEIGHTS.technical) +
      (zoneConfidence * SIGNAL_WEIGHTS.zoneControl) +
      (volumeConfidence * SIGNAL_WEIGHTS.volumePulse) +
      (trendConfidence * SIGNAL_WEIGHTS.trendBase) +
      (candleConfidence * SIGNAL_WEIGHTS.candleIntent) +
      (marketIndicesConfidence * SIGNAL_WEIGHTS.marketIndices) +
      (pcrConfidence * SIGNAL_WEIGHTS.pcr) +
      (adjustedEarlyWarningConfidence * earlyWarningWeight) // Dynamic weight
    ) / totalWeight; // Use dynamic total weight
    
    // 🔥 BONUS: Add alignment bonus (when signals agree, confidence increases)
    const bullishCount = [techScore, zoneScore, volumeScore, trendScore, candleScore, marketIndicesScore, pcrScore, earlyWarningScore].filter(s => s > 0).length;
    const bearishCount = [techScore, zoneScore, volumeScore, trendScore, candleScore, marketIndicesScore, pcrScore, earlyWarningScore].filter(s => s < 0).length;
    const alignmentBonus = Math.abs(bullishCount - bearishCount) * 3; // +3% per aligned signal
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
      signalQualityWarning = `\n📊 ${availableSignals}/8 signals - Limited data`;
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
      masterTradeIndicator = `\n🏆 MASTER TRADE QUALIFIED (${rulesPassed}/10 Rules ✅)\n   Big 3: Trend ✅ • Candle ✅ • Zone ✅`;
    } else if (isPartiallyQualified) {
      const failedRules: string[] = [];
      if (!rule1_trendStructureValid) failedRules.push('Trend Structure');
      if (!rule2_trendActive) failedRules.push('Trend Active');
      if (!rule3_candleBuySignal) failedRules.push('Candle Signal');
      if (!rule7_breakdownLow) failedRules.push('Breakdown Risk');
      masterTradeIndicator = `\n⚡ PARTIAL SETUP (${rulesPassed}/10 Rules)\n   Missing: ${failedRules.slice(0, 2).join(', ')}`;
    } else if (rulesPassed >= 3) {
      masterTradeIndicator = `\n⏳ BUILDING (${rulesPassed}/10 Rules) - Wait for alignment`;
    }
    
    // Add Early Warning indicator ONLY if QUALIFIED (ALL 7 CONDITIONS)
    let earlyWarningIndicator = '';
    if (earlyWarningQualified) {
      const volumeStr = volumeBuildup.buildup_strength >= 60 ? '🔥' : '✅';
      const momentumStr = (momentum.consistency || 0) >= 80 ? '💪' : '✓';
      const trendStr = trendIntegrity >= 80 ? '📈' : '✓';
      earlyWarningIndicator = `\n🔮 EARLY WARNING: ${earlyWarningSignal} in ${earlyWarningTimeToTrigger}m • Vol: ${volumeBuildup.buildup_strength}% • Mom: ${momentum.consistency}%`;
    } else if (isLowRisk && hasActiveSignal && !isTrendStructureAligned) {
      earlyWarningIndicator = `\n⚠️ Early Warning: ${earlyWarningSignal} (Trend not aligned)`;
    } else if (isLowRisk && hasActiveSignal && !isMomentumAligned) {
      earlyWarningIndicator = `\n⚠️ Early Warning: ${earlyWarningSignal} (Momentum: ${momentum.direction})`;
    } else if (isLowRisk && hasActiveSignal && !isVolumeBuildupActive) {
      earlyWarningIndicator = `\n⏳ Early Warning: Waiting for Volume...`;
    }
    
    // Combine indicators
    const combinedIndicators = masterTradeIndicator + earlyWarningIndicator;
    
    if (isMasterTradeQualified && overallSignal === 'STRONG_BUY') {
      tradeRecommendation = `🏆 MASTER TRADE • PERFECT ENTRY!\n${riskEmoji} Risk ${breakdownRisk}% • 💪 ${Math.round(finalConfidence)}% • ${rulesPassed}/10 Rules${combinedIndicators}` + dataFreshnessWarning;
    } else if (isMasterTradeQualified && (overallSignal === 'BUY' || overallSignal === 'NEUTRAL')) {
      tradeRecommendation = `🏆 MASTER TRADE READY • Enter Now!\n${riskEmoji} Risk ${breakdownRisk}% • ${Math.round(finalConfidence)}% • ${rulesPassed}/10 Rules${combinedIndicators}` + dataFreshnessWarning;
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

    return {
      overallConfidence: Math.round(finalConfidence),
      overallSignal,
      tradeRecommendation,
      signalBreakdown: {
        technical: { 
          signal: techSignal, 
          confidence: Math.round(techConfidence), 
          weight: SIGNAL_WEIGHTS.technical 
        },
        zoneControl: { 
          signal: zoneSignal, 
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
        candleIntent: {
          signal: candleSignal,
          confidence: Math.round(candleConfidence),
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
        earlyWarning: {
          signal: earlyWarningSignal,
          confidence: Math.round(adjustedEarlyWarningConfidence),
          weight: Math.round(earlyWarningWeight * 10) / 10, // Show actual dynamic weight
          timeToTrigger: earlyWarningTimeToTrigger,
          riskLevel: earlyWarningRisk,
          qualified: earlyWarningQualified, // 🔥 Shows if ALL 7 conditions met
          volumeBuildupActive: isVolumeBuildupActive,
          volumeBuildupStrength: volumeBuildup.buildup_strength,
          momentumDirection: momentum.direction,
          momentumConsistency: momentum.consistency || 0,
          momentumAligned: isMomentumAligned,
          trendStructure: trendStructure, // 🔥 NEW: Trend structure (HH_HL, LH_LL, etc.)
          trendIntegrity: trendIntegrity, // 🔥 NEW: Trend integrity %
          trendStructureAligned: isTrendStructureAligned // 🔥 NEW: Is trend aligned with signal?
        },
      },
      // 🔥 10 GOLDEN RULES - Master Trade Status
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
          rule8_earlyWarning: rule8_earlyWarningLowRisk,
          rule9_momentum: rule9_momentumBullish,
          rule10_bigThreeAlign: rule10_allThreeAlign
        }
      },
      riskLevel,
      breakdownRiskPercent: breakdownRisk, // Include the actual percentage
      timestamp: new Date().toISOString(),
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
        }, 5000)) // Increased to 5 seconds
      ]);

    console.log(`[OUTLOOK-${symbol}] Starting fetch...`);

    // 🚀 OPTIMIZATION: Fetch ALL advanced analysis in ONE call (5x faster!)
    const [tech, allAdvanced, market] = await Promise.all([
      quickFetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`),
      quickFetch(`${API_BASE_URL}/api/advanced/all-analysis/${symbol}`), // ⚡ ONE CALL for 5 endpoints!
      quickFetch(`${API_BASE_URL}/ws/cache/${symbol}`).then(d => d?.data || null),
    ]);

    console.log(`[OUTLOOK-${symbol}] Fetch complete:`, {
      tech: tech ? '✓' : '✗',
      allAdvanced: allAdvanced ? '✓' : '✗',
      market: market ? '✓' : '✗'
    });

    // Extract individual sections from aggregated response
    const zone = allAdvanced?.zone_control || null;
    const volume = allAdvanced?.volume_pulse || null;
    const trend = allAdvanced?.trend_base || null;
    const candle = allAdvanced?.candle_intent || null;
    const warning = allAdvanced?.early_warning || null;

    // 🔍 DEBUG: Log fetched data
    console.log(`[OUTLOOK-${symbol}] Extracted data:`, {
      tech: tech ? '✓' : '✗',
      zone: zone ? '✓' : '✗',
      volume: volume ? '✓' : '✗',
      trend: trend ? '✓' : '✗',
      candle: candle ? '✓' : '✗',
      market: market ? '✓' : '✗',
      warning: warning ? '✓' : '✗'
    });

    const result = calculateOverallOutlook(tech, zone, volume, trend, candle, market, warning);
    console.log(`[OUTLOOK-${symbol}] Calculated confidence:`, result.overallConfidence + '%', 'Signal:', result.overallSignal);
    
    return result;
  }, [calculateOverallOutlook]);

  // 🔥 SILENT UPDATE: Always update state immediately (no change detection)
  const silentUpdate = useCallback((symbol: keyof OverallOutlookData, newData: SymbolOutlook | null) => {
    if (!newData) return;
    
    // 🔥 ALWAYS UPDATE - Show real data immediately
    globalCache[symbol] = newData;
    setOutlookData(prev => ({ ...prev, [symbol]: newData }));
  }, []);

  // 🔥🔥🔥 PRODUCTION: Fetch ONCE, keep values stable
  const fetchAllAnalysis = useCallback(async () => {
    const now = Date.now();
    if (isFetching) {
      console.log('[OUTLOOK] Already fetching, skipping...');
      return;
    }
    
    isFetching = true;
    lastFetchTime = now;
    
    console.log('[OUTLOOK] ========== STARTING FETCH ==========');
    
    // 🔥 FETCH ONCE: Get initial data and keep it stable
    try {
      // Fetch all 3 symbols in parallel
      const results = await Promise.all([
        fetchFullSymbolData('NIFTY').then(data => {
          if (data) {
            console.log('[OUTLOOK] ✅ NIFTY data received:', data.overallConfidence + '%');
            silentUpdate('NIFTY', data);
          } else {
            console.error('[OUTLOOK] ❌ NIFTY data is NULL');
          }
          return data;
        }),
        fetchFullSymbolData('BANKNIFTY').then(data => {
          if (data) {
            console.log('[OUTLOOK] ✅ BANKNIFTY data received:', data.overallConfidence + '%');
            silentUpdate('BANKNIFTY', data);
          } else {
            console.error('[OUTLOOK] ❌ BANKNIFTY data is NULL');
          }
          return data;
        }),
        fetchFullSymbolData('SENSEX').then(data => {
          if (data) {
            console.log('[OUTLOOK] ✅ SENSEX data received:', data.overallConfidence + '%');
            silentUpdate('SENSEX', data);
          } else {
            console.error('[OUTLOOK] ❌ SENSEX data is NULL');
          }
          return data;
        }),
      ]);
      
      console.log('[OUTLOOK] ========== FETCH COMPLETE ==========');
      console.log('[OUTLOOK] Results:', {
        NIFTY: results[0]?.overallConfidence + '%' || 'NULL',
        BANKNIFTY: results[1]?.overallConfidence + '%' || 'NULL',
        SENSEX: results[2]?.overallConfidence + '%' || 'NULL'
      });
    } catch (error) {
      console.error('[OUTLOOK] ========== FETCH ERROR ==========', error);
    } finally {
      isFetching = false;
      setLoading(false); // Data loaded, stop showing loading state
    }
  }, [fetchFullSymbolData, silentUpdate]);

  useEffect(() => {
    // 🔥🔥🔥 FORCE 0% START - Reset everything
    console.log('[OUTLOOK] FORCE RESET - Starting at 0%');
    
    // Clear localStorage
    try {
      localStorage.removeItem('mytradingsignal_last_outlook_data');
    } catch {}
    
    // Reset global cache
    globalCache = {
      NIFTY: createDefaultOutlook('NIFTY'),
      BANKNIFTY: createDefaultOutlook('BANKNIFTY'),
      SENSEX: createDefaultOutlook('SENSEX')
    };
    
    // Reset state to 0%
    setOutlookData({
      NIFTY: createDefaultOutlook('NIFTY'),
      BANKNIFTY: createDefaultOutlook('BANKNIFTY'),
      SENSEX: createDefaultOutlook('SENSEX')
    });
    
    lastFetchTime = 0;
    isFetching = false;
    
    // 🔥 Fetch fresh live data immediately
    console.log('[OUTLOOK] Starting fresh data fetch...');
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

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
    earlyWarning: { signal: string; confidence: number; weight: number; timeToTrigger?: number; riskLevel?: string };
    // ai: { signal: string; confidence: number; weight: number }; // COMMENTED OUT
  };
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  breakdownRiskPercent: number; // Added: actual breakdown risk percentage
  timestamp: string;
}

interface OverallOutlookData {
  NIFTY: SymbolOutlook | null;
  BANKNIFTY: SymbolOutlook | null;
  SENSEX: SymbolOutlook | null;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const SYMBOLS = (process.env.NEXT_PUBLIC_MARKET_SYMBOLS || '').split(',').filter(Boolean);

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

export const useOverallMarketOutlook = () => {
  const [outlookData, setOutlookData] = useState<OverallOutlookData>({
    NIFTY: null,
    BANKNIFTY: null,
    SENSEX: null,
  });
  const [loading, setLoading] = useState(true);

  // Convert signal string to numeric score (-100 to +100)
  // BUYER-FRIENDLY: NEUTRAL = +25 (slight positive bias since market default is growth-oriented)
  const signalToScore = (signal: string): number => {
    const upperSignal = signal.toUpperCase();
    if (upperSignal.includes('STRONG_BUY') || upperSignal === 'STRONG BUY') return 100;
    if (upperSignal.includes('BUY') || upperSignal === 'BULLISH') return 75;
    if (upperSignal.includes('NEUTRAL') || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') return 25; // 🔥 CHANGED: +25 instead of 0
    if (upperSignal.includes('SELL') || upperSignal === 'BEARISH') return -75;
    if (upperSignal.includes('STRONG_SELL') || upperSignal === 'STRONG SELL') return -100;
    return 25; // Default to slight positive
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
    // 🔥 CRITICAL FIX #1: Market Status Validation
    // Don't block analysis for CLOSED market if we have cached data with valid signals
    const marketStatus = marketIndicesData?.status || 'CLOSED';
    const hasValidData = technical?.signal || zoneControl?.signal || volumePulse?.signal || trendBase?.signal;
    
    // Only return NEUTRAL if market is closed AND we have no cached data
    if ((marketStatus === 'CLOSED' || marketStatus === 'PRE_OPEN') && !hasValidData) {
      return {
        overallConfidence: 0,
        overallSignal: 'NEUTRAL',
        tradeRecommendation: `⏸️ MARKET ${marketStatus} - No trading signals available. Wait for market open.`,
        signalBreakdown: {
          technical: { signal: 'WAIT', confidence: 0, weight: SIGNAL_WEIGHTS.technical },
          zoneControl: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.zoneControl },
          volumePulse: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.volumePulse },
          trendBase: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.trendBase },
          candleIntent: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.candleIntent },
          marketIndices: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.marketIndices },
          pcr: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.pcr },
          earlyWarning: { signal: 'WAIT', confidence: 0, weight: SIGNAL_WEIGHTS.earlyWarning },
        },
        riskLevel: 'HIGH',
        breakdownRiskPercent: 100,
        timestamp: new Date().toISOString(),
      };
    }
    
    // 🔥 CRITICAL FIX #2: Signal Availability Check
    // Relax validation when market closed - if we have cached data, allow calculation
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

    // When market is CLOSED and we have cached data, require fewer signals (2+)
    // When market is OPEN, require at least 4/8 signals for quality
    const minSignalsRequired = (marketStatus === 'CLOSED' || marketStatus === 'PRE_OPEN') ? 2 : 4;

    if (availableSignals < minSignalsRequired) {
      return {
        overallConfidence: 0,
        overallSignal: 'NEUTRAL',
        tradeRecommendation: `⚠️ INSUFFICIENT DATA - Only ${availableSignals}/8 signals available. Wait for more data.`,
        signalBreakdown: {
          technical: { signal: technical?.signal || 'WAIT', confidence: 0, weight: SIGNAL_WEIGHTS.technical },
          zoneControl: { signal: zoneControl?.signal || 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.zoneControl },
          volumePulse: { signal: volumePulse?.signal || 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.volumePulse },
          trendBase: { signal: trendBase?.signal || 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.trendBase },
          candleIntent: { signal: candleIntent?.professional_signal || 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.candleIntent },
          marketIndices: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.marketIndices },
          pcr: { signal: 'NEUTRAL', confidence: 0, weight: SIGNAL_WEIGHTS.pcr },
          earlyWarning: { signal: earlyWarning?.signal || 'WAIT', confidence: 0, weight: SIGNAL_WEIGHTS.earlyWarning },
        },
        riskLevel: 'HIGH',
        breakdownRiskPercent: 100,
        timestamp: new Date().toISOString(),
      };
    }
    
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

    // Extract Early Warning signal and confidence
    // Convert EARLY_BUY/EARLY_SELL to standard BUY/SELL signals
    const earlyWarningSignal = earlyWarning?.signal === 'EARLY_BUY' ? 'BUY' : 
                               earlyWarning?.signal === 'EARLY_SELL' ? 'SELL' : 'WAIT';
    const earlyWarningConfidence = earlyWarning?.confidence || 0;
    const earlyWarningTimeToTrigger = earlyWarning?.time_to_trigger || 0;
    const earlyWarningRisk = earlyWarning?.fake_signal_risk || 'HIGH';
    
    // Adjust confidence based on risk level and time proximity
    let adjustedEarlyWarningConfidence = earlyWarningConfidence;
    if (earlyWarningRisk === 'HIGH') {
      adjustedEarlyWarningConfidence *= 0.7; // Reduce confidence by 30% for high risk
    } else if (earlyWarningRisk === 'MEDIUM') {
      adjustedEarlyWarningConfidence *= 0.85; // Reduce confidence by 15% for medium risk
    }
    // Boost confidence if trigger is imminent (< 5 minutes)
    if (earlyWarningTimeToTrigger > 0 && earlyWarningTimeToTrigger < 5) {
      adjustedEarlyWarningConfidence *= 1.2; // 20% boost for imminent signals
    }
    adjustedEarlyWarningConfidence = Math.min(100, adjustedEarlyWarningConfidence); // Cap at 100

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

    // Convert signals to scores
    const techScore = signalToScore(techSignal);
    const zoneScore = signalToScore(zoneSignal);
    const volumeScore = signalToScore(volumeSignal);
    const trendScore = signalToScore(trendSignal);
    const candleScore = signalToScore(candleSignal);
    const marketIndicesScore = signalToScore(marketIndicesSignal);
    const pcrScore = signalToScore(pcrSignal);
    const earlyWarningScore = signalToScore(earlyWarningSignal);
    // const aiScore = signalToScore(aiSignal); // COMMENTED OUT

    // Calculate weighted average score (Early Warning ADDED with 8% weight)
    const totalWeightedScore = (
      (techScore * techConfidence * SIGNAL_WEIGHTS.technical / 100) +
      (zoneScore * zoneConfidence * SIGNAL_WEIGHTS.zoneControl / 100) +
      (volumeScore * volumeConfidence * SIGNAL_WEIGHTS.volumePulse / 100) +
      (trendScore * trendConfidence * SIGNAL_WEIGHTS.trendBase / 100) +
      (candleScore * candleConfidence * SIGNAL_WEIGHTS.candleIntent / 100) +
      (marketIndicesScore * marketIndicesConfidence * SIGNAL_WEIGHTS.marketIndices / 100) +
      (pcrScore * pcrConfidence * SIGNAL_WEIGHTS.pcr / 100) +
      (earlyWarningScore * adjustedEarlyWarningConfidence * SIGNAL_WEIGHTS.earlyWarning / 100)
      // + (aiScore * aiConfidence * SIGNAL_WEIGHTS.ai / 100) // COMMENTED OUT
    ) / 100;

    // Calculate overall confidence (0-100) - SEPARATE from signal score
    // Confidence = weighted average of individual confidences (not signal scores)
    const overallConfidence = (
      (techConfidence * SIGNAL_WEIGHTS.technical) +
      (zoneConfidence * SIGNAL_WEIGHTS.zoneControl) +
      (volumeConfidence * SIGNAL_WEIGHTS.volumePulse) +
      (trendConfidence * SIGNAL_WEIGHTS.trendBase) +
      (candleConfidence * SIGNAL_WEIGHTS.candleIntent) +
      (marketIndicesConfidence * SIGNAL_WEIGHTS.marketIndices) +
      (pcrConfidence * SIGNAL_WEIGHTS.pcr) +
      (adjustedEarlyWarningConfidence * SIGNAL_WEIGHTS.earlyWarning)
    ) / 100;
    
    // 🔥 BONUS: Add alignment bonus (when signals agree, confidence increases)
    const bullishCount = [techScore, zoneScore, volumeScore, trendScore, candleScore, marketIndicesScore, pcrScore, earlyWarningScore].filter(s => s > 0).length;
    const bearishCount = [techScore, zoneScore, volumeScore, trendScore, candleScore, marketIndicesScore, pcrScore, earlyWarningScore].filter(s => s < 0).length;
    const alignmentBonus = Math.abs(bullishCount - bearishCount) * 3; // +3% per aligned signal
    const finalConfidence = Math.min(100, overallConfidence + alignmentBonus);

    // Determine overall signal - BUYER-FRIENDLY THRESHOLDS
    let overallSignal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
    if (totalWeightedScore >= 60) overallSignal = 'STRONG_BUY';  // 🔥 CHANGED: 60 from 70
    else if (totalWeightedScore >= 30) overallSignal = 'BUY';     // 🔥 CHANGED: 30 from 40
    else if (totalWeightedScore <= -70) overallSignal = 'STRONG_SELL';
    else if (totalWeightedScore <= -45) overallSignal = 'SELL';   // 🔥 CHANGED: -45 from -40
    else overallSignal = 'NEUTRAL';

    // 🔥 CRITICAL FIX #3: Minimum Confidence Threshold (prevent false signals)
    if (finalConfidence < 50 && overallSignal !== 'NEUTRAL') {
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

    // Generate trade recommendation
    let tradeRecommendation = '';
    if (overallSignal === 'STRONG_BUY' && riskLevel === 'LOW') {
      tradeRecommendation = '🚀 STRONG BUY - All signals aligned, low risk, excellent entry' + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_BUY' && riskLevel !== 'LOW') {
      tradeRecommendation = '⚠️ BUY with caution - Strong signals but elevated risk' + dataFreshnessWarning;
    } else if (overallSignal === 'BUY' && riskLevel === 'LOW') {
      tradeRecommendation = '✅ BUY - Favorable conditions, manageable risk' + dataFreshnessWarning;
    } else if (overallSignal === 'BUY') {
      tradeRecommendation = '⚡ BUY - Positive signals, monitor risk levels' + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_SELL' && riskLevel === 'HIGH') {
      tradeRecommendation = '🔻 STRONG SELL - All signals bearish, high breakdown risk' + dataFreshnessWarning;
    } else if (overallSignal === 'STRONG_SELL') {
      tradeRecommendation = '❌ STRONG SELL - Bearish alignment across indicators' + dataFreshnessWarning;
    } else if (overallSignal === 'SELL') {
      tradeRecommendation = '⚠️ SELL - Negative signals, consider exit' + dataFreshnessWarning;
    } else if (finalConfidence < 50) {
      tradeRecommendation = '⏸️ WAIT - Confidence too low (' + Math.round(finalConfidence) + '%) for reliable signal' + dataFreshnessWarning;
    } else {
      tradeRecommendation = '⏸️ WAIT - Mixed signals, avoid trading now' + dataFreshnessWarning;
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
          weight: SIGNAL_WEIGHTS.earlyWarning,
          timeToTrigger: earlyWarningTimeToTrigger,
          riskLevel: earlyWarningRisk
        },
        // ai: {  // COMMENTED OUT - Not required
        //   signal: aiSignal, 
        //   confidence: Math.round(aiConfidence), 
        //   weight: SIGNAL_WEIGHTS.ai 
        // },
      },
      riskLevel,
      breakdownRiskPercent: breakdownRisk, // Include the actual percentage
      timestamp: new Date().toISOString(),
    };
  }, []);

  // Fetch all analysis data for all symbols
  const fetchAllAnalysis = useCallback(async () => {
    try {
      const results: OverallOutlookData = {
        NIFTY: null,
        BANKNIFTY: null,
        SENSEX: null,
      };

      for (const symbol of SYMBOLS) {
        try {
          // Fetch all analysis types in parallel (Candle Intent & Early Warning ADDED)
          const [techRes, zoneRes, volumeRes, trendRes, candleRes, marketRes, earlyWarningRes] = await Promise.all([
            fetch(`${API_BASE_URL}/api/analysis/analyze/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API_BASE_URL}/api/advanced/zone-control/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API_BASE_URL}/api/advanced/volume-pulse/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API_BASE_URL}/api/advanced/trend-base/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API_BASE_URL}/api/advanced/candle-intent/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`${API_BASE_URL}/ws/cache/${symbol}`).then(r => r.ok ? r.json().then(d => d.data) : null).catch(() => null),
            fetch(`${API_BASE_URL}/api/advanced/early-warning/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null),
            // fetch(`${API_BASE_URL}/ai/analysis/${symbol}`).then(r => r.ok ? r.json() : null).catch(() => null), // COMMENTED OUT
          ]);

          results[symbol as keyof OverallOutlookData] = calculateOverallOutlook(
            techRes,
            zoneRes,
            volumeRes,
            trendRes,
            candleRes,
            marketRes,
            earlyWarningRes
            // aiRes // COMMENTED OUT
          );
        } catch (error) {
          console.error(`[OUTLOOK] Error fetching ${symbol}:`, error);
        }
      }

      setOutlookData(results);
      setLoading(false);
    } catch (error) {
      console.error('[OUTLOOK] Fetch error:', error);
      setLoading(false);
    }
  }, [calculateOverallOutlook]);

  useEffect(() => {
    fetchAllAnalysis();

    // Refresh every 10 seconds
    const interval = setInterval(fetchAllAnalysis, 10000);

    return () => clearInterval(interval);
  }, [fetchAllAnalysis]);

  return { outlookData, loading };
};

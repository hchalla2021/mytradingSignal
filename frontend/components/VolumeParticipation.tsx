'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { MarketTick } from '@/hooks/useMarketSocket';

interface VolumeParticipationProps {
  symbol: string;
  name: string;
  data: MarketTick | null;
  analysis: any;
}

interface VolumeMetrics {
  currentVolume: number;
  avgVolume: number;
  volumeSpike: {
    ratio: number;
    level: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME';
    strength: number; // 0-100
  };
  participation: {
    level: 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME';
    trend: 'DECREASING' | 'STABLE' | 'INCREASING';
    confidence: number; // 0-100
  };
  vwapReaction: {
    status: 'REJECTED' | 'BOUNCE' | 'BREAKOUT' | 'NEUTRAL';
    strength: number; // 0-100
  };
  buyVolume: number;
  sellVolume: number;
  bullishVolume: number; // %
  volumeConfirmation: {
    isTrendConfirmed: boolean;
    signalStrength: number; // 0-100
  };
  signals: string[];
}

/**
 * Volume & Participation Analyzer - Institutional Trader Perspective
 * TIME COMPLEXITY: O(1) | SPACE COMPLEXITY: O(1)
 * Analyzes volume spikes, relative volume, VWAP reactions
 */
function analyzeVolumePart(data: MarketTick | null, analysis: any): VolumeMetrics {
  if (!data) {
    return {
      currentVolume: 0,
      avgVolume: 0,
      volumeSpike: { ratio: 0, level: 'LOW', strength: 0 },
      participation: { level: 'WEAK', trend: 'STABLE', confidence: 0 },
      vwapReaction: { status: 'NEUTRAL', strength: 0 },
      buyVolume: 0,
      sellVolume: 0,
      bullishVolume: 50,
      volumeConfirmation: { isTrendConfirmed: false, signalStrength: 0 },
      signals: [],
    };
  }

  // 🔥 VOLUME METRICS (from WebSocket data)
  // Try multiple sources for volume data
  let currentVolume = data.volume || 0;
  
  // Fallback 1: Use analysis volume if direct volume is 0
  if (currentVolume === 0 && analysis?.volume?.current) {
    currentVolume = analysis.volume.current;
  }
  
  // Fallback 2: Use average from analysis
  let avgVolume = analysis?.volume?.last_5_avg || 0;
  if (avgVolume === 0) {
    avgVolume = currentVolume * 0.85; // Estimated from current (conservative)
  }
  
  // Calculate ratio safely
  const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  // 🔥 VOLUME SPIKE CLASSIFICATION
  let volumeLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' = 'NORMAL';
  let spikeStrength = 0;

  if (volumeRatio >= 2.0) {
    volumeLevel = 'EXTREME';
    spikeStrength = Math.min(100, volumeRatio * 40); // Max 100
  } else if (volumeRatio >= 1.5) {
    volumeLevel = 'HIGH';
    spikeStrength = Math.min(100, volumeRatio * 50);
  } else if (volumeRatio >= 1.0) {
    volumeLevel = 'NORMAL';
    spikeStrength = 50;
  } else {
    volumeLevel = 'LOW';
    spikeStrength = 25;
  }

  // 🔥 PARTICIPATION ANALYSIS
  let participationLevel: 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME' = 'MODERATE';
  let participationTrend: 'DECREASING' | 'STABLE' | 'INCREASING' = 'STABLE';
  let participationConfidence = 50;

  if (volumeRatio >= 1.5) {
    participationLevel = 'STRONG';
    participationConfidence = Math.min(95, 60 + volumeRatio * 15);
    participationTrend = volumeRatio >= 1.7 ? 'INCREASING' : 'STABLE';
  } else if (volumeRatio >= 0.8) {
    participationLevel = 'MODERATE';
    participationConfidence = 65;
  } else {
    participationLevel = 'WEAK';
    participationConfidence = 40;
    participationTrend = 'DECREASING';
  }

  // 🔥 VWAP REACTION ANALYSIS
  const priceChangePercent = data.changePercent || 0;
  const vwapSignal = String(analysis?.indicators?.vwap_signal || '').toUpperCase();
  const vwapPosition = String(analysis?.indicators?.vwap_position || '').toUpperCase();

  let vwapStatus: 'REJECTED' | 'BOUNCE' | 'BREAKOUT' | 'NEUTRAL' = 'NEUTRAL';
  let vwapStrength = 50;

  // Check for explicit signals first
  if (vwapSignal.includes('BREAKOUT') || vwapSignal.includes('BREAK_ABOVE')) {
    vwapStatus = 'BREAKOUT';
    vwapStrength = Math.min(100, 85 + Math.abs(priceChangePercent) * 5);
  } else if (vwapSignal.includes('BOUNCE') || vwapSignal.includes('DIP_TO_VWAP_BUY')) {
    vwapStatus = 'BOUNCE';
    vwapStrength = Math.min(95, 80 + volumeRatio * 5);
  } else if (vwapSignal.includes('REJECTED') || vwapSignal.includes('REJECTION')) {
    vwapStatus = 'REJECTED';
    vwapStrength = Math.min(90, 75 + volumeRatio * 5);
  } else if (vwapPosition.includes('ABOVE') && priceChangePercent > 0.3 && volumeRatio >= 1.2) {
    vwapStatus = 'BREAKOUT';
    vwapStrength = Math.min(100, 75 + Math.abs(priceChangePercent) * 5);
  } else if (volumeRatio >= 1.5 && priceChangePercent > 0) {
    vwapStatus = 'BOUNCE';
    vwapStrength = Math.min(95, 70 + volumeRatio * 10);
  } else if (vwapRejection(analysis, data)) {
    vwapStatus = 'REJECTED';
    vwapStrength = Math.min(90, 65 + volumeRatio * 10);
  }

  // 🔥 BUY/SELL VOLUME SPLIT (from analysis if available)
  const bullishPercent = calculateBullishPercent(data, analysis);
  const buyVolume = currentVolume > 0 ? (currentVolume * bullishPercent) / 100 : 0;
  const sellVolume = currentVolume - buyVolume;

  // 🔥 VOLUME CONFIRMATION OF TREND
  // Multiple sources for trend detection
  let trend = data.trend || 'neutral';
  
  // Fallback 1: Check analysis trend
  if ((trend === 'neutral' || !trend) && analysis?.indicators?.trend) {
    trend = analysis.indicators.trend;
  }
  
  // Fallback 2: Infer from price change
  if ((trend === 'neutral' || !trend) && priceChangePercent !== 0) {
    trend = priceChangePercent > 0 ? 'bullish' : 'bearish';
  }
  
  const isUptrend = trend === 'bullish' || trend === 'UPTREND' || priceChangePercent > 0;
  const isBullishVol = bullishPercent > 55;
  const volumeConfirms = isUptrend === isBullishVol && volumeRatio >= 0.8;

  // 🔥 GENERATE SIGNALS
  const signals: string[] = [];

  // Volume spike signals
  if (volumeLevel === 'EXTREME' && volumeRatio >= 2.0) {
    signals.push('🚨 EXTREME VOLUME SPIKE - Potential breakout/breakdown');
  } else if (volumeLevel === 'HIGH' && volumeRatio >= 1.5) {
    signals.push('📈 High volume - Conviction in move');
  } else if (volumeLevel === 'NORMAL' && volumeRatio >= 1.0) {
    signals.push('➡️ Average volume participation');
  }

  // VWAP signals
  if (vwapStatus === 'BREAKOUT') {
    signals.push('🔥 VWAP BREAKOUT - Strong institutional signal');
  } else if (vwapStatus === 'BOUNCE') {
    signals.push('💪 Volume bounce at VWAP - Reversal potential');
  } else if (vwapStatus === 'REJECTED') {
    signals.push('😤 Price rejected at VWAP - Reversal ahead');
  }

  // Volume confirmation signals
  if (volumeConfirms && volumeRatio >= 1.1) {
    signals.push(`✅ Volume confirms ${isUptrend ? 'uptrend' : 'downtrend'}`);
  } else if (!volumeConfirms && volumeRatio >= 0.8) {
    signals.push(`⚠️ Volume divergence - ${isUptrend ? 'Bearish' : 'Bullish'} warning`);
  }

  // Participation trends
  if (participationTrend === 'INCREASING' && volumeRatio >= 1.3) {
    signals.push('📊 Participation increasing - Trend strengthening');
  } else if (participationTrend === 'DECREASING') {
    signals.push('📉 Participation decreasing - Caution');
  }

  return {
    currentVolume,
    avgVolume,
    volumeSpike: { ratio: Math.max(0, volumeRatio), level: volumeLevel, strength: Math.max(0, spikeStrength) },
    participation: { level: participationLevel, trend: participationTrend, confidence: Math.max(0, Math.min(100, participationConfidence)) },
    vwapReaction: { status: vwapStatus, strength: Math.max(0, Math.min(100, vwapStrength)) },
    buyVolume: Math.max(0, Math.round(buyVolume)),
    sellVolume: Math.max(0, Math.round(sellVolume)),
    bullishVolume: Math.max(0, Math.min(100, bullishPercent)),
    volumeConfirmation: { isTrendConfirmed: volumeConfirms, signalStrength: volumeConfirms ? 80 : 40 },
    signals: signals.slice(0, 4), // Top 4 signals only
  };
}

// 🔥 HELPER: Check if price rejected at VWAP
function vwapRejection(analysis: any, data: MarketTick): boolean {
  const vwap = analysis?.indicators?.vwap || 0;
  const high = data.high || 0;
  const low = data.low || 0;
  const close = data.price || 0;

  if (vwap === 0) return false;

  // Touching VWAP but closing below (bearish rejection)
  return high >= vwap && close < vwap;
}

// 🔥 HELPER: Calculate bullish volume percentage
function calculateBullishPercent(data: MarketTick, analysis: any): number {
  // Use analysis data if available
  if (analysis?.indicators?.bullish_volume_percent) {
    return analysis.indicators.bullish_volume_percent;
  }

  // Check volume from analysis
  if (analysis?.volume?.buying_pressure !== undefined) {
    return analysis.volume.buying_pressure;
  }

  // Fallback: estimate from price change
  const change = data.changePercent || 0;
  if (change > 0.5) return Math.min(95, 70 + Math.abs(change) * 5);
  if (change < -0.5) return Math.max(5, 30 + Math.abs(change) * 5);
  return 50 + change * 10;
}

// 🔥 COLOR SCHEME - Memoized outside component
const VOLUME_COLORS = {
  EXTREME: { bg: 'bg-red-900/20', border: 'border-red-500/40', text: 'text-red-400', badge: 'bg-red-500/20' },
  HIGH: { bg: 'bg-orange-900/20', border: 'border-orange-500/40', text: 'text-orange-400', badge: 'bg-orange-500/20' },
  NORMAL: { bg: 'bg-green-900/20', border: 'border-green-500/40', text: 'text-green-400', badge: 'bg-green-500/20' },
  LOW: { bg: 'bg-slate-900/20', border: 'border-slate-500/40', text: 'text-slate-400', badge: 'bg-slate-500/20' },
};

function getVolumeColor(level: string) {
  return VOLUME_COLORS[level as keyof typeof VOLUME_COLORS] || VOLUME_COLORS.NORMAL;
}

const VolumeParticipation = ({ symbol, name, data, analysis }: VolumeParticipationProps) => {
  const [cachedData, setCachedData] = useState<MarketTick | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  // Load cached data from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') {
      setCacheLoaded(true);
      return;
    }

    try {
      const saved = localStorage.getItem('lastMarketData');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[symbol]) {
          setCachedData(parsed[symbol]);
        }
      }
    } catch (e) {
      console.error(`[${symbol}] Volume cache error:`, e);
    } finally {
      setCacheLoaded(true);
    }
  }, [symbol]);

  const displayData = data || cachedData;
  const isLive = !!data;
  const hasData = !!displayData;

  const metrics = useMemo(() => analyzeVolumePart(displayData, analysis), [displayData, analysis]);

  if (!cacheLoaded) {
    return (
      <div className="border-2 border-purple-600/30 rounded-xl p-4 bg-purple-900/20 text-purple-200 text-sm animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏳</span>
          <span className="font-bold">Loading volume data for {symbol}...</span>
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="border-2 border-purple-600/30 rounded-xl p-4 bg-purple-900/20 text-purple-200 text-sm">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-2xl">📊</span>
          <span className="font-bold">{symbol} • Volume Awaiting Data</span>
        </div>
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-3xl mb-2">📊</div>
            <div className="text-xs text-dark-tertiary">Waiting for data...</div>
          </div>
        </div>
      </div>
    );
  }

  const volumeColor = getVolumeColor(metrics.volumeSpike.level);

  return (
    <div className={`border-2 ${volumeColor.border} rounded-xl p-4 transition-all duration-300 ${volumeColor.bg} backdrop-blur-sm`}>
      {/* Header */}
      <h4 className="font-bold text-dark-text text-lg mb-4 flex items-center gap-2">
        <span className="text-2xl">📊</span>
        {name} • Volume & Participation
        {isLive && (
          <span className="text-[10px] ml-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30 animate-pulse">
            🟢 LIVE DATA
          </span>
        )}
        {!isLive && cachedData && (
          <span className="text-[10px] ml-1 px-2 py-1 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
            📋 CACHED
          </span>
        )}
        <span className={`text-xs font-bold px-2 py-1 rounded-full ml-auto border ${volumeColor.badge} ${volumeColor.text}`}>
          {metrics.currentVolume > 0 ? metrics.volumeSpike.level : 'PENDING'}
        </span>
      </h4>

      <div className="space-y-4">
        {/* 1️⃣ VOLUME SPIKE INDICATOR */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-3 uppercase tracking-wider">Volume Spike</div>

          {/* Spike Ratio & Visual */}
          <div className="mb-3">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-2xl font-bold text-dark-text">{Math.max(0, metrics.volumeSpike.ratio).toFixed(2)}x</span>
              <span className="text-xs text-dark-secondary">vs Average</span>
            </div>

            {/* Visual Strength Bar */}
            <div className="h-3 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  metrics.volumeSpike.level === 'EXTREME' ? 'bg-red-500' :
                  metrics.volumeSpike.level === 'HIGH' ? 'bg-orange-500' :
                  metrics.volumeSpike.level === 'NORMAL' ? 'bg-green-500' :
                  'bg-slate-500'
                }`}
                style={{ width: `${Math.min(Math.max(0, metrics.volumeSpike.strength), 100)}%` }}
              />
            </div>
          </div>

          {/* Status */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-dark-secondary block mb-1">Current Volume</span>
              <span className="font-bold text-dark-text">{metrics.currentVolume > 0 ? (metrics.currentVolume / 1000000).toFixed(2) : '0.00'}M</span>
            </div>
            <div>
              <span className="text-dark-secondary block mb-1">Avg Volume</span>
              <span className="font-bold text-dark-text">{metrics.avgVolume > 0 ? (metrics.avgVolume / 1000000).toFixed(2) : '0.00'}M</span>
            </div>
          </div>
        </div>

        {/* 2️⃣ PARTICIPATION LEVEL */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">Market Participation</div>

          <div className="mb-3">
            <div className="flex justify-between items-center mb-2">
              <span className={`text-lg font-bold ${
                metrics.participation.level === 'EXTREME' ? 'text-red-400' :
                metrics.participation.level === 'STRONG' ? 'text-green-400' :
                metrics.participation.level === 'MODERATE' ? 'text-yellow-400' :
                'text-slate-400'
              }`}>
                {metrics.participation.level}
              </span>
              <span className={`text-xs px-2 py-1 rounded border ${
                metrics.participation.trend === 'INCREASING' ? 'border-green-500/30 bg-green-500/10 text-green-300' :
                metrics.participation.trend === 'DECREASING' ? 'border-red-500/30 bg-red-500/10 text-red-300' :
                'border-slate-500/30 bg-slate-500/10 text-slate-300'
              }`}>
                {metrics.participation.trend === 'INCREASING' ? '📈 Rising' : 
                 metrics.participation.trend === 'DECREASING' ? '📉 Falling' : 
                 '➡️ Stable'}
              </span>
            </div>

            {/* Confidence Bar */}
            <div className="h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-500 to-blue-500 h-full transition-all"
                style={{ width: `${metrics.participation.confidence}%` }}
              />
            </div>
            <div className="text-[10px] text-dark-tertiary mt-1 text-right">
              {metrics.participation.confidence}% confidence
            </div>
          </div>
        </div>

        {/* 3️⃣ VWAP REACTION */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">VWAP Reaction</div>

          <div className={`p-3 rounded-lg border-l-4 ${
            metrics.vwapReaction.status === 'BREAKOUT' ? 'bg-green-900/30 border-green-500 text-green-400' :
            metrics.vwapReaction.status === 'BOUNCE' ? 'bg-blue-900/30 border-blue-500 text-blue-400' :
            metrics.vwapReaction.status === 'REJECTED' ? 'bg-red-900/30 border-red-500 text-red-400' :
            'bg-slate-900/30 border-slate-500 text-slate-400'
          }`}>
            <div className="font-bold text-sm mb-1">
              {metrics.vwapReaction.status === 'BREAKOUT' && '🔥 VWAP Breakout'}
              {metrics.vwapReaction.status === 'BOUNCE' && '💪 VWAP Bounce'}
              {metrics.vwapReaction.status === 'REJECTED' && '😤 VWAP Rejected'}
              {metrics.vwapReaction.status === 'NEUTRAL' && '➡️ VWAP Neutral'}
            </div>
            <div className="text-xs opacity-90">
              {metrics.vwapReaction.status === 'BREAKOUT' && 'Price cleared VWAP with conviction'}
              {metrics.vwapReaction.status === 'BOUNCE' && 'Strong bounce from VWAP level'}
              {metrics.vwapReaction.status === 'REJECTED' && 'Price rejected at VWAP - reversal'}
              {metrics.vwapReaction.status === 'NEUTRAL' && 'Price near VWAP - consolidating'}
            </div>
          </div>
        </div>

        {/* 4️⃣ BUY vs SELL VOLUME */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-3 uppercase tracking-wider">Buy/Sell Split</div>

          <div className="mb-3">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-green-400 font-bold">🟢 BUY {Math.max(0, Math.min(100, metrics.bullishVolume)).toFixed(1)}%</span>
              <span className="text-red-400 font-bold">SELL {Math.max(0, Math.min(100, 100 - metrics.bullishVolume)).toFixed(1)}% 🔴</span>
            </div>
            <div className="h-4 bg-gray-700 rounded-full overflow-hidden flex">
              <div
                className="bg-gradient-to-r from-green-600 to-green-400"
                style={{ width: `${Math.max(0, Math.min(100, metrics.bullishVolume))}%` }}
              />
              <div
                className="bg-gradient-to-r from-red-500 to-red-400"
                style={{ width: `${Math.max(0, Math.min(100, 100 - metrics.bullishVolume))}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-green-900/30 rounded p-2 border border-green-500/30 text-center">
              <div className="text-dark-secondary text-[10px]">Buy Vol</div>
              <div className="font-bold text-green-400">{metrics.buyVolume > 0 ? (metrics.buyVolume / 1000000).toFixed(2) : '0.00'}M</div>
            </div>
            <div className="bg-red-900/30 rounded p-2 border border-red-500/30 text-center">
              <div className="text-dark-secondary text-[10px]">Sell Vol</div>
              <div className="font-bold text-red-400">{metrics.sellVolume > 0 ? (metrics.sellVolume / 1000000).toFixed(2) : '0.00'}M</div>
            </div>
          </div>
        </div>

        {/* 5️⃣ VOLUME CONFIRMATION */}
        <div className={`p-3 rounded-lg border-2 ${
          metrics.volumeConfirmation.isTrendConfirmed
            ? 'border-green-500/40 bg-green-900/30'
            : 'border-yellow-500/40 bg-yellow-900/30'
        }`}>
          <div className="text-xs text-dark-secondary font-bold mb-2">Volume Confirmation</div>
          <div className="flex justify-between items-center">
            <div className={`font-bold ${
              metrics.volumeConfirmation.isTrendConfirmed ? 'text-green-400' : 'text-yellow-400'
            }`}>
              {metrics.volumeConfirmation.isTrendConfirmed ? '✅ Confirmed' : '⚠️ Divergence'}
            </div>
            <div className="flex items-center gap-2">
              <div className="w-20 h-2 bg-dark-secondary/30 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${metrics.volumeConfirmation.isTrendConfirmed ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${metrics.volumeConfirmation.signalStrength}%` }}
                />
              </div>
              <span className="text-xs text-dark-tertiary">{metrics.volumeConfirmation.signalStrength}%</span>
            </div>
          </div>
        </div>

        {/* 6️⃣ VOLUME SIGNALS */}
        {metrics.signals.length > 0 && (
          <div className="border-t border-emerald-500/30 pt-3">
            <div className="text-xs text-dark-secondary font-bold mb-2 uppercase">Signals</div>
            <div className="space-y-1.5">
              {metrics.signals.map((signal, i) => (
                <div
                  key={i}
                  className="text-xs p-2 rounded bg-emerald-950/20 border border-emerald-500/25 text-dark-text leading-relaxed"
                >
                  {signal}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default VolumeParticipation;

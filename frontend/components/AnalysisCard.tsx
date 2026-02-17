'use client';

import React, { memo, useMemo } from 'react';
import { AnalysisSignal } from '@/types/analysis';

interface AnalysisCardProps {
  analysis: AnalysisSignal | null;
}

/**
 * Intraday Technical Analysis - Professional Simplified
 * Layman-friendly signal with 100% accuracy focus
 * Shows only: Symbol, Status, Confidence, Price
 * Dual timeframe: 5-min entry + 15-min trend confirmation
 */
const AnalysisCard = memo<AnalysisCardProps>(({ analysis }) => {

  const signalAnalysis = useMemo(() => {
    if (!analysis?.indicators) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        price: 0,
        symbol: analysis?.symbol || 'INDEX'
      };
    }

    const { price, trend, changePercent, volume_strength } = analysis.indicators;
    const priceChange = changePercent || 0;
    const hasStrongVolume = volume_strength === 'STRONG_VOLUME';
    const hasModerateVolume = volume_strength === 'MODERATE_VOLUME';
    const symbol = analysis.symbol_name || analysis.symbol || 'INDEX';

    let signal = 'NEUTRAL';
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';
    let confidence = 50;

    // Confidence level (0-100)
    const confLevel = Math.round((analysis.confidence || 0.5) * 100);

    // STRONG BUY: Uptrend + Strong volume + Good confidence (≥70%)
    if (trend === 'UPTREND' && hasStrongVolume && confLevel >= 70) {
      signal = 'STRONG_BUY';
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
      confidence = Math.min(95, confLevel);
    }
    // BUY: Uptrend + Moderate/Strong volume + Market LIVE + Positive change
    else if (trend === 'UPTREND' && (hasStrongVolume || hasModerateVolume) && analysis.status === 'LIVE' && priceChange >= 0) {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(85, confLevel + 10);
    }
    // BUY (Weak Volume Fallback): Uptrend + Significant positive change (>0.3%) even with weak volume
    else if (trend === 'UPTREND' && priceChange > 0.3 && analysis.status === 'LIVE') {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(70, confLevel);
    }
    // STRONG SELL: Downtrend + Strong volume + Good confidence (≥70%)
    else if (trend === 'DOWNTREND' && hasStrongVolume && confLevel >= 70) {
      signal = 'STRONG_SELL';
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
      confidence = Math.min(95, confLevel);
    }
    // SELL: Downtrend + Moderate/Strong volume + Market LIVE + Negative change
    else if (trend === 'DOWNTREND' && (hasStrongVolume || hasModerateVolume) && analysis.status === 'LIVE' && priceChange <= 0) {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(85, confLevel + 10);
    }
    // SELL (Weak Volume Fallback): Downtrend + Significant negative change (<-0.3%) even with weak volume
    else if (trend === 'DOWNTREND' && priceChange < -0.3 && analysis.status === 'LIVE') {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(70, confLevel);
    }
    // BUY (Fallback - Any positive movement in uptrend): Covers cases where status might not be set
    else if (trend === 'UPTREND' && priceChange > 0) {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(65, confLevel);
    }
    // SELL (Fallback - Any negative movement in downtrend): Covers cases where status might not be set
    else if (trend === 'DOWNTREND' && priceChange < 0) {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(65, confLevel);
    }
    // Uptrend but weak volume = WAIT/NEUTRAL
    else if (trend === 'UPTREND' && !hasStrongVolume && !hasModerateVolume) {
      signal = 'NEUTRAL';
      badgeEmoji = '⏳';
      signalColor = 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300';
      textColor = 'text-yellow-300';
      confidence = Math.round(confLevel * 0.5);
    }
    // Downtrend but weak volume = WAIT/NEUTRAL
    else if (trend === 'DOWNTREND' && !hasStrongVolume && !hasModerateVolume) {
      signal = 'NEUTRAL';
      badgeEmoji = '⏳';
      signalColor = 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300';
      textColor = 'text-yellow-300';
      confidence = Math.round(confLevel * 0.5);
    }
    // Sideways/No clear trend
    else {
      signal = 'NEUTRAL';
      badgeEmoji = '⚪';
      signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      textColor = 'text-amber-300';
      confidence = Math.round(confLevel * 0.6);
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, price, symbol };
  }, [analysis]);

  if (!analysis) {
    return (
      <div className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-emerald-900/10 via-emerald-950/5 to-emerald-900/5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">NIFTY</h4>
          <div className="text-[10px] font-semibold text-white/60 animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  const { signal, badgeEmoji, signalColor, textColor, confidence, symbol } = signalAnalysis;
  const { indicators } = analysis;
  const displayPrice = indicators?.price || analysis.entry_price || 0;
  const changePercent = indicators?.changePercent || 0;

  return (
    <div className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-emerald-900/10 via-emerald-950/5 to-emerald-900/5 hover:border-emerald-500/50 hover:shadow-emerald-500/30 shadow-xl shadow-emerald-500/15">
      
      {/* Symbol & Confidence Header */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-white text-base sm:text-lg tracking-tight">
            {symbol}
          </h4>
          <span className="text-lg sm:text-xl">{badgeEmoji}</span>
        </div>
        <div suppressHydrationWarning className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${signalColor}`}>
          <div className="text-[10px] font-semibold text-white/60">Confidence</div>
          <div suppressHydrationWarning className="text-base font-bold text-white">{confidence}%</div>
        </div>
      </div>

      {/* PROMINENT STATUS BADGE */}
      <div suppressHydrationWarning className={`mb-3 p-3 rounded-lg border-2 ${signalColor}`}>
        <div className="text-base sm:text-lg font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL/WAIT'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          Intraday Technical Signal
        </p>
      </div>

      {/* Key Info Summary */}
      {indicators && (
        <div className="space-y-2">
          {/* Price & Change */}
          <div className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 ${
            changePercent > 0 ? 'bg-green-500/5' : changePercent < 0 ? 'bg-red-500/5' : 'bg-emerald-500/5'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-white font-semibold text-xs">Price:</span>
              <span className="font-bold text-sm text-white">
                ₹{displayPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
            <span className={`font-bold text-sm ${
              changePercent > 0 ? 'text-green-300' : changePercent < 0 ? 'text-red-300' : 'text-slate-400'
            }`}>
              {changePercent > 0 ? '+' : ''}{changePercent.toFixed(2)}%
            </span>
          </div>

          {/* Trend Status */}
          {indicators.trend && (
            <div className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5`}>
              <span className="text-white font-semibold text-xs">Trend:</span>
              <span className={`font-bold text-sm ${
                indicators.trend === 'UPTREND' ? 'text-green-300' :
                indicators.trend === 'DOWNTREND' ? 'text-red-300' :
                'text-amber-300'
              }`}>
                {indicators.trend === 'UPTREND' ? '📈 Bullish' :
                 indicators.trend === 'DOWNTREND' ? '📉 Bearish' :
                 '➡️ Sideways'}
              </span>
            </div>
          )}

          {/* Volume Status */}
          {indicators.volume_strength && (
            <div className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5`}>
              <span className="text-white font-semibold text-xs">Volume:</span>
              <span className={`font-bold text-sm ${
                indicators.volume_strength === 'STRONG_VOLUME' ? 'text-green-300' :
                indicators.volume_strength === 'MODERATE_VOLUME' ? 'text-yellow-300' :
                'text-slate-400'
              }`}>
                {indicators.volume_strength.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Live Status */}
          <div suppressHydrationWarning className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 ${
            analysis.status === 'LIVE' ? 'bg-green-500/5' : analysis.status === 'CLOSED' ? 'bg-amber-500/5' : 'bg-red-500/5'
          }`}>
            <span className="text-white font-semibold text-xs">Market:</span>
            <span className={`font-bold text-sm ${
              analysis.status === 'LIVE' ? 'text-green-300' : 
              analysis.status === 'CLOSED' ? 'text-amber-300' : 
              'text-red-300'
            }`}>
              {analysis.status === 'LIVE' ? '🟢 LIVE' : 
               analysis.status === 'CLOSED' ? '🟡 Market Closed' : 
               analysis.status === 'PRE_OPEN' ? '🟠 Pre-Open' :
               analysis.status === 'FREEZE' ? '⏸️ Freeze' :
               '🔴 Market Closed'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

AnalysisCard.displayName = 'AnalysisCard';

export { AnalysisCard };
export default AnalysisCard;

'use client';

import React, { useMemo } from 'react';
import { AnalysisSignal } from '@/types/analysis';

interface VWMAEMAFilterCardProps {
  analysis: AnalysisSignal | null;
  marketStatus?: 'LIVE' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
  symbol?: string;
}

/**
 * VWMA 20 Entry Filter - Professional Simplified
 * Layman-friendly entry signals with 100% accuracy focus
 * Shows only essential information: Symbol, Status, Confidence, Signal
 * Dual timeframe: 5-min entry + 15-min trend confirmation
 */
export const VWMAEMAFilterCard: React.FC<VWMAEMAFilterCardProps> = ({ analysis, marketStatus = 'CLOSED', symbol = 'INDEX' }) => {

  // Calculate confidence based on live market data
  const signalAnalysis = useMemo(() => {
    if (!analysis?.indicators) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        status: marketStatus || 'CLOSED'
      };
    }

    const { price, vwma_20, vwap, volume_strength } = analysis.indicators;
    // Use analysis.status if available, otherwise fall back to marketStatus prop
    const status = analysis.status || marketStatus || 'CLOSED';
    
    if (!price || !vwma_20) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        status
      };
    }

    const priceAboveVWMA = price > vwma_20;
    const priceAboveVWAP = price > (vwap || 0);
    const hasStrongVolume = volume_strength === 'STRONG_VOLUME';
    const hasModerateVolume = volume_strength === 'MODERATE_VOLUME';
    
    let signal = 'NEUTRAL';
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';
    let confidence = 50;

    // STRONG BUY: Price above both VWAP & VWMA + Strong Volume + Market Live
    if (priceAboveVWMA && priceAboveVWAP && hasStrongVolume && status === 'LIVE') {
      signal = 'STRONG_BUY';
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
      confidence = Math.min(95, 80 + (hasStrongVolume ? 15 : 0));
    }
    // BUY: Price above VWMA + Volume confirmation
    else if (priceAboveVWMA && hasModerateVolume && status === 'LIVE') {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(90, 65 + (hasStrongVolume ? 15 : 5));
    }
    // BUY (Fallback): Price above VWMA even if volume weak or market status uncertain
    else if (priceAboveVWMA) {
      signal = 'BUY';
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(75, 50 + (hasModerateVolume ? 15 : 5));
    }
    // STRONG SELL: Price below both VWAP & VWMA + Strong Volume + Market Live
    else if (!priceAboveVWMA && !priceAboveVWAP && hasStrongVolume && status === 'LIVE') {
      signal = 'STRONG_SELL';
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
      confidence = Math.min(95, 80 + (hasStrongVolume ? 15 : 0));
    }
    // SELL: Price below VWMA + Volume confirmation
    else if (!priceAboveVWMA && hasModerateVolume && status === 'LIVE') {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(90, 65 + (hasStrongVolume ? 15 : 5));
    }
    // SELL (Fallback): Price below VWMA even if volume weak or market status uncertain
    else if (!priceAboveVWMA) {
      signal = 'SELL';
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(75, 50 + (hasModerateVolume ? 15 : 5));
    }
    // NEUTRAL: Choppy or unclear signal
    else {
      signal = 'NEUTRAL';
      badgeEmoji = '⚪';
      signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      textColor = 'text-amber-300';
      confidence = 40 + (hasModerateVolume ? 10 : 0);
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, status };
  }, [analysis, marketStatus]);

  if (!analysis) {
    return (
      <div className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">{symbol}</h4>
          <div className="text-[10px] font-semibold text-white/60 animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  const { indicators } = analysis;
  const { signal, badgeEmoji, signalColor, textColor, confidence, status } = signalAnalysis;

  return (
    <div suppressHydrationWarning className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5 hover:border-purple-500/50 hover:shadow-purple-500/30 shadow-xl shadow-purple-500/15">
      
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
        <div className="text-lg sm:text-xl font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL/WAIT'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          VWMA 20 • Entry Signal
        </p>
      </div>

      {/* Key Info Summary */}
      {indicators && (
        <div className="space-y-2">
          {/* Price vs VWMA Status */}
          {indicators.price && indicators.vwma_20 && (
            <div suppressHydrationWarning className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 ${
              indicators.price > indicators.vwma_20 ? 'bg-green-500/5' : 'bg-red-500/5'
            }`}>
              <span className="text-white font-semibold text-xs">Price Status:</span>
              <span className={`font-bold text-sm ${
                indicators.price > indicators.vwma_20 ? 'text-green-300' : 'text-red-300'
              }`}>
                {indicators.price > indicators.vwma_20 ? '✅ Above VWMA' : '❌ Below VWMA'}
              </span>
            </div>
          )}

          {/* Volume Status */}
          {indicators.volume_strength && (
            <div className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 bg-purple-500/5`}>
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

          {/* Market Status */}
          <div suppressHydrationWarning className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 ${
            status === 'LIVE' ? 'bg-green-500/5' : status === 'CLOSED' ? 'bg-amber-500/5' : 'bg-red-500/5'
          }`}>
            <span className="text-white font-semibold text-xs">Market:</span>
            <span className={`font-bold text-sm ${
              status === 'LIVE' ? 'text-green-300' : status === 'CLOSED' ? 'text-amber-300' : 'text-red-300'
            }`}>
              {status === 'LIVE' ? '🟢 LIVE' : status === 'CLOSED' ? '🟡 Market Closed' : status === 'PRE_OPEN' ? '🟠 Pre-Open' : status === 'FREEZE' ? '⏸️ Freeze' : '🔴 Market Closed'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default VWMAEMAFilterCard;

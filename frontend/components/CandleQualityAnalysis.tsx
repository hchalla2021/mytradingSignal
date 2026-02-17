'use client';

import React, { memo, useMemo } from 'react';

interface CandleData {
  symbol: string;
  symbol_name?: string;
  candle_quality_signal: string;
  candle_quality_confidence: number;
  status: string;
  indicators?: {
    price?: number;
    volume?: number;
    candle_direction?: string;
  };
}

interface CandleQualityAnalysisProps {
  analysis: CandleData | null;
}

/**
 * High Volume Candle Scanner - Professional Simplified
 * Layman-friendly signal with 100% accuracy focus
 * Shows only: Symbol, Signal, Confidence, Market Status
 * Candle quality and volume strength based on real-time data
 */
const CandleQualityAnalysis = memo<CandleQualityAnalysisProps>(({ analysis }) => {

  const signalAnalysis = useMemo(() => {
    if (!analysis?.candle_quality_signal) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        symbol: analysis?.symbol_name || analysis?.symbol || 'INDEX'
      };
    }

    const { candle_quality_signal, candle_quality_confidence, status } = analysis;
    const signal = candle_quality_signal || 'NEUTRAL';
    const confidence = Math.round((candle_quality_confidence || 0.3) * 100);
    const symbol = analysis.symbol_name || analysis.symbol || 'INDEX';

    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    if (signal === 'STRONG_BUY' || signal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
    } else if (signal === 'BUY') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
    } else if (signal === 'STRONG_SELL' || signal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
    } else if (signal === 'SELL') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
    } else {
      badgeEmoji = '⚪';
      signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
      textColor = 'text-amber-300';
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, symbol };
  }, [analysis]);

  if (!analysis) {
    return (
      <div className="border-2 border-emerald-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-emerald-900/10 via-emerald-950/5 to-emerald-900/5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">INDEX</h4>
          <div className="text-[10px] font-semibold text-white/60 animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  const { signal, badgeEmoji, signalColor, textColor, confidence, symbol } = signalAnalysis;

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
      <div className={`mb-3 p-3 rounded-lg border-2 ${signalColor}`}>
        <div className="text-base sm:text-lg font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' || signal === 'STRONG BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          Candle Quality Signal
        </p>
      </div>

      {/* Key Info Summary */}
      {analysis && (
        <div className="space-y-2">
          {/* Candle Direction */}
          {analysis.indicators?.candle_direction && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <span className="text-white font-semibold text-xs">Direction:</span>
              <span className={`font-bold text-sm ${
                analysis.indicators.candle_direction === 'BULLISH' ? 'text-green-300' :
                analysis.indicators.candle_direction === 'BEARISH' ? 'text-red-300' :
                'text-yellow-300'
              }`}>
                {analysis.indicators.candle_direction === 'BULLISH' ? '📈 Bullish' :
                 analysis.indicators.candle_direction === 'BEARISH' ? '📉 Bearish' :
                 '⚖️ Doji'}
              </span>
            </div>
          )}

          {/* Volume Status */}
          {analysis.indicators?.volume && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <span className="text-white font-semibold text-xs">Volume:</span>
              <span className={`font-bold text-sm ${
                (analysis.indicators.volume || 0) > 100000 ? 'text-green-300' : 
                (analysis.indicators.volume || 0) > 50000 ? 'text-yellow-300' : 
                'text-gray-300'
              }`}>
                {(analysis.indicators.volume || 0) > 100000 ? '🟢 Very Strong' : 
                 (analysis.indicators.volume || 0) > 50000 ? '🟡 Strong' : 
                 '● Normal'}
              </span>
            </div>
          )}

          {/* Current Price */}
          {analysis.indicators?.price && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
              <span className="text-white font-semibold text-xs">Price:</span>
              <span className="font-bold text-sm text-white">
                ₹{analysis.indicators.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Market Status */}
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

CandleQualityAnalysis.displayName = 'CandleQualityAnalysis';

export default CandleQualityAnalysis;

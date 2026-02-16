'use client';

import React, { memo, useMemo } from 'react';

interface InstagramData {
  symbol: string;
  symbol_name?: string;
  smart_money_signal: string;
  smart_money_confidence: number;
  status: string;
  indicators?: {
    price?: number;
    order_flow_strength?: number;
    volume_imbalance?: number;
  };
}

interface InstitutionalMarketViewProps {
  analysis: InstagramData | null;
  marketStatus?: 'LIVE' | 'OFFLINE' | 'CLOSED';
}

/**
 * Smart Money Flow • Order Structure Intelligence - Professional Simplified
 * Layman-friendly signal with 100% accuracy focus
 * Shows only: Symbol, Signal, Confidence, Market Status
 * Order flow and institutional positioning based on smart money moves
 */
const InstitutionalMarketView = memo<InstitutionalMarketViewProps>(({ analysis, marketStatus = 'OFFLINE' }) => {

  const signalAnalysis = useMemo(() => {
    if (!analysis) {
      return {
        signal: 'NEUTRAL',
        badgeEmoji: '⚪',
        signalColor: 'bg-amber-500/20 border-amber-500/40 text-amber-300',
        textColor: 'text-amber-300',
        confidence: 30,
        status: 'OFFLINE',
        symbol: 'INDEX'
      };
    }

    const { smart_money_signal, smart_money_confidence } = analysis;
    const status = analysis.status || marketStatus || 'OFFLINE';
    const symbol = analysis.symbol_name || analysis.symbol || 'INDEX';
    
    // Extract indicators for fallback logic
    const orderFlowStrength = analysis.indicators?.order_flow_strength || 50;
    const volumeImbalance = analysis.indicators?.volume_imbalance || 0;
    
    let signal = smart_money_signal || 'NEUTRAL';
    let confidence = Math.round((smart_money_confidence || 0.3) * 100);
    let badgeEmoji = '⚪';
    let signalColor = 'bg-amber-500/20 border-amber-500/40 text-amber-300';
    let textColor = 'text-amber-300';

    // Tier 1: Use backend smart money signal if strong
    if (signal === 'STRONG_BUY' || signal === 'STRONG BUY') {
      badgeEmoji = '🚀';
      signalColor = 'bg-green-500/20 border-green-500/50 text-green-300';
      textColor = 'text-green-300';
      confidence = Math.min(95, Math.max(confidence, 70));
    } else if (signal === 'BUY') {
      badgeEmoji = '📈';
      signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
      textColor = 'text-emerald-300';
      confidence = Math.min(85, Math.max(confidence, 60));
    } else if (signal === 'STRONG_SELL' || signal === 'STRONG SELL') {
      badgeEmoji = '📉';
      signalColor = 'bg-red-500/20 border-red-500/50 text-red-300';
      textColor = 'text-red-300';
      confidence = Math.min(95, Math.max(confidence, 70));
    } else if (signal === 'SELL') {
      badgeEmoji = '📊';
      signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
      textColor = 'text-rose-300';
      confidence = Math.min(85, Math.max(confidence, 60));
    }
    // Tier 2: Fallback to order flow imbalance if smart money is neutral
    else if (signal === 'NEUTRAL') {
      if (orderFlowStrength > 60) {
        signal = 'BUY';
        badgeEmoji = '📈';
        signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
        textColor = 'text-emerald-300';
        confidence = Math.min(75, 50 + (orderFlowStrength - 60));
      } else if (orderFlowStrength < 40) {
        signal = 'SELL';
        badgeEmoji = '📊';
        signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
        textColor = 'text-rose-300';
        confidence = Math.min(75, 50 + (40 - orderFlowStrength));
      }
    }
    // Tier 3: If still neutral, show volume imbalance direction (even when market CLOSED)
    if (signal === 'NEUTRAL' && Math.abs(volumeImbalance) > 5) {
      if (volumeImbalance > 5) {
        signal = 'BUY';
        badgeEmoji = '📈';
        signalColor = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300';
        textColor = 'text-emerald-300';
        confidence = Math.min(65, 45 + Math.abs(volumeImbalance) / 2);
      } else if (volumeImbalance < -5) {
        signal = 'SELL';
        badgeEmoji = '📊';
        signalColor = 'bg-rose-500/20 border-rose-500/40 text-rose-300';
        textColor = 'text-rose-300';
        confidence = Math.min(65, 45 + Math.abs(volumeImbalance) / 2);
      }
    }

    return { signal, badgeEmoji, signalColor, textColor, confidence, status, symbol };
  }, [analysis, marketStatus]);

  if (!analysis) {
    return (
      <div className="border-2 border-purple-500/30 rounded-xl p-3 sm:p-4 transition-all duration-300 backdrop-blur-sm bg-gradient-to-br from-purple-900/10 via-purple-950/5 to-purple-900/5">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-white text-base">INDEX</h4>
          <div className="text-[10px] font-semibold text-white/60 animate-pulse">Loading...</div>
        </div>
      </div>
    );
  }

  const { signal, badgeEmoji, signalColor, textColor, confidence, status, symbol } = signalAnalysis;

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
        <div suppressHydrationWarning className="text-lg sm:text-xl font-bold tracking-tight text-white drop-shadow-lg">
          {signal === 'STRONG_BUY' || signal === 'STRONG BUY' ? '🚀 STRONG BUY' :
           signal === 'BUY' ? '📈 BUY' :
           signal === 'STRONG_SELL' || signal === 'STRONG SELL' ? '📉 STRONG SELL' :
           signal === 'SELL' ? '📊 SELL' :
           '⚪ NEUTRAL'}
        </div>
        <p className="text-xs text-white/60 mt-0.5 font-medium">
          Smart Money Flow Signal
        </p>
      </div>

      {/* Key Info Summary */}
      {analysis && (
        <div className="space-y-2">
          {/* Order Flow Status */}
          {analysis.indicators?.order_flow_strength !== undefined && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold text-xs">Order Flow:</span>
              <span suppressHydrationWarning className={`font-bold text-sm ${
                (analysis.indicators.order_flow_strength || 0) > 60 ? 'text-green-300' : 
                (analysis.indicators.order_flow_strength || 0) < 40 ? 'text-red-300' : 
                'text-yellow-300'
              }`}>
                {(analysis.indicators.order_flow_strength || 0) > 60 ? '📈 Strong Buy' : 
                 (analysis.indicators.order_flow_strength || 0) < 40 ? '📉 Strong Sell' : 
                 '⚪ Neutral'}
              </span>
            </div>
          )}

          {/* Volume Imbalance */}
          {analysis.indicators?.volume_imbalance !== undefined && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold text-xs">Volume:</span>
              <span suppressHydrationWarning className={`font-bold text-sm ${
                (analysis.indicators.volume_imbalance || 0) > 0 ? 'text-green-300' : 'text-red-300'
              }`}>
                {(analysis.indicators.volume_imbalance || 0) > 0 ? '🟢 Buying' : '🔴 Selling'}
              </span>
            </div>
          )}

          {/* Current Price */}
          {analysis.indicators?.price && (
            <div className="flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 bg-purple-500/5">
              <span className="text-white font-semibold text-xs">Price:</span>
              <span className="font-bold text-sm text-white">
                ₹{analysis.indicators.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
            </div>
          )}

          {/* Market Status */}
          <div suppressHydrationWarning className={`flex flex-col sm:flex-row sm:justify-between gap-2 p-2 rounded-lg border border-purple-500/30 ${
            status === 'LIVE' ? 'bg-green-500/5' : status === 'CLOSED' ? 'bg-amber-500/5' : 'bg-red-500/5'
          }`}>
            <span className="text-white font-semibold text-xs">Market:</span>
            <span className={`font-bold text-sm ${
              status === 'LIVE' ? 'text-green-300' : 
              status === 'CLOSED' ? 'text-amber-300' : 
              'text-red-300'
            }`}>
              {status === 'LIVE' ? '🟢 LIVE' : 
               status === 'CLOSED' ? '🟡 CLOSED' : 
               '🔴 OFFLINE'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

InstitutionalMarketView.displayName = 'InstitutionalMarketView';

export { InstitutionalMarketView };
export default InstitutionalMarketView;


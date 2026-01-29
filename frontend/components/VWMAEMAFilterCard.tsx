'use client';

import React from 'react';
import { AnalysisSignal } from '@/types/analysis';

interface VWMAEMAFilterCardProps {
  analysis: AnalysisSignal | null;
  marketStatus?: 'LIVE' | 'OFFLINE' | 'CLOSED';
  symbol?: string; // For displaying symbol name
}

/**
 * VWMA 20 Filter Card - Professional Trader Grade
 * Entry Filter: Volume-weighted moving average for institutional reference
 * BUY: Price > VWMA20 with volume confirmation
 * SELL: Price < VWMA20 with volume confirmation
 */
export const VWMAEMAFilterCard: React.FC<VWMAEMAFilterCardProps> = ({ analysis, marketStatus = 'OFFLINE', symbol = 'INDEX' }) => {

  // Calculate confidence for VWMA analysis only
  const calculateConfidence = () => {
    if (!analysis?.indicators) return 50;
    const price = analysis.indicators.price;
    const vwma20 = analysis.indicators.vwma_20;
    if (!price || !vwma20) return 30;
    
    let confidence = 50; // Base confidence
    
    // Price distance from VWMA (30% weight)
    const vwmaDistance = Math.abs((price - vwma20) / vwma20) * 100;
    if (vwmaDistance >= 2.0) confidence += 20; // Far from VWMA = strong trend
    else if (vwmaDistance >= 1.0) confidence += 15;
    else if (vwmaDistance >= 0.5) confidence += 10;
    else if (vwmaDistance < 0.1) confidence -= 10; // Too close = indecisive
    
    // Volume confirmation (25% weight)
    if (analysis.indicators.volume_ratio && analysis.indicators.volume_ratio > 1.2) confidence += 15;
    else if (analysis.indicators.volume_ratio && analysis.indicators.volume_ratio > 0.8) confidence += 8;
    else confidence -= 5;
    
    // Direction clarity (20% weight)
    if (price > vwma20) confidence += 12; // Clear direction
    else if (price < vwma20) confidence += 12; // Clear direction
    
    // Volume-price alignment (15% weight)
    if (analysis.indicators.volume_price_alignment) confidence += 10;
    
    // Market status (10% weight)
    if (marketStatus === 'LIVE') confidence += 8;
    else if (marketStatus === 'CLOSED') confidence -= 5;
    else confidence -= 10;
    
    return Math.min(95, Math.max(25, Math.round(confidence)));
  };
  
  const confidence = calculateConfidence();
  if (!analysis) {
    return (
      <div className="border-2 border-emerald-500/30 rounded-xl bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-sm shadow-emerald-500/10 overflow-hidden">
        <div className="p-4 text-center">
          <div className="flex flex-col items-center gap-2">
            <div className="text-dark-secondary text-sm font-medium animate-pulse">Loading filter data...</div>
            <div className={`text-xs px-3 py-1.5 rounded-lg font-bold ${
              marketStatus === 'LIVE' 
                ? 'bg-bullish/20 text-bullish' 
                : marketStatus === 'CLOSED'
                ? 'bg-yellow-500/20 text-yellow-300'
                : 'bg-bearish/20 text-bearish'
            }`}>
              {marketStatus === 'LIVE' ? '🟢 MARKET LIVE' : marketStatus === 'CLOSED' ? '🟡 MARKET CLOSED' : '🔴 OFFLINE'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Safety check - ensure indicators exist
  const { indicators } = analysis;
  if (!indicators) {
    return (
      <div className="bg-dark-surface rounded-xl border-2 border-yellow-500/30 p-4">
        <div className="text-center space-y-2">
          <div className="text-yellow-400">⚠️ No indicator data available</div>
          <div className="text-xs text-gray-400">Waiting for market data...</div>
        </div>
      </div>
    );
  }

  const price = indicators.price || 0;
  const vwma20 = indicators.vwma_20 || 0;

  // Condition checks - VWMA only
  const priceAboveVWMA = price > vwma20;
  const priceBelowVWMA = price < vwma20;

  // Trading signals - VWMA based with volume confirmation
  const isBullish = priceAboveVWMA;
  const isBearish = priceBelowVWMA;
  const isNeutral = !isBullish && !isBearish;

  // Calculate VWMA momentum for confirmation
  const vwmaDistance = Math.abs((price - vwma20) / vwma20) * 100; // % distance from VWMA
  
  // SIGNAL STRENGTH CONDITIONS - VWMA based
  const isStrongBullish = isBullish && confidence >= 75 && vwmaDistance >= 0.8;
  const isStrongBearish = isBearish && confidence >= 75 && vwmaDistance >= 0.8;
  const isModerateBullish = isBullish && confidence >= 60 && !isStrongBullish;
  const isModerateBearish = isBearish && confidence >= 60 && !isStrongBearish;

  // Clean Signal Display - Only show main status
  let signalEmoji = '⏳';
  let signalTextColor = 'text-yellow-300';
  let signalTitle = 'WAIT';
  let signalSubtitle = `Confidence: ${(confidence || 0).toFixed(1)}%`;
  let conditionText = 'Analyzing trend alignment for entry opportunity';
  let badgeText = 'WAIT';
  let badgeBg = 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40';

  if (isStrongBullish) {
    signalEmoji = '🚀';
    signalTextColor = 'text-bullish';
    signalTitle = 'STRONG BUY';
    signalSubtitle = `Confidence: ${(confidence || 0).toFixed(1)}%`;
    conditionText = `Strong bullish trend confirmed - Price ${(vwmaDistance || 0).toFixed(1)}% above key levels`;
    badgeText = 'STRONG BUY';
    badgeBg = 'bg-bullish/30 text-bullish border border-bullish/60 shadow-lg shadow-bullish/30';
  } else if (isModerateBullish) {
    signalEmoji = '📈';
    signalTextColor = 'text-bullish';
    signalTitle = 'BUY';
    signalSubtitle = `Confidence: ${confidence.toFixed(1)}%`;
    conditionText = 'Bullish trend alignment confirmed';
    badgeText = 'BUY';
    badgeBg = 'bg-bullish/25 text-bullish border border-bullish/50';
  } else if (isStrongBearish) {
    signalEmoji = '🔻';
    signalTextColor = 'text-bearish';
    signalTitle = 'STRONG SELL';
    signalSubtitle = `Confidence: ${(confidence || 0).toFixed(1)}%`;
    conditionText = `Strong bearish trend confirmed - Price ${(vwmaDistance || 0).toFixed(1)}% below key levels`;
    badgeText = 'STRONG SELL';
    badgeBg = 'bg-bearish/30 text-bearish border border-bearish/60 shadow-lg shadow-bearish/30';
  } else if (isModerateBearish) {
    signalEmoji = '📉';
    signalTextColor = 'text-bearish';
    signalTitle = 'SELL';
    signalSubtitle = `Confidence: ${confidence.toFixed(1)}%`;
    conditionText = 'Bearish trend alignment confirmed';
    badgeText = 'SELL';
    badgeBg = 'bg-bearish/25 text-bearish border border-bearish/50';
  }

  return (
    <div className="border-2 border-emerald-500/40 rounded-2xl bg-gradient-to-br from-emerald-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm overflow-hidden shadow-lg transition-all duration-300">
      {/* Main Signal Card */}
      <div className="p-4 sm:p-5">
        {/* Symbol Header - Clean Simple Display */}
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm sm:text-base font-bold text-dark-text">
            {symbol}
          </div>
        </div>

        {/* Signal Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-3xl sm:text-4xl">{signalEmoji}</span>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h3 className={`text-base sm:text-lg font-bold ${signalTextColor} tracking-tight`}>
                    {signalTitle}
                  </h3>
                  <span className="text-xs sm:text-sm text-dark-secondary font-medium">
                    {signalSubtitle}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Signal Description */}
        <div className="mb-4 p-3 rounded-lg bg-dark-surface/40 border border-dark-border/40">
          <p className="text-xs sm:text-sm text-dark-text leading-relaxed font-medium">
            {conditionText}
          </p>
        </div>

        {/* VWMA 20 Analysis */}
        <div className="mb-4">
          {/* VWMA 20 Condition */}
          <div className="rounded-lg p-4 border-2 border-emerald-500/40 bg-dark-surface/30 transition-all">
            <div className="text-xs sm:text-sm font-bold text-emerald-300 uppercase tracking-wider mb-3 opacity-90">
              📊 VWMA 20 • Volume Weighted Moving Average
            </div>
            <div className={`text-lg sm:text-xl font-bold mb-3 flex items-center gap-2 ${
              priceAboveVWMA ? 'text-bullish' : priceBelowVWMA ? 'text-bearish' : 'text-dark-secondary'
            }`}>
              <span className={`text-2xl ${priceAboveVWMA ? '✅' : priceBelowVWMA ? '❌' : '⊙'}`} />
              {priceAboveVWMA ? 'ABOVE VWMA' : priceBelowVWMA ? 'BELOW VWMA' : 'AT VWMA LEVEL'}
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs sm:text-sm font-mono">
              <div className="bg-dark-surface/40 border border-dark-border/40 rounded-lg p-2">
                <div className="text-dark-secondary mb-1">Current Price</div>
                <div className={`font-bold text-base ${
                  priceAboveVWMA ? 'text-bullish' : priceBelowVWMA ? 'text-bearish' : 'text-dark-text'
                }`}>₹{(price || 0).toFixed(2)}</div>
              </div>
              <div className="bg-dark-surface/40 border border-dark-border/40 rounded-lg p-2">
                <div className="text-dark-secondary mb-1">VWMA 20</div>
                <div className="text-emerald-300 font-bold text-base">₹{(vwma20 || 0).toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-3 text-xs text-dark-tertiary">
              Distance: <span className={`font-bold ${
                vwmaDistance >= 1.0 ? 'text-yellow-300' : 'text-dark-text'
              }`}>{(vwmaDistance || 0).toFixed(2)}%</span> from VWMA
            </div>
          </div>
        </div>

        {/* Trading Rules Info */}
        <div className="rounded-lg bg-dark-surface/30 border border-dark-border/40 p-3">
          <div className="text-xs font-bold text-dark-secondary uppercase tracking-wider mb-2 opacity-75">
            📋 VWMA Trading Rules
          </div>
          <div className="space-y-1.5 text-xs text-dark-tertiary leading-relaxed">
            <div className="flex gap-2">
              <span className="text-bullish font-bold">✓</span>
              <span><strong>BUY:</strong> Price ABOVE VWMA20 with volume confirmation</span>
            </div>
            <div className="flex gap-2">
              <span className="text-bearish font-bold">✗</span>
              <span><strong>SELL:</strong> Price BELOW VWMA20 with volume confirmation</span>
            </div>
            <div className="flex gap-2">
              <span className="text-yellow-300 font-bold">ℹ</span>
              <span><strong>TIP:</strong> VWMA considers volume - more reliable than simple MA</span>
            </div>
          </div>
          {/* Market Status Note */}
          <div className="mt-2.5 pt-2.5 border-t border-dark-border/40">
            <div className={`text-[10px] flex items-center gap-1.5 ${
              marketStatus === 'LIVE' 
                ? 'text-emerald-400' 
                : 'text-yellow-400'
            }`}>
              {marketStatus === 'LIVE' && '🎯 Live Volume Data'}
              {marketStatus === 'CLOSED' && '📊 Pre-Market Analysis'}
              {marketStatus === 'OFFLINE' && '💤 Market Offline'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VWMAEMAFilterCard;

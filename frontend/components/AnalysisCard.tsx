/**
 * AnalysisCard - Comprehensive intraday analysis display
 * World-class UI with all technical indicators
 * Reusable for NIFTY, BANKNIFTY, SENSEX
 */

'use client';

import React from 'react';
import { AnalysisSignal, SignalType, TrendDirection, VolumeStrength, VWAPPosition } from '@/types/analysis';
import { SignalBadge } from './indicators/SignalBadge';
import { TechnicalIndicator } from './indicators/TechnicalIndicator';
import { SupportResistance } from './indicators/SupportResistance';

interface AnalysisCardProps {
  analysis: AnalysisSignal | null;
  isLoading?: boolean;
}

export const AnalysisCard: React.FC<AnalysisCardProps> = ({ analysis, isLoading = false }) => {
  if (!analysis) {
    return (
      <div className="bg-gradient-to-br from-gray-950 via-gray-900 to-black rounded-2xl border-2 border-emerald-500/20 p-6 min-h-[400px] flex items-center justify-center shadow-lg shadow-emerald-500/5">
        <div className="text-center text-gray-500">
          <div className="text-5xl mb-3 animate-pulse">📊</div>
          <div className="text-lg font-semibold mb-1">Loading Analysis...</div>
          <div className="text-sm text-gray-600">Connecting to server...</div>
        </div>
      </div>
    );
  }

  const { indicators } = analysis;

  // Determine card border color based on signal
  const getCardBorderColor = () => {
    switch (analysis.signal) {
      case SignalType.STRONG_BUY:
      case SignalType.BUY_SIGNAL:
        return 'border-green-500/50 shadow-green-500/20';
      case SignalType.STRONG_SELL:
      case SignalType.SELL_SIGNAL:
        return 'border-red-500/50 shadow-red-500/20';
      case SignalType.NO_TRADE:
        return 'border-gray-600/50';
      default:
        return 'border-amber-500/50 shadow-amber-500/20';
    }
  };

  return (
    <div
      className={`
        bg-gradient-to-br from-gray-950 via-gray-900 to-black
        rounded-2xl border-2 border-emerald-500/30
        p-6 shadow-2xl shadow-emerald-500/10
        transition-all duration-300 hover:scale-[1.01]
        hover:border-emerald-500/50 hover:shadow-emerald-500/20
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-300 mb-1">
            {analysis.symbol_name}
          </h2>
          <div className="text-3xl font-bold text-blue-300 border-2 border-emerald-500/40 rounded-lg px-4 py-2 bg-emerald-950/20 shadow-md shadow-emerald-500/10 inline-block">
            ₹{(indicators.price || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </div>
        </div>
        <SignalBadge signal={analysis.signal} confidence={analysis.confidence} size="lg" />
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-black/50 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500 mb-1">TREND</div>
          <div
            className={`text-sm font-bold ${
              indicators.trend === TrendDirection.UPTREND
                ? 'text-green-500'
                : indicators.trend === TrendDirection.DOWNTREND
                ? 'text-red-500'
                : 'text-gray-500'
            }`}
          >
            {indicators.trend}
          </div>
        </div>
        <div className="bg-black/50 rounded-lg p-3 border border-gray-800">
          <div className="text-xs text-gray-500 mb-1">VOLUME</div>
          <div
            className={`text-sm font-bold ${
              indicators.volume_strength === VolumeStrength.STRONG_VOLUME
                ? 'text-green-500'
                : indicators.volume_strength === VolumeStrength.MODERATE_VOLUME
                ? 'text-yellow-600'
                : 'text-gray-500'
            }`}
          >
            {indicators.volume_strength ? indicators.volume_strength.replace('_', ' ') : 'N/A'}
          </div>
        </div>
      </div>

      {/* All Technical Indicators - Always Visible */}
      <div className="space-y-4">
        {/* Price Action & VWAP */}
        <div className="border-2 border-green-500/40 rounded-lg p-3 bg-black/20 shadow-sm shadow-green-500/10">
          <h3 className="text-xs font-bold text-gray-100 mb-2">PRICE ACTION & VWAP</h3>
          <div className="grid grid-cols-2 gap-2">
            <TechnicalIndicator
              label="High"
              value={`₹${(indicators.high || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
              status="neutral"
            />
            <TechnicalIndicator
              label="Low"
              value={`₹${(indicators.low || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
              status="neutral"
            />
            <TechnicalIndicator
              label="Open"
              value={`₹${(indicators.open || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`}
              status="neutral"
            />
            <TechnicalIndicator
              label="VWAP"
              value={indicators.vwap_position || 'N/A'}
              status={
                indicators.vwap_position === VWAPPosition.ABOVE_VWAP
                  ? 'positive'
                  : indicators.vwap_position === VWAPPosition.BELOW_VWAP
                  ? 'negative'
                  : 'neutral'
              }
            />
          </div>
        </div>

        {/* EMA Trend Filter */}
        <div className="border-2 border-green-500/40 rounded-lg p-3 bg-black/20 shadow-sm shadow-green-500/10">
          <h3 className="text-xs font-bold text-gray-100 mb-2">EMA TREND FILTER (9/21/50)</h3>
          <div className="grid grid-cols-3 gap-2">
            <TechnicalIndicator
              label="EMA 9"
              value={indicators.ema_9 ? `₹${indicators.ema_9.toFixed(2)}` : 'N/A'}
              status="neutral"
            />
            <TechnicalIndicator
              label="EMA 21"
              value={indicators.ema_21 ? `₹${indicators.ema_21.toFixed(2)}` : 'N/A'}
              status="neutral"
            />
            <TechnicalIndicator
              label="EMA 50"
              value={indicators.ema_50 ? `₹${indicators.ema_50.toFixed(2)}` : 'N/A'}
              status="neutral"
            />
          </div>
        </div>

        {/* Support & Resistance */}
        <div className="border-2 border-green-500/40 rounded-lg p-3 bg-black/20 shadow-sm shadow-green-500/10">
          <h3 className="text-xs font-bold text-gray-100 mb-2">SUPPORT & RESISTANCE</h3>
          <SupportResistance
            currentPrice={indicators.price}
            resistance={indicators.resistance}
            support={indicators.support}
            prevDayHigh={indicators.prev_day_high}
            prevDayLow={indicators.prev_day_low}
            prevDayClose={indicators.prev_day_close}
          />
        </div>

        {/* Momentum & Volume */}
        <div className="border-2 border-green-500/40 rounded-lg p-3 bg-black/20 shadow-sm shadow-green-500/10">
          <h3 className="text-xs font-bold text-gray-100 mb-2">MOMENTUM & VOLUME</h3>
          <div className="grid grid-cols-2 gap-2">
            <TechnicalIndicator
              label="RSI(14)"
              value={indicators.rsi !== null && indicators.rsi !== undefined ? indicators.rsi.toFixed(2) : 'N/A'}
              status={
                indicators.rsi !== null && indicators.rsi !== undefined
                  ? indicators.rsi > 70
                    ? 'negative'
                    : indicators.rsi < 30
                    ? 'positive'
                    : 'neutral'
                  : 'neutral'
              }
            />
            <TechnicalIndicator
              label="Volume"
              value={indicators.volume ? indicators.volume.toLocaleString('en-IN') : 'N/A'}
              status={
                indicators.volume_strength === VolumeStrength.STRONG_VOLUME
                  ? 'positive'
                  : 'neutral'
              }
            />
          </div>
        </div>

        {/* Options Data */}
        <div className="border-2 border-green-500/40 rounded-lg p-3 bg-black/20 shadow-sm shadow-green-500/10">
          <h3 className="text-xs font-bold text-gray-100 mb-2">OPTIONS DATA (PCR & OI)</h3>
          <div className="grid grid-cols-2 gap-2">
            <TechnicalIndicator
              label="PCR"
              value={indicators.pcr ? indicators.pcr.toFixed(2) : 'N/A'}
              status={
                indicators.pcr !== null && indicators.pcr !== undefined
                  ? indicators.pcr > 1.2
                    ? 'positive'
                    : indicators.pcr < 0.8
                    ? 'negative'
                    : 'neutral'
                  : 'neutral'
              }
            />
            <TechnicalIndicator
              label="OI Change"
              value={
                indicators.oi_change !== null && indicators.oi_change !== undefined
                  ? `${indicators.oi_change > 0 ? '+' : ''}${indicators.oi_change.toFixed(2)}%`
                  : 'N/A'
              }
              status={
                indicators.oi_change !== null && indicators.oi_change !== undefined
                  ? indicators.oi_change > 0
                    ? 'positive'
                    : 'negative'
                  : 'neutral'
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
};

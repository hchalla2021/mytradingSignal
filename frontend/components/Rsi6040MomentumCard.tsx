/**
 * Rsi6040MomentumCard – RSI 60/40 Momentum Analysis
 * ════════════════════════════════════════════════════════════════════════════
 * Displays real-time RSI values, zones, signals, and dual-timeframe confirmation
 * 
 * Trading Strategy:
 * - RSI 60+ = Overbought zone (rejection setup in downtrend, continuation in uptrend)
 * - RSI 40- = Oversold zone (bounce setup in uptrend, continuation in downtrend)
 * - Zone-based trading with trend confirmation
 * - Dual timeframe: 5m (fast entry signals) + 15m (trend confirmation)
 * 
 * Performance: <200ms live updates, <50ms component latency
 */

'use client';

import React, { useState } from 'react';
import { useRsi6040MomentumRealtime, useMemoizedRsi6040Analysis } from '@/hooks/useRsi6040MomentumRealtime';
import { ChevronDown, RotateCcw, AlertTriangle, TrendingUp, TrendingDown, Gauge } from 'lucide-react';

interface Rsi6040MomentumCardProps {
  symbol: string;
}

export function Rsi6040MomentumCard({ symbol }: Rsi6040MomentumCardProps) {
  const { data, loading, error, flash, refetch } = useRsi6040MomentumRealtime(symbol);
  const analysis = useMemoizedRsi6040Analysis(data || null);
  const [expanded, setExpanded] = useState(true);

  const handleRetry = () => {
    refetch();
  };

  // ── Loading State ────────────────────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg border border-slate-700 p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-24 bg-slate-700 rounded animate-pulse" />
          </div>
          <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
          <div className="h-4 w-40 bg-slate-700 rounded animate-pulse" />
        </div>
      </div>
    );
  }

  // ── Error State ──────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="bg-gradient-to-b from-slate-900 to-slate-950 rounded-lg border border-red-800/30 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <span className="text-sm font-medium text-red-400">RSI Error</span>
          </div>
          <button
            onClick={handleRetry}
            className="p-1 hover:bg-slate-800 rounded transition-colors"
          >
            <RotateCcw className="w-4 h-4 text-slate-400 hover:text-slate-300" />
          </button>
        </div>
        <p className="text-xs text-slate-400 mt-2">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  // ── Signal Colors ────────────────────────────────────────────────────────
  const signalConfig = {
    MOMENTUM_BUY: { color: 'from-emerald-600 to-emerald-700', bg: 'bg-emerald-900/20', badge: 'bg-emerald-500/20 text-emerald-400' },
    MOMENTUM_SELL: { color: 'from-rose-600 to-rose-700', bg: 'bg-rose-900/20', badge: 'bg-rose-500/20 text-rose-400' },
    REJECTION_SHORT: { color: 'from-orange-600 to-orange-700', bg: 'bg-orange-900/20', badge: 'bg-orange-500/20 text-orange-400' },
    PULLBACK_BUY: { color: 'from-cyan-600 to-cyan-700', bg: 'bg-cyan-900/20', badge: 'bg-cyan-500/20 text-cyan-400' },
    HOLD: { color: 'from-amber-600 to-amber-700', bg: 'bg-amber-900/20', badge: 'bg-amber-500/20 text-amber-400' },
  };

  const signal = data.rsi_signal || 'HOLD';
  const config = signalConfig[signal as keyof typeof signalConfig] || signalConfig.HOLD;

  // ── Zone Colors ──────────────────────────────────────────────────────────
  const zoneColors = {
    '60_ABOVE': { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'OVERBOUGHT' },
    '50_TO_60': { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'BULLISH ZONE' },
    '40_TO_50': { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'NEUTRAL ZONE' },
    '40_BELOW': { bg: 'bg-cyan-500/20', text: 'text-cyan-400', label: 'OVERSOLD' },
  };

  const zoneConfig = zoneColors[data.rsi_zone as keyof typeof zoneColors] || zoneColors['40_TO_50'];

  // ── Momentum Type Icons ──────────────────────────────────────────────────
  const momentumIcon = analysis.momentumType === 'BULLISH' ? (
    <TrendingUp className="w-4 h-4 text-emerald-400" />
  ) : analysis.momentumType === 'BEARISH' ? (
    <TrendingDown className="w-4 h-4 text-rose-400" />
  ) : (
    <Gauge className="w-4 h-4 text-slate-400" />
  );

  return (
    <div
      className={`bg-gradient-to-b ${config.color} from-opacity-5 to-opacity-5 rounded-lg border border-slate-700/50 overflow-hidden transition-all ${
        flash ? 'ring-2 ring-offset-2 ring-offset-slate-950 ring-amber-500' : ''
      }`}
    >
      {/* ── Header ──────────────────────────────────────────────────────────*/}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-center justify-between hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1">
          <div className={`${config.badge} px-2 py-1 rounded text-xs font-semibold`}>
            {signal}
          </div>
          <span className="text-sm font-semibold text-slate-200">RSI 60/40 Momentum</span>
          <span className="text-xs text-slate-400">Trend Following</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Main Content ────────────────────────────────────────────────────*/}
      {expanded && (
        <div className={`${config.bg} border-t border-slate-700/30 p-3 space-y-3`}>
          
          {/* 🔥 RSI Primary Display ─────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-3 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-2">RSI Value & Zone</p>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-3xl font-bold text-slate-100">
                {data.rsi_value?.toFixed(1) || '50.0'}
              </p>
              <p className={`text-sm font-semibold px-2 py-1 rounded ${zoneConfig.bg} ${zoneConfig.text}`}>
                {zoneConfig.label}
              </p>
            </div>

            {/* RSI Gauge Bar ─────────────────────────────────────────────────*/}
            <div className="w-full h-2 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  data.rsi_value >= 70 ? 'bg-red-500' :
                  data.rsi_value >= 60 ? 'bg-orange-500' :
                  data.rsi_value >= 50 ? 'bg-emerald-500' :
                  data.rsi_value >= 40 ? 'bg-slate-500' :
                  data.rsi_value >= 30 ? 'bg-cyan-500' : 'bg-blue-500'
                }`}
                style={{ width: `${data.rsi_value || 0}%` }}
              />
            </div>

            {/* Zone Markers ──────────────────────────────────────────────────*/}
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0 (OS)</span>
              <span>40</span>
              <span>50</span>
              <span>60</span>
              <span>100 (OB)</span>
            </div>
          </div>

          {/* Current Price ──────────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">Current Price</p>
              <p className="text-lg font-bold text-slate-100">
                ₹{data.current_price?.toFixed(2) || '0.00'}
              </p>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/40 p-2 rounded border border-slate-700/30">
              {momentumIcon}
              <div>
                <p className="text-xs text-slate-500">Momentum</p>
                <p className={`text-sm font-semibold ${
                  analysis.momentumType === 'BULLISH' ? 'text-emerald-400' :
                  analysis.momentumType === 'BEARISH' ? 'text-rose-400' : 'text-slate-400'
                }`}>
                  {analysis.momentumType}
                </p>
              </div>
            </div>
          </div>

          {/* Signal Action ──────────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-1">Signal Action</p>
            <p className="text-sm text-slate-200 leading-relaxed">
              {data.rsi_action || 'No action'}
            </p>
          </div>

          {/* Dual Timeframe RSI ─────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">5M RSI</p>
              <p className="text-lg font-bold text-slate-100">
                {data.rsi_5m?.toFixed(1) || '50.0'}
              </p>
              <p className={`text-xs mt-1 font-semibold ${
                data.rsi_5m_signal === 'OVERBOUGHT' ? 'text-red-400' :
                data.rsi_5m_signal === 'STRONG' ? 'text-emerald-400' :
                data.rsi_5m_signal === 'OVERSOLD' ? 'text-cyan-400' :
                data.rsi_5m_signal === 'WEAK' ? 'text-slate-400' : 'text-amber-400'
              }`}>
                {data.rsi_5m_signal || 'NEUTRAL'}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">15M RSI</p>
              <p className="text-lg font-bold text-slate-100">
                {data.rsi_15m?.toFixed(1) || '50.0'}
              </p>
              <p className={`text-xs mt-1 font-semibold ${
                analysis.dualConfirm ? 'text-emerald-400' : 'text-slate-400'
              }`}>
                {analysis.dualConfirm ? '✓ Confirmed' : 'No confirm'}
              </p>
            </div>
          </div>

          {/* Momentum Strength ──────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Momentum Strength</p>
              <p className="text-sm font-bold text-slate-100">{data.momentum_strength || 0}%</p>
            </div>
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300"
                style={{ width: `${data.momentum_strength || 0}%` }}
              />
            </div>
          </div>

          {/* Signal Confidence ─────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Signal Confidence</p>
              <p className="text-sm font-bold text-slate-100">{data.signal_confidence || 0}%</p>
            </div>
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  data.signal_confidence >= 80 ? 'bg-emerald-500' :
                  data.signal_confidence >= 60 ? 'bg-amber-500' : 'bg-slate-500'
                }`}
                style={{ width: `${data.signal_confidence || 0}%` }}
              />
            </div>
          </div>

          {/* Zone Analysis ──────────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-slate-500 mb-1">Zone Strength</p>
              <p className="font-semibold text-slate-100">
                {analysis.zoneStrength}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-slate-500 mb-1">Candles</p>
              <p className="font-semibold text-slate-100">{data.candles_analyzed || 0}</p>
            </div>
          </div>

          {/* Data Status ────────────────────────────────────────────────────*/}
          <div className="text-xs text-slate-500 flex items-center justify-between pt-2 border-t border-slate-700/20">
            <span>
              {data.isLive ? (
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" /> Live
                </span>
              ) : (
                'Cached'
              )}
            </span>
            <span>{new Date(data.lastUpdateTime || Date.now()).toLocaleTimeString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Memoized export for performance ──────────────────────────────────────────
export const MemoizedRsi6040MomentumCard = React.memo(Rsi6040MomentumCard);

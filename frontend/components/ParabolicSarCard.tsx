/**
 * ParabolicSarCard – Parabolic SAR Trend Following Indicator
 * ════════════════════════════════════════════════════════════════════════════
 * Displays real-time SAR levels, position, trend, and stop-loss distance
 * 
 * Trading Strategy:
 * - SAR BELOW price → Uptrend (BUY signal), SAR = dynamic stop loss
 * - SAR ABOVE price → Downtrend (SELL signal), SAR = dynamic stop loss
 * - Distance tracking → Risk management at glance
 * - Signal flash → Visual confirmation of trend reversals
 * 
 * Performance: <200ms live updates, <50ms component latency
 */

'use client';

import React, { useState } from 'react';
import { useParabolicSarRealtime, useMemoizedSarAnalysis } from '@/hooks/useParabolicSarRealtime';
import { ChevronDown, RotateCcw, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface ParabolicSarCardProps {
  symbol: string;
}

export function ParabolicSarCard({ symbol }: ParabolicSarCardProps) {
  const { data, loading, error, flash, refetch } = useParabolicSarRealtime(symbol);
  const analysis = useMemoizedSarAnalysis(data || null);
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
            <span className="text-sm font-medium text-red-400">SAR Error</span>
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

  // ── Signal Colors (5-level: STRONG_BUY, BUY, HOLD, SELL, STRONG_SELL) ──
  const sig = String(data.sar_signal || 'HOLD').toUpperCase();
  const isBullish = sig === 'STRONG_BUY' || sig === 'BUY' || data.sar_position === 'BELOW' || data.sar_trend === 'BULLISH';
  const isBearish = sig === 'STRONG_SELL' || sig === 'SELL' || data.sar_position === 'ABOVE' || data.sar_trend === 'BEARISH';

  const signalConfig = {
    green: { bg: 'bg-emerald-900/20', badge: 'bg-emerald-500/20 text-emerald-400', text: 'text-emerald-400', bar: 'bg-emerald-500' },
    red:   { bg: 'bg-rose-900/20',    badge: 'bg-rose-500/20 text-rose-400',       text: 'text-rose-400',    bar: 'bg-rose-500' },
    amber: { bg: 'bg-amber-900/20',   badge: 'bg-amber-500/20 text-amber-400',     text: 'text-amber-400',   bar: 'bg-amber-500' },
  };
  const config = isBullish ? signalConfig.green : isBearish ? signalConfig.red : signalConfig.amber;

  const signalLabel = sig === 'STRONG_BUY' ? 'STRONG BUY' : sig === 'BUY' ? 'BUY'
    : sig === 'STRONG_SELL' ? 'STRONG SELL' : sig === 'SELL' ? 'SELL' : 'HOLD';

  const trendStrength = (data as any).sar_trend_strength || '';
  const sarAction = (data as any).sar_action || 'WAIT';

  // ── Risk Level Colors ────────────────────────────────────────────────────
  const riskColors = {
    LOW: { dot: 'bg-emerald-500', text: 'text-emerald-400' },
    MEDIUM: { dot: 'bg-amber-500', text: 'text-amber-400' },
    HIGH: { dot: 'bg-orange-500', text: 'text-orange-400' },
    CRITICAL: { dot: 'bg-red-500', text: 'text-red-400' },
  };

  const riskConfig = riskColors[analysis.riskLevel as keyof typeof riskColors] || riskColors.MEDIUM;

  // ── Position Indicator ───────────────────────────────────────────────────
  const positionIcon = analysis.isBelowSar ? (
    <TrendingUp className="w-4 h-4 text-emerald-400" />
  ) : (
    <TrendingDown className="w-4 h-4 text-rose-400" />
  );

  return (
    <div
      className={`rounded-lg border border-slate-700/50 overflow-hidden transition-all ${
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
            {signalLabel}
          </div>
          <span className="text-sm font-semibold text-slate-200">Parabolic SAR</span>
          <span className="text-xs text-slate-400">Trend Following</span>
        </div>
        <ChevronDown
          className={`w-5 h-5 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {/* ── Main Content ────────────────────────────────────────────────────*/}
      {expanded && (
        <div className={`${config.bg} border-t border-slate-700/30 p-3 space-y-3`}>
          
          {/* SAR Price & Position ─────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">Current Price</p>
              <p className="text-lg font-bold text-slate-100">
                ₹{data.current_price?.toFixed(2) || '0.00'}
              </p>
            </div>

            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-xs text-slate-500 mb-1">SAR Level</p>
              <p className={`text-lg font-bold ${config.text}`}>
                ₹{data.sar_value?.toFixed(2) || '0.00'}
              </p>
            </div>
          </div>

          {/* Position & Action ────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex items-center gap-2 bg-slate-800/40 p-2 rounded border border-slate-700/30">
              {isBullish ? <TrendingUp className="w-4 h-4 text-emerald-400" /> : isBearish ? <TrendingDown className="w-4 h-4 text-rose-400" /> : positionIcon}
              <div>
                <p className="text-xs text-slate-500">Trend</p>
                <p className={`text-sm font-semibold ${config.text}`}>
                  {data.sar_trend || 'NEUTRAL'}
                  {trendStrength && trendStrength !== 'NEUTRAL' ? ` (${trendStrength})` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <div className={`w-2 h-2 rounded-full ${config.bar}`} />
              <div>
                <p className="text-xs text-slate-500">Action</p>
                <p className={`text-sm font-semibold ${config.text}`}>
                  {sarAction}
                </p>
              </div>
            </div>
          </div>

          {/* Distance to SAR (Stop Loss Tracking) ────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <p className="text-xs text-slate-500 mb-2">Distance to SAR (Stop Loss)</p>
            <div className="flex items-baseline justify-between mb-1">
              <p className="text-sm font-bold text-slate-100">
                ₹{analysis.distanceToStop?.toFixed(2) || '0.00'}
                <span className="text-xs text-slate-400 ml-1">
                  ({data.distance_pct?.toFixed(2) || '0.00'}%)
                </span>
              </p>
              {analysis.isNearFlip && (
                <span className="text-xs px-2 py-0.5 bg-red-500/20 text-red-400 rounded font-semibold">
                  FLIP WARNING
                </span>
              )}
            </div>

            {/* Distance Visualization Bar ────────────────────────────────*/}
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  data.distance_pct > 2.0 ? 'bg-emerald-500' :
                  data.distance_pct > 1.0 ? 'bg-amber-500' :
                  data.distance_pct > 0.5 ? 'bg-orange-500' : 'bg-red-500'
                }`}
                style={{ width: `${Math.min((data.distance_pct / 3) * 100, 100)}%` }}
              />
            </div>
          </div>

          {/* Confidence Score ──────────────────────────────────────────────*/}
          <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs text-slate-500">Confidence</p>
              <p className={`text-sm font-bold ${config.text}`}>{data.sar_confidence || 0}%</p>
            </div>
            <div className="w-full h-1.5 bg-slate-700/40 rounded-full overflow-hidden">
              <div
                className={`h-full ${config.bar} transition-all duration-300`}
                style={{ width: `${data.sar_confidence || 0}%` }}
              />
            </div>
          </div>

          {/* Trend & Candles ─────────────────────────────────────────────*/}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/40 p-2 rounded border border-slate-700/30">
              <p className="text-slate-500 mb-1">Signal</p>
              <p className={`font-semibold ${config.text}`}>
                {signalLabel}
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
export const MemoizedParabolicSarCard = React.memo(ParabolicSarCard);

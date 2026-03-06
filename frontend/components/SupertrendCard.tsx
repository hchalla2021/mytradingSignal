/**
 * SupertrendCard – SuperTrend (10,2) Trend Following Analysis
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚀 ULTRA-FAST REAL-TIME EDITION
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture: WebSocket live ticks + API analysis refresh (3s not 5s)
 * Live ticks:  Real-time price/distance updates (200ms batched)
 * API refresh: Every 3 seconds for ST line, trend, confidence
 * 
 * Performance Target: <50ms total latency from tick → UI update
 * 
 * Strategy: SuperTrend (10,2) Professional Trend Following
 * - Period: 10 bars lookback
 * - Multiplier: 2x ATR (volatility adjustment)
 * - BULLISH when price > ST line (follow uptrend)
 * - BEARISH when price < ST line (follow downtrend)
 * - Perfect for intraday 5m/15m scalping
 */

'use client';

import React, { memo } from 'react';
import { useSupertrendRealtime, useMemoizedSupertrendAnalysis } from '@/hooks/useSupertrendRealtime';

interface SupertrendCardProps { 
  symbol: string; 
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal configuration
// ─────────────────────────────────────────────────────────────────────────────
const TREND_CFG: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; icon: string;
}> = {
  BULLISH: { 
    label: 'BULLISH TREND',  
    color: 'text-emerald-300', 
    bg: 'bg-emerald-500/10', 
    border: 'border-emerald-500', 
    bar: 'from-emerald-500 to-green-400',  
    icon: '▲▲' 
  },
  BEARISH: { 
    label: 'BEARISH TREND',  
    color: 'text-red-300', 
    bg: 'bg-red-500/10', 
    border: 'border-red-500', 
    bar: 'from-red-500 to-rose-400',  
    icon: '▼▼' 
  },
  NEUTRAL: { 
    label: 'NEUTRAL ZONE',     
    color: 'text-amber-300',   
    bg: 'bg-amber-500/8',    
    border: 'border-amber-500/60', 
    bar: 'from-amber-500 to-yellow-400',   
    icon: '◆'  
  },
};

const SIGNAL_CFG: Record<string, { label: string; emoji: string }> = {
  BUY: { label: 'Follow Uptrend', emoji: '🟢' },
  SELL: { label: 'Follow Downtrend', emoji: '🔴' },
  HOLD: { label: 'Consolidating', emoji: '⏳' },
};

const STRENGTH_CFG: Record<string, { label: string; color: string; emoji: string }> = {
  STRONG: { label: 'Strong Trend', color: 'text-emerald-400', emoji: '💪' },
  MODERATE: { label: 'Moderate Distance', color: 'text-amber-400', emoji: '📊' },
  WEAK: { label: 'Weakening', color: 'text-orange-400', emoji: '⚠️' },
  FORMING: { label: 'Formation', color: 'text-gray-400', emoji: '🔄' },
};

function getTrend(k?: string) { 
  return TREND_CFG[(k ?? 'NEUTRAL').toUpperCase()] ?? TREND_CFG.NEUTRAL; 
}

function getSignal(k?: string) { 
  return SIGNAL_CFG[(k ?? 'HOLD').toUpperCase()] ?? SIGNAL_CFG.HOLD; 
}

function getStrength(strength?: string) {
  return STRENGTH_CFG[strength ?? 'FORMING'] ?? STRENGTH_CFG.FORMING;
}

function fmt(n: number | undefined): string {     
  return (n ?? 0) > 0 ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'; 
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
const SupertrendCard = memo<SupertrendCardProps>(({ symbol, name }) => {
  // 🔥 Use real-time hook for ultra-fast live updates
  const { data, loading, error, flash, refetch } = useSupertrendRealtime(symbol);
  const stAnalysis = useMemoizedSupertrendAnalysis(data ?? null);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-slate-900/40 border-2 border-slate-700/40 rounded-2xl p-4 animate-pulse min-h-[340px]">
      <div className="flex justify-between mb-3">
        <div className="h-5 bg-slate-800/70 rounded w-24" />
        <div className="h-5 bg-slate-800/70 rounded w-16" />
      </div>
      <div className="h-14 bg-slate-800/50 rounded-xl mb-3" />
      <div className="h-2 bg-slate-800/50 rounded-full mb-3" />
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="h-14 bg-slate-800/40 rounded-xl" />
        <div className="h-14 bg-slate-800/40 rounded-xl" />
      </div>
      <div className="h-40 bg-slate-800/30 rounded-xl" />
    </div>
  );

  // ── Error state ──────────────────────────────────────────────────────────
  if (error || !data) return (
    <div className="bg-slate-900/40 border-2 border-rose-500/30 rounded-2xl p-5 min-h-[200px] flex flex-col items-center justify-center gap-2">
      <span className="text-2xl">⚠</span>
      <p className="text-sm font-bold text-rose-300">{name}</p>
      <p className="text-xs text-rose-400/80">{error ?? 'No data available'}</p>
      <button
        onClick={refetch}
        className="mt-2 text-[10px] px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition-colors"
      >Retry</button>
    </div>
  );

  // ── Derived values ────────────────────────────────────────────────────────
  const trend = getTrend(data.st_10_2_trend);
  const sig = getSignal(data.st_10_2_signal);
  const strength = getStrength(stAnalysis.trendStrength);
  const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';

  const trendContext =
    data.st_10_2_signal === 'BUY'
      ? `Price above SuperTrend line — Strong uptrend. Follow the trend, buy dips.`
      : data.st_10_2_signal === 'SELL'
      ? `Price below SuperTrend line — Strong downtrend. Follow the trend, short bounces.`
      : `Price near SuperTrend line — Consolidating. Wait for breakout.`;

  // Calculate percentage of confidence
  const confidenceNormalized = Math.max(0, Math.min(100, ((data.st_10_2_confidence - 40) / 55) * 100));

  return (
    <div
      suppressHydrationWarning
      className={`
        rounded-2xl border-2 ${trend.border} ${trend.bg} overflow-hidden
        shadow-lg transition-all duration-300
        ${flash ? 'ring-2 ring-white/25 scale-[1.004]' : ''}
      `}
    >
      {/* ─── HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-cyan-500/60 bg-cyan-950/30 px-2.5 py-1.5 text-sm font-bold text-white">
            {name}
          </span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
        </div>
        <span suppressHydrationWarning className="text-xs font-black text-white">
          {(data.current_price ?? 0) > 0 ? `₹${fmt(data.current_price)}` : '—'}
        </span>
      </div>

      <div className="p-3 space-y-2.5">

        {/* ─── MAIN TREND ──────────────────────────────────────────────── */}
        <div className={`rounded-xl border ${trend.border} ${trend.bg} px-3 py-2.5 text-center`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wide ${trend.color}`}>
            {trend.icon}&nbsp;{trend.label}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{trendContext}</p>
        </div>

        {/* ─── CONFIDENCE BAR ──────────────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">Confidence</span>
            <span suppressHydrationWarning className={`text-sm font-black ${trend.color}`}>
              {data.st_10_2_confidence}%
            </span>
          </div>
          <div className="h-2 bg-gray-900 rounded-full overflow-hidden border border-white/5">
            <div
              suppressHydrationWarning
              className={`h-full rounded-full bg-gradient-to-r ${trend.bar} transition-all duration-700`}
              style={{ width: `${confidenceNormalized}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
            <span>40</span><span>60</span><span>80</span><span>95</span>
          </div>
        </div>

        {/* ─── SUPERTREND LEVEL ────────────────────────────────────────── */}
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-2.5 space-y-1">
          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1">SuperTrend Line</div>
          
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-600">Level</span>
            <span suppressHydrationWarning className="text-[10px] font-bold text-cyan-400">
              ₹{fmt(data.st_10_2_value)}
            </span>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-slate-700/30">
            <span className="text-[9px] text-gray-600">Distance</span>
            <span suppressHydrationWarning className={`text-[10px] font-bold ${
              stAnalysis.isBullish ? 'text-emerald-400' : 
              stAnalysis.isBearish ? 'text-red-400' : 'text-amber-400'
            }`}>
              {fmt(data.st_distance)} pts ({data.st_distance_pct.toFixed(3)}%)
            </span>
          </div>
        </div>

        {/* ─── SIGNAL & TREND STRENGTH ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          {/* Signal */}
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase mb-1">Signal</div>
            <div className="text-[10px] font-bold flex items-center gap-1">
              <span suppressHydrationWarning>
                {sig.emoji}
              </span>
              <span suppressHydrationWarning className={`truncate ${
                data.st_10_2_signal === 'BUY' ? 'text-emerald-400' :
                data.st_10_2_signal === 'SELL' ? 'text-red-400' : 'text-amber-400'
              }`}>{sig.label}</span>
            </div>
          </div>

          {/* Trend Strength */}
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase mb-1">Strength</div>
            <div className="text-[10px] font-bold flex items-center gap-1">
              <span suppressHydrationWarning>
                {strength.emoji}
              </span>
              <span suppressHydrationWarning className={`truncate ${strength.color}`}>
                {strength.label}
              </span>
            </div>
          </div>
        </div>

        {/* ─── ATR VOLATILITY ──────────────────────────────────────────── */}
        <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg px-2.5 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-semibold text-gray-600 uppercase tracking-wider">ATR (10)</span>
            <div className="flex items-center gap-2">
              <span suppressHydrationWarning className="text-[10px] font-bold text-orange-400">
                {fmt(data.atr_10)} pts
              </span>
              <span suppressHydrationWarning className="text-[9px] text-gray-500">
                ({data.atr_pct.toFixed(3)}%)
              </span>
            </div>
          </div>
        </div>

        {/* ─── CROSSOVER WARNING ───────────────────────────────────────── */}
        {stAnalysis.isNearCrossover && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-lg px-2.5 py-1.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-yellow-400">⚠️</span>
              <span className="text-[9px] text-yellow-300 font-semibold">
                Price near ST line — Potential trend change ahead
              </span>
            </div>
          </div>
        )}

        {/* ─── QUICK STATS ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 text-[9px]">
          <div className="text-gray-600">
            Candles: <span className="text-white font-bold">{data.candles_analyzed}</span>
          </div>
          <div className="text-gray-600 text-right">
            Updated: <span className="text-cyan-400 font-bold">3s</span>
          </div>
        </div>

      </div>
    </div>
  );
});

SupertrendCard.displayName = 'SupertrendCard';

export default SupertrendCard;

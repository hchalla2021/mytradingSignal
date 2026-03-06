/**
 * ORBCard – Opening Range Breakout Analysis
 * ═══════════════════════════════════════════════════════════════════════════
 * 🚀 ULTRA-FAST REAL-TIME EDITION
 * ───────────────────────────────────────────────────────────────────────────
 * Architecture: WebSocket live ticks + API analysis refresh (3s not 5s)
 * Live ticks:  Real-time price/position updates (200ms batched)
 * API refresh: Every 3 seconds for levels, signals, strength
 * 
 * Performance Target: <50ms total latency from tick → UI update
 * 
 * Strategy: ORB (Opening Range Breakout)
 * - First 15-30 minutes establish the "Opening Range"
 * - When price breaks above HIGH → BUY (strong bullish momentum)
 * - When price breaks below LOW → SELL (strong bearish momentum)
 * - Position inside range → Wait for breakout/breakdown
 */

'use client';

import React, { memo } from 'react';
import { useOpeningRangeRealtime, useMemoizedORBAnalysis } from '@/hooks/useOpeningRangeRealtime';

interface ORBCardProps { 
  symbol: string; 
  name: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signal configuration
// ─────────────────────────────────────────────────────────────────────────────
const SIGNAL_CFG: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; icon: string;
}> = {
  ORB_BUY_BREAKOUT: { 
    label: 'BREAKOUT BUY',  
    color: 'text-emerald-300', 
    bg: 'bg-emerald-500/10', 
    border: 'border-emerald-500', 
    bar: 'from-emerald-500 to-green-400',  
    icon: '▲▲' 
  },
  ORB_SELL_BREAKDOWN: { 
    label: 'BREAKDOWN SELL',  
    color: 'text-red-300', 
    bg: 'bg-red-500/10', 
    border: 'border-red-500', 
    bar: 'from-red-500 to-rose-400',  
    icon: '▼▼' 
  },
  ORB_NEUTRAL: { 
    label: 'INSIDE RANGE',     
    color: 'text-amber-300',   
    bg: 'bg-amber-500/8',    
    border: 'border-amber-500/60', 
    bar: 'from-amber-500 to-yellow-400',   
    icon: '◆'  
  },
};

const POSITION_CFG: Record<string, { label: string; color: string; emoji: string }> = {
  ABOVE_HIGH: { label: 'Above ORB High', color: 'text-emerald-400', emoji: '🚀' },
  BELOW_LOW: { label: 'Below ORB Low', color: 'text-red-400', emoji: '💥' },
  INSIDE_RANGE: { label: 'Inside Range', color: 'text-amber-400', emoji: '⏳' },
  NO_DATA: { label: 'No Data', color: 'text-gray-400', emoji: '—' },
};

function getSignal(k?: string) { 
  return SIGNAL_CFG[(k ?? 'ORB_NEUTRAL').toUpperCase()] ?? SIGNAL_CFG.ORB_NEUTRAL; 
}

function getPosition(k?: string) { 
  return POSITION_CFG[(k ?? 'NO_DATA').toUpperCase()] ?? POSITION_CFG.NO_DATA; 
}

function fmt(n: number | undefined): string {     
  return (n ?? 0) > 0 ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'; 
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
const ORBCard = memo<ORBCardProps>(({ symbol, name }) => {
  // 🔥 Use real-time hook for ultra-fast live updates
  const { data, loading, error, flash, refetch } = useOpeningRangeRealtime(symbol);
  const orbAnalysis = useMemoizedORBAnalysis(data ?? null);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-slate-900/40 border-2 border-slate-700/40 rounded-2xl p-4 animate-pulse min-h-[320px]">
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
  const sig = getSignal(data.orb_signal);
  const pos = getPosition(data.orb_position);
  const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';
  const chgPos = (data.current_price ?? 0) >= 0;

  const orbContext =
    data.orb_signal === 'ORB_BUY_BREAKOUT'
      ? `Price broke above ORB High (₹${fmt(data.orb_high)}) — Strong bullish momentum. Target: ORB range × 2.`
      : data.orb_signal === 'ORB_SELL_BREAKDOWN'
      ? `Price broke below ORB Low (₹${fmt(data.orb_low)}) — Strong bearish momentum. Target: ORB range × 2.`
      : `Price inside ORB range (₹${fmt(data.orb_low)} — ₹${fmt(data.orb_high)}). Waiting for breakout.`;

  // Calculate percentage distances
  const distanceHighPct = data.orb_high > 0 
    ? ((data.distance_to_orb_high / data.orb_high) * 100).toFixed(2)
    : '—';
  const distanceLowPct = data.orb_low > 0 
    ? ((data.distance_to_orb_low / data.orb_low) * 100).toFixed(2)
    : '—';

  return (
    <div
      suppressHydrationWarning
      className={`
        rounded-2xl border-2 ${sig.border} ${sig.bg} overflow-hidden
        shadow-lg transition-all duration-300
        ${flash ? 'ring-2 ring-white/25 scale-[1.004]' : ''}
      `}
    >
      {/* ─── HEADER ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
        <div className="flex items-center gap-2">
          <span className="rounded-lg border border-blue-500/60 bg-blue-950/30 px-2.5 py-1.5 text-sm font-bold text-white">
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

        {/* ─── MAIN SIGNAL ─────────────────────────────────────────────── */}
        <div className={`rounded-xl border ${sig.border} ${sig.bg} px-3 py-2.5 text-center`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wide ${sig.color}`}>
            {sig.icon}&nbsp;{sig.label}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{orbContext}</p>
        </div>

        {/* ─── STRENGTH & CONFIDENCE BARS ──────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          {/* Strength */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest">Strength</span>
              <span suppressHydrationWarning className={`text-sm font-black ${sig.color}`}>
                {data.orb_strength}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden border border-white/5">
              <div
                suppressHydrationWarning
                className={`h-full rounded-full bg-gradient-to-r ${sig.bar} transition-all duration-700`}
                style={{ width: `${data.orb_strength}%` }}
              />
            </div>
          </div>

          {/* Confidence */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-[9px] text-gray-500 font-semibold uppercase tracking-widest">Confidence</span>
              <span suppressHydrationWarning className={`text-sm font-black ${sig.color}`}>
                {data.orb_confidence}%
              </span>
            </div>
            <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden border border-white/5">
              <div
                suppressHydrationWarning
                className={`h-full rounded-full bg-gradient-to-r ${sig.bar} transition-all duration-700`}
                style={{ width: `${data.orb_confidence}%` }}
              />
            </div>
          </div>
        </div>

        {/* ─── ORB LEVELS ──────────────────────────────────────────────── */}
        <div className="bg-slate-900/60 border border-slate-700/40 rounded-xl p-2.5 space-y-1.5">
          <div className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1">ORB Levels</div>
          
          {/* High Level */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-600">ORB High</span>
              <span className="text-[10px] font-bold text-emerald-400">
                ₹{fmt(data.orb_high)}
              </span>
            </div>
            <span suppressHydrationWarning className={`text-[9px] font-bold ${
              data.orb_position === 'ABOVE_HIGH' ? 'text-emerald-400' : 'text-gray-500'
            }`}>
              {data.distance_to_orb_high > 0 ? `+${fmt(data.distance_to_orb_high)} (${distanceHighPct}%)` : '—'}
            </span>
          </div>

          {/* Low Level */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-600">ORB Low</span>
              <span className="text-[10px] font-bold text-red-400">
                ₹{fmt(data.orb_low)}
              </span>
            </div>
            <span suppressHydrationWarning className={`text-[9px] font-bold ${
              data.orb_position === 'BELOW_LOW' ? 'text-red-400' : 'text-gray-500'
            }`}>
              {data.distance_to_orb_low > 0 ? `-${fmt(data.distance_to_orb_low)} (${distanceLowPct}%)` : '—'}
            </span>
          </div>

          {/* Range */}
          <div className="flex items-center justify-between pt-1 border-t border-slate-700/30">
            <span className="text-[9px] text-gray-600 font-semibold">Range</span>
            <span suppressHydrationWarning className="text-[10px] font-bold text-cyan-400">
              ₹{fmt(data.orb_range)}
            </span>
          </div>
        </div>

        {/* ─── POSITION & RISK/REWARD ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          {/* Position */}
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase mb-1">Position</div>
            <div suppressHydrationWarning className={`text-[10px] font-bold flex items-center gap-1 ${pos.color}`}>
              <span>{pos.emoji}</span>
              <span>{pos.label}</span>
            </div>
          </div>

          {/* Risk/Reward */}
          <div className="bg-slate-900/60 border border-slate-700/40 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase mb-1">Risk:Reward</div>
            <div suppressHydrationWarning className="text-[10px] font-bold text-cyan-400">
              {data.orb_reward_risk_ratio ? `${data.orb_reward_risk_ratio.toFixed(2)}:1` : '—'}
            </div>
          </div>
        </div>

        {/* ─── STATUS TAG ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-900/40 border border-slate-700/30">
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Status</span>
          <span suppressHydrationWarning className={`text-[10px] font-bold ${
            data.orb_signal === 'ORB_BUY_BREAKOUT' ? 'text-emerald-400' :
            data.orb_signal === 'ORB_SELL_BREAKDOWN' ? 'text-red-400' : 'text-amber-400'
          }`}>{data.orb_status}</span>
        </div>

        {/* ─── QUICK STATS ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-1.5 text-[9px]">
          <div className="text-gray-600">
            Candles: <span className="text-white font-bold">{data.candles_analyzed}</span>
          </div>
          <div className="text-gray-600 text-right">
            Risk: <span className="text-orange-400 font-bold">₹{fmt(data.orb_risk)}</span>
          </div>
        </div>

      </div>
    </div>
  );
});

ORBCard.displayName = 'ORBCard';

export default ORBCard;

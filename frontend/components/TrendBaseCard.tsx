/**
 * TrendBaseCard – Higher-Low Swing Structure Analysis
 * ═════════════════════════════════════════════════════════════════════════════
 * 🔥 ULTRA-FAST REAL-TIME EDITION
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture: WebSocket live ticks + API analysis refresh (3s not 5s)
 * Live ticks:  Real-time price/change updates (200ms batched)
 * API refresh: Every 3 seconds for signals, confidence, factors
 * 
 * Performance Target: <50ms total latency from tick → UI update
 * 
 * Signal engine (8 factors, ±100 pts total):
 *   STRONG_BUY ≥+55  ·  BUY ≥+20  ·  NEUTRAL ±20
 *   SELL ≤−20  ·  STRONG_SELL ≤−55
 *
 * Confidence: 30–92 % (integrity × factor-agreement — never 100 %)
 * 5-Min Production: all 8 factor bars + live 5m RSI/VWAP values inline
 */
'use client';

import React, { memo } from 'react';
import { useTrendBaseRealtime } from '@/hooks/useTrendBaseRealtime';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Factor { score: number; max: number; label: string }

interface TrendBaseResponse {
  symbol:           string;
  price:            number;
  changePercent:    number;
  structure: {
    type:            string;   // HIGHER_HIGHS_LOWS | LOWER_HIGHS_LOWS | SIDEWAYS
    integrity_score: number;
    swing_points: { last_high: number; last_low: number; prev_high: number; prev_low: number };
  };
  signal:           string;   // STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL
  signal_5m:        string;   // BUY | NEUTRAL | SELL
  trend_15m:        string;   // BULLISH | NEUTRAL | BEARISH
  trend:            string;
  confidence:       number;
  confidence_5m?:   number;  // short-term 5m-specific confidence from backend
  total_score:      number;
  factors:          Record<string, Factor>;
  status:           string;
  timestamp:        string;
  candles_analyzed: number;
  rsi_5m:           number;
  rsi_15m:          number;
  ema_alignment:    string;
  supertrend:       string;
  vwap_position:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Static signal config — module-level, never recreated per render tick
// ─────────────────────────────────────────────────────────────────────────────
const SIG_CFG: Record<string, {
  label: string; color: string; bg: string; border: string; bar: string; icon: string;
}> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500',  bar: 'from-emerald-500 to-green-400',  icon: '▲▲' },
  BUY:         { label: 'BUY',         color: 'text-green-300',   bg: 'bg-green-500/10',   border: 'border-green-500',    bar: 'from-green-500 to-emerald-400',  icon: '▲'  },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-300',   bg: 'bg-amber-500/8',    border: 'border-amber-500/60', bar: 'from-amber-500 to-yellow-400',   icon: '▬'  },
  SELL:        { label: 'SELL',        color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500',      bar: 'from-red-500 to-rose-400',       icon: '▼'  },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500',     bar: 'from-rose-500 to-red-400',       icon: '▼▼' },
};

const S5_CFG: Record<string, { label: string; color: string; border: string }> = {
  BUY:     { label: 'BUY',     color: 'text-emerald-400', border: 'border-emerald-500/70' },
  SELL:    { label: 'SELL',    color: 'text-red-400',     border: 'border-red-500/70'     },
  NEUTRAL: { label: 'NEUTRAL', color: 'text-amber-400',   border: 'border-amber-500/50'   },
};

const T15_CFG: Record<string, { label: string; color: string; border: string }> = {
  BULLISH: { label: 'BULLISH', color: 'text-emerald-400', border: 'border-emerald-500/70' },
  BEARISH: { label: 'BEARISH', color: 'text-red-400',     border: 'border-red-500/70'     },
  NEUTRAL: { label: 'NEUTRAL', color: 'text-amber-400',   border: 'border-amber-500/50'   },
};

const FACTOR_LABELS: Record<string, string> = {
  trend_structure: 'Swing Structure',
  supertrend:      'SuperTrend 10,2',
  ema_alignment:   'EMA Stack',
  rsi:             'RSI Momentum',
  vwap:            'VWAP Position',
  day_change:      'Day Change %',
  sar:             'Parabolic SAR',
  momentum:        'Momentum',
};

function getSig(k?: string) { return SIG_CFG[(k ?? 'NEUTRAL').toUpperCase()] ?? SIG_CFG.NEUTRAL; }
function getS5(k?: string)  { return S5_CFG[(k  ?? 'NEUTRAL').toUpperCase()] ?? S5_CFG.NEUTRAL;  }
function getT15(k?: string) { return T15_CFG[(k ?? 'NEUTRAL').toUpperCase()] ?? T15_CFG.NEUTRAL; }
function fmt(n: number)     { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
interface TrendBaseCardProps { symbol: string; name: string }

const TrendBaseCard = memo<TrendBaseCardProps>(({ symbol, name }) => {
  // 🔥 Use real-time hook for ultra-fast live updates
  const { data, loading, error, flash, refetch } = useTrendBaseRealtime(symbol);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-slate-900/40 border-2 border-slate-700/40 rounded-2xl p-4 animate-pulse min-h-[360px]">
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
      <div className="h-44 bg-slate-800/30 rounded-xl" />
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
  const sig    = getSig(data.signal);
  const s5     = getS5(data.signal_5m);
  const t15    = getT15(data.trend_15m);
  const isLive = data.status === 'LIVE' || data.status === 'ACTIVE';
  const chgPos = (data.changePercent ?? 0) >= 0;
  const factors    = data.factors ?? {};
  const integrity  = data.structure?.integrity_score ?? 0;
  const totalScore = data.total_score ?? 0;
  const sp         = data.structure?.swing_points;

  const structureLabel =
    data.structure?.type === 'HIGHER_HIGHS_LOWS' ? 'Higher Highs + Higher Lows' :
    data.structure?.type === 'LOWER_HIGHS_LOWS'  ? 'Lower Highs + Lower Lows'  :
    'Mixed / Sideways';

  const ctx =
    data.signal === 'STRONG_BUY'  ? 'All 8 indicators confirm uptrend — high conviction long.' :
    data.signal === 'BUY'         ? 'Majority bullish. Good long entry on dips to support.' :
    data.signal === 'STRONG_SELL' ? 'All 8 indicators confirm downtrend — high conviction short.' :
    data.signal === 'SELL'        ? 'Majority bearish. Avoid longs; trail shorts on bounces.' :
                                    'Mixed signals. Wait for structure break before trading.';

  const vwapLabel = (data.vwap_position ?? 'AT_VWAP').replace('_VWAP', '');
  const emaLabel  = (data.ema_alignment ?? 'NEUTRAL')
                      .replace('ALL_', '').replace('PARTIAL_', 'P ');

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
          <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-sm font-bold text-white">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span suppressHydrationWarning className={`text-[11px] font-bold ${chgPos ? 'text-emerald-400' : 'text-red-400'}`}>
            {chgPos ? '▲' : '▼'}&nbsp;{Math.abs(data.changePercent ?? 0).toFixed(2)}%
          </span>
          <span suppressHydrationWarning className="text-xs font-black text-white">
            {(data.price ?? 0) > 0 ? `₹${fmt(data.price)}` : '—'}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-2.5">

        {/* ─── MAIN SIGNAL ─────────────────────────────────────────────── */}
        <div className={`rounded-xl border ${sig.border} ${sig.bg} px-3 py-2.5 text-center`}>
          <div suppressHydrationWarning className={`text-xl font-black tracking-wide ${sig.color}`}>
            {sig.icon}&nbsp;{sig.label}
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{ctx}</p>
        </div>

        {/* ─── CONFIDENCE BAR ──────────────────────────────────────────── */}
        <div>
          <div className="flex justify-between items-center mb-1">
            <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-widest">Confidence</span>
            <span suppressHydrationWarning className={`text-sm font-black ${sig.color}`}>{data.confidence}%</span>
          </div>
          <div className="h-2 bg-gray-900 rounded-full overflow-hidden border border-white/5">
            <div
              suppressHydrationWarning
              className={`h-full rounded-full bg-gradient-to-r ${sig.bar} transition-all duration-700`}
              style={{ width: `${data.confidence}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] text-gray-700 mt-0.5">
            <span>30</span><span>50</span><span>70</span><span>92</span>
          </div>
        </div>

        {/* ─── DUAL TIMEFRAME ──────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          {/* 5m */}
          <div className={`bg-slate-900/60 border ${s5.border} rounded-xl p-2.5`}>
            <div className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1">5m Entry</div>
            <div suppressHydrationWarning className={`text-sm font-black ${s5.color}`}>{s5.label}</div>
            <div className="text-[9px] text-gray-600 mt-0.5">
              ST:&nbsp;
              <span suppressHydrationWarning className={
                data.supertrend === 'BULLISH' ? 'text-emerald-400 font-bold' :
                data.supertrend === 'BEARISH' ? 'text-red-400 font-bold' : 'text-gray-500'
              }>{data.supertrend ?? '—'}</span>
            </div>
          </div>
          {/* 15m */}
          <div className={`bg-slate-900/60 border ${t15.border} rounded-xl p-2.5`}>
            <div className="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1">15m Trend</div>
            <div suppressHydrationWarning className={`text-sm font-black ${t15.color}`}>{t15.label}</div>
            <div className="text-[9px] text-gray-600 mt-0.5">
              EMA:&nbsp;
              <span suppressHydrationWarning className={
                (data.ema_alignment ?? '').includes('BULLISH') ? 'text-emerald-400 font-bold' :
                (data.ema_alignment ?? '').includes('BEARISH') ? 'text-red-400 font-bold' : 'text-gray-500'
              }>{emaLabel}</span>
            </div>
          </div>
        </div>

        {/* ─── KEY PRICE LEVELS ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase">Day High</div>
            <div suppressHydrationWarning className="text-[11px] font-bold text-emerald-400">
              {(sp?.last_high ?? 0) > 0 ? `₹${fmt(sp!.last_high)}` : '—'}
            </div>
          </div>
          <div className="bg-slate-900/40 border border-slate-700/30 rounded-lg px-2.5 py-1.5">
            <div className="text-[8px] text-gray-500 font-semibold uppercase">Day Low</div>
            <div suppressHydrationWarning className="text-[11px] font-bold text-red-400">
              {(sp?.last_low ?? 0) > 0 ? `₹${fmt(sp!.last_low)}` : '—'}
            </div>
          </div>
        </div>

        {/* ─── STRUCTURE TAG ───────────────────────────────────────────── */}
        <div className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg border ${
          data.structure?.type === 'HIGHER_HIGHS_LOWS' ? 'bg-emerald-500/8 border-emerald-500/35' :
          data.structure?.type === 'LOWER_HIGHS_LOWS'  ? 'bg-red-500/8 border-red-500/35'         :
          'bg-amber-500/8 border-amber-500/35'
        }`}>
          <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Structure</span>
          <span suppressHydrationWarning className={`text-[10px] font-bold ${
            data.structure?.type === 'HIGHER_HIGHS_LOWS' ? 'text-emerald-400' :
            data.structure?.type === 'LOWER_HIGHS_LOWS'  ? 'text-red-400' : 'text-amber-400'
          }`}>{structureLabel}</span>
        </div>

        {/* ══════════════════════════════════════════════════════════════════
            5-MIN PREDICTION
            8-factor backend confidence • swing structure • live RSI/VWAP
        ══════════════════════════════════════════════════════════════════ */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          {(() => {
            const sig5m     = (data.signal_5m ?? 'NEUTRAL').toUpperCase();
            const isBuy5m   = sig5m === 'BUY';
            const isSell5m  = sig5m === 'SELL';
            const isLiveNow = data.status === 'LIVE' || data.status === 'ACTIVE';
            // Use backend confidence_5m when available (independent short-term calc);
            // fallback: derive from main confidence with proportional multipliers
            const rsi5Raw  = data.rsi_5m ?? 50;
            // RSI deviation as a proportional multiplier (continuous, no cliffs)
            const rsiDev   = isBuy5m  ? Math.max(0, rsi5Raw - 50)
                           : isSell5m ? Math.max(0, 50 - rsi5Raw) : 0;
            const rsiMult  = 1 + rsiDev * 0.004;  // RSI=70 → ×1.08; RSI=80 → ×1.12
            // SuperTrend alignment multiplier
            const stMult   = (isBuy5m  && data.supertrend === 'BULLISH') ? 1.06
                           : (isSell5m && data.supertrend === 'BEARISH') ? 1.06
                           : (isBuy5m  && data.supertrend === 'BEARISH') ? 0.90
                           : (isSell5m && data.supertrend === 'BULLISH') ? 0.90 : 1.0;
            // Live data reliability multiplier
            const liveMult = isLiveNow ? 1.04 : 0.91;
            const adjConf  = data.confidence_5m != null
              ? data.confidence_5m  // backend computed directly
              : Math.round(Math.min(92, Math.max(25, data.confidence * rsiMult * stMult * liveMult)));
            const predDir   = isBuy5m ? 'LONG' : isSell5m ? 'SHORT' : 'FLAT';
            const dirIcon   = isBuy5m ? '▲' : isSell5m ? '▼' : '─';
            const dirColor  = isBuy5m ? 'text-teal-300'       : isSell5m ? 'text-rose-300'       : 'text-amber-300';
            const dirBorder = isBuy5m ? 'border-teal-500/40'  : isSell5m ? 'border-rose-500/35'  : 'border-amber-500/30';
            const dirBg     = isBuy5m ? 'bg-teal-500/[0.07]'  : isSell5m ? 'bg-rose-500/[0.07]'  : 'bg-amber-500/[0.05]';
            const barColor  = isBuy5m ? 'bg-teal-500'         : isSell5m ? 'bg-rose-500'         : 'bg-amber-500';
            const structType = data.structure?.type ?? 'SIDEWAYS';
            const ctxNote =
              structType === 'HIGHER_HIGHS_LOWS' && isBuy5m  ? 'HH+HL structure — long confirmed'
              : structType === 'LOWER_HIGHS_LOWS'  && isSell5m ? 'LH+LL structure — short confirmed'
              : integrity >= 70  ? 'High integrity swing structure'
              : structType === 'SIDEWAYS' ? 'Sideways — wait for break'
              : isBuy5m  ? 'Bullish swing structure forming'
              : isSell5m ? 'Bearish swing structure forming'
              : 'Monitoring swing structure…';
            const rsi5 = data.rsi_5m ?? 50;
            
            // Trend-specific momentum indicators
            const structQuality = integrity >= 80 ? 'Very High' : integrity >= 65 ? 'High' : integrity >= 50 ? 'Moderate' : 'Low';
            const structQualityColor = integrity >= 80 ? 'text-teal-300' : integrity >= 65 ? 'text-teal-400' : 'text-amber-300';
            
            const rsiStatus = rsi5 >= 70 ? 'Overbought' : rsi5 >= 60 ? 'Strong' : rsi5 > 40 && rsi5 < 60 ? 'Neutral' : rsi5 <= 30 ? 'Oversold' : 'Weak';
            const rsiStatusColor = rsi5 >= 70 ? 'text-rose-300' : rsi5 >= 60 ? 'text-teal-300' : rsi5 > 40 && rsi5 < 60 ? 'text-amber-300' : rsi5 <= 30 ? 'text-teal-400' : 'text-rose-300';
            
            const vwapStatus = vwapLabel === 'ABOVE' ? 'Above VWAP' : vwapLabel === 'BELOW' ? 'Below VWAP' : 'At VWAP';
            const vwapStatusColor = vwapLabel === 'ABOVE' ? 'text-teal-300' : vwapLabel === 'BELOW' ? 'text-rose-300' : 'text-amber-300';
            
            const stAlign = (data.supertrend === 'BULLISH' && isBuy5m) || (data.supertrend === 'BEARISH' && isSell5m) ? 'Aligned' : (data.supertrend === 'BULLISH' && isSell5m) || (data.supertrend === 'BEARISH' && isBuy5m) ? 'Diverging' : 'Neutral';
            const stAlignColor = stAlign === 'Aligned' ? 'text-teal-300' : stAlign === 'Diverging' ? 'text-rose-300' : 'text-amber-300';
            
            // Actual Market Confidence (independent from predicted)
            let actualMarketConf = 50;
            if (isBuy5m) {
              actualMarketConf = Math.min(92, Math.max(25,
                (integrity >= 75 ? 35 : integrity >= 60 ? 25 : 15) +
                (rsi5 >= 60 && rsi5 < 70 ? 25 : rsi5 <= 40 ? 20 : 10) +
                (vwapLabel === 'ABOVE' ? 20 : 10) +
                (data.supertrend === 'BULLISH' ? 15 : 0)
              ));
            } else if (isSell5m) {
              actualMarketConf = Math.min(92, Math.max(25,
                (integrity >= 75 ? 35 : integrity >= 60 ? 25 : 15) +
                (rsi5 <= 40 && rsi5 > 30 ? 25 : rsi5 >= 60 ? 20 : 10) +
                (vwapLabel === 'BELOW' ? 20 : 10) +
                (data.supertrend === 'BEARISH' ? 15 : 0)
              ));
            } else {
              actualMarketConf = 33;
            }
            
            // Build confirmation list
            const confirms = [];
            if (structType === 'HIGHER_HIGHS_LOWS' && isBuy5m) confirms.push('✓ HH+HL formed');
            if (structType === 'LOWER_HIGHS_LOWS' && isSell5m) confirms.push('✓ LH+LL formed');
            if (integrity >= 75) confirms.push('✓ High integrity');
            if ((rsi5 >= 60 && rsi5 < 70 && isBuy5m) || (rsi5 <= 40 && rsi5 > 30 && isSell5m)) confirms.push('✓ RSI aligned');
            if ((vwapLabel === 'ABOVE' && isBuy5m) || (vwapLabel === 'BELOW' && isSell5m)) confirms.push('✓ VWAP confirms');
            if ((data.supertrend === 'BULLISH' && isBuy5m) || (data.supertrend === 'BEARISH' && isSell5m)) confirms.push('✓ ST aligned');
            
            // Early signal detection
            const showEarlySignal = (adjConf >= 75) || (confirms.length >= 2);
            
            return (
              <div className="px-4 py-3 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold text-gray-400 uppercase">5 Min Prediction</span>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded ${dirColor} bg-black/40 border border-white/[0.05]`}>{adjConf}% CONFIDENCE</span>
                </div>
                
                {/* Dual Confidence Display */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-black/40 border border-white/[0.05] rounded-lg p-2.5">
                    <div className="text-[9px] text-white/40 mb-1">CONFIDENCE</div>
                    <div className={`text-[13px] font-bold ${dirColor} mb-1.5`}>{adjConf}%</div>
                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                    </div>
                  </div>
                  <div className="bg-black/40 border border-white/[0.05] rounded-lg p-2.5">
                    <div className="text-[9px] text-white/40 mb-1">Market</div>
                    <div className={`text-[13px] font-bold ${dirColor} mb-1.5`}>{actualMarketConf}%</div>
                    <div className="h-1.5 bg-white/[0.05] rounded-full overflow-hidden">
                      <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${actualMarketConf}%` }} />
                    </div>
                  </div>
                </div>
                
                {/* Direction + Status */}
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-3 py-2.5`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-white/30 truncate flex-1">{ctxNote}</span>
                  </div>
                  <div className="h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                    <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                  </div>
                </div>
                
                {/* Trend-Base Momentum Indicators (4-row grid) */}
                <div className="space-y-1.5 bg-gray-900/30 rounded-lg p-2.5">
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-white/40">Structure Quality</span>
                    <span className={`font-bold ${structQualityColor}`}>{structQuality} ({integrity}%)</span>
                  </div>
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-white/40">RSI 5m Status</span>
                    <span className={`font-bold ${rsiStatusColor}`}>{rsiStatus} ({rsi5.toFixed(0)})</span>
                  </div>
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-white/40">VWAP Position</span>
                    <span className={`font-bold ${vwapStatusColor}`}>{vwapStatus}</span>
                  </div>
                  <div className="flex items-center justify-between text-[9px]">
                    <span className="text-white/40">ST Alignment</span>
                    <span className={`font-bold ${stAlignColor}`}>{stAlign} ({data.supertrend})</span>
                  </div>
                </div>
                
                {/* Movement Probability Distribution */}
                <div className="flex items-center gap-0.5 h-6 bg-black/30 rounded-lg p-1">
                  <div className="flex-1 h-full rounded" style={{
                    background: isBuy5m ? 'linear-gradient(to right, #0d9488, #14b8a6)' : 'transparent',
                    opacity: isBuy5m ? 0.8 : 0.2,
                  }} />
                  <div className="flex-1 h-full rounded" style={{
                    background: isSell5m ? 'linear-gradient(to right, #be123c, #e11d48)' : 'transparent',
                    opacity: isSell5m ? 0.8 : 0.2,
                  }} />
                </div>
                {isBuy5m && (
                  <div className="text-[8px] text-center text-teal-300 font-bold">Bullish {Math.round((adjConf / 92) * 100)}% | Bearish {Math.round((100 - (adjConf / 92) * 100))}%</div>
                )}
                {isSell5m && (
                  <div className="text-[8px] text-center text-rose-300 font-bold">Bullish {Math.round((100 - (adjConf / 92) * 100))}% | Bearish {Math.round((adjConf / 92) * 100)}%</div>
                )}
                {!isBuy5m && !isSell5m && (
                  <div className="text-[8px] text-center text-amber-300 font-bold">Uncertain — Structure watches</div>
                )}
                
                {/* Early Signal Detection */}
                {showEarlySignal && (
                  <div className={`rounded-lg px-3 py-2 border-t-2 ${dirBorder}`}>
                    <div className={`text-[11px] font-bold ${dirColor} text-center`}>
                      ⚡ {adjConf >= 85 ? 'STRONG' : 'CONFIRMED'} {predDir} Signal Ready
                    </div>
                  </div>
                )}
                
                {/* Confirmation Summary */}
                {confirms.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {confirms.map((conf, idx) => (
                      <span key={idx} className="text-[9px] font-bold px-2 py-1 rounded bg-teal-500/30 text-teal-300 border border-teal-500/40">
                        {conf}
                      </span>
                    ))}
                  </div>
                )}
                
                {/* Summary Line */}
                <div className={`text-center text-[10px] font-bold px-3 py-1.5 rounded-lg border ${dirBorder} ${dirBg} ${dirColor}`}>
                  {predDir} · {adjConf}% Pred · {actualMarketConf}% Market · {confirms.length} Confirms
                </div>
              </div>
            );
          })()}
        </div>

      </div>

      {/* ─── FOOTER ──────────────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-t border-white/5 flex justify-between items-center">
        <span suppressHydrationWarning className="text-[9px] text-gray-600">
          {data.timestamp
            ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : '—'}
        </span>
        <span className={`text-[9px] font-bold ${isLive ? 'text-emerald-500' : 'text-gray-600'}`}>
          {isLive ? '● Live' : '○ Cached'}
        </span>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';
export default TrendBaseCard;


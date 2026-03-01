/**
 * TrendBaseCard – Higher-Low Swing Structure Analysis
 * ─────────────────────────────────────────────────────────────────────────────
 * Architecture: Self-contained REST polling → /api/advanced/trend-base/{symbol}
 * Independent:  No external hooks, no shared state — pure props (symbol + name)
 * Refresh:      Every 5 s via AbortController-guarded fetch
 *
 * Signal engine (8 factors, ±100 pts total):
 *   STRONG_BUY ≥+55  ·  BUY ≥+20  ·  NEUTRAL ±20
 *   SELL ≤−20  ·  STRONG_SELL ≤−55
 *
 * Confidence: 30–92 % (integrity × factor-agreement — never 100 %)
 * 5-Min Production: all 8 factor bars + live RSI/VWAP values inline
 */
'use client';

import React, { memo, useEffect, useState, useCallback, useRef } from 'react';
import { API_CONFIG } from '@/lib/api-config';

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
  const [data,     setData]    = useState<TrendBaseResponse | null>(null);
  const [loading,  setLoading] = useState(true);
  const [error,    setError]   = useState<string | null>(null);
  const [flash,    setFlash]   = useState(false);
  const prevSigRef = useRef<string>('');
  const abortRef   = useRef<AbortController | null>(null);

  // ── Fetch — AbortController prevents stale updates ───────────────────────
  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/trend-base/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result: TrendBaseResponse = await res.json();
      if (result?.status === 'TOKEN_EXPIRED') { setError('Auth required'); setLoading(false); return; }
      if (result?.status === 'ERROR')          { setError('Feed error');    setLoading(false); return; }
      // Flash on signal change
      if (prevSigRef.current && prevSigRef.current !== result.signal) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevSigRef.current = result.signal;
      setData(result);
      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError('Connection error');
      setLoading(false);
    }
  }, [symbol]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 5000);
    return () => { clearInterval(id); abortRef.current?.abort(); };
  }, [symbol]); // eslint-disable-line react-hooks/exhaustive-deps

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
        onClick={fetchData}
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
          <span className="text-sm font-black text-white">{name}</span>
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
            const adjConf   = data.confidence; // 30–92%, 8-factor backend (structure, ST, EMA, RSI, VWAP, day%, SAR, momentum)
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
            return (
              <div className="px-3 pt-2.5 pb-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">5-Min Prediction</span>
                  <span className={`text-[9px] font-black ${dirColor}`}>{adjConf}% Confidence</span>
                </div>
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-white/30 truncate">{ctxNote}</span>
                    <span className={`text-sm font-black ${dirColor} shrink-0`}>{adjConf}%</span>
                  </div>
                  <div className="h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                    <div suppressHydrationWarning className={`h-full rounded-full transition-all duration-700 ${barColor}`} style={{ width: `${adjConf}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Structure</div>
                    <div className={`text-[10px] font-bold ${
                      structType === 'HIGHER_HIGHS_LOWS' ? 'text-teal-300'
                      : structType === 'LOWER_HIGHS_LOWS' ? 'text-rose-300'
                      : 'text-amber-300'
                    }`}>
                      {structType === 'HIGHER_HIGHS_LOWS' ? 'HH+HL' : structType === 'LOWER_HIGHS_LOWS' ? 'LH+LL' : 'Sideways'}
                    </div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">RSI 5m</div>
                    <div suppressHydrationWarning className={`text-[10px] font-bold ${
                      rsi5 >= 60 ? 'text-teal-300' : rsi5 <= 40 ? 'text-rose-300' : 'text-amber-300'
                    }`}>{rsi5.toFixed(0)}</div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">VWAP</div>
                    <div suppressHydrationWarning className={`text-[10px] font-bold ${
                      vwapLabel === 'ABOVE' ? 'text-teal-300' : vwapLabel === 'BELOW' ? 'text-rose-300' : 'text-amber-300'
                    }`}>{vwapLabel}</div>
                  </div>
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


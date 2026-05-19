'use client';

import React, { memo, useMemo, useState } from 'react';
import { useTrendBaseRealtime } from '@/hooks/useTrendBaseRealtime';

// ─── Signal config (module-level, never recreated) ──────────────────────────
const SIG: Record<string, { label: string; color: string; bg: string; border: string; bar: string; icon: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/50',  bar: 'bg-emerald-500', icon: '▲▲' },
  BUY:         { label: 'BUY',         color: 'text-green-300',   bg: 'bg-green-500/10',   border: 'border-green-500/50',    bar: 'bg-green-500',   icon: '▲'  },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-300',   bg: 'bg-amber-500/8',    border: 'border-amber-500/40',    bar: 'bg-amber-500',   icon: '▬'  },
  SELL:        { label: 'SELL',        color: 'text-red-300',     bg: 'bg-red-500/10',     border: 'border-red-500/50',      bar: 'bg-red-500',     icon: '▼'  },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-rose-300',    bg: 'bg-rose-500/10',    border: 'border-rose-500/50',     bar: 'bg-rose-500',    icon: '▼▼' },
};

const FACTOR_LABELS: Record<string, string> = {
  trend_structure: 'Swing',
  supertrend:      'SuperTrend',
  ema_alignment:   'EMA Stack',
  rsi:             'RSI',
  vwap:            'VWAP',
  day_change:      'Day Chg',
  momentum:        'Momentum',
};

const FACTOR_ORDER = ['trend_structure', 'supertrend', 'ema_alignment', 'rsi', 'vwap', 'day_change', 'momentum'];

function sig(k?: string)  { return SIG[(k ?? 'NEUTRAL').toUpperCase()] ?? SIG.NEUTRAL; }
function fmt(n: number)   { return n.toLocaleString('en-IN', { maximumFractionDigits: 0 }); }

// ─── Component ──────────────────────────────────────────────────────────────
const TrendBaseCard = memo<{ symbol: string; name: string }>(({ symbol, name }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data, loading, error, flash, refetch } = useTrendBaseRealtime(symbol);

  // All hooks must be called before any early returns
  const factors = useMemo(() => data?.factors ?? {}, [data?.factors]);
  const sortedFactors = useMemo(() =>
    FACTOR_ORDER.filter(k => factors[k]).map(k => ({ key: k, ...factors[k] })),
    [factors]
  );

  // ── Loading ─────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="bg-[#0b1120]/80 border border-slate-700/50 rounded-xl p-4 animate-pulse min-h-[280px]">
      <div className="flex justify-between mb-3"><div className="h-4 bg-slate-800/60 rounded w-20" /><div className="h-4 bg-slate-800/60 rounded w-16" /></div>
      <div className="h-10 bg-slate-800/40 rounded-lg mb-3" />
      <div className="h-1.5 bg-slate-800/40 rounded-full mb-4" />
      <div className="space-y-1.5">{[1,2,3,4].map(i => <div key={i} className="h-5 bg-slate-800/30 rounded" />)}</div>
    </div>
  );

  // ── Error ───────────────────────────────────────────────────────────────
  if (!data) return (
    <div className="bg-[#0b1120]/80 border border-rose-500/30 rounded-xl p-5 min-h-[180px] flex flex-col items-center justify-center gap-2">
      <p className="text-sm font-bold text-rose-300">{name}</p>
      <p className="text-xs text-rose-400/70">{error ?? 'No data'}</p>
      <button onClick={refetch} className="text-[10px] px-3 py-1 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25">Retry</button>
    </div>
  );

  // ── Derived ─────────────────────────────────────────────────────────────
  const s       = sig(data.signal);
  const isLive  = data.status === 'LIVE' || data.status === 'ACTIVE';
  const chgPos  = (data.changePercent ?? 0) >= 0;
  const integ   = data.structure?.integrity_score ?? 0;
  const sp      = data.structure?.swing_points;

  const structLabel =
    data.structure?.type === 'HIGHER_HIGHS_LOWS' ? 'HH + HL' :
    data.structure?.type === 'LOWER_HIGHS_LOWS'  ? 'LH + LL' : 'Sideways';
  const structColor =
    data.structure?.type === 'HIGHER_HIGHS_LOWS' ? 'text-emerald-400' :
    data.structure?.type === 'LOWER_HIGHS_LOWS'  ? 'text-red-400' : 'text-amber-400';

  // 5m prediction
  const sig5m   = (data.signal_5m ?? 'NEUTRAL').toUpperCase();
  const isBuy5  = sig5m === 'BUY' || sig5m === 'STRONG_BUY';
  const isSell5 = sig5m === 'SELL' || sig5m === 'STRONG_SELL';
  const conf5   = data.confidence_5m ?? data.confidence;
  const ai      = data.ai;
  const dir5    = isBuy5 ? 'LONG' : isSell5 ? 'SHORT' : 'FLAT';
  const dir5Icon  = isBuy5 ? '▲' : isSell5 ? '▼' : '─';
  const dir5Color = isBuy5 ? 'text-teal-300' : isSell5 ? 'text-rose-300' : 'text-amber-300';
  const dir5Bar   = isBuy5 ? 'bg-teal-500'   : isSell5 ? 'bg-rose-500'   : 'bg-amber-500';

  // Bull/bear count
  const bullCount = sortedFactors.filter(f => f.score > 0).length;
  const bearCount = sortedFactors.filter(f => f.score < 0).length;

  // ── Per-section conviction highlights ─────────────────────────────────
  const totalScore = data.total_score ?? 0;

  // Signal: BUY/STRONG_BUY with conf≥55 or SELL/STRONG_SELL with conf≥55
  const sigBull = (data.signal === 'BUY' || data.signal === 'STRONG_BUY') && data.confidence >= 55;
  const sigBear = (data.signal === 'SELL' || data.signal === 'STRONG_SELL') && data.confidence >= 55;

  // Structure: HH+HL = bull, LH+LL = bear
  const structBull = data.structure?.type === 'HIGHER_HIGHS_LOWS';
  const structBear = data.structure?.type === 'LOWER_HIGHS_LOWS';

  // 5m Signal: BUY/STRONG_BUY = bull, SELL/STRONG_SELL = bear
  const tf5mBull = isBuy5;
  const tf5mBear = isSell5;

  // 7-Factor: 5+ bull factors or totalScore≥15 = bull; 5+ bear or ≤-15 = bear
  const factorBull = bullCount >= 5 || totalScore >= 15;
  const factorBear = bearCount >= 5 || totalScore <= -15;

  // 5-Min Prediction: LONG conf≥55% = bull, SHORT conf≥55% = bear
  const pred5Bull = isBuy5 && conf5 >= 55;
  const pred5Bear = isSell5 && conf5 >= 55;

  // Helper: returns CSS class for section highlight
  const tbHl = (bull: boolean, bear: boolean) =>
    bull ? 'tb-section-hl-bull' : bear ? 'tb-section-hl-bear' : '';

  return (
    <div className={`rounded-xl border ${s.border} bg-[#0b1120]/80 overflow-hidden ${flash ? 'ring-1 ring-white/20' : ''}`}>

      {/* ── HEADER: Name + Price + Change ─────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/40 border-b border-slate-700/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-white">{name}</span>
          {isLive && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[9px] font-bold text-emerald-400">LIVE</span>
            </span>
          )}
          {error && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/35">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="text-[9px] font-bold text-amber-300">STALE</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 px-2 py-1 rounded-md border border-emerald-500/30">
          <span className={`text-[11px] font-bold ${chgPos ? 'text-emerald-400' : 'text-red-400'}`}>
            {chgPos ? '▲' : '▼'} {Math.abs(data.changePercent ?? 0).toFixed(2)}%
          </span>
          <span className="text-xs font-black text-white tabular-nums">
            {(data.price ?? 0) > 0 ? `₹${fmt(data.price)}` : '—'}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-3">

        {/* ── SIGNAL + CONFIDENCE ────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className={`flex-shrink-0 rounded-lg border ${s.border} ${s.bg} px-3 py-2 text-center min-w-[110px] ${tbHl(sigBull, sigBear)}`}>
            <div className={`text-base font-black ${s.color}`}>{s.icon} {s.label}</div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center mb-1">
              <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">Confidence</span>
              <span className={`text-sm font-black tabular-nums ${s.color}`}>{data.confidence}%</span>
            </div>
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${s.bar}`} style={{ width: `${data.confidence}%` }} />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(v => !v)}
          className="w-full flex items-center justify-between rounded-lg border border-slate-700/35 bg-slate-800/35 px-3 py-2 text-left transition-colors duration-150 hover:bg-slate-800/50"
        >
          <div className="min-w-0">
            <div className="text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">Trend Details</div>
            <div className="mt-0.5 text-[10px] font-medium text-slate-300">
              {isExpanded ? 'Expanded view' : 'Show'}
            </div>
          </div>
          <span className="shrink-0 text-[10px] font-bold text-slate-400">{isExpanded ? 'Hide' : 'Show'}</span>
        </button>

        {!isExpanded && (
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
              <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Structure</div>
              <div className={`text-[11px] font-bold ${structColor}`}>{structLabel}</div>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
              <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">5m Signal</div>
              <div className={`text-[11px] font-bold ${dir5Color}`}>{dir5Icon} {sig5m}</div>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
              <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Total Score</div>
              <div className={`text-[11px] font-bold ${(data.total_score ?? 0) > 0 ? 'text-emerald-400' : (data.total_score ?? 0) < 0 ? 'text-red-400' : 'text-amber-400'}`}>
                {(data.total_score ?? 0) > 0 ? '+' : ''}{data.total_score ?? 0}/100
              </div>
            </div>
            <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
              <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">5m Confidence</div>
              <div className={`text-[11px] font-bold ${dir5Color}`}>{conf5}%</div>
            </div>
          </div>
        )}

        {isExpanded && (
          <>

        {/* ── STRUCTURE + TIMEFRAMES ─────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">Structure</div>
            <div className={`text-[11px] font-bold ${structColor} inline-block rounded px-1 ${tbHl(structBull, structBear)}`}>{structLabel}</div>
            <div className="text-[9px] text-slate-600">{integ}% integrity</div>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">5m Signal</div>
            <div className={`text-[11px] font-bold ${dir5Color} inline-block rounded px-1 ${tbHl(tf5mBull, tf5mBear)}`}>{dir5Icon} {sig5m}</div>
            <div className="text-[9px] text-slate-600">RSI {(data.rsi_5m ?? 50).toFixed(0)}</div>
          </div>
          <div className="bg-slate-800/30 border border-slate-700/30 rounded-lg px-2.5 py-2">
            <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider mb-0.5">15m Trend</div>
            <div className={`text-[11px] font-bold inline-block rounded px-1 ${tbHl(data.trend_15m === 'BULLISH', data.trend_15m === 'BEARISH')} ${
              (data.trend_15m ?? 'NEUTRAL') === 'BULLISH' ? 'text-emerald-400' :
              data.trend_15m === 'BEARISH' ? 'text-red-400' : 'text-amber-400'
            }`}>{data.trend_15m ?? 'NEUTRAL'}</div>
            <div className="text-[9px] text-slate-600">EMA {(data.ema_alignment ?? 'NEUTRAL').replace('ALL_', '').replace('PARTIAL_', 'P ')}</div>
          </div>
        </div>

        {/* ── SWING LEVELS (High / Low compact) ───────────────────────── */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center justify-between bg-emerald-500/5 border border-emerald-500/15 rounded-lg px-2.5 py-1.5">
            <span className="text-[9px] text-emerald-400/70 font-semibold">High</span>
            <span className="text-[11px] font-bold text-emerald-400 tabular-nums">{(sp?.last_high ?? 0) > 0 ? `₹${fmt(sp!.last_high)}` : '—'}</span>
          </div>
          <div className="flex-1 flex items-center justify-between bg-red-500/5 border border-red-500/15 rounded-lg px-2.5 py-1.5">
            <span className="text-[9px] text-red-400/70 font-semibold">Low</span>
            <span className="text-[11px] font-bold text-red-400 tabular-nums">{(sp?.last_low ?? 0) > 0 ? `₹${fmt(sp!.last_low)}` : '—'}</span>
          </div>
        </div>

        {/* ── 7-FACTOR BREAKDOWN ─────────────────────────────────────── */}
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">7-Factor Analysis</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-md font-extrabold transition-all duration-500 ${
              (bullCount - bearCount) >= 2
                ? 'ring-2 ring-emerald-400/70 bg-emerald-500/15 shadow-[0_0_12px_rgba(52,211,153,0.35)]'
                : (bearCount - bullCount) >= 2
                ? 'ring-2 ring-red-500/70 bg-red-500/15 shadow-[0_0_12px_rgba(239,68,68,0.35)]'
                : ''
            }`}>
              <span className="text-emerald-300 font-extrabold">{bullCount}</span>
              <span className="text-slate-300 font-bold"> bull · </span>
              <span className="text-red-300 font-extrabold">{bearCount}</span>
              <span className="text-slate-300 font-bold"> bear</span>
            </span>
          </div>
          <div className="space-y-1">
            {sortedFactors.map(f => {
              const pct = Math.abs(f.score) / f.max * 100;
              const isPos = f.score > 0;
              return (
                <div key={f.key} className="flex items-center gap-2">
                  <span className="text-[9px] text-slate-500 w-[60px] truncate">{FACTOR_LABELS[f.key] ?? f.key}</span>
                  <div className="flex-1 h-[6px] bg-slate-900 rounded-full overflow-hidden relative">
                    {/* Center line */}
                    <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-700" />
                    {isPos ? (
                      <div className="absolute left-1/2 h-full bg-emerald-500/80 rounded-r-full" style={{ width: `${pct / 2}%` }} />
                    ) : f.score < 0 ? (
                      <div className="absolute h-full bg-red-500/80 rounded-l-full" style={{ width: `${pct / 2}%`, right: '50%' }} />
                    ) : null}
                  </div>
                  <span className={`text-[9px] font-bold tabular-nums w-[28px] text-right ${isPos ? 'text-emerald-400' : f.score < 0 ? 'text-red-400' : 'text-slate-600'}`}>
                    {f.score > 0 ? '+' : ''}{f.score}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/30">
            <span className="text-[9px] text-slate-500 font-bold">Total Score</span>
            <span className={`text-xs font-black tabular-nums rounded px-1.5 py-0.5 ${tbHl(factorBull, factorBear)} ${(data.total_score ?? 0) > 0 ? 'text-emerald-400' : (data.total_score ?? 0) < 0 ? 'text-red-400' : 'text-amber-400'}`}>
              {(data.total_score ?? 0) > 0 ? '+' : ''}{data.total_score ?? 0} / 100
            </span>
          </div>
        </div>

        {/* ── 5-MIN PREDICTION ──────────────────────────────────────── */}
        <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-2.5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">5-Min Prediction</span>
            <span className={`text-xs font-black rounded px-1.5 py-0.5 ${dir5Color} ${tbHl(pred5Bull, pred5Bear)}`}>{dir5Icon} {dir5}</span>
          </div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] text-slate-500">Confidence</span>
            <span className={`text-[11px] font-bold tabular-nums ${dir5Color}`}>{conf5}%</span>
          </div>
          <div className="h-1.5 bg-slate-900 rounded-full overflow-hidden mb-2">
            <div className={`h-full rounded-full ${dir5Bar}`} style={{ width: `${conf5}%` }} />
          </div>
          {/* Key indicators */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-slate-500">SuperTrend</span>
              <span className={`font-bold rounded px-1 ${tbHl(data.supertrend === 'BULLISH', data.supertrend === 'BEARISH')} ${data.supertrend === 'BULLISH' ? 'text-emerald-400' : data.supertrend === 'BEARISH' ? 'text-red-400' : 'text-amber-400'}`}>{data.supertrend ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between text-[9px]">
              <span className="text-slate-500">VWAP</span>
              <span className={`font-bold rounded px-1 ${tbHl((data.vwap_position ?? '').includes('ABOVE'), (data.vwap_position ?? '').includes('BELOW'))} ${(data.vwap_position ?? '').includes('ABOVE') ? 'text-emerald-400' : (data.vwap_position ?? '').includes('BELOW') ? 'text-red-400' : 'text-amber-400'}`}>
                {(data.vwap_position ?? 'AT_VWAP').replace('_VWAP', '')}
              </span>
            </div>
          </div>
        </div>

        {ai && (
          <div className="bg-slate-800/20 border border-slate-700/30 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Trend Base AI Command Deck</span>
              {ai.commandDeck.modelProvider === 'tensorflow' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded border border-cyan-500/35 bg-cyan-500/10 text-cyan-300 font-bold uppercase">
                  TensorFlow
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Continuation</div>
                <div className="text-[11px] font-black text-emerald-300">{ai.sequencePrediction.trendContinuationProb.toFixed(1)}%</div>
              </div>
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Reversal Risk</div>
                <div className="text-[11px] font-black text-rose-300">{ai.sequencePrediction.reversalProb.toFixed(1)}%</div>
              </div>
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Fake Breakout</div>
                <div className="text-[11px] font-black text-amber-300">{ai.microstructure.fakeBreakoutRisk.toFixed(1)}%</div>
              </div>
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Stop Hunt</div>
                <div className="text-[11px] font-black text-orange-300">{ai.microstructure.stopHuntRisk.toFixed(1)}%</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Micro</div>
                <div className={`text-[10px] font-black ${ai.multiTimeframe.micro.trend === 'BULL' ? 'text-emerald-300' : ai.multiTimeframe.micro.trend === 'BEAR' ? 'text-rose-300' : 'text-amber-300'}`}>{ai.multiTimeframe.micro.trend}</div>
              </div>
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Medium</div>
                <div className={`text-[10px] font-black ${ai.multiTimeframe.medium.trend === 'BULL' ? 'text-emerald-300' : ai.multiTimeframe.medium.trend === 'BEAR' ? 'text-rose-300' : 'text-amber-300'}`}>{ai.multiTimeframe.medium.trend}</div>
              </div>
              <div className="bg-slate-900/45 border border-slate-700/35 rounded px-2 py-1.5 text-center">
                <div className="text-[8px] text-slate-500 font-bold uppercase tracking-wider">Macro</div>
                <div className={`text-[10px] font-black ${ai.multiTimeframe.macro.trend === 'BULL' ? 'text-emerald-300' : ai.multiTimeframe.macro.trend === 'BEAR' ? 'text-rose-300' : 'text-amber-300'}`}>{ai.multiTimeframe.macro.trend}</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-[9px] mb-2">
              <span className="text-slate-500">MFT Alignment</span>
              <span className="text-cyan-300 font-bold">{ai.multiTimeframe.alignmentPct.toFixed(0)}%</span>
            </div>

            <div className="text-[9px] text-slate-400 space-y-0.5">
              <div className="flex items-center justify-between">
                <span>Latency</span>
                <span className="font-bold text-slate-300">{ai.commandDeck.analysisLatencyMs}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Cadence</span>
                <span className="font-bold text-slate-300">{ai.commandDeck.pipelineCadenceMs}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Exec Probability</span>
                <span className="font-bold text-emerald-300">{ai.institutionalConfluence.executionProbability}%</span>
              </div>
            </div>

            {Array.isArray(ai.commandDeck.alerts) && ai.commandDeck.alerts.length > 0 && (
              <div className="mt-2 text-[9px] text-amber-200 bg-amber-500/8 border border-amber-500/25 rounded px-2 py-1.5 leading-4">
                {ai.commandDeck.alerts[0]}
              </div>
            )}
          </div>
        )}
          </>
        )}
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <div className="px-4 py-1.5 border-t border-slate-700/30 flex justify-between items-center">
        <span className="text-[9px] text-slate-600 tabular-nums">
          {data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
        </span>
        <span className={`text-[9px] font-bold ${isLive ? 'text-emerald-500' : 'text-slate-600'}`}>
          {isLive ? '● Live' : '○ Cached'}
        </span>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';
export default TrendBaseCard;


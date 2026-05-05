'use client';

import React, { memo } from 'react';
import { PricePredictions, TradePrediction } from '@/hooks/useStrikeIntelligence';

interface PricePredictionCardProps {
  predictions: PricePredictions | undefined;
  isLoading?: boolean;
}

// ── Single trade target card ──────────────────────────────────────────────────
const TradeTargetCard = memo<{
  trade: TradePrediction;
  rank: 'PRIMARY' | 'SECONDARY';
}>(({ trade, rank }) => {
  const isCE      = trade.side === 'CE';
  const accentGreen = isCE ? 'text-emerald-300' : 'text-red-300';
  const borderClr   = isCE ? 'border-emerald-500/50' : 'border-red-500/50';
  const bgClr       = isCE ? 'bg-emerald-950/30' : 'bg-red-950/30';
  const badgeBg     = isCE
    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
    : 'bg-red-500/20 border-red-400/60 text-red-200';
  const glowClr = isCE
    ? 'shadow-[0_0_18px_4px_rgba(52,211,153,0.18)]'
    : 'shadow-[0_0_18px_4px_rgba(248,113,113,0.18)]';
  const convColor =
    trade.conviction >= 85 ? 'bg-emerald-400'
    : trade.conviction >= 75 ? 'bg-amber-400'
    : 'bg-orange-400';
  const marketDir = isCE ? 'MARKET ▲ UP' : 'MARKET ▼ DOWN';
  const dirColor  = isCE ? 'text-emerald-400' : 'text-red-400';
  const fmtVol = (v: number) =>
    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K`
    : `${v}`;

  return (
    <div className={`relative rounded-xl border ${borderClr} ${bgClr} ${glowClr} p-3 sm:p-4 overflow-hidden transition-all duration-300`}>

      {/* Rank badge */}
      <div className="absolute top-2 right-2">
        {rank === 'PRIMARY'
          ? <span className="text-[8px] font-black tracking-widest text-amber-300 bg-amber-500/20 border border-amber-400/50 px-1.5 py-0.5 rounded">★ BEST</span>
          : <span className="text-[8px] font-black tracking-widest text-slate-400 bg-slate-700/50 border border-slate-600/40 px-1.5 py-0.5 rounded">#2</span>
        }
      </div>

      {/* Header: side badge + market direction */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-black tracking-wide ${badgeBg}`}>
          {isCE ? '▲' : '▼'} BUY {trade.side}
        </span>
        <span className={`text-[9px] font-bold ${dirColor}`}>{marketDir}</span>
      </div>

      {/* Strike + Conviction */}
      <div className="flex items-end justify-between mb-2">
        <div>
          <span className="text-[8px] text-slate-500 font-semibold uppercase tracking-widest">Strike</span>
          <div className={`text-[20px] sm:text-[22px] font-black tabular-nums leading-none ${accentGreen}`}>
            {trade.strike.toLocaleString('en-IN')}
          </div>
          <span className="text-[8px] text-slate-500 font-mono">
            {trade.isATM ? 'ATM' : trade.delta >= 0.38 ? 'Near ATM' : 'OTM'} · δ {trade.delta.toFixed(2)}
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[8px] text-slate-500 font-semibold">Conviction</span>
          <span className={`text-[18px] font-black tabular-nums leading-none ${trade.conviction >= 85 ? 'text-emerald-300' : trade.conviction >= 75 ? 'text-amber-300' : 'text-orange-300'}`}>
            {trade.conviction}%
          </span>
          <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${convColor}`} style={{ width: `${trade.conviction}%` }} />
          </div>
        </div>
      </div>

      {/* Price boxes: Entry → Target | Stop */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className="flex flex-col items-center rounded-lg border border-slate-600/40 bg-slate-800/60 px-2 py-1.5">
          <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Entry</span>
          <span className={`text-[13px] font-black tabular-nums ${accentGreen}`}>₹{trade.entry.toFixed(1)}</span>
          <span className="text-[7px] text-slate-600 font-mono">LTP now</span>
        </div>
        <div className={`flex flex-col items-center rounded-lg border px-2 py-1.5 ${isCE ? 'border-emerald-500/50 bg-emerald-900/30' : 'border-red-500/50 bg-red-900/30'}`}>
          <span className="text-[7px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Target ▲</span>
          <span className={`text-[13px] font-black tabular-nums ${accentGreen}`}>₹{trade.target.toFixed(1)}</span>
          <span className={`text-[7px] font-bold ${isCE ? 'text-emerald-400' : 'text-red-400'}`}>+{trade.upsidePct}%</span>
        </div>
        <div className="flex flex-col items-center rounded-lg border border-red-900/40 bg-red-950/20 px-2 py-1.5">
          <span className="text-[7px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Stop ▼</span>
          <span className="text-[13px] font-black tabular-nums text-red-400">₹{trade.stopLoss.toFixed(1)}</span>
          <span className="text-[7px] text-red-600 font-mono">−28%</span>
        </div>
      </div>

      {/* Signal + BOS + Vol row */}
      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-black tracking-wide ${
          trade.signal === 'STRONG_BUY'  ? 'bg-emerald-950/60 text-emerald-200 border-emerald-500/60' :
          trade.signal === 'BUY'         ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/40' :
          trade.signal === 'STRONG_SELL' ? 'bg-red-950/60 text-red-200 border-red-500/60' :
          trade.signal === 'SELL'        ? 'bg-red-950/40 text-red-300 border-red-500/40' :
                                           'bg-slate-800/60 text-slate-400 border-slate-600/40'
        }`}>
          {trade.signal.replace('_', ' ')}
        </span>
        {trade.bos === 'UP' && (
          <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-bold text-cyan-300 bg-cyan-950/40 border-cyan-500/40">BOS ▲</span>
        )}
        {trade.bos === 'DOWN' && (
          <span className="inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-bold text-orange-300 bg-orange-950/40 border-orange-500/40">BOS ▼</span>
        )}
        <span className="text-[8px] font-mono text-slate-500">Vol {fmtVol(trade.volume)}</span>
      </div>

      {/* Reason tags */}
      {trade.reasons.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {trade.reasons.map((r) => (
            <span key={r} className={`inline-flex items-center rounded px-1.5 py-0.5 text-[7px] font-semibold border ${
              r.startsWith('⚠') ? 'bg-amber-950/40 text-amber-300 border-amber-600/40'
                                 : 'bg-slate-800/60 text-slate-400 border-slate-700/40'
            }`}>{r}</span>
          ))}
        </div>
      )}
    </div>
  );
});
TradeTargetCard.displayName = 'TradeTargetCard';

// ── Main exported card ────────────────────────────────────────────────────────
export const PricePredictionCard: React.FC<PricePredictionCardProps> = memo(({
  predictions,
}) => {
  if (!predictions) return null;

  const { primary, secondary, score } = predictions;
  if (!primary && !secondary) return null;

  const isBull   = (score ?? 0) > 0;
  const dirLabel = isBull ? '▲ BULLISH — BUY CE' : '▼ BEARISH — BUY PE';
  const dirColor = isBull ? 'text-emerald-300' : 'text-red-300';
  const dirBg    = isBull ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30';
  const roundedScore = Math.round(score ?? 0);

  return (
    <div className="mb-3 rounded-xl border border-slate-700/40 bg-slate-900/60 overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/30">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black tracking-widest text-slate-400 uppercase">Price Targets</span>
          <span className="text-[8px] text-slate-600 font-mono">conviction ≥65% only</span>
        </div>
        <div className={`flex items-center gap-1 rounded-md border px-2 py-0.5 text-[9px] font-black ${dirColor} ${dirBg}`}>
          {dirLabel}
          <span className="font-mono opacity-70 ml-1">{roundedScore > 0 ? '+' : ''}{roundedScore}</span>
        </div>
      </div>

      {/* Trade cards */}
      <div className={`p-3 grid gap-3 ${primary && secondary ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 max-w-sm mx-auto'}`}>
        {primary   && <TradeTargetCard trade={primary}   rank="PRIMARY"   />}
        {secondary && <TradeTargetCard trade={secondary} rank="SECONDARY" />}
      </div>

      {/* Footer legend */}
      <div className="flex flex-wrap items-center gap-2 px-3 pb-2 text-[7px] font-mono text-slate-600">
        <span>Entry = current LTP</span>
        <span>·</span>
        <span>Target = δ × expected spot move</span>
        <span>·</span>
        <span>Stop = −28% (exit if option drops here)</span>
      </div>
    </div>
  );
});
PricePredictionCard.displayName = 'PricePredictionCard';

export default PricePredictionCard;

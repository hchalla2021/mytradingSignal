'use client';

/**
 * ⚡ Pure Liquidity Intelligence  —  v1
 * ──────────────────────────────────────
 * Think like an institutional desk watching WHERE the money is
 * flowing — not just where price is going.
 *
 * Per-index card:
 *   • OI Profile banner (Long Buildup / Short Buildup / Covering / Unwinding)
 *   • PCR value + interpretation (the purest liquidity signal)
 *   • Overall liquidity direction + confidence bar
 *   • 5-min prediction badge with its OWN separate confidence %
 *   • 4-signal breakdown: PCR Sentiment / OI Buildup / Price Momentum / Candle Conviction
 *   • Key metrics: Price%, PCR, Call OI, Put OI, VWAP Dev
 */

import React, { memo } from 'react';
import {
  useLiquiditySocket,
  LiquidityIndex,
  LiquidityDirection,
  LiquiditySignalFactor,
  LiquidityPrediction,
  OIProfile,
} from '@/hooks/useLiquiditySocket';


// ── Colour system ─────────────────────────────────────────────────────────────

type DirPalette = {
  ring: string; badge: string; bar: string;
  text: string; glow: string; gradFrom: string;
};

function getDirPalette(dir: LiquidityDirection): DirPalette {
  if (dir === 'BULLISH') return {
    ring:      'ring-cyan-500/40',
    badge:     'bg-cyan-500/20 text-cyan-200 border-cyan-500/50',
    bar:       'bg-cyan-500',
    text:      'text-cyan-400',
    glow:      'shadow-cyan-500/15',
    gradFrom:  'from-cyan-900/15',
  };
  if (dir === 'BEARISH') return {
    ring:      'ring-orange-500/40',
    badge:     'bg-orange-500/20 text-orange-200 border-orange-500/50',
    bar:       'bg-orange-500',
    text:      'text-orange-400',
    glow:      'shadow-orange-500/15',
    gradFrom:  'from-orange-900/15',
  };
  return {
    ring:      'ring-slate-500/30',
    badge:     'bg-slate-500/15 text-slate-300 border-slate-500/40',
    bar:       'bg-slate-500',
    text:      'text-slate-400',
    glow:      'shadow-slate-800/20',
    gradFrom:  'from-slate-800/20',
  };
}

// ── OI Profile banner ─────────────────────────────────────────────────────────

type ProfileStyle = { bg: string; text: string; label: string; icon: string; ring: string; glow: string };

const OI_PROFILE: Record<OIProfile, ProfileStyle> = {
  STRONG_LONG_BUILDUP: { bg: 'bg-green-500/30  border-green-400/60',   text: 'text-green-100',   label: '🚀 Rally — Strong Long Buildup', icon: '🚀', ring: 'ring-2 ring-green-400/80 border-green-400/70',   glow: 'shadow-[0_0_24px_rgba(34,197,94,0.50)]' },
  LONG_BUILDUP:     { bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-200', label: 'Long Buildup',      icon: '📈', ring: 'ring-2 ring-emerald-400/70 border-emerald-400/60', glow: 'shadow-[0_0_18px_rgba(52,211,153,0.35)]' },
  SHORT_COVERING:   { bg: 'bg-lime-500/15    border-lime-500/30',    text: 'text-lime-300',    label: 'Short Covering',    icon: '🔄', ring: '', glow: '' },
  STRONG_SHORT_BUILDUP: { bg: 'bg-rose-600/30   border-rose-500/60',    text: 'text-rose-100',    label: '💥 Crash — Strong Short Buildup', icon: '💥', ring: 'ring-2 ring-rose-500/80 border-rose-500/70',     glow: 'shadow-[0_0_24px_rgba(225,29,72,0.50)]' },
  SHORT_BUILDUP:    { bg: 'bg-red-500/20     border-red-500/40',     text: 'text-red-200',     label: 'Short Buildup',     icon: '📉', ring: 'ring-2 ring-red-500/70 border-red-500/60',         glow: 'shadow-[0_0_18px_rgba(239,68,68,0.35)]' },
  LONG_UNWINDING:      { bg: 'bg-orange-500/15  border-orange-500/30',  text: 'text-orange-300',  label: 'Long Unwinding',       icon: '⚠️', ring: '', glow: '' },
  QUIET_ACCUMULATION:  { bg: 'bg-teal-500/15    border-teal-500/30',    text: 'text-teal-300',    label: 'Quiet Accumulation',   icon: '🤫', ring: '', glow: '' },
  UNCONFIRMED_RALLY:   { bg: 'bg-yellow-500/15  border-yellow-500/30',  text: 'text-yellow-300',  label: 'Unconfirmed Rally',    icon: '⚡', ring: '', glow: '' },
  WEAK_SHORT_BUILDUP:  { bg: 'bg-pink-500/15    border-pink-500/30',    text: 'text-pink-300',    label: 'Weak Short Buildup',   icon: '🔻', ring: '', glow: '' },
  BEAR_EXHAUSTION:     { bg: 'bg-amber-600/15   border-amber-500/30',   text: 'text-amber-300',   label: 'Bear Exhaustion',      icon: '😮‍💨', ring: '', glow: '' },
  NEUTRAL:             { bg: 'bg-slate-700/30   border-slate-600/30',   text: 'text-slate-400',   label: 'No Clear Pattern',     icon: '⚖️', ring: '', glow: '' },
  PCR_EXTREME_BULL: { bg: 'bg-cyan-500/20    border-cyan-400/50',    text: 'text-cyan-200',    label: 'Extreme Put Wall',  icon: '🛡️', ring: '', glow: '' },
  PCR_EXTREME_BEAR: { bg: 'bg-amber-500/20   border-amber-400/40',   text: 'text-amber-200',   label: 'Extreme Call Wall', icon: '🧱', ring: '', glow: '' },
};

// ── 5-min prediction badge ─────────────────────────────────────────────────────

const PRED: Record<LiquidityPrediction, { bg: string; label: string; arrow: string }> = {
  STRONG_BUY:  { bg: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/70', label: 'Strong Buy',  arrow: '▲▲' },
  BUY:         { bg: 'bg-cyan-500/20    text-cyan-300    border-cyan-500/50',    label: 'Buy',         arrow: '▲'  },
  NEUTRAL:     { bg: 'bg-slate-500/20   text-slate-300   border-slate-500/40',   label: 'Neutral',     arrow: '→'  },
  SELL:        { bg: 'bg-orange-500/20  text-orange-300  border-orange-500/50',  label: 'Sell',        arrow: '▼'  },
  STRONG_SELL: { bg: 'bg-red-500/25     text-red-200     border-red-400/70',     label: 'Strong Sell', arrow: '▼▼' },
};

const Pred5mBadge = memo(({ pred }: { pred: LiquidityPrediction }) => {
  const s = PRED[pred] ?? PRED.NEUTRAL;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5
                      text-[9px] font-black leading-none tracking-wide ${s.bg}`}>
      <span>{s.arrow}</span>
      <span>{s.label.toUpperCase()}</span>
    </span>
  );
});
Pred5mBadge.displayName = 'Pred5mBadge';

// ── Score bar (bidirectional, centred zero) ───────────────────────────────────

const ScoreBar = memo(({ score, positiveColor = 'bg-cyan-500', negativeColor = 'bg-orange-500' }:
  { score: number; positiveColor?: string; negativeColor?: string }) => {
  const abs   = Math.min(Math.abs(score), 1.0);
  const isPos = score >= 0;
  const color = isPos ? positiveColor : negativeColor;
  const width = `${abs * 50}%`;
  return (
    <div className="relative flex-1 flex items-center h-1.5 rounded-full bg-slate-700/60 overflow-visible mx-1">
      <div className="absolute left-1/2 top-0 w-px h-full bg-slate-500/60 z-10" />
      {isPos ? (
        <div className={`absolute left-1/2 h-full rounded-r-full ${color} transition-all duration-500`} style={{ width }} />
      ) : (
        <div className={`absolute right-1/2 h-full rounded-l-full ${color} transition-all duration-500`} style={{ width }} />
      )}
    </div>
  );
});
ScoreBar.displayName = 'ScoreBar';

// ── Signal row ────────────────────────────────────────────────────────────────

const SIG_NAMES: Record<string, string> = {
  pcr_sentiment:    'PCR Sentiment',
  oi_buildup:       'OI Buildup',
  price_momentum:   'Price Momentum',
  candle_conviction: 'Candle Conviction',
};

const SignalRow = memo(({ factorKey, factor }: { factorKey: string; factor: LiquiditySignalFactor }) => {
  const pct   = Math.round(factor.weight * 100);
  const arrow = factor.signal === 'BULL' ? '↑' : factor.signal === 'BEAR' ? '↓' : '→';
  const arrowColor = factor.signal === 'BULL' ? 'text-cyan-400' :
                     factor.signal === 'BEAR' ? 'text-orange-400' : 'text-slate-400';

  return (
    <div className="flex items-center gap-2 py-[5px] border-t border-slate-700/30 first:border-0">
      <span className={`w-3 text-center text-xs font-bold leading-none ${arrowColor}`}>{arrow}</span>
      <span className="w-[108px] text-[10px] text-slate-400 leading-tight truncate">
        {SIG_NAMES[factorKey] ?? factorKey}
        <span className="ml-1 text-slate-600">{pct}%</span>
      </span>
      <ScoreBar score={factor.score} />
      <span className={`w-12 text-right text-[10px] font-semibold leading-none ${arrowColor}`}>
        {factor.score >= 0 ? '+' : ''}{(factor.score * 100).toFixed(0)}
        <span className="text-slate-600 font-normal">/100</span>
      </span>
    </div>
  );
});
SignalRow.displayName = 'SignalRow';

// ── Confidence bar ────────────────────────────────────────────────────────────

const ConfidenceBar = memo(({ confidence, barColor }: { confidence: number; barColor: string }) => (
  <div className="w-full h-1 rounded-full bg-slate-700/50 overflow-hidden mt-1">
    <div
      className={`h-full rounded-full ${barColor} transition-all duration-700`}
      style={{ width: `${confidence}%` }}
    />
  </div>
));
ConfidenceBar.displayName = 'ConfidenceBar';

// ── OI formatter (e.g. 12345678 → 123.5L) ────────────────────────────────────

function fmtOI(n: number | null | undefined): string {
  if (!n || n === 0) return '—';
  if (n >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (n >= 100_000)    return `${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000)      return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPCR(v: number | null | undefined): string {
  return v ? v.toFixed(3) : '—';
}

// ── PCR sentiment pill ────────────────────────────────────────────────────────

function pcrColor(pcr: number | null): string {
  if (!pcr)        return 'text-slate-500';
  if (pcr >= 1.3)  return 'text-cyan-400';
  if (pcr >= 1.0)  return 'text-cyan-600';
  if (pcr >= 0.8)  return 'text-slate-400';
  if (pcr >= 0.6)  return 'text-orange-400';
  return 'text-red-400';
}

function pcrLabel(pcr: number | null): string {
  if (!pcr)        return 'No Data';
  if (pcr >= 1.6)  return 'Extreme Put Wall';
  if (pcr >= 1.3)  return 'Bullish (Floor)';
  if (pcr >= 1.1)  return 'Mild Bullish';
  if (pcr >= 0.9)  return 'Balanced';
  if (pcr >= 0.7)  return 'Mild Bearish';
  if (pcr >= 0.5)  return 'Bearish (Cap)';
  return 'Extreme Call Wall';
}

// ── PCR raw color for style props (hex) ──────────────────────────────────────
function pcrHex(pcr: number | null): string {
  if (!pcr)        return '#64748b';
  if (pcr >= 1.3)  return '#22d3ee';
  if (pcr >= 1.0)  return '#94a3b8';
  if (pcr >= 0.7)  return '#f97316';
  return '#ef4444';
}

// ── Index card ────────────────────────────────────────────────────────────────

const IndexCard = memo(({ data, index }: { data: LiquidityIndex | null; index: string }) => {
  // ── Skeleton ──────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="w-full rounded-xl bg-[#1a2332] border border-slate-700/40 overflow-hidden">
        <div className="h-8 bg-slate-700/40 animate-pulse" />
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`h-${i === 0 ? 6 : 3} bg-slate-700/40 rounded-lg animate-pulse`} />
          ))}
        </div>
      </div>
    );
  }

  const pal     = getDirPalette(data.direction);
  const oiStyle = OI_PROFILE[data.oiProfile] ?? OI_PROFILE.NEUTRAL;
  const pcr     = data.metrics.pcr;

  const changePctColor = data.metrics.changePct > 0 ? 'text-cyan-400' :
                         data.metrics.changePct < 0 ? 'text-orange-400' : 'text-slate-400';

  const signalOrder: (keyof typeof data.signals)[] =
    ['pcr_sentiment', 'oi_buildup', 'price_momentum', 'candle_conviction'];

  // Signal confluence: count how many of the 4 signals align in one direction
  const bullCount     = signalOrder.filter(k => data.signals[k].signal === 'BULL').length;
  const bearCount     = signalOrder.filter(k => data.signals[k].signal === 'BEAR').length;
  const confluenceDir = bullCount >= bearCount ? 'BULL' : 'BEAR';
  const confluenceMax = Math.max(bullCount, bearCount);

  // PCR gauge position within [0.4 → 1.8] range
  const pcrMin = 0.4, pcrMax = 1.8;
  const pcrTickPct   = pcr ? Math.max(2, Math.min(98, ((pcr - pcrMin) / (pcrMax - pcrMin)) * 100)) : 50;
  const pcrTickColor = pcrHex(pcr);

  // PUT / CALL OI split
  const putOI   = data.metrics.putOI  || 0;
  const callOI  = data.metrics.callOI || 0;
  const oiTotal = putOI + callOI;
  const putPct  = oiTotal > 0 ? Math.round((putOI  / oiTotal) * 100) : 50;
  const callPct = 100 - putPct;

  // Movement probability via sigmoid of rawScore
  const rs          = data.rawScore || 0;
  const bullProbPct = Math.max(5, Math.min(95, Math.round((1 / (1 + Math.exp(-rs * 4))) * 100)));
  const bearProbPct = 100 - bullProbPct;

  // High conviction: ≥3 signals agree AND overall confidence ≥60%
  const highConviction = confluenceMax >= 3 && data.confidence >= 60;

  return (
    <div className={`w-full rounded-xl bg-[#1a2332] border overflow-hidden
                     transition-all duration-150
                     ${oiStyle.ring || `ring-1 ${pal.ring} border-slate-700/40`}
                     ${oiStyle.glow || `shadow-lg ${pal.glow}`}`}>

      {/* ── OI Profile banner ──────────────────────────────────────────────── */}
      <div className={`px-3 py-2 border-b flex items-center justify-between ${oiStyle.bg}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{oiStyle.icon}</span>
          <span className={`text-[11px] font-black tracking-wider uppercase ${oiStyle.text}`}>
            {oiStyle.label}
          </span>
        </div>
        <span className="text-[9px] text-slate-400 font-mono font-semibold tracking-wider">
          {data.dataSource === 'MARKET_CLOSED' ? '🕐 LAST' : '⚡ LIVE'}
        </span>
      </div>

      <div className="p-3.5 space-y-3">

        {/* ── Header: symbol + price / direction badge ────────────────────── */}
        <div className="flex items-start justify-between">
          <div className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5">
            <span className="text-sm font-black text-white tracking-wide">{data.symbol}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] font-mono text-slate-300">
                {fmtPrice(data.metrics.price)}
              </span>
              <span className={`text-[10px] font-semibold ${changePctColor}`}>
                {data.metrics.changePct >= 0 ? '+' : ''}{data.metrics.changePct.toFixed(2)}%
              </span>
            </div>
          </div>
          {/* Direction + confidence — single consolidated badge */}
          <div className={`rounded-lg border-2 px-3 py-2 text-center transition-all duration-700 flex flex-col items-center justify-center ${pal.badge}`}>
            <div className="text-[10px] font-black tracking-widest leading-none">
              {data.direction === 'BULLISH' ? '▲' : data.direction === 'BEARISH' ? '▼' : '●'}
              &nbsp;{data.direction}
            </div>
            <div className={`text-[17px] font-black leading-none mt-1 tabular-nums ${pal.text}`}>
              {data.confidence}%
            </div>
            <div className="text-[8px] font-semibold text-slate-400 leading-none mt-1 tracking-wide">
              CONFIDENCE
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <ConfidenceBar confidence={data.confidence} barColor={pal.bar} />

        {/* ── PCR + OI section ─────────────────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/30 px-3 py-2 space-y-2">
          {/* PCR value + label */}
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">
              Put-Call Ratio
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`text-sm font-black font-mono ${pcrColor(pcr)}`}>
                {fmtPCR(pcr)}
              </span>
              <span className={`text-[9px] font-semibold ${pcrColor(pcr)}`}>
                {pcrLabel(pcr)}
              </span>
            </div>
          </div>

          {/* PCR gauge — visual position on bear→bull spectrum */}
          {pcr && pcr > 0 && (
            <div>
              <div className="relative h-[6px] rounded-full bg-gradient-to-r from-red-600/50 via-slate-600/50 to-cyan-500/50">
                {([
                  { val: 0.5, c: '#ef4444' }, { val: 0.8, c: '#f97316' },
                  { val: 1.0, c: '#64748b' }, { val: 1.3, c: '#22d3ee' }, { val: 1.6, c: '#06b6d4' },
                ] as Array<{ val: number; c: string }>).map(t => (
                  <div key={t.val} className="absolute top-0 w-px h-full opacity-60"
                    style={{ left: `${Math.max(2, Math.min(98, ((t.val - pcrMin) / (pcrMax - pcrMin)) * 100))}%`, backgroundColor: t.c }} />
                ))}
                <div className="absolute -top-[2px] w-[6px] h-[10px] rounded-sm z-10"
                  style={{ left: `calc(${pcrTickPct}% - 3px)`, backgroundColor: pcrTickColor }} />
              </div>
              <div className="flex justify-between text-[7px] mt-0.5">
                <span className="text-red-500/60">Bear 0.5</span>
                <span className="text-slate-500/60">Neutral 1.0</span>
                <span className="text-cyan-500/60">Bull 1.6</span>
              </div>
            </div>
          )}

          {/* PUT / CALL OI split bar */}
          {oiTotal > 0 && (
            <div>
              <div className="flex items-center justify-between text-[8px] mb-1">
                <span className="text-cyan-400/80 font-semibold">PUT {fmtOI(putOI)}</span>
                <span className="text-slate-600 text-[7px] uppercase tracking-wider">OI Split</span>
                <span className="text-orange-400/80 font-semibold">CALL {fmtOI(callOI)}</span>
              </div>
              <div className="flex h-5 rounded overflow-hidden">
                <div className="flex items-center justify-center bg-cyan-600/35 transition-all duration-500"
                  style={{ width: `${putPct}%` }}>
                  <span className="text-[8px] font-bold text-cyan-200 px-1">{putPct}%</span>
                </div>
                <div className="flex items-center justify-center bg-orange-600/35 transition-all duration-500"
                  style={{ width: `${callPct}%` }}>
                  <span className="text-[8px] font-bold text-orange-200 px-1">{callPct}%</span>
                </div>
              </div>
            </div>
          )}

          {/* VWAP deviation */}
          {data.metrics.vwapDev != null && (
            <div className="flex items-center gap-2 text-[9px]">
              <span className="text-slate-500 uppercase tracking-wider">VWAP Dev</span>
              <span className={`font-semibold ${data.metrics.vwapDev >= 0 ? 'text-cyan-400' : 'text-orange-400'}`}>
                {data.metrics.vwapDev >= 0 ? '+' : ''}{data.metrics.vwapDev.toFixed(2)}%
              </span>
            </div>
          )}
        </div>

        {/* ── 5-Min prediction ─────────────────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/60 border border-slate-700/30 px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
                ⚡ 5-Min Prediction
              </div>
              <Pred5mBadge pred={data.prediction5m} />
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[15px] font-black text-white tabular-nums">
                {data.pred5mConf}%
              </span>
              <span className="text-[8px] text-slate-500 leading-none">CONFIDENCE</span>
              <div className="w-16 h-1.5 rounded-full bg-slate-700/50 overflow-hidden mt-0.5">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    data.prediction5m === 'STRONG_BUY'  ? 'bg-emerald-400' :
                    data.prediction5m === 'BUY'         ? 'bg-cyan-400' :
                    data.prediction5m === 'STRONG_SELL' ? 'bg-red-400' :
                    data.prediction5m === 'SELL'        ? 'bg-orange-400' :
                                                          'bg-slate-500'
                  }`}
                  style={{ width: `${data.pred5mConf}%` }}
                />
              </div>
            </div>
          </div>

          {/* Movement probability — sigmoid transform of rawScore for honest probability */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[8px] text-slate-500 uppercase tracking-wider font-semibold">Movement Probability</span>
              {highConviction && (
                <span className="text-[8px] font-bold text-amber-400">⚡ High Conviction</span>
              )}
            </div>
            <div className="flex h-6 rounded overflow-hidden bg-slate-950/50 border border-slate-700/30">
              <div
                className="h-full bg-gradient-to-r from-cyan-600 to-cyan-500 transition-all duration-300 flex items-center justify-center"
                style={{ width: `${bullProbPct}%` }}
              >
                <span className="text-[8px] font-bold text-white px-1 truncate">{bullProbPct}%↑</span>
              </div>
              <div
                className="h-full bg-gradient-to-l from-orange-600 to-orange-500 transition-all duration-300 flex items-center justify-center"
                style={{ width: `${bearProbPct}%` }}
              >
                <span className="text-[8px] font-bold text-white px-1 truncate">{bearProbPct}%↓</span>
              </div>
            </div>
          </div>

          {/* Signal confluence — shown only when ≥3 of 4 signals agree */}
          {confluenceMax >= 3 && (
            <div className="flex items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold border ${
                confluenceDir === 'BULL'
                  ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                  : 'bg-orange-500/15 text-orange-300 border-orange-500/30'
              }`}>
                {confluenceMax}/4 {confluenceDir === 'BULL' ? '▲' : '▼'} ALIGNED
              </span>
              <span className="text-[8px] text-slate-500">
                {confluenceMax === 4 ? 'all signals agree' : '3 of 4 agree'}
              </span>
            </div>
          )}
        </div>

        {/* ── 4-Signal breakdown ──────────────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/25 px-3 py-2">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-semibold mb-1">
            Liquidity Signals
          </div>
          {signalOrder.map(key => (
            <SignalRow key={key} factorKey={key} factor={data.signals[key]} />
          ))}
        </div>

        {/* ── Metrics row ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1.5">
          <MetricPill label="EMA9" value={data.metrics.ema9 != null ? data.metrics.ema9.toFixed(0) : '—'} />
          <MetricPill label="EMA20" value={data.metrics.ema20 != null ? data.metrics.ema20.toFixed(0) : '—'} />
          <MetricPill label="VWAP"  value={data.metrics.vwap  != null ? data.metrics.vwap.toFixed(0)  : '—'} />
        </div>

      </div>
    </div>
  );
});
IndexCard.displayName = 'IndexCard';

// ── Metric pill ───────────────────────────────────────────────────────────────

const MetricPill = memo(({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-slate-800/50 border border-slate-700/30 px-2 py-1 text-center">
    <div className="text-[8px] text-slate-600 uppercase tracking-wider">{label}</div>
    <div className="text-[10px] text-slate-300 font-mono font-semibold">{value}</div>
  </div>
));
MetricPill.displayName = 'MetricPill';

// ── Header bar ────────────────────────────────────────────────────────────────

const HeaderBar = memo(({ isConnected, lastUpdate }: { isConnected: boolean; lastUpdate: string | null }) => {
  // Show as active if WebSocket is connected OR if we got a REST update in last 10 seconds
  const hasRecentData = lastUpdate ? (Date.now() - new Date(lastUpdate).getTime()) < 10000 : false;
  const isActive = isConnected || hasRecentData;
  const statusDot = isActive ? 'bg-cyan-400 shadow-cyan-400/70 shadow-sm animate-pulse' : 'bg-slate-600';
  const statusLabel = isActive ? 'LIVE' : 'OFFLINE';

  return (
    <div className="mb-4 sm:mb-5">
      <div className="relative rounded-xl bg-cyan-500/[0.06] border border-emerald-400/25 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm shadow-cyan-500/20">
        <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            <span className="w-[3px] h-7 sm:h-9 rounded-full bg-gradient-to-b from-cyan-400 to-cyan-600 shrink-0 shadow-sm shadow-cyan-500/20" />
            <h2 className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug truncate">
              ⚡ Market Liquidity
            </h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5
                              text-[9px] font-bold tracking-widest border shrink-0 ${
                            isActive
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          </div>
          <p className="text-[11px] sm:text-xs text-cyan-400 opacity-60 mt-1.5 ml-[15px] sm:ml-[17px] font-medium tracking-wide">
            Options Flow · PCR Sentiment · OI Analysis · Smart Money Positioning
          </p>
        </div>
      </div>
    </div>
  );
});
HeaderBar.displayName = 'HeaderBar';



// ── Root component ────────────────────────────────────────────────────────────

function LiquidityIntelligence() {
  const { liquidityData, isConnected, lastUpdate } = useLiquiditySocket();

  return (
    <section className="w-full rounded-2xl border border-slate-700/40 overflow-hidden
                        bg-gradient-to-b from-cyan-900/8 via-[#0d1525] to-[#0d1525]">
      {/* Section background gradient stripe */}
      <div className="px-4 pt-5 pb-1">
        <HeaderBar isConnected={isConnected} lastUpdate={lastUpdate} />
      </div>

      {/* 3-column index cards */}
      <div className="px-4 pb-5">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <IndexCard data={liquidityData.NIFTY}     index="NIFTY"     />
          <IndexCard data={liquidityData.BANKNIFTY}  index="BANKNIFTY" />
          <IndexCard data={liquidityData.SENSEX}     index="SENSEX"    />
        </div>
      </div>
    </section>
  );
}

export default memo(LiquidityIntelligence);

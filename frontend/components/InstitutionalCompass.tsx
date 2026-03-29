'use client';

/**
 * Institutional Market Compass  ——  v2
 * ──────────────────────────────────────
 * AI-Powered Index & Futures Direction Engine
 *
 * Per-index panel:
 *   • Spot price + intraday change
 *   • Overall direction badge + confidence bar
 *   • 6-factor signal breakdown (VWAP / EMA / Trend / Premium / RSI / Volume)
 *   • Key indicator values (VWAP, RSI, EMA9/20/50)
 *   • Futures table: Spot | CUR | NXT | FAR with premium vs Fair-Value
 *   • Premium trend indicator (Expanding / Contracting / Stable)
 *   • Futures Leading badge when smart-money leads spot
 */

import React, { memo, useState, useRef, useEffect } from 'react';
import {
  useCompassSocket,
  CompassIndex,
  CompassDirection,
  SignalFactor,
  FuturesSlot,
  Prediction5m,
} from '@/hooks/useCompassSocket';

// ── Colour system ─────────────────────────────────────────────────────────────

type Palette = {
  ring: string; badge: string; bar: string;
  text: string; dot: string; glow: string;
  bg: string;
};

function getPalette(dir: CompassDirection): Palette {
  if (dir === 'BULLISH') return {
    ring:  'ring-emerald-500/40',
    badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
    bar:   'bg-emerald-500',
    text:  'text-emerald-400',
    dot:   'bg-emerald-400',
    glow:  'shadow-emerald-500/15',
    bg:    'from-emerald-900/10',
  };
  if (dir === 'BEARISH') return {
    ring:  'ring-red-500/40',
    badge: 'bg-red-500/20 text-red-300 border-red-500/50',
    bar:   'bg-red-500',
    text:  'text-red-400',
    dot:   'bg-red-400',
    glow:  'shadow-red-500/15',
    bg:    'from-red-900/10',
  };
  return {
    ring:  'ring-amber-500/30',
    badge: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
    bar:   'bg-amber-500',
    text:  'text-amber-400',
    dot:   'bg-amber-400',
    glow:  'shadow-amber-500/10',
    bg:    'from-amber-900/8',
  };
}

function signalPalette(sig: 'BULL' | 'BEAR' | 'NEUTRAL') {
  if (sig === 'BULL')    return { arrow: '↑', color: 'text-emerald-400', bar: 'bg-emerald-500' };
  if (sig === 'BEAR')    return { arrow: '↓', color: 'text-red-400',     bar: 'bg-red-500'     };
  return                        { arrow: '→', color: 'text-amber-400',   bar: 'bg-amber-500'   };
}

function pctColor(v: number) {
  if (v > 0.05)  return 'text-emerald-400';
  if (v < -0.05) return 'text-red-400';
  return 'text-slate-400';
}

function dirArrow(dir: CompassDirection) {
  return dir === 'BULLISH' ? '↑' : dir === 'BEARISH' ? '↓' : '→';
}

// ── 5-minute prediction badge ─────────────────────────────────────────────────

const PRED5M_CONF: Record<Prediction5m, { bg: string; label: string; arrow: string; dirColor: string }> = {
  STRONG_BUY:  { bg: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/70', label: 'Strong Buy',  arrow: '▲▲', dirColor: 'text-emerald-300' },
  BUY:         { bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40', label: 'Buy',         arrow: '▲',  dirColor: 'text-emerald-400' },
  NEUTRAL:     { bg: 'bg-amber-500/15  text-amber-400   border-amber-500/40',   label: 'Neutral',     arrow: '→',  dirColor: 'text-amber-400'   },
  SELL:        { bg: 'bg-red-500/15    text-red-400     border-red-500/40',     label: 'Sell',        arrow: '▼',  dirColor: 'text-red-400'     },
  STRONG_SELL: { bg: 'bg-red-500/25    text-red-200     border-red-400/70',     label: 'Strong Sell', arrow: '▼▼', dirColor: 'text-red-300'     },
};

const Pred5mBadge = memo(({ pred, conf }: { pred: Prediction5m; conf?: number }) => {
  const s = PRED5M_CONF[pred] ?? PRED5M_CONF.NEUTRAL;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5
                        text-[9px] font-black leading-none tracking-wide ${s.bg}`}>
        <span>{s.arrow}</span>
        <span>{s.label.toUpperCase()}</span>
      </span>
      {conf !== undefined && (
        <span className={`text-[8px] font-bold tabular-nums ${s.dirColor}`}>{conf}% Confidence</span>
      )}
    </div>
  );
});
Pred5mBadge.displayName = 'Pred5mBadge';

const PRED = PRED5M_CONF;

const fmt = (n: number, d = 2) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

// ── Signal score bar ──────────────────────────────────────────────────────────

const ScoreBar = memo(({ score }: { score: number }) => {
  const abs = Math.min(Math.abs(score), 1.0);
  const isPos = score >= 0;
  const barCls = isPos ? 'bg-emerald-500' : 'bg-red-500';
  const width   = `${abs * 50}%`;

  return (
    <div className="relative flex-1 flex items-center h-1.5 rounded-full bg-slate-700/60 overflow-visible mx-1">
      {/* centre line */}
      <div className="absolute left-1/2 top-0 w-px h-full bg-slate-500/60 z-10" />
      {isPos ? (
        <div
          className={`absolute left-1/2 h-full rounded-r-full ${barCls} imc-score-bar`}
          style={{ width }}
        />
      ) : (
        <div
          className={`absolute right-1/2 h-full rounded-l-full ${barCls} imc-score-bar`}
          style={{ width }}
        />
      )}
    </div>
  );
});
ScoreBar.displayName = 'ScoreBar';

// ── Signal Row ────────────────────────────────────────────────────────────────

const FACTOR_NAMES: Record<string, string> = {
  vwap:            'VWAP',
  ema_alignment:   'EMA 9/20/50',
  trend_structure: 'Swing Structure',
  futures_premium: 'Futures Premium',
  rsi_momentum:    'RSI Momentum',
  volume_confirm:  'Volume',
};

interface SignalRowProps {
  factorKey: string;
  factor: SignalFactor;
}

const SignalRow = memo(({ factorKey, factor }: SignalRowProps) => {
  const sp = signalPalette(factor.signal);
  const pct = Math.round(factor.weight * 100);
  const isStrong = Math.abs(factor.score) > 0.5;

  return (
    <div className="flex items-center gap-2 py-1.5 border-t border-slate-700/30 first:border-0">
      {/* Arrow */}
      <span className={`w-3 text-center text-xs font-bold leading-none ${sp.color}`}>
        {sp.arrow}
      </span>
      {/* Name + weight */}
      <div className="w-28 shrink-0">
        <span className={`text-[11px] font-semibold text-slate-300 ${isStrong ? 'imc-factor-strong' : ''}`}>
          {FACTOR_NAMES[factorKey] ?? factorKey}
        </span>
        <span className="ml-1 text-[9px] text-slate-600">{pct}%</span>
      </div>
      {/* Score bar (centred, -1 left ← 0 → right +1) */}
      <ScoreBar score={factor.score} />
      {/* Score value */}
      <span className={`w-10 text-right text-[10px] tabular-nums font-mono shrink-0 imc-val ${sp.color}`}>
        {factor.score >= 0 ? '+' : ''}{factor.score.toFixed(2)}
      </span>
      {/* Label */}
      <span className="hidden xl:block text-[10px] text-slate-500 truncate max-w-[140px]">
        {factor.label}
      </span>
    </div>
  );
});
SignalRow.displayName = 'SignalRow';

// ── Key indicators strip ──────────────────────────────────────────────────────

interface IndicatorsStripProps {
  data: CompassIndex;
}

const IndicatorsStrip = memo(({ data }: IndicatorsStripProps) => {
  const { spot, futures } = data;
  const vwapDev = spot.vwap && spot.price > 0
    ? ((spot.price - spot.vwap) / spot.vwap * 100)
    : null;

  // EMA alignment text
  let emaAlign = '—';
  if (spot.ema9 && spot.ema20 && spot.ema50) {
    if (spot.ema9 > spot.ema20 && spot.ema20 > spot.ema50) emaAlign = '9>20>50 ↑';
    else if (spot.ema9 < spot.ema20 && spot.ema20 < spot.ema50) emaAlign = '9<20<50 ↓';
    else if (spot.ema9 > spot.ema20) emaAlign = '9>20 mild ↑';
    else emaAlign = '9<20 mild ↓';
  }

  const premTrend = futures.premiumTrend;
  const premColor = premTrend === 'EXPANDING' ? 'text-emerald-400'
    : premTrend === 'CONTRACTING' ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="grid grid-cols-3 gap-1.5 text-center py-2 px-1
                    bg-slate-900/40 border border-slate-700/40 rounded-xl">
      {/* VWAP */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">VWAP</p>
        <p className="text-xs font-bold text-slate-200 tabular-nums imc-val">
          {spot.vwap ? fmt(spot.vwap) : '—'}
        </p>
        {vwapDev !== null && (
          <p className={`text-[10px] tabular-nums font-semibold imc-val ${pctColor(vwapDev)}`}>
            {fmtPct(vwapDev)}
          </p>
        )}
      </div>
      {/* RSI */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">RSI 14</p>
        <p className={`text-xs font-bold tabular-nums imc-val ${
          spot.rsi == null ? 'text-slate-600'
          : spot.rsi >= 60 ? 'text-emerald-400'
          : spot.rsi <= 40 ? 'text-red-400'
          : 'text-slate-200'
        }`}>
          {spot.rsi != null ? spot.rsi.toFixed(1) : '—'}
        </p>
        <p className="text-[10px] text-slate-500">
          {spot.rsi == null ? '' : spot.rsi >= 70 ? 'Overbought' : spot.rsi <= 30 ? 'Oversold' : spot.rsi >= 55 ? 'Bullish zone' : spot.rsi <= 45 ? 'Bearish zone' : 'Neutral'}
        </p>
      </div>
      {/* Premium trend */}
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500 font-semibold">Prem Trend</p>
        <p className={`text-xs font-bold ${premColor}`}>{premTrend}</p>
        <p className="text-[10px] text-slate-500">
          FV {futures.fairValuePct > 0 ? `+${futures.fairValuePct.toFixed(3)}%` : '—'} / {futures.daysToExpiry}d
        </p>
      </div>
    </div>
  );
});
IndicatorsStrip.displayName = 'IndicatorsStrip';

// ── Futures table ─────────────────────────────────────────────────────────────

interface FuturesTableProps {
  data: CompassIndex;
}

const FuturesTable = memo(({ data }: FuturesTableProps) => {
  const { spot, futures } = data;
  const rows: Array<{ label: string; abbrev: string; slot: FuturesSlot | null }> = [
    { label: 'CUR Month', abbrev: 'CUR', slot: futures.near },
    { label: 'NXT Month', abbrev: 'NXT', slot: futures.next },
    { label: 'FAR Month', abbrev: 'FAR', slot: futures.far  },
  ];

  return (
    <div className="rounded-xl border border-slate-700/40 overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-slate-800/60">
            <th className="py-1.5 px-2 text-left text-[9px] uppercase tracking-wider text-slate-500">Contract</th>
            <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-wider text-slate-500">LTP</th>
            <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-wider text-slate-500">vs Spot</th>
            <th className="py-1.5 px-2 text-right text-[9px] uppercase tracking-wider text-slate-500">Chg%</th>
          </tr>
        </thead>
        <tbody>
          {/* Spot row */}
          <tr className="bg-slate-900/30">
            <td className="py-1.5 px-2 font-semibold text-slate-400">Spot</td>
            <td className="py-1.5 px-2 text-right tabular-nums text-slate-200 imc-val">{fmt(spot.price)}</td>
            <td className="py-1.5 px-2 text-right text-slate-600">—</td>
            <td className={`py-1.5 px-2 text-right tabular-nums imc-val ${pctColor(spot.changePct)}`}>
              {fmtPct(spot.changePct)}
            </td>
          </tr>
          {rows.map(({ abbrev, slot }) => (
            slot ? (
              <tr key={abbrev} className="border-t border-slate-700/20 hover:bg-slate-700/10 transition-colors">
                <td className="py-1.5 px-2 font-semibold text-slate-300">
                  {abbrev}
                  <span className="ml-1 text-[9px] font-normal text-slate-600">
                    {slot.name.replace(/^(BANKNIFTY|NIFTY|SENSEX)/, '').replace('FUT', '')}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-slate-200 imc-val">{fmt(slot.price)}</td>
                <td className={`py-1.5 px-2 text-right tabular-nums font-semibold imc-val ${pctColor(slot.premiumPct)}`}>
                  {slot.premiumPct >= 0 ? '+' : ''}{slot.premiumPct.toFixed(3)}%
                </td>
                <td className={`py-1.5 px-2 text-right tabular-nums imc-val ${pctColor(slot.changePct)}`}>
                  {fmtPct(slot.changePct)}
                </td>
              </tr>
            ) : (
              <tr key={abbrev} className="border-t border-slate-700/20">
                <td className="py-1.5 px-2 text-slate-600 font-semibold">{abbrev}</td>
                <td colSpan={3} className="py-1.5 px-2 text-slate-700 italic text-center text-[10px]">Awaiting data…</td>
              </tr>
            )
          ))}
        </tbody>
      </table>

      {/* Bottom bar: fair-value context + futures leading badge */}
      <div className="flex items-center justify-between px-3 py-1.5
                      bg-slate-900/50 border-t border-slate-700/40 gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-slate-600 uppercase tracking-wider">Fair Value</span>
          <span className="text-[10px] font-semibold text-slate-400 imc-val">
            +{data.futures.fairValuePct.toFixed(3)}%
          </span>
          <span className="text-[9px] text-slate-700">({data.futures.daysToExpiry}d to exp)</span>
        </div>
        {data.futures.futuresLeading && (
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md
                           bg-cyan-500/15 border border-cyan-500/30 text-[9px]
                           font-bold text-cyan-400 uppercase tracking-wide imc-fut-leading">
            ⚡ FUT Leading
          </span>
        )}
      </div>
    </div>
  );
});
FuturesTable.displayName = 'FuturesTable';

// ── Index Compass Card ────────────────────────────────────────────────────────

interface IndexCardProps {
  data: CompassIndex;
}

const FACTOR_ORDER = [
  'vwap', 'ema_alignment', 'trend_structure',
  'futures_premium', 'rsi_momentum', 'volume_confirm',
] as const;

const IndexCompassCard = memo(({ data }: IndexCardProps) => {
  const [showBreakdown, setShowBreakdown] = useState(true);
  const pal = getPalette(data.direction);

  // ── Change-detection refs ──────────────────────────────────────────
  const cardRef = useRef<HTMLDivElement>(null);
  const dirBadgeRef = useRef<HTMLSpanElement>(null);
  const predBadgeRef = useRef<HTMLDivElement>(null);
  const prevDirection = useRef<CompassDirection>(data.direction);
  const prevPrediction = useRef<Prediction5m>(data.spot.prediction5m);

  useEffect(() => {
    // Flash card + badge ONLY when direction actually changes
    if (data.direction !== prevDirection.current) {
      cardRef.current?.classList.remove('imc-direction-changed');
      dirBadgeRef.current?.classList.remove('imc-badge-changed');
      void cardRef.current?.offsetWidth; // force reflow
      cardRef.current?.classList.add('imc-direction-changed');
      dirBadgeRef.current?.classList.add('imc-badge-changed');
      prevDirection.current = data.direction;
    }
    // Flash prediction badge ONLY when prediction changes
    if (data.spot.prediction5m !== prevPrediction.current) {
      predBadgeRef.current?.classList.remove('imc-pred-changed');
      void predBadgeRef.current?.offsetWidth;
      predBadgeRef.current?.classList.add('imc-pred-changed');
      prevPrediction.current = data.spot.prediction5m;
    }
  }, [data.direction, data.spot.prediction5m]);

  // Steady glow class based on current direction (no blinking)
  const glowCls = data.direction === 'BULLISH' ? 'imc-bullish'
    : data.direction === 'BEARISH' ? 'imc-bearish' : '';

  return (
    <div ref={cardRef} className={`
      relative rounded-2xl border border-slate-700/60
      bg-gradient-to-b ${pal.bg} to-slate-800/80
      ring-1 ${pal.ring} shadow-lg ${pal.glow}
      backdrop-blur-sm flex flex-col gap-3 p-4
      ${glowCls}
    `}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="rounded-lg border border-green-500/60 bg-green-950/30 px-2.5 py-1.5 text-lg font-bold text-white tracking-wide">{data.symbol}</span>
            {data.dataSource === 'LIVE' ? (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-400">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
                LIVE
              </span>
            ) : data.dataSource === 'MARKET_CLOSED' ? (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-slate-400 bg-slate-700/50 px-1.5 py-0.5 rounded">
                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                CLOSED
              </span>
            ) : (
              <span className="text-[10px] font-bold text-amber-500 uppercase">Spot Only</span>
            )}
            {data.spot.trendStructure !== 'RANGING' && (
              <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded
                              border tracking-wide
                              ${data.spot.trendStructure === 'HH_HL'
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                                : 'bg-red-500/10 text-red-400 border-red-500/30'}`}>
                {data.spot.trendStructure === 'HH_HL' ? 'HH/HL' : 'LH/LL'}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-white imc-val">{fmt(data.spot.price)}</span>
            <span className={`text-sm font-semibold tabular-nums imc-val ${pctColor(data.spot.changePct)}`}>
              {fmtPct(data.spot.changePct)}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 mt-0.5 italic leading-relaxed max-w-[260px]">
            {data.bias}
          </p>
        </div>

        {/* Direction badge */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span ref={dirBadgeRef} className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5
                            text-sm font-bold tracking-wide ${pal.badge}`}>
            <span className="text-base leading-none">{dirArrow(data.direction)}</span>
            {data.direction}
          </span>
          <div className="text-right">
            <span className="text-[10px] text-slate-400">Confidence</span>
            <span className={`ml-1.5 text-sm font-bold tabular-nums imc-val ${pal.text}`}>
              {data.confidence}%
            </span>
          </div>
        </div>
      </div>

      {/* ── Confidence bar ───────────────────────────────────────────────── */}
      <div className={`h-1.5 rounded-full bg-slate-700/60 overflow-hidden ${data.confidence >= 75 ? 'imc-high-conf' : ''}`}>
        <div
          className={`h-full rounded-full imc-bar ${pal.bar}`}
          style={{ width: `${data.confidence}%` }}
        />
      </div>

      {/* ── 5-min Forecast ───────────────────────────────────────────────── */}
      <div ref={predBadgeRef} className="rounded-xl bg-slate-900/50 border border-slate-700/40 px-4 py-3 space-y-3">
        <div>
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-2">5-Min Prediction</p>
          <p className="text-[9px] text-slate-600">EMA · RSI · VWAP · Premium</p>
        </div>

        {/* Dual Confidence Comparison */}
        <div className="grid grid-cols-2 gap-2">
          {/* Index (Spot) Section */}
          <div className="space-y-2">
            <div className="text-center">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1">Index</p>
              <Pred5mBadge pred={data.spot.prediction5m} conf={data.spot.prediction5mConf} />
            </div>
            
            {/* Predicted vs Actual for Index */}
            <div className="space-y-1.5">
              <div className="flex flex-col bg-slate-800/40 rounded px-2 py-1">
                <span className="text-[8px] text-slate-500 font-bold">CONFIDENCE</span>
                <span className="text-[11px] font-black text-emerald-300 imc-val">{data.spot.prediction5mConf}%</span>
                <div className="w-full h-1.5 rounded-full bg-slate-700/50 overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 imc-bar rounded-full"
                    style={{ width: `${Math.min(100, data.spot.prediction5mConf)}%` }}
                  />
                </div>
              </div>

              <div className="flex flex-col bg-slate-800/40 rounded px-2 py-1">
                <span className="text-[8px] text-slate-500 font-bold">Actual</span>
                <span className="text-[11px] font-black text-teal-300">
                  {Math.round(
                    Math.abs(data.spot.rsi ?? 50 - 50) * 0.4 +
                    Math.max(0, Math.abs(data.spot.ema9 ?? 0 - data.spot.ema20 ?? 0)) * 1.2 +
                    Math.abs(data.spot.changePct ?? 0) * 10
                  )}%
                </span>
                <div className="w-full h-1.5 rounded-full bg-slate-700/50 overflow-hidden mt-0.5">
                  <div
                    className="h-full bg-gradient-to-r from-teal-500 to-teal-400 imc-bar rounded-full"
                    style={{
                      width: `${Math.min(100, Math.round(
                        Math.abs(data.spot.rsi ?? 50 - 50) * 0.4 +
                        Math.max(0, Math.abs(data.spot.ema9 ?? 0 - data.spot.ema20 ?? 0)) * 1.2 +
                        Math.abs(data.spot.changePct ?? 0) * 10
                      ))}%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Index Momentum Indicators */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] bg-slate-800/30 rounded px-1.5 py-1">
                <span className="text-slate-500 font-bold">EMA Momentum</span>
                <span className={`font-bold imc-val ${
                  (data.spot.ema9 ?? 0) > (data.spot.ema20 ?? 0) ? 'text-emerald-400' :
                  (data.spot.ema9 ?? 0) < (data.spot.ema20 ?? 0) ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {(data.spot.ema9 ?? 0) > (data.spot.ema20 ?? 0) ? '▲' : (data.spot.ema9 ?? 0) < (data.spot.ema20 ?? 0) ? '▼' : '→'}
                </span>
              </div>
              <div className="flex justify-between items-center text-[8px] bg-slate-800/30 rounded px-1.5 py-1">
                <span className="text-slate-500 font-bold">RSI Signal</span>
                <span className={`font-bold imc-val ${
                  (data.spot.rsi ?? 50) > 65 ? 'text-emerald-400' :
                  (data.spot.rsi ?? 50) < 35 ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {(data.spot.rsi ?? 50).toFixed(0)}
                </span>
              </div>
            </div>
          </div>

          {/* Futures Section */}
          <div className="space-y-2">
            <div className="text-center">
              <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1">Futures</p>
              <Pred5mBadge pred={data.futures.prediction5mFut} />
            </div>

            {/* Premium Trend Indicator */}
            <div className="space-y-1.5">
              <div className="flex flex-col bg-slate-800/40 rounded px-2 py-1">
                <span className="text-[8px] text-slate-500 font-bold">Premium Trend</span>
                <span className={`text-[10px] font-bold imc-val ${
                  data.futures.premiumTrend === 'EXPANDING' ? 'text-emerald-400' :
                  data.futures.premiumTrend === 'CONTRACTING' ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {data.futures.premiumTrend === 'EXPANDING' ? '📈' : 
                   data.futures.premiumTrend === 'CONTRACTING' ? '📉' : '⚖️'} {data.futures.premiumTrend}
                </span>
              </div>

              <div className="flex flex-col bg-slate-800/40 rounded px-2 py-1">
                <span className="text-[8px] text-slate-500 font-bold">Current Premium</span>
                <span className={`text-[11px] font-black imc-val ${
                  (data.futures.near?.premium ?? 0) > 0 ? 'text-emerald-400' :
                  (data.futures.near?.premium ?? 0) < 0 ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {(data.futures.near?.premium ?? 0).toFixed(2)} ({(data.futures.near?.premiumPct ?? 0).toFixed(3)}%)
                </span>
              </div>
            </div>

            {/* Futures Momentum Indicators */}
            <div className="space-y-1">
              <div className="flex justify-between items-center text-[8px] bg-slate-800/30 rounded px-1.5 py-1">
                <span className="text-slate-500 font-bold">CUR Change</span>
                <span className={`font-bold imc-val ${
                  (data.futures.near?.changePct ?? 0) > 0 ? 'text-emerald-400' :
                  (data.futures.near?.changePct ?? 0) < 0 ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {(data.futures.near?.changePct ?? 0) > 0 ? '▲' : (data.futures.near?.changePct ?? 0) < 0 ? '▼' : '→'} {Math.abs(data.futures.near?.changePct ?? 0).toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between items-center text-[8px] bg-slate-800/30 rounded px-1.5 py-1">
                <span className="text-slate-500 font-bold">Spot-Fut Gap</span>
                <span className={`font-bold imc-val ${
                  (data.spot.changePct ?? 0) > (data.futures.near?.changePct ?? 0) ? 'text-emerald-400' :
                  (data.spot.changePct ?? 0) < (data.futures.near?.changePct ?? 0) ? 'text-red-400' :
                  'text-amber-400'
                }`}>
                  {((data.spot.changePct ?? 0) - (data.futures.near?.changePct ?? 0)).toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Movement Probability Bar */}
        <div className="space-y-2 border-t border-slate-700/30 pt-2">
          <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Movement Probability</p>
          <div className="flex items-center gap-0.5 h-6 rounded-md overflow-hidden bg-slate-950/50 border border-slate-700/30">
            {/* Bullish */}
            <div
              className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 imc-bar flex items-center justify-center min-w-[2px]"
              style={{
                width: `${Math.max(5, Math.min(95, Math.round(
                  Math.max(0, data.spot.ema9 ?? 0 - data.spot.ema20 ?? 0) * 2 +
                  Math.max(0, (data.spot.rsi ?? 50) - 50) * 0.5 +
                  Math.max(0, data.spot.changePct ?? 0) * 10
                )))}%`,
              }}
            >
              <span className="text-[8px] font-bold text-white px-1 truncate whitespace-nowrap">
                {Math.round(
                  Math.max(0, data.spot.ema9 ?? 0 - data.spot.ema20 ?? 0) * 2 +
                  Math.max(0, (data.spot.rsi ?? 50) - 50) * 0.5 +
                  Math.max(0, data.spot.changePct ?? 0) * 10
                )}%↑
              </span>
            </div>
            {/* Bearish */}
            <div
              className="h-full bg-gradient-to-l from-red-600 to-red-500 imc-bar flex items-center justify-center ml-auto min-w-[2px]"
              style={{
                width: `${Math.max(5, Math.min(95, Math.round(
                  Math.max(0, (data.spot.ema20 ?? 0) - (data.spot.ema9 ?? 0)) * 2 +
                  Math.max(0, 50 - (data.spot.rsi ?? 50)) * 0.5 +
                  Math.max(0, -(data.spot.changePct ?? 0)) * 10
                )))}%`,
              }}
            >
              <span className="text-[8px] font-bold text-white px-1 truncate whitespace-nowrap">
                {Math.round(
                  Math.max(0, (data.spot.ema20 ?? 0) - (data.spot.ema9 ?? 0)) * 2 +
                  Math.max(0, 50 - (data.spot.rsi ?? 50)) * 0.5 +
                  Math.max(0, -(data.spot.changePct ?? 0)) * 10
                )}%↓
              </span>
            </div>
          </div>
        </div>

        {/* Early Signal Detection */}
        {(Math.abs(data.spot.changePct ?? 0) > 0.3 || Math.abs(data.spot.rsi ?? 50 - 50) > 20) && (
          <div className="pt-2 border-t border-slate-700/30">
            <span className="text-[9px] font-bold text-amber-400 uppercase tracking-wide">
              ⚡ {Math.abs(data.spot.rsi ?? 50 - 50) > 20 ? 'Momentum Shift' : 'Price Acceleration'} Detected
            </span>
          </div>
        )}
      </div>

      {/* ── Key Indicators ───────────────────────────────────────────────── */}
      <IndicatorsStrip data={data} />

      {/* ── Signal Breakdown ─────────────────────────────────────────────── */}
      <div className="rounded-xl bg-slate-900/40 border border-slate-700/40 overflow-hidden">
        <button
          onClick={() => setShowBreakdown(v => !v)}
          className="w-full flex items-center justify-between px-3 py-1.5
                     bg-slate-800/50 hover:bg-slate-700/50 transition-colors"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Signal Breakdown (6 Factors)
          </span>
          <span className="text-[10px] text-slate-500">{showBreakdown ? '▲' : '▼'}</span>
        </button>

        {showBreakdown && (
          <div className="px-3 pb-2">
            {FACTOR_ORDER.map(key => {
              const factor = (data.signals as any)[key] as SignalFactor | undefined;
              if (!factor) return null;
              return <SignalRow key={key} factorKey={key} factor={factor} />;
            })}
            {/* Weighted total */}
            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-slate-700/40">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                Weighted Score
              </span>
              <span className={`text-xs font-bold tabular-nums imc-val ${pal.text}`}>
                {data.rawScore >= 0 ? '+' : ''}{data.rawScore.toFixed(4)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Futures table ────────────────────────────────────────────────── */}
      <FuturesTable data={data} />
    </div>
  );
});
IndexCompassCard.displayName = 'IndexCompassCard';

// ── Skeleton ──────────────────────────────────────────────────────────────────

const SkeletonCard = memo(() => (
  <div className="rounded-2xl border border-slate-700/50 bg-slate-800/50 p-4 flex flex-col gap-3 animate-pulse">
    <div className="flex justify-between">
      <div className="flex flex-col gap-2">
        <div className="h-4 w-20 bg-slate-700 rounded" />
        <div className="h-7 w-32 bg-slate-700 rounded" />
        <div className="h-3 w-48 bg-slate-700/50 rounded" />
      </div>
      <div className="h-9 w-28 bg-slate-700 rounded-xl" />
    </div>
    <div className="h-1.5 w-full bg-slate-700 rounded-full" />
    <div className="grid grid-cols-3 gap-2">
      {[0,1,2].map(i => <div key={i} className="h-14 bg-slate-700/40 rounded-xl" />)}
    </div>
    <div className="h-24 bg-slate-700/30 rounded-xl" />
    <div className="h-28 bg-slate-700/30 rounded-xl" />
  </div>
));
SkeletonCard.displayName = 'SkeletonCard';

// ── Summary strip (header) ────────────────────────────────────────────────────

const SummaryStrip = memo(({ items }: { items: CompassIndex[] }) => (
  <div className="flex flex-wrap gap-2">
    {items.map(d => {
      const pal = getPalette(d.direction);
      return (
        <span key={d.symbol}
          className={`inline-flex items-center gap-1.5 rounded-lg border
                      px-2.5 py-1 text-xs font-semibold ${pal.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${pal.dot}`} />
          {d.symbol}
          <span>{dirArrow(d.direction)}</span>
          <span>{d.direction}</span>
          <span className="opacity-50">·</span>
          <span className="imc-val">{d.confidence}%</span>
        </span>
      );
    })}
  </div>
));
SummaryStrip.displayName = 'SummaryStrip';

// ── Main Export ───────────────────────────────────────────────────────────────

export const InstitutionalCompass = memo(() => {
  const { compassData, isConnected, lastUpdate } = useCompassSocket();
  const indices = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
  const loaded = indices.filter(s => compassData[s] !== null).map(s => compassData[s]!);

  const allClosed = loaded.length > 0 && loaded.every(d => d.dataSource === 'MARKET_CLOSED');
  const anyLive   = loaded.some(d => d.dataSource === 'LIVE');

  const headerBadge = anyLive
    ? { cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'LIVE', pulse: true }
    : allClosed
    ? { cls: 'bg-slate-700/50 text-slate-400 border-slate-600/30', label: 'MARKET CLOSED', pulse: false }
    : isConnected
    ? { cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'CONNECTED', pulse: false }
    : { cls: 'bg-slate-700/50 text-slate-500 border-slate-600/30', label: 'OFFLINE', pulse: false };

  const ts = lastUpdate
    ? new Date(lastUpdate).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : null;

  // Determine dominant section glow based on NIFTY direction (no blinking)
  const niftyDir = compassData.NIFTY?.direction;
  const sectionGlow = niftyDir === 'BULLISH' ? 'imc-section-bullish'
    : niftyDir === 'BEARISH' ? 'imc-section-bearish' : '';

  return (
    <section className={`rounded-3xl border border-slate-700/50
                        bg-gradient-to-br from-slate-800/80 to-slate-900/90
                        p-5 shadow-2xl backdrop-blur-sm ${sectionGlow}`}>

      {/* ── Section header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div>
          <div className="relative rounded-xl bg-blue-500/[0.06] border border-emerald-400/25 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm shadow-blue-500/20">
            <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-blue-500/30 to-transparent" />
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <span className="w-[3px] h-7 sm:h-9 rounded-full bg-gradient-to-b from-blue-400 to-blue-600 shrink-0 shadow-sm shadow-blue-500/20" />
              <h2 className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug">
                🧭 Institutional Market Compass
              </h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5
                              text-[10px] font-bold uppercase tracking-wider border
                              ${headerBadge.cls}`}>
              {headerBadge.pulse ? (
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-500" />
                </span>
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current opacity-60" />
              )}
              {headerBadge.label}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-blue-300 opacity-80 mt-1.5 ml-[15px] sm:ml-[17px] font-semibold tracking-wide leading-relaxed">
            AI-Powered Index &amp; Futures Direction Engine
            <span className="ml-1.5 sm:ml-2 text-[10px] sm:text-[11px] text-blue-400/70 font-medium">
              VWAP · EMA · Swing · Futures Premium · RSI · Volume
            </span>
          </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {ts && <span className="hidden">Updated {ts}</span>}
          {loaded.length > 0 && <SummaryStrip items={loaded} />}
        </div>
      </div>

      {/* ── 3-column grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {indices.map(sym => (
          compassData[sym]
            ? <IndexCompassCard key={sym} data={compassData[sym]!} />
            : <SkeletonCard key={sym} />
        ))}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <p className="mt-4 text-center text-[10px] text-slate-700">
        6-factor weighted algorithm · 5-min candle intelligence ·
        Cost-of-carry fair value · Premium trend buffer (4 min) · Updates every 2 s
      </p>
    </section>
  );
});
InstitutionalCompass.displayName = 'InstitutionalCompass';

export default InstitutionalCompass;

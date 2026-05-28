'use client';

import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketData, MarketTick } from '@/hooks/useMarketSocket';
import { useTradingIntelligence, TIEData, TIESignal, TIESymbol, TIEBias, TIEAlertTone } from '@/hooks/useTradingIntelligence';

/* ── Visual config ──────────────────────────────────────────────────────── */

const ORDER: TIESymbol[] = ['NIFTY', 'BANKNIFTY', 'SENSEX'];

const SYMBOL_META: Record<TIESymbol, { name: string; badge: string; color: string }> = {
  NIFTY:     { name: 'NIFTY 50',  badge: 'N', color: '#8b5cf6' },
  BANKNIFTY: { name: 'BANKNIFTY', badge: 'B', color: '#10b981' },
  SENSEX:    { name: 'SENSEX',    badge: 'S', color: '#3b82f6' },
};

const SIGNAL_STYLE: Record<TIESignal, { label: string; color: string; arrow: string; tone: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: '#10b981', arrow: '↑', tone: 'Very Strong Bullish' },
  BUY:         { label: 'BUY',         color: '#22c55e', arrow: '↑', tone: 'Bullish' },
  NEUTRAL:     { label: 'NEUTRAL',     color: '#f59e0b', arrow: '→', tone: 'Sideways / Neutral' },
  SELL:        { label: 'SELL',        color: '#f87171', arrow: '↓', tone: 'Bearish' },
  STRONG_SELL: { label: 'STRONG SELL', color: '#ef4444', arrow: '↓', tone: 'Very Strong Bearish' },
};

const TILE_LABELS: Array<keyof TIEData['tiles']> = ['DELTA', 'GAMMA', 'VEGA', 'THETA', 'RHO', 'VANNA'];
const SPARKLINE_MAX = 60;

const ALERT_TONE: Record<TIEAlertTone, { bg: string; border: string; text: string; dot: string }> = {
  bull: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', text: 'text-emerald-300', dot: 'bg-emerald-400' },
  bear: { bg: 'bg-red-500/10',     border: 'border-red-500/30',     text: 'text-red-300',     dot: 'bg-red-400' },
  warn: { bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   text: 'text-amber-300',   dot: 'bg-amber-400' },
  info: { bg: 'bg-sky-500/10',     border: 'border-sky-500/30',     text: 'text-sky-300',     dot: 'bg-sky-400' },
};

/* ── Sparkline ──────────────────────────────────────────────────────────── */

const Sparkline = memo(function Sparkline({ values, color }: { values: number[]; color: string }) {
  const { path, area, gradId } = useMemo(() => {
    if (!values || values.length < 2) return { path: '', area: '', gradId: '' };
    const w = 220, h = 56, pad = 3;
    let min = Infinity, max = -Infinity;
    for (const v of values) { if (v < min) min = v; if (v > max) max = v; }
    const span = Math.max(1e-6, max - min);
    const step = (w - pad * 2) / (values.length - 1);
    let line = '';
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < values.length; i++) {
      const x = pad + i * step;
      const y = pad + (1 - (values[i] - min) / span) * (h - pad * 2);
      pts.push([x, y]);
      line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)} `;
    }
    const first = pts[0], last = pts[pts.length - 1];
    const fill = `${line}L${last[0].toFixed(1)},${(h - pad).toFixed(1)} L${first[0].toFixed(1)},${(h - pad).toFixed(1)} Z`;
    const id = `tieSpark-${color.replace('#', '')}`;
    return { path: line.trim(), area: fill, gradId: id };
  }, [values, color]);

  if (!path) {
    return (
      <div className="flex items-center justify-center h-12 sm:h-14 rounded-md bg-slate-900/40 border border-slate-800/40">
        <span className="text-[10px] text-slate-500 italic tracking-wide">awaiting feed…</span>
      </div>
    );
  }
  return (
    <svg viewBox="0 0 220 56" className="w-full h-12 sm:h-14" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} stroke="none" />
      <path d={path} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

/* ── Strength bars ──────────────────────────────────────────────────────── */

function StrengthBars({ strength, color }: { strength: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(i => (
        <span
          key={i}
          className="rounded-sm transition-all"
          style={{
            width: 14,
            height: i <= strength ? 8 : 5,
            background: i <= strength ? color : 'rgba(148,163,184,0.18)',
            boxShadow: i <= strength ? `0 0 8px ${color}66` : 'none',
          }}
        />
      ))}
    </div>
  );
}

/* ── Greek tile ─────────────────────────────────────────────────────────── */

const GreekTile = memo(function GreekTile({ label, value, bias }: { label: string; value: number; bias: TIEBias }) {
  const tone =
    bias === 'Buy'
      ? { ring: 'ring-emerald-500/20', text: 'text-emerald-400', dot: 'bg-emerald-400' }
      : bias === 'Sell'
        ? { ring: 'ring-red-500/20', text: 'text-red-400', dot: 'bg-red-400' }
        : { ring: 'ring-amber-500/20', text: 'text-amber-400', dot: 'bg-amber-400' };
  const valueClass = bias === 'Sell' ? 'text-red-300' : 'text-slate-50';
  const abs = Math.abs(value);
  const decimals = abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return (
    <div className={`flex flex-col gap-1 px-2.5 py-2 rounded-lg bg-slate-900/40 ring-1 ${tone.ring} hover:bg-slate-900/60 transition-colors`}>
      <div className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-slate-500 font-bold">{label}</div>
      <div className={`text-base sm:text-lg lg:text-xl font-mono font-semibold tabular-nums leading-none ${valueClass}`}>
        {Number.isFinite(value) ? (value < 0 ? '-' : '') + abs.toFixed(decimals) : '—'}
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`w-1 h-1 rounded-full ${tone.dot}`} />
        <span className={`text-[10px] sm:text-[11px] font-semibold ${tone.text}`}>{bias}</span>
      </div>
    </div>
  );
});

/* ── Index card ─────────────────────────────────────────────────────────── */

interface CardProps {
  symbol: TIESymbol;
  ai: TIEData | undefined;
  tick: MarketTick | null;
  livePrice: number;
  liveSparkline: number[];
}

const IndexCard = memo(function IndexCard({ symbol, ai, tick, livePrice, liveSparkline }: CardProps) {
  const meta = SYMBOL_META[symbol];

  const price = livePrice > 0 ? livePrice : (ai?.price ?? tick?.price ?? 0);
  const change = tick?.change ?? ai?.change ?? 0;
  const changePercent = tick?.changePercent ?? ai?.changePercent ?? 0;

  if (price <= 0 && !ai) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-slate-800/60 bg-slate-900/40 p-5 text-center text-xs text-slate-500">
        <span className="inline-block w-2 h-2 mr-2 rounded-full bg-slate-600 animate-pulse" />
        Awaiting {meta.name} feed…
      </div>
    );
  }

  const sig = (ai?.signal ?? 'NEUTRAL') as TIESignal;
  const sigStyle = SIGNAL_STYLE[sig];
  const strength = ai?.signalStrength ?? 1;
  const changeUp = changePercent >= 0;
  const sparkColor = changeUp ? '#10b981' : '#ef4444';
  const sparkValues = liveSparkline.length > 1 ? liveSparkline : (ai?.sparkline ?? []);

  return (
    <div
      className="relative overflow-hidden rounded-xl border border-slate-800/70 bg-gradient-to-br from-[#0f1626]/95 via-[#0d1422]/95 to-[#0a1120]/95 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] hover:border-slate-700 hover:shadow-[0_10px_32px_-12px_rgba(0,0,0,0.7)] transition-all duration-300"
    >
      {/* Left accent stripe (symbol color) */}
      <span
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${meta.color}, ${meta.color}33)` }}
      />
      {/* Soft glow corner */}
      <span
        className="pointer-events-none absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-[0.08]"
        style={{ background: meta.color }}
      />

      <div className="relative px-4 sm:px-5 lg:px-6 py-4 sm:py-5">
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr_1fr] gap-3 lg:gap-5 items-center">
          {/* Identity + price */}
          <div
            className="rounded-xl border px-4 py-3 shadow-inner"
            style={{
              borderColor: `${meta.color}40`,
              background: `linear-gradient(135deg, ${meta.color}14, ${meta.color}05)`,
              boxShadow: `0 0 24px -10px ${meta.color}55 inset`,
            }}
          >
            <div className="text-base sm:text-lg lg:text-xl uppercase tracking-[0.2em] font-extrabold leading-tight" style={{ color: meta.color }}>
              {meta.name}
            </div>
            <div className="flex items-baseline gap-2 flex-wrap mt-1.5">
              <span className="text-2xl sm:text-3xl font-mono font-bold text-slate-50 leading-tight tabular-nums">
                {price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span
                className={`text-[11px] sm:text-xs font-mono font-semibold tabular-nums px-1.5 py-0.5 rounded ${
                  changeUp ? 'text-emerald-300 bg-emerald-500/10' : 'text-red-300 bg-red-500/10'
                }`}
              >
                {changeUp ? '▲' : '▼'} {changeUp ? '+' : ''}{change.toFixed(2)} ({changeUp ? '+' : ''}{changePercent.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Sparkline */}
          <div className="hidden lg:block px-2">
            <Sparkline values={sparkValues} color={sparkColor} />
          </div>

          {/* Signal + strength */}
          <div className="flex flex-col items-start lg:items-end gap-2">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
              style={{ borderColor: `${sigStyle.color}55`, background: `${sigStyle.color}11` }}
            >
              <span className="text-base sm:text-lg font-bold tracking-wide" style={{ color: sigStyle.color }}>{sigStyle.label}</span>
              <span className="text-lg sm:text-xl font-bold" style={{ color: sigStyle.color }}>{sigStyle.arrow}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs text-slate-400 tracking-wider uppercase font-semibold">Strength</span>
              <StrengthBars strength={strength} color={sigStyle.color} />
            </div>
            {ai && (
              <div className="text-[10px] text-slate-500 font-mono">
                <span className="text-slate-400">Conf</span> {ai.confidence.toFixed(0)}%
                <span className="mx-1.5 text-slate-700">·</span>
                <span className="text-slate-400">LSTM</span> {ai.lstmReturnPred > 0 ? '+' : ''}{ai.lstmReturnPred.toFixed(2)}%
              </div>
            )}
          </div>
        </div>

        <div className="lg:hidden mt-3">
          <Sparkline values={sparkValues} color={sparkColor} />
        </div>

        {/* Greeks divider */}
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-slate-800/80" />
          </div>
          <div className="relative flex justify-start">
            <span className="bg-[#0d1422] pr-3 text-[10px] uppercase tracking-[0.2em] text-slate-500 font-bold">Greeks</span>
          </div>
        </div>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {TILE_LABELS.map(label => {
            const t = ai?.tiles?.[label];
            return (
              <GreekTile
                key={label}
                label={label}
                value={t?.value ?? 0}
                bias={t?.bias ?? 'Neutral'}
              />
            );
          })}
        </div>

        {ai?.intelligence && <IntelligenceRow intel={ai.intelligence} />}
      </div>
    </div>
  );
});

/* ── Intelligence strip (SMC + traps + meters) ──────────────────────────── */

const STRUCTURE_STYLE: Record<string, { label: string; color: string }> = {
  BOS_UP:     { label: 'BOS ↑',    color: '#10b981' },
  BOS_DOWN:   { label: 'BOS ↓',    color: '#ef4444' },
  CHoCH_UP:   { label: 'CHoCH ↑',  color: '#22c55e' },
  CHoCH_DOWN: { label: 'CHoCH ↓',  color: '#f87171' },
  RANGE:      { label: 'RANGE',    color: '#64748b' },
};

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold truncate">{label}</span>
        <span className="text-[10px] sm:text-[11px] font-mono text-slate-200 tabular-nums">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1 rounded-full bg-slate-800/80 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pct}%`, background: color, boxShadow: `0 0 6px ${color}66` }} />
      </div>
    </div>
  );
}

const IntelligenceRow = memo(function IntelligenceRow({ intel }: { intel: NonNullable<TIEData['intelligence']> }) {
  const struct = STRUCTURE_STYLE[intel.structure] || STRUCTURE_STYLE.RANGE;
  return (
    <div className="mt-3 sm:mt-4 border-t border-slate-800/70 pt-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-400 font-semibold">SMC Structure</span>
          <span className="text-xs sm:text-sm font-bold" style={{ color: struct.color }}>{struct.label}</span>
        </div>
        <Meter label="Liquidity Trap" value={intel.liquidityTrap} color="#f59e0b" />
        <Meter label="Fake Breakout"  value={intel.fakeBreakout}  color="#fb7185" />
        <Meter label="Volume Spike"   value={intel.volumeSpike}   color="#38bdf8" />
        <Meter label="Institutional"  value={intel.institutional} color="#a78bfa" />
      </div>
      {intel.alerts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {intel.alerts.map((a, i) => {
            const tone = ALERT_TONE[a.tone];
            return (
              <div key={`${a.kind}-${i}`} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${tone.bg} ${tone.border}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tone.dot} animate-pulse`} />
                <span className={`text-[10px] sm:text-[11px] font-semibold ${tone.text}`}>{a.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});

/* ── Main section ───────────────────────────────────────────────────────── */

interface Props {
  marketData: MarketData;
}

export default function TradingIntelligenceEngine({ marketData }: Props) {
  const { data: aiData, isConnected: aiConnected, lastUpdate: aiLastUpdate } = useTradingIntelligence();

  // Live sparkline ring buffer per symbol, fed by marketData ticks (incremental, no recompute).
  const sparksRef = useRef<Record<TIESymbol, number[]>>({ NIFTY: [], BANKNIFTY: [], SENSEX: [] });
  const lastPriceRef = useRef<Record<TIESymbol, number>>({ NIFTY: 0, BANKNIFTY: 0, SENSEX: 0 });
  const [, forceRender] = useState(0);

  useEffect(() => {
    let changed = false;
    for (const s of ORDER) {
      const p = marketData[s]?.price;
      if (typeof p === 'number' && p > 0 && p !== lastPriceRef.current[s]) {
        const arr = sparksRef.current[s];
        arr.push(p);
        if (arr.length > SPARKLINE_MAX) arr.splice(0, arr.length - SPARKLINE_MAX);
        lastPriceRef.current[s] = p;
        changed = true;
      }
    }
    if (changed) forceRender(t => t + 1);
  }, [marketData]);

  const statuses = ORDER.map(s => marketData[s]?.status || aiData[s]?.status);
  const isLive = statuses.some(s => s === 'LIVE');
  const hasFeed = statuses.some(s => !!s && s !== 'OFFLINE');
  const connectionLive = aiConnected || hasFeed;

  const latestTickTs = ORDER
    .map(s => marketData[s]?.timestamp)
    .filter(Boolean)
    .sort()
    .pop();
  const tickStamp = latestTickTs
    ? new Date(latestTickTs).toLocaleTimeString('en-IN', { hour12: false })
    : aiLastUpdate
      ? new Date(aiLastUpdate).toLocaleTimeString('en-IN', { hour12: false })
      : '--:--:--';

  const statusLabel = isLive ? 'LIVE' : connectionLive ? 'CLOSED' : 'OFFLINE';
  const statusSub = isLive ? 'Market Open' : connectionLive ? 'Market Closed' : 'Disconnected';
  const statusColor = isLive ? 'text-emerald-400' : 'text-slate-400';
  const statusDot = isLive ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500';

  return (
    <section className="relative overflow-hidden rounded-2xl border border-slate-800/70 bg-gradient-to-br from-[#0b1220] via-[#0a0f1c] to-[#070b15] shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)]">
      {/* Decorative top gradient */}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
      <span className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full bg-violet-500/[0.06] blur-3xl" />
      <span className="pointer-events-none absolute -bottom-24 -right-24 w-72 h-72 rounded-full bg-emerald-500/[0.05] blur-3xl" />

      <div className="relative p-4 sm:p-5 lg:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4 sm:mb-5">
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-violet-500/25 to-fuchsia-500/15 border border-violet-500/40 shadow-[0_0_20px_-4px_rgba(139,92,246,0.45)]">
              <span className="text-lg sm:text-xl">⚡</span>
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl lg:text-[26px] font-extrabold tracking-tight leading-tight">
                <span className="bg-gradient-to-r from-slate-50 via-slate-100 to-slate-300 bg-clip-text text-transparent">
                  GREEKS OVERVIEW
                </span>
              </h2>
              <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5 tracking-wide">
                Real-time Greeks analysis · AI-powered buy / sell signals
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
            <div className="flex flex-col px-3 py-1.5 rounded-lg bg-slate-900/60 backdrop-blur border border-slate-800/70 min-w-[112px] shadow-inner">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
                <span className={`text-[11px] font-bold tracking-wider ${statusColor}`}>{statusLabel}</span>
              </div>
              <span className="text-[10px] text-slate-500 mt-0.5">{statusSub}</span>
            </div>
            <div className="flex flex-col px-3 py-1.5 rounded-lg bg-slate-900/60 backdrop-blur border border-slate-800/70 shadow-inner">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Last Update</span>
              <span className="text-[11px] font-mono text-slate-200 tabular-nums mt-0.5">{tickStamp}</span>
            </div>
          </div>
        </div>

        {/* Cards */}
        <div className="flex flex-col gap-3 sm:gap-4">
          {ORDER.map(sym => (
            <IndexCard
              key={sym}
              symbol={sym}
              ai={aiData[sym]}
              tick={marketData[sym]}
              livePrice={lastPriceRef.current[sym]}
              liveSparkline={sparksRef.current[sym]}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

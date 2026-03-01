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

type ProfileStyle = { bg: string; text: string; label: string; icon: string };

const OI_PROFILE: Record<OIProfile, ProfileStyle> = {
  LONG_BUILDUP:     { bg: 'bg-emerald-500/20 border-emerald-500/40', text: 'text-emerald-200', label: 'Long Buildup',      icon: '📈' },
  SHORT_COVERING:   { bg: 'bg-lime-500/15    border-lime-500/30',    text: 'text-lime-300',    label: 'Short Covering',    icon: '🔄' },
  SHORT_BUILDUP:    { bg: 'bg-red-500/20     border-red-500/40',     text: 'text-red-200',     label: 'Short Buildup',     icon: '📉' },
  LONG_UNWINDING:   { bg: 'bg-orange-500/15  border-orange-500/30',  text: 'text-orange-300',  label: 'Long Unwinding',    icon: '⚠️' },
  NEUTRAL:          { bg: 'bg-slate-700/30   border-slate-600/30',   text: 'text-slate-400',   label: 'No Clear Pattern',  icon: '⚖️' },
  PCR_EXTREME_BULL: { bg: 'bg-cyan-500/20    border-cyan-400/50',    text: 'text-cyan-200',    label: 'Extreme Put Wall',  icon: '🛡️' },
  PCR_EXTREME_BEAR: { bg: 'bg-amber-500/20   border-amber-400/40',   text: 'text-amber-200',   label: 'Extreme Call Wall', icon: '🧱' },
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

// ── Index card ────────────────────────────────────────────────────────────────

const IndexCard = memo(({ data, index }: { data: LiquidityIndex | null; index: string }) => {
  // ── Skeleton ──────────────────────────────────────────────────────────────
  if (!data) {
    return (
      <div className="flex-1 min-w-[260px] rounded-xl bg-[#1a2332] border border-slate-700/40 overflow-hidden">
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

  return (
    <div className={`flex-1 min-w-[260px] rounded-xl bg-[#1a2332] border border-slate-700/40
                     ring-1 ${pal.ring} shadow-lg ${pal.glow} overflow-hidden
                     transition-all duration-300`}>

      {/* ── OI Profile banner ──────────────────────────────────────────────── */}
      <div className={`px-3 py-2 border-b flex items-center justify-between ${oiStyle.bg}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-sm">{oiStyle.icon}</span>
          <span className={`text-[11px] font-black tracking-wider uppercase ${oiStyle.text}`}>
            {oiStyle.label}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-slate-500 font-mono">
            {data.dataSource === 'MARKET_CLOSED' ? '🕐 Last' : '⚡ Live'}
          </span>
        </div>
      </div>

      <div className="p-3.5 space-y-3">

        {/* ── Header: symbol + price ──────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
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
          {/* Main direction badge */}
          <div className={`rounded-lg border px-2 py-1 text-center ${pal.badge}`}>
            <div className="text-[10px] font-black tracking-widest leading-none">
              {data.direction === 'BULLISH' ? '▲' : data.direction === 'BEARISH' ? '▼' : '●'}
              &nbsp;{data.direction}
            </div>
            <div className={`text-[13px] font-black leading-none mt-0.5 ${pal.text}`}>
              {data.confidence}%
            </div>
            <div className="text-[8px] font-normal text-slate-500 leading-none mt-0.5 tracking-wide">
              Confidence
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <ConfidenceBar confidence={data.confidence} barColor={pal.bar} />

        {/* ── PCR row ─────────────────────────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/30 px-3 py-2">
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
          <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-500">
            <span className="text-cyan-600">PUT {fmtOI(data.metrics.putOI)}</span>
            <span className="text-slate-600">/</span>
            <span className="text-orange-600">CALL {fmtOI(data.metrics.callOI)}</span>
            {data.metrics.vwapDev != null && (
              <>
                <span className="text-slate-600 ml-1">·</span>
                <span className={data.metrics.vwapDev >= 0 ? 'text-cyan-600' : 'text-orange-600'}>
                  VWAP {data.metrics.vwapDev >= 0 ? '+' : ''}{data.metrics.vwapDev.toFixed(2)}%
                </span>
              </>
            )}
          </div>
        </div>

        {/* ── 5-Min prediction (very prominent) ───────────────────────────── */}
        <div className="rounded-lg bg-slate-800/60 border border-slate-700/30 px-3 py-2.5">
          <div className="text-[9px] text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
            ⚡ 5-Min Liquidity Prediction
          </div>
          <div className="flex items-center justify-between">
            <Pred5mBadge pred={data.prediction5m} />
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[11px] font-black text-white">
                {data.pred5mConf}%
                <span className="text-[9px] font-normal text-slate-500 ml-0.5">Confidence</span>
              </span>
              <div className="w-16 h-1 rounded-full bg-slate-700/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
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
  const statusDot = isConnected ? 'bg-cyan-400 shadow-cyan-400/70 shadow-sm animate-pulse' : 'bg-slate-600';
  const statusLabel = isConnected ? 'LIVE' : 'OFFLINE';
  const statusColor = isConnected ? 'text-cyan-400' : 'text-slate-500';

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <div className="flex items-center gap-2.5">
          <span className="text-lg font-black text-white tracking-tight">
            ⚡ Pure Liquidity Intelligence
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5
                            text-[9px] font-bold tracking-widest border ${
                            isConnected
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                              : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-slate-500 tracking-wide">
          Options Flow · PCR Sentiment · OI Analysis · Smart Money Positioning
        </p>
      </div>
      {lastUpdate && (
        <span className="text-[9px] text-slate-600 font-mono">
          {new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false })}
        </span>
      )}
    </div>
  );
});
HeaderBar.displayName = 'HeaderBar';

// ── Summary strip ─────────────────────────────────────────────────────────────

const SummaryStrip = memo(({ data }: { data: { NIFTY: LiquidityIndex | null; BANKNIFTY: LiquidityIndex | null; SENSEX: LiquidityIndex | null } }) => {
  const indices = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(k => data[k]).filter(Boolean) as LiquidityIndex[];
  if (indices.length === 0) return null;

  const bulls = indices.filter(x => x.direction === 'BULLISH').length;
  const bears = indices.filter(x => x.direction === 'BEARISH').length;

  let marketBias: string;
  let biasColor: string;
  if (bulls > bears)      { marketBias = 'Liquidity Bullish';  biasColor = 'text-cyan-400'; }
  else if (bears > bulls) { marketBias = 'Liquidity Bearish';  biasColor = 'text-orange-400'; }
  else                    { marketBias = 'Neutral / Mixed';    biasColor = 'text-slate-400'; }

  const avgConf = Math.round(indices.reduce((a, b) => a + b.confidence, 0) / indices.length);
  const avgPCR  = indices.filter(x => x.metrics.pcr).map(x => x.metrics.pcr!);
  const pcrDisplay = avgPCR.length ? (avgPCR.reduce((a, b) => a + b, 0) / avgPCR.length).toFixed(2) : '—';

  return (
    <div className="mb-4 rounded-xl bg-slate-800/50 border border-slate-700/30 px-4 py-2.5
                    flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Market Liquidity</span>
        <span className={`text-xs font-black ${biasColor}`}>{marketBias}</span>
      </div>
      <div className="w-px h-4 bg-slate-700/50" />
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Avg Confidence</span>
        <span className="text-xs font-bold text-white">{avgConf}%</span>
      </div>
      <div className="w-px h-4 bg-slate-700/50" />
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-slate-500 uppercase tracking-wider">Avg PCR</span>
        <span className={`text-xs font-bold ${pcrColor(avgPCR.length ? parseFloat(pcrDisplay) : null)}`}>
          {pcrDisplay}
        </span>
      </div>
      <div className="w-px h-4 bg-slate-700/50" />
      <div className="flex items-center gap-4 ml-auto">
        {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(sym => {
          const d = data[sym];
          if (!d) return null;
          const dot = d.direction === 'BULLISH' ? '🔵' : d.direction === 'BEARISH' ? '🔴' : '⚫';
          return (
            <span key={sym} className="text-[10px] text-slate-400">
              {dot} <span className="font-semibold">{sym.replace('BANKNIFTY','BNF')}</span>
              <span className="ml-1 text-[9px] text-slate-600">{d.confidence}%</span>
            </span>
          );
        })}
      </div>
    </div>
  );
});
SummaryStrip.displayName = 'SummaryStrip';

// ── Root component ────────────────────────────────────────────────────────────

function LiquidityIntelligence() {
  const { liquidityData, isConnected, lastUpdate } = useLiquiditySocket();

  return (
    <section className="w-full rounded-2xl border border-slate-700/40 overflow-hidden
                        bg-gradient-to-b from-cyan-900/8 via-[#0d1525] to-[#0d1525]">
      {/* Section background gradient stripe */}
      <div className="px-4 pt-5 pb-1">
        <HeaderBar isConnected={isConnected} lastUpdate={lastUpdate} />
        <SummaryStrip data={liquidityData} />
      </div>

      {/* 3-column index cards */}
      <div className="px-4 pb-5">
        <div className="flex flex-col lg:flex-row gap-4">
          <IndexCard data={liquidityData.NIFTY}     index="NIFTY"     />
          <IndexCard data={liquidityData.BANKNIFTY}  index="BANKNIFTY" />
          <IndexCard data={liquidityData.SENSEX}     index="SENSEX"    />
        </div>
      </div>
    </section>
  );
}

export default memo(LiquidityIntelligence);

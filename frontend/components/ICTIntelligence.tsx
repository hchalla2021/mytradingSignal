'use client';

/**
 * 🏦 ICT Smart Money Intelligence — v1
 * ─────────────────────────────────────
 * Advanced Inner Circle Trader (ICT) concepts applied to live market data.
 *
 * Per-index card:
 *   • ICT Setup badge (Premium Long, Sweep & Reject, BOS + OB, etc.)
 *   • Overall direction + confidence bar
 *   • 5-min ICT prediction with separate confidence %
 *   • 6-signal breakdown: Order Blocks / FVG / Market Structure / Sweeps / Displacement / Smart Money
 *   • Market structure visualization (swing points)
 *   • Confluence grade (A+ to C)
 *
 * Fully isolated — own WebSocket, own hook, zero overlap with Liquidity section.
 */

import React, { memo } from 'react';
import {
  useICTSocket,
  type ICTIndex,
  type ICTDirection,
  type ICTSignalFactor,
  type ICTPrediction,
  type ICTSetup,
} from '@/hooks/useICTSocket';

// ── Colour system ─────────────────────────────────────────────────────────────

type DirPalette = {
  ring: string; badge: string; bar: string;
  text: string; glow: string; gradFrom: string;
};

function getDirPalette(dir: ICTDirection): DirPalette {
  if (dir === 'BULLISH') return {
    ring:     'ring-emerald-500/40',
    badge:    'bg-emerald-500/20 text-emerald-200 border-emerald-500/50',
    bar:      'bg-emerald-500',
    text:     'text-emerald-400',
    glow:     'shadow-emerald-500/15',
    gradFrom: 'from-emerald-900/15',
  };
  if (dir === 'BEARISH') return {
    ring:     'ring-red-500/40',
    badge:    'bg-red-500/20 text-red-200 border-red-500/50',
    bar:      'bg-red-500',
    text:     'text-red-400',
    glow:     'shadow-red-500/15',
    gradFrom: 'from-red-900/15',
  };
  return {
    ring:     'ring-slate-500/30',
    badge:    'bg-slate-500/15 text-slate-300 border-slate-500/40',
    bar:      'bg-slate-500',
    text:     'text-slate-400',
    glow:     'shadow-slate-800/20',
    gradFrom: 'from-slate-800/20',
  };
}

// ── Setup grade badge ─────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  'A+': 'bg-emerald-500/30 text-emerald-200 border-emerald-400/60 ring-2 ring-emerald-400/50',
  'A':  'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  'A-': 'bg-green-500/20 text-green-300 border-green-500/40',
  'B+': 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
  'B':  'bg-blue-500/15 text-blue-300 border-blue-500/30',
  'C':  'bg-slate-600/20 text-slate-400 border-slate-600/30',
  '—':  'bg-slate-700/20 text-slate-500 border-slate-700/30',
};

const SetupBadge = memo(({ setup }: { setup: ICTSetup }) => {
  const gradeColor = GRADE_COLORS[setup.grade] ?? GRADE_COLORS['—'];
  return (
    <div className={`rounded-lg border px-3 py-2 ${gradeColor}`}>
      <div className="text-[11px] font-black tracking-wider leading-none">{setup.name}</div>
      <div className="text-[9px] text-slate-400 mt-1 leading-tight">{setup.description}</div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="text-[8px] text-slate-500 uppercase tracking-widest">Grade</span>
        <span className="text-[11px] font-black">{setup.grade}</span>
        <span className="text-[8px] text-slate-600">•</span>
        <span className="text-[8px] text-slate-500">{setup.confluences} confluences</span>
      </div>
    </div>
  );
});
SetupBadge.displayName = 'SetupBadge';

// ── 5-min prediction badge ───────────────────────────────────────────────────

const PRED: Record<ICTPrediction, { bg: string; label: string; arrow: string }> = {
  STRONG_BUY:  { bg: 'bg-emerald-500/25 text-emerald-200 border-emerald-400/70', label: 'Strong Buy',  arrow: '▲▲' },
  BUY:         { bg: 'bg-green-500/20   text-green-300   border-green-500/50',   label: 'Buy',         arrow: '▲'  },
  NEUTRAL:     { bg: 'bg-slate-500/20   text-slate-300   border-slate-500/40',   label: 'Neutral',     arrow: '→'  },
  SELL:        { bg: 'bg-orange-500/20  text-orange-300  border-orange-500/50',  label: 'Sell',        arrow: '▼'  },
  STRONG_SELL: { bg: 'bg-red-500/25     text-red-200     border-red-400/70',     label: 'Strong Sell', arrow: '▼▼' },
};

const Pred5mBadge = memo(({ pred }: { pred: ICTPrediction }) => {
  const s = PRED[pred] ?? PRED.NEUTRAL;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md border px-2 py-1
                      text-[10px] font-black leading-none tracking-wide ${s.bg}`}>
      <span>{s.arrow}</span>
      <span>{s.label.toUpperCase()}</span>
    </span>
  );
});
Pred5mBadge.displayName = 'Pred5mBadge';

// ── Score bar ─────────────────────────────────────────────────────────────────

const ScoreBar = memo(({ score, positiveColor = 'bg-emerald-500', negativeColor = 'bg-red-500' }:
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

const SIG_NAMES: Record<string, { label: string; icon: string }> = {
  order_blocks:     { label: 'Order Blocks',      icon: '🧱' },
  fair_value_gaps:  { label: 'Fair Value Gaps',    icon: '📊' },
  market_structure: { label: 'Market Structure',   icon: '📐' },
  liquidity_sweeps: { label: 'Liquidity Sweeps',   icon: '🎣' },
  displacement:     { label: 'Displacement',       icon: '⚡' },
  smart_money_div:  { label: 'Smart Money Div.',   icon: '🏦' },
};

const SignalRow = memo(({ factorKey, factor }: { factorKey: string; factor: ICTSignalFactor }) => {
  const pct   = Math.round(factor.weight * 100);
  const sig   = SIG_NAMES[factorKey] ?? { label: factorKey, icon: '•' };
  const arrow = factor.signal === 'BULL' ? '↑' : factor.signal === 'BEAR' ? '↓' : '→';
  const arrowColor = factor.signal === 'BULL' ? 'text-emerald-400' :
                     factor.signal === 'BEAR' ? 'text-red-400' : 'text-slate-400';

  return (
    <div className="flex items-center gap-2 py-[5px] border-t border-slate-700/30 first:border-0">
      <span className="text-[10px] w-4">{sig.icon}</span>
      <span className={`w-3 text-center text-xs font-bold leading-none ${arrowColor}`}>{arrow}</span>
      <span className="w-[110px] text-[10px] text-slate-400 leading-tight truncate">
        {sig.label}
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
  <div className="w-full h-1.5 rounded-full bg-slate-700/50 overflow-hidden mt-1">
    <div
      className={`h-full rounded-full ${barColor} transition-all duration-700`}
      style={{ width: `${confidence}%` }}
    />
  </div>
));
ConfidenceBar.displayName = 'ConfidenceBar';

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtPrice(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Index card ────────────────────────────────────────────────────────────────

const IndexCard = memo(({ data, index }: { data: ICTIndex | null; index: string }) => {
  if (!data) {
    return (
      <div className="flex-1 min-w-[280px] rounded-xl bg-[#1a2332] border border-slate-700/40 overflow-hidden">
        <div className="h-8 bg-slate-700/40 animate-pulse" />
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`h-${i === 0 ? 6 : 3} bg-slate-700/40 rounded-lg animate-pulse`} />
          ))}
        </div>
      </div>
    );
  }

  const pal = getDirPalette(data.direction);
  const changePctColor = data.metrics.changePct > 0 ? 'text-emerald-400' :
                         data.metrics.changePct < 0 ? 'text-red-400' : 'text-slate-400';

  const signalOrder: (keyof typeof data.signals)[] = [
    'order_blocks', 'fair_value_gaps', 'market_structure',
    'liquidity_sweeps', 'displacement', 'smart_money_div',
  ];

  return (
    <div className={`flex-1 min-w-[280px] rounded-xl bg-[#1a2332] border overflow-hidden
                     transition-all duration-300 ring-1 ${pal.ring} border-slate-700/40
                     shadow-lg ${pal.glow}`}>

      {/* ── ICT Setup banner ──────────────────────────────────────────── */}
      <div className="px-3 py-2 border-b border-slate-700/30 bg-gradient-to-r from-slate-800/60 to-slate-900/40">
        <SetupBadge setup={data.ictSetup} />
      </div>

      <div className="p-3 space-y-2">

        {/* ── Header: symbol + price + direction ─────────────────────── */}
        <div className="flex items-start justify-between">
          <div className={`rounded-lg px-2.5 py-1.5 border ${
            data.metrics.changePct > 0 ? 'border-emerald-500/30 bg-emerald-500/5' :
            data.metrics.changePct < 0 ? 'border-red-500/30 bg-red-500/5' :
                                          'border-slate-700/30 bg-slate-800/30'
          }`}>
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
          {/* Direction + confidence */}
          <div className={`rounded-lg border px-2.5 py-1.5 text-center ${pal.badge}`}>
            <div className="text-[10px] font-black tracking-widest leading-none">
              {data.direction === 'BULLISH' ? '▲ BUY' : data.direction === 'BEARISH' ? '▼ SELL' : '● WAIT'}
            </div>
            <div className={`text-[14px] font-black leading-none mt-0.5 ${pal.text}`}>
              {data.confidence}%
            </div>
            <div className="text-[8px] font-normal text-slate-500 leading-none mt-0.5 tracking-wide">
              Confidence
            </div>
          </div>
        </div>

        {/* Confidence bar */}
        <ConfidenceBar confidence={data.confidence} barColor={pal.bar} />

        {/* ── Market Structure Info ──────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/50 border border-slate-700/30 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">
              Market Structure
            </span>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold ${
                data.signals.market_structure.signal === 'BULL' ? 'text-emerald-400' :
                data.signals.market_structure.signal === 'BEAR' ? 'text-red-400' : 'text-slate-400'
              }`}>
                {data.signals.market_structure.extra?.structure as string || 'FORMING'}
              </span>
            </div>
          </div>
          <div className="mt-1 text-[9px] text-slate-500">{data.signals.market_structure.label}</div>
          <div className="flex items-center gap-3 mt-1.5 text-[9px]">
            {data.metrics.lastSwingHigh && (
              <span className="text-red-400/70">SH: {data.metrics.lastSwingHigh.toFixed(0)}</span>
            )}
            {data.metrics.lastSwingLow && (
              <span className="text-emerald-400/70">SL: {data.metrics.lastSwingLow.toFixed(0)}</span>
            )}
            <span className="text-slate-600">
              {data.metrics.swingHighs}H / {data.metrics.swingLows}L
            </span>
          </div>
        </div>

        {/* ── 5-Min ICT Prediction ─────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/60 border border-slate-700/30 px-3 py-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 uppercase tracking-widest font-bold mb-2">
                🏦 5-Min Prediction
              </div>
              <Pred5mBadge pred={data.prediction5m} />
            </div>
            <div className="flex flex-col items-end gap-1">
              <span className="text-[14px] font-black text-white">
                {data.pred5mConf}%
                <span className="text-[10px] font-semibold text-slate-400 ml-1">CONF</span>
              </span>
              <div className="w-20 h-2 rounded-full bg-slate-700/50 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    data.prediction5m === 'STRONG_BUY'  ? 'bg-emerald-400' :
                    data.prediction5m === 'BUY'         ? 'bg-green-400' :
                    data.prediction5m === 'STRONG_SELL' ? 'bg-red-400' :
                    data.prediction5m === 'SELL'        ? 'bg-orange-400' :
                                                          'bg-slate-500'
                  }`}
                  style={{ width: `${data.pred5mConf}%` }}
                />
              </div>
            </div>
          </div>

          {/* ICT Signal Confluence */}
          <div className="mt-2 bg-slate-900/50 rounded-lg p-2 border border-slate-700/20 space-y-1.5">
            {/* Buy vs Sell Probability */}
            <div className="flex items-center justify-between bg-slate-900/30 rounded px-2 py-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">ICT Signal</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold px-2 py-1 rounded text-[10px] ${
                  data.direction === 'BULLISH'  ? 'bg-emerald-500/40 text-emerald-200' :
                  data.direction === 'BEARISH'  ? 'bg-red-500/40 text-red-200' :
                                                  'bg-slate-600/25 text-slate-300'
                }`}>
                  {data.direction === 'BULLISH' ? '📈 BUY' : data.direction === 'BEARISH' ? '📉 SELL' : '⏸ WAIT'}
                </span>
              </div>
            </div>

            {/* Displacement Strength */}
            <div className="flex items-center justify-between bg-slate-900/30 rounded px-2 py-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Displacement</span>
              <div className="flex items-center gap-2">
                <span className={`font-bold px-2 py-1 rounded text-[10px] ${
                  data.signals.displacement.signal === 'BULL' ? 'bg-emerald-500/40 text-emerald-200' :
                  data.signals.displacement.signal === 'BEAR' ? 'bg-red-500/40 text-red-200' :
                                                                'bg-slate-600/25 text-slate-300'
                }`}>
                  {data.signals.displacement.label.substring(0, 40)}
                </span>
              </div>
            </div>

            {/* Probability Distribution */}
            {(() => {
              const buyPct = Math.max(5, Math.min(95, Math.round((data.rawScore + 1) / 2 * 100)));
              const sellPct = 100 - buyPct;
              return (
                <div className="pt-2 border-t border-slate-700/20">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wide">Buy / Sell Probability</span>
                  </div>
                  <div className="flex items-center h-7 rounded-md overflow-hidden bg-slate-950/50 border border-slate-700/30">
                    {/* Buy probability */}
                    <div
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-500 transition-all duration-300 flex items-center justify-center"
                      style={{ width: `${buyPct}%` }}
                    >
                      <span className="text-[9px] font-bold text-white px-2 truncate whitespace-nowrap">
                        {buyPct}% BUY
                      </span>
                    </div>
                    {/* Sell probability */}
                    <div
                      className="h-full bg-gradient-to-l from-red-600 to-red-500 transition-all duration-300 flex items-center justify-center"
                      style={{ width: `${sellPct}%` }}
                    >
                      <span className="text-[9px] font-bold text-white px-2 truncate whitespace-nowrap">
                        {sellPct}% SELL
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Active Setup Alert */}
            {data.ictSetup.grade !== '—' && data.ictSetup.confluences >= 2 && (
              <div className="pt-2 border-t border-slate-700/20">
                <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wide">
                  🎯 Active ICT Setup — Grade {data.ictSetup.grade} ({data.ictSetup.confluences} confluences)
                </span>
              </div>
            )}
          </div>
        </div>

        {/* ── 6-Signal breakdown ──────────────────────────────────────── */}
        <div className="rounded-lg bg-slate-800/40 border border-slate-700/25 px-3 py-2">
          <div className="text-[9px] text-slate-600 uppercase tracking-widest font-semibold mb-1">
            ICT Signal Matrix
          </div>
          {signalOrder.map(key => (
            <SignalRow key={key} factorKey={key} factor={data.signals[key]} />
          ))}
        </div>

        {/* ── Metrics row ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-3 gap-1.5">
          <MetricPill label="Candles" value={String(data.metrics.candleCount)} />
          <MetricPill label="Swing H" value={data.metrics.lastSwingHigh?.toFixed(0) ?? '—'} />
          <MetricPill label="Swing L" value={data.metrics.lastSwingLow?.toFixed(0) ?? '—'} />
        </div>

        {/* ── Timestamp ───────────────────────────────────────────────── */}
        <div className="flex items-center justify-between text-[8px] text-slate-600 pt-1">
          <span>{data.dataSource === 'MARKET_CLOSED' ? '🕐 Last Close' : '⚡ Live'}</span>
          <span className="font-mono">{new Date(data.timestamp).toLocaleTimeString('en-IN', { hour12: false })}</span>
        </div>

      </div>
    </div>
  );
});
IndexCard.displayName = 'ICTIndexCard';

// ── Metric pill ───────────────────────────────────────────────────────────────

const MetricPill = memo(({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md bg-slate-800/50 border border-slate-700/30 px-2 py-1 text-center">
    <div className="text-[8px] text-slate-600 uppercase tracking-wider">{label}</div>
    <div className="text-[10px] text-slate-300 font-mono font-semibold">{value}</div>
  </div>
));
MetricPill.displayName = 'ICTMetricPill';

// ── Header bar ────────────────────────────────────────────────────────────────

const HeaderBar = memo(({ isConnected, lastUpdate }: { isConnected: boolean; lastUpdate: string | null }) => {
  const hasRecentData = lastUpdate ? (Date.now() - new Date(lastUpdate).getTime()) < 10000 : false;
  const isActive = isConnected || hasRecentData;
  const statusDot = isActive ? 'bg-emerald-400 shadow-emerald-400/70 shadow-sm animate-pulse' : 'bg-slate-600';
  const statusLabel = isActive ? 'LIVE' : 'OFFLINE';

  return (
    <div className="mb-4 sm:mb-5">
      <div className="relative rounded-xl bg-amber-500/[0.06] border border-emerald-400/25 px-3 sm:px-4 py-2.5 sm:py-3 shadow-sm shadow-amber-500/20">
        <div className="absolute top-0 left-4 right-4 h-[1px] bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 overflow-hidden">
            <span className="w-[3px] h-7 sm:h-9 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 shrink-0 shadow-sm shadow-amber-500/20" />
            <h2 className="text-[14px] sm:text-[18px] lg:text-[22px] font-extrabold text-white tracking-tight leading-snug truncate">
              🏦 ICT Bias
            </h2>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5
                              text-[9px] font-bold tracking-widest border shrink-0 ${
                            isActive
                              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                              : 'bg-slate-700/40 text-slate-500 border-slate-700/40'
                          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDot}`} />
            {statusLabel}
          </span>
          </div>
        </div>
        <p className="text-[10px] sm:text-xs text-amber-400 opacity-60 mt-1.5 ml-[15px] sm:ml-[17px] font-medium tracking-wide leading-relaxed">
          Order Blocks · Fair Value Gaps · Market Structure · Liquidity Sweeps · Displacement · Smart Money
        </p>
      </div>
    </div>
  );
});
HeaderBar.displayName = 'ICTHeaderBar';

// ── Summary strip ─────────────────────────────────────────────────────────────

const SummaryStrip = memo(({ data }: { data: { NIFTY: ICTIndex | null; BANKNIFTY: ICTIndex | null; SENSEX: ICTIndex | null } }) => {
  const indices = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(k => data[k]).filter(Boolean) as ICTIndex[];
  if (indices.length === 0) return null;

  const bulls = indices.filter(x => x.direction === 'BULLISH').length;
  const bears = indices.filter(x => x.direction === 'BEARISH').length;
  const total = bulls + bears;
  
  // Calculate buyer/seller percentages
  const buyerPct = total > 0 ? Math.round((bulls / total) * 100) : 50;
  const sellerPct = 100 - buyerPct;

  let marketBias: string;
  let biasColor: string;
  if (bulls > bears)      { marketBias = 'ICT Bullish';   biasColor = 'text-emerald-400'; }
  else if (bears > bulls) { marketBias = 'ICT Bearish';   biasColor = 'text-red-400'; }
  else                    { marketBias = 'ICT Neutral';   biasColor = 'text-slate-400'; }

  const avgConf = Math.round(indices.reduce((a, b) => a + b.confidence, 0) / indices.length);
  const avgGrade = indices.map(x => x.ictSetup.grade).join(' / ');

  return (
    <div className="mb-3 rounded-xl bg-emerald-950/40 border border-emerald-500/20 px-4 py-3
                    flex flex-wrap items-center gap-4 shadow-sm shadow-emerald-500/5">
      <div className="flex items-center gap-3">
        <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold">ICT Bias</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-black text-emerald-400">{buyerPct}% BUY</span>
          <span className="text-slate-400">/</span>
          <span className="text-sm font-black text-red-400">{sellerPct}% SELL</span>
        </div>
      </div>
      <div className="w-px h-4 bg-emerald-500/20" />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold">Confidence</span>
        <span className="text-sm font-bold text-emerald-100">{avgConf}%</span>
      </div>
      <div className="w-px h-4 bg-emerald-500/20" />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-semibold">Grades</span>
        <span className="text-sm font-bold text-amber-400">{avgGrade}</span>
      </div>
      <div className="w-px h-4 bg-emerald-500/20" />
      <div className="flex items-center gap-4 ml-auto">
        {(['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(sym => {
          const d = data[sym];
          if (!d) return null;
          const icon = d.direction === 'BULLISH' ? '🟢' : d.direction === 'BEARISH' ? '🔴' : '⚪';
          const signal = d.direction === 'BULLISH' ? 'BUY' : d.direction === 'BEARISH' ? 'SELL' : 'WAIT';
          return (
            <span key={sym} className="text-[11px] text-emerald-200/80">
              {icon} <span className="font-bold">{sym.replace('BANKNIFTY', 'BNF')}</span>
              <span className={`ml-1 text-[10px] font-bold ${
                signal === 'BUY' ? 'text-emerald-400' : signal === 'SELL' ? 'text-red-400' : 'text-emerald-300/50'
              }`}>{signal}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
});
SummaryStrip.displayName = 'ICTSummaryStrip';

// ── Main component ────────────────────────────────────────────────────────────

function ICTIntelligence() {
  const { ictData, isConnected, lastUpdate } = useICTSocket();

  return (
    <div className="mt-6 rounded-2xl border-2 border-amber-500/30 p-2 sm:p-3
                    bg-gradient-to-br from-amber-950/10 via-dark-card/50 to-dark-elevated/40
                    backdrop-blur-sm shadow-xl shadow-amber-500/10">
      <HeaderBar isConnected={isConnected} lastUpdate={lastUpdate} />
      <SummaryStrip data={ictData} />
      <div className="flex flex-col lg:flex-row gap-3">
        <IndexCard index="NIFTY"     data={ictData.NIFTY} />
        <IndexCard index="BANKNIFTY" data={ictData.BANKNIFTY} />
        <IndexCard index="SENSEX"    data={ictData.SENSEX} />
      </div>
    </div>
  );
}

export default memo(ICTIntelligence);

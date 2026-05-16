'use client';

import React, { memo, useMemo, useRef, useState, useEffect } from 'react';
import { useStrikeIntelligence, type SymbolStrikeData, type StrikeRow, type StrikeSignal, type StrikeSideData, type QuantumFractalIntelligence, type StrikeIntelligenceData } from '@/hooks/useStrikeIntelligence';

// Signal config

const SIGNAL_CONFIG: Record<StrikeSignal, {
  label: string;
  short: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
}> = {
  STRONG_BUY:  { label: 'STRONG BUY',  short: 'S.BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/50', glow: 'shadow-emerald-500/25' },
  BUY:         { label: 'BUY',          short: 'BUY  ',  color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', glow: 'shadow-emerald-500/10' },
  NEUTRAL:     { label: 'NEUTRAL',      short: 'NTRL',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/30',   glow: 'shadow-amber-500/10'  },
  SELL:        { label: 'SELL',         short: 'S.SELL', color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/30',     glow: 'shadow-red-500/10'    },
  STRONG_SELL: { label: 'STRONG SELL',  short: 'S.SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/50',     glow: 'shadow-red-500/25'    },
};

type OverallSignal = StrikeSignal;

const OVERALL_CFG: Record<OverallSignal, { label: string; color: string; bg: string; border: string; glow: string; arrow: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-200', bg: 'bg-emerald-500/25', border: 'border-emerald-400/70', glow: 'shadow-[0_0_12px_2px_rgba(52,211,153,0.35)]',   arrow: 'UP++' },
  BUY:         { label: 'BUY',          color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', glow: 'shadow-[0_0_8px_0px_rgba(52,211,153,0.20)]',    arrow: 'UP'   },
  NEUTRAL:     { label: 'NEUTRAL',      color: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-400/40',   glow: '',                                              arrow: '—'    },
  SELL:        { label: 'SELL',         color: 'text-red-300',     bg: 'bg-red-500/15',     border: 'border-red-400/40',     glow: 'shadow-[0_0_8px_0px_rgba(251,113,133,0.20)]',   arrow: 'DOWN' },
  STRONG_SELL: { label: 'STRONG SELL',  color: 'text-red-200',     bg: 'bg-red-500/25',     border: 'border-red-400/70',     glow: 'shadow-[0_0_12px_2px_rgba(251,113,133,0.35)]',  arrow: 'DOWN--' },
};

const FRACTAL_TREND_TONE: Record<string, string> = {
  STRONG_BULL: 'text-emerald-200 border-emerald-400/60 bg-emerald-500/16',
  BULL: 'text-emerald-300 border-emerald-400/45 bg-emerald-500/10',
  NEUTRAL: 'text-amber-300 border-amber-400/40 bg-amber-500/10',
  BEAR: 'text-red-300 border-red-400/45 bg-red-500/10',
  STRONG_BEAR: 'text-red-200 border-red-400/60 bg-red-500/16',
};

const FRACTAL_TAG_TONE: Record<string, string> = {
  'Fractal Expansion': 'text-cyan-200 border-cyan-400/45 bg-cyan-500/12',
  'Structural Breakdown': 'text-red-200 border-red-400/45 bg-red-500/12',
  'Momentum Alignment': 'text-emerald-200 border-emerald-400/45 bg-emerald-500/12',
  'Liquidity Absorption': 'text-amber-200 border-amber-400/45 bg-amber-500/12',
  'Reversal Pressure': 'text-fuchsia-200 border-fuchsia-400/45 bg-fuchsia-500/12',
  'Breakout Continuation': 'text-blue-200 border-blue-400/45 bg-blue-500/12',
};

// Utilities

function fmtNum(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(2) + 'Cr';
  if (n >= 100_000)    return (n / 100_000).toFixed(2) + 'L';
  if (n >= 1_000)      return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('en-IN');
}
function fmtAgeSeconds(s?: number): string {
  if (s === undefined || Number.isNaN(s)) return '--';
  if (s < 1)  return '<1s';
  if (s < 60) return `${Math.round(s)}s`;
  return `${(s / 60).toFixed(1)}m`;
}

function fmtTs(ts?: string): string {
  if (!ts) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

type MoveDirection = 'up' | 'down' | 'flat';
type MetricMove = { ce: MoveDirection; pe: MoveDirection; active: boolean };
type ChainMoves = {
  volume: MetricMove;
  oi: MetricMove;
  oiChange: MetricMove;
  priceAction: MetricMove;
};

const FLAT_MOVE: MetricMove = { ce: 'flat', pe: 'flat', active: false };
const INITIAL_CHAIN_MOVES: ChainMoves = {
  volume: { ...FLAT_MOVE },
  oi: { ...FLAT_MOVE },
  oiChange: { ...FLAT_MOVE },
  priceAction: { ...FLAT_MOVE },
};

function detectMove(curr: number, prev: number, epsilon = 0): MoveDirection {
  if (curr > prev + epsilon) return 'up';
  if (curr < prev - epsilon) return 'down';
  return 'flat';
}

function getMetricCardFlashClass(move: MetricMove): string {
  if (!move.active) return 'transition-shadow duration-700';
  const up = move.ce === 'up' || move.pe === 'up';
  const down = move.ce === 'down' || move.pe === 'down';
  if (up && !down) return 'shadow-[0_0_12px_rgba(16,185,129,0.30)] transition-shadow duration-700';
  if (down && !up) return 'shadow-[0_0_12px_rgba(239,68,68,0.30)] transition-shadow duration-700';
  return 'shadow-[0_0_10px_rgba(251,191,36,0.25)] transition-shadow duration-700';
}

function getValueFlashClass(direction: MoveDirection, active: boolean): string {
  if (!active || direction === 'flat') return 'transition-colors duration-500';
  if (direction === 'up') {
    return 'bg-emerald-500/20 text-emerald-100 rounded transition-colors duration-500';
  }
  return 'bg-red-500/20 text-red-100 rounded transition-colors duration-500';
}

// High-conviction gate for buyer perspective.
// We only emit STRONG_BUY / STRONG_SELL when participation + positioning are confirmed.
type SymbolKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
type ConvictionRules = {
  minBuyPct: number;
  minSellPct: number;
  minOpposingPct: number;
  minVolume: number;
  minOI: number;
  minOIChange: number;
};

const CONVICTION_RULES_BY_SYMBOL: Record<SymbolKey, ConvictionRules> = {
  // NIFTY: balanced thresholds
  NIFTY: {
    minBuyPct: 62,
    minSellPct: 62,
    minOpposingPct: 12,
    minVolume: 50_000,
    minOI: 50_000,
    minOIChange: 500,
  },
  // BANKNIFTY: faster and noisier, require stronger participation and depth
  BANKNIFTY: {
    minBuyPct: 66,
    minSellPct: 66,
    minOpposingPct: 14,
    minVolume: 80_000,
    minOI: 70_000,
    minOIChange: 700,
  },
  // SENSEX: thinner options flow, slightly relaxed depth
  SENSEX: {
    minBuyPct: 60,
    minSellPct: 60,
    minOpposingPct: 10,
    minVolume: 30_000,
    minOI: 30_000,
    minOIChange: 300,
  },
};

function normalizeSymbolKey(symbol?: string): SymbolKey {
  const raw = (symbol ?? '').toUpperCase().replace(/\s+/g, '');
  if (raw.includes('BANKNIFTY')) return 'BANKNIFTY';
  if (raw.includes('SENSEX')) return 'SENSEX';
  return 'NIFTY';
}

function getHighConvictionSignal(side: StrikeSideData, symbolKey: SymbolKey): StrikeSignal {
  const rules = CONVICTION_RULES_BY_SYMBOL[symbolKey];
  const buyPct = side.breakdown.buyPct;
  const sellPct = side.breakdown.sellPct;
  const oiChange = Math.abs(side.oiChange ?? 0);
  const oiInterp = side.signals?.oiInterp;

  const buyerBase = side.signal === 'BUY' || side.signal === 'STRONG_BUY';
  const sellerBase = side.signal === 'SELL' || side.signal === 'STRONG_SELL';

  const hasTwoWayParticipation = buyPct >= rules.minOpposingPct && sellPct >= rules.minOpposingPct;
  const hasFlowDepth = side.volume >= rules.minVolume && side.oi >= rules.minOI;

  const buyerOIConfirmed = oiInterp === 'LB' || oiInterp === 'SC' || oiChange >= rules.minOIChange;
  const sellerOIConfirmed = oiInterp === 'SB' || oiInterp === 'LU' || oiChange >= rules.minOIChange;

  if (
    buyerBase &&
    buyPct >= rules.minBuyPct &&
    hasTwoWayParticipation &&
    hasFlowDepth &&
    buyerOIConfirmed
  ) {
    return 'STRONG_BUY';
  }

  if (
    sellerBase &&
    sellPct >= rules.minSellPct &&
    hasTwoWayParticipation &&
    hasFlowDepth &&
    sellerOIConfirmed
  ) {
    return 'STRONG_SELL';
  }

  return 'NEUTRAL';
}

function toBuyerPerspectiveSignal(signal: StrikeSignal): StrikeSignal {
  if (signal === 'STRONG_BUY') return 'STRONG_BUY';
  if (signal === 'BUY') return 'BUY';
  return 'NEUTRAL';
}

function resolveBuyerDisplaySignals(
  ceSide: StrikeSideData,
  peSide: StrikeSideData,
  symbolKey: SymbolKey,
): { ce: StrikeSignal; pe: StrikeSignal } {
  const ceConv = getHighConvictionSignal(ceSide, symbolKey);
  const peConv = getHighConvictionSignal(peSide, symbolKey);

  let ce = ceConv === 'STRONG_BUY' ? 'STRONG_BUY' : toBuyerPerspectiveSignal(ceSide.signal);
  let pe = peConv === 'STRONG_BUY' ? 'STRONG_BUY' : toBuyerPerspectiveSignal(peSide.signal);

  // Prevent both sides from simultaneously flashing STRONG BUY.
  // If both are very close in strength, downgrade both to BUY.
  if (ce === 'STRONG_BUY' && pe === 'STRONG_BUY') {
    const scoreDiff = (ceSide.score ?? 0) - (peSide.score ?? 0);
    if (Math.abs(scoreDiff) < 8) {
      ce = 'BUY';
      pe = 'BUY';
    } else if (scoreDiff > 0) {
      pe = 'BUY';
    } else {
      ce = 'BUY';
    }
  }

  return { ce, pe };
}

// Primitives

const SignalBadge = memo<{ signal: StrikeSignal; side: 'CE' | 'PE' }>(({ signal, side }) => {
  const cfg = SIGNAL_CONFIG[signal];
  // CE BUY = market going UP → show upward arrow; PE BUY = market going DOWN → show downward arrow
  // For SELL signals the direction reverses
  const isCE     = side === 'CE';
  const isBuy    = signal === 'STRONG_BUY' || signal === 'BUY';
  const isSell   = signal === 'STRONG_SELL' || signal === 'SELL';
  const fullText = cfg.label;
  return (
    <span
      title={isCE
        ? (isBuy  ? 'CE is strong → market likely going UP → Buy CE (Call option)' : isSell ? 'CE is weak → market likely going DOWN → Buy PE instead' : 'CE neutral — no clear call signal')
        : (isBuy  ? 'PE is strong → market likely going DOWN → Buy PE (Put option)' : isSell ? 'PE is weak → market likely going UP → Buy CE instead' : 'PE neutral — no clear put signal')}
      className={`inline-flex items-center justify-center whitespace-nowrap px-1.5 sm:px-2 py-0.5 rounded text-[9px] sm:text-[11px] font-bold tracking-wide leading-none ${cfg.bg} ${cfg.color} ${cfg.border} border shadow-sm ${cfg.glow} transition-colors duration-150`}>
      {fullText}
    </span>
  );
});
SignalBadge.displayName = 'SignalBadge';

const LiquidityBar = memo<{ buyPct: number; sellPct: number; neutralPct: number }>(({ buyPct, sellPct, neutralPct }) => {
  const total = buyPct + neutralPct + sellPct || 100;
  const b = (buyPct     / total) * 100;
  const n = (neutralPct / total) * 100;
  const s = (sellPct    / total) * 100;
  return (
    <div className="flex h-[6px] rounded-full overflow-hidden bg-slate-800/60 w-full">
      {b > 0 && <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-300 ease-out" style={{ width: `${b}%` }} />}
      {n > 0 && <div className="bg-gradient-to-r from-amber-400/60 to-amber-500/60 transition-all duration-300 ease-out" style={{ width: `${n}%` }} />}
      {s > 0 && <div className="bg-gradient-to-r from-red-400 to-red-500 transition-all duration-300 ease-out"         style={{ width: `${s}%` }} />}
    </div>
  );
});
LiquidityBar.displayName = 'LiquidityBar';

const ScoreDot = memo<{ score: number }>(({ score }) => {
  const color = score >= 15 ? 'bg-emerald-400' : score <= -15 ? 'bg-red-400' : 'bg-amber-400';
  return <span className={`inline-block w-2 h-2 rounded-full ${color} ${Math.abs(score) >= 40 ? 'animate-pulse' : ''} shadow-sm`} />;
});
ScoreDot.displayName = 'ScoreDot';

// ── Quantum Fractal helpers ──────────────────────────────────────────────────

function qfScoreColor(val: number): string {
  return val > 30 ? 'text-emerald-300' : val > 10 ? 'text-emerald-400/90'
    : val < -30 ? 'text-rose-300' : val < -10 ? 'text-rose-400/90' : 'text-slate-300';
}
function qfScoreFmt(val: number): string {
  return (val > 0 ? '+' : '') + val;
}

/** Bi-directional mini progress bar — positive grows right from centre, negative grows left. */
const QFMiniBar = memo<{ score: number }>(({ score }) => {
  const c = Math.max(-100, Math.min(100, score));
  return (
    <div className="flex-1 h-2 rounded-full bg-slate-800/60 overflow-hidden relative min-w-0">
      <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600/50 z-10" />
      {c > 0
        ? <div className="absolute inset-y-0 bg-emerald-400/70 rounded-r-full" style={{ left: '50%', width: `${c / 2}%` }} />
        : c < 0
        ? <div className="absolute inset-y-0 bg-rose-400/70 rounded-l-full"   style={{ right: '50%', width: `${Math.abs(c) / 2}%` }} />
        : null}
    </div>
  );
});
QFMiniBar.displayName = 'QFMiniBar';

const ALLOWED_QF_SIGNALS: readonly StrikeSignal[] = ['STRONG_SELL', 'SELL', 'NEUTRAL', 'BUY', 'STRONG_BUY'] as const;

function normalizeQfSignal(signal: string | undefined): StrikeSignal {
  if (ALLOWED_QF_SIGNALS.includes(signal as StrikeSignal)) {
    return signal as StrikeSignal;
  }
  return 'NEUTRAL';
}

const QuantumFractalPanel = memo<{ fractal: QuantumFractalIntelligence; symbol?: string }>(({ fractal, symbol }) => {
  const normalizedSignal = normalizeQfSignal(fractal.signal);
  const signalCfg   = OVERALL_CFG[normalizedSignal as OverallSignal] ?? OVERALL_CFG.NEUTRAL;
  const confidenceTone = fractal.confidence >= 70 ? 'text-emerald-300' : fractal.confidence >= 45 ? 'text-amber-300' : 'text-rose-300';
  const scoreTone      = fractal.score >= 14 ? 'text-emerald-300' : fractal.score <= -14 ? 'text-rose-300' : 'text-amber-300';

  const regimeTone = fractal.volatilityRegime === 'EXPANSION'
    ? 'text-cyan-200   border-cyan-400/40   bg-cyan-500/10'
    : fractal.volatilityRegime === 'COMPRESSION'
    ? 'text-amber-200  border-amber-400/40  bg-amber-500/10'
    : 'text-slate-300  border-slate-500/35  bg-slate-700/15';

  // Coloured top-edge accent strip
  const accentStrip = (fractal.signal === 'STRONG_BUY' || fractal.signal === 'BUY')
    ? 'from-emerald-500/80 via-emerald-400/40 to-transparent'
    : (fractal.signal === 'STRONG_SELL' || fractal.signal === 'SELL')
    ? 'from-rose-500/80    via-rose-400/40    to-transparent'
    : 'from-amber-500/60   via-amber-400/30   to-transparent';

  // Score gauge (−100 … +100 mapped to 0 … 100%)
  const scoreGaugePct = Math.max(0, Math.min(100, (fractal.score + 100) / 2));
  const gaugeGradient = fractal.score >= 14
    ? 'from-emerald-600/60 to-emerald-400'
    : fractal.score <= -14
    ? 'from-rose-600/60    to-rose-400'
    : 'from-amber-600/60   to-amber-400';

  const tfEntries = [
    { key: 'micro'  as const, label: 'Micro'  },
    { key: 'medium' as const, label: 'Medium' },
    { key: 'macro'  as const, label: 'Macro'  },
  ] as const;

  const probeRows: [string, number, boolean][] = [
    ['Trend',     fractal.components.trendStrength,           false],
    ['Structure', fractal.components.marketStructure,         false],
    ['Liquidity', fractal.components.volumeLiquidity,         false],
    ['Confirm',   fractal.components.directionalConfirmation, false],
    ['Fractal P', fractal.fractalPressure,                    false],
    ['Cont.',     fractal.continuationProbability,            true ],
  ];

  const nextIcon = fractal.prediction.nextMove === 'UP' ? '↑'
    : fractal.prediction.nextMove === 'DOWN' ? '↓' : '→';

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col border border-slate-600/60 bg-slate-950/90 shadow-lg min-w-0">

      {/* ── Coloured accent strip ───────────────────────────────────────── */}
      <div className={`h-0.5 w-full bg-gradient-to-r ${accentStrip}`} />

      {/* ── Card header ─────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-5 pt-4 pb-3 border-b border-slate-700/35 bg-gradient-to-r from-slate-900/70 to-transparent">
        <div className="flex items-start justify-between gap-2 min-w-0">
          {/* Left: symbol + signal + regime */}
          <div className="flex flex-col gap-1.5 min-w-0 flex-1">
            {symbol && (
              <span className="inline-flex w-fit items-center rounded-md border border-cyan-400/45 bg-cyan-500/10 px-2 py-1 text-[11px] sm:text-[13px] uppercase tracking-[0.14em] font-black text-cyan-200 leading-none shadow-[0_0_10px_rgba(34,211,238,0.12)]">
                {symbol}
              </span>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] sm:text-[13px] font-black tracking-wide leading-tight shrink-0 ${signalCfg.bg} ${signalCfg.border} ${signalCfg.color} ${signalCfg.glow}`}>
                {signalCfg.label}
              </span>
              <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] sm:text-[10px] font-bold tracking-[0.1em] uppercase shrink-0 ${regimeTone}`}>
                {fractal.volatilityRegime}
              </span>
            </div>
          </div>
          {/* Right: score + confidence */}
          <div className="flex flex-col items-end gap-0.5 shrink-0 pl-1">
            <span className={`text-2xl sm:text-3xl font-black font-mono tabular-nums leading-none ${scoreTone}`}>
              {fractal.score > 0 ? '+' : ''}{fractal.score}
            </span>
            <span className={`text-[11px] sm:text-[12px] font-bold font-mono tabular-nums leading-none ${confidenceTone}`}>
              {fractal.confidence}%
            </span>
          </div>
        </div>

        {/* Score gauge ─────────────────────────────────────────────────── */}
        <div className="mt-3.5 flex items-center gap-2">
          <span className="text-[8px] sm:text-[9px] uppercase tracking-widest text-slate-500 font-semibold shrink-0 w-8">Bear</span>
          <div className="flex-1 h-2 rounded-full bg-slate-800/70 overflow-hidden relative min-w-0">
            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500/50 z-10" />
            <div
              className={`absolute inset-y-0 left-0 h-full rounded-full transition-all duration-500 ease-out bg-gradient-to-r ${gaugeGradient}`}
              style={{ width: `${scoreGaugePct}%` }}
            />
          </div>
          <span className="text-[8px] sm:text-[9px] uppercase tracking-widest text-slate-500 font-semibold shrink-0 w-8 text-right">Bull</span>
        </div>
        <div className="flex justify-between px-0 mt-0.5">
          <span className="text-[8px] font-mono text-slate-600">-100</span>
          <span className="text-[8px] font-mono text-slate-600">0</span>
          <span className="text-[8px] font-mono text-slate-600">+100</span>
        </div>
      </div>

      {/* ── Body: 3 columns on sm+, single column on xs ─────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-700/30 flex-1">

        {/* ── Col 1 · Multi-Timeframe Matrix ──────────────────────────── */}
        <div className="px-4 sm:px-3.5 py-3.5 flex flex-col gap-0 min-w-0">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold mb-2.5">MTF Matrix</p>
          <div className="flex flex-col gap-2">
            {tfEntries.map(({ key, label }) => {
              const tf     = fractal.mtf[key];
              const tfTone = FRACTAL_TREND_TONE[tf.trend] || FRACTAL_TREND_TONE.NEUTRAL;
              return (
                <div key={key} className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] sm:text-[11px] text-slate-300 w-12 shrink-0 font-semibold">{label}</span>
                  <QFMiniBar score={tf.score} />
                  <span className={`text-[10px] sm:text-[11px] font-mono font-black tabular-nums shrink-0 w-9 text-right ${qfScoreColor(tf.score)}`}>
                    {qfScoreFmt(tf.score)}
                  </span>
                  <span className={`hidden sm:inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold shrink-0 leading-tight ${tfTone}`}>
                    {tf.trend.replace('_', ' ')}
                  </span>
                </div>
              );
            })}
          </div>
          {/* Alignment bar */}
          <div className="mt-3 pt-2.5 border-t border-slate-700/25">
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-[11px] text-slate-300 shrink-0 font-semibold w-12">Align</span>
              <div className="flex-1 h-1.5 rounded-full bg-slate-800/60 overflow-hidden min-w-0">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${Math.max(0, Math.min(100, fractal.mtf.alignmentPct))}%` }}
                />
              </div>
              <span className="text-[11px] sm:text-[12px] font-mono font-black text-cyan-300 tabular-nums shrink-0 w-10 text-right">
                {fractal.mtf.alignmentPct}%
              </span>
            </div>
          </div>
        </div>

        {/* ── Col 2 · Probe Components ────────────────────────────────── */}
        <div className="px-4 sm:px-3.5 py-3.5 min-w-0">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold mb-2.5">Probe Components</p>
          <div className="flex flex-col gap-1.5">
            {probeRows.map(([label, val, isPct]) => (
              <div key={label as string} className="flex items-center gap-2 min-w-0">
                <span className="text-[10px] sm:text-[11px] text-slate-300 w-16 shrink-0 truncate font-semibold">{label as string}</span>
                <div className="flex-1 h-1.5 rounded-full bg-slate-800/60 overflow-hidden min-w-0 relative">
                  <div className="absolute inset-y-0 left-1/2 w-px bg-slate-600/40 z-10" />
                  {(val as number) >= 0
                    ? <div className="absolute inset-y-0 left-1/2 h-full rounded-r-full bg-emerald-400/55 transition-all duration-300" style={{ width: `${Math.min(50, Math.abs(val as number) / 2)}%` }} />
                    : <div className="absolute inset-y-0 right-1/2 h-full rounded-l-full bg-rose-400/55   transition-all duration-300" style={{ width: `${Math.min(50, Math.abs(val as number) / 2)}%` }} />
                  }
                </div>
                <span className={`text-[11px] sm:text-[12px] font-mono font-black tabular-nums shrink-0 w-12 text-right ${qfScoreColor(val as number)}`}>
                  {qfScoreFmt(val as number)}{isPct ? '%' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Col 3 · Predictive Behavior ─────────────────────────────── */}
        <div className="px-4 sm:px-3.5 py-3.5 min-w-0">
          <p className="text-[9px] sm:text-[10px] uppercase tracking-[0.15em] text-slate-400 font-bold mb-2.5">Predictive Behavior</p>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] sm:text-[13px] font-black leading-tight shrink-0 ${signalCfg.bg} ${signalCfg.border} ${signalCfg.color}`}>
                {nextIcon}&nbsp;{fractal.prediction.nextMove}
              </span>
              <span className={`text-[13px] sm:text-[15px] font-mono font-black tabular-nums shrink-0 ${confidenceTone}`}>
                {fractal.prediction.probabilityPct}%
              </span>
            </div>
            {/* Probability bar */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-slate-800/60 overflow-hidden min-w-0">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${fractal.prediction.probabilityPct >= 65 ? 'bg-emerald-400' : fractal.prediction.probabilityPct >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
                  style={{ width: `${Math.max(0, Math.min(100, fractal.prediction.probabilityPct))}%` }}
                />
              </div>
              <span className="text-[10px] sm:text-[11px] font-mono text-slate-400 tabular-nums shrink-0">{fractal.prediction.horizonSec}s</span>
            </div>
            {/* State */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] sm:text-[11px] text-slate-400 font-medium shrink-0">State</span>
              <span className={`text-[10px] sm:text-[11px] font-bold tracking-wide ${fractal.prediction.state === 'CONTINUATION' ? 'text-emerald-400' : 'text-amber-400'}`}>
                {fractal.prediction.state}
              </span>
            </div>
            {/* Rationale */}
            <p className="text-[10px] sm:text-[11px] text-slate-300 leading-relaxed break-words">{fractal.prediction.rationale}</p>
          </div>
        </div>
      </div>

      {/* ── Tags ────────────────────────────────────────────────────────── */}
      {fractal.tags.length > 0 && (
        <div className="px-4 sm:px-5 pb-3.5 pt-2.5 border-t border-slate-700/30 flex flex-wrap gap-1.5">
          {fractal.tags.map((tag) => (
            <span
              key={tag}
              className={`inline-flex items-center rounded-md border px-2.5 py-1 text-[10px] sm:text-[11px] font-semibold leading-tight ${FRACTAL_TAG_TONE[tag] || 'text-slate-300 border-slate-600/40 bg-slate-700/15'}`}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
});
QuantumFractalPanel.displayName = 'QuantumFractalPanel';
export { QuantumFractalPanel };

// ── Trade Decision Engine ────────────────────────────────────────────────
// Rule: CE strong + PE weak → BUY CE (market UP)
//       PE strong + CE weak → BUY PE (market DOWN)
//       Both strong         → CONFLICTING (wait)
//       Neither strong      → WAIT

// Signal-confirmed: CE or PE side is independently bullish
// Flow-confirmed: overall cross-strike score determines direction when ATM is ambiguous
type TradeDecision = 'BUY_CE' | 'BUY_PE' | 'CONFLICTING' | 'WAIT' | 'FLOW_BUY_CE' | 'FLOW_BUY_PE';

function deriveTradeDecision(
  ceSignal: StrikeSignal,
  peSignal: StrikeSignal,
  ceScore?: number,
  peScore?: number,
  overallScore?: number,
): TradeDecision {
  const isBullish = (s: StrikeSignal) => s === 'STRONG_BUY' || s === 'BUY';
  const ceBull = isBullish(ceSignal);
  const peBull = isBullish(peSignal);
  if (ceBull && !peBull) return 'BUY_CE';
  if (peBull && !ceBull) return 'BUY_PE';
  if (ceBull &&  peBull) return 'CONFLICTING';

  // When neither ATM side is bullish, fall back to score differential:
  // CE-PE net ≥ 18 → CE is less bearish than PE → net bullish bias → FLOW_BUY_CE
  // CE-PE net ≤ -18 → PE is less bearish than CE → net bearish bias → FLOW_BUY_PE
  if (ceScore !== undefined && peScore !== undefined) {
    const atmNet = ceScore - peScore;
    if (atmNet >= 18) return 'FLOW_BUY_CE';
    if (atmNet <= -18) return 'FLOW_BUY_PE';
  }
  // Final fallback: overall cross-strike intelligence score
  if (overallScore !== undefined) {
    if (overallScore >= 15) return 'FLOW_BUY_CE';
    if (overallScore <= -15) return 'FLOW_BUY_PE';
  }
  return 'WAIT';
}

const DECISION_CFG: Record<TradeDecision, {
  label: string; icon: string;
  bg: string; border: string; color: string; subColor: string;
  decisionBg: string; pulse: boolean;
}> = {
  BUY_CE:       { label: 'BUY CALL (CE)',        icon: '▲', bg: 'bg-emerald-950/60',  border: 'border-emerald-400/80',  color: 'text-emerald-200', subColor: 'text-emerald-400',  decisionBg: 'bg-emerald-500/25', pulse: true  },
  BUY_PE:       { label: 'BUY PUT (PE)',         icon: '▼', bg: 'bg-red-950/60',      border: 'border-red-400/80',      color: 'text-red-200',     subColor: 'text-red-400',      decisionBg: 'bg-red-500/25',     pulse: true  },
  FLOW_BUY_CE:  { label: 'FLOW: BUY CE ↗',       icon: '↗', bg: 'bg-cyan-950/60',    border: 'border-cyan-400/60',     color: 'text-cyan-200',    subColor: 'text-cyan-400',     decisionBg: 'bg-cyan-500/20',    pulse: true  },
  FLOW_BUY_PE:  { label: 'FLOW: BUY PE ↘',       icon: '↘', bg: 'bg-orange-950/60',  border: 'border-orange-400/60',   color: 'text-orange-200',  subColor: 'text-orange-400',   decisionBg: 'bg-orange-500/20',  pulse: true  },
  CONFLICTING:  { label: 'CONFLICTING — WAIT',   icon: '⚡', bg: 'bg-amber-950/60',  border: 'border-amber-400/60',    color: 'text-amber-200',   subColor: 'text-amber-400',    decisionBg: 'bg-amber-500/20',   pulse: false },
  WAIT:         { label: 'NO CLEAR SIGNAL — WAIT', icon: '■', bg: 'bg-slate-800/60', border: 'border-slate-600/50',  color: 'text-slate-400',   subColor: 'text-slate-500',    decisionBg: 'bg-slate-700/40',   pulse: false },
};

const DECISION_BADGE_CFG: Record<TradeDecision, {
  label: string;
  arrow: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
}> = {
  BUY_CE:      { label: 'BUY CE',     arrow: '▲',  color: 'text-emerald-200', bg: 'bg-emerald-500/25', border: 'border-emerald-400/70', glow: 'shadow-[0_0_12px_2px_rgba(52,211,153,0.35)]' },
  BUY_PE:      { label: 'BUY PE',     arrow: '▼',  color: 'text-red-200',     bg: 'bg-red-500/25',     border: 'border-red-400/70',     glow: 'shadow-[0_0_12px_2px_rgba(251,113,133,0.35)]' },
  FLOW_BUY_CE: { label: 'FLOW BUY CE', arrow: '↗', color: 'text-cyan-200',    bg: 'bg-cyan-500/20',    border: 'border-cyan-400/60',    glow: 'shadow-[0_0_10px_1px_rgba(34,211,238,0.25)]' },
  FLOW_BUY_PE: { label: 'FLOW BUY PE', arrow: '↘', color: 'text-orange-200',  bg: 'bg-orange-500/20',  border: 'border-orange-400/60',  glow: 'shadow-[0_0_10px_1px_rgba(251,146,60,0.25)]' },
  CONFLICTING: { label: 'WAIT',       arrow: '⚡', color: 'text-amber-200',   bg: 'bg-amber-500/20',   border: 'border-amber-400/60',   glow: '' },
  WAIT:        { label: 'WAIT',       arrow: '■',  color: 'text-slate-300',   bg: 'bg-slate-700/40',   border: 'border-slate-500/50',   glow: '' },
};

const SUB_TEXT: Record<TradeDecision, string> = {
  BUY_CE:       'CE is STRONG  ·  PE is WEAK  →  Market going UP',
  BUY_PE:       'PE is STRONG  ·  CE is WEAK  →  Market going DOWN',
  FLOW_BUY_CE:  'Cross-strike flow is net BULLISH — CE less bearish than PE  →  Lean UP',
  FLOW_BUY_PE:  'Cross-strike flow is net BEARISH — PE less bearish than CE  →  Lean DOWN',
  CONFLICTING:  'CE and PE both showing strength — direction unclear, stay out',
  WAIT:         'Neither CE nor PE is strong enough — no trade setup',
};

const TradeActionBanner = memo<{
  atmCeSignal: StrikeSignal; atmCeScore: number;
  atmPeSignal: StrikeSignal; atmPeScore: number;
  overallScore: number; confidence: number;
}>(({ atmCeSignal, atmCeScore, atmPeSignal, atmPeScore, overallScore, confidence }) => {
  const decision = deriveTradeDecision(atmCeSignal, atmPeSignal, atmCeScore, atmPeScore, overallScore);
  const cfg      = DECISION_CFG[decision];
  const ceCfg    = SIGNAL_CONFIG[atmCeSignal];
  const peCfg    = SIGNAL_CONFIG[atmPeSignal];
  // ceActive: highlight CE pane for signal-confirmed AND flow-confirmed CE bias
  const ceActive = decision === 'BUY_CE' || decision === 'FLOW_BUY_CE';
  // peActive: highlight PE pane for signal-confirmed AND flow-confirmed PE bias
  const peActive = decision === 'BUY_PE' || decision === 'FLOW_BUY_PE';

  return (
    <div className={`rounded-xl border mb-3 overflow-hidden transition-all duration-300 ${cfg.border}`}>

      {/* Row 1: ATM CE  vs  ATM PE — side-by-side comparison */}
      <div className="grid grid-cols-[1fr_28px_1fr]">

        {/* CE side */}
        <div className={`flex flex-col items-center gap-0.5 py-2 px-2 transition-all duration-300 ${
          decision === 'BUY_CE'      ? 'bg-emerald-500/20 shadow-inner' :
          decision === 'FLOW_BUY_CE' ? 'bg-cyan-500/15 shadow-inner'   : 'bg-slate-800/50 opacity-60'
        }`}>
          <span className="text-[9px] font-black tracking-widest uppercase text-emerald-400/80">CE · CALL</span>
          <span className={`text-[12px] sm:text-[14px] font-black leading-tight ${ceCfg.color} ${
            ceActive ? 'scale-105' : ''
          } transition-transform duration-300`}>
            {decision === 'BUY_CE' ? '▲ ' : decision === 'FLOW_BUY_CE' ? '↗ ' : ''}{ceCfg.label}
          </span>
          <span className="text-[9px] font-mono text-slate-500 tabular-nums">
            score: {atmCeScore > 0 ? '+' : ''}{atmCeScore}
          </span>
          {decision === 'BUY_CE' && (
            <span className="text-[9px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-400/40 px-1.5 py-0 rounded mt-0.5">
              ✓ ACTIVE SIDE
            </span>
          )}
          {decision === 'FLOW_BUY_CE' && (
            <span className="text-[9px] font-bold text-cyan-300 bg-cyan-500/20 border border-cyan-400/40 px-1.5 py-0 rounded mt-0.5">
              ↗ FLOW BIAS
            </span>
          )}
        </div>

        {/* VS divider */}
        <div className="flex items-center justify-center bg-slate-900/60 border-x border-slate-700/40">
          <span className="text-[9px] text-slate-500 font-bold rotate-90 sm:rotate-0">vs</span>
        </div>

        {/* PE side */}
        <div className={`flex flex-col items-center gap-0.5 py-2 px-2 transition-all duration-300 ${
          decision === 'BUY_PE'      ? 'bg-red-500/20 shadow-inner'    :
          decision === 'FLOW_BUY_PE' ? 'bg-orange-500/15 shadow-inner' : 'bg-slate-800/50 opacity-60'
        }`}>
          <span className="text-[9px] font-black tracking-widest uppercase text-red-400/80">PE · PUT</span>
          <span className={`text-[12px] sm:text-[14px] font-black leading-tight ${peCfg.color} ${
            peActive ? 'scale-105' : ''
          } transition-transform duration-300`}>
            {decision === 'BUY_PE' ? '▼ ' : decision === 'FLOW_BUY_PE' ? '↘ ' : ''}{peCfg.label}
          </span>
          <span className="text-[9px] font-mono text-slate-500 tabular-nums">
            score: {atmPeScore > 0 ? '+' : ''}{atmPeScore}
          </span>
          {decision === 'BUY_PE' && (
            <span className="text-[9px] font-bold text-red-300 bg-red-500/20 border border-red-400/40 px-1.5 py-0 rounded mt-0.5">
              ✓ ACTIVE SIDE
            </span>
          )}
          {decision === 'FLOW_BUY_PE' && (
            <span className="text-[9px] font-bold text-orange-300 bg-orange-500/20 border border-orange-400/40 px-1.5 py-0 rounded mt-0.5">
              ↘ FLOW BIAS
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Decision — the action to take */}
      <div className={`flex items-center justify-between gap-2 px-3 py-2 border-t ${cfg.border} ${cfg.decisionBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[22px] leading-none shrink-0">{cfg.icon}</span>
          <div className="flex flex-col min-w-0">
            <span className={`text-[13px] sm:text-[16px] font-black tracking-wide leading-tight ${cfg.color} ${
              cfg.pulse ? 'animate-pulse' : ''
            }`}>
              {cfg.label}
            </span>
            <span className={`text-[10px] sm:text-[11px] font-medium leading-snug ${cfg.subColor} mt-0.5`}>
              {SUB_TEXT[decision]}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className={`text-[11px] font-black font-mono ${cfg.color} tabular-nums`}>
            {overallScore > 0 ? '+' : ''}{overallScore}
          </span>
          <span className={`text-[10px] font-bold tabular-nums ${
            confidence >= 70 ? 'text-emerald-400' : confidence >= 45 ? 'text-amber-400' : 'text-red-400'
          }`}>{confidence}%</span>
        </div>
      </div>
    </div>
  );
});
TradeActionBanner.displayName = 'TradeActionBanner';

// Side Cell
// 
// FINAL TRADING PRIORITY (Applied Internally):
// 1. Momentum/Breakout (NON-NEGOTIABLE) - Signal strength 10-factor basis
// 2. IV Expansion (Entry timing edge) - σ IV indicator
// 3. Delta (Strike selection) - Δ 0.45–0.60 for ATM/slightly ITM
// 4. Gamma (Speed of profit) - Γ highest at ATM, acceleration engine
// 5. Volume (Confirmation + liquidity) - V dominance signals smart money
// 6. Theta (Risk awareness) - Θ time decay consideration
//
// Display: Only STRONG_BUY and STRONG_SELL signals shown (high conviction)
// Weaker signals (BUY, SELL, NEUTRAL) are hidden to reduce noise
//

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE'; volDominant: boolean; oiDominant: boolean; isATM: boolean; symbolKey: SymbolKey; displayVolume?: number; displaySignalOverride?: StrikeSignal }>(({ side, label, volDominant, oiDominant, isATM, symbolKey, displayVolume, displaySignalOverride }) => {
  const isCE = label === 'CE';
  const displayVolumeSafe = Math.max(0, displayVolume ?? side.volume);

  // ── Price flash detection — brief highlight on each price tick ────────
  const prevPriceRef = useRef<number>(side.price);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [flashAnimKey, setFlashAnimKey] = useState(0);
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);
  const prevVolumeRef = useRef<number>(displayVolumeSafe);
  const volumeFlashTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [volumeFlashDir, setVolumeFlashDir] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    const prev = prevPriceRef.current;
    const curr = side.price;
    prevPriceRef.current = curr;
    if (prev > 0 && Math.abs(curr - prev) > 0.05) {
      setFlashDir(curr > prev ? 'up' : 'down');
      setFlashAnimKey(k => k + 1);
      clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashDir(null), 700);
    }
    return () => clearTimeout(flashTimerRef.current);
  }, [side.price]);

  useEffect(() => {
    const prev = prevVolumeRef.current;
    const curr = displayVolumeSafe;
    prevVolumeRef.current = curr;
    if (curr === prev) return;
    setVolumeFlashDir(curr > prev ? 'up' : 'down');
    clearTimeout(volumeFlashTimerRef.current);
    volumeFlashTimerRef.current = setTimeout(() => setVolumeFlashDir(null), 650);
    return () => clearTimeout(volumeFlashTimerRef.current);
  }, [displayVolumeSafe]);

  // ── Velocity heat level ───────────────────────────────────────────────
  const heatLevel = side.velocity === 'EXTREME' ? 3
    : side.velocity === 'HOT'     ? 2
    : side.velocity === 'WARM'    ? 1
    : 0;

  // Raw backend signal — all advanced factors, updates every 0.5s
  const displaySignal    = displaySignalOverride ?? side.signal;
  // Conviction gate — only for checklist / glow
  const convictionSignal = getHighConvictionSignal(side, symbolKey);
  const isBuyable        = convictionSignal === 'STRONG_BUY';
  const isStrongSell     = convictionSignal === 'STRONG_SELL';
  const isFullConviction = isBuyable || isStrongSell;

  const isActive  = displaySignal === 'BUY'  || displaySignal === 'STRONG_BUY';
  const isSelling = displaySignal === 'SELL' || displaySignal === 'STRONG_SELL';
  const isNeutral = displaySignal === 'NEUTRAL';

  const sigs    = side.signals;
  const buyPct  = Math.round(side.breakdown.buyPct);
  const sellPct = Math.round(side.breakdown.sellPct);
  const oiChg   = side.oiChange ?? 0;
  const oiInterp = sigs?.oiInterp;
  const advPA    = sigs?.advPriceAction;
  const rules    = CONVICTION_RULES_BY_SYMBOL[symbolKey];

  // ── Cell chrome ──────────────────────────────────────────────────────
  const bg = isFullConviction
    ? (isCE ? 'bg-emerald-500/[0.15]' : 'bg-red-500/[0.15]')
    : isActive
      ? (isCE ? 'bg-emerald-500/[0.08]' : 'bg-red-500/[0.08]')
      : isSelling
        ? 'bg-slate-800/50'
        : 'bg-slate-800/30';

  // Heat border enhancement — layered on top of conviction/ATM borders
  const heatBorderExtra = !isFullConviction && !isATM
    ? heatLevel >= 3
      ? (isCE
          ? 'border-2 border-emerald-300 shadow-[0_0_12px_3px_rgba(52,211,153,0.35)] sm:shadow-[0_0_28px_6px_rgba(52,211,153,0.70)]'
          : 'border-2 border-red-300     shadow-[0_0_12px_3px_rgba(239,68,68,0.35)] sm:shadow-[0_0_28px_6px_rgba(239,68,68,0.70)]')
      : heatLevel >= 2
        ? (isCE
            ? 'border-2 border-emerald-400/90 shadow-[0_0_10px_2px_rgba(52,211,153,0.25)] sm:shadow-[0_0_18px_4px_rgba(52,211,153,0.50)]'
            : 'border-2 border-red-400/90     shadow-[0_0_10px_2px_rgba(239,68,68,0.25)] sm:shadow-[0_0_18px_4px_rgba(239,68,68,0.50)]')
        : heatLevel >= 1
          ? (isCE ? 'border-2 border-emerald-600/50' : 'border-2 border-red-600/50')
          : ''
    : '';

  const border = heatBorderExtra || (isATM
    ? 'border-2 border-cyan-300/65 shadow-[0_0_6px_1px_rgba(34,211,238,0.12)] sm:shadow-[0_0_10px_0_rgba(34,211,238,0.18)]'
    : isFullConviction
      ? (isCE
          ? 'border-2 border-emerald-400 shadow-[0_0_10px_2px_rgba(52,211,153,0.35)] sm:shadow-[0_0_16px_4px_rgba(52,211,153,0.55),inset_0_0_8px_0_rgba(52,211,153,0.15)]'
          : 'border-2 border-red-400     shadow-[0_0_10px_2px_rgba(239,68,68,0.35)] sm:shadow-[0_0_16px_4px_rgba(239,68,68,0.55),inset_0_0_8px_0_rgba(239,68,68,0.15)]')
      : isActive
        ? (isCE ? 'border-2 border-emerald-600/40' : 'border-2 border-red-600/40')
        : 'border-2 border-slate-700/30');

  // ── OI Change label (highlighted when significant) ───────────────────
  const oiChgAbs = Math.abs(oiChg);
  const oiChgStr = oiChg === 0 ? '—' : `${oiChg > 0 ? '+' : ''}${fmtNum(oiChg)}`;

  // OI interpretation badge
  const oiInterpLabel: Record<string, string> = { LB: 'L.BLD', SB: 'S.BLD', SC: 'S.CVR', LU: 'L.UNW' };
  const oiInterpCls: Record<string, string> = {
    LB: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40',
    SC: 'text-cyan-300    bg-cyan-500/20    border-cyan-500/40',
    SB: 'text-red-300     bg-red-500/20     border-red-500/40',
    LU: 'text-orange-300  bg-orange-500/20  border-orange-500/40',
  };

  const advPaLabel: Record<string, string> = {
    IMPULSE_CONTINUATION: 'PA+IMP',
    OPPOSITE_WEAKNESS: 'PA-OPP',
    VOL_EXPANSION_NO_EDGE: 'PA-NSE',
    OTM_EXHAUSTION: 'PA-EXH',
  };
  const advPaCls: Record<string, string> = {
    IMPULSE_CONTINUATION: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40',
    OPPOSITE_WEAKNESS: 'text-red-300 bg-red-500/20 border-red-500/40',
    VOL_EXPANSION_NO_EDGE: 'text-slate-300 bg-slate-500/20 border-slate-500/40',
    OTM_EXHAUSTION: 'text-amber-300 bg-amber-500/20 border-amber-500/40',
  };

  // Volume highlight — bright with border if dominant
  const volCls = volDominant
    ? (isCE 
        ? 'text-emerald-200 bg-emerald-500/25 border border-emerald-500/60 rounded px-1 py-0.5 font-black' 
        : 'text-red-200 bg-red-500/25 border border-red-500/60 rounded px-1 py-0.5 font-black')
    : 'text-slate-400 font-semibold';
  // OI highlight — bright with border if dominant
  const oiCls = oiDominant
    ? (isCE 
        ? 'text-cyan-200 bg-cyan-500/25 border border-cyan-500/60 rounded px-1 py-0.5 font-black' 
        : 'text-orange-200 bg-orange-500/25 border border-orange-500/60 rounded px-1 py-0.5 font-black')
    : 'text-slate-400 font-semibold';

  // Buy% / Sell% dominant highlight
  const flowCls = isActive
    ? (isCE ? 'text-emerald-300 font-black' : 'text-red-300 font-black')
    : isSelling
      ? 'text-red-400 font-bold'
      : 'text-slate-400';

  const paBase = Math.max(Math.abs(side.price - side.change), 1.0);
  const paPct = (side.change / paBase) * 100.0;
  const paPctStr = `${paPct >= 0 ? '+' : ''}${paPct.toFixed(1)}%`;
  const paCls = paPct >= 0
    ? 'text-emerald-200 bg-emerald-500/20 border border-emerald-500/40 rounded px-1 py-0.5 font-black'
    : 'text-red-200 bg-red-500/20 border border-red-500/40 rounded px-1 py-0.5 font-black';

  return (
    <div style={{ willChange: 'transform' }} className={`relative flex flex-col gap-1 sm:gap-1.5 px-1 sm:px-1.5 py-1 sm:py-1.5 rounded-lg transition-colors duration-150 w-full min-w-0 shrink-0 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)] ${bg} ${border} ${isNeutral ? 'opacity-65' : ''}`}>

      {/* Price flash overlay — remounts on each animKey change to restart animation */}
      {flashDir && (
        <div
          key={flashAnimKey}
          className={`absolute inset-0 pointer-events-none rounded-lg ${
            flashDir === 'up' ? 'animate-flash-green' : 'animate-flash-red'
          }`}
        />
      )}

      {/* Velocity heat strip at top — 3px bar showing how fast this side is moving */}
      {heatLevel >= 1 && (
        <div className={`absolute top-0 left-0 right-0 h-[3px] ${
          heatLevel >= 3
            ? (isCE ? 'bg-emerald-400 animate-pulse' : 'bg-red-400 animate-pulse')
            : heatLevel >= 2
              ? (isCE ? 'bg-emerald-500/90' : 'bg-red-500/90')
              : (isCE ? 'bg-emerald-600/50' : 'bg-red-600/50')
        }`} />
      )}

      {/* FAST / EXTREME badge — ALWAYS allocated space to prevent vertical shift */}
      <div className={`flex ${isCE ? 'justify-start' : 'justify-end'} h-[16px] sm:h-[18px] items-center`}>
        {heatLevel >= 2 && (
          <span className={`w-[56px] sm:w-[62px] text-center text-[9px] sm:text-[10px] font-black px-0.5 sm:px-1 py-[1px] rounded uppercase tracking-widest leading-tight min-h-[14px] sm:min-h-[16px] flex items-center justify-center tabular-nums ${
            heatLevel >= 3
              ? (isCE
                  ? 'bg-emerald-500/35 text-emerald-100 border border-emerald-300/70 animate-pulse'
                  : 'bg-red-500/35     text-red-100     border border-red-300/70     animate-pulse')
              : (isCE
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'bg-red-500/20     text-red-300     border border-red-500/40')
          }`}>
            {heatLevel >= 3 ? '⚡⚡XTREME' : '⚡FAST'}
          </span>
        )}
      </div>

      {/* ── ROW 1: Status only ───────────────────────────────────────── */}
      <div className={`flex items-center ${isCE ? 'justify-start' : 'justify-end'} min-h-[20px]`}>
        <div className={`${isCE ? 'text-left' : 'text-right'}`}>
          <SignalBadge signal={toBuyerPerspectiveSignal(displaySignal === 'NEUTRAL' ? side.signal : displaySignal)} side={label} />
        </div>
      </div>

      {/* ── ROW 2: Buy%/Sell% pressure bar ──────────────────────────── */}
      <div className="hidden sm:block">
        <LiquidityBar buyPct={side.breakdown.buyPct} sellPct={side.breakdown.sellPct} neutralPct={side.breakdown.neutralPct} />
      </div>

      {/* ── ROW 3: Unified metrics box (Volume | OI | Price Action) ───── */}
      <div className="min-w-0 rounded-md border border-slate-600/70 bg-slate-900/60 px-1.5 sm:px-2 py-1.5 sm:py-2">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-slate-700/40 pb-1 sm:pb-1.5">
          <span className="text-[9px] sm:text-[11px] font-bold tracking-wide text-slate-200">Volume</span>
          <span className={`text-right text-[11px] sm:text-[13px] font-mono font-black tabular-nums truncate ${volCls} ${volumeFlashDir === 'up' ? 'bg-emerald-500/20 text-emerald-100 rounded px-1' : volumeFlashDir === 'down' ? 'bg-red-500/20 text-red-100 rounded px-1' : ''}`}>
            {fmtNum(displayVolumeSafe)}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 border-b border-slate-700/40 py-1 sm:py-1.5">
          <span className="text-[9px] sm:text-[11px] font-bold tracking-wide text-slate-200">OI</span>
          <span className={`text-right text-[11px] sm:text-[13px] font-mono font-black tabular-nums truncate ${oiCls}`}>
            {fmtNum(side.oi)}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 pt-1 sm:pt-1.5">
          <span className="text-[9px] sm:text-[11px] font-bold tracking-wide text-slate-200">Price Action</span>
          <span className={`text-right text-[11px] sm:text-[13px] font-mono font-black tabular-nums truncate ${paCls}`}>
            {paPctStr}
          </span>
        </div>
      </div>

      {/* ── ROW 4: Compact badges (space-optimized) */}
      <div className={`flex items-center gap-1.5 flex-wrap text-[10px] sm:text-[12px] font-black min-w-0 ${isCE ? '' : 'flex-row-reverse'}`}>
        {/* OI Interpretation badge — the most informative single value */}
        {oiInterp && (
          <span className={`font-black px-1 sm:px-1.5 py-0.5 rounded border leading-tight max-w-full shrink-0 text-[9px] sm:text-[11px] ${oiInterpCls[oiInterp] ?? 'text-slate-500'}`}>
            {oiInterpLabel[oiInterp] ?? oiInterp}
          </span>
        )}

        {/* Advanced price-action state from CE/PE premium continuation/exhaustion */}
        {advPA && (
          <span className={`font-black px-1 sm:px-1.5 py-0.5 rounded border leading-tight max-w-full shrink-0 text-[9px] sm:text-[11px] ${advPaCls[advPA] ?? 'text-slate-500'}`}>
            {advPaLabel[advPA] ?? advPA}
          </span>
        )}

        {/* TRAP warning icon intentionally hidden */}

        {/* B%/S% flow — only when noteworthy */}
        {(buyPct >= 60 || sellPct >= 60) && (
          <span className={`hidden sm:inline font-mono text-[10px] sm:text-[12px] font-black tabular-nums ml-auto shrink-0 ${flowCls}`}>
            B{buyPct}·S{sellPct}
          </span>
        )}
      </div>

      {/* ── ROW 6 (conviction only): Pre-Trade checklist ─────────────── */}
      {isFullConviction && (
        <div className={`hidden flex flex-col gap-[3px] rounded-md px-1 py-1 border mt-0.5 ${
          isCE ? 'bg-emerald-950/60 border-emerald-500/40' : 'bg-red-950/60 border-red-500/40'
        }`}>
          <span className={`text-[9px] font-black tracking-widest uppercase mb-0.5 ${isCE ? 'text-emerald-400' : 'text-red-400'}`}>
            ✓ Pre-Trade
          </span>
          {[
            { label: isBuyable ? 'Buy%' : 'Sell%', value: isBuyable ? `${buyPct}%` : `${sellPct}%`, pass: isBuyable ? buyPct >= rules.minBuyPct : sellPct >= rules.minSellPct },
            { label: 'Volume',   value: fmtNum(side.volume), pass: side.volume >= rules.minVolume },
            { label: 'OI Depth', value: fmtNum(side.oi),     pass: side.oi >= rules.minOI },
            { label: 'ΔOI',      value: oiChgStr,            pass: oiChgAbs >= rules.minOIChange || !!oiInterp },
          ].map((p, i) => (
            <div key={i} className={`flex items-center justify-between gap-1 ${isCE ? '' : 'flex-row-reverse'}`}>
              <span className={`text-[11px] font-semibold shrink-0 ${p.pass ? (isCE ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                {p.pass ? '✓' : '✗'} {p.label}
              </span>
              <span className={`text-[11px] font-mono font-bold tabular-nums px-0.5 rounded truncate ${
                p.pass ? (isCE ? 'text-emerald-200 bg-emerald-500/20' : 'text-red-200 bg-red-500/20') : 'text-slate-500 bg-slate-800/60'
              }`}>{p.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
SideCell.displayName = 'SideCell';

// Strike Row

const StrikeRowComponent = memo<{ row: StrikeRow; maxVol: number; maxOI: number; symbolKey: SymbolKey }>(({ row, maxVol, maxOI, symbolKey }) => {
  const isATM = row.isATM;
  const ceDisplayVol = Math.max(0, row.ce.volume);
  const peDisplayVol = Math.max(0, row.pe.volume);
  const totalVol  = row.ce.volume + row.pe.volume;
  const totalOI   = row.ce.oi    + row.pe.oi;
  const volIntensity = maxVol > 0 ? Math.min(totalVol / maxVol, 1) : 0;
  const oiIntensity  = maxOI  > 0 ? Math.min(totalOI  / maxOI,  1) : 0;

  // Compute high-conviction signals at the row level for row-wide highlighting
  const ceConv = getHighConvictionSignal(row.ce, symbolKey);
  const peConv = getHighConvictionSignal(row.pe, symbolKey);
  const buyerDisplaySignals = resolveBuyerDisplaySignals(row.ce, row.pe, symbolKey);
  const ceStrong = ceConv === 'STRONG_BUY' || ceConv === 'STRONG_SELL';
  const peStrong = peConv === 'STRONG_BUY' || peConv === 'STRONG_SELL';

  // ── Velocity-based fast-moving auto-highlight ─────────────────────────
  // When one side is moving significantly faster, the row background leans that way.
  const VEL_RANK: Record<string, number> = { EXTREME: 3, HOT: 2, WARM: 1, COLD: 0 };
  const ceVelRank = VEL_RANK[row.ce.velocity ?? 'COLD'] ?? 0;
  const peVelRank = VEL_RANK[row.pe.velocity ?? 'COLD'] ?? 0;
  const fastSide  = ceVelRank > peVelRank ? 'ce' : peVelRank > ceVelRank ? 'pe' : null;
  const fastHeat  = fastSide ? Math.max(ceVelRank, peVelRank) : 0;

  // Row border: conviction takes priority over everything
  const rowBorder =
    ceStrong && peStrong ? 'border-[2px] sm:border-[3px] border-amber-400/90 shadow-[0_0_8px_2px_rgba(251,191,36,0.2)] sm:shadow-[0_0_20px_4px_rgba(251,191,36,0.35)]' :
    ceConv === 'STRONG_BUY'  ? 'border-[2px] sm:border-[3px] border-emerald-400/90 shadow-[0_0_8px_2px_rgba(52,211,153,0.2)] sm:shadow-[0_0_20px_4px_rgba(52,211,153,0.35)]' :
    peConv === 'STRONG_BUY'  ? 'border-[2px] sm:border-[3px] border-red-400/90    shadow-[0_0_8px_2px_rgba(239,68,68,0.2)] sm:shadow-[0_0_20px_4px_rgba(239,68,68,0.35)]' :
    ceConv === 'STRONG_SELL' ? 'border-[2px] sm:border-[3px] border-red-400/90    shadow-[0_0_8px_2px_rgba(239,68,68,0.2)] sm:shadow-[0_0_20px_4px_rgba(239,68,68,0.35)]' :
    peConv === 'STRONG_SELL' ? 'border-[2px] sm:border-[3px] border-emerald-400/90 shadow-[0_0_8px_2px_rgba(52,211,153,0.2)] sm:shadow-[0_0_20px_4px_rgba(52,211,153,0.35)]' :
    // Fast-moving row border — when velocity is HOT/EXTREME and no conviction override
    fastHeat >= 2 && fastSide === 'ce' ? 'border-2 border-emerald-500/60 shadow-[0_0_6px_1px_rgba(52,211,153,0.15)] sm:shadow-[0_0_12px_2px_rgba(52,211,153,0.25)]' :
    fastHeat >= 2 && fastSide === 'pe' ? 'border-2 border-red-500/60     shadow-[0_0_6px_1px_rgba(239,68,68,0.15)] sm:shadow-[0_0_12px_2px_rgba(239,68,68,0.25)]' :
    isATM ? 'border-[2px] border-cyan-300/70' :
    'border border-slate-700/30';

  const rowBg =
    ceConv === 'STRONG_BUY'  ? 'bg-emerald-500/[0.09]' :
    peConv === 'STRONG_BUY'  ? 'bg-red-500/[0.09]' :
    ceConv === 'STRONG_SELL' ? 'bg-red-500/[0.09]' :
    peConv === 'STRONG_SELL' ? 'bg-emerald-500/[0.09]' :
    // Fast-moving background tint — velocity auto-highlights the active side
    fastHeat >= 2 && fastSide === 'ce' ? 'bg-emerald-500/[0.06]' :
    fastHeat >= 2 && fastSide === 'pe' ? 'bg-red-500/[0.06]' :
    isATM              ? 'bg-cyan-400/[0.10]' :
    volIntensity > 0.7 ? (row.ce.volume > row.pe.volume ? 'bg-emerald-500/[0.04]' : 'bg-red-500/[0.04]') : '';

  // Strike center: number highlight when conviction met on either side
  const strikeNumberCls = ceStrong || peStrong
    ? (ceConv === 'STRONG_BUY' || peConv === 'STRONG_SELL'
        ? 'text-[11px] sm:text-[13px] font-black font-mono text-emerald-200 drop-shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
        : 'text-[11px] sm:text-[13px] font-black font-mono text-red-200 drop-shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse')
    : isATM ? 'text-[10px] sm:text-[11px] font-black font-mono text-cyan-300'
    : 'text-[10px] sm:text-[11px] font-black font-mono text-slate-300';

  // "TRADE" badge in strike center when conviction met
  const tradeBadge = ceConv === 'STRONG_BUY'
    ? { label: '▲ BUY CE', cls: 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/70' }
    : peConv === 'STRONG_BUY'
    ? { label: '▼ BUY PE', cls: 'bg-red-500/30     text-red-200     border border-red-400/70' }
    : ceConv === 'STRONG_SELL'
    ? { label: '▼ CE SELL', cls: 'bg-red-500/30    text-red-200     border border-red-400/70' }
    : peConv === 'STRONG_SELL'
    ? { label: '▲ PE SELL', cls: 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/70' }
    : null;

  return (
      <div className={`flex items-stretch gap-0.5 sm:gap-1 rounded-lg transition-all duration-300 overflow-x-visible ${rowBg} ${rowBorder} ${
      isATM ? 'ring-1 ring-cyan-300/25' : ''
    } hover:bg-white/[0.025]`} style={{ overflow: 'visible' }}>
      {/* CE box with light background */}
      <div className="bg-slate-900/30 border border-slate-500/90 rounded-lg overflow-hidden flex-1 min-w-0">
        <SideCell side={row.ce} label="CE" volDominant={ceDisplayVol > peDisplayVol} oiDominant={row.ce.oi > row.pe.oi} isATM={isATM} symbolKey={symbolKey} displayVolume={ceDisplayVol} displaySignalOverride={buyerDisplaySignals.ce} />
      </div>

      {/* Strike center */}
      <div className={`flex flex-col items-center justify-center gap-0.5 sm:gap-0.5 px-0.5 sm:px-1.5 py-1 sm:py-1.5 border-x shrink-0 min-w-[88px] sm:min-w-0 ${
        ceStrong || peStrong ? 'bg-slate-900/80 border-slate-600/60' :
        isATM ? 'border-cyan-300/50 bg-cyan-400/[0.08]' : 'border-slate-700/40'
      }`}>
        <span className={`${strikeNumberCls} w-full text-center text-[13px] sm:text-[16px] md:text-[18px] lg:text-[20px] px-1 py-0.5 rounded border border-cyan-400/60 bg-slate-900/70`}>{row.strike.toLocaleString('en-IN')}</span>
        
        {/* CE and PE prices with divergence highlighting */}
        {(() => {
          const cePrice = row.ce.price;
          const pePrice = row.pe.price;
          const priceRatio = pePrice > 0 ? cePrice / pePrice : 1;
          const isDivergent = priceRatio > 1.8 || priceRatio < 0.56; // Strong divergence threshold
          const volRatio = row.ce.volume / (row.pe.volume > 0 ? row.pe.volume : 1);
          const oiRatio = row.ce.oi / (row.pe.oi > 0 ? row.pe.oi : 1);
          const isVolDominant = volRatio > 2 || volRatio < 0.5;
          const isOIDominant = oiRatio > 2 || oiRatio < 0.5;

          const centerBoxCls = `rounded transition-all w-[92px] sm:w-[104px] ${
            isDivergent || isVolDominant || isOIDominant
              ? 'border-[1px] sm:border-[1.5px] bg-slate-900/60'
              : 'border border-slate-700/20'
          } ${
            isDivergent ? (cePrice > pePrice
              ? 'border-emerald-500/70 shadow-[0_0_6px_1px_rgba(52,211,153,0.2)] sm:shadow-[0_0_8px_2px_rgba(52,211,153,0.25)]'
              : 'border-red-500/70 shadow-[0_0_6px_1px_rgba(239,68,68,0.2)] sm:shadow-[0_0_8px_2px_rgba(239,68,68,0.25)]')
            : isVolDominant || isOIDominant
            ? 'border-amber-500/60 shadow-[0_0_4px_0.5px_rgba(251,191,36,0.15)] sm:shadow-[0_0_6px_1px_rgba(251,191,36,0.2)]'
            : 'border-slate-700/20'
          }`;

          return (
            <div className={`mt-0.5 sm:mt-0.5 px-1 sm:px-1.5 py-1 sm:py-1.5 font-mono font-black text-[9px] sm:text-[11px] md:text-[12px] ${centerBoxCls}`}>
              <div className="sm:hidden flex flex-col gap-1 min-w-[78px]">
                <div className="flex flex-col items-stretch gap-0.5 min-w-0">
                  <span className="min-w-0 text-center text-[9px] uppercase tracking-[0.18em] text-slate-400 whitespace-nowrap">CE</span>
                  <span className={`w-full text-center tabular-nums text-[12px] leading-none px-1 py-0.5 rounded border ${
                    ceConv === 'STRONG_BUY' ? 'text-emerald-300' :
                    ceConv === 'STRONG_SELL' ? 'text-red-300' :
                    cePrice > pePrice && isDivergent ? 'text-emerald-300' :
                    'text-slate-300'
                  } ${
                    ceConv === 'STRONG_BUY' ? 'border-emerald-400/60 bg-emerald-500/10' :
                    ceConv === 'STRONG_SELL' ? 'border-red-400/60 bg-red-500/10' :
                    'border-slate-600/60 bg-slate-900/70'
                  }`}>
                    {cePrice.toFixed(1)}
                  </span>
                </div>
                <div className="flex flex-col items-stretch gap-0.5 min-w-0">
                  <span className="min-w-0 text-center text-[9px] uppercase tracking-[0.18em] text-slate-400 whitespace-nowrap">PE</span>
                  <span className={`w-full text-center tabular-nums text-[12px] leading-none px-1 py-0.5 rounded border ${
                    peConv === 'STRONG_BUY' ? 'text-red-300' :
                    peConv === 'STRONG_SELL' ? 'text-emerald-300' :
                    pePrice > cePrice && isDivergent ? 'text-red-300' :
                    'text-slate-300'
                  } ${
                    peConv === 'STRONG_BUY' ? 'border-red-400/60 bg-red-500/10' :
                    peConv === 'STRONG_SELL' ? 'border-emerald-400/60 bg-emerald-500/10' :
                    'border-slate-600/60 bg-slate-900/70'
                  }`}>
                    {pePrice.toFixed(1)}
                  </span>
                </div>
              </div>

              <div className="hidden sm:flex items-center gap-1">
                <span className={`flex-1 min-w-0 text-center font-black tabular-nums text-[9px] sm:text-[12px] ${
                  ceConv === 'STRONG_BUY' ? 'text-emerald-300' :
                  ceConv === 'STRONG_SELL' ? 'text-red-300' :
                  cePrice > pePrice && isDivergent ? 'text-emerald-300' :
                  'text-slate-300'
                }`}>
                  {cePrice.toFixed(1)}
                </span>
                <span className="text-slate-300 text-[9px] sm:text-[10px] leading-none font-bold">|</span>
                <span className={`flex-1 min-w-0 text-center font-black tabular-nums text-[9px] sm:text-[12px] ${
                  peConv === 'STRONG_BUY' ? 'text-red-300' :
                  peConv === 'STRONG_SELL' ? 'text-emerald-300' :
                  pePrice > cePrice && isDivergent ? 'text-red-300' :
                  'text-slate-300'
                }`}>
                  {pePrice.toFixed(1)}
                </span>
              </div>
            </div>
          );
        })()}
        
        {tradeBadge ? (
          <span className={`text-[10px] sm:text-[12px] md:text-[13px] font-black tracking-tight px-1 sm:px-1.5 py-0.5 rounded animate-pulse ${tradeBadge.cls}`}>
            <span className="hidden sm:inline">{tradeBadge.label}</span>
            <span className="sm:hidden">{tradeBadge.label.split(' ')[0]}</span>
          </span>
        ) : (
          <span className={`text-[10px] sm:text-[12px] md:text-[13px] font-black uppercase tracking-widest px-1 sm:px-1.5 rounded ${
            isATM ? 'text-cyan-300 bg-cyan-500/15 border border-cyan-400/50' : 'text-slate-500'
          }`}>{row.label}</span>
        )}
        <div className="hidden sm:block w-10 h-[4px] rounded-full bg-slate-800/80 overflow-hidden mt-0.5" title={`Vol ${Math.round(volIntensity * 100)}%`}>
          <div className={`h-full rounded-full transition-all duration-500 ${volIntensity > 0.7 ? 'bg-amber-400' : volIntensity > 0.4 ? 'bg-amber-500/50' : 'bg-slate-700'}`} style={{ width: `${volIntensity * 100}%` }} />
        </div>
        <div className="hidden sm:block w-8 h-[3px] rounded-full bg-slate-800/80 overflow-hidden" title={`OI ${Math.round(oiIntensity * 100)}%`}>
          <div className={`h-full rounded-full transition-all duration-500 ${oiIntensity > 0.7 ? 'bg-blue-400' : oiIntensity > 0.4 ? 'bg-blue-500/50' : 'bg-slate-700'}`} style={{ width: `${oiIntensity * 100}%` }} />
        </div>
        <div className="hidden sm:flex items-center gap-1 mt-0 sm:mt-0.5">
          <ScoreDot score={row.ce.score} />
          <ScoreDot score={row.pe.score} />
        </div>
      </div>

      {/* PE box with light background */}
      <div className="bg-slate-900/30 border border-slate-500/90 rounded-lg overflow-hidden flex-1 min-w-0">
        <SideCell side={row.pe} label="PE" volDominant={peDisplayVol > ceDisplayVol} oiDominant={row.pe.oi > row.ce.oi} isATM={isATM} symbolKey={symbolKey} displayVolume={peDisplayVol} displaySignalOverride={buyerDisplaySignals.pe} />
      </div>
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

// Symbol Card

const SymbolStrikeCard = memo<{ data: SymbolStrikeData | null; name: string }>(({ data, name }) => {
  const lastDirectionalDominantRef = useRef<'BULL' | 'BEAR' | null>(null);
  const [flashSide, setFlashSide] = useState<'BULL' | 'BEAR' | null>(null);
  const prevSummaryRef = useRef<{ bullPct: number; bearPct: number; pcr: number } | null>(null);
  const [summaryFlash, setSummaryFlash] = useState<{ bull: boolean; bear: boolean; pcr: boolean }>({ bull: false, bear: false, pcr: false });
  const summaryFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [chainMoves, setChainMoves] = useState<ChainMoves>(INITIAL_CHAIN_MOVES);
  const [liveVolumeTick, setLiveVolumeTick] = useState<{ ce: number; pe: number; ready: boolean }>({ ce: 0, pe: 0, ready: false });
  // Flash state for intelligence section — fires whenever the composite score changes
  const prevScoreRef = useRef<number | null>(null);
  const [scoreFlash, setScoreFlash] = useState<'up' | 'down' | null>(null);
  const scoreFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevChainStatsRef = useRef<{
    totalCEVol: number; totalPEVol: number;
    totalCEOI: number; totalPEOI: number;
    totalCEOIChg: number; totalPEOIChg: number;
    ceAvgChgPct: number; peAvgChgPct: number;
    ceVolStrikeCount: number; peVolStrikeCount: number; tiedVolStrikeCount: number;
    ceVolPct: number; peVolPct: number;
    ceOIPct: number; peOIPct: number;
    ceOIChgPct: number; peOIChgPct: number;
  } | null>(null);
  const chainFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const strikes      = useMemo(() => data?.strikes ?? [], [data?.strikes]);
  const hasData      = strikes.length > 0;
  const intelligence = data?.intelligence;
  const symbolKey    = normalizeSymbolKey(data?.symbol || name);

  const maxVol = useMemo(() => hasData ? Math.max(...strikes.map(s => s.ce.volume + s.pe.volume), 1) : 1, [strikes, hasData]);
  const maxOI  = useMemo(() => hasData ? Math.max(...strikes.map(s => s.ce.oi    + s.pe.oi),    1) : 1, [strikes, hasData]);
  // ATM row drives the trade decision (most price-sensitive strike)
  const atmRow = useMemo(() => strikes.find(s => s.isATM) ?? (strikes.length > 0 ? strikes[Math.floor(strikes.length / 2)] : null), [strikes]);

  const isLiveData   = data?.dataSource === 'LIVE';
  const hasRealSignal = isLiveData;

  // Aggregate chain stats — computed every tick when strikes update
  const chainStats = useMemo(() => {
    if (!hasData) return null;
    const serverChainTotals = data?.chainTotals;
    let totalCEVol = 0;
    let totalPEVol = 0;
    let totalCEOI = 0;
    let totalPEOI = 0;
    let totalCEOIChg = 0;
    let totalPEOIChg = 0;
    let ceVolStrikeCount = 0;
    let peVolStrikeCount = 0;
    let tiedVolStrikeCount = 0;
    // Price action accumulators
    let ceChgWtdSum = 0; let ceVolForPA = 0;
    let peChgWtdSum = 0; let peVolForPA = 0;
    let ceHotCount = 0;  let peHotCount = 0;
    let paStrikeCount = 0;

    for (const strike of strikes) {
      totalCEVol += strike.ce.volume;
      totalPEVol += strike.pe.volume;
      totalCEOI += strike.ce.oi;
      totalPEOI += strike.pe.oi;
      totalCEOIChg += (strike.ce.oiChange ?? 0);
      totalPEOIChg += (strike.pe.oiChange ?? 0);

      if (strike.ce.volume > strike.pe.volume) {
        ceVolStrikeCount += 1;
      } else if (strike.pe.volume > strike.ce.volume) {
        peVolStrikeCount += 1;
      } else {
        tiedVolStrikeCount += 1;
      }

      // Pure price action: vol-weighted avg change %
      const cePrev = strike.ce.price - strike.ce.change;
      const pePrev = strike.pe.price - strike.pe.change;
      if (cePrev > 0.01 && strike.ce.volume > 0) {
        ceChgWtdSum += (strike.ce.change / cePrev) * 100 * strike.ce.volume;
        ceVolForPA += strike.ce.volume;
      }
      if (pePrev > 0.01 && strike.pe.volume > 0) {
        peChgWtdSum += (strike.pe.change / pePrev) * 100 * strike.pe.volume;
        peVolForPA += strike.pe.volume;
      }

      // Velocity hotness
      if (strike.ce.velocity === 'HOT' || strike.ce.velocity === 'EXTREME') ceHotCount++;
      if (strike.pe.velocity === 'HOT' || strike.pe.velocity === 'EXTREME') peHotCount++;
      paStrikeCount++;
    }

    const displayCEVol = serverChainTotals?.totalCEVol ?? totalCEVol;
    const displayPEVol = serverChainTotals?.totalPEVol ?? totalPEVol;
    const totalVol = (serverChainTotals?.totalVol ?? (displayCEVol + displayPEVol));
    const displayCEOI = serverChainTotals?.totalCEOI ?? totalCEOI;
    const displayPEOI = serverChainTotals?.totalPEOI ?? totalPEOI;
    const totalOI = (serverChainTotals?.totalOI ?? (displayCEOI + displayPEOI));
    // Prefer full-chain OI change from backend; fall back to signed sum of 11 visible strikes
    const displayCEOIChg = serverChainTotals?.totalCEOIChg ?? totalCEOIChg;
    const displayPEOIChg = serverChainTotals?.totalPEOIChg ?? totalPEOIChg;
    const ceAvgChgPct = ceVolForPA > 0 ? ceChgWtdSum / ceVolForPA : 0;
    const peAvgChgPct = peVolForPA > 0 ? peChgWtdSum / peVolForPA : 0;
    const ceHotPct = paStrikeCount > 0 ? Math.round((ceHotCount / paStrikeCount) * 100) : 0;
    const peHotPct = paStrikeCount > 0 ? Math.round((peHotCount / paStrikeCount) * 100) : 0;
    const getMomentumLabel = (pct: number) =>
      pct > 3 ? 'SURGING' : pct > 1 ? 'RISING' : pct > -1 ? 'FLAT' : pct > -3 ? 'FALLING' : 'COLLAPSING';
    const ceMomentumLabel = getMomentumLabel(ceAvgChgPct);
    const peMomentumLabel = getMomentumLabel(peAvgChgPct);
    const ceAbsMom = Math.abs(ceAvgChgPct);
    const peAbsMom = Math.abs(peAvgChgPct);
    const totalAbsMom = ceAbsMom + peAbsMom;
    const cePaDomPct = totalAbsMom > 0 ? Math.round((ceAbsMom / totalAbsMom) * 100) : 50;
    const ceVolPct = totalVol > 0 ? Math.round((displayCEVol / totalVol) * 100) : 50;
    const peVolPct = totalVol > 0 ? 100 - ceVolPct : 50;
    const ceOIPct  = totalOI  > 0 ? Math.round((displayCEOI  / totalOI)  * 100) : 50;
    const peOIPct  = totalOI  > 0 ? 100 - ceOIPct : 50;
    const totalAbsOIChg = Math.abs(displayCEOIChg) + Math.abs(displayPEOIChg);
    const ceOIChgPct = totalAbsOIChg > 0 ? Math.round((Math.abs(displayCEOIChg) / totalAbsOIChg) * 100) : 50;
    const peOIChgPct = totalAbsOIChg > 0 ? 100 - ceOIChgPct : 50;
    return {
      totalCEVol: displayCEVol, totalPEVol: displayPEVol, totalVol,
      totalCEOI: displayCEOI, totalPEOI: displayPEOI, totalOI,
      totalCEOIChg: displayCEOIChg, totalPEOIChg: displayPEOIChg,
      ceAvgChgPct, peAvgChgPct, ceHotPct, peHotPct,
      ceMomentumLabel, peMomentumLabel, cePaDomPct,
      ceVolStrikeCount, peVolStrikeCount, tiedVolStrikeCount,
      ceVolPct, peVolPct,
      ceOIPct, peOIPct,
      ceOIChgPct, peOIChgPct,
    };
  }, [strikes, hasData, data?.chainTotals]);

  // Live tick-volume view (current flow only, not cumulative day total)
  const liveVolumeStats = useMemo(() => {
    // Keep UI stable: prefer chain totals for display so CE/PE values never blink to "--".
    if (chainStats) {
      const ce = Math.max(0, chainStats.totalCEVol);
      const pe = Math.max(0, chainStats.totalPEVol);
      const total = ce + pe;
      const cePct = total > 0 ? chainStats.ceVolPct : 50;
      const pePct = total > 0 ? chainStats.peVolPct : 50;
      return { ce, pe, total, cePct, pePct, ready: total > 0 };
    }

    const ce = Math.max(0, liveVolumeTick.ce);
    const pe = Math.max(0, liveVolumeTick.pe);
    const total = ce + pe;
    const cePct = total > 0 ? Math.round((ce / total) * 100) : 50;
    const pePct = total > 0 ? 100 - cePct : 50;
    return { ce, pe, total, cePct, pePct, ready: liveVolumeTick.ready && total > 0 };
  }, [chainStats, liveVolumeTick.ce, liveVolumeTick.pe, liveVolumeTick.ready]);

  // Summary: bias + PCR - use backend intelligence when available
  const summary = useMemo(() => {
    // PCR: prefer full-chain OI from chainTotals (covers all strikes, not just ATM±5)
    const chainCEOI = data?.chainTotals?.totalCEOI ?? 0;
    const chainPEOI = data?.chainTotals?.totalPEOI ?? 0;
    const fallbackCEOI = hasData ? strikes.reduce((a, s) => a + s.ce.oi, 0) : 0;
    const fallbackPEOI = hasData ? strikes.reduce((a, s) => a + s.pe.oi, 0) : 0;
    const ceoiForPcr = chainCEOI > 0 ? chainCEOI : fallbackCEOI;
    const peoiForPcr = chainCEOI > 0 ? chainPEOI : fallbackPEOI;
    const pcr = ceoiForPcr > 0 ? parseFloat((peoiForPcr / ceoiForPcr).toFixed(2)) : 1;
    if (!hasData || !hasRealSignal || !intelligence) {
      return { bullPct: 0, bearPct: 0, neutralPct: 100, bias: 'NEUTRAL' as const, pcr };
    }
    const bullPct    = intelligence.bullPressure;
    const bearPct    = intelligence.bearPressure;
    const neutralPct = Math.max(0, 100 - bullPct - bearPct);
    const bias = bullPct - bearPct >= 10 ? 'BULLISH' as const : bearPct - bullPct >= 10 ? 'BEARISH' as const : 'NEUTRAL' as const;
    return { bullPct, bearPct, neutralPct, bias, pcr };
  }, [strikes, hasData, hasRealSignal, intelligence, data?.chainTotals]);

  // Composite signal - always comes from backend intelligence (no re-scoring in browser)
  const symbolSignal = useMemo(() => {
    if (!hasRealSignal || !intelligence) return { signal: 'NEUTRAL' as OverallSignal, score: 0 };
    return { signal: intelligence.signal as OverallSignal, score: Math.round(intelligence.score) };
  }, [hasRealSignal, intelligence]);

  const tradeDecision = useMemo(() => {
    if (!hasRealSignal || !atmRow) return null;
    return deriveTradeDecision(
      atmRow.ce.signal,
      atmRow.pe.signal,
      Math.round(atmRow.ce.score),
      Math.round(atmRow.pe.score),
      symbolSignal.score,
    );
  }, [atmRow, hasRealSignal, symbolSignal.score]);

  // OI Structure Engine: aggregates strike-level LB/SB/SC/LU states into
  // one directional institutional positioning signal for this symbol.
  const oiStructure = useMemo(() => {
    if (!hasData) return null;

    type OIState = 'LB' | 'SB' | 'SC' | 'LU';

    const deriveState = (side: StrikeRow['ce'] | StrikeRow['pe']): OIState | null => {
      const explicit = side.signals?.oiInterp;
      if (explicit === 'LB' || explicit === 'SB' || explicit === 'SC' || explicit === 'LU') return explicit;

      // Fallback classifier when backend oiInterp is temporarily unavailable.
      const oiChg = side.oiChange ?? 0;
      const pxChg = side.change ?? 0;
      if (Math.abs(oiChg) < 0.01 || Math.abs(pxChg) < 0.005) return null;
      if (oiChg > 0 && pxChg > 0) return 'LB';
      if (oiChg > 0 && pxChg < 0) return 'SB';
      if (oiChg < 0 && pxChg > 0) return 'SC';
      if (oiChg < 0 && pxChg < 0) return 'LU';
      return null;
    };

    const ceWeights: Record<OIState, number> = { LB: 0, SB: 0, SC: 0, LU: 0 };
    const peWeights: Record<OIState, number> = { LB: 0, SB: 0, SC: 0, LU: 0 };
    const totalWeights: Record<OIState, number> = { LB: 0, SB: 0, SC: 0, LU: 0 };

    const ceImpact: Record<OIState, number> = { LB: 2.0, SC: 1.0, SB: -2.0, LU: -1.0 };
    const peImpact: Record<OIState, number> = { LB: -2.0, SC: -1.0, SB: 2.0, LU: 1.0 };

    let ceTotalWeight = 0;
    let peTotalWeight = 0;
    let directionalWeightedSum = 0;

    for (const strike of strikes) {
      const ceState = deriveState(strike.ce);
      const peState = deriveState(strike.pe);

      const ceWeight = Math.max(1, strike.ce.oi * 0.65 + strike.ce.volume * 0.35);
      const peWeight = Math.max(1, strike.pe.oi * 0.65 + strike.pe.volume * 0.35);

      if (ceState) {
        ceWeights[ceState] += ceWeight;
        totalWeights[ceState] += ceWeight;
        ceTotalWeight += ceWeight;
        directionalWeightedSum += ceWeight * ceImpact[ceState];
      }

      if (peState) {
        peWeights[peState] += peWeight;
        totalWeights[peState] += peWeight;
        peTotalWeight += peWeight;
        directionalWeightedSum += peWeight * peImpact[peState];
      }
    }

    const allStates: OIState[] = ['LB', 'SB', 'SC', 'LU'];
    const pickTop = (src: Record<OIState, number>) =>
      allStates.reduce((best, k) => (src[k] > src[best] ? k : best), 'LB' as OIState);

    const ceTop = ceTotalWeight > 0 ? pickTop(ceWeights) : null;
    const peTop = peTotalWeight > 0 ? pickTop(peWeights) : null;
    const ceTopShare = ceTop && ceTotalWeight > 0 ? ceWeights[ceTop] / ceTotalWeight : 0;
    const peTopShare = peTop && peTotalWeight > 0 ? peWeights[peTop] / peTotalWeight : 0;

    const norm = ceTotalWeight + peTotalWeight;
    const biasScore = norm > 0 ? directionalWeightedSum / (norm * 2.0) : 0;
    const overallTop = norm > 0 ? pickTop(totalWeights) : null;
    const overallShare = overallTop ? totalWeights[overallTop] / norm : 0;

    const confidence = Math.round(Math.max(ceTopShare, peTopShare) * 100);
    const biasTag = norm <= 0
      ? 'NO CLEAR STRUCTURE'
      : biasScore >= 0.18
      ? 'BULLISH BUILDUP'
      : biasScore <= -0.18
      ? 'BEARISH BUILDUP'
      : 'MIXED FLOW';
    const biasTone = norm <= 0
      ? 'text-slate-300 border-slate-500/45 bg-slate-700/25'
      : biasScore >= 0.18
      ? 'text-emerald-300 border-emerald-400/50 bg-emerald-500/10'
      : biasScore <= -0.18
      ? 'text-red-300 border-red-400/50 bg-red-500/10'
      : 'text-amber-300 border-amber-400/50 bg-amber-500/10';

    const stateLabel: Record<OIState, string> = {
      LB: 'Long Buildup',
      SB: 'Short Buildup',
      SC: 'Short Covering',
      LU: 'Long Unwinding',
    };

    const stateTone: Record<OIState, string> = {
      LB: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
      SB: 'text-red-300 border-red-500/40 bg-red-500/10',
      SC: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10',
      LU: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
    };

    const oneBoxTone = norm <= 0
      ? 'text-slate-300 border-slate-500/45 bg-slate-700/25'
      : overallTop
      ? stateTone[overallTop]
      : biasTone;

    return {
      biasTag,
      biasTone,
      score: Math.round(biasScore * 100),
      confidence,
      ceTop,
      peTop,
      ceTopLabel: ceTop ? stateLabel[ceTop] : 'No clear state',
      peTopLabel: peTop ? stateLabel[peTop] : 'No clear state',
      ceTopPct: ceTop ? Math.round(ceTopShare * 100) : null,
      peTopPct: peTop ? Math.round(peTopShare * 100) : null,
      ceTone: ceTop ? stateTone[ceTop] : 'text-slate-300 border-slate-500/40 bg-slate-700/20',
      peTone: peTop ? stateTone[peTop] : 'text-slate-300 border-slate-500/40 bg-slate-700/20',
      hasAnyState: norm > 0,
      overallTop,
      overallTopLabel: overallTop ? stateLabel[overallTop] : 'No clear state',
      overallTopPct: overallTop ? Math.round(overallShare * 100) : null,
      oneBoxTone,
    };
  }, [hasData, strikes]);

  // Today's Market Regime Engine (live): combines price action, participation,
  // positioning, pressure and risk into a directional trend score.
  const todaysRegime = useMemo(() => {
    const pcrNow = intelligence?.pcr ?? summary.pcr ?? 1;
    if (!hasRealSignal || !intelligence) {
      return {
        trendScore: 0,
        trendTag: 'NEUTRAL',
        marketMode: 'SIDEWAYS',
        sidePlan: 'WAIT',
        strength: 'LOW',
        reason: 'Waiting for live chain confirmation',
        scoreTone: 'text-slate-300 border-slate-600/50 bg-slate-700/25',
        factors: [
          { k: 'Price Action', v: '--', pass: false },
          { k: 'Volume Flow', v: '--', pass: false },
          { k: 'OI Positioning', v: '--', pass: false },
          { k: 'OI Change', v: '--', pass: false },
          { k: 'Pressure', v: '--', pass: false },
          { k: 'PCR Context', v: '--', pass: false },
          { k: 'OI Structure', v: '--', pass: false },
          { k: 'Confidence', v: '--', pass: false },
          { k: 'Agreement', v: '--', pass: false },
          { k: 'Trap Risk', v: '--', pass: false },
        ],
      };
    }

    const cePa = chainStats?.ceAvgChgPct ?? 0;
    const pePa = chainStats?.peAvgChgPct ?? 0;
    const paEdgeRaw = cePa - pePa; // +ve => CE outperforming => bullish trend

    const ceVolPct = chainStats?.ceVolPct ?? 50;
    const ceOIPct = chainStats?.ceOIPct ?? 50;
    const ceOIChgPct = chainStats?.ceOIChgPct ?? 50;
    const pressureEdgeRaw = summary.bullPct - summary.bearPct;

    const paEdge = Math.max(-32, Math.min(32, paEdgeRaw * 6));
    const volEdge = Math.max(-16, Math.min(16, (ceVolPct - 50) * 0.7));
    const oiEdge = Math.max(-14, Math.min(14, (ceOIPct - 50) * 0.6));
    const oiChgEdge = Math.max(-10, Math.min(10, (ceOIChgPct - 50) * 0.5));
    const pressureEdge = Math.max(-20, Math.min(20, pressureEdgeRaw * 0.9));
    const pcrEdge = pcrNow > 1.2 ? 10 : pcrNow < 0.8 ? -10 : (pcrNow - 1) * 20;
    const oiStructureEdge = Math.max(-14, Math.min(14, (oiStructure?.score ?? 0) * 0.28));

    const trapRisk = intelligence.trapRiskPct ?? 0;
    const confidence = intelligence.confidence ?? 0;
    const agreement = intelligence.agreementPct ?? 0;
    const confidenceEdge = Math.max(-10, Math.min(10, (confidence - 50) * 0.4));
    const agreementEdge = Math.max(-10, Math.min(10, (agreement - 50) * 0.4));
    const trapGuardEdge = Math.max(-22, Math.min(8, (45 - trapRisk) * 0.45));

    let rawScore = paEdge + volEdge + oiEdge + oiChgEdge + pressureEdge + pcrEdge + oiStructureEdge + confidenceEdge + agreementEdge + trapGuardEdge;
    // Trap risk reduces conviction in whichever direction the score is pointing.
    if (rawScore > 0) rawScore = Math.max(0, rawScore - trapRisk * 0.18);
    if (rawScore < 0) rawScore = Math.min(0, rawScore + trapRisk * 0.18);

    // Confidence/agreement multiplier keeps trend score realistic in noisy states.
    const quality = Math.max(0.55, Math.min(1.05, (confidence / 100) * 0.55 + (agreement / 100) * 0.45));
    const trendScore = Math.round(Math.max(-100, Math.min(100, rawScore * quality)));
    const absScore = Math.abs(trendScore);

    const trendTag = trendScore >= 18 ? 'UPTREND' : trendScore <= -18 ? 'DOWNTREND' : 'RANGE';
    const marketMode = absScore >= 18 ? 'TRENDING' : 'SIDEWAYS';
    const strength = absScore >= 55 ? 'HIGH' : absScore >= 35 ? 'MEDIUM' : absScore >= 18 ? 'BUILDING' : 'LOW';

    const riskHeavy = trapRisk >= 60;
    const lowQuality = confidence < 48 || agreement < 45;
    const sidePlan = absScore < 18 || riskHeavy || lowQuality
      ? 'WAIT'
      : trendScore > 0
        ? 'BUY CE'
        : 'BUY PE';

    const reason = sidePlan === 'WAIT'
      ? (riskHeavy
          ? 'High trap risk - avoid directional entry'
          : absScore < 18
            ? 'Trend not established yet'
            : 'Signal quality too low - wait for confirmation')
      : trendScore > 0
        ? 'Call side momentum + flow + pressure aligned'
        : 'Put side momentum + flow + pressure aligned';

    const scoreTone = trendScore > 0
      ? 'text-emerald-200 border-emerald-500/50 bg-emerald-500/15'
      : trendScore < 0
        ? 'text-red-200 border-red-500/50 bg-red-500/15'
        : 'text-amber-200 border-amber-500/45 bg-amber-500/12';

    const factors = [
      { k: 'Price Action', v: `${paEdgeRaw >= 0 ? '+' : ''}${paEdgeRaw.toFixed(2)}%`, pass: Math.abs(paEdgeRaw) >= 0.25 },
      { k: 'Volume Flow', v: `CE ${ceVolPct}%`, pass: Math.abs(ceVolPct - 50) >= 6 },
      { k: 'OI Positioning', v: `CE ${ceOIPct}%`, pass: Math.abs(ceOIPct - 50) >= 6 },
      { k: 'OI Change', v: `CE ${ceOIChgPct}%`, pass: Math.abs(ceOIChgPct - 50) >= 6 },
      { k: 'Pressure', v: `${pressureEdgeRaw >= 0 ? '+' : ''}${Math.round(pressureEdgeRaw)}`, pass: Math.abs(pressureEdgeRaw) >= 10 },
      { k: 'PCR Context', v: pcrNow.toFixed(2), pass: pcrNow > 1.2 || pcrNow < 0.8 },
      { k: 'OI Structure', v: oiStructure?.overallTopLabel ?? 'No clear', pass: !!oiStructure?.overallTop },
      { k: 'Confidence', v: `${confidence}%`, pass: confidence >= 55 },
      { k: 'Agreement', v: `${agreement}%`, pass: agreement >= 52 },
      { k: 'Trap Risk', v: `${trapRisk}%`, pass: trapRisk < 45 },
    ];

    return { trendScore, trendTag, marketMode, sidePlan, strength, reason, scoreTone, factors };
  }, [chainStats, hasRealSignal, intelligence, oiStructure?.overallTop, oiStructure?.overallTopLabel, oiStructure?.score, summary.bearPct, summary.bullPct, summary.pcr]);

  // Dominance tracking: highlight the leading side and flash on transition.
  // Keep last non-neutral side so BULL -> NEUTRAL -> BEAR still flashes as a flip.
  useEffect(() => {
    if (!hasRealSignal) return undefined;
    let clearFlashTimer: ReturnType<typeof setTimeout> | null = null;
    const current: 'BULL' | 'BEAR' | 'NEUTRAL' =
      summary.bullPct > summary.bearPct ? 'BULL' :
      summary.bearPct > summary.bullPct ? 'BEAR' : 'NEUTRAL';

    if (current !== 'NEUTRAL') {
      const lastDirectional = lastDirectionalDominantRef.current;
      if (lastDirectional && lastDirectional !== current) {
        setFlashSide(current);
        clearFlashTimer = setTimeout(() => setFlashSide(null), 1800);
      }
      lastDirectionalDominantRef.current = current;
    }

    return () => {
      if (clearFlashTimer) clearTimeout(clearFlashTimer);
    };
  }, [summary.bullPct, summary.bearPct, hasRealSignal]);

  // Sharp change detector for chain cards (Volume / OI / OI Change / IV)
  useEffect(() => {
    if (!chainStats || !hasRealSignal) return;
    const prev = prevChainStatsRef.current;
    if (!prev) {
      setLiveVolumeTick({ ce: 0, pe: 0, ready: false });
      prevChainStatsRef.current = {
        totalCEVol: chainStats.totalCEVol,
        totalPEVol: chainStats.totalPEVol,
        totalCEOI: chainStats.totalCEOI,
        totalPEOI: chainStats.totalPEOI,
        totalCEOIChg: chainStats.totalCEOIChg,
        totalPEOIChg: chainStats.totalPEOIChg,
        ceAvgChgPct: chainStats.ceAvgChgPct,
        peAvgChgPct: chainStats.peAvgChgPct,
        ceVolStrikeCount: chainStats.ceVolStrikeCount,
        peVolStrikeCount: chainStats.peVolStrikeCount,
        tiedVolStrikeCount: chainStats.tiedVolStrikeCount,
        ceVolPct: chainStats.ceVolPct,
        peVolPct: chainStats.peVolPct,
        ceOIPct: chainStats.ceOIPct,
        peOIPct: chainStats.peOIPct,
        ceOIChgPct: chainStats.ceOIChgPct,
        peOIChgPct: chainStats.peOIChgPct,
      };
      return;
    }

    const volCE = detectMove(chainStats.totalCEVol, prev.totalCEVol, 0);
    const volPE = detectMove(chainStats.totalPEVol, prev.totalPEVol, 0);
    // If provider resets counters (session rollover/reconnect), use current value as live baseline.
    const ceLive = chainStats.totalCEVol >= prev.totalCEVol ? (chainStats.totalCEVol - prev.totalCEVol) : chainStats.totalCEVol;
    const peLive = chainStats.totalPEVol >= prev.totalPEVol ? (chainStats.totalPEVol - prev.totalPEVol) : chainStats.totalPEVol;
    setLiveVolumeTick({ ce: ceLive, pe: peLive, ready: true });
    const oiCE = detectMove(chainStats.totalCEOI, prev.totalCEOI, 0);
    const oiPE = detectMove(chainStats.totalPEOI, prev.totalPEOI, 0);
    const oiChgCE = detectMove(chainStats.totalCEOIChg, prev.totalCEOIChg, 0);
    const oiChgPE = detectMove(chainStats.totalPEOIChg, prev.totalPEOIChg, 0);
    const paCE = detectMove(chainStats.ceAvgChgPct, prev.ceAvgChgPct, 0.05);
    const paPE = detectMove(chainStats.peAvgChgPct, prev.peAvgChgPct, 0.05);

    const nextMoves: ChainMoves = {
      volume: {
        ce: volCE,
        pe: volPE,
        active: volCE !== 'flat' || volPE !== 'flat' || chainStats.ceVolPct !== prev.ceVolPct || chainStats.peVolPct !== prev.peVolPct,
      },
      oi: {
        ce: oiCE,
        pe: oiPE,
        active: oiCE !== 'flat' || oiPE !== 'flat' || chainStats.ceOIPct !== prev.ceOIPct || chainStats.peOIPct !== prev.peOIPct,
      },
      oiChange: {
        ce: oiChgCE,
        pe: oiChgPE,
        active: oiChgCE !== 'flat' || oiChgPE !== 'flat' || chainStats.ceOIChgPct !== prev.ceOIChgPct || chainStats.peOIChgPct !== prev.peOIChgPct,
      },
      priceAction: {
        ce: paCE,
        pe: paPE,
        active: paCE !== 'flat' || paPE !== 'flat',
      },
    };

    const anyActive = nextMoves.volume.active || nextMoves.oi.active || nextMoves.oiChange.active || nextMoves.priceAction.active;
    if (anyActive) {
      setChainMoves(nextMoves);
      if (chainFlashTimerRef.current) clearTimeout(chainFlashTimerRef.current);
      chainFlashTimerRef.current = setTimeout(() => {
        setChainMoves(INITIAL_CHAIN_MOVES);
      }, 1200);
    }

    prevChainStatsRef.current = {
      totalCEVol: chainStats.totalCEVol,
      totalPEVol: chainStats.totalPEVol,
      totalCEOI: chainStats.totalCEOI,
      totalPEOI: chainStats.totalPEOI,
      totalCEOIChg: chainStats.totalCEOIChg,
      totalPEOIChg: chainStats.totalPEOIChg,
      ceAvgChgPct: chainStats.ceAvgChgPct,
      peAvgChgPct: chainStats.peAvgChgPct,
      ceVolStrikeCount: chainStats.ceVolStrikeCount,
      peVolStrikeCount: chainStats.peVolStrikeCount,
      tiedVolStrikeCount: chainStats.tiedVolStrikeCount,
      ceVolPct: chainStats.ceVolPct,
      peVolPct: chainStats.peVolPct,
      ceOIPct: chainStats.ceOIPct,
      peOIPct: chainStats.peOIPct,
      ceOIChgPct: chainStats.ceOIChgPct,
      peOIChgPct: chainStats.peOIChgPct,
    };

    return () => {
      if (chainFlashTimerRef.current) clearTimeout(chainFlashTimerRef.current);
    };
  }, [chainStats, hasRealSignal]);

  // Flash the intelligence section (score, regime, PCR, …) when composite score changes
  useEffect(() => {
    const score = intelligence?.score ?? null;
    if (score === null) return;
    const prev = prevScoreRef.current;
    if (prev !== null && prev !== score) {
      const dir = score > prev ? 'up' : 'down';
      setScoreFlash(dir);
      if (scoreFlashTimerRef.current) clearTimeout(scoreFlashTimerRef.current);
      scoreFlashTimerRef.current = setTimeout(() => setScoreFlash(null), 700);
    }
    prevScoreRef.current = score;
    return () => {
      if (scoreFlashTimerRef.current) clearTimeout(scoreFlashTimerRef.current);
    };
  }, [intelligence?.score]);

  // Border-only flash for summary chips (Bull/Bear/PCR) when fresh values arrive.
  useEffect(() => {
    if (!hasRealSignal) return;
    const currentPcr = intelligence?.pcr ?? summary.pcr;
    const prev = prevSummaryRef.current;
    if (prev) {
      const bullChanged = prev.bullPct !== summary.bullPct;
      const bearChanged = prev.bearPct !== summary.bearPct;
      const pcrChanged = Math.abs(prev.pcr - currentPcr) >= 0.01;
      if (bullChanged || bearChanged || pcrChanged) {
        setSummaryFlash({ bull: bullChanged, bear: bearChanged, pcr: pcrChanged });
        if (summaryFlashTimerRef.current) clearTimeout(summaryFlashTimerRef.current);
        summaryFlashTimerRef.current = setTimeout(() => {
          setSummaryFlash({ bull: false, bear: false, pcr: false });
        }, 650);
      }
    }
    prevSummaryRef.current = { bullPct: summary.bullPct, bearPct: summary.bearPct, pcr: currentPcr };

    return () => {
      if (summaryFlashTimerRef.current) clearTimeout(summaryFlashTimerRef.current);
    };
  }, [hasRealSignal, summary.bullPct, summary.bearPct, summary.pcr, intelligence?.pcr]);

  if (!data || !hasData) {
    return (
      <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs sm:text-sm font-bold text-slate-400">{name}</span>
          <span className="text-[10px] text-slate-600">No data</span>
        </div>
        <div className="text-center py-6 text-slate-600 text-xs">Waiting for strike data...</div>
      </div>
    );
  }

  const biasColor = summary.bias === 'BULLISH' ? 'text-emerald-400' : summary.bias === 'BEARISH' ? 'text-red-400' : 'text-amber-400';
  const biasBg    = summary.bias === 'BULLISH' ? 'bg-emerald-500/10' : summary.bias === 'BEARISH' ? 'bg-red-500/10' : 'bg-amber-500/10';

  const sourceColor = isLiveData ? 'text-emerald-400' : 'text-slate-500';
  const sourceLabel = isLiveData ? 'LIVE' : 'CLOSED';

  const actionability     = intelligence?.actionability ?? 'NONE';
  const actionabilityTone = actionability === 'HIGH'
    ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
    : actionability === 'MEDIUM'
    ? 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10'
    : actionability === 'LOW'
    ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
    : 'text-slate-500 border-slate-600/40 bg-slate-800/40';

  const optionAge  = fmtAgeSeconds(data.optionChainAgeSec);
  const snapTs     = fmtTs(data.optionChainUpdatedAt || data.timestamp);
  const feedLabel  = isLiveData
    ? (data.feedMode === 'HYBRID_LIVE' ? `Spot live | Options ${optionAge}` : 'Live feed')
    : `Closed fallback | ${snapTs}`;

  const expiryPast = data.expiry ? new Date(data.expiry) < new Date(new Date().toISOString().slice(0, 10)) : false;

  // PCR from backend intelligence, fallback to computed from strikes
  const pcr = intelligence?.pcr ?? summary.pcr;

  return (
    <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4 lg:p-5 overflow-hidden">

      {/* Card Header */}
      <div className="flex items-start justify-between gap-2 mb-4 lg:mb-5">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] sm:text-[14px] font-bold text-emerald-200 bg-emerald-500/5 border border-emerald-500/30 shadow-[0_0_6px_rgba(52,211,153,0.15)] shrink-0">{name}</span>
          <span className="inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md text-[11px] sm:text-[12px] font-mono font-semibold text-emerald-300 bg-emerald-500/5 border border-emerald-500/30 shrink-0">
            <span className="whitespace-nowrap">ATM: {data.atm.toLocaleString('en-IN')}</span>
            <span className="text-emerald-500/60">|</span>
            <span className="whitespace-nowrap">Spot: {data.spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          </span>
        </div>

        {/* Top-right badge */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {hasRealSignal ? (() => {
            const rawCfg = OVERALL_CFG[symbolSignal.signal];
            const decisionCfg = tradeDecision ? DECISION_BADGE_CFG[tradeDecision] : null;
            const pulse = isLiveData && tradeDecision != null && tradeDecision !== 'WAIT' && tradeDecision !== 'CONFLICTING';
            return (
              <span title={`Trader action: ${decisionCfg?.label ?? rawCfg.label} | Flow: ${rawCfg.label} | Composite: ${symbolSignal.score > 0 ? '+' : ''}${symbolSignal.score}`}
                className={`inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-[12px] font-black tracking-wide border transition-all duration-300 ${(decisionCfg ? `${decisionCfg.bg} ${decisionCfg.border}` : `${rawCfg.bg} ${rawCfg.border}`)} ${decisionCfg?.color ?? rawCfg.color} ${decisionCfg?.glow ?? rawCfg.glow} ${pulse ? 'animate-pulse' : ''}`}>
                <span className="opacity-80 text-[10px] sm:text-[11px]">{decisionCfg?.arrow ?? rawCfg.arrow}</span>
                {decisionCfg?.label ?? rawCfg.label}
                <span className="text-[10px] font-mono opacity-60">{symbolSignal.score > 0 ? '+' : ''}{symbolSignal.score}</span>
              </span>
            );
          })() : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[9px] sm:text-[11px] font-black tracking-wide border bg-slate-800/40 text-slate-500 border-slate-600/40">NO DATA</span>
          )}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span className={`text-[9px] font-mono ${sourceColor}`}>{sourceLabel}</span>
            {data.expiry && (
              <span className={`text-[10px] font-mono ${expiryPast ? 'text-red-500/70' : 'text-slate-600'}`}>
                {expiryPast ? 'EXPIRED' : 'Exp:'} {data.expiry}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── SENTIMENT + CHAIN STATS PANEL ─────────────────────────────── */}
      <div className="rounded-xl border border-slate-600/60 bg-slate-900/85 mb-3 overflow-hidden shadow-[inset_0_0_0_1px_rgba(148,163,184,0.12)]">

        {/* Top row: Bias pill + Bull/Bear/PCR */}
        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-600/40 ${biasBg}`}>
          {/* Left: bias + source */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[13px] sm:text-[15px] font-black tracking-wide ${biasColor}`}>
              {hasRealSignal ? summary.bias : 'CLOSED'}
            </span>
            <span className={`text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded border ${sourceColor} border-current/40 bg-slate-800/80`}>
              {sourceLabel}
            </span>
          </div>
          {/* Right: Bull | Bear | PCR */}
          <div className="flex items-center gap-1.5 font-mono text-[12px] sm:text-[14px] flex-wrap justify-end">
            {hasRealSignal ? (
              <>
                <span
                  className={[
                    'tabular-nums transition-colors duration-100 px-2 py-0.5 rounded border',
                    summary.bullPct > summary.bearPct
                      ? 'text-emerald-300 font-black border-emerald-400/80'
                      : 'text-emerald-500 font-semibold border-emerald-500/30',
                    (flashSide === 'BULL' || summaryFlash.bull) ? 'border-emerald-300 shadow-[0_0_10px_1px_rgba(52,211,153,0.55)]' : '',
                  ].join(' ')}
                >
                  ▲ {summary.bullPct}%
                </span>
                <span className="text-slate-700">|</span>
                <span
                  className={[
                    'tabular-nums transition-colors duration-100 px-2 py-0.5 rounded border',
                    summary.bearPct > summary.bullPct
                      ? 'text-red-300 font-black border-red-400/80'
                      : 'text-red-500 font-semibold border-red-500/30',
                    (flashSide === 'BEAR' || summaryFlash.bear) ? 'border-red-300 shadow-[0_0_10px_1px_rgba(239,68,68,0.55)]' : '',
                  ].join(' ')}
                >
                  ▼ {summary.bearPct}%
                </span>
                {summary.neutralPct > 0 && (
                  <><span className="text-slate-700">|</span>
                  <span className="text-amber-300/90 font-semibold">— {summary.neutralPct}%</span></>
                )}
              </>
            ) : <span className="text-slate-600 text-[10px]">No data</span>}
            <span className="text-slate-700">|</span>
            <span className={`font-bold text-[12px] sm:text-[14px] tabular-nums transition-all duration-300 px-2 py-0.5 rounded border ${(pcr ?? 1) > 1.2 ? 'text-emerald-300 border-emerald-400/60' : (pcr ?? 1) < 0.8 ? 'text-red-300 border-red-400/60' : 'text-amber-300 border-amber-400/60'} ${summaryFlash.pcr ? ((pcr ?? 1) > 1.2 ? 'border-emerald-300 shadow-[0_0_10px_1px_rgba(52,211,153,0.5)]' : (pcr ?? 1) < 0.8 ? 'border-red-300 shadow-[0_0_10px_1px_rgba(239,68,68,0.5)]' : 'border-amber-300 shadow-[0_0_10px_1px_rgba(251,191,36,0.45)]') : ''}`}
              title="Put-Call Ratio (full chain OI if available, else ATM±5)">
              PCR {pcr?.toFixed(2) ?? '--'}
            </span>
          </div>
        </div>

        {/* Bottom grid: Vol | OI | OI△ | Price Action */}
        {chainStats && hasRealSignal && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 p-2 bg-slate-950/45">

            {/* ① Total Volume */}
            <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.12)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.volume)}`}
              title={`Total Chain Volume — CE: ${liveVolumeStats.ready ? fmtNum(liveVolumeStats.ce) : '--'} | PE: ${liveVolumeStats.ready ? fmtNum(liveVolumeStats.pe) : '--'}`}>
              <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-slate-300">Total Volume</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className="text-[13px] sm:text-[14px] font-black text-emerald-300">
                  CE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    liveVolumeStats.cePct >= liveVolumeStats.pePct
                      ? 'border-emerald-300/90 bg-emerald-500/18 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                      : 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300',
                    getValueFlashClass(chainMoves.volume.ce, chainMoves.volume.active),
                  ].join(' ')}>{liveVolumeStats.cePct}%</span>
                </span>
                <span className="text-[9px] text-slate-600">/</span>
                <span className="text-[13px] sm:text-[14px] font-black text-red-300">
                  PE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    liveVolumeStats.pePct > liveVolumeStats.cePct
                      ? 'border-red-300/90 bg-red-500/18 text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                      : 'border-red-300/35 bg-red-500/6 text-red-300',
                    getValueFlashClass(chainMoves.volume.pe, chainMoves.volume.active),
                  ].join(' ')}>{liveVolumeStats.pePct}%</span>
                </span>
              </div>
              <div className="flex h-[5px] rounded-full overflow-hidden bg-slate-800/80">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 rounded-l-full"
                  style={{ width: `${liveVolumeStats.cePct}%` }} />
                <div className="bg-gradient-to-l from-red-500 to-red-400 transition-all duration-500 rounded-r-full"
                  style={{ width: `${liveVolumeStats.pePct}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[10px] sm:text-[11px] font-mono tabular-nums">
                <span
                  className={[
                    'block w-full min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap overflow-hidden text-ellipsis transition-all duration-300',
                    liveVolumeStats.ce >= liveVolumeStats.pe
                      ? 'border-emerald-400/80 bg-emerald-500/20 text-emerald-200 shadow-[0_0_8px_rgba(16,185,129,0.45)]'
                      : 'border-slate-600/70 bg-slate-800/70 text-emerald-300/90',
                    getValueFlashClass(chainMoves.volume.ce, chainMoves.volume.active),
                  ].join(' ')}
                >
                  {liveVolumeStats.ready ? fmtNum(liveVolumeStats.ce) : '--'}
                </span>
                <span
                  className={[
                    'block w-full min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap overflow-hidden text-ellipsis transition-all duration-300',
                    liveVolumeStats.pe > liveVolumeStats.ce
                      ? 'border-red-400/80 bg-red-500/20 text-red-200 shadow-[0_0_8px_rgba(239,68,68,0.45)]'
                      : 'border-slate-600/70 bg-slate-800/70 text-red-300/90',
                    getValueFlashClass(chainMoves.volume.pe, chainMoves.volume.active),
                  ].join(' ')}
                >
                  {liveVolumeStats.ready ? fmtNum(liveVolumeStats.pe) : '--'}
                </span>
              </div>
            </div>

            {/* ② Total OI */}
            <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.12)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.oi)}`}
              title={`Total Open Interest — CE: ${fmtNum(chainStats.totalCEOI)} | PE: ${fmtNum(chainStats.totalPEOI)}`}>
              <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-slate-300">Total OI</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className="text-[13px] sm:text-[14px] font-black text-emerald-300">
                  CE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    chainStats.ceOIPct >= chainStats.peOIPct
                      ? 'border-emerald-300/90 bg-emerald-500/18 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                      : 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300',
                    getValueFlashClass(chainMoves.oi.ce, chainMoves.oi.active),
                  ].join(' ')}>{chainStats.ceOIPct}%</span>
                </span>
                <span className="text-[9px] text-slate-600">/</span>
                <span className="text-[13px] sm:text-[14px] font-black text-red-300">
                  PE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    chainStats.peOIPct > chainStats.ceOIPct
                      ? 'border-red-300/90 bg-red-500/18 text-red-200 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                      : 'border-red-300/35 bg-red-500/6 text-red-300',
                    getValueFlashClass(chainMoves.oi.pe, chainMoves.oi.active),
                  ].join(' ')}>{chainStats.peOIPct}%</span>
                </span>
              </div>
              <div className="flex h-[5px] rounded-full overflow-hidden bg-slate-800/80">
                <div className="bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-500 rounded-l-full"
                  style={{ width: `${chainStats.ceOIPct}%` }} />
                <div className="bg-gradient-to-l from-red-500 to-red-400 transition-all duration-500 rounded-r-full"
                  style={{ width: `${chainStats.peOIPct}%` }} />
              </div>
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tabular-nums">
                <span
                  className={[
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
                    chainStats.totalCEOI >= chainStats.totalPEOI
                      ? 'border-cyan-300/95 bg-cyan-500/18 text-cyan-100 shadow-[0_0_12px_rgba(6,182,212,0.58)] ring-1 ring-cyan-300/40'
                      : 'border-cyan-300/35 bg-cyan-500/6 text-cyan-200/90',
                    getValueFlashClass(chainMoves.oi.ce, chainMoves.oi.active),
                  ].join(' ')}
                >
                  {fmtNum(chainStats.totalCEOI)}
                </span>
                <span
                  className={[
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
                    chainStats.totalPEOI > chainStats.totalCEOI
                      ? 'border-red-300/95 bg-red-500/18 text-red-100 shadow-[0_0_12px_rgba(239,68,68,0.58)] ring-1 ring-red-300/40'
                      : 'border-red-300/35 bg-red-500/6 text-red-200/90',
                    getValueFlashClass(chainMoves.oi.pe, chainMoves.oi.active),
                  ].join(' ')}
                >
                  {fmtNum(chainStats.totalPEOI)}
                </span>
              </div>
            </div>

            {/* ③ OI Change */}
            <div className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-amber-400/40 bg-amber-500/10 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.12)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.oiChange)}`}
              title={`OI Change — CE: ${chainStats.totalCEOIChg >= 0 ? '+' : ''}${fmtNum(chainStats.totalCEOIChg)} | PE: ${chainStats.totalPEOIChg >= 0 ? '+' : ''}${fmtNum(chainStats.totalPEOIChg)}`}>
              <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-slate-300">OI Change</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className={`text-[13px] sm:text-[14px] font-black ${chainStats.totalCEOIChg >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                  CE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    Math.abs(chainStats.totalCEOIChg) >= Math.abs(chainStats.totalPEOIChg)
                      ? (chainStats.totalCEOIChg >= 0
                          ? 'border-emerald-300/95 bg-emerald-500/18 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                          : 'border-red-300/95 bg-red-500/18 text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.5)]')
                      : (chainStats.totalCEOIChg >= 0
                          ? 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300'
                          : 'border-red-300/35 bg-red-500/6 text-red-300'),
                    getValueFlashClass(chainMoves.oiChange.ce, chainMoves.oiChange.active),
                  ].join(' ')}>
                    {chainStats.totalCEOIChg >= 0 ? '+' : ''}{fmtNum(chainStats.totalCEOIChg)}
                  </span>
                </span>
                <span className="text-[9px] text-slate-600">/</span>
                <span className={`text-[13px] sm:text-[14px] font-black ${chainStats.totalPEOIChg >= 0 ? 'text-red-300' : 'text-emerald-300'}`}>
                  PE <span className={[
                    'inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] leading-none transition-all duration-300',
                    Math.abs(chainStats.totalPEOIChg) > Math.abs(chainStats.totalCEOIChg)
                      ? (chainStats.totalPEOIChg >= 0
                          ? 'border-red-300/95 bg-red-500/18 text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                          : 'border-emerald-300/95 bg-emerald-500/18 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.5)]')
                      : (chainStats.totalPEOIChg >= 0
                          ? 'border-red-300/35 bg-red-500/6 text-red-300'
                          : 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300'),
                    getValueFlashClass(chainMoves.oiChange.pe, chainMoves.oiChange.active),
                  ].join(' ')}>
                    {chainStats.totalPEOIChg >= 0 ? '+' : ''}{fmtNum(chainStats.totalPEOIChg)}
                  </span>
                </span>
              </div>
              <div className="flex h-[5px] rounded-full overflow-hidden bg-slate-800/80">
                <div className="bg-gradient-to-r from-emerald-500/80 to-emerald-400/80 transition-all duration-500 rounded-l-full"
                  style={{ width: `${chainStats.ceOIChgPct}%` }} />
                <div className="bg-gradient-to-l from-red-500/80 to-red-400/80 transition-all duration-500 rounded-r-full"
                  style={{ width: `${chainStats.peOIChgPct}%` }} />
              </div>
              <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono tabular-nums">
                <span
                  className={[
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
                    chainStats.ceOIChgPct >= chainStats.peOIChgPct
                      ? 'border-amber-300/90 bg-amber-500/18 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.48)]'
                      : 'border-amber-300/35 bg-amber-500/6 text-amber-300/90',
                    getValueFlashClass(chainMoves.oiChange.ce, chainMoves.oiChange.active),
                  ].join(' ')}
                >
                  CE {chainStats.ceOIChgPct}%
                </span>
                <span
                  className={[
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
                    chainStats.peOIChgPct > chainStats.ceOIChgPct
                      ? 'border-red-300/90 bg-red-500/18 text-red-100 shadow-[0_0_10px_rgba(239,68,68,0.48)]'
                      : 'border-red-300/35 bg-red-500/6 text-red-300/90',
                    getValueFlashClass(chainMoves.oiChange.pe, chainMoves.oiChange.active),
                  ].join(' ')}
                >
                  PE {chainStats.peOIChgPct}%
                </span>
              </div>
            </div>

            {/* ④ Price Action — CE/PE momentum from live price movement */}
            {(() => {
              const cePct = chainStats.ceAvgChgPct;
              const pePct = chainStats.peAvgChgPct;
              const ceLabel = chainStats.ceMomentumLabel;
              const peLabel = chainStats.peMomentumLabel;

              const ceNeutral = ceLabel === 'FLAT';
              const peNeutral = peLabel === 'FLAT';

              // Value colour + optional glow when rising/falling
              const ceValClass =
                ceLabel === 'SURGING'    ? 'text-emerald-200 drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]' :
                ceLabel === 'RISING'     ? 'text-emerald-300 drop-shadow-[0_0_4px_rgba(52,211,153,0.5)]' :
                ceLabel === 'FLAT'       ? 'text-slate-400' :
                ceLabel === 'FALLING'    ? 'text-red-300 drop-shadow-[0_0_4px_rgba(248,113,113,0.5)]' :
                                           'text-red-200 drop-shadow-[0_0_6px_rgba(248,113,113,0.8)]';
              const peValClass =
                peLabel === 'SURGING'    ? 'text-rose-200 drop-shadow-[0_0_6px_rgba(251,113,133,0.8)]' :
                peLabel === 'RISING'     ? 'text-rose-300 drop-shadow-[0_0_4px_rgba(251,113,133,0.5)]' :
                peLabel === 'FLAT'       ? 'text-slate-400' :
                peLabel === 'FALLING'    ? 'text-sky-300 drop-shadow-[0_0_4px_rgba(56,189,248,0.5)]' :
                                           'text-sky-200 drop-shadow-[0_0_6px_rgba(56,189,248,0.8)]';

              // Badge colours for state pill
              const ceBadgeClass =
                ceLabel === 'SURGING' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                ceLabel === 'RISING'  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' :
                ceLabel === 'FLAT'    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                ceLabel === 'FALLING' ? 'bg-red-500/10 text-red-400 border-red-500/30' :
                                        'bg-red-500/20 text-red-300 border-red-500/40';
              const peBadgeClass =
                peLabel === 'SURGING' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' :
                peLabel === 'RISING'  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' :
                peLabel === 'FLAT'    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' :
                peLabel === 'FALLING' ? 'bg-sky-500/10 text-sky-400 border-sky-500/30' :
                                        'bg-sky-500/20 text-sky-300 border-sky-500/40';

              const shortLabel = (m: string) =>
                m === 'SURGING' ? 'Strong Up' : m === 'RISING' ? 'Up' :
                m === 'FLAT'    ? 'Sideways' : m === 'FALLING' ? 'Down' : 'Strong Down';

              const ceSpeedTag = chainStats.ceHotPct > 60 ? 'Fast' : chainStats.ceHotPct > 30 ? 'Active' : '';
              const peSpeedTag = chainStats.peHotPct > 60 ? 'Fast' : chainStats.peHotPct > 30 ? 'Active' : '';
              const bothDown = cePct < -0.25 && pePct < -0.25;
              const bothUp = cePct > 0.25 && pePct > 0.25;

              // Market direction from CE/PE price action
              const marketBias =
                cePct > 0.25 && pePct < -0.25
                  ? { tag: 'Market Up', detail: 'Call buyers in control', cls: 'text-emerald-200 bg-emerald-500/15 border-emerald-400/45' }
                  : pePct > 0.25 && cePct < -0.25
                  ? { tag: 'Market Down', detail: 'Put buyers in control', cls: 'text-red-200 bg-red-500/15 border-red-400/45' }
                  : cePct < -0.25 && pePct < -0.25
                  ? { tag: 'No Clear Trend', detail: 'Both CE and PE falling (premium decay)', cls: 'text-amber-200 bg-amber-500/12 border-amber-400/45' }
                  : cePct > 0.25 && pePct > 0.25
                  ? { tag: 'High Volatility', detail: 'Both CE and PE rising', cls: 'text-cyan-200 bg-cyan-500/12 border-cyan-400/45' }
                  : { tag: 'Balanced', detail: 'Wait for clear direction', cls: 'text-slate-200 bg-slate-700/30 border-slate-500/45' };

              // Neutral warning banner when both sides flat
              const bothNeutral = ceNeutral && peNeutral;

              return (
                <div
                  className={`flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border transition-all duration-200 overflow-hidden ${bothNeutral ? 'border-amber-400/45 bg-amber-500/10' : 'border-cyan-400/45 bg-cyan-500/10'} shadow-[inset_0_0_0_1px_rgba(6,182,212,0.1)] ${getMetricCardFlashClass(chainMoves.priceAction)}`}
                  title={`CE: ${cePct >= 0 ? '+' : ''}${cePct.toFixed(2)}% (${ceLabel}) | PE: ${pePct >= 0 ? '+' : ''}${pePct.toFixed(2)}% (${peLabel})`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[10px] sm:text-[11px] font-bold tracking-widest uppercase text-slate-300">Price Action</span>
                    {bothNeutral && (
                      <span className="text-[9px] font-bold bg-amber-500/20 text-amber-200 border border-amber-400/50 rounded px-1.5 py-0.5 whitespace-nowrap">
                        Wait
                      </span>
                    )}
                  </div>

                  {/* Clear market direction cue for non-technical users */}
                  <div className={`rounded border px-2 py-1.5 text-[10px] sm:text-[11px] leading-tight ${marketBias.cls}`}>
                    <div className="font-black">{marketBias.tag}</div>
                    <div className="font-semibold opacity-90">{marketBias.detail}</div>
                  </div>

                  {/* CE row — label · value on same line, badge below */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-[11px] sm:text-[12px] font-black shrink-0 ${cePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>CE</span>
                      <span className={`text-[14px] sm:text-[16px] font-black font-mono tabular-nums leading-none transition-all duration-300 ${ceValClass} ${getValueFlashClass(chainMoves.priceAction.ce, chainMoves.priceAction.active)}`}>
                        {cePct >= 0 ? '+' : ''}{cePct.toFixed(2)}%
                      </span>
                    </div>
                    <span className={`self-start inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none whitespace-nowrap ${ceBadgeClass}`}>
                      {bothDown ? 'Premium Decay' : bothUp ? 'IV Expansion' : shortLabel(ceLabel)}
                      {ceSpeedTag && <span>· {ceSpeedTag}</span>}
                    </span>
                  </div>

                  {/* PE row */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-[11px] sm:text-[12px] font-black shrink-0 ${pePct >= 0 ? 'text-rose-400' : 'text-sky-400'}`}>PE</span>
                      <span className={`text-[14px] sm:text-[16px] font-black font-mono tabular-nums leading-none transition-all duration-300 ${peValClass} ${getValueFlashClass(chainMoves.priceAction.pe, chainMoves.priceAction.active)}`}>
                        {pePct >= 0 ? '+' : ''}{pePct.toFixed(2)}%
                      </span>
                    </div>
                    <span className={`self-start inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[9px] font-bold leading-none whitespace-nowrap ${peBadgeClass}`}>
                      {bothDown ? 'Premium Decay' : bothUp ? 'IV Expansion' : shortLabel(peLabel)}
                      {peSpeedTag && <span>· {peSpeedTag}</span>}
                    </span>
                  </div>

                  {/* Momentum dominance bar */}
                  <div className="flex h-[3px] rounded-full overflow-hidden bg-slate-800/80 mt-0.5">
                    <div
                      className={`transition-all duration-500 rounded-l-full ${cePct >= 0 ? 'bg-gradient-to-r from-emerald-500/80 to-emerald-400/80' : 'bg-gradient-to-r from-red-500/80 to-red-400/80'}`}
                      style={{ width: `${chainStats.cePaDomPct}%` }}
                    />
                    <div
                      className={`transition-all duration-500 rounded-r-full ${pePct >= 0 ? 'bg-gradient-to-l from-rose-500/80 to-rose-400/80' : 'bg-gradient-to-l from-sky-500/80 to-sky-400/80'}`}
                      style={{ width: `${100 - chainStats.cePaDomPct}%` }}
                    />
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>

      {/* Intelligence Panel */}
      {intelligence && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 mb-3 overflow-hidden">

          {/* Row 1: Signal label + confidence bar + actionability */}
          <div className={`flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-700/30 transition-colors duration-500 ${scoreFlash === 'up' ? 'bg-emerald-500/8' : scoreFlash === 'down' ? 'bg-red-500/8' : ''}`}>
            <div className="flex items-center gap-2">
              <span className={`text-[12px] sm:text-[14px] font-black tracking-wide transition-all duration-300 ${(tradeDecision ? DECISION_BADGE_CFG[tradeDecision].color : OVERALL_CFG[symbolSignal.signal].color)}`}>
                {tradeDecision ? DECISION_BADGE_CFG[tradeDecision].arrow : OVERALL_CFG[symbolSignal.signal].arrow} {tradeDecision ? DECISION_BADGE_CFG[tradeDecision].label : OVERALL_CFG[symbolSignal.signal].label}
              </span>
              <span className={`text-[9px] font-mono tabular-nums transition-colors duration-300 ${scoreFlash === 'up' ? 'text-emerald-300' : scoreFlash === 'down' ? 'text-red-300' : 'text-slate-500'}`}>
                {symbolSignal.score > 0 ? '+' : ''}{symbolSignal.score}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1" title={intelligence.confidenceReason}>
                <div className="w-16 sm:w-20 h-1.5 rounded-full bg-slate-700/80 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${intelligence.confidence >= 70 ? 'bg-emerald-400' : intelligence.confidence >= 45 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${intelligence.confidence}%` }}
                  />
                </div>
                <span className={`text-[10px] font-bold tabular-nums transition-all duration-300 ${intelligence.confidence >= 70 ? 'text-emerald-400' : intelligence.confidence >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                  {intelligence.confidence}%
                </span>
              </div>
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold ${actionabilityTone}`}>
                {actionability}
              </span>
            </div>
          </div>

          {/* Row 1.5: OI Structure (LB/SB/SC/LU aggregate) */}
          {oiStructure && (
            <div className="px-2.5 sm:px-3 py-2 border-b border-slate-700/30 bg-slate-900/35">
              <div className={`rounded border px-2 py-1.5 min-w-0 ${oiStructure.oneBoxTone}`}>
                <div className="text-[8px] sm:text-[9px] tracking-widest uppercase opacity-80 font-bold">OI Structure</div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0">
                  <span className="text-[11px] sm:text-[12px] font-black leading-tight break-words">{oiStructure.overallTopLabel}</span>
                  {oiStructure.overallTopPct != null && (
                    <span className="text-[10px] font-mono tabular-nums opacity-90">{oiStructure.overallTopPct}%</span>
                  )}
                  <span className="text-[9px] font-semibold opacity-80">{oiStructure.biasTag}</span>
                </div>
              </div>
            </div>
          )}

          {/* Row 2: PCR | Max Pain | Regime + S/R */}
          <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-700/30">

            {/* PCR */}
            <div className={`flex flex-col gap-0.5 px-2.5 py-2 transition-colors duration-500 ${scoreFlash ? (scoreFlash === 'up' ? 'bg-emerald-500/5' : 'bg-red-500/5') : ''}`}>
              <span className="text-[8px] sm:text-[9px] font-bold tracking-widest text-slate-500 uppercase">Put/Call Ratio</span>
              <span className={`text-[15px] sm:text-[17px] font-black font-mono leading-none tabular-nums transition-colors duration-300 ${(pcr ?? 1) > 1.2 ? 'text-emerald-400' : (pcr ?? 1) < 0.8 ? 'text-red-400' : 'text-amber-400'}`}>
                {pcr?.toFixed(2) ?? '--'}
              </span>
              <span className={`text-[9px] font-semibold transition-colors duration-300 ${(pcr ?? 1) > 1.2 ? 'text-emerald-500' : (pcr ?? 1) < 0.8 ? 'text-red-500' : 'text-amber-500'}`}>
                {(pcr ?? 1) > 1.2 ? 'Bullish bias' : (pcr ?? 1) < 0.8 ? 'Bearish bias' : 'Balanced'}
              </span>
            </div>

            {/* Max Pain */}
            <div className={`flex flex-col gap-0.5 px-2.5 py-2 transition-colors duration-500 ${scoreFlash ? (scoreFlash === 'up' ? 'bg-emerald-500/5' : 'bg-red-500/5') : ''}`}>
              <span className="text-[8px] sm:text-[9px] font-bold tracking-widest text-slate-500 uppercase">Max Pain</span>
              <span className="text-[15px] sm:text-[17px] font-black font-mono leading-none tabular-nums text-violet-300">
                {intelligence.maxPain?.toLocaleString('en-IN') ?? '--'}
              </span>
              <span className="text-[9px] font-semibold text-violet-400/70 transition-all duration-300">
                {intelligence.maxPainGapPct != null
                  ? `${intelligence.maxPainGapPct > 0 ? '+' : ''}${intelligence.maxPainGapPct}% from spot`
                  : 'Writers\' target'}
              </span>
            </div>

            {/* Today's Market Regime Engine */}
            <div className={`flex flex-col gap-1 px-2.5 py-2 transition-colors duration-500 ${scoreFlash ? (scoreFlash === 'up' ? 'bg-emerald-500/5' : 'bg-red-500/5') : ''}`}>
              <span className="text-[8px] sm:text-[9px] font-bold tracking-widest text-slate-500 uppercase">Today&apos;s Market Regime</span>

              <div className={`rounded border px-1.5 py-1 ${todaysRegime.scoreTone}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] sm:text-[11px] font-black leading-none">{todaysRegime.trendTag}</span>
                  <span className="text-[10px] font-mono font-black tabular-nums leading-none">
                    {todaysRegime.trendScore > 0 ? '+' : ''}{todaysRegime.trendScore}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  <span className="text-[9px] font-black">{todaysRegime.marketMode} · {todaysRegime.sidePlan}</span>
                  <span className="text-[8px] font-semibold opacity-80">{todaysRegime.strength}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Row 3 (Insights) intentionally hidden to save space */}
        </div>
      )}

      {/* Trade action banner intentionally hidden to free space */}

      {/* Feed status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 rounded-lg border border-slate-700/30 bg-slate-900/40 px-2 py-1">
        <span className="text-[10px] sm:text-[11px] font-medium text-slate-300">{feedLabel}</span>
        <div className="flex flex-wrap items-center gap-2 text-[8px] sm:text-[10px] font-mono text-slate-500">
          <span title="Spot/ATM recalculation cadence — recomputed every 500ms from live feed">Spot: 0.5s</span>
          <span title="CE/PE option-chain full refresh from Zerodha — every 1.5s">Chain: 1.5s</span>
        </div>
      </div>

      {/* Strike table header (institutional compact layout) */}
      <div className="-mx-1 sm:mx-0 rounded-t-lg overflow-hidden border border-slate-600/70 mb-2 bg-slate-900/70 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.14)]">
        <div className="grid grid-cols-[minmax(0,1fr)_68px_52px_52px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_92px_64px_64px_minmax(0,1fr)] items-center">
          <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-emerald-500/10 border-r border-slate-700/50 min-w-0">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0" />
            <span className="truncate text-[11px] sm:text-[13px] font-black tracking-wide sm:tracking-widest uppercase text-emerald-200">CALL (CE)</span>
          </div>
          <div className="flex items-center justify-center px-1 py-1.5 sm:py-2 bg-slate-800/60 border-r border-slate-700/50">
            <span className="text-[10px] sm:text-[12px] font-black tracking-wide sm:tracking-widest uppercase text-cyan-300">STRIKE</span>
          </div>
          <div className="flex items-center justify-center px-1 py-1.5 sm:py-2 bg-slate-800/60 border-r border-slate-700/50">
            <span className="text-[9px] sm:text-[11px] font-black tracking-wide uppercase text-amber-200">VOL</span>
          </div>
          <div className="flex items-center justify-center px-1 py-1.5 sm:py-2 bg-slate-800/60 border-r border-slate-700/50">
            <span className="text-[9px] sm:text-[11px] font-black tracking-wide uppercase text-blue-200">OI</span>
          </div>
          <div className="flex items-center justify-end gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 bg-red-500/10 min-w-0">
            <span className="truncate text-[11px] sm:text-[13px] font-black tracking-wide sm:tracking-widest uppercase text-red-200">PUT (PE)</span>
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0" />
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(76px,92px)_minmax(0,1fr)] items-center border-t border-slate-700/40 bg-slate-900/40 text-[8px] sm:text-[11px]">
          <div className="px-2 sm:px-3 py-1 text-slate-300 truncate leading-tight">Signal | Price | V | OI | PA</div>
          <div className="px-1 py-1 text-center text-slate-200 font-semibold leading-tight whitespace-nowrap">Core Strike Metrics</div>
          <div className="px-2 sm:px-3 py-1 text-right text-slate-300 truncate leading-tight">PA | OI | V | Price | Signal</div>
        </div>
      </div>

      {/* Strike rows */}
      <div className="-mx-1 sm:mx-0 flex flex-col gap-2.5 sm:gap-1.5 md:gap-1">
        {data.strikes.map(row => (
          <StrikeRowComponent 
            key={row.strike} 
            row={row} 
            maxVol={maxVol} 
            maxOI={maxOI} 
            symbolKey={symbolKey}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-2.5 pt-2 border-t border-slate-700/30 text-[9px] text-slate-600">
      </div>
    </div>
  );
});
SymbolStrikeCard.displayName = 'SymbolStrikeCard';

type StrikeIntelSymbolKey = keyof StrikeIntelligenceData;

type TerminalOverviewRow = {
  key: StrikeIntelSymbolKey;
  label: string;
  status: 'LIVE' | 'DELAYED' | 'OFFLINE';
  signal: OverallSignal;
  score: number;
  confidence: number;
  actionability: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  regime: string;
  tradePlan: TradeDecision;
  bullPressure: number;
  bearPressure: number;
  trapRisk: number;
  pcr: number | null;
  spot: number | null;
  worldBias: string | null;
  worldScore: number | null;
  flowDepth: number;
};

const STRIKE_TERMINAL_SYMBOLS: readonly { key: StrikeIntelSymbolKey; label: string }[] = [
  { key: 'NIFTY', label: 'NIFTY 50' },
  { key: 'BANKNIFTY', label: 'BANK NIFTY' },
  { key: 'SENSEX', label: 'SENSEX' },
] as const;

const ACTIONABILITY_TONE: Record<TerminalOverviewRow['actionability'], string> = {
  HIGH: 'text-emerald-200 border-emerald-400/50 bg-emerald-500/12',
  MEDIUM: 'text-cyan-200 border-cyan-400/45 bg-cyan-500/10',
  LOW: 'text-amber-200 border-amber-400/45 bg-amber-500/10',
  NONE: 'text-slate-300 border-slate-500/35 bg-slate-700/20',
};

const STATUS_TONE: Record<TerminalOverviewRow['status'], string> = {
  LIVE: 'text-emerald-300 border-emerald-400/45 bg-emerald-500/10',
  DELAYED: 'text-amber-300 border-amber-400/45 bg-amber-500/10',
  OFFLINE: 'text-slate-300 border-slate-500/35 bg-slate-700/20',
};

function clampPct(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function getFlowDepth(data: SymbolStrikeData | null): number {
  if (!data) return 0;
  const totalVol = data.chainTotals?.totalVol ?? ((data.chainTotals?.totalCEVol ?? 0) + (data.chainTotals?.totalPEVol ?? 0));
  if (totalVol > 0) {
    return Math.min(100, Math.round(Math.log10(totalVol + 1) * 14));
  }
  const visibleVol = data.strikes.reduce((sum, row) => sum + row.ce.volume + row.pe.volume, 0);
  return visibleVol > 0 ? Math.min(100, Math.round(Math.log10(visibleVol + 1) * 14)) : 0;
}

function getOverviewTradePlan(data: SymbolStrikeData | null): TradeDecision {
  const strikes = data?.strikes ?? [];
  const atmRow = strikes.find((row) => row.isATM) ?? (strikes.length > 0 ? strikes[Math.floor(strikes.length / 2)] : null);
  const overallScore = Math.round(data?.intelligence?.score ?? 0);

  if (!atmRow) return 'WAIT';

  return deriveTradeDecision(
    atmRow.ce.signal,
    atmRow.pe.signal,
    Math.round(atmRow.ce.score),
    Math.round(atmRow.pe.score),
    overallScore,
  );
}

function buildTerminalOverviewRow(
  key: StrikeIntelSymbolKey,
  label: string,
  data: SymbolStrikeData | null,
): TerminalOverviewRow {
  const intelligence = data?.intelligence;
  const status: TerminalOverviewRow['status'] = data?.dataSource === 'LIVE'
    ? 'LIVE'
    : data?.dataSource
    ? 'DELAYED'
    : 'OFFLINE';

  return {
    key,
    label,
    status,
    signal: (intelligence?.signal as OverallSignal | undefined) ?? 'NEUTRAL',
    score: Math.round(intelligence?.score ?? 0),
    confidence: Math.round(intelligence?.confidence ?? 0),
    actionability: intelligence?.actionability ?? 'NONE',
    regime: intelligence?.regime ?? 'NO_DATA',
    tradePlan: getOverviewTradePlan(data),
    bullPressure: clampPct(intelligence?.bullPressure),
    bearPressure: clampPct(intelligence?.bearPressure),
    trapRisk: clampPct(intelligence?.trapRiskPct),
    pcr: intelligence?.pcr ?? null,
    spot: data?.spot ?? null,
    worldBias: intelligence?.worldMarket?.bias ?? null,
    worldScore: intelligence?.worldMarket?.influenceScore ?? null,
    flowDepth: getFlowDepth(data),
  };
}

const StrikeTerminalOverview = memo<{ strikeData: StrikeIntelligenceData; isConnected: boolean; tickTs: string; statusLabel: string; }>(({ strikeData, isConnected, tickTs, statusLabel }) => {
  const overviewRows = useMemo(
    () => STRIKE_TERMINAL_SYMBOLS.map(({ key, label }) => buildTerminalOverviewRow(key, label, strikeData[key])),
    [strikeData],
  );

  const liveCount = overviewRows.filter((row) => row.status === 'LIVE').length;
  const actionableCount = overviewRows.filter((row) => row.actionability === 'HIGH' || row.actionability === 'MEDIUM').length;
  const avgConfidence = overviewRows.length > 0
    ? Math.round(overviewRows.reduce((sum, row) => sum + row.confidence, 0) / overviewRows.length)
    : 0;
  const avgScore = overviewRows.length > 0
    ? Math.round(overviewRows.reduce((sum, row) => sum + row.score, 0) / overviewRows.length)
    : 0;
  const avgTrapRisk = overviewRows.length > 0
    ? Math.round(overviewRows.reduce((sum, row) => sum + row.trapRisk, 0) / overviewRows.length)
    : 0;
  const avgFlowDepth = overviewRows.length > 0
    ? Math.round(overviewRows.reduce((sum, row) => sum + row.flowDepth, 0) / overviewRows.length)
    : 0;
  const leader = overviewRows.reduce<TerminalOverviewRow | null>((best, row) => {
    if (!best) return row;
    const bestWeight = Math.abs(best.score) * 100 + best.confidence;
    const rowWeight = Math.abs(row.score) * 100 + row.confidence;
    return rowWeight > bestWeight ? row : best;
  }, null);
  const dominantBias = avgScore >= 15 ? 'BULLISH' : avgScore <= -15 ? 'BEARISH' : 'BALANCED';
  const dominantTone = avgScore >= 15
    ? 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10'
    : avgScore <= -15
    ? 'text-red-200 border-red-400/45 bg-red-500/10'
    : 'text-amber-200 border-amber-400/45 bg-amber-500/10';

  return (
    <div className="mb-4 lg:mb-5 rounded-2xl border border-slate-700/50 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_35%),linear-gradient(180deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-3 sm:p-4 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.06)]">
      <div className="grid gap-3 xl:grid-cols-[1.25fr_2fr]">
        <div className="rounded-2xl border border-slate-700/45 bg-slate-950/65 p-3 sm:p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-300/80">Institutional Command Deck</p>
              <p className="mt-1 text-[12px] sm:text-[13px] text-slate-300">Cross-market strike breadth, execution readiness, and live risk posture for the active option complex.</p>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-slate-700/50 bg-slate-900/70 px-2.5 py-1 text-[10px] font-mono text-slate-400">
              <span className={`inline-block h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span>{isConnected ? tickTs : 'offline'}</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Breadth</p>
              <p className={`mt-1 text-lg font-black font-mono ${avgScore >= 15 ? 'text-emerald-300' : avgScore <= -15 ? 'text-red-300' : 'text-amber-300'}`}>{avgScore > 0 ? '+' : ''}{avgScore}</p>
              <p className="text-[9px] font-semibold text-slate-400">{dominantBias}</p>
            </div>
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Confidence</p>
              <p className="mt-1 text-lg font-black font-mono text-cyan-300">{avgConfidence}%</p>
              <p className="text-[9px] font-semibold text-slate-400">Composite conviction</p>
            </div>
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Flow Depth</p>
              <p className="mt-1 text-lg font-black font-mono text-violet-300">{avgFlowDepth}</p>
              <p className="text-[9px] font-semibold text-slate-400">Liquidity readiness</p>
            </div>
            <div className="rounded-xl border border-slate-800/70 bg-slate-900/70 p-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.18em] text-slate-500">Trap Risk</p>
              <p className={`mt-1 text-lg font-black font-mono ${avgTrapRisk >= 60 ? 'text-red-300' : avgTrapRisk >= 35 ? 'text-amber-300' : 'text-emerald-300'}`}>{avgTrapRisk}%</p>
              <p className="text-[9px] font-semibold text-slate-400">Average adverse risk</p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.16em] ${dominantTone}`}>{dominantBias} regime</span>
            <span className="inline-flex items-center rounded-full border border-slate-700/45 bg-slate-900/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">{liveCount}/3 live books</span>
            <span className="inline-flex items-center rounded-full border border-slate-700/45 bg-slate-900/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">{actionableCount} execution-ready</span>
            <span className="inline-flex items-center rounded-full border border-slate-700/45 bg-slate-900/70 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-300">Feed {statusLabel}</span>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {overviewRows.map((row) => {
            const signalCfg = OVERALL_CFG[row.signal] ?? OVERALL_CFG.NEUTRAL;
            const tradeCfg = DECISION_BADGE_CFG[row.tradePlan];
            const pressureTotal = Math.max(1, row.bullPressure + row.bearPressure);
            const bullWidth = (row.bullPressure / pressureTotal) * 100;
            const bearWidth = (row.bearPressure / pressureTotal) * 100;
            const trapTone = row.trapRisk >= 60 ? 'text-red-300' : row.trapRisk >= 35 ? 'text-amber-300' : 'text-emerald-300';

            return (
              <div key={row.key} className="rounded-2xl border border-slate-700/45 bg-slate-950/72 p-3 shadow-[inset_0_0_0_1px_rgba(148,163,184,0.04)]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-100">{row.label}</span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] ${STATUS_TONE[row.status]}`}>{row.status}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] ${signalCfg.bg} ${signalCfg.border} ${signalCfg.color}`}>{signalCfg.label}</span>
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.14em] ${ACTIONABILITY_TONE[row.actionability]}`}>{row.actionability}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`text-[18px] font-black font-mono leading-none ${row.score >= 15 ? 'text-emerald-300' : row.score <= -15 ? 'text-red-300' : 'text-amber-300'}`}>{row.score > 0 ? '+' : ''}{row.score}</p>
                    <p className="mt-1 text-[10px] font-bold font-mono text-cyan-300">{row.confidence}%</p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
                  <div className="rounded-xl border border-slate-800/65 bg-slate-900/70 p-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Trade Plan</p>
                    <p className={`mt-1 inline-flex items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] ${tradeCfg.bg} ${tradeCfg.border} ${tradeCfg.color} ${tradeCfg.glow}`}>{tradeCfg.arrow} {tradeCfg.label}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800/65 bg-slate-900/70 p-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Regime</p>
                    <p className="mt-1 text-[10px] font-black text-slate-100">{row.regime.replace(/_/g, ' ')}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800/65 bg-slate-900/70 p-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Spot</p>
                    <p className="mt-1 text-[10px] font-black font-mono text-slate-100">{row.spot != null ? row.spot.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '--'}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800/65 bg-slate-900/70 p-2">
                    <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">PCR</p>
                    <p className={`mt-1 text-[10px] font-black font-mono ${row.pcr == null ? 'text-slate-400' : row.pcr > 1.2 ? 'text-emerald-300' : row.pcr < 0.8 ? 'text-red-300' : 'text-amber-300'}`}>{row.pcr != null ? row.pcr.toFixed(2) : '--'}</p>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">
                    <span>Pressure Balance</span>
                    <span>{row.bullPressure}% / {row.bearPressure}%</span>
                  </div>
                  <div className="flex h-2 overflow-hidden rounded-full bg-slate-800/75">
                    <div className="bg-gradient-to-r from-emerald-500/75 to-emerald-400" style={{ width: `${bullWidth}%` }} />
                    <div className="bg-gradient-to-r from-red-400 to-red-500/75" style={{ width: `${bearWidth}%` }} />
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 text-[9px]">
                  <span className="font-semibold text-slate-400">Trap Risk <span className={`${trapTone} font-black`}>{row.trapRisk}%</span></span>
                  <span className="font-semibold text-slate-400">World {row.worldBias ? <span className="text-slate-200 font-black">{row.worldBias}</span> : <span className="text-slate-500">--</span>}</span>
                  <span className="font-mono font-black text-violet-300">FD {row.flowDepth}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {leader && (
        <div className="mt-3 rounded-2xl border border-slate-700/45 bg-slate-950/72 px-3 py-2.5">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-[0.22em] text-slate-500">Lead Contract Cluster</span>
              <span className="inline-flex items-center rounded-full border border-cyan-400/40 bg-cyan-500/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-cyan-200">{leader.label}</span>
              <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${ACTIONABILITY_TONE[leader.actionability]}`}>{leader.actionability} actionability</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="rounded-full border border-slate-700/45 bg-slate-900/70 px-2.5 py-1 font-mono font-black text-slate-100">Score {leader.score > 0 ? '+' : ''}{leader.score}</span>
              <span className="rounded-full border border-slate-700/45 bg-slate-900/70 px-2.5 py-1 font-mono font-black text-cyan-300">Conf {leader.confidence}%</span>
              <span className={`rounded-full border px-2.5 py-1 font-black ${DECISION_BADGE_CFG[leader.tradePlan].bg} ${DECISION_BADGE_CFG[leader.tradePlan].border} ${DECISION_BADGE_CFG[leader.tradePlan].color}`}>{DECISION_BADGE_CFG[leader.tradePlan].label}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
StrikeTerminalOverview.displayName = 'StrikeTerminalOverview';

// Main Component

const StrikeIntelligence = memo(() => {
  const { strikeData, isConnected, lastUpdate } = useStrikeIntelligence();
  const [tickTs, setTickTs] = useState<string>('--:--:--');

  // Update displayed timestamp every time a new WebSocket message arrives
  useEffect(() => {
    if (!lastUpdate) return;
    setTickTs(new Date(lastUpdate).toLocaleTimeString('en-IN', { hour12: false }));
  }, [lastUpdate]);

  const dataStatus = useMemo(() => {
    const sources = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(s => strikeData[s]?.dataSource).filter(Boolean);
    if (sources.length === 0)          return { label: 'WAITING',    color: 'text-slate-500'   };
    if (sources.includes('LIVE'))      return { label: 'LIVE',       color: 'text-emerald-400' };
    if (sources.includes('LAST_CLOSE'))return { label: 'LAST CLOSE', color: 'text-amber-400'   };
    if (sources.includes('CACHED'))    return { label: 'CACHED',     color: 'text-amber-400'   };
    return                                    { label: 'CLOSED',     color: 'text-slate-500'   };
  }, [strikeData]);

  return (
    <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 shadow-[0_0_0_1px_rgba(52,211,153,0.08),0_0_24px_0_rgba(52,211,153,0.06)] p-3 sm:p-5 lg:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4 lg:mb-6">
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-6 rounded-full bg-gradient-to-b from-emerald-400 to-green-600 shrink-0" />
          <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight">Strike Intelligence</h3>
          <span className="hidden sm:inline text-[10px] sm:text-[11px] text-emerald-400/60 font-medium">
            ATM +/-5 | CE/PE | Vol | OI | PCR | Max Pain | BSL/SSL | BOS | Adv PA | Trap
          </span>
          <span className={`text-[9px] font-mono ml-1 ${dataStatus.color}`}>{dataStatus.label}</span>
        </div>
        {/* Live feed indicator — ticks every 0.5s when WebSocket is connected */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`inline-block w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} title={isConnected ? 'WebSocket connected' : 'Reconnecting…'} />
          <span className="text-[9px] font-mono text-slate-500" title="Last WebSocket tick">
            {isConnected ? <span className="text-emerald-400/70">{tickTs}</span> : 'offline'}
          </span>
        </div>
      </div>
      <StrikeTerminalOverview strikeData={strikeData} isConnected={isConnected} tickTs={tickTs} statusLabel={dataStatus.label} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-5 xl:gap-6">
        <SymbolStrikeCard data={strikeData.NIFTY}      name="NIFTY 50"   />
        <SymbolStrikeCard data={strikeData.BANKNIFTY}  name="BANK NIFTY" />
        <SymbolStrikeCard data={strikeData.SENSEX}     name="SENSEX"     />
      </div>
    </div>
  );
});
StrikeIntelligence.displayName = 'StrikeIntelligence';

export default StrikeIntelligence;

'use client';

import React, { memo, useMemo, useRef, useState, useEffect } from 'react';
import { useStrikeIntelligence, type SymbolStrikeData, type StrikeRow, type StrikeSignal, type StrikeSideData } from '@/hooks/useStrikeIntelligence';

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
  NEUTRAL:     { label: 'NEUTRAL',      short: 'HOLD ',  color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/30',   glow: 'shadow-amber-500/10'  },
  SELL:        { label: 'SELL',         short: 'SELL ',  color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/30',     glow: 'shadow-red-500/10'    },
  STRONG_SELL: { label: 'STRONG SELL',  short: 'S.SEL',  color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/50',     glow: 'shadow-red-500/25'    },
};

type OverallSignal = StrikeSignal;

const OVERALL_CFG: Record<OverallSignal, { label: string; color: string; bg: string; border: string; glow: string; arrow: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-200', bg: 'bg-emerald-500/25', border: 'border-emerald-400/70', glow: 'shadow-[0_0_12px_2px_rgba(52,211,153,0.35)]',   arrow: 'UP++' },
  BUY:         { label: 'BUY',          color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', glow: 'shadow-[0_0_8px_0px_rgba(52,211,153,0.20)]',    arrow: 'UP'   },
  NEUTRAL:     { label: 'NEUTRAL',      color: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-400/40',   glow: '',                                              arrow: '—'    },
  SELL:        { label: 'SELL',         color: 'text-red-300',     bg: 'bg-red-500/15',     border: 'border-red-400/40',     glow: 'shadow-[0_0_8px_0px_rgba(251,113,133,0.20)]',   arrow: 'DOWN' },
  STRONG_SELL: { label: 'STRONG SELL',  color: 'text-red-200',     bg: 'bg-red-500/25',     border: 'border-red-400/70',     glow: 'shadow-[0_0_12px_2px_rgba(251,113,133,0.35)]',  arrow: 'DOWN--' },
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

// Primitives

const SignalBadge = memo<{ signal: StrikeSignal; side: 'CE' | 'PE' }>(({ signal, side }) => {
  const cfg = SIGNAL_CONFIG[signal];
  // CE BUY = market going UP → show upward arrow; PE BUY = market going DOWN → show downward arrow
  // For SELL signals the direction reverses
  const isCE     = side === 'CE';
  const isBuy    = signal === 'STRONG_BUY' || signal === 'BUY';
  const isSell   = signal === 'STRONG_SELL' || signal === 'SELL';
  const arrow    = isBuy  ? (isCE ? '↑' : '↓') : isSell ? (isCE ? '↓' : '↑') : '—';
  const short    = side === 'CE' ? `C.${cfg.short}` : `P.${cfg.short}`;
  return (
    <span
      title={isCE
        ? (isBuy  ? 'CE is strong → market likely going UP → Buy CE (Call option)' : isSell ? 'CE is weak → market likely going DOWN → Buy PE instead' : 'CE neutral — no clear call signal')
        : (isBuy  ? 'PE is strong → market likely going DOWN → Buy PE (Put option)' : isSell ? 'PE is weak → market likely going UP → Buy CE instead' : 'PE neutral — no clear put signal')}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-[12px] font-bold tracking-wider ${cfg.bg} ${cfg.color} ${cfg.border} border shadow-sm ${cfg.glow} transition-colors duration-150`}>
      <span className="text-[8px] leading-none">{arrow}</span>
      {short}
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

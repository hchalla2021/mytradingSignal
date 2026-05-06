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

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE'; volDominant: boolean; oiDominant: boolean; isATM: boolean; symbolKey: SymbolKey; isRecommended?: boolean; displayVolume?: number }>(({ side, label, volDominant, oiDominant, isATM, symbolKey, isRecommended = false, displayVolume }) => {
  const isCE = label === 'CE';
  const displayVolumeSafe = Math.max(0, displayVolume ?? side.volume);

  // ── Price flash detection — brief highlight on each price tick ────────
  const prevPriceRef = useRef<number>(side.price);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [flashAnimKey, setFlashAnimKey] = useState(0);
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);

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

  // ── Velocity heat level ───────────────────────────────────────────────
  const heatLevel = side.velocity === 'EXTREME' ? 3
    : side.velocity === 'HOT'     ? 2
    : side.velocity === 'WARM'    ? 1
    : 0;

  // Raw backend signal — all 10 factors, updates every 0.5s
  const displaySignal    = side.signal;
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
  const trap     = sigs?.trap;
  const bos      = sigs?.bos;
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

  // Price: glow+color on conviction, bright on active — font size FIXED to avoid layout reflow
  const priceChangeColor = side.change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const priceCls = isFullConviction
    ? (isCE
        ? 'text-emerald-200 text-[12px] font-black drop-shadow-[0_0_6px_rgba(52,211,153,0.9)] tabular-nums'
        : 'text-red-200 text-[12px] font-black drop-shadow-[0_0_6px_rgba(239,68,68,0.9)] tabular-nums')
    : isActive
      ? (isCE ? 'text-emerald-300 text-[12px] font-black tabular-nums' : 'text-red-300 text-[12px] font-black tabular-nums')
      : 'text-slate-200 text-[12px] font-semibold font-mono tabular-nums';

  // ── OI Change label (highlighted when significant) ───────────────────
  const oiChgAbs = Math.abs(oiChg);
  const oiChgStr = oiChg === 0 ? '—' : `${oiChg > 0 ? '+' : ''}${fmtNum(oiChg)}`;
  const oiChgCls = oiChgAbs >= rules.minOIChange
    ? (oiChg > 0 
        ? 'text-emerald-200 bg-emerald-500/25 border border-emerald-500/60 rounded px-1 py-0.5 font-black' 
        : 'text-red-200 bg-red-500/25 border border-red-500/60 rounded px-1 py-0.5 font-black')
    : oiChgAbs >= 50
      ? (oiChg > 0 
          ? 'text-emerald-400 bg-emerald-500/15 border border-emerald-500/40 rounded px-1 py-0.5 font-bold' 
          : 'text-red-400 bg-red-500/15 border border-red-500/40 rounded px-1 py-0.5 font-bold')
      : 'text-slate-600';

  // OI interpretation badge
  const oiInterpLabel: Record<string, string> = { LB: 'L.BLD', SB: 'S.BLD', SC: 'S.CVR', LU: 'L.UNW' };
  const oiInterpCls: Record<string, string> = {
    LB: 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40',
    SC: 'text-cyan-300    bg-cyan-500/20    border-cyan-500/40',
    SB: 'text-red-300     bg-red-500/20     border-red-500/40',
    LU: 'text-orange-300  bg-orange-500/20  border-orange-500/40',
  };

  // BOS badge
  const bosCls = bos === 'UP'
    ? 'text-emerald-300 bg-emerald-500/20 border-emerald-500/40'
    : 'text-red-300 bg-red-500/20 border-red-500/40';

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

  // Greeks helpers
  const iv    = sigs?.iv;
  const gamma = sigs?.gamma;
  const theta = sigs?.theta;
  const vega  = sigs?.vega;
  const delta = sigs?.delta;
  const hasGreeks = iv != null || gamma != null || theta != null || vega != null;

  return (
    <div style={{ willChange: 'transform' }} className={`relative flex flex-col gap-[2px] sm:gap-[3px] px-0.5 sm:px-1 py-0.5 sm:py-1.5 rounded-lg transition-colors duration-150 w-full shrink-0 ${bg} ${border} ${isNeutral ? 'opacity-55' : ''}`}>

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

      {/* ── ROW 1: Signal badge + Price + Change ─────────────────────── */}
      <div className={`flex items-center ${isCE ? 'flex-row' : 'flex-row-reverse'} justify-between gap-0.5 sm:gap-0.5`}>
        {/* Only show strong conviction signals */}
        {(displaySignal === 'STRONG_BUY' || displaySignal === 'STRONG_SELL') && <SignalBadge signal={displaySignal} side={label} />}
        {!(displaySignal === 'STRONG_BUY' || displaySignal === 'STRONG_SELL') && <div className="w-[30px] sm:w-[35px]" />}
        <div className={`flex items-center gap-0.5 sm:gap-0.5 ${isCE ? 'justify-end' : 'justify-start'}`}>
          <span className={`w-[40px] sm:w-[55px] text-right transition-all duration-200 px-0.5 sm:px-1.5 py-0.5 rounded-md whitespace-nowrap text-[10px] sm:text-[12px] tabular-nums ${priceCls} ${
            isRecommended
              ? (isCE
                  ? 'bg-emerald-600/20 border border-emerald-500/50 shadow-[0_0_6px_1px_rgba(52,211,153,0.12)] sm:shadow-[0_0_8px_2px_rgba(52,211,153,0.15)]'
                  : 'bg-red-600/20 border border-red-500/50 shadow-[0_0_6px_1px_rgba(239,68,68,0.12)] sm:shadow-[0_0_8px_2px_rgba(239,68,68,0.15)]')
              : ''
          }`}>
            {side.price.toFixed(1 === Math.round(side.price) ? 0 : 1)}
          </span>
          <span className={`w-[36px] sm:w-[44px] text-right text-[7px] sm:text-[8px] font-mono font-bold shrink-0 tabular-nums truncate ${priceChangeColor}`}>
            {side.change >= 0 ? '+' : ''}{side.change.toFixed(1)}
          </span>
        </div>
      </div>

      {/* ── ROW 2: Buy%/Sell% pressure bar ──────────────────────────── */}
      <div className="hidden sm:block">
        <LiquidityBar buyPct={side.breakdown.buyPct} sellPct={side.breakdown.sellPct} neutralPct={side.breakdown.neutralPct} />
      </div>

      {/* ── ROW 3: The 4 most critical live metrics ──────────────────── */}
      {/* Volume | OI — highlighted when dominant */}
      <div className={`flex items-center gap-0.5 text-[8px] sm:text-[10px] font-black`}>
        <span className="text-slate-300 font-bold shrink-0">V</span>
        <span className={`w-[46px] sm:w-[58px] text-right text-[8px] sm:text-[10px] font-mono font-black tabular-nums truncate ${volCls}`}>{fmtNum(displayVolumeSafe)}</span>
        <span className="text-slate-400 text-[7px] sm:text-[9px] font-bold shrink-0">·</span>
        <span className="text-slate-300 font-bold shrink-0">OI</span>
        <span className={`w-[46px] sm:w-[58px] text-right text-[8px] sm:text-[10px] font-mono font-black tabular-nums truncate ${oiCls}`}>{fmtNum(side.oi)}</span>
      </div>

      {/* ── ROW 4: OI Change + OI Interpretation (most real-time signals) */}
      <div className={`flex items-center gap-0.5 flex-nowrap text-[9px] sm:text-[11px] font-black overflow-hidden ${isCE ? '' : 'flex-row-reverse'}`}>
        {/* ΔOI — flashes colour on fresh buildup/unwinding */}
        <span className={`font-mono font-black tabular-nums shrink-0 transition-all duration-200 text-[9px] sm:text-[11px] ${oiChgCls}`}>
          <span className="hidden sm:inline">ΔOI:</span>{oiChgStr}
        </span>

        {/* OI Interpretation badge — the most informative single value */}
        {oiInterp && (
          <span className={`font-black px-0.5 sm:px-1 py-0 rounded border leading-tight shrink-0 text-[8px] sm:text-[10px] ${oiInterpCls[oiInterp] ?? 'text-slate-500'}`}>
            {oiInterpLabel[oiInterp] ?? oiInterp}
          </span>
        )}

        {/* BOS badge — structure break */}
        {bos && (
          <span className={`font-black px-0.5 sm:px-1 py-0 rounded border leading-tight shrink-0 text-[8px] sm:text-[10px] ${bosCls}`}>
            <span className="hidden sm:inline">BOS </span>{bos}
          </span>
        )}

        {/* TRAP warning */}
        {trap && (
          <span className="font-black px-0.5 sm:px-1 py-0 rounded border leading-tight shrink-0 text-amber-300 bg-amber-500/20 border-amber-500/40 animate-pulse text-[8px] sm:text-[10px]">
            ⚠
          </span>
        )}

        {/* B%/S% flow — only when noteworthy */}
        {(buyPct >= 60 || sellPct >= 60) && (
          <span className={`hidden sm:inline font-mono text-[9px] sm:text-[11px] font-black tabular-nums ml-auto shrink-0 ${flowCls}`}>
            B{buyPct}·S{sellPct}
          </span>
        )}
      </div>

      {/* ── ROW 5: Greeks & IV strip ────────────────────────────────── */}
      {/* σ IV | Δ Delta | Γ Gamma | Θ Theta | ν Vega */}
      {hasGreeks && (
        <div className={`hidden sm:flex items-center flex-wrap gap-x-1.5 gap-y-0 pt-[2px] border-t border-slate-700/30 ${isCE ? '' : 'flex-row-reverse'}`}>
          {/* IV — amber/gold: premium/volatility */}
          {iv != null && (
            <span
              title={`Implied Volatility: ${(iv * 100).toFixed(1)}% annualised`}
              className={`text-[10px] sm:text-[12px] font-mono font-black tabular-nums ${
                iv >= 0.35 ? 'text-red-300' : iv >= 0.20 ? 'text-amber-300' : 'text-amber-500'
              }`}>
              σ{(iv * 100).toFixed(1)}%
            </span>
          )}
          {/* Delta — green CE / red PE: directional sensitivity */}
          {delta != null && (
            <span
              title={`Delta: ₹${Math.abs(delta).toFixed(3)} move per ₹1 spot move`}
              className={`text-[10px] sm:text-[12px] font-mono font-black tabular-nums ${isCE ? 'text-emerald-400' : 'text-red-400'}`}>
              Δ{Math.abs(delta).toFixed(2)}
            </span>
          )}
          {/* Gamma — cyan: rate of delta change */}
          {gamma != null && (
            <span
              title={`Gamma: delta changes by ${gamma.toFixed(5)} per ₹1 spot move`}
              className="text-[10px] sm:text-[12px] font-mono font-black text-cyan-400 tabular-nums">
              Γ{gamma.toFixed(4)}
            </span>
          )}
          {/* Theta — orange: time decay per day */}
          {theta != null && (
            <span
              title={`Theta: lose ₹${Math.abs(theta).toFixed(2)}/day to time decay`}
              className={`text-[10px] sm:text-[12px] font-mono font-black tabular-nums ${theta < -20 ? 'text-orange-300' : 'text-orange-400'}`}>
              Θ{theta.toFixed(1)}
            </span>
          )}
          {/* Vega — blue: IV sensitivity */}
          {vega != null && (
            <span
              title={`Vega: ₹${vega.toFixed(1)} gain/loss per +1% IV move`}
              className="text-[10px] sm:text-[12px] font-mono font-black text-blue-400 tabular-nums">
              ν{vega.toFixed(1)}
            </span>
          )}
        </div>
      )}

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

const StrikeRowComponent = memo<{ row: StrikeRow; maxVol: number; maxOI: number; symbolKey: SymbolKey; isRecommended?: boolean; liveCeVolume?: number; livePeVolume?: number }>(({ row, maxVol, maxOI, symbolKey, isRecommended = false, liveCeVolume, livePeVolume }) => {
  const isATM = row.isATM;
  const ceDisplayVol = Math.max(0, liveCeVolume ?? row.ce.volume);
  const peDisplayVol = Math.max(0, livePeVolume ?? row.pe.volume);
  const totalVol  = row.ce.volume + row.pe.volume;
  const totalOI   = row.ce.oi    + row.pe.oi;
  const volIntensity = maxVol > 0 ? Math.min(totalVol / maxVol, 1) : 0;
  const oiIntensity  = maxOI  > 0 ? Math.min(totalOI  / maxOI,  1) : 0;

  // Compute high-conviction signals at the row level for row-wide highlighting
  const ceConv = getHighConvictionSignal(row.ce, symbolKey);
  const peConv = getHighConvictionSignal(row.pe, symbolKey);
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
    <div className={`flex items-stretch gap-0.5 sm:gap-1 rounded-lg transition-all duration-300 overflow-x-hidden ${rowBg} ${rowBorder} ${
      isATM ? 'ring-1 ring-cyan-300/25' : ''
    } hover:bg-white/[0.025]`} style={{ overflow: 'visible' }}>
      {/* CE box with light background */}
      <div className="bg-slate-900/30 border border-slate-500/90 rounded-lg overflow-hidden flex-1 min-w-0">
        <SideCell side={row.ce} label="CE" volDominant={ceDisplayVol > peDisplayVol} oiDominant={row.ce.oi > row.pe.oi} isATM={isATM} symbolKey={symbolKey} isRecommended={isRecommended} displayVolume={ceDisplayVol} />
      </div>

      {/* Strike center */}
      <div className={`flex flex-col items-center justify-center gap-0.5 sm:gap-0.5 px-0.5 sm:px-1 py-0.5 sm:py-1.5 border-x shrink-0 ${
        ceStrong || peStrong ? 'bg-slate-900/80 border-slate-600/60' :
        isATM ? 'border-cyan-300/50 bg-cyan-400/[0.08]' : 'border-slate-700/40'
      }`}>
        <span className={`${strikeNumberCls} text-[11px] sm:text-[14px] md:text-[16px] lg:text-[18px]`}>{row.strike.toLocaleString('en-IN')}</span>
        
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
          
          return (
            <div className={`flex flex-col items-center gap-1 sm:gap-1.5 text-[7px] sm:text-[9px] md:text-[10px] font-mono font-black mt-0.5 sm:mt-0.5 px-0.5 sm:px-1 py-0.5 sm:py-1 rounded transition-all w-[54px] sm:w-[60px] ${
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
            }`}>
              <span className={`w-[45px] text-center font-black tabular-nums text-[8px] sm:text-[9px] ${
                ceConv === 'STRONG_BUY' ? 'text-emerald-300' :
                ceConv === 'STRONG_SELL' ? 'text-red-300' :
                cePrice > pePrice && isDivergent ? 'text-emerald-300' :
                'text-slate-300'
              }`}>
                {cePrice.toFixed(1)}
              </span>
              <span className="text-slate-400 text-[7px] sm:text-[8px] leading-none font-bold">|</span>
              <span className={`w-[45px] text-center font-black tabular-nums text-[8px] sm:text-[9px] ${
                peConv === 'STRONG_BUY' ? 'text-red-300' :
                peConv === 'STRONG_SELL' ? 'text-emerald-300' :
                pePrice > cePrice && isDivergent ? 'text-red-300' :
                'text-slate-300'
              }`}>
                {pePrice.toFixed(1)}
              </span>
            </div>
          );
        })()}
        
        {tradeBadge ? (
          <span className={`text-[9px] sm:text-[11px] md:text-[12px] font-black tracking-tight px-0.5 sm:px-1 py-0.5 rounded animate-pulse ${tradeBadge.cls}`}>
            <span className="hidden sm:inline">{tradeBadge.label}</span>
            <span className="sm:hidden">{tradeBadge.label.split(' ')[0]}</span>
          </span>
        ) : (
          <span className={`text-[9px] sm:text-[11px] md:text-[12px] font-black uppercase tracking-widest px-0.5 sm:px-1 rounded ${
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
        <SideCell side={row.pe} label="PE" volDominant={peDisplayVol > ceDisplayVol} oiDominant={row.pe.oi > row.ce.oi} isATM={isATM} symbolKey={symbolKey} isRecommended={isRecommended} displayVolume={peDisplayVol} />
      </div>
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

// Symbol Card

const SymbolStrikeCard = memo<{ data: SymbolStrikeData | null; name: string }>(({ data, name }) => {
  const [showSMC, setShowSMC] = useState(false);
  const prevDominantRef = useRef<'BULL' | 'BEAR' | 'NEUTRAL'>('NEUTRAL');
  const [flashSide, setFlashSide] = useState<'BULL' | 'BEAR' | null>(null);
  const [chainMoves, setChainMoves] = useState<ChainMoves>(INITIAL_CHAIN_MOVES);
  const [liveVolumeTick, setLiveVolumeTick] = useState<{ ce: number; pe: number; ready: boolean }>({ ce: 0, pe: 0, ready: false });
  const prevStrikeVolumeRef = useRef<Record<number, { ce: number; pe: number }>>({});
  const [liveStrikeVolumeMap, setLiveStrikeVolumeMap] = useState<Record<number, { ce: number; pe: number }>>({});
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
  const isLastClose  = data?.dataSource === 'LAST_CLOSE';
  const isCachedData = data?.dataSource === 'CACHED';
  const hasRealSignal = isLiveData || isLastClose || isCachedData;

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
    const ce = Math.max(0, liveVolumeTick.ce);
    const pe = Math.max(0, liveVolumeTick.pe);
    const total = ce + pe;
    const cePct = total > 0 ? Math.round((ce / total) * 100) : 50;
    const pePct = total > 0 ? 100 - cePct : 50;
    return { ce, pe, total, cePct, pePct, ready: liveVolumeTick.ready && total > 0 };
  }, [liveVolumeTick.ce, liveVolumeTick.pe, liveVolumeTick.ready]);

  // Per-strike live tick volumes for CE/PE (current flow only)
  useEffect(() => {
    if (!hasData) return;
    const prevMap = prevStrikeVolumeRef.current;
    const nextPrev: Record<number, { ce: number; pe: number }> = {};
    const nextLive: Record<number, { ce: number; pe: number }> = {};

    for (const strike of strikes) {
      const key = strike.strike;
      const ceCurr = Math.max(0, strike.ce.volume);
      const peCurr = Math.max(0, strike.pe.volume);
      const prev = prevMap[key];

      const ceLive = prev ? (ceCurr >= prev.ce ? ceCurr - prev.ce : ceCurr) : 0;
      const peLive = prev ? (peCurr >= prev.pe ? peCurr - prev.pe : peCurr) : 0;

      nextLive[key] = { ce: ceLive, pe: peLive };
      nextPrev[key] = { ce: ceCurr, pe: peCurr };
    }

    setLiveStrikeVolumeMap(nextLive);
    prevStrikeVolumeRef.current = nextPrev;
  }, [strikes, hasData]);

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

  // Dominance tracking: highlight the leading side and flash on transition
  useEffect(() => {
    if (!hasRealSignal) return undefined;
    let clearFlashTimer: ReturnType<typeof setTimeout> | null = null;
    const current: 'BULL' | 'BEAR' | 'NEUTRAL' =
      summary.bullPct > summary.bearPct ? 'BULL' :
      summary.bearPct > summary.bullPct ? 'BEAR' : 'NEUTRAL';
    const prev = prevDominantRef.current;
    if (prev !== 'NEUTRAL' && current !== 'NEUTRAL' && prev !== current) {
      setFlashSide(current);
      clearFlashTimer = setTimeout(() => setFlashSide(null), 1800);
    }
    prevDominantRef.current = current;
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

  const sourceColor = isLiveData ? 'text-emerald-400' : isLastClose || isCachedData ? 'text-amber-400' : 'text-slate-500';
  const sourceLabel = isLiveData ? 'LIVE' : isLastClose ? 'LAST CLOSE' : isCachedData ? 'CACHED' : 'CLOSED';

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
    : isLastClose  ? `Last session | ${snapTs}`
    : isCachedData ? `Cached | ${snapTs}`
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
                className={`inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-[12px] font-black tracking-wide border transition-all duration-300 ${isLastClose ? 'bg-amber-950/40 border-amber-600/40' : (decisionCfg ? `${decisionCfg.bg} ${decisionCfg.border}` : `${rawCfg.bg} ${rawCfg.border}`)} ${decisionCfg?.color ?? rawCfg.color} ${isLastClose ? '' : (decisionCfg?.glow ?? rawCfg.glow)} ${pulse ? 'animate-pulse' : ''}`}>
                <span className="opacity-80 text-[10px] sm:text-[11px]">{decisionCfg?.arrow ?? rawCfg.arrow}</span>
                {decisionCfg?.label ?? rawCfg.label}
                <span className="text-[10px] font-mono opacity-60">{symbolSignal.score > 0 ? '+' : ''}{symbolSignal.score}</span>
                {isLastClose && <span className="text-[9px] font-normal opacity-50 ml-0.5">prev</span>}
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
      <div className="rounded-xl border border-slate-700/40 bg-slate-900/70 mb-3 overflow-hidden">

        {/* Top row: Bias pill + Bull/Bear/PCR */}
        <div className={`flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-700/30 ${biasBg}`}>
          {/* Left: bias + source */}
          <div className="flex items-center gap-1.5 shrink-0">
            <span className={`text-[11px] sm:text-[13px] font-black tracking-wide ${biasColor}`}>
              {hasRealSignal ? summary.bias : 'CLOSED'}
            </span>
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${sourceColor} border-current/30 bg-slate-800/60`}>
              {sourceLabel}
            </span>
          </div>
          {/* Right: Bull | Bear | PCR */}
          <div className="flex items-center gap-1.5 font-mono text-[11px] sm:text-[12px]">
            {hasRealSignal ? (
              <>
                <span
                  className={[
                    'tabular-nums transition-all duration-300',
                    summary.bullPct > summary.bearPct
                      ? 'text-emerald-300 font-black px-1.5 py-0.5 rounded border border-emerald-400/70 bg-emerald-500/20 shadow-[0_0_8px_1px_rgba(52,211,153,0.35)]'
                      : 'text-emerald-500 font-semibold',
                    flashSide === 'BULL' ? 'animate-scale-pop' : '',
                  ].join(' ')}
                >
                  ▲ {summary.bullPct}%
                </span>
                <span className="text-slate-700">|</span>
                <span
                  className={[
                    'tabular-nums transition-all duration-300',
                    summary.bearPct > summary.bullPct
                      ? 'text-red-300 font-black px-1.5 py-0.5 rounded border border-red-400/70 bg-red-500/20 shadow-[0_0_8px_1px_rgba(239,68,68,0.35)]'
                      : 'text-red-500 font-semibold',
                    flashSide === 'BEAR' ? 'animate-scale-pop' : '',
                  ].join(' ')}
                >
                  ▼ {summary.bearPct}%
                </span>
                {summary.neutralPct > 0 && (
                  <><span className="text-slate-700">|</span>
                  <span className="text-amber-400/70 font-semibold">— {summary.neutralPct}%</span></>
                )}
              </>
            ) : <span className="text-slate-600 text-[10px]">No data</span>}
            <span className="text-slate-700">|</span>
            <span className={`font-bold text-[11px] sm:text-[12px] tabular-nums transition-colors duration-300 ${(pcr ?? 1) > 1.2 ? 'text-emerald-400' : (pcr ?? 1) < 0.8 ? 'text-red-400' : 'text-amber-400'}`}
              title="Put-Call Ratio (full chain OI if available, else ATM±5)">
              PCR {pcr?.toFixed(2) ?? '--'}
            </span>
          </div>
        </div>

        {/* Bottom grid: Vol | OI | OI△ | IV — 4-col desktop, 2-col mobile */}
        {chainStats && hasRealSignal && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1.5 bg-slate-950/40">

            {/* ① Total Volume */}
            <div className={`flex flex-col gap-1 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.08)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.volume)}`}
              title={`Live Tick Volume — CE: ${liveVolumeStats.ready ? fmtNum(liveVolumeStats.ce) : '--'} | PE: ${liveVolumeStats.ready ? fmtNum(liveVolumeStats.pe) : '--'}`}>
              <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500">Total Volume</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className="text-[11px] sm:text-[12px] font-black text-emerald-400">
                  CE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
                    liveVolumeStats.cePct >= liveVolumeStats.pePct
                      ? 'border-emerald-300/90 bg-emerald-500/18 text-emerald-100 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                      : 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300',
                    getValueFlashClass(chainMoves.volume.ce, chainMoves.volume.active),
                  ].join(' ')}>{liveVolumeStats.cePct}%</span>
                </span>
                <span className="text-[9px] text-slate-600">/</span>
                <span className="text-[11px] sm:text-[12px] font-black text-red-400">
                  PE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
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
              <div className="flex items-center gap-1 text-[8px] font-mono tabular-nums">
                <span
                  className={[
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
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
                    'flex-1 min-w-0 rounded border px-1 py-0.5 text-center leading-none whitespace-nowrap transition-all duration-300',
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
            <div className={`flex flex-col gap-1 px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 shadow-[inset_0_0_0_1px_rgba(6,182,212,0.08)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.oi)}`}
              title={`Total Open Interest — CE: ${fmtNum(chainStats.totalCEOI)} | PE: ${fmtNum(chainStats.totalPEOI)}`}>
              <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500">Total OI</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className="text-[11px] sm:text-[12px] font-black text-emerald-400">
                  CE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
                    chainStats.ceOIPct >= chainStats.peOIPct
                      ? 'border-emerald-300/90 bg-emerald-500/18 text-emerald-200 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                      : 'border-emerald-300/35 bg-emerald-500/6 text-emerald-300',
                    getValueFlashClass(chainMoves.oi.ce, chainMoves.oi.active),
                  ].join(' ')}>{chainStats.ceOIPct}%</span>
                </span>
                <span className="text-[9px] text-slate-600">/</span>
                <span className="text-[11px] sm:text-[12px] font-black text-red-400">
                  PE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
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
              <div className="flex items-center gap-1 text-[8px] font-mono tabular-nums">
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
            <div className={`flex flex-col gap-1 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/5 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.08)] transition-all duration-200 ${getMetricCardFlashClass(chainMoves.oiChange)}`}
              title={`OI Change — CE: ${chainStats.totalCEOIChg >= 0 ? '+' : ''}${fmtNum(chainStats.totalCEOIChg)} | PE: ${chainStats.totalPEOIChg >= 0 ? '+' : ''}${fmtNum(chainStats.totalPEOIChg)}`}>
              <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500">OI Change</span>
              <div className="flex items-center justify-between gap-1 font-mono">
                <span className={`text-[11px] sm:text-[12px] font-black ${chainStats.totalCEOIChg >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  CE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
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
                <span className={`text-[11px] sm:text-[12px] font-black ${chainStats.totalPEOIChg >= 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  PE <span className={[
                    'inline-flex items-center rounded border px-1 py-0.5 text-[10px] leading-none transition-all duration-300',
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
              <div className="flex items-center gap-1 text-[8px] font-mono tabular-nums">
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
                m === 'SURGING' ? '🚀 Surge' : m === 'RISING' ? '↑ Rise' :
                m === 'FLAT'    ? '⚠ Neutral' : m === 'FALLING' ? '↓ Fall' : '↓↓ Coll';

              const ceVelIcon = chainStats.ceHotPct > 60 ? '🔥' : chainStats.ceHotPct > 30 ? '⚡' : chainStats.ceHotPct > 10 ? '~' : '';
              const peVelIcon = chainStats.peHotPct > 60 ? '🔥' : chainStats.peHotPct > 30 ? '⚡' : chainStats.peHotPct > 10 ? '~' : '';

              // Neutral warning banner when both sides flat
              const bothNeutral = ceNeutral && peNeutral;

              return (
                <div
                  className={`flex flex-col gap-1 px-2 py-2 rounded-lg border transition-all duration-200 overflow-hidden ${bothNeutral ? 'border-amber-500/40 bg-amber-500/5' : 'border-cyan-500/30 bg-cyan-500/5'} shadow-[inset_0_0_0_1px_rgba(6,182,212,0.06)] ${getMetricCardFlashClass(chainMoves.priceAction)}`}
                  title={`CE: ${cePct >= 0 ? '+' : ''}${cePct.toFixed(2)}% (${ceLabel}) | PE: ${pePct >= 0 ? '+' : ''}${pePct.toFixed(2)}% (${peLabel})`}
                >
                  {/* Header */}
                  <div className="flex items-center justify-between gap-1 flex-wrap">
                    <span className="text-[8px] font-bold tracking-widest uppercase text-slate-500">Price Action</span>
                    {bothNeutral && (
                      <span className="text-[7px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded px-1 py-0.5 whitespace-nowrap">
                        ⚠ Wait
                      </span>
                    )}
                  </div>

                  {/* CE row — label · value on same line, badge below */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-[9px] font-black shrink-0 ${cePct >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>CE</span>
                      <span className={`text-[12px] sm:text-[13px] font-black font-mono tabular-nums leading-none transition-all duration-300 ${ceValClass} ${getValueFlashClass(chainMoves.priceAction.ce, chainMoves.priceAction.active)}`}>
                        {cePct >= 0 ? '+' : ''}{cePct.toFixed(2)}%
                      </span>
                    </div>
                    <span className={`self-start inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[7px] font-bold leading-none whitespace-nowrap ${ceBadgeClass}`}>
                      {shortLabel(ceLabel)}{ceVelIcon && <span>{ceVelIcon}</span>}
                    </span>
                  </div>

                  {/* PE row */}
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-1">
                      <span className={`text-[9px] font-black shrink-0 ${pePct >= 0 ? 'text-rose-500' : 'text-sky-500'}`}>PE</span>
                      <span className={`text-[12px] sm:text-[13px] font-black font-mono tabular-nums leading-none transition-all duration-300 ${peValClass} ${getValueFlashClass(chainMoves.priceAction.pe, chainMoves.priceAction.active)}`}>
                        {pePct >= 0 ? '+' : ''}{pePct.toFixed(2)}%
                      </span>
                    </div>
                    <span className={`self-start inline-flex items-center gap-0.5 rounded border px-1 py-0.5 text-[7px] font-bold leading-none whitespace-nowrap ${peBadgeClass}`}>
                      {shortLabel(peLabel)}{peVelIcon && <span>{peVelIcon}</span>}
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

          {/* Row 2: PCR | Max Pain | Regime + S/R */}
          <div className="grid grid-cols-3 divide-x divide-slate-700/30">

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

            {/* Regime + S/R + metrics */}
            <div className={`flex flex-col gap-0.5 px-2.5 py-2 transition-colors duration-500 ${scoreFlash ? (scoreFlash === 'up' ? 'bg-emerald-500/5' : 'bg-red-500/5') : ''}`}>
              <span className="text-[8px] sm:text-[9px] font-bold tracking-widest text-slate-500 uppercase">Regime</span>
              <span className="text-[11px] sm:text-[13px] font-black text-slate-200 leading-tight transition-all duration-300">{intelligence.regime.replace(/_/g, ' ')}</span>
              <div className="flex flex-wrap gap-x-2 gap-y-0 text-[8px] font-mono">
                <span className="text-slate-400 transition-all duration-300">Agree {intelligence.agreementPct}%</span>
                <span className="text-amber-400/80 transition-all duration-300">Trap {intelligence.trapRiskPct}%</span>
              </div>
              {(intelligence.keyLevels.support || intelligence.keyLevels.resistance) && (
                <div className="flex gap-2 text-[8px] font-mono mt-0.5">
                  {intelligence.keyLevels.support    && <span className="text-emerald-400/90">S:{intelligence.keyLevels.support.toLocaleString('en-IN')}</span>}
                  {intelligence.keyLevels.resistance && <span className="text-red-400/90">R:{intelligence.keyLevels.resistance.toLocaleString('en-IN')}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Insights — keyed by content so text changes cause a remount with fade-in */}
          {intelligence.insights?.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2.5 py-1.5 border-t border-slate-700/30 bg-slate-800/30">
              {intelligence.insights.map((note) => (
                <span key={`${name}-ins-${note.slice(0, 28)}`} className="inline-flex items-center rounded border border-slate-700/40 bg-slate-900/60 px-1.5 py-0.5 text-[8px] sm:text-[10px] text-slate-300 transition-all duration-300">{note}</span>
              ))}
            </div>
          )}
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

      {/* Strike table header */}
      <div className="grid grid-cols-[1fr_60px_1fr] sm:grid-cols-[1fr_84px_1fr] rounded-t-lg overflow-hidden border border-slate-700/50 mb-0">
        <div className="flex flex-col gap-0.5 px-2 py-1.5 bg-emerald-500/10 border-r border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0" />
            <span className="text-[11px] font-black tracking-widest uppercase text-emerald-300">CALL (CE)</span>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center px-1 py-1.5 bg-slate-800/60 border-r border-slate-700/50">
          <span className="text-[10px] font-black tracking-widest uppercase text-cyan-400">STRIKE</span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[9px] text-amber-400/70">VOL</span>
            <span className="text-[9px] text-blue-400/70">OI</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 px-2 py-1.5 bg-red-500/10 items-end">
          <div className="flex items-center gap-1.5 flex-row-reverse">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0" />
            <span className="text-[11px] font-black tracking-widest uppercase text-red-300">PUT (PE)</span>
          </div>
        </div>
      </div>

      {/* Sub-header */}
      <div className="flex gap-[2px] sm:gap-1 border-b border-slate-700/40 bg-slate-900/40 mb-1 mb-2">
        <div className="flex items-center gap-2 px-2 py-0.5 text-[10px] text-slate-500 flex-1 bg-slate-900/30 rounded-lg overflow-hidden">
          <span>Signal | Price</span><span className="ml-auto hidden sm:inline">V | OI | B/S%</span>
        </div>
        <div className="flex items-center justify-center px-1 py-0.5 text-[9px] text-slate-600 shrink-0">
          <span>Vol <span className="hidden sm:inline">{'->'}</span> OI</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-0.5 text-[10px] text-slate-500 flex-row-reverse flex-1 bg-slate-900/30 rounded-lg overflow-hidden">
          <span>Signal | Price</span><span className="hidden sm:inline">V | OI | B/S%</span>
        </div>
      </div>

      {/* Strike rows */}
      <div className="flex flex-col gap-2.5 sm:gap-1.5 md:gap-1">
        {data.strikes.map(row => (
          // Strike-level V uses live tick delta, not cumulative day volume.
          // Keeps OI/signal logic intact while showing current traded flow in table cells.
          (() => {
            const liveVol = liveStrikeVolumeMap[row.strike];
            return (
          <StrikeRowComponent 
            key={row.strike} 
            row={row} 
            maxVol={maxVol} 
            maxOI={maxOI} 
            symbolKey={symbolKey}
            isRecommended={intelligence?.bestStrike?.strike === row.strike}
            liveCeVolume={liveVol?.ce ?? 0}
            livePeVolume={liveVol?.pe ?? 0}
          />
            );
          })()
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-2.5 pt-2 border-t border-slate-700/30 text-[9px] text-slate-600">
        {/* SMC/ICT cheat-sheet toggle */}
        <button
          onClick={() => setShowSMC(v => !v)}
          className="w-full mt-1 flex items-center justify-center gap-1 text-[8px] sm:text-[9px] text-slate-600 hover:text-slate-400 transition-colors duration-150"
        >
          <span>{showSMC ? '▲' : '▼'}</span>
          <span>SMC Guide</span>
        </button>
        {showSMC && (
          <div className="w-full mt-1 rounded-lg border border-slate-700/40 bg-slate-900/60 px-2 py-1.5 text-[8px] sm:text-[9px] text-slate-400 space-y-1">
            <div className="flex flex-col sm:flex-row gap-1 sm:gap-3">
              {/* S1 */}
              <div className="flex-1 space-y-0.5">
                <p className="font-black text-red-400 tracking-wide">📉 S1: DOWN→UP→zone</p>
                <p><span className="text-amber-300 font-bold">EQH/BSL</span> ⬆️→⬇️ liquidity grab → <span className="text-red-300 font-bold">SELL</span></p>
                <p><span className="text-orange-300 font-bold">Bear OB/POI</span> ⬇️ rejection → <span className="text-red-300 font-bold">SELL</span></p>
                <p><span className="text-blue-300 font-bold">FVG(↑)</span> ↩️→⬇️ fill → drop</p>
                <p><span className="text-emerald-300 font-bold">BOS↑</span> ⬆️ continue up</p>
                <p><span className="text-red-300 font-bold">CHoCH(top)</span> ⬇️ reversal</p>
                <p className="text-red-400 font-bold">✅ ⬆️ zone → ⬇️ SELL</p>
              </div>
              <div className="hidden sm:block w-px bg-slate-700/40" />
              {/* S2 */}
              <div className="flex-1 space-y-0.5">
                <p className="font-black text-emerald-400 tracking-wide">📈 S2: UP→DOWN→zone</p>
                <p><span className="text-amber-300 font-bold">EQL/SSL</span> ⬇️→⬆️ liquidity grab → <span className="text-emerald-300 font-bold">BUY</span></p>
                <p><span className="text-emerald-300 font-bold">Bull OB/POI</span> ⬆️ bounce → <span className="text-emerald-300 font-bold">BUY</span></p>
                <p><span className="text-blue-300 font-bold">FVG(↓)</span> ↩️→⬆️ fill → rise</p>
                <p><span className="text-red-300 font-bold">BOS↓</span> ⬇️ continue down</p>
                <p><span className="text-emerald-300 font-bold">CHoCH(bot)</span> ⬆️ reversal</p>
                <p className="text-emerald-400 font-bold">✅ ⬇️ zone → ⬆️ BUY</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
SymbolStrikeCard.displayName = 'SymbolStrikeCard';

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
            ATM +/-5 | CE/PE | Vol | OI | PCR | Max Pain | BSL/SSL | BOS | Trap
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

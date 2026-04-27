'use client';

import React, { memo, useMemo } from 'react';
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
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-bold tracking-wider ${cfg.bg} ${cfg.color} ${cfg.border} border shadow-sm ${cfg.glow} transition-colors duration-150`}>
      <span className="text-[9px] leading-none">{arrow}</span>
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
      {b > 0 && <div className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700 ease-out" style={{ width: `${b}%` }} />}
      {n > 0 && <div className="bg-gradient-to-r from-amber-400/60 to-amber-500/60 transition-all duration-700 ease-out" style={{ width: `${n}%` }} />}
      {s > 0 && <div className="bg-gradient-to-r from-red-400 to-red-500 transition-all duration-700 ease-out"         style={{ width: `${s}%` }} />}
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

type TradeDecision = 'BUY_CE' | 'BUY_PE' | 'CONFLICTING' | 'WAIT';

function deriveTradeDecision(ceSignal: StrikeSignal, peSignal: StrikeSignal): TradeDecision {
  const isBullish = (s: StrikeSignal) => s === 'STRONG_BUY' || s === 'BUY';
  const ceBull = isBullish(ceSignal);
  const peBull = isBullish(peSignal);
  if (ceBull && !peBull) return 'BUY_CE';
  if (peBull && !ceBull) return 'BUY_PE';
  if (ceBull &&  peBull) return 'CONFLICTING';
  return 'WAIT';
}

const DECISION_CFG: Record<TradeDecision, {
  label: string; icon: string;
  bg: string; border: string; color: string; subColor: string;
  decisionBg: string; pulse: boolean;
}> = {
  BUY_CE:      { label: 'BUY CALL (CE)',   icon: '▲', bg: 'bg-emerald-950/60',  border: 'border-emerald-400/80',  color: 'text-emerald-200', subColor: 'text-emerald-400',  decisionBg: 'bg-emerald-500/25', pulse: true  },
  BUY_PE:      { label: 'BUY PUT (PE)',    icon: '▼', bg: 'bg-red-950/60',      border: 'border-red-400/80',      color: 'text-red-200',     subColor: 'text-red-400',      decisionBg: 'bg-red-500/25',     pulse: true  },
  CONFLICTING: { label: 'CONFLICTING — WAIT', icon: '⚡', bg: 'bg-amber-950/60', border: 'border-amber-400/60',  color: 'text-amber-200',   subColor: 'text-amber-400',    decisionBg: 'bg-amber-500/20',   pulse: false },
  WAIT:        { label: 'NO CLEAR SIGNAL — WAIT', icon: '■', bg: 'bg-slate-800/60', border: 'border-slate-600/50', color: 'text-slate-400',  subColor: 'text-slate-500',    decisionBg: 'bg-slate-700/40',   pulse: false },
};

const SUB_TEXT: Record<TradeDecision, string> = {
  BUY_CE:      'CE is STRONG  ·  PE is WEAK  →  Market going UP',
  BUY_PE:      'PE is STRONG  ·  CE is WEAK  →  Market going DOWN',
  CONFLICTING: 'CE and PE both showing strength — direction unclear, stay out',
  WAIT:        'Neither CE nor PE is strong enough — no trade setup',
};

const TradeActionBanner = memo<{
  atmCeSignal: StrikeSignal; atmCeScore: number;
  atmPeSignal: StrikeSignal; atmPeScore: number;
  overallScore: number; confidence: number;
}>(({ atmCeSignal, atmCeScore, atmPeSignal, atmPeScore, overallScore, confidence }) => {
  const decision = deriveTradeDecision(atmCeSignal, atmPeSignal);
  const cfg      = DECISION_CFG[decision];
  const ceCfg    = SIGNAL_CONFIG[atmCeSignal];
  const peCfg    = SIGNAL_CONFIG[atmPeSignal];
  const ceActive = decision === 'BUY_CE';
  const peActive = decision === 'BUY_PE';

  return (
    <div className={`rounded-xl border mb-3 overflow-hidden transition-all duration-300 ${cfg.border}`}>

      {/* Row 1: ATM CE  vs  ATM PE — side-by-side comparison */}
      <div className="grid grid-cols-[1fr_28px_1fr]">

        {/* CE side */}
        <div className={`flex flex-col items-center gap-0.5 py-2 px-2 transition-all duration-300 ${
          ceActive ? 'bg-emerald-500/20 shadow-inner' : 'bg-slate-800/50 opacity-60'
        }`}>
          <span className="text-[8px] font-black tracking-widest uppercase text-emerald-400/80">CE · CALL</span>
          <span className={`text-[12px] sm:text-[14px] font-black leading-tight ${ceCfg.color} ${
            ceActive ? 'scale-105' : ''
          } transition-transform duration-300`}>
            {ceActive ? '▲ ' : ''}{ceCfg.label}
          </span>
          <span className="text-[9px] font-mono text-slate-500 tabular-nums">
            score: {atmCeScore > 0 ? '+' : ''}{atmCeScore}
          </span>
          {ceActive && (
            <span className="text-[8px] font-bold text-emerald-300 bg-emerald-500/20 border border-emerald-400/40 px-1.5 py-0 rounded mt-0.5">
              ✓ ACTIVE SIDE
            </span>
          )}
        </div>

        {/* VS divider */}
        <div className="flex items-center justify-center bg-slate-900/60 border-x border-slate-700/40">
          <span className="text-[8px] text-slate-500 font-bold rotate-90 sm:rotate-0">vs</span>
        </div>

        {/* PE side */}
        <div className={`flex flex-col items-center gap-0.5 py-2 px-2 transition-all duration-300 ${
          peActive ? 'bg-red-500/20 shadow-inner' : 'bg-slate-800/50 opacity-60'
        }`}>
          <span className="text-[8px] font-black tracking-widest uppercase text-red-400/80">PE · PUT</span>
          <span className={`text-[12px] sm:text-[14px] font-black leading-tight ${peCfg.color} ${
            peActive ? 'scale-105' : ''
          } transition-transform duration-300`}>
            {peActive ? '▼ ' : ''}{peCfg.label}
          </span>
          <span className="text-[9px] font-mono text-slate-500 tabular-nums">
            score: {atmPeScore > 0 ? '+' : ''}{atmPeScore}
          </span>
          {peActive && (
            <span className="text-[8px] font-bold text-red-300 bg-red-500/20 border border-red-400/40 px-1.5 py-0 rounded mt-0.5">
              ✓ ACTIVE SIDE
            </span>
          )}
        </div>
      </div>

      {/* Row 2: Decision — the action to take */}
      <div className={`flex items-center justify-between gap-2 px-3 py-2 border-t ${cfg.border} ${cfg.decisionBg}`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[18px] leading-none shrink-0">{cfg.icon}</span>
          <div className="flex flex-col min-w-0">
            <span className={`text-[13px] sm:text-[16px] font-black tracking-wide leading-tight ${cfg.color} ${
              cfg.pulse ? 'animate-pulse' : ''
            }`}>
              {cfg.label}
            </span>
            <span className={`text-[9px] sm:text-[10px] font-medium leading-snug ${cfg.subColor} mt-0.5`}>
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

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE'; volDominant: boolean; oiDominant: boolean; isATM: boolean; symbolKey: SymbolKey }>(({ side, label, volDominant, oiDominant, isATM, symbolKey }) => {
  const isCE = label === 'CE';

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
  const border = isATM
    ? 'border-2 border-cyan-300/65 shadow-[0_0_10px_0_rgba(34,211,238,0.18)]'
    : isFullConviction
      ? (isCE
          ? 'border-2 border-emerald-400 shadow-[0_0_16px_4px_rgba(52,211,153,0.55),inset_0_0_8px_0_rgba(52,211,153,0.15)]'
          : 'border-2 border-red-400     shadow-[0_0_16px_4px_rgba(239,68,68,0.55),inset_0_0_8px_0_rgba(239,68,68,0.15)]')
      : isActive
        ? (isCE ? 'border-2 border-emerald-600/40' : 'border-2 border-red-600/40')
        : 'border-2 border-slate-700/30';

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
  // Colour: green/red based on direction; dim when near zero
  const oiChgCls = oiChgAbs >= rules.minOIChange
    ? (oiChg > 0 ? 'text-emerald-300 font-black' : 'text-red-300 font-black')
    : oiChgAbs >= 50
      ? (oiChg > 0 ? 'text-emerald-500' : 'text-red-500')
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

  // Volume highlight — bright if dominant
  const volCls = volDominant
    ? (isCE ? 'text-emerald-300 font-black' : 'text-red-300 font-black')
    : 'text-slate-400 font-semibold';
  // OI highlight — bright if dominant
  const oiCls = oiDominant
    ? (isCE ? 'text-cyan-300 font-black' : 'text-orange-300 font-black')
    : 'text-slate-400 font-semibold';

  // Buy% / Sell% dominant highlight
  const flowCls = isActive
    ? (isCE ? 'text-emerald-300 font-black' : 'text-red-300 font-black')
    : isSelling
      ? 'text-red-400 font-bold'
      : 'text-slate-400';

  return (
    <div style={{ willChange: 'transform' }} className={`flex flex-col gap-[5px] px-1.5 py-1.5 rounded-lg transition-colors duration-150 min-w-0 overflow-hidden ${bg} ${border} ${isNeutral ? 'opacity-55' : ''}`}>

      {/* ── ROW 1: Signal badge + Price + Change ─────────────────────── */}
      <div className={`flex items-center ${isCE ? 'flex-row' : 'flex-row-reverse'} justify-between gap-0.5 min-w-0`}>
        <SignalBadge signal={displaySignal} side={label} />
        <div className={`flex items-center gap-0.5 ${isCE ? 'justify-end' : 'justify-start'} flex-1 min-w-0 overflow-hidden`}>
          <span className={`truncate transition-all duration-200 ${priceCls}`}>{side.price.toFixed(1)}</span>
          <span className={`text-[8px] font-mono font-bold shrink-0 ${priceChangeColor}`}>
            {side.change >= 0 ? '+' : ''}{side.change.toFixed(1)}
          </span>
        </div>
      </div>

      {/* ── ROW 2: Buy%/Sell% pressure bar ──────────────────────────── */}
      <LiquidityBar buyPct={side.breakdown.buyPct} sellPct={side.breakdown.sellPct} neutralPct={side.breakdown.neutralPct} />

      {/* ── ROW 3: The 4 most critical live metrics ──────────────────── */}
      {/* Volume | OI — highlighted when dominant */}
      <div className={`flex items-center justify-between gap-0.5 min-w-0`}>
        <span className="text-[7px] text-slate-600 shrink-0">V</span>
        <span className={`text-[9px] font-mono tabular-nums flex-1 ${isCE ? 'text-left' : 'text-right'} ${volCls}`}>{fmtNum(side.volume)}</span>
        <span className="text-slate-700 text-[7px] shrink-0">·</span>
        <span className="text-[7px] text-slate-600 shrink-0">OI</span>
        <span className={`text-[9px] font-mono tabular-nums flex-1 ${isCE ? 'text-left' : 'text-right'} ${oiCls}`}>{fmtNum(side.oi)}</span>
      </div>

      {/* ── ROW 4: OI Change + OI Interpretation (most real-time signals) */}
      <div className={`flex items-center gap-1 min-w-0 ${isCE ? '' : 'flex-row-reverse'}`}>
        {/* ΔOI — flashes colour on fresh buildup/unwinding */}
        <span className={`text-[8px] font-mono tabular-nums shrink-0 transition-all duration-200 ${oiChgCls}`}>
          ΔOI:{oiChgStr}
        </span>

        {/* OI Interpretation badge — the most informative single value */}
        {oiInterp && (
          <span className={`text-[7px] font-black px-1 py-0 rounded border leading-tight shrink-0 ${oiInterpCls[oiInterp] ?? 'text-slate-500'}`}>
            {oiInterpLabel[oiInterp] ?? oiInterp}
          </span>
        )}

        {/* BOS badge — structure break */}
        {bos && (
          <span className={`text-[7px] font-black px-1 py-0 rounded border leading-tight shrink-0 ${bosCls}`}>
            BOS {bos}
          </span>
        )}

        {/* TRAP warning */}
        {trap && (
          <span className="text-[7px] font-black px-1 py-0 rounded border leading-tight shrink-0 text-amber-300 bg-amber-500/20 border-amber-500/40 animate-pulse">
            ⚠TRAP
          </span>
        )}

        {/* B%/S% flow — only when noteworthy */}
        {(buyPct >= 60 || sellPct >= 60) && (
          <span className={`text-[8px] font-mono tabular-nums ml-auto shrink-0 ${flowCls}`}>
            B{buyPct}·S{sellPct}
          </span>
        )}
      </div>

      {/* ── ROW 5 (conviction only): Pre-Trade checklist ─────────────── */}
      {isFullConviction && (
        <div className={`flex flex-col gap-[3px] rounded-md px-1 py-1 border mt-0.5 ${
          isCE ? 'bg-emerald-950/60 border-emerald-500/40' : 'bg-red-950/60 border-red-500/40'
        }`}>
          <span className={`text-[7px] font-black tracking-widest uppercase mb-0.5 ${isCE ? 'text-emerald-400' : 'text-red-400'}`}>
            ✓ Pre-Trade
          </span>
          {[
            { label: isBuyable ? 'Buy%' : 'Sell%', value: isBuyable ? `${buyPct}%` : `${sellPct}%`, pass: isBuyable ? buyPct >= rules.minBuyPct : sellPct >= rules.minSellPct },
            { label: 'Volume',   value: fmtNum(side.volume), pass: side.volume >= rules.minVolume },
            { label: 'OI Depth', value: fmtNum(side.oi),     pass: side.oi >= rules.minOI },
            { label: 'ΔOI',      value: oiChgStr,            pass: oiChgAbs >= rules.minOIChange || !!oiInterp },
          ].map((p, i) => (
            <div key={i} className={`flex items-center justify-between gap-1 ${isCE ? '' : 'flex-row-reverse'}`}>
              <span className={`text-[7px] font-semibold shrink-0 ${p.pass ? (isCE ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}`}>
                {p.pass ? '✓' : '✗'} {p.label}
              </span>
              <span className={`text-[7px] font-mono font-bold tabular-nums px-0.5 rounded truncate ${
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
  const totalVol  = row.ce.volume + row.pe.volume;
  const totalOI   = row.ce.oi    + row.pe.oi;
  const volIntensity = maxVol > 0 ? Math.min(totalVol / maxVol, 1) : 0;
  const oiIntensity  = maxOI  > 0 ? Math.min(totalOI  / maxOI,  1) : 0;

  // Compute high-conviction signals at the row level for row-wide highlighting
  const ceConv = getHighConvictionSignal(row.ce, symbolKey);
  const peConv = getHighConvictionSignal(row.pe, symbolKey);
  const ceStrong = ceConv === 'STRONG_BUY' || ceConv === 'STRONG_SELL';
  const peStrong = peConv === 'STRONG_BUY' || peConv === 'STRONG_SELL';

  // Row border: conviction takes priority over everything
  const rowBorder =
    ceStrong && peStrong ? 'border-[3px] border-amber-400/90 shadow-[0_0_20px_4px_rgba(251,191,36,0.35)]' :
    ceConv === 'STRONG_BUY'  ? 'border-[3px] border-emerald-400/90 shadow-[0_0_20px_4px_rgba(52,211,153,0.35)]' :
    peConv === 'STRONG_BUY'  ? 'border-[3px] border-red-400/90    shadow-[0_0_20px_4px_rgba(239,68,68,0.35)]' :
    ceConv === 'STRONG_SELL' ? 'border-[3px] border-red-400/90    shadow-[0_0_20px_4px_rgba(239,68,68,0.35)]' :
    peConv === 'STRONG_SELL' ? 'border-[3px] border-emerald-400/90 shadow-[0_0_20px_4px_rgba(52,211,153,0.35)]' :
    isATM ? 'border-[2px] border-cyan-300/70' :
    'border border-slate-700/30';

  const rowBg =
    ceConv === 'STRONG_BUY'  ? 'bg-emerald-500/[0.09]' :
    peConv === 'STRONG_BUY'  ? 'bg-red-500/[0.09]' :
    ceConv === 'STRONG_SELL' ? 'bg-red-500/[0.09]' :
    peConv === 'STRONG_SELL' ? 'bg-emerald-500/[0.09]' :
    isATM              ? 'bg-cyan-400/[0.10]' :
    volIntensity > 0.7 ? (row.ce.volume > row.pe.volume ? 'bg-emerald-500/[0.04]' : 'bg-red-500/[0.04]') : '';

  // Strike center: number highlight when conviction met on either side
  const strikeNumberCls = ceStrong || peStrong
    ? (ceConv === 'STRONG_BUY' || peConv === 'STRONG_SELL'
        ? 'text-[13px] sm:text-[15px] font-black font-mono text-emerald-200 drop-shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse'
        : 'text-[13px] sm:text-[15px] font-black font-mono text-red-200 drop-shadow-[0_0_8px_rgba(239,68,68,0.9)] animate-pulse')
    : isATM ? 'text-[11px] sm:text-[13px] font-black font-mono text-cyan-300'
    : 'text-[11px] sm:text-[13px] font-black font-mono text-slate-300';

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
    <div className={`grid grid-cols-[1fr_60px_1fr] sm:grid-cols-[1fr_84px_1fr] items-stretch gap-0 rounded-lg overflow-hidden ${rowBg} ${rowBorder} ${
      isATM ? 'ring-1 ring-cyan-300/25' : ''
    } hover:bg-white/[0.025] transition-all duration-300`}>
      <SideCell side={row.ce} label="CE" volDominant={row.ce.volume > row.pe.volume} oiDominant={row.ce.oi > row.pe.oi} isATM={isATM} symbolKey={symbolKey} />

      {/* Strike center */}
      <div className={`flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border-x ${
        ceStrong || peStrong ? 'bg-slate-900/80 border-slate-600/60' :
        isATM ? 'border-cyan-300/50 bg-cyan-400/[0.08]' : 'border-slate-700/40'
      }`}>
        <span className={strikeNumberCls}>{row.strike.toLocaleString('en-IN')}</span>
        {tradeBadge ? (
          <span className={`text-[8px] font-black tracking-tight px-1 py-0 rounded animate-pulse ${tradeBadge.cls}`}>{tradeBadge.label}</span>
        ) : (
          <span className={`text-[8px] font-bold uppercase tracking-widest px-1 rounded ${
            isATM ? 'text-cyan-400 bg-cyan-500/15 border border-cyan-400/30' : 'text-slate-600'
          }`}>{row.label}</span>
        )}
        <div className="w-10 h-[4px] rounded-full bg-slate-800/80 overflow-hidden mt-0.5" title={`Vol ${Math.round(volIntensity * 100)}%`}>
          <div className={`h-full rounded-full transition-all duration-500 ${volIntensity > 0.7 ? 'bg-amber-400' : volIntensity > 0.4 ? 'bg-amber-500/50' : 'bg-slate-700'}`} style={{ width: `${volIntensity * 100}%` }} />
        </div>
        <div className="w-8 h-[3px] rounded-full bg-slate-800/80 overflow-hidden" title={`OI ${Math.round(oiIntensity * 100)}%`}>
          <div className={`h-full rounded-full transition-all duration-500 ${oiIntensity > 0.7 ? 'bg-blue-400' : oiIntensity > 0.4 ? 'bg-blue-500/50' : 'bg-slate-700'}`} style={{ width: `${oiIntensity * 100}%` }} />
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <ScoreDot score={row.ce.score} />
          <ScoreDot score={row.pe.score} />
        </div>
      </div>

      <SideCell side={row.pe} label="PE" volDominant={row.pe.volume > row.ce.volume} oiDominant={row.pe.oi > row.ce.oi} isATM={isATM} symbolKey={symbolKey} />
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

// Symbol Card

const SymbolStrikeCard = memo<{ data: SymbolStrikeData | null; name: string }>(({ data, name }) => {
  const strikes      = data?.strikes ?? [];
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

  // Summary: bias + PCR - use backend intelligence when available
  const summary = useMemo(() => {
    const totalCEOI = hasData ? strikes.reduce((a, s) => a + s.ce.oi, 0) : 0;
    const totalPEOI = hasData ? strikes.reduce((a, s) => a + s.pe.oi, 0) : 0;
    const pcr = totalCEOI > 0 ? parseFloat((totalPEOI / totalCEOI).toFixed(2)) : 1;
    if (!hasData || !hasRealSignal || !intelligence) {
      return { bullPct: 0, bearPct: 0, neutralPct: 100, bias: 'NEUTRAL' as const, pcr };
    }
    const bullPct    = intelligence.bullPressure;
    const bearPct    = intelligence.bearPressure;
    const neutralPct = Math.max(0, 100 - bullPct - bearPct);
    const bias = bullPct - bearPct >= 10 ? 'BULLISH' as const : bearPct - bullPct >= 10 ? 'BEARISH' as const : 'NEUTRAL' as const;
    return { bullPct, bearPct, neutralPct, bias, pcr };
  }, [strikes, hasData, hasRealSignal, intelligence]);

  // Composite signal - always comes from backend intelligence (no re-scoring in browser)
  const symbolSignal = useMemo(() => {
    if (!hasRealSignal || !intelligence) return { signal: 'NEUTRAL' as OverallSignal, score: 0 };
    return { signal: intelligence.signal as OverallSignal, score: Math.round(intelligence.score) };
  }, [hasRealSignal, intelligence]);

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
    <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4 overflow-hidden">

      {/* Card Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] sm:text-sm font-bold text-emerald-200 bg-emerald-500/5 border border-emerald-500/30 shadow-[0_0_6px_rgba(52,211,153,0.15)] shrink-0">{name}</span>
          <span className="inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[12px] font-mono font-semibold text-emerald-300 bg-emerald-500/5 border border-emerald-500/30 shrink-0">
            <span className="whitespace-nowrap">ATM: {data.atm.toLocaleString('en-IN')}</span>
            <span className="text-emerald-500/60">|</span>
            <span className="whitespace-nowrap">Spot: {data.spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          </span>
        </div>

        {/* Top-right badge */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          {hasRealSignal ? (() => {
            const cfg = OVERALL_CFG[symbolSignal.signal];
            const pulse = isLiveData && (symbolSignal.signal === 'STRONG_BUY' || symbolSignal.signal === 'STRONG_SELL');
            return (
              <span title={`Composite: ${symbolSignal.score > 0 ? '+' : ''}${symbolSignal.score}`}
                className={`inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-[12px] font-black tracking-wide border transition-all duration-300 ${isLastClose ? 'bg-amber-950/40 border-amber-600/40' : cfg.bg + ' ' + cfg.border} ${cfg.color} ${isLastClose ? '' : cfg.glow} ${pulse ? 'animate-pulse' : ''}`}>
                <span className="opacity-80 text-[9px] sm:text-[10px]">{cfg.arrow}</span>
                {cfg.label}
                <span className="text-[9px] font-mono opacity-60">{symbolSignal.score > 0 ? '+' : ''}{symbolSignal.score}</span>
                {isLastClose && <span className="text-[8px] font-normal opacity-50 ml-0.5">prev</span>}
              </span>
            );
          })() : (
            <span className="inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg text-[10px] sm:text-[12px] font-black tracking-wide border bg-slate-800/40 text-slate-500 border-slate-600/40">NO DATA</span>
          )}
          <div className="flex items-center gap-1.5 flex-wrap justify-end">
            <span className={`text-[9px] font-mono ${sourceColor}`}>{sourceLabel}</span>
            {data.expiry && (
              <span className={`text-[8px] font-mono ${expiryPast ? 'text-red-500/70' : 'text-slate-600'}`}>
                {expiryPast ? 'EXPIRED' : 'Exp:'} {data.expiry}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Sentiment bar */}
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 sm:px-2.5 py-1.5 mb-3 ${biasBg} border border-slate-700/30`}>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] sm:text-[11px] font-bold ${biasColor}`}>{hasRealSignal ? summary.bias : 'CLOSED'}</span>
          <span className="hidden sm:inline text-[9px] text-slate-500">{isLiveData ? 'Score-Weighted' : isLastClose ? 'Last Session' : isCachedData ? 'Cached' : 'No live data'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] sm:text-[10px] font-mono">
          {hasRealSignal ? (
            <>
              <span className="text-emerald-400">Bull {summary.bullPct}%</span>
              <span className="text-slate-600">|</span>
              {summary.neutralPct > 0 && <><span className="text-amber-400/80">Neutral {summary.neutralPct}%</span><span className="text-slate-600">|</span></>}
              <span className="text-red-400">Bear {summary.bearPct}%</span>
              <span className="text-slate-600">|</span>
            </>
          ) : <span className="text-slate-600">No split data</span>}
          <span className="text-cyan-400/70" title="Put-Call Ratio">PCR:{summary.pcr}</span>
        </div>
      </div>

      {/* Intelligence Panel */}
      {intelligence && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 mb-3 overflow-hidden">

          {/* Row 1: Signal label + confidence bar + actionability */}
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-slate-700/30">
            <div className="flex items-center gap-2">
              <span className={`text-[12px] sm:text-[14px] font-black tracking-wide ${OVERALL_CFG[symbolSignal.signal].color}`}>
                {OVERALL_CFG[symbolSignal.signal].arrow} {OVERALL_CFG[symbolSignal.signal].label}
              </span>
              <span className="text-[9px] font-mono text-slate-500 tabular-nums">
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
                <span className={`text-[9px] font-bold tabular-nums ${intelligence.confidence >= 70 ? 'text-emerald-400' : intelligence.confidence >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
                  {intelligence.confidence}%
                </span>
              </div>
              <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-bold ${actionabilityTone}`}>
                {actionability}
              </span>
            </div>
          </div>

          {/* Row 2: PCR | Max Pain | Regime + S/R */}
          <div className="grid grid-cols-3 divide-x divide-slate-700/30">

            {/* PCR */}
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              <span className="text-[7px] sm:text-[8px] font-bold tracking-widest text-slate-500 uppercase">Put/Call Ratio</span>
              <span className={`text-[15px] sm:text-[17px] font-black font-mono leading-none tabular-nums ${(pcr ?? 1) > 1.2 ? 'text-emerald-400' : (pcr ?? 1) < 0.8 ? 'text-red-400' : 'text-amber-400'}`}>
                {pcr?.toFixed(2) ?? '--'}
              </span>
              <span className={`text-[8px] font-semibold ${(pcr ?? 1) > 1.2 ? 'text-emerald-500' : (pcr ?? 1) < 0.8 ? 'text-red-500' : 'text-amber-500'}`}>
                {(pcr ?? 1) > 1.2 ? 'Bullish bias' : (pcr ?? 1) < 0.8 ? 'Bearish bias' : 'Balanced'}
              </span>
            </div>

            {/* Max Pain */}
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              <span className="text-[7px] sm:text-[8px] font-bold tracking-widest text-slate-500 uppercase">Max Pain</span>
              <span className="text-[15px] sm:text-[17px] font-black font-mono leading-none tabular-nums text-violet-300">
                {intelligence.maxPain?.toLocaleString('en-IN') ?? '--'}
              </span>
              <span className="text-[8px] font-semibold text-violet-400/70">
                {intelligence.maxPainGapPct != null
                  ? `${intelligence.maxPainGapPct > 0 ? '+' : ''}${intelligence.maxPainGapPct}% from spot`
                  : 'Writers\' target'}
              </span>
            </div>

            {/* Regime + S/R + metrics */}
            <div className="flex flex-col gap-0.5 px-2.5 py-2">
              <span className="text-[7px] sm:text-[8px] font-bold tracking-widest text-slate-500 uppercase">Regime</span>
              <span className="text-[11px] sm:text-[13px] font-black text-slate-200 leading-tight">{intelligence.regime.replace(/_/g, ' ')}</span>
              <div className="flex flex-wrap gap-x-2 gap-y-0 text-[8px] font-mono">
                <span className="text-slate-400">Agree {intelligence.agreementPct}%</span>
                <span className="text-amber-400/80">Trap {intelligence.trapRiskPct}%</span>
              </div>
              {(intelligence.keyLevels.support || intelligence.keyLevels.resistance) && (
                <div className="flex gap-2 text-[8px] font-mono mt-0.5">
                  {intelligence.keyLevels.support    && <span className="text-emerald-400/90">S:{intelligence.keyLevels.support.toLocaleString('en-IN')}</span>}
                  {intelligence.keyLevels.resistance && <span className="text-red-400/90">R:{intelligence.keyLevels.resistance.toLocaleString('en-IN')}</span>}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Insights */}
          {intelligence.insights?.length > 0 && (
            <div className="flex flex-wrap gap-1 px-2.5 py-1.5 border-t border-slate-700/30 bg-slate-800/30">
              {intelligence.insights.map((note, idx) => (
                <span key={`${name}-ins-${idx}`} className="inline-flex items-center rounded border border-slate-700/40 bg-slate-900/60 px-1.5 py-0.5 text-[8px] sm:text-[9px] text-slate-300">{note}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TRADE ACTION BANNER ────────────────────────────────────────── */}
      {hasRealSignal && atmRow && (
        <TradeActionBanner
          atmCeSignal={atmRow.ce.signal}
          atmCeScore={Math.round(atmRow.ce.score)}
          atmPeSignal={atmRow.pe.signal}
          atmPeScore={Math.round(atmRow.pe.score)}
          overallScore={symbolSignal.score}
          confidence={intelligence?.confidence ?? 50}
        />
      )}

      {/* Feed status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 rounded-lg border border-slate-700/30 bg-slate-900/40 px-2 py-1">
        <span className="text-[9px] sm:text-[10px] font-medium text-slate-300">{feedLabel}</span>
        <div className="flex flex-wrap items-center gap-2 text-[8px] sm:text-[9px] font-mono text-slate-500">
          <span title="Spot/ATM recalculation cadence">Spot: 1s</span>
          <span title="CE/PE option-chain refresh cadence">Chain: 5s</span>
        </div>
      </div>

      {/* Strike table header */}
      <div className="grid grid-cols-[1fr_60px_1fr] sm:grid-cols-[1fr_84px_1fr] rounded-t-lg overflow-hidden border border-slate-700/50 mb-0">
        <div className="flex flex-col gap-0.5 px-2 py-1.5 bg-emerald-500/10 border-r border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block shrink-0" />
            <span className="text-[10px] font-black tracking-widest uppercase text-emerald-300">CALL (CE)</span>
          </div>
          <span className="text-[8px] font-bold text-emerald-400/80 hidden sm:block">
            C.S.BUY / C.BUY → <span className="text-emerald-300 font-black">BUY CE</span> (market going UP)
          </span>
          <span className="text-[8px] text-emerald-400/80 block sm:hidden">↑ UP → BUY CE</span>
        </div>
        <div className="flex flex-col items-center justify-center px-1 py-1.5 bg-slate-800/60 border-r border-slate-700/50">
          <span className="text-[9px] font-black tracking-widest uppercase text-cyan-400">STRIKE</span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[7px] text-amber-400/70">VOL</span>
            <span className="text-[7px] text-blue-400/70">OI</span>
          </div>
        </div>
        <div className="flex flex-col gap-0.5 px-2 py-1.5 bg-red-500/10 items-end">
          <div className="flex items-center gap-1.5 flex-row-reverse">
            <span className="w-2 h-2 rounded-full bg-red-400 inline-block shrink-0" />
            <span className="text-[10px] font-black tracking-widest uppercase text-red-300">PUT (PE)</span>
          </div>
          <span className="text-[8px] font-bold text-red-400/80 hidden sm:block text-right">
            P.S.BUY / P.BUY → <span className="text-red-300 font-black">BUY PE</span> (market going DOWN)
          </span>
          <span className="text-[8px] text-red-400/80 block sm:hidden">↓ DOWN → BUY PE</span>
        </div>
      </div>

      {/* Sub-header */}
      <div className="grid grid-cols-[1fr_60px_1fr] sm:grid-cols-[1fr_84px_1fr] border-x border-b border-slate-700/40 bg-slate-900/40 mb-1">
        <div className="flex items-center gap-2 px-2 py-0.5 text-[8px] text-slate-500 border-r border-slate-700/30">
          <span>Signal | Price</span><span className="ml-auto hidden sm:inline">V | OI | B/S%</span>
        </div>
        <div className="flex items-center justify-center px-1 py-0.5 border-r border-slate-700/30">
          <span className="text-[7px] text-slate-600">Vol {'->'} OI</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-0.5 text-[8px] text-slate-500 flex-row-reverse">
          <span>Signal | Price</span><span className="mr-auto hidden sm:inline">V | OI | B/S%</span>
        </div>
      </div>

      {/* Strike rows */}
      <div className="flex flex-col gap-[2px]">
        {data.strikes.map(row => (
          <StrikeRowComponent key={row.strike} row={row} maxVol={maxVol} maxOI={maxOI} symbolKey={symbolKey} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 mt-2.5 pt-2 border-t border-slate-700/30 text-[8px] text-slate-600">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />S.Buy</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />Buy</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Hold</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-600" />Sell</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />S.Sell</span>
        <span className="text-slate-700 mx-1">|</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-amber-400" />Vol heat</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-blue-400" />OI heat</span>
        <span className="flex items-center gap-1"><span className="text-cyan-400">CYAN</span>=ATM</span>
        <span className="flex items-center gap-1"><span className="text-violet-400">VIOLET</span>=Max Pain</span>
        {/* Clear trading rule */}
        <div className="w-full mt-1 flex flex-col gap-0.5 rounded-lg border border-slate-700/40 bg-slate-900/50 px-2 py-1.5 text-[9px]">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <span className="flex items-center gap-1 text-emerald-400 font-bold">
              <span className="text-emerald-300">↑ CE BUY</span> = <span className="text-emerald-200">BUY CALL option</span> <span className="text-emerald-500/70 font-normal">(market going UP)</span>
            </span>
            <span className="text-slate-600">|</span>
            <span className="flex items-center gap-1 text-red-400 font-bold">
              <span className="text-red-300">↓ PE BUY</span> = <span className="text-red-200">BUY PUT option</span> <span className="text-red-500/70 font-normal">(market going DOWN)</span>
            </span>
          </div>
          <p className="text-center text-slate-500 text-[8px] mt-0.5">When CE BUY and PE HOLD → Buy CE. When PE BUY and CE HOLD → Buy PE. When both BUY or both NEUTRAL → Wait.</p>
        </div>
      </div>
    </div>
  );
});
SymbolStrikeCard.displayName = 'SymbolStrikeCard';

// Main Component

const StrikeIntelligence = memo(() => {
  const { strikeData } = useStrikeIntelligence();

  const dataStatus = useMemo(() => {
    const sources = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).map(s => strikeData[s]?.dataSource).filter(Boolean);
    if (sources.length === 0)          return { label: 'WAITING',    color: 'text-slate-500'   };
    if (sources.includes('LIVE'))      return { label: 'LIVE',       color: 'text-emerald-400' };
    if (sources.includes('LAST_CLOSE'))return { label: 'LAST CLOSE', color: 'text-amber-400'   };
    if (sources.includes('CACHED'))    return { label: 'CACHED',     color: 'text-amber-400'   };
    return                                    { label: 'CLOSED',     color: 'text-slate-500'   };
  }, [strikeData]);

  return (
    <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 shadow-[0_0_0_1px_rgba(52,211,153,0.08),0_0_24px_0_rgba(52,211,153,0.06)] p-3 sm:p-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-6 rounded-full bg-gradient-to-b from-emerald-400 to-green-600 shrink-0" />
          <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight">Strike Intelligence</h3>
          <span className="hidden sm:inline text-[10px] sm:text-[11px] text-emerald-400/60 font-medium">
            ATM +/-5 | CE/PE | Vol | OI | PCR | Max Pain | BSL/SSL | BOS | Trap
          </span>
          <span className={`text-[9px] font-mono ml-1 ${dataStatus.color}`}>{dataStatus.label}</span>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        <SymbolStrikeCard data={strikeData.NIFTY}      name="NIFTY 50"   />
        <SymbolStrikeCard data={strikeData.BANKNIFTY}  name="BANK NIFTY" />
        <SymbolStrikeCard data={strikeData.SENSEX}     name="SENSEX"     />
      </div>
    </div>
  );
});
StrikeIntelligence.displayName = 'StrikeIntelligence';

export default StrikeIntelligence;

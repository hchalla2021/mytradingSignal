'use client';

import React, { memo, useMemo } from 'react';
import { useStrikeIntelligence, type SymbolStrikeData, type StrikeRow, type StrikeSignal, type StrikeSideData } from '@/hooks/useStrikeIntelligence';

// ── Signal config ───────────────────────────────────────────────────────────

const SIGNAL_CONFIG: Record<StrikeSignal, {
  label: string;
  short: string;
  color: string;
  bg: string;
  border: string;
  glow: string;
  barFrom: string;
  barTo: string;
}> = {
  STRONG_BUY: {
    label: 'STRONG BUY',
    short: 'S.BUY',
    color: 'text-emerald-300',
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-400/50',
    glow: 'shadow-emerald-500/25',
    barFrom: 'from-emerald-400',
    barTo: 'to-emerald-600',
  },
  BUY: {
    label: 'BUY',
    short: 'BUY',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-400/30',
    glow: 'shadow-emerald-500/10',
    barFrom: 'from-emerald-400',
    barTo: 'to-emerald-500',
  },
  NEUTRAL: {
    label: 'NEUTRAL',
    short: 'HOLD',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-400/30',
    glow: 'shadow-amber-500/10',
    barFrom: 'from-amber-400',
    barTo: 'to-amber-500',
  },
  SELL: {
    label: 'SELL',
    short: 'SELL',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-400/30',
    glow: 'shadow-red-500/10',
    barFrom: 'from-red-400',
    barTo: 'to-red-500',
  },
  STRONG_SELL: {
    label: 'STRONG SELL',
    short: 'S.SELL',
    color: 'text-red-300',
    bg: 'bg-red-500/20',
    border: 'border-red-400/50',
    glow: 'shadow-red-500/25',
    barFrom: 'from-red-400',
    barTo: 'to-red-600',
  },
};

// ── Utility: format numbers ─────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(2) + 'Cr';
  if (n >= 100_000) return (n / 100_000).toFixed(2) + 'L';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString('en-IN');
}

function fmtPrice(n: number): string {
  return n.toFixed(2);
}

// ── Signal Badge ────────────────────────────────────────────────────────────

const SignalBadge = memo<{ signal: StrikeSignal; compact?: boolean }>(({ signal, compact }) => {
  const cfg = SIGNAL_CONFIG[signal];
  return (
    <span className={`
      inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-bold tracking-wider
      ${cfg.bg} ${cfg.color} ${cfg.border} border shadow-sm ${cfg.glow}
      transition-all duration-300
    `}>
      {compact ? cfg.short : cfg.label}
    </span>
  );
});
SignalBadge.displayName = 'SignalBadge';

// ── Liquidity Bar (animated) ────────────────────────────────────────────────

const LiquidityBar = memo<{ buyPct: number; sellPct: number; neutralPct: number }>(({ buyPct, sellPct, neutralPct }) => {
  return (
    <div className="flex h-[6px] rounded-full overflow-hidden bg-slate-800/60 w-full">
      {buyPct > 0 && (
        <div
          className="bg-gradient-to-r from-emerald-400 to-emerald-500 transition-all duration-700 ease-out"
          style={{ width: `${buyPct}%` }}
        />
      )}
      {neutralPct > 0 && (
        <div
          className="bg-gradient-to-r from-amber-400/60 to-amber-500/60 transition-all duration-700 ease-out"
          style={{ width: `${neutralPct}%` }}
        />
      )}
      {sellPct > 0 && (
        <div
          className="bg-gradient-to-r from-red-400 to-red-500 transition-all duration-700 ease-out"
          style={{ width: `${sellPct}%` }}
        />
      )}
    </div>
  );
});
LiquidityBar.displayName = 'LiquidityBar';

// ── Score Pulse (animated dot) ──────────────────────────────────────────────

const ScorePulse = memo<{ score: number }>(({ score }) => {
  const abs = Math.abs(score);
  const color = score >= 15 ? 'bg-emerald-400' : score <= -15 ? 'bg-red-400' : 'bg-amber-400';
  const pulse = abs >= 40 ? 'animate-pulse' : '';
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} ${pulse} shadow-sm`} />
  );
});
ScorePulse.displayName = 'ScorePulse';

// ── Side Cell (CE or PE column content) ─────────────────────────────────────

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE'; volDominant?: boolean; oiDominant?: boolean }>(({ side, label, volDominant, oiDominant }) => {
  const cfg = SIGNAL_CONFIG[side.signal];
  const changeColor = side.change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const changeIcon = side.change >= 0 ? '▲' : '▼';

  // CE = green highlight, PE = rose highlight when dominant
  const dominantColor = label === 'CE' ? 'text-emerald-300' : 'text-rose-300';
  const dominantBorder = label === 'CE'
    ? 'border border-emerald-400/60 shadow-[0_0_6px_0px_rgba(52,211,153,0.45)]'
    : 'border border-rose-400/60 shadow-[0_0_6px_0px_rgba(251,113,133,0.45)]';

  return (
    <div className="flex flex-col gap-1">
      {/* Signal + Price */}
      <div className="flex items-center justify-between gap-1">
        <SignalBadge signal={side.signal} compact />
        <div className="flex items-center gap-1 text-right">
          <span className="text-[11px] sm:text-xs font-mono text-slate-300">{fmtPrice(side.price)}</span>
          <span className={`text-[9px] sm:text-[10px] font-mono ${changeColor}`}>
            {changeIcon}{Math.abs(side.change).toFixed(1)}
          </span>
        </div>
      </div>

      {/* Liquidity bar */}
      <LiquidityBar buyPct={side.breakdown.buyPct} sellPct={side.breakdown.sellPct} neutralPct={side.breakdown.neutralPct} />

      {/* Vol / OI — highlighted when this side dominates */}
      <div className="flex justify-between gap-1 text-[9px] sm:text-[10px] font-mono">
        <span
          title="Volume"
          className={`px-1 py-0.5 rounded transition-all duration-300 ${
            volDominant
              ? `${dominantColor} font-bold ${dominantBorder} bg-white/[0.04]`
              : 'text-slate-500'
          }`}
        >
          V:{fmtNum(side.volume)}
        </span>
        <span
          title="Open Interest"
          className={`px-1 py-0.5 rounded transition-all duration-300 ${
            oiDominant
              ? `${dominantColor} font-bold ${dominantBorder} bg-white/[0.04]`
              : 'text-slate-500'
          }`}
        >
          OI:{fmtNum(side.oi)}
        </span>
      </div>

      {/* Buy/Sell % */}
      <div className="flex justify-between text-[9px] text-slate-500">
        <span className="text-emerald-500">{side.breakdown.buyPct}%B</span>
        <span className="text-amber-500">{side.breakdown.neutralPct}%N</span>
        <span className="text-red-500">{side.breakdown.sellPct}%S</span>
      </div>
    </div>
  );
});
SideCell.displayName = 'SideCell';

// ── Strike Row ──────────────────────────────────────────────────────────────

const StrikeRowComponent = memo<{ row: StrikeRow; maxVol: number; maxOI: number }>(({ row, maxVol, maxOI }) => {
  const isATM = row.isATM;

  // Volume heatmap intensity
  const totalVol = row.ce.volume + row.pe.volume;
  const volIntensity = maxVol > 0 ? Math.min(totalVol / maxVol, 1) : 0;
  const totalOI = row.ce.oi + row.pe.oi;
  const oiIntensity = maxOI > 0 ? Math.min(totalOI / maxOI, 1) : 0;

  // Determine dominant side
  const ceDominant = row.ce.volume > row.pe.volume;
  const heatBg = volIntensity > 0.7
    ? ceDominant ? 'bg-emerald-500/[0.06]' : 'bg-red-500/[0.06]'
    : '';

  return (
    <div className={`
      grid grid-cols-[1fr_auto_1fr] gap-1.5 sm:gap-3 items-start px-1.5 sm:px-3 py-1.5 sm:py-2 rounded-lg
      ${isATM ? 'bg-cyan-500/[0.08] border border-cyan-400/30 shadow-sm shadow-cyan-500/10' : heatBg}
      ${isATM ? 'ring-1 ring-cyan-400/20' : ''}
      hover:bg-white/[0.02] transition-colors duration-200
    `}>
      {/* CE Side */}
      <SideCell
        side={row.ce}
        label="CE"
        volDominant={row.ce.volume > row.pe.volume}
        oiDominant={row.ce.oi > row.pe.oi}
      />

      {/* Strike Center */}
      <div className="flex flex-col items-center justify-center min-w-[48px] sm:min-w-[68px] pt-1">
        <span className={`
          text-[12px] sm:text-sm font-bold font-mono
          ${isATM ? 'text-cyan-300' : 'text-slate-300'}
        `}>
          {row.strike.toLocaleString('en-IN')}
        </span>
        <span className={`
          text-[9px] sm:text-[10px] font-medium uppercase tracking-wider mt-0.5
          ${isATM ? 'text-cyan-400' : 'text-slate-600'}
        `}>
          {row.label}
        </span>

        {/* Activity indicator */}
        <div className="flex items-center gap-1 mt-1">
          <ScorePulse score={row.ce.score} />
          {/* Volume heat bar */}
          <div className="w-8 h-1 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                volIntensity > 0.7 ? 'bg-amber-400' : volIntensity > 0.4 ? 'bg-amber-500/60' : 'bg-slate-700'
              }`}
              style={{ width: `${volIntensity * 100}%` }}
            />
          </div>
          <ScorePulse score={row.pe.score} />
        </div>

        {/* OI heat bar */}
        <div className="w-10 h-[3px] rounded-full bg-slate-800 overflow-hidden mt-0.5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              oiIntensity > 0.7 ? 'bg-blue-400' : oiIntensity > 0.4 ? 'bg-blue-500/50' : 'bg-slate-700'
            }`}
            style={{ width: `${oiIntensity * 100}%` }}
          />
        </div>
      </div>

      {/* PE Side */}
      <SideCell
        side={row.pe}
        label="PE"
        volDominant={row.pe.volume > row.ce.volume}
        oiDominant={row.pe.oi > row.ce.oi}
      />
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

// ── Per-symbol composite signal engine ─────────────────────────────────────
// Used for the top-right badge on each NIFTY / BANKNIFTY / SENSEX card.
//
// Formula:
//   Net score per strike = (ce.score − pe.score)
//     ce.score > 0 → calls active/rising → bullish
//     pe.score > 0 → puts active/rising → bearish
//     So ce−pe > 0 = net bullish; ce−pe < 0 = net bearish
//
//   Weighted average across strikes:
//     • ATM        → proximity weight ×4
//     • ATM ±1     → ×3
//     • ATM ±2     → ×2
//     • ATM ±3     → ×1.5
//     • rest       → ×1
//     • Volume amplifier: log10(strikeVol)/8  (high-vol strikes counted more)
//
//   Fast momentum overlay (±20 pts):
//     At ATM ± 1: (CE % change − PE % change) reflects real-time price movement
//     CE rising + PE falling = accelerating bull momentum → +score
//     PE rising + CE falling = accelerating bear momentum → −score
//
// Thresholds: ≥30 STRONG_BUY | ≥12 BUY | ≤−12 SELL | ≤−30 STRONG_SELL

type OverallSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

const OVERALL_CFG: Record<OverallSignal, {
  label: string; color: string; bg: string; border: string; glow: string; arrow: string;
}> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-200', bg: 'bg-emerald-500/25', border: 'border-emerald-400/70', glow: 'shadow-[0_0_12px_2px_rgba(52,211,153,0.35)]', arrow: '▲▲' },
  BUY:         { label: 'BUY',          color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', glow: 'shadow-[0_0_8px_0px_rgba(52,211,153,0.20)]', arrow: '▲' },
  NEUTRAL:     { label: 'NEUTRAL',      color: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-400/40',   glow: '', arrow: '◆' },
  SELL:        { label: 'SELL',         color: 'text-red-300',     bg: 'bg-red-500/15',     border: 'border-red-400/40',     glow: 'shadow-[0_0_8px_0px_rgba(251,113,133,0.20)]', arrow: '▼' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-red-200',     bg: 'bg-red-500/25',     border: 'border-red-400/70',     glow: 'shadow-[0_0_12px_2px_rgba(251,113,133,0.35)]', arrow: '▼▼' },
};

function computeSymbolSignal(strikes: StrikeRow[]): { signal: OverallSignal; score: number } {
  if (!strikes.length) return { signal: 'NEUTRAL', score: 0 };

  const atmIdx = strikes.findIndex(s => s.isATM);
  const pivot = atmIdx === -1 ? Math.floor(strikes.length / 2) : atmIdx;

  let weightedNet = 0;
  let totalWeight = 0;
  let momentumScore = 0;

  for (let i = 0; i < strikes.length; i++) {
    const s = strikes[i];
    const dist = Math.abs(i - pivot);

    // ATM-proximity weight
    const proxW = dist === 0 ? 4 : dist === 1 ? 3 : dist === 2 ? 2 : dist === 3 ? 1.5 : 1;

    // Volume amplifier: high-volume strikes are more meaningful
    const strikeVol = s.ce.volume + s.pe.volume;
    const volAmp = 1 + Math.log10(Math.max(strikeVol, 10)) / 8;

    const w = proxW * volAmp;

    // Net score for this strike: positive = bullish, negative = bearish
    const net = s.ce.score - s.pe.score;
    weightedNet += net * w;
    totalWeight += w;

    // Fast price momentum at ATM ± 1 (most sensitive to real-time moves)
    if (dist <= 1) {
      const ceRate = s.ce.price > 0 ? (s.ce.change / s.ce.price) * 100 : 0;
      const peRate = s.pe.price > 0 ? (s.pe.change / s.pe.price) * 100 : 0;
      // CE rising while PE falling = strong bull momentum
      const mW = dist === 0 ? 3 : 1.5;
      momentumScore += (ceRate - peRate) * mW;
    }
  }

  if (totalWeight === 0) return { signal: 'NEUTRAL', score: 0 };

  const baseScore = weightedNet / totalWeight;                     // weighted net per-strike
  const momentumCapped = Math.max(-20, Math.min(20, momentumScore * 2)); // momentum overlay ±20
  const finalScore = Math.round(baseScore + momentumCapped);

  let signal: OverallSignal;
  if (finalScore >= 30)       signal = 'STRONG_BUY';
  else if (finalScore >= 12)  signal = 'BUY';
  else if (finalScore <= -30) signal = 'STRONG_SELL';
  else if (finalScore <= -12) signal = 'SELL';
  else                        signal = 'NEUTRAL';

  return { signal, score: finalScore };
}

// ── Symbol Card ─────────────────────────────────────────────────────────────

const SymbolStrikeCard = memo<{ data: SymbolStrikeData | null; name: string }>(({ data, name }) => {
  const strikes = data?.strikes ?? [];
  const hasData = strikes.length > 0;

  // Pre-compute max vol/OI for heatmap normalization (hooks must run unconditionally)
  const maxVol = useMemo(() => {
    if (!hasData) return 1;
    return Math.max(...strikes.map(s => s.ce.volume + s.pe.volume), 1);
  }, [strikes, hasData]);

  const maxOI = useMemo(() => {
    if (!hasData) return 1;
    return Math.max(...strikes.map(s => s.ce.oi + s.pe.oi), 1);
  }, [strikes, hasData]);

  // Overall sentiment — weighted by actual score magnitude, not signal count
  // CE score > 0 = bullish for market; PE score > 0 = bearish for market
  const summary = useMemo(() => {
    if (!hasData) return { bullPct: 50, bearPct: 50, neutralPct: 0, bias: 'NEUTRAL' as const, pcr: 1 };
    let rawBull = 0, rawBear = 0;
    let totalCEOI = 0, totalPEOI = 0;
    for (const s of strikes) {
      // CE score: positive = calls gaining/active = bullish
      rawBull += Math.max(0, s.ce.score);
      rawBear += Math.max(0, -s.ce.score);
      // PE score: positive = puts gaining/active = bearish for market
      rawBear += Math.max(0, s.pe.score);
      rawBull += Math.max(0, -s.pe.score);
      totalCEOI += s.ce.oi;
      totalPEOI += s.pe.oi;
    }
    const total = rawBull + rawBear || 1;
    const bullPct = Math.round(rawBull / total * 100);
    const bearPct = Math.round(rawBear / total * 100);
    const neutralPct = Math.max(0, 100 - bullPct - bearPct);
    const pcr = totalCEOI > 0 ? parseFloat((totalPEOI / totalCEOI).toFixed(2)) : 1;
    // Need a meaningful threshold: only call BULLISH/BEARISH if spread ≥ 10%
    const spread = bullPct - bearPct;
    const bias = spread >= 10 ? 'BULLISH' as const : spread <= -10 ? 'BEARISH' as const : 'NEUTRAL' as const;
    return { bullPct, bearPct, neutralPct, bias, pcr };
  }, [strikes, hasData]);

  // ATM-proximity + volume-weighted composite signal for the card badge
  const symbolSignal = useMemo(() => computeSymbolSignal(strikes), [strikes]);

  if (!data || !hasData) {
    return (
      <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs sm:text-sm font-bold text-slate-400">{name}</span>
          <span className="text-[10px] text-slate-600">No data</span>
        </div>
        <div className="text-center py-6 text-slate-600 text-xs">
          Waiting for strike data...
        </div>
      </div>
    );
  }

  const biasColor = summary.bias === 'BULLISH' ? 'text-emerald-400' : summary.bias === 'BEARISH' ? 'text-red-400' : 'text-amber-400';
  const biasBg = summary.bias === 'BULLISH' ? 'bg-emerald-500/10' : summary.bias === 'BEARISH' ? 'bg-red-500/10' : 'bg-amber-500/10';

  const sourceColor = data.dataSource === 'LIVE' ? 'text-emerald-400' : data.dataSource === 'CACHED' ? 'text-amber-400' : 'text-slate-500';
  const sourceLabel = data.dataSource === 'LIVE' ? '● LIVE' : data.dataSource === 'CACHED' ? '◐ CACHED' : '○ CLOSED';

  return (
    <div className="rounded-xl bg-dark-card/60 border border-slate-700/40 p-3 sm:p-4 overflow-hidden">
      {/* Header — left: name+atm chips | right: signal badge */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] sm:text-sm font-bold text-emerald-200 bg-emerald-500/5 border border-emerald-500/30 shadow-[0_0_6px_rgba(52,211,153,0.15)] shrink-0">{name}</span>
          <span className="inline-flex flex-wrap items-center gap-1 px-2 py-0.5 rounded-md text-[10px] sm:text-[12px] font-mono font-semibold text-emerald-300 bg-emerald-500/5 border border-emerald-500/30 shadow-[0_0_6px_rgba(52,211,153,0.15)] shrink-0">
            <span className="whitespace-nowrap">ATM: {data.atm.toLocaleString('en-IN')}</span>
            <span className="text-emerald-500/60">·</span>
            <span className="whitespace-nowrap">Spot: {data.spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
          </span>
        </div>

        {/* ── Top-right composite signal badge ── */}
        {(() => {
          const cfg = OVERALL_CFG[symbolSignal.signal];
          const pulse = symbolSignal.signal === 'STRONG_BUY' || symbolSignal.signal === 'STRONG_SELL';
          return (
            <div className="flex flex-col items-end gap-0.5 shrink-0">
              <span
                title={`Composite score: ${symbolSignal.score > 0 ? '+' : ''}${symbolSignal.score} (OI + Vol + Price momentum, ATM-weighted)`}
                className={`
                  inline-flex items-center gap-1 whitespace-nowrap px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-lg
                  text-[10px] sm:text-[12px] font-black tracking-wide
                  border ${cfg.bg} ${cfg.color} ${cfg.border} ${cfg.glow}
                  transition-all duration-300
                  ${pulse ? 'animate-pulse' : ''}
                `}
              >
                <span className="opacity-80 text-[9px] sm:text-[10px]">{cfg.arrow}</span>
                {cfg.label}
                <span className="text-[9px] font-mono opacity-60">{symbolSignal.score > 0 ? '+' : ''}{symbolSignal.score}</span>
              </span>
              <div className="flex items-center gap-1.5">
                <span className={`text-[9px] font-mono ${sourceColor}`}>{sourceLabel}</span>
                {data.expiry && (
                  <span className="text-[8px] text-slate-600 font-mono">Exp: {data.expiry}</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Sentiment Bar */}
      <div className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-2 sm:px-2.5 py-1.5 mb-3 ${biasBg} border border-slate-700/30`}>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] sm:text-[11px] font-bold ${biasColor}`}>{summary.bias}</span>
          <span className="hidden sm:inline text-[9px] text-slate-500">Score-Weighted</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[9px] sm:text-[10px] font-mono">
          <span className="text-emerald-400">{summary.bullPct}%▲</span>
          <span className="text-slate-600">·</span>
          <span className="text-amber-400/80">{summary.neutralPct}%~</span>
          <span className="text-slate-600">·</span>
          <span className="text-red-400">{summary.bearPct}%▼</span>
          <span className="text-slate-600">·</span>
          <span className="text-cyan-400/70" title="Put-Call Ratio (PE OI ÷ CE OI)">PCR:{summary.pcr}</span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-1.5 sm:gap-3 px-1.5 sm:px-3 mb-1.5">
        <div className="text-[9px] sm:text-[10px] font-semibold text-emerald-400/70 tracking-wider uppercase">
          CALL (CE)
        </div>
        <div className="text-[9px] sm:text-[10px] font-semibold text-cyan-400/70 tracking-wider uppercase text-center min-w-[48px] sm:min-w-[68px]">
          STRIKE
        </div>
        <div className="text-[9px] sm:text-[10px] font-semibold text-red-400/70 tracking-wider uppercase text-right">
          PUT (PE)
        </div>
      </div>

      {/* Strike Rows */}
      <div className="flex flex-col gap-1">
        {data.strikes.map(row => (
          <StrikeRowComponent key={row.strike} row={row} maxVol={maxVol} maxOI={maxOI} />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 mt-3 text-[8px] sm:text-[9px] text-slate-600">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />Strong Buy</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/60 inline-block" />Buy</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Neutral</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60 inline-block" />Sell</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />Strong Sell</span>
        <span className="text-slate-700">|</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-amber-400 inline-block" />Vol Heat</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1 rounded-full bg-blue-400 inline-block" />OI Heat</span>
      </div>
    </div>
  );
});
SymbolStrikeCard.displayName = 'SymbolStrikeCard';

// ── Main Component ──────────────────────────────────────────────────────────

const StrikeIntelligence = memo(() => {
  const { strikeData, isConnected } = useStrikeIntelligence();

  // Derive status from actual data source, not just WS connectivity
  const dataStatus = useMemo(() => {
    const sources = [strikeData.NIFTY?.dataSource, strikeData.BANKNIFTY?.dataSource, strikeData.SENSEX?.dataSource].filter(Boolean);
    if (sources.length === 0) return { label: '○ WAITING', color: 'text-slate-500' };
    if (sources.includes('LIVE')) return { label: '● LIVE', color: 'text-emerald-400' };
    if (sources.includes('CACHED')) return { label: '◐ CACHED', color: 'text-amber-400' };
    return { label: '○ CLOSED', color: 'text-slate-500' };
  }, [strikeData]);

  return (
    <div className="mt-4 rounded-2xl border border-emerald-500/30 bg-emerald-950/10 shadow-[0_0_0_1px_rgba(52,211,153,0.08),0_0_24px_0_rgba(52,211,153,0.06)] p-3 sm:p-4">
      {/* Sub-section header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-6 rounded-full bg-gradient-to-b from-emerald-400 to-green-600 shrink-0" />
          <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight">
            Strike Intelligence
          </h3>
          <span className="hidden sm:inline text-[10px] sm:text-[11px] text-emerald-400/60 font-medium">
            ATM ± 5 · CE/PE · Volume · OI · Liquidity Scoring
          </span>
          <span className={`text-[9px] font-mono ml-1 ${dataStatus.color}`}>
            {dataStatus.label}
          </span>
        </div>
      </div>

      {/* All 3 Symbol Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        <SymbolStrikeCard data={strikeData.NIFTY} name="NIFTY 50" />
        <SymbolStrikeCard data={strikeData.BANKNIFTY} name="BANK NIFTY" />
        <SymbolStrikeCard data={strikeData.SENSEX} name="SENSEX" />
      </div>
    </div>
  );
});
StrikeIntelligence.displayName = 'StrikeIntelligence';

export default StrikeIntelligence;

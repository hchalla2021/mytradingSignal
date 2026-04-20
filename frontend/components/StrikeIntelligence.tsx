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

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE' }>(({ side, label }) => {
  const cfg = SIGNAL_CONFIG[side.signal];
  const changeColor = side.change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const changeIcon = side.change >= 0 ? '▲' : '▼';

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

      {/* Vol / OI */}
      <div className="flex justify-between text-[9px] sm:text-[10px] text-slate-500 font-mono">
        <span title="Volume">V:{fmtNum(side.volume)}</span>
        <span title="Open Interest">OI:{fmtNum(side.oi)}</span>
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
      grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 items-start px-2 sm:px-3 py-2 rounded-lg
      ${isATM ? 'bg-cyan-500/[0.08] border border-cyan-400/30 shadow-sm shadow-cyan-500/10' : heatBg}
      ${isATM ? 'ring-1 ring-cyan-400/20' : ''}
      hover:bg-white/[0.02] transition-colors duration-200
    `}>
      {/* CE Side */}
      <SideCell side={row.ce} label="CE" />

      {/* Strike Center */}
      <div className="flex flex-col items-center justify-center min-w-[60px] sm:min-w-[72px] pt-1">
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
      <SideCell side={row.pe} label="PE" />
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

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

  // Overall sentiment summary
  const summary = useMemo(() => {
    if (!hasData) return { bullPct: 50, bearPct: 50, bias: 'NEUTRAL' as const };
    let bullCount = 0, bearCount = 0;
    for (const s of strikes) {
      if (s.ce.signal === 'STRONG_BUY' || s.ce.signal === 'BUY') bullCount++;
      if (s.ce.signal === 'STRONG_SELL' || s.ce.signal === 'SELL') bearCount++;
      if (s.pe.signal === 'STRONG_BUY' || s.pe.signal === 'BUY') bearCount++; // PE buy = bearish
      if (s.pe.signal === 'STRONG_SELL' || s.pe.signal === 'SELL') bullCount++; // PE sell = bullish
    }
    const total = bullCount + bearCount || 1;
    return {
      bullPct: Math.round(bullCount / total * 100),
      bearPct: Math.round(bearCount / total * 100),
      bias: bullCount > bearCount ? 'BULLISH' as const : bearCount > bullCount ? 'BEARISH' as const : 'NEUTRAL' as const,
    };
  }, [strikes, hasData]);

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
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-bold text-white">{name}</span>
          <span className="text-[10px] sm:text-[11px] font-mono text-slate-500">
            ATM: {data.atm.toLocaleString('en-IN')} · Spot: {data.spot.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-[9px] sm:text-[10px] font-mono ${sourceColor}`}>{sourceLabel}</span>
          {data.expiry && (
            <span className="text-[9px] text-slate-600 font-mono">Exp: {data.expiry}</span>
          )}
        </div>
      </div>

      {/* Sentiment Bar */}
      <div className={`flex items-center justify-between rounded-lg px-2.5 py-1.5 mb-3 ${biasBg} border border-slate-700/30`}>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] sm:text-[11px] font-bold ${biasColor}`}>
            {summary.bias}
          </span>
          <span className="text-[9px] text-slate-500">Strike Consensus</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-emerald-400">{summary.bullPct}% Bull</span>
          <span className="text-slate-600">·</span>
          <span className="text-red-400">{summary.bearPct}% Bear</span>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-2 sm:gap-3 px-2 sm:px-3 mb-1.5">
        <div className="text-[10px] sm:text-[11px] font-semibold text-emerald-400/70 tracking-wider uppercase">
          CALL (CE)
        </div>
        <div className="text-[10px] sm:text-[11px] font-semibold text-cyan-400/70 tracking-wider uppercase text-center min-w-[60px] sm:min-w-[72px]">
          STRIKE
        </div>
        <div className="text-[10px] sm:text-[11px] font-semibold text-red-400/70 tracking-wider uppercase text-right">
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
    <div className="mt-4">
      {/* Sub-section header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-[3px] h-6 rounded-full bg-gradient-to-b from-cyan-400 to-blue-500 shrink-0" />
          <h3 className="text-[13px] sm:text-[15px] font-bold text-white tracking-tight">
            Strike Intelligence
          </h3>
          <span className="text-[10px] sm:text-[11px] text-cyan-400/60 font-medium">
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

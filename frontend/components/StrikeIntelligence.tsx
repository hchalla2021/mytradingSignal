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
  BUY:         { label: 'BUY',          short: 'BUY',    color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/30', glow: 'shadow-emerald-500/10' },
  NEUTRAL:     { label: 'NEUTRAL',      short: 'HOLD',   color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/30',   glow: 'shadow-amber-500/10'  },
  SELL:        { label: 'SELL',         short: 'SELL',   color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/30',     glow: 'shadow-red-500/10'    },
  STRONG_SELL: { label: 'STRONG SELL',  short: 'S.SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/50',     glow: 'shadow-red-500/25'    },
};

type OverallSignal = StrikeSignal;

const OVERALL_CFG: Record<OverallSignal, { label: string; color: string; bg: string; border: string; glow: string; arrow: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-200', bg: 'bg-emerald-500/25', border: 'border-emerald-400/70', glow: 'shadow-[0_0_12px_2px_rgba(52,211,153,0.35)]',   arrow: 'UP++' },
  BUY:         { label: 'BUY',          color: 'text-emerald-300', bg: 'bg-emerald-500/15', border: 'border-emerald-400/40', glow: 'shadow-[0_0_8px_0px_rgba(52,211,153,0.20)]',    arrow: 'UP'   },
  NEUTRAL:     { label: 'NEUTRAL',      color: 'text-amber-300',   bg: 'bg-amber-500/15',   border: 'border-amber-400/40',   glow: '',                                              arrow: 'FLAT' },
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

// Primitives

const SignalBadge = memo<{ signal: StrikeSignal; side: 'CE' | 'PE' }>(({ signal, side }) => {
  const cfg = SIGNAL_CONFIG[signal];
  const short = side === 'CE' ? `C.${cfg.short}` : `P.${cfg.short}`;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] sm:text-[11px] font-bold tracking-wider ${cfg.bg} ${cfg.color} ${cfg.border} border shadow-sm ${cfg.glow} transition-all duration-300`}>
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

// Side Cell

const SideCell = memo<{ side: StrikeSideData; label: 'CE' | 'PE'; volDominant: boolean; oiDominant: boolean; isATM: boolean }>(({ side, label, volDominant, oiDominant, isATM }) => {
  const isCE = label === 'CE';
  const changeColor = side.change >= 0 ? 'text-emerald-400' : 'text-red-400';
  const changeIcon  = side.change >= 0 ? 'UP' : 'DOWN';

  const signalBg =
    side.signal === 'STRONG_BUY'  ? (isCE ? 'bg-emerald-500/[0.12]' : 'bg-red-500/[0.06]') :
    side.signal === 'BUY'         ? (isCE ? 'bg-emerald-500/[0.07]' : 'bg-red-500/[0.03]') :
    side.signal === 'STRONG_SELL' ? (isCE ? 'bg-red-500/[0.12]'     : 'bg-emerald-500/[0.06]') :
    side.signal === 'SELL'        ? (isCE ? 'bg-red-500/[0.07]'     : 'bg-emerald-500/[0.03]') : '';

  const border = isATM
    ? 'border-2 border-cyan-300/65 shadow-[0_0_10px_0_rgba(34,211,238,0.18)]'
    : isCE ? 'border border-emerald-500/28' : 'border border-red-500/28';

  const dominantRing = volDominant
    ? (isCE ? 'ring-1 ring-emerald-400/40 shadow-[0_0_6px_0_rgba(52,211,153,0.25)]' : 'ring-1 ring-rose-400/40 shadow-[0_0_6px_0_rgba(251,113,133,0.25)]')
    : '';

  const sigs = side.signals;

  return (
    <div className={`flex flex-col gap-1 px-1.5 py-1.5 rounded-lg transition-all duration-300 ${signalBg} ${border} ${dominantRing}`}>
      {/* Price + signal */}
      <div className={`flex items-center ${isCE ? 'flex-row' : 'flex-row-reverse'} justify-between gap-1`}>
        <SignalBadge signal={side.signal} side={label} />
        <div className={`flex items-center gap-0.5 ${isCE ? 'text-right' : 'text-left'}`}>
          <span className="text-[11px] sm:text-[12px] font-mono font-semibold text-slate-200">{side.price.toFixed(2)}</span>
          <span className={`text-[9px] font-mono ${changeColor} font-bold`}>{changeIcon}{Math.abs(side.change).toFixed(1)}</span>
        </div>
      </div>

      {/* Pressure bar */}
      <LiquidityBar buyPct={side.breakdown.buyPct} sellPct={side.breakdown.sellPct} neutralPct={side.breakdown.neutralPct} />

      {/* Volume + OI */}
      <div className={`flex gap-1 text-[9px] sm:text-[10px] font-mono ${isCE ? 'flex-row' : 'flex-row-reverse'}`}>
        <span title="Volume" className={`px-1 py-0.5 rounded font-semibold transition-all duration-300 ${volDominant ? (isCE ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-400/40' : 'text-rose-300 bg-rose-500/10 border border-rose-400/40') : 'text-slate-500'}`}>
          V {fmtNum(side.volume)}
        </span>
        <span title="Open Interest" className={`px-1 py-0.5 rounded font-semibold transition-all duration-300 ${oiDominant ? (isCE ? 'text-cyan-300 bg-cyan-500/10 border border-cyan-400/40' : 'text-orange-300 bg-orange-500/10 border border-orange-400/40') : 'text-slate-500'}`}>
          OI {fmtNum(side.oi)}
        </span>
      </div>

      {/* B/N/S pills */}
      <div className={`flex items-center gap-0.5 ${isCE ? 'flex-row' : 'flex-row-reverse'}`}>
        <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-emerald-500/10 text-emerald-400 text-[8px] font-bold border border-emerald-500/20">{Math.round(side.breakdown.buyPct)}%<span className="text-emerald-300">B</span></span>
        {Math.round(side.breakdown.neutralPct) > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-amber-500/10 text-amber-400 text-[8px] font-bold border border-amber-500/20">{Math.round(side.breakdown.neutralPct)}%<span className="text-amber-300">N</span></span>
        )}
        <span className="inline-flex items-center gap-0.5 px-1 py-0 rounded bg-red-500/10 text-red-400 text-[8px] font-bold border border-red-500/20">{Math.round(side.breakdown.sellPct)}%<span className="text-red-300">S</span></span>
      </div>

      {/* Smart-money tags */}
      {sigs && (sigs.liq || sigs.bos || sigs.trap || sigs.delta !== undefined) && (
        <div className={`flex flex-wrap items-center gap-0.5 ${isCE ? 'flex-row' : 'flex-row-reverse'}`}>
          {sigs.liq && (
            <span title={sigs.liq === 'BSL' ? 'Buy-Side Liquidity: call wall above = institutional resistance' : 'Sell-Side Liquidity: put wall below = institutional support'} className={`text-[8px] font-bold px-1 py-0 rounded leading-tight ${sigs.liq === 'BSL' ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40' : 'bg-orange-500/15 text-orange-300 border border-orange-400/40'}`}>{sigs.liq}</span>
          )}
          {sigs.bos && (
            <span title={sigs.bos === 'UP' ? 'BOS UP: CE surging > PE falling (bullish structure break)' : 'BOS DOWN: PE surging > CE falling (bearish breakdown)'} className={`text-[8px] font-bold px-1 py-0 rounded leading-tight ${sigs.bos === 'UP' ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/40' : 'bg-red-500/15 text-red-300 border border-red-400/40'}`}>BOS {sigs.bos === 'UP' ? 'UP' : 'DOWN'}</span>
          )}
          {sigs.trap && (
            <span title="Trap warning: high volume but price not moving (possible institutional absorption)" className="text-[8px] font-bold px-1 py-0 rounded leading-tight bg-amber-500/20 text-amber-300 border border-amber-400/50 animate-pulse">TRAP</span>
          )}
          {sigs.delta !== undefined && (
            <span title={`Delta ${sigs.delta.toFixed(2)} | ITM ~ 0.9 | ATM ~ 0.5 | OTM ~ 0.1`} className={`text-[8px] font-mono px-1 py-0 rounded leading-tight ${sigs.delta >= 0.65 ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-400/30' : sigs.delta <= 0.35 ? 'bg-slate-700/60 text-slate-500 border border-slate-600/30' : 'bg-slate-700/40 text-slate-400 border border-slate-600/20'}`}>DELTA {sigs.delta.toFixed(2)}</span>
          )}
          {sigs.oiInterp && side.oiChange !== undefined && side.oiChange !== 0 && (
            <span
              title={
                sigs.oiInterp === 'LB' ? 'Long Buildup: OI rising + Price rising — fresh longs entering, strong directional conviction' :
                sigs.oiInterp === 'SB' ? 'Short Buildup: OI rising + Price falling — fresh shorts entering, selling pressure building' :
                sigs.oiInterp === 'SC' ? 'Short Covering: OI falling + Price rising — shorts exiting, mild upside relief' :
                'Long Unwinding: OI falling + Price falling — longs exiting, mild selling pressure'
              }
              className={`text-[8px] font-bold px-1 py-0 rounded leading-tight border ${
                sigs.oiInterp === 'LB' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50' :
                sigs.oiInterp === 'SB' ? 'bg-red-500/20 text-red-300 border-red-400/50' :
                sigs.oiInterp === 'SC' ? 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/30' :
                'bg-red-500/10 text-red-400/80 border-red-500/30'
              }`}
            >
              {sigs.oiInterp} {side.oiChange > 0 ? '+' : ''}{fmtNum(side.oiChange)}
            </span>
          )}
        </div>
      )}
    </div>
  );
});
SideCell.displayName = 'SideCell';

// Strike Row

const StrikeRowComponent = memo<{ row: StrikeRow; maxVol: number; maxOI: number }>(({ row, maxVol, maxOI }) => {
  const isATM = row.isATM;
  const totalVol  = row.ce.volume + row.pe.volume;
  const totalOI   = row.ce.oi    + row.pe.oi;
  const volIntensity = maxVol > 0 ? Math.min(totalVol / maxVol, 1) : 0;
  const oiIntensity  = maxOI  > 0 ? Math.min(totalOI  / maxOI,  1) : 0;

  const rowBorder =
    isATM                          ? 'border-[3px] border-cyan-300/85 shadow-[0_0_14px_0_rgba(34,211,238,0.16)]' :
    row.ce.signal === 'STRONG_BUY' ? 'border-l-[3px] border-emerald-400/70' :
    row.pe.signal === 'STRONG_BUY' ? 'border-r-[3px] border-red-400/70' :
    row.ce.signal === 'BUY'        ? 'border-l-2 border-emerald-500/40' :
    row.pe.signal === 'BUY'        ? 'border-r-2 border-red-500/40' :
    'border-l border-r border-transparent';

  const rowBg =
    isATM              ? 'bg-cyan-400/[0.10]' :
    volIntensity > 0.7 ? (row.ce.volume > row.pe.volume ? 'bg-emerald-500/[0.04]' : 'bg-red-500/[0.04]') : '';

  return (
    <div className={`grid grid-cols-[1fr_72px_1fr] sm:grid-cols-[1fr_84px_1fr] items-stretch gap-0 rounded-lg overflow-hidden ${rowBg} ${rowBorder} ${isATM ? 'ring-2 ring-cyan-300/45 shadow-md shadow-cyan-400/20' : ''} hover:bg-white/[0.025] transition-colors duration-150`}>
      <SideCell side={row.ce} label="CE" volDominant={row.ce.volume > row.pe.volume} oiDominant={row.ce.oi > row.pe.oi} isATM={isATM} />

      {/* Strike center */}
      <div className={`flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 border-x ${isATM ? 'border-cyan-300/50 bg-cyan-400/[0.08]' : 'border-slate-700/40'}`}>
        <span className={`text-[11px] sm:text-[13px] font-black font-mono tracking-tight ${isATM ? 'text-cyan-300' : 'text-slate-300'}`}>{row.strike.toLocaleString('en-IN')}</span>
        <span className={`text-[8px] font-bold uppercase tracking-widest px-1 rounded ${isATM ? 'text-cyan-400 bg-cyan-500/15 border border-cyan-400/30' : 'text-slate-600'}`}>{row.label}</span>
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

      <SideCell side={row.pe} label="PE" volDominant={row.pe.volume > row.ce.volume} oiDominant={row.pe.oi > row.ce.oi} isATM={isATM} />
    </div>
  );
});
StrikeRowComponent.displayName = 'StrikeRowComponent';

// Symbol Card

const SymbolStrikeCard = memo<{ data: SymbolStrikeData | null; name: string }>(({ data, name }) => {
  const strikes      = data?.strikes ?? [];
  const hasData      = strikes.length > 0;
  const intelligence = data?.intelligence;

  const maxVol = useMemo(() => hasData ? Math.max(...strikes.map(s => s.ce.volume + s.pe.volume), 1) : 1, [strikes, hasData]);
  const maxOI  = useMemo(() => hasData ? Math.max(...strikes.map(s => s.ce.oi    + s.pe.oi),    1) : 1, [strikes, hasData]);

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

      {/* Feed status bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2 rounded-lg border border-slate-700/30 bg-slate-900/40 px-2 py-1">
        <span className="text-[9px] sm:text-[10px] font-medium text-slate-300">{feedLabel}</span>
        <div className="flex flex-wrap items-center gap-2 text-[8px] sm:text-[9px] font-mono text-slate-500">
          <span title="Spot/ATM recalculation cadence">Spot: 1s</span>
          <span title="CE/PE option-chain refresh cadence">Chain: 5s</span>
        </div>
      </div>

      {/* Strike table header */}
      <div className="grid grid-cols-[1fr_72px_1fr] sm:grid-cols-[1fr_84px_1fr] rounded-t-lg overflow-hidden border border-slate-700/50 mb-0">
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-emerald-500/10 border-r border-slate-700/50">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
          <span className="text-[10px] font-black tracking-widest uppercase text-emerald-300">CALL (CE)</span>
          <span className="ml-auto text-[8px] text-emerald-500/60 hidden sm:inline">Market trend: UP</span>
        </div>
        <div className="flex flex-col items-center justify-center px-1 py-1.5 bg-slate-800/60 border-r border-slate-700/50">
          <span className="text-[9px] font-black tracking-widest uppercase text-cyan-400">STRIKE</span>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[7px] text-amber-400/70">VOL</span>
            <span className="text-[7px] text-blue-400/70">OI</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1.5 bg-red-500/10 flex-row-reverse">
          <span className="w-2 h-2 rounded-full bg-red-400 inline-block" />
          <span className="text-[10px] font-black tracking-widest uppercase text-red-300">PUT (PE)</span>
          <span className="mr-auto text-[8px] text-red-500/60 hidden sm:inline">Market trend: DOWN</span>
        </div>
      </div>

      {/* Sub-header */}
      <div className="grid grid-cols-[1fr_72px_1fr] sm:grid-cols-[1fr_84px_1fr] border-x border-b border-slate-700/40 bg-slate-900/40 mb-1">
        <div className="flex items-center gap-2 px-2 py-0.5 text-[8px] text-slate-500 border-r border-slate-700/30">
          <span>Signal | Price</span><span className="ml-auto hidden sm:inline">V | OI | B/S%</span>
        </div>
        <div className="flex items-center justify-center px-1 py-0.5 border-r border-slate-700/30">
          <span className="text-[7px] text-slate-600">Vol -> OI</span>
        </div>
        <div className="flex items-center gap-2 px-2 py-0.5 text-[8px] text-slate-500 flex-row-reverse">
          <span>Signal | Price</span><span className="mr-auto hidden sm:inline">V | OI | B/S%</span>
        </div>
      </div>

      {/* Strike rows */}
      <div className="flex flex-col gap-[2px]">
        {data.strikes.map(row => (
          <StrikeRowComponent key={row.strike} row={row} maxVol={maxVol} maxOI={maxOI} />
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
        <span className="w-full text-center text-[8px] text-slate-500 pt-0.5">CE BUY = call strength (market likely up) | PE BUY = put strength (market likely down)</span>
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

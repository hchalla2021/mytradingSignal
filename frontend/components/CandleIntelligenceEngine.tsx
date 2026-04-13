'use client';

import React, { memo } from 'react';
import {
  useCandleIntelligence,
  type CandleIntelIndex,
  type CandleSignal,
  type CandleStrength,
  type CandleStructure,
  type ThreeFactorAlignment,
} from '@/hooks/useCandleIntelligence';
import SectionTitle from '@/components/SectionTitle';

// ── Config Maps ──────────────────────────────────────────────────────────────

const SIGNAL_CFG: Record<CandleSignal, { label: string; color: string; bg: string; border: string; glow: string; icon: string }> = {
  STRONG_BUY:  { label: 'STRONG BUY',  color: 'text-emerald-300', bg: 'bg-emerald-500/20', border: 'border-emerald-400/60', glow: 'shadow-emerald-500/30', icon: '🟢' },
  BUY:         { label: 'BUY',         color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-400/40', glow: 'shadow-emerald-500/15', icon: '🟢' },
  NEUTRAL:     { label: 'NEUTRAL',     color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-400/40',   glow: 'shadow-amber-500/15',   icon: '🟡' },
  SELL:        { label: 'SELL',        color: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-400/40',     glow: 'shadow-red-500/15',     icon: '🔴' },
  STRONG_SELL: { label: 'STRONG SELL', color: 'text-red-300',     bg: 'bg-red-500/20',     border: 'border-red-400/60',     glow: 'shadow-red-500/30',     icon: '🔴' },
};

const STRUCTURE_CFG: Record<CandleStructure, { label: string; color: string; bg: string; icon: string }> = {
  BULLISH_REVERSAL:      { label: 'Bullish Reversal',      color: 'text-emerald-300', bg: 'bg-emerald-500/15', icon: '↗️' },
  BULLISH_CONTINUATION:  { label: 'Bullish Continuation',  color: 'text-emerald-400', bg: 'bg-emerald-500/10', icon: '⬆️' },
  BEARISH_REVERSAL:      { label: 'Bearish Reversal',      color: 'text-red-300',     bg: 'bg-red-500/15',     icon: '↘️' },
  BEARISH_CONTINUATION:  { label: 'Bearish Continuation',  color: 'text-red-400',     bg: 'bg-red-500/10',     icon: '⬇️' },
  NEUTRAL:               { label: 'Neutral',               color: 'text-slate-400',   bg: 'bg-slate-500/10',   icon: '➖' },
};

const STRENGTH_CFG: Record<CandleStrength, { label: string; color: string; bg: string; icon: string; width: string }> = {
  STRONG:   { label: 'STRONG',   color: 'text-emerald-300', bg: 'bg-emerald-500/20', icon: '🔥', width: 'w-full' },
  MODERATE: { label: 'MODERATE', color: 'text-amber-400',   bg: 'bg-amber-500/15',   icon: '⚡', width: 'w-2/3' },
  WEAK:     { label: 'WEAK',     color: 'text-slate-400',   bg: 'bg-slate-500/10',   icon: '💤', width: 'w-1/3' },
};

const PATTERN_ICONS: Record<string, string> = {
  HAMMER: '🔨', INVERTED_HAMMER: '⬆️', SHOOTING_STAR: '⭐', HANGING_MAN: '🪝',
  BULLISH_ENGULFING: '🐂', BEARISH_ENGULFING: '🐻', PIERCING_LINE: '🔪',
  DARK_CLOUD_COVER: '🌑', TWEEZER_BOTTOM: '🔻', TWEEZER_TOP: '🔺',
  BULLISH_HARAMI: '🤰', BEARISH_HARAMI: '🤰', MORNING_STAR: '🌅',
  EVENING_STAR: '🌆', THREE_WHITE_SOLDIERS: '⚔️', THREE_BLACK_CROWS: '🦅',
  DOJI: '✚', DRAGONFLY_DOJI: '🪰', GRAVESTONE_DOJI: '🪦',
  SPINNING_TOP: '🌀', MARUBOZU: '🧱', BULLISH_MARUBOZU: '🧱', BEARISH_MARUBOZU: '🧱',
  LONG_LOWER_SHADOW: '📍', LONG_UPPER_SHADOW: '📌',
  BULLISH_CANDLE: '🟩', BEARISH_CANDLE: '🟥',
};

function formatPrice(n: number | undefined | null): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function patternDisplayName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Strength Bar ─────────────────────────────────────────────────────────────

const StrengthBar = memo<{ strength: CandleStrength }>(({ strength }) => {
  const cfg = STRENGTH_CFG[strength];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{cfg.icon}</span>
      <div className="flex-1 h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div className={`h-full ${strength === 'STRONG' ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : strength === 'MODERATE' ? 'bg-gradient-to-r from-amber-500 to-amber-400' : 'bg-gradient-to-r from-slate-500 to-slate-400'} rounded-full transition-all duration-500 ${cfg.width}`} />
      </div>
      <span className={`text-[10px] font-bold ${cfg.color}`}>{cfg.label}</span>
    </div>
  );
});
StrengthBar.displayName = 'StrengthBar';

// ── Anatomy Breakdown ────────────────────────────────────────────────────────

const AnatomyBreakdown = memo<{ candle: CandleIntelIndex['candle'] }>(({ candle }) => {
  if (!candle) return null;
  const rows = [
    { label: 'Body', value: (candle.body_ratio * 100).toFixed(1) + '%', color: candle.body_ratio > 0.7 ? 'text-emerald-400' : candle.body_ratio > 0.4 ? 'text-amber-400' : 'text-slate-400', pct: candle.body_ratio * 100 },
    { label: 'Upper Wick', value: (candle.upper_wick_ratio * 100).toFixed(1) + '%', color: candle.upper_wick_ratio > 0.4 ? 'text-red-400' : 'text-slate-400', pct: candle.upper_wick_ratio * 100 },
    { label: 'Lower Wick', value: (candle.lower_wick_ratio * 100).toFixed(1) + '%', color: candle.lower_wick_ratio > 0.4 ? 'text-emerald-400' : 'text-slate-400', pct: candle.lower_wick_ratio * 100 },
  ];

  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.label}>
          <div className="flex justify-between items-center mb-0.5">
            <span className="text-[9px] text-slate-500">{r.label}</span>
            <span className={`text-[10px] font-mono font-bold ${r.color}`}>{r.value}</span>
          </div>
          <div className="h-1 bg-slate-700/40 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${r.pct > 60 ? 'bg-emerald-500' : r.pct > 30 ? 'bg-amber-500' : 'bg-slate-500'}`}
              style={{ width: `${Math.min(100, r.pct)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
});
AnatomyBreakdown.displayName = 'AnatomyBreakdown';

// ── Pattern Badges ───────────────────────────────────────────────────────────

const PatternBadges = memo<{ patterns: CandleIntelIndex['all_patterns']; primary: string | null }>(({ patterns, primary }) => {
  if (!patterns || patterns.length === 0) {
    return (
      <div className="flex items-center gap-1.5 py-1">
        <span className="text-[9px] text-slate-500 italic">No pattern detected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1">
      {patterns.map((p, i) => {
        const isPrimary = p.name === primary;
        const isBull = p.structure.includes('BULLISH');
        const isBear = p.structure.includes('BEARISH');
        const icon = PATTERN_ICONS[p.name] || '🕯️';
        return (
          <span
            key={p.name + i}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold border transition-all ${
              isPrimary
                ? isBull
                  ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300 shadow-sm shadow-emerald-500/20'
                  : isBear
                    ? 'bg-red-500/20 border-red-400/60 text-red-300 shadow-sm shadow-red-500/20'
                    : 'bg-amber-500/20 border-amber-400/60 text-amber-300 shadow-sm shadow-amber-500/20'
                : 'bg-slate-700/30 border-slate-600/30 text-slate-400'
            }`}
          >
            <span>{icon}</span>
            <span>{patternDisplayName(p.name)}</span>
            {isPrimary && <span className="text-[8px] opacity-60 ml-0.5">★</span>}
          </span>
        );
      })}
    </div>
  );
});
PatternBadges.displayName = 'PatternBadges';

// ── Trend Context Mini ───────────────────────────────────────────────────────

const TrendContextMini = memo<{ ctx: CandleIntelIndex['trend_context'] }>(({ ctx }) => {
  const dirColor =
    ctx.direction === 'STRONG_BULLISH' ? 'text-emerald-300' :
    ctx.direction === 'BULLISH' ? 'text-emerald-400' :
    ctx.direction === 'STRONG_BEARISH' ? 'text-red-300' :
    ctx.direction === 'BEARISH' ? 'text-red-400' : 'text-slate-400';

  const dirBg =
    ctx.direction.includes('BULLISH') ? 'bg-emerald-500/10 border-emerald-500/20' :
    ctx.direction.includes('BEARISH') ? 'bg-red-500/10 border-red-500/20' :
    'bg-slate-500/10 border-slate-500/20';

  const total = ctx.bullish_count + ctx.bearish_count;

  return (
    <div className={`rounded-lg border ${dirBg} p-2`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[9px] text-slate-500 font-medium">5-Candle Trend</span>
        <span className={`text-[10px] font-bold ${dirColor}`}>{ctx.direction.replace('_', ' ')}</span>
      </div>
      {/* Bull/Bear ratio bar */}
      {total > 0 && (
        <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-700/40">
          <div className="bg-emerald-500 transition-all duration-500" style={{ width: `${(ctx.bullish_count / total) * 100}%` }} />
          <div className="bg-red-500 transition-all duration-500" style={{ width: `${(ctx.bearish_count / total) * 100}%` }} />
        </div>
      )}
      <div className="flex justify-between mt-1">
        <span className="text-[8px] text-emerald-400">Bull: {ctx.bullish_count}</span>
        <span className="text-[8px] text-slate-500">Avg Body: {(ctx.avg_body_ratio * 100).toFixed(0)}%</span>
        <span className="text-[8px] text-red-400">Bear: {ctx.bearish_count}</span>
      </div>
    </div>
  );
});
TrendContextMini.displayName = 'TrendContextMini';

// ── 3FA (3 Factor Alignment) Panel ───────────────────────────────────────────

const ZONE_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  NEAR_PDH:  { label: 'Near PDH',  color: 'text-emerald-300', bg: 'bg-emerald-500/15', icon: '🔼' },
  ABOVE_PDH: { label: 'Above PDH', color: 'text-emerald-200', bg: 'bg-emerald-500/20', icon: '🚀' },
  NEAR_PDL:  { label: 'Near PDL',  color: 'text-red-300',     bg: 'bg-red-500/15',     icon: '🔽' },
  BELOW_PDL: { label: 'Below PDL', color: 'text-red-200',     bg: 'bg-red-500/20',     icon: '💥' },
  MID_ZONE:  { label: 'Mid Zone',  color: 'text-amber-400',   bg: 'bg-amber-500/10',   icon: '⏸️' },
  UNKNOWN:   { label: 'Unknown',   color: 'text-slate-400',   bg: 'bg-slate-500/10',   icon: '❓' },
};

const BEHAVIOR_CFG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  REJECTION:  { label: 'Rejection',  color: 'text-red-400',     bg: 'bg-red-500/15',     icon: '🛑' },
  ABSORPTION: { label: 'Absorption', color: 'text-blue-300',    bg: 'bg-blue-500/15',    icon: '🧲' },
  BREAKOUT:   { label: 'Breakout',   color: 'text-emerald-300', bg: 'bg-emerald-500/15', icon: '⚡' },
  MOMENTUM:   { label: 'Momentum',   color: 'text-amber-300',   bg: 'bg-amber-500/15',   icon: '🚀' },
  NONE:       { label: 'None',       color: 'text-slate-400',   bg: 'bg-slate-500/10',   icon: '➖' },
};

const VERDICT_CFG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  BUY:      { label: 'BUY',      color: 'text-emerald-200', bg: 'bg-gradient-to-r from-emerald-600/30 to-emerald-500/20', border: 'border-emerald-400/60', icon: '✅' },
  SELL:     { label: 'SELL',     color: 'text-red-200',     bg: 'bg-gradient-to-r from-red-600/30 to-red-500/20',         border: 'border-red-400/60',     icon: '🔴' },
  NO_TRADE: { label: 'NO TRADE', color: 'text-slate-300',   bg: 'bg-gradient-to-r from-slate-700/40 to-slate-600/30',     border: 'border-slate-500/40',   icon: '🚫' },
};

const ThreeFactorPanel = memo<{ tfa: ThreeFactorAlignment | undefined }>(({ tfa }) => {
  if (!tfa) return null;

  const { location, behavior, confirmation, alignment_score, verdict, reason, factors_pass, factors_fail } = tfa;
  const zoneCfg = ZONE_CFG[location.zone] || ZONE_CFG.UNKNOWN;
  const behCfg = BEHAVIOR_CFG[behavior.type] || BEHAVIOR_CFG.NONE;
  const verdictCfg = VERDICT_CFG[verdict] || VERDICT_CFG.NO_TRADE;
  const scoreColor = alignment_score === 3 ? 'text-emerald-300' : alignment_score >= 2 ? 'text-amber-300' : 'text-red-400';
  const scoreBarColor = alignment_score === 3 ? 'bg-emerald-500' : alignment_score >= 2 ? 'bg-amber-500' : 'bg-red-500';

  // Sharp highlight: when verdict is actionable AND market is active
  const isMarketActive = tfa.market_active === true;
  const allAligned = alignment_score === 3 && isMarketActive;
  const hasVerdict = verdict !== 'NO_TRADE' && isMarketActive;
  const isBuySignal = hasVerdict && verdict === 'BUY';
  const isSellSignal = hasVerdict && verdict === 'SELL';

  // Outer panel border glow — sharp during alignment
  const panelBorder = isBuySignal
    ? 'border-emerald-400/80 shadow-[0_0_16px_rgba(16,185,129,0.35)]'
    : isSellSignal
      ? 'border-red-400/80 shadow-[0_0_16px_rgba(239,68,68,0.35)]'
      : 'border-slate-700/40';
  const panelBg = isBuySignal
    ? 'bg-gradient-to-br from-emerald-950/40 via-slate-900/60 to-emerald-950/30'
    : isSellSignal
      ? 'bg-gradient-to-br from-red-950/40 via-slate-900/60 to-red-950/30'
      : 'bg-gradient-to-br from-slate-800/50 to-slate-900/40';

  // Factor cell highlight helper — sharp glow on individual factor when verdict active + market live
  const factorCellClass = (factorKey: string) => {
    const pass = factors_pass.includes(factorKey);
    if (!hasVerdict) {
      // Normal state
      return pass
        ? 'border-emerald-500/40 bg-emerald-500/5'
        : 'border-slate-700/30 bg-slate-800/30';
    }
    // Active verdict → sharp highlight each factor
    if (isBuySignal) return pass ? 'border-emerald-400/70 bg-emerald-500/20 shadow-[0_0_10px_rgba(16,185,129,0.3)]' : 'border-slate-700/30 bg-slate-800/30';
    if (isSellSignal) return pass ? 'border-red-400/70 bg-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.3)]' : 'border-slate-700/30 bg-slate-800/30';
    return pass ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-700/30 bg-slate-800/30';
  };

  // Pass/Fail badge — sharp color when verdict active
  const passBadgeClass = (factorKey: string) => {
    const pass = factors_pass.includes(factorKey);
    if (!hasVerdict) {
      return pass
        ? 'bg-emerald-500/20 text-emerald-400'
        : 'bg-red-500/15 text-red-400';
    }
    if (pass && isBuySignal) return 'bg-emerald-500/40 text-emerald-200 font-extrabold';
    if (pass && isSellSignal) return 'bg-red-500/40 text-red-200 font-extrabold';
    return pass ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/15 text-red-400';
  };

  return (
    <div className={`rounded-xl border ${panelBorder} ${panelBg} p-2.5 mt-2 transition-all duration-500`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs">🔥</span>
          <span className={`text-[10px] font-extrabold tracking-wide ${allAligned ? (isBuySignal ? 'text-emerald-200' : isSellSignal ? 'text-red-200' : 'text-white') : 'text-white'}`}>3FA MODEL</span>
          <span className="text-[8px] text-slate-500 font-medium">3 Factor Alignment</span>
          {allAligned && (
            <span className={`ml-1 px-1.5 py-0.5 rounded text-[7px] font-extrabold animate-pulse ${isBuySignal ? 'bg-emerald-500/30 text-emerald-200 border border-emerald-400/50' : 'bg-red-500/30 text-red-200 border border-red-400/50'}`}>
              ALL ALIGNED
            </span>
          )}
          {!allAligned && hasVerdict && (
            <span className={`ml-1 px-1.5 py-0.5 rounded text-[7px] font-extrabold ${isBuySignal ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-red-500/20 text-red-300 border border-red-400/30'}`}>
              {alignment_score}/3 ALIGNED
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {[0, 1, 2].map(i => (
            <div key={i} className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${i < alignment_score
              ? allAligned
                ? (isBuySignal ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.6)]' : isSellSignal ? 'bg-red-400 shadow-[0_0_6px_rgba(239,68,68,0.6)]' : scoreBarColor)
                : scoreBarColor
              : 'bg-slate-700/60'
            }`} />
          ))}
          <span className={`text-[10px] font-mono font-bold ml-1 ${allAligned ? (isBuySignal ? 'text-emerald-200' : 'text-red-200') : scoreColor}`}>{alignment_score}/3</span>
        </div>
      </div>

      {/* 3 Factor Grid */}
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        {/* Factor 1: Location */}
        <div className={`rounded-lg border p-1.5 transition-all duration-500 ${factorCellClass('LOCATION')}`}>
          <div className="flex items-center gap-0.5 mb-1">
            <span className="text-[8px]">{zoneCfg.icon}</span>
            <span className={`text-[7px] font-bold ${allAligned ? (isBuySignal ? 'text-emerald-300' : isSellSignal ? 'text-red-300' : 'text-slate-400') : 'text-slate-400'}`}>LOCATION</span>
          </div>
          <span className={`text-[9px] font-bold block ${allAligned ? (isBuySignal ? 'text-emerald-200' : isSellSignal ? 'text-red-200' : zoneCfg.color) : zoneCfg.color}`}>{zoneCfg.label}</span>
          {location.vwap_position && (
            <span className={`text-[7px] block ${allAligned ? (isBuySignal ? 'text-emerald-400/80' : 'text-red-400/80') : 'text-slate-500'}`}>VWAP: {location.vwap_position}</span>
          )}
          {location.pdh != null && (
            <span className="text-[7px] text-slate-600 block">PDH: {location.pdh.toLocaleString('en-IN')}</span>
          )}
          {location.pdl != null && (
            <span className="text-[7px] text-slate-600 block">PDL: {location.pdl.toLocaleString('en-IN')}</span>
          )}
          <div className="mt-1">
            <span className={`inline-block px-1 py-0.5 rounded text-[6px] font-bold ${passBadgeClass('LOCATION')}`}>
              {factors_pass.includes('LOCATION') ? '✔ PASS' : '✘ FAIL'}
            </span>
          </div>
        </div>

        {/* Factor 2: Behavior */}
        <div className={`rounded-lg border p-1.5 transition-all duration-500 ${factorCellClass('BEHAVIOR')}`}>
          <div className="flex items-center gap-0.5 mb-1">
            <span className="text-[8px]">{behCfg.icon}</span>
            <span className={`text-[7px] font-bold ${allAligned ? (isBuySignal ? 'text-emerald-300' : isSellSignal ? 'text-red-300' : 'text-slate-400') : 'text-slate-400'}`}>BEHAVIOR</span>
          </div>
          <span className={`text-[9px] font-bold block ${allAligned ? (isBuySignal ? 'text-emerald-200' : isSellSignal ? 'text-red-200' : behCfg.color) : behCfg.color}`}>{behCfg.label}</span>
          <span className={`text-[7px] block truncate ${allAligned ? (isBuySignal ? 'text-emerald-400/70' : 'text-red-400/70') : 'text-slate-500'}`} title={behavior.description}>{behavior.description}</span>
          {behavior.strength > 0 && (
            <div className="mt-0.5">
              <div className="h-1 bg-slate-700/40 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${allAligned
                  ? (isBuySignal ? 'bg-emerald-400' : 'bg-red-400')
                  : (behavior.type === 'BREAKOUT' ? 'bg-emerald-500' : behavior.type === 'ABSORPTION' ? 'bg-blue-500' : 'bg-red-500')
                }`} style={{ width: `${behavior.strength}%` }} />
              </div>
            </div>
          )}
          <div className="mt-1">
            <span className={`inline-block px-1 py-0.5 rounded text-[6px] font-bold ${passBadgeClass('BEHAVIOR')}`}>
              {factors_pass.includes('BEHAVIOR') ? '✔ PASS' : '✘ FAIL'}
            </span>
          </div>
        </div>

        {/* Factor 3: Confirmation */}
        <div className={`rounded-lg border p-1.5 transition-all duration-500 ${factorCellClass('CONFIRMATION')}`}>
          <div className="flex items-center gap-0.5 mb-1">
            <span className="text-[8px]">📊</span>
            <span className={`text-[7px] font-bold ${allAligned ? (isBuySignal ? 'text-emerald-300' : isSellSignal ? 'text-red-300' : 'text-slate-400') : 'text-slate-400'}`}>CONFIRM</span>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-0.5">
              <span className={`text-[7px] ${confirmation.volume_confirmed ? (allAligned && isBuySignal ? 'text-emerald-200' : allAligned && isSellSignal ? 'text-red-200' : 'text-emerald-400') : 'text-red-400'}`}>
                {confirmation.volume_confirmed ? '✔' : '✘'}
              </span>
              <span className={`text-[7px] ${allAligned ? (isBuySignal ? 'text-emerald-300/80' : 'text-red-300/80') : 'text-slate-400'}`}>Vol</span>
              <span className={`text-[7px] font-mono font-bold ${confirmation.volume_ratio >= 1
                ? (allAligned && isBuySignal ? 'text-emerald-200' : allAligned && isSellSignal ? 'text-red-200' : 'text-emerald-400')
                : 'text-slate-500'
              }`}>
                {confirmation.volume_ratio.toFixed(1)}x
              </span>
            </div>
            <div className="flex items-center gap-0.5">
              <span className={`text-[7px] ${confirmation.body_strong ? (allAligned && isBuySignal ? 'text-emerald-200' : allAligned && isSellSignal ? 'text-red-200' : 'text-emerald-400') : 'text-red-400'}`}>
                {confirmation.body_strong ? '✔' : '✘'}
              </span>
              <span className={`text-[7px] ${allAligned ? (isBuySignal ? 'text-emerald-300/80' : 'text-red-300/80') : 'text-slate-400'}`}>Body</span>
            </div>
            <div className="flex items-center gap-0.5">
              <span className={`text-[7px] ${confirmation.close_near_extreme ? (allAligned && isBuySignal ? 'text-emerald-200' : allAligned && isSellSignal ? 'text-red-200' : 'text-emerald-400') : 'text-red-400'}`}>
                {confirmation.close_near_extreme ? '✔' : '✘'}
              </span>
              <span className={`text-[7px] ${allAligned ? (isBuySignal ? 'text-emerald-300/80' : 'text-red-300/80') : 'text-slate-400'}`}>Close</span>
            </div>
          </div>
          <div className="mt-1">
            <span className={`inline-block px-1 py-0.5 rounded text-[6px] font-bold ${passBadgeClass('CONFIRMATION')}`}>
              {factors_pass.includes('CONFIRMATION') ? '✔ PASS' : '✘ FAIL'}
            </span>
          </div>
        </div>
      </div>

      {/* Verdict Banner — strongest glow when aligned */}
      <div className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 transition-all duration-500 ${
        allAligned
          ? isBuySignal
            ? 'border-emerald-300/80 bg-gradient-to-r from-emerald-600/40 to-emerald-500/25 shadow-[0_0_20px_rgba(16,185,129,0.4)]'
            : isSellSignal
              ? 'border-red-300/80 bg-gradient-to-r from-red-600/40 to-red-500/25 shadow-[0_0_20px_rgba(239,68,68,0.4)]'
              : `${verdictCfg.border} ${verdictCfg.bg}`
          : `${verdictCfg.border} ${verdictCfg.bg}`
      }`}>
        <div className="flex items-center gap-1.5">
          <span className={`text-sm ${allAligned ? 'animate-pulse' : ''}`}>{verdictCfg.icon}</span>
          <span className={`text-xs font-extrabold ${allAligned ? (isBuySignal ? 'text-emerald-100' : isSellSignal ? 'text-red-100' : verdictCfg.color) : verdictCfg.color}`}>{verdictCfg.label}</span>
        </div>
        <span className={`text-[8px] max-w-[60%] text-right ${allAligned ? (isBuySignal ? 'text-emerald-300/80' : 'text-red-300/80') : 'text-slate-400'}`}>{reason}</span>
      </div>
    </div>
  );
});
ThreeFactorPanel.displayName = 'ThreeFactorPanel';

// ── Single Timeframe Candle Column ──────────────────────────────────────────
// Compact vertical panel showing ONE timeframe's live candle + signal + metrics.
// Three of these render side-by-side inside each CandleIntelCard.

const COMPACT_CANDLE_H = 64;

const TfCandleColumn = memo<{
  label: string;
  tfData: CandleIntelIndex;
  isActive: boolean;
  isDominant: boolean;
}>(({ label, tfData, isActive, isDominant }) => {
  const sigCfg = SIGNAL_CFG[tfData.signal] || SIGNAL_CFG.NEUTRAL;
  const structCfg = STRUCTURE_CFG[tfData.structure] || STRUCTURE_CFG.NEUTRAL;
  const strCfg = STRENGTH_CFG[tfData.strength] || STRENGTH_CFG.WEAK;
  const candle = tfData.candle;
  const isBull = candle?.is_bullish ?? true;

  // Candle proportions
  const bodyH = candle ? Math.max(4, candle.body_ratio * COMPACT_CANDLE_H) : 20;
  const upperH = candle ? Math.max(1, candle.upper_wick_ratio * COMPACT_CANDLE_H) : 8;
  const lowerH = candle ? Math.max(1, candle.lower_wick_ratio * COMPACT_CANDLE_H) : 8;

  const bodyBg = isBull ? 'bg-emerald-500' : 'bg-red-500';
  const wickBg = isBull ? 'bg-emerald-400/60' : 'bg-red-400/60';
  const glow   = isBull ? '0 0 10px rgba(16,185,129,0.35)' : '0 0 10px rgba(239,68,68,0.35)';
  const ping   = isBull ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)';

  const buyPressure = candle
    ? isBull ? Math.round(candle.body_ratio * 100) : Math.round((1 - candle.body_ratio) * 100)
    : 50;

  const confGrad = tfData.confidence >= 70
    ? 'from-emerald-500 to-emerald-400'
    : tfData.confidence >= 40
      ? 'from-amber-500 to-amber-400'
      : 'from-slate-500 to-slate-400';

  const colBorder = isDominant
    ? `${sigCfg.border} shadow-md ${sigCfg.glow}`
    : 'border-slate-700/30';

  return (
    <div className={`flex-1 min-w-0 rounded-xl border ${colBorder} bg-gradient-to-b from-slate-800/60 to-slate-900/50 p-2 flex flex-col items-center transition-all duration-300`}>
      {/* TF Header bar */}
      <div className="w-full flex items-center justify-between mb-1">
        <div className="flex items-center gap-1">
          <span className={`text-[10px] font-extrabold tracking-wider ${sigCfg.color}`}>{label}</span>
          <span className="text-[10px]">{sigCfg.icon}</span>
        </div>
        <span className={`text-[10px] font-mono font-bold ${sigCfg.color}`}>{tfData.confidence}%</span>
      </div>

      {/* Confidence bar */}
      <div className="w-full h-1 bg-slate-700/50 rounded-full overflow-hidden mb-1.5">
        <div className={`h-full bg-gradient-to-r ${confGrad} rounded-full transition-all duration-500`}
             style={{ width: `${tfData.confidence}%` }} />
      </div>

      {/* Signal badge */}
      <div className={`${sigCfg.bg} border ${sigCfg.border} rounded-md px-2 py-0.5 mb-2`}>
        <span className={`text-[9px] font-extrabold ${sigCfg.color}`}>{sigCfg.label}</span>
      </div>

      {/* ── Live Candlestick ── */}
      <div className="relative flex flex-col items-center my-1" style={{ minHeight: COMPACT_CANDLE_H }}>
        {isActive && (
          <span className="absolute -inset-2 rounded-full animate-ping opacity-15"
                style={{ background: ping }} />
        )}
        <div className={`${wickBg} rounded-full transition-all duration-700 ease-out`}
             style={{ width: 2, height: upperH }} />
        <div className={`${bodyBg} rounded-[3px] transition-all duration-700 ease-out`}
             style={{ width: 14, height: bodyH, boxShadow: isActive ? glow : 'none' }} />
        <div className={`${wickBg} rounded-full transition-all duration-700 ease-out`}
             style={{ width: 2, height: lowerH }} />
      </div>

      {/* Buy / Sell pressure */}
      <div className="w-full mt-1.5">
        <div className="flex justify-between mb-0.5">
          <span className="text-[6px] font-bold text-emerald-400">B {buyPressure}%</span>
          <span className="text-[6px] font-bold text-red-400">{100 - buyPressure}% S</span>
        </div>
        <div className="flex h-[3px] rounded-full overflow-hidden bg-slate-700/50">
          <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${buyPressure}%` }} />
          <div className="bg-red-500 transition-all duration-700" style={{ width: `${100 - buyPressure}%` }} />
        </div>
      </div>

      {/* Pattern chip */}
      {tfData.pattern ? (
        <span className={`mt-1.5 text-[7px] font-bold px-1.5 py-0.5 rounded text-center truncate max-w-full ${
          isBull
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
            : 'bg-red-500/15 text-red-400 border border-red-500/20'
        }`}>
          {PATTERN_ICONS[tfData.pattern] || '🕯️'} {patternDisplayName(tfData.pattern)}
        </span>
      ) : (
        <span className="mt-1.5 text-[7px] text-slate-500 italic">No pattern</span>
      )}

      {/* Structure + Strength */}
      <div className="flex items-center gap-1 mt-1">
        <span className={`text-[7px] font-bold ${structCfg.color}`}>{structCfg.icon}</span>
        <span className={`text-[7px] font-bold ${strCfg.color}`}>{strCfg.icon} {strCfg.label}</span>
      </div>

      {/* OHLC compact */}
      {candle && (
        <div className="w-full grid grid-cols-2 gap-x-1 gap-y-0 mt-1.5">
          <div className="flex justify-between">
            <span className="text-[6px] text-slate-500">O</span>
            <span className="text-[7px] font-mono text-slate-400 transition-all duration-500">{formatPrice(candle.open)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[6px] text-slate-500">H</span>
            <span className="text-[7px] font-mono text-emerald-400 transition-all duration-500">{formatPrice(candle.high)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[6px] text-slate-500">L</span>
            <span className="text-[7px] font-mono text-red-400 transition-all duration-500">{formatPrice(candle.low)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[6px] text-slate-500">C</span>
            <span className={`text-[7px] font-mono transition-all duration-500 ${isBull ? 'text-emerald-400' : 'text-red-400'}`}>
              {formatPrice(candle.close)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});
TfCandleColumn.displayName = 'TfCandleColumn';

// ── Index Card (one per symbol) ────────────────────────────────────────────────────
// Shows ALL 3 timeframes simultaneously — no tab switching needed.

const CandleIntelCard = memo<{ data: CandleIntelIndex | null; name: string }>(({ data, name }) => {
  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-gradient-to-br from-slate-800/60 to-slate-900/60 p-4">
        <div className="h-5 w-32 bg-slate-700/60 rounded mb-3 animate-pulse" />
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-slate-700/40 rounded-xl animate-pulse" />)}
        </div>
        <div className="space-y-2">
          {[...Array(2)].map((_, i) => <div key={i} className="h-3 bg-slate-700/30 rounded animate-pulse" />)}
        </div>
      </div>
    );
  }

  const isLive = data.dataSource === 'LIVE';
  const isPreOpen = data.dataSource === 'PRE_OPEN';
  const isFreeze = data.dataSource === 'FREEZE';
  const isActive = isLive || isPreOpen || isFreeze;

  // All 3 timeframes (fallback to top-level = 5m when backend hasn't sent TF data yet)
  const tf3m  = data.timeframes?.['3m']  ?? data;
  const tf5m  = data.timeframes?.['5m']  ?? data;
  const tf15m = data.timeframes?.['15m'] ?? data;

  // ── AI Multi-TF Consensus ──
  const allTfs = [tf3m, tf5m, tf15m];
  let bull = 0, bear = 0, maxConf = 0, dominantIdx = 1;
  allTfs.forEach((t, i) => {
    const s = t.signal;
    if (s === 'STRONG_BUY' || s === 'BUY') bull++;
    else if (s === 'STRONG_SELL' || s === 'SELL') bear++;
    if (t.confidence > maxConf) { maxConf = t.confidence; dominantIdx = i; }
  });

  const allAligned = bull === 3 || bear === 3;
  const majorityDir = bull >= 2 ? 'BULLISH' : bear >= 2 ? 'BEARISH' : 'MIXED';
  const consensusLabel = allAligned
    ? `ALL ${majorityDir}`
    : bull >= 2
      ? '2/3 BULLISH'
      : bear >= 2
        ? '2/3 BEARISH'
        : 'MIXED SIGNALS';
  const consensusDots = allAligned ? 3 : (bull >= 2 || bear >= 2) ? 2 : 1;
  const consensusDot = majorityDir === 'BULLISH' ? '🟢' : majorityDir === 'BEARISH' ? '🔴' : '🟡';
  const consensusColor = majorityDir === 'BULLISH'
    ? 'text-emerald-300 bg-emerald-500/15 border-emerald-400/40'
    : majorityDir === 'BEARISH'
      ? 'text-red-300 bg-red-500/15 border-red-400/40'
      : 'text-amber-300 bg-amber-500/15 border-amber-400/40';

  // Status from primary 5m structure
  const struct5m = tf5m.structure;
  const statusText = !isActive ? 'CLOSED' : isPreOpen ? 'PRE-OPEN' : isFreeze ? 'FREEZE'
    : struct5m.includes('BULLISH') ? 'BULLISH' : struct5m.includes('BEARISH') ? 'BEARISH' : 'LIVE';
  const statusColor = !isActive
    ? 'bg-slate-600/30 text-slate-400 border-slate-500/20'
    : struct5m.includes('BULLISH')
      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
      : struct5m.includes('BEARISH')
        ? 'bg-red-500/20 text-red-400 border-red-500/30'
        : 'bg-amber-500/20 text-amber-400 border-amber-500/30';

  // Card border from AI consensus
  const cardBorder = allAligned
    ? majorityDir === 'BULLISH'
      ? 'border-emerald-400/50 shadow-lg shadow-emerald-500/20'
      : majorityDir === 'BEARISH'
        ? 'border-red-400/50 shadow-lg shadow-red-500/20'
        : 'border-slate-600/40'
    : 'border-slate-600/40';

  // Primary 5M for combined sections
  const primary = tf5m;

  return (
    <div className={`rounded-2xl border ${cardBorder} bg-gradient-to-br from-slate-800/70 via-slate-900/70 to-slate-800/50 backdrop-blur-sm p-3 sm:p-4 transition-all duration-300`}>
      {/* ── Header: Symbol + Price + Change ── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm sm:text-base font-bold text-white">{name}</h3>
          <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold border ${statusColor}`}>
            {isActive ? '●' : '○'} {statusText}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-lg border ${data.changePct >= 0 ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-red-400/60 bg-red-500/10'}`}>
            <span className={`text-base sm:text-lg font-mono font-bold ${data.changePct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ₹{formatPrice(data.price)}
            </span>
          </span>
          {data.changePct !== 0 && (
            <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${data.changePct >= 0 ? 'text-emerald-400 bg-emerald-500/10' : 'text-red-400 bg-red-500/10'}`}>
              {data.changePct >= 0 ? '+' : ''}{data.changePct.toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* ── AI Multi-TF Consensus Banner ── */}
      <div className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 mb-3 ${consensusColor}`}>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px]">🧠</span>
          <span className="text-[9px] font-bold">AI Consensus</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px]">{Array.from({ length: consensusDots }, () => consensusDot).join('')}</span>
          <span className="text-[10px] font-extrabold">{consensusLabel}</span>
        </div>
      </div>

      {/* ── 3 Timeframe Columns: All Visible Simultaneously ── */}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 mb-3">
        <TfCandleColumn label="3M"  tfData={tf3m}  isActive={isActive} isDominant={dominantIdx === 0} />
        <TfCandleColumn label="5M"  tfData={tf5m}  isActive={isActive} isDominant={dominantIdx === 1} />
        <TfCandleColumn label="15M" tfData={tf15m} isActive={isActive} isDominant={dominantIdx === 2} />
      </div>

      {/* ── Detected Patterns (combined from primary 5M) ── */}
      <div className="rounded-lg bg-slate-800/30 border border-slate-700/20 p-2.5 mb-2">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-xs">🕯️</span>
            <span className="text-[10px] sm:text-xs font-bold text-white">Detected Patterns</span>
          </div>
          {primary.confluence > 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-400/30 font-bold">
              {primary.confluence}× Confluence
            </span>
          )}
        </div>
        <PatternBadges patterns={primary.all_patterns} primary={primary.pattern} />
      </div>

      {/* ── Trend Context (5M) ── */}
      <TrendContextMini ctx={primary.trend_context} />

      {/* ── 3FA: 3 Factor Alignment Model ── */}
      <ThreeFactorPanel tfa={primary.three_factor} />
    </div>
  );
});
CandleIntelCard.displayName = 'CandleIntelCard';

// ── Main Component ──────────────────────────────────────────────────────────

const CandleIntelligenceEngine = memo(() => {
  const { data, isConnected } = useCandleIntelligence();

  return (
    <div className="mt-6 sm:mt-6 border-2 border-orange-500/30 rounded-2xl p-3 sm:p-4 bg-gradient-to-br from-orange-950/20 via-dark-card/50 to-dark-elevated/40 backdrop-blur-sm shadow-md">
      <div className="flex flex-col gap-1 mb-3 sm:mb-4">
        <SectionTitle
          title="Candle Intelligence Engine"
          subtitle="23 Patterns × 3 Timeframes (3M · 5M · 15M) × Strength × Market Intent × Trade Signal"
          accentColor="amber"
          badge={
            <span className="relative inline-flex items-center px-2 py-0.5 text-[9px] font-bold bg-gradient-to-r from-orange-600/80 to-amber-600/80 rounded-md shadow-lg border border-orange-400/30 whitespace-nowrap leading-none">
              <span className="relative z-10 inline-flex items-center gap-0.5">
                <span>🕯️</span>
                <span className="bg-gradient-to-r from-white via-amber-100 to-white bg-clip-text text-transparent font-extrabold">CANDLE ENGINE</span>
              </span>
            </span>
          }
          rightContent={
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-sm shadow-emerald-500' : 'bg-red-500'}`} />
            </div>
          }
        />
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 sm:gap-4">
        <CandleIntelCard data={data.NIFTY} name="NIFTY 50" />
        <CandleIntelCard data={data.BANKNIFTY} name="BANK NIFTY" />
        <CandleIntelCard data={data.SENSEX} name="SENSEX" />
      </div>

      {/* Bottom Legend */}
      <div className="mt-3 pt-2 border-t border-slate-700/30">
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[9px] text-slate-500">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Strong Buy</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500/60" /> Buy</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" /> Neutral</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500/60" /> Sell</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Strong Sell</span>
          <span className="text-slate-600">|</span>
          <span>Pattern + Strength = Decision • O(1) per candle • 2s refresh</span>
        </div>
      </div>
    </div>
  );
});
CandleIntelligenceEngine.displayName = 'CandleIntelligenceEngine';

export default CandleIntelligenceEngine;

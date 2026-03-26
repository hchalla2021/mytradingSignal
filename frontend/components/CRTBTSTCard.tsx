/**
 * CRTBTSTCard — CRT-Based BTST Strategy Card
 * ══════════════════════════════════════════════
 * Displays full CRT analysis with 8-factor scoring, BTST signal,
 * candle structure visualization, key levels, and real-time updates.
 *
 * Sections:
 * 1. Header: Symbol + BTST Signal Badge + Live Status
 * 2. BTST Verdict: Signal, Confidence Gauge, Action
 * 3. Candle Structure: Visual candle with body/wick analysis
 * 4. 8-Factor CRT Scores: Individual factor cards
 * 5. Key Levels: PDH/PDL/PDC with current position
 * 6. Trade Setup: Entry window, target, stop-loss
 */

'use client';

import React, { memo, useMemo } from 'react';
import { useCRTBTSTRealtime } from '@/hooks/useCRTBTSTRealtime';
import type { CRTAnalysis, BTSTSignal, CRTFactors } from '@/lib/crt-engine';

interface CRTBTSTCardProps {
  symbol: string;
  name: string;
  data?: any;
}

// ── BTST percentage calc from 8-factor scores ─────────────────────────

function computeBTSTPct(factors: CRTFactors, totalScore: number, maxScore: number) {
  const scores = [
    factors.rangeExpansion.score,
    factors.sweepDetection.score,
    factors.closePosition.score,
    factors.displacement.score,
    factors.bodyWickRatio.score,
    factors.amdPattern.score,
    factors.rangeReclaim.score,
    factors.trendAlignment.score,
  ];
  const maxScores = [10, 10, 10, 8, 6, 6, 8, 8]; // per factor max

  // Bullish strength = sum of positive scores / sum of their max
  let bullishRaw = 0, bullishMax = 0, bearishRaw = 0, bearishMax = 0;
  scores.forEach((s, i) => {
    if (s > 0) { bullishRaw += s; bullishMax += maxScores[i]; }
    else if (s < 0) { bearishRaw += Math.abs(s); bearishMax += maxScores[i]; }
  });

  const bullishPct = bullishMax > 0 ? (bullishRaw / maxScore) * 100 : 0;
  const bearishPct = bearishMax > 0 ? (bearishRaw / maxScore) * 100 : 0;
  const neutralPct = Math.max(0, 100 - bullishPct - bearishPct);

  // Split BUY into Strong BUY + BUY based on score magnitude
  let strongBuyPct = 0, buyPct = 0, sellPct = 0, strongSellPct = 0;

  if (bullishPct > 0) {
    if (totalScore >= 35) { strongBuyPct = bullishPct; }
    else if (totalScore >= 18) { strongBuyPct = bullishPct * 0.3; buyPct = bullishPct * 0.7; }
    else { buyPct = bullishPct; }
  }
  if (bearishPct > 0) {
    if (totalScore <= -35) { strongSellPct = bearishPct; }
    else if (totalScore <= -18) { strongSellPct = bearishPct * 0.3; sellPct = bearishPct * 0.7; }
    else { sellPct = bearishPct; }
  }

  return {
    strongBuy: Math.round(strongBuyPct),
    buy: Math.round(buyPct),
    neutral: Math.round(neutralPct),
    sell: Math.round(sellPct),
    strongSell: Math.round(strongSellPct),
  };
}

// ── Signal Colors ──────────────────────────────────────────────────────

const SIGNAL_CONFIG: Record<BTSTSignal, {
  bg: string; border: string; text: string; glow: string; label: string; icon: string;
}> = {
  STRONG_BUY: {
    bg: 'from-emerald-900/40 to-emerald-950/60', border: 'border-emerald-400/50',
    text: 'text-emerald-300', glow: 'shadow-emerald-500/30', label: 'STRONG BUY', icon: '🚀',
  },
  BUY: {
    bg: 'from-green-900/30 to-green-950/50', border: 'border-green-400/40',
    text: 'text-green-300', glow: 'shadow-green-500/20', label: 'BUY', icon: '📈',
  },
  NEUTRAL: {
    bg: 'from-amber-900/30 to-amber-950/50', border: 'border-amber-400/40',
    text: 'text-amber-300', glow: 'shadow-amber-500/20', label: 'NEUTRAL', icon: '⚖️',
  },
  SELL: {
    bg: 'from-red-900/30 to-red-950/50', border: 'border-red-400/40',
    text: 'text-red-300', glow: 'shadow-red-500/20', label: 'SELL', icon: '📉',
  },
  STRONG_SELL: {
    bg: 'from-red-900/40 to-red-950/60', border: 'border-red-400/50',
    text: 'text-red-300', glow: 'shadow-red-500/30', label: 'STRONG SELL', icon: '🔻',
  },
};

// ── Helper Components ──────────────────────────────────────────────────

const formatPrice = (p: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(p);

/** Confidence gauge ring */
const ConfidenceGauge = memo<{ confidence: number; signal: BTSTSignal }>(({ confidence, signal }) => {
  const config = SIGNAL_CONFIG[signal];
  const radius = 32;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (confidence / 100) * circumference;

  let strokeColor = '#f59e0b'; // amber default
  if (signal === 'STRONG_BUY' || signal === 'BUY') strokeColor = '#10b981';
  else if (signal === 'STRONG_SELL' || signal === 'SELL') strokeColor = '#ef4444';

  return (
    <div className="relative w-20 h-20 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius} fill="none"
          stroke={strokeColor} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-lg font-black ${config.text}`}>{confidence}</span>
        <span className="text-[8px] text-slate-400 font-semibold tracking-wider">SCORE</span>
      </div>
    </div>
  );
});
ConfidenceGauge.displayName = 'ConfidenceGauge';

/** Visual Candle */
const CandleVisual = memo<{
  bodyPct: number; upperWickPct: number; lowerWickPct: number; isBullish: boolean; type: string;
}>(({ bodyPct, upperWickPct, lowerWickPct, isBullish, type }) => {
  const candleColor = isBullish ? '#10b981' : '#ef4444';
  const candleBg = isBullish ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)';

  return (
    <div className="flex items-center gap-3">
      {/* Candle stick visualization */}
      <div className="relative w-8 h-[72px] flex flex-col items-center" title={type}>
        {/* Upper wick */}
        <div
          className="w-[2px] rounded-full"
          style={{ height: `${Math.max(upperWickPct * 0.72, 2)}px`, backgroundColor: candleColor, opacity: 0.6 }}
        />
        {/* Body */}
        <div
          className="w-5 rounded-sm border"
          style={{
            height: `${Math.max(bodyPct * 0.72, 4)}px`,
            backgroundColor: isBullish ? candleColor : 'transparent',
            borderColor: candleColor,
            minHeight: '4px',
          }}
        />
        {/* Lower wick */}
        <div
          className="w-[2px] rounded-full"
          style={{ height: `${Math.max(lowerWickPct * 0.72, 2)}px`, backgroundColor: candleColor, opacity: 0.6 }}
        />
      </div>
      {/* Info */}
      <div className="flex-1">
        <p className={`text-xs font-bold ${isBullish ? 'text-emerald-400' : 'text-red-400'}`}>{type}</p>
        <div className="flex gap-2 mt-1">
          <span className="text-[10px] text-slate-400">Body <span className="text-slate-200 font-semibold">{bodyPct.toFixed(0)}%</span></span>
          <span className="text-[10px] text-slate-400">U.Wick <span className="text-slate-200 font-semibold">{upperWickPct.toFixed(0)}%</span></span>
          <span className="text-[10px] text-slate-400">L.Wick <span className="text-slate-200 font-semibold">{lowerWickPct.toFixed(0)}%</span></span>
        </div>
      </div>
    </div>
  );
});
CandleVisual.displayName = 'CandleVisual';

/** Single Factor Score Row */
const FactorRow = memo<{
  label: string; score: number; maxScore: number; description: string; icon: string;
}>(({ label, score, maxScore, description, icon }) => {
  const absPct = maxScore > 0 ? Math.min(Math.abs(score) / maxScore * 100, 100) : 0;
  const isPositive = score > 0;
  const isNeutral = score === 0;

  return (
    <div className="px-2.5 py-2 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:border-slate-600/50 transition-colors">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm flex-shrink-0">{icon}</span>
          <span className="text-[11px] font-semibold text-slate-200 truncate">{label}</span>
        </div>
        <span className={`text-[11px] font-black flex-shrink-0 ${
          isNeutral ? 'text-slate-400' : isPositive ? 'text-emerald-400' : 'text-red-400'
        }`}>
          {score > 0 ? '+' : ''}{score}
        </span>
      </div>
      {/* Score bar */}
      <div className="h-1.5 bg-slate-700/50 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isNeutral ? 'bg-slate-500' : isPositive ? 'bg-emerald-500' : 'bg-red-500'
          }`}
          style={{ width: `${Math.max(absPct, 3)}%` }}
        />
      </div>
      <p className="text-[9px] text-slate-500 mt-0.5 leading-tight truncate" title={description}>{description}</p>
    </div>
  );
});
FactorRow.displayName = 'FactorRow';

/** Key Level Row */
const LevelRow = memo<{
  label: string; value: number; currentPrice: number; color: string;
}>(({ label, value, currentPrice, color }) => {
  if (!value || value <= 0) return null;
  const diff = currentPrice - value;
  const diffPct = value > 0 ? (diff / value) * 100 : 0;
  const above = diff >= 0;

  return (
    <div className="flex items-center justify-between py-1 px-2 rounded bg-slate-800/30">
      <span className={`text-[10px] font-semibold ${color}`}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-mono text-slate-200">{formatPrice(value)}</span>
        <span className={`text-[9px] font-bold ${above ? 'text-emerald-400' : 'text-red-400'}`}>
          {above ? '▲' : '▼'} {Math.abs(diffPct).toFixed(2)}%
        </span>
      </div>
    </div>
  );
});
LevelRow.displayName = 'LevelRow';

// ── Main Card Component ────────────────────────────────────────────────

const CRTBTSTCard = memo<CRTBTSTCardProps>(({ symbol, name, data }) => {
  const { analysis, isLive, fromCache, loading, flash, factorSummary } = useCRTBTSTRealtime(symbol, data);

  // Hook must be called unconditionally (before any early returns)
  const btstPct = useMemo(() => {
    if (!analysis) return { strongBuy: 0, buy: 0, neutral: 100, sell: 0, strongSell: 0 };
    return computeBTSTPct(analysis.factors, analysis.btst.totalScore, analysis.btst.maxScore);
  }, [analysis]);

  // ── Loading State ─────────────────────────────────────────────────
  if (loading && !analysis) {
    return (
      <div className="rounded-2xl border border-slate-700/40 bg-gradient-to-br from-slate-800/60 to-slate-900/80 p-4 animate-pulse">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-5 w-24 bg-slate-700 rounded" />
          <div className="h-5 w-16 bg-slate-700 rounded-full" />
        </div>
        <div className="h-20 bg-slate-700/40 rounded-xl mb-3" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-slate-700/30 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="rounded-2xl border border-slate-700/40 bg-gradient-to-br from-slate-800/60 to-slate-900/80 p-5">
        <div className="text-center py-6">
          <span className="text-2xl mb-2 block">📊</span>
          <p className="text-slate-400 text-sm font-medium">{name}</p>
          <p className="text-slate-500 text-xs mt-1">Waiting for market data...</p>
        </div>
      </div>
    );
  }

  const { btst, factors, keyLevels, candleStructure, price } = analysis;
  const sc = SIGNAL_CONFIG[btst.signal];

  return (
    <div className={`rounded-2xl border ${sc.border} bg-gradient-to-br ${sc.bg} backdrop-blur-sm shadow-lg ${sc.glow} transition-all duration-300 ${flash ? 'ring-2 ring-cyan-400/60 ring-offset-1 ring-offset-slate-900' : ''} overflow-hidden`}>

      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="px-3 sm:px-4 pt-3 pb-2 flex items-center justify-between border-b border-slate-700/30">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{sc.icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-extrabold text-white tracking-tight truncate">{name}</h3>
            <p className="text-[10px] text-slate-400 font-mono">{symbol} • CRT-BTST</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Signal Badge */}
          <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${sc.text} bg-slate-800/60 border ${sc.border} shadow-sm`}>
            {sc.label}
          </span>
          {/* Live dot */}
          <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-400 animate-pulse shadow-emerald-400/50 shadow-md' : fromCache ? 'bg-amber-400' : 'bg-slate-500'}`} title={isLive ? 'Live' : fromCache ? 'Cached' : 'Offline'} />
        </div>
      </div>

      {/* ── BTST Signal % Strip ───────────────────────────────────────── */}
      <div className="px-3 sm:px-4 pt-2.5 pb-1">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase">Buy Today Sell Tomorrow</span>
          <span className="text-[9px] text-slate-600 font-mono">8-Factor Score</span>
        </div>
        <div className="flex items-center gap-1">
          {btstPct.strongBuy > 0 && (
            <div className="flex-1 min-w-0">
              <div className={`rounded-md border border-emerald-400/50 bg-emerald-900/40 px-1.5 py-1 text-center ${btstPct.strongBuy >= 70 ? 'btst-highlight-strong-buy' : btstPct.strongBuy >= 50 ? 'btst-highlight-buy' : ''}`}>
                <p className="text-[8px] text-emerald-400/80 font-bold uppercase leading-none mb-0.5">Strong BUY</p>
                <p className="text-sm font-black text-emerald-300">{btstPct.strongBuy}%</p>
              </div>
            </div>
          )}
          {btstPct.buy > 0 && (
            <div className="flex-1 min-w-0">
              <div className={`rounded-md border border-green-400/40 bg-green-900/30 px-1.5 py-1 text-center ${btstPct.buy >= 70 ? 'btst-highlight-strong-buy' : btstPct.buy >= 50 ? 'btst-highlight-buy' : ''}`}>
                <p className="text-[8px] text-green-400/80 font-bold uppercase leading-none mb-0.5">BUY-BTST</p>
                <p className="text-sm font-black text-green-300">{btstPct.buy}%</p>
              </div>
            </div>
          )}
          {btstPct.neutral > 0 && (
            <div className="flex-1 min-w-0">
              <div className="rounded-md border border-amber-500/30 bg-amber-900/20 px-1.5 py-1 text-center">
                <p className="text-[8px] text-amber-400/70 font-bold uppercase leading-none mb-0.5">NEUTRAL</p>
                <p className="text-sm font-black text-amber-300">{btstPct.neutral}%</p>
              </div>
            </div>
          )}
          {btstPct.sell > 0 && (
            <div className="flex-1 min-w-0">
              <div className={`rounded-md border border-red-400/40 bg-red-900/30 px-1.5 py-1 text-center ${btstPct.sell >= 70 ? 'btst-highlight-strong-sell' : btstPct.sell >= 50 ? 'btst-highlight-sell' : ''}`}>
                <p className="text-[8px] text-red-400/80 font-bold uppercase leading-none mb-0.5">SELL-BTST</p>
                <p className="text-sm font-black text-red-300">{btstPct.sell}%</p>
              </div>
            </div>
          )}
          {btstPct.strongSell > 0 && (
            <div className="flex-1 min-w-0">
              <div className={`rounded-md border border-red-400/50 bg-red-900/40 px-1.5 py-1 text-center ${btstPct.strongSell >= 70 ? 'btst-highlight-strong-sell' : btstPct.strongSell >= 50 ? 'btst-highlight-sell' : ''}`}>
                <p className="text-[8px] text-red-400/80 font-bold uppercase leading-none mb-0.5">Strong SELL</p>
                <p className="text-sm font-black text-red-300">{btstPct.strongSell}%</p>
              </div>
            </div>
          )}
        </div>
        {/* Combined bar */}
        <div className="flex h-1.5 rounded-full overflow-hidden mt-1.5 bg-slate-700/40">
          {btstPct.strongBuy > 0 && <div className="bg-emerald-400 transition-all duration-700" style={{ width: `${btstPct.strongBuy}%` }} />}
          {btstPct.buy > 0 && <div className="bg-green-400 transition-all duration-700" style={{ width: `${btstPct.buy}%` }} />}
          {btstPct.neutral > 0 && <div className="bg-amber-400/60 transition-all duration-700" style={{ width: `${btstPct.neutral}%` }} />}
          {btstPct.sell > 0 && <div className="bg-red-400 transition-all duration-700" style={{ width: `${btstPct.sell}%` }} />}
          {btstPct.strongSell > 0 && <div className="bg-red-500 transition-all duration-700" style={{ width: `${btstPct.strongSell}%` }} />}
        </div>
      </div>

      <div className="px-3 sm:px-4 py-3 space-y-3">

        {/* ── BTST Verdict ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <ConfidenceGauge confidence={btst.confidence} signal={btst.signal} />
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-bold ${sc.text} leading-snug`}>{btst.action}</p>
            <p className="text-[10px] text-slate-400 mt-1 leading-snug">{btst.reasoning[0]}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-lg font-black text-white font-mono">{formatPrice(price)}</span>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                btst.signal === 'STRONG_BUY' || btst.signal === 'BUY'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : btst.signal === 'STRONG_SELL' || btst.signal === 'SELL'
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-amber-500/20 text-amber-300'
              }`}>
                Risk: {btst.riskLevel}
              </span>
            </div>
          </div>
        </div>

        {/* ── Candle Structure ──────────────────────────────────────────── */}
        <div className="p-2.5 rounded-xl bg-slate-800/30 border border-slate-700/25">
          <p className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mb-1.5">Candle Structure</p>
          <CandleVisual
            bodyPct={candleStructure.bodyPct}
            upperWickPct={candleStructure.upperWickPct}
            lowerWickPct={candleStructure.lowerWickPct}
            isBullish={candleStructure.isBullish}
            type={candleStructure.type}
          />
        </div>

        {/* ── 8-Factor CRT Scores ──────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase">CRT 8-Factor Analysis</p>
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="text-emerald-400 font-bold">↑{factorSummary.bullish}</span>
              <span className="text-slate-500">•</span>
              <span className="text-red-400 font-bold">↓{factorSummary.bearish}</span>
              <span className="text-slate-500">•</span>
              <span className="text-slate-400 font-bold">—{factorSummary.neutral}</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <FactorRow icon="📐" label="Range Expansion" score={factors.rangeExpansion.score} maxScore={10} description={factors.rangeExpansion.label} />
            <FactorRow icon="🔍" label="PDH/PDL Sweep" score={factors.sweepDetection.score} maxScore={10} description={factors.sweepDetection.label} />
            <FactorRow icon="🎯" label="Close Position" score={factors.closePosition.score} maxScore={10} description={factors.closePosition.label} />
            <FactorRow icon="⚡" label="Displacement" score={factors.displacement.score} maxScore={8} description={factors.displacement.label} />
            <FactorRow icon="📊" label="Body:Wick Ratio" score={factors.bodyWickRatio.score} maxScore={6} description={factors.bodyWickRatio.label} />
            <FactorRow icon="🔄" label="AMD Pattern" score={factors.amdPattern.score} maxScore={6} description={factors.amdPattern.label} />
            <FactorRow icon="↩️" label="Range Reclaim" score={factors.rangeReclaim.score} maxScore={8} description={factors.rangeReclaim.label} />
            <FactorRow icon="📈" label="Trend Alignment" score={factors.trendAlignment.score} maxScore={8} description={factors.trendAlignment.label} />
          </div>
        </div>

        {/* ── Composite Score Bar ───────────────────────────────────────── */}
        <div className="p-2.5 rounded-xl bg-slate-800/30 border border-slate-700/25">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase">Composite Score</span>
            <span className={`text-xs font-black ${
              btst.totalScore >= 18 ? 'text-emerald-400' : btst.totalScore <= -18 ? 'text-red-400' : 'text-amber-400'
            }`}>
              {btst.totalScore > 0 ? '+' : ''}{btst.totalScore} / {btst.maxScore}
            </span>
          </div>
          {/* Centered score bar: -max to +max */}
          <div className="relative h-3 bg-slate-700/50 rounded-full overflow-hidden">
            {/* Center line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-px bg-slate-500/60 z-10" />
            {/* Score fill */}
            <div
              className={`absolute top-0 bottom-0 rounded-full transition-all duration-700 ${
                btst.totalScore >= 0 ? 'bg-emerald-500' : 'bg-red-500'
              }`}
              style={{
                left: btst.totalScore >= 0 ? '50%' : `${50 - (Math.abs(btst.totalScore) / btst.maxScore) * 50}%`,
                width: `${(Math.abs(btst.totalScore) / btst.maxScore) * 50}%`,
              }}
            />
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <span className="text-[8px] text-red-400/60">-{btst.maxScore}</span>
            <span className="text-[8px] text-slate-500">0</span>
            <span className="text-[8px] text-emerald-400/60">+{btst.maxScore}</span>
          </div>
        </div>

        {/* ── Key Levels ───────────────────────────────────────────────── */}
        <div>
          <p className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mb-1.5">Key CRT Levels</p>
          <div className="space-y-1">
            <LevelRow label="PDH (Prev Day High)" value={keyLevels.pdh} currentPrice={price} color="text-emerald-400" />
            <LevelRow label="PDL (Prev Day Low)" value={keyLevels.pdl} currentPrice={price} color="text-red-400" />
            <LevelRow label="PDC (Prev Close)" value={keyLevels.pdc} currentPrice={price} color="text-amber-400" />
            <LevelRow label="Today High" value={keyLevels.todayHigh} currentPrice={price} color="text-cyan-400" />
            <LevelRow label="Today Low" value={keyLevels.todayLow} currentPrice={price} color="text-pink-400" />
            <LevelRow label="Range Midpoint" value={keyLevels.midPoint} currentPrice={price} color="text-purple-400" />
          </div>
        </div>

        {/* ── Trade Setup ──────────────────────────────────────────────── */}
        <div className={`p-2.5 rounded-xl border ${sc.border} bg-slate-800/20`}>
          <p className="text-[9px] text-slate-500 font-semibold tracking-widest uppercase mb-2">BTST Trade Setup</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <div>
              <span className="text-[9px] text-slate-500">Entry Window</span>
              <p className="text-[11px] text-slate-200 font-semibold leading-tight">{btst.entryWindow}</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Target Gap</span>
              <p className={`text-[11px] font-semibold leading-tight ${
                btst.signal.includes('BUY') ? 'text-emerald-300' : btst.signal.includes('SELL') ? 'text-red-300' : 'text-amber-300'
              }`}>{btst.targetGap}</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Stop Loss</span>
              <p className="text-[11px] text-slate-200 font-semibold leading-tight">{btst.stopLoss}</p>
            </div>
            <div>
              <span className="text-[9px] text-slate-500">Risk Level</span>
              <p className={`text-[11px] font-bold leading-tight ${
                btst.riskLevel === 'LOW' ? 'text-emerald-300' : btst.riskLevel === 'HIGH' ? 'text-red-300' : 'text-amber-300'
              }`}>{btst.riskLevel}</p>
            </div>
          </div>

          {/* Additional reasoning */}
          {btst.reasoning.length > 1 && (
            <div className="mt-2 pt-2 border-t border-slate-700/30">
              <p className="text-[9px] text-slate-500 font-semibold mb-1">Key Drivers:</p>
              <ul className="space-y-0.5">
                {btst.reasoning.slice(0, 3).map((r, i) => (
                  <li key={i} className="text-[9px] text-slate-400 flex items-start gap-1">
                    <span className={`mt-0.5 w-1 h-1 rounded-full flex-shrink-0 ${
                      r.includes('↑') || r.includes('bullish') || r.includes('Bullish')
                        ? 'bg-emerald-400'
                        : r.includes('↓') || r.includes('bearish') || r.includes('Bearish')
                          ? 'bg-red-400'
                          : 'bg-slate-400'
                    }`} />
                    <span className="leading-tight">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ── Footer Status ────────────────────────────────────────────── */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-[8px] text-slate-600 font-mono">
            {isLive ? '● LIVE CRT' : fromCache ? '● CACHED' : '● OFFLINE'}
          </span>
          <span className="text-[8px] text-slate-600 font-mono">
            Score: {btst.totalScore}/{btst.maxScore} • Conf: {btst.confidence}%
          </span>
        </div>
      </div>
    </div>
  );
});

CRTBTSTCard.displayName = 'CRTBTSTCard';

export { CRTBTSTCard };
export default CRTBTSTCard;

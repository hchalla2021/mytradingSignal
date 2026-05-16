'use client';

import React, { memo, useEffect, useMemo, useState } from 'react';
import { useStrikeIntelligence, type StrikeSignal, type SymbolStrikeData } from '@/hooks/useStrikeIntelligence';
import { QuantumFractalPanel } from '@/components/StrikeIntelligence';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const SYMBOL_LABELS: Record<string, string> = {
  NIFTY:     'NIFTY 50',
  BANKNIFTY: 'BANK NIFTY',
  SENSEX:    'SENSEX',
};

type ConfluenceCheck = {
  name: string;
  pass: boolean;
  detail: string;
};

type ConfluenceState = {
  checks: ConfluenceCheck[];
  blockers: string[];
  passed: number;
  total: number;
  confluenceScore: number;
  action: 'LONG READY' | 'SHORT READY' | 'WAIT';
};

type FractalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

type ConvergenceMetrics = {
  confluenceScore: number;
  riskScore: number;
  rewardScore: number;
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  volatilityRisk: number;
  riskRewardRatio: number;
  drawdownRisk: number;
  profitFactor: number;
};

type FractalDeskRow = {
  symbol: typeof SYMBOLS[number];
  label: string;
  signal: StrikeSignal;
  score: number;
  confidence: number;
  alignment: number;
  continuation: number;
  probability: number;
  direction: FractalDirection;
  regime: 'EXPANSION' | 'COMPRESSION' | 'BALANCED';
  status: 'LIVE' | 'DELAYED' | 'OFFLINE';
  flowDepth: number;
};

type ConvergenceRow = FractalDeskRow & ConvergenceMetrics;

type SymbolFocus = 'ALL' | typeof SYMBOLS[number];
type FractalFilter = 'ALL' | 'LONG' | 'SHORT' | 'HIGH_CONF' | 'INSTITUTIONAL' | 'HIGH_RISK';

const FILTER_SEQUENCE: readonly FractalFilter[] = ['ALL', 'LONG', 'SHORT', 'HIGH_CONF', 'INSTITUTIONAL', 'HIGH_RISK'] as const;

const FILTER_LABELS: Record<FractalFilter, string> = {
  ALL: 'All Books',
  LONG: 'Long Bias',
  SHORT: 'Short Bias',
  HIGH_CONF: 'High Confidence',
  INSTITUTIONAL: 'Institutional Grade',
  HIGH_RISK: 'High Risk/Reward',
};

function isBuyerSignal(signal: StrikeSignal | undefined): boolean {
  return signal === 'BUY' || signal === 'STRONG_BUY';
}

function isSellerSignal(signal: StrikeSignal | undefined): boolean {
  return signal === 'SELL' || signal === 'STRONG_SELL';
}

function getDirection(signal: StrikeSignal, score: number, predictionMove: 'UP' | 'DOWN' | 'SIDEWAYS'): FractalDirection {
  const bullish = isBuyerSignal(signal) && (predictionMove === 'UP' || score >= 14);
  const bearish = isSellerSignal(signal) && (predictionMove === 'DOWN' || score <= -14);
  if (bullish) return 'LONG';
  if (bearish) return 'SHORT';
  return 'NEUTRAL';
}

function getFlowDepth(data: SymbolStrikeData | null): number {
  const fractal = data?.intelligence?.quantumFractal;
  if (!fractal) return 0;

  const raw = (
    Math.abs(fractal.components.trendStrength) +
    Math.abs(fractal.components.marketStructure) +
    Math.abs(fractal.components.volumeLiquidity) +
    Math.abs(fractal.components.directionalConfirmation) +
    Math.abs(fractal.fractalPressure)
  ) / 5;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

function buildDeskRow(symbol: typeof SYMBOLS[number], data: SymbolStrikeData | null): FractalDeskRow | null {
  const fractal = data?.intelligence?.quantumFractal;
  if (!fractal) return null;

  const status: FractalDeskRow['status'] = data?.dataSource === 'LIVE'
    ? 'LIVE'
    : data?.dataSource
    ? 'DELAYED'
    : 'OFFLINE';

  return {
    symbol,
    label: SYMBOL_LABELS[symbol],
    signal: fractal.signal,
    score: fractal.score,
    confidence: fractal.confidence,
    alignment: fractal.mtf.alignmentPct,
    continuation: fractal.continuationProbability,
    probability: fractal.prediction.probabilityPct,
    direction: getDirection(fractal.signal, fractal.score, fractal.prediction.nextMove),
    regime: fractal.volatilityRegime,
    status,
    flowDepth: getFlowDepth(data),
  };
}

function getSignalTone(signal: StrikeSignal): string {
  if (signal === 'STRONG_BUY' || signal === 'BUY') return 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10';
  if (signal === 'STRONG_SELL' || signal === 'SELL') return 'text-red-200 border-red-400/45 bg-red-500/10';
  return 'text-amber-200 border-amber-400/45 bg-amber-500/10';
}

function getDirectionTone(direction: FractalDirection): string {
  if (direction === 'LONG') return 'text-emerald-200 border-emerald-400/45 bg-emerald-500/10';
  if (direction === 'SHORT') return 'text-red-200 border-red-400/45 bg-red-500/10';
  return 'text-slate-200 border-slate-500/40 bg-slate-700/20';
}

function getStatusTone(status: FractalDeskRow['status']): string {
  if (status === 'LIVE') return 'text-emerald-300 border-emerald-400/40 bg-emerald-500/10';
  if (status === 'DELAYED') return 'text-amber-300 border-amber-400/40 bg-amber-500/10';
  return 'text-slate-300 border-slate-500/40 bg-slate-700/20';
}

function computeConvergenceMetrics(row: FractalDeskRow, data: SymbolStrikeData | null): ConvergenceMetrics {
  const fractal = data?.intelligence?.quantumFractal;
  if (!fractal) return {
    confluenceScore: 0,
    riskScore: 0,
    rewardScore: 0,
    executionProbability: 0,
    smartMoneyAlignment: 0,
    institutionalFlow: 0,
    volatilityRisk: 0,
    riskRewardRatio: 0,
    drawdownRisk: 0,
    profitFactor: 0,
  };

  const baseScore = Math.abs(row.score);
  const rawConfluence = (baseScore * 0.4) + (row.confidence * 0.3) + (row.alignment * 0.2) + (row.continuation * 0.1);
  const confluenceScore = Math.round(Math.min(100, Math.max(0, rawConfluence)));

  const volatilityRisk = fractal.volatilityRegime === 'EXPANSION' ? 35 : fractal.volatilityRegime === 'COMPRESSION' ? 15 : 25;
  const structureRisk = Math.max(0, 40 - Math.abs(fractal.components.marketStructure * 1.5));
  const riskScore = Math.round((volatilityRisk + structureRisk) / 2);

  const rewardPotential = (row.probability * 0.4) + (row.continuation * 0.3) + (baseScore * 0.2) + (row.alignment * 0.1);
  const rewardScore = Math.round(Math.min(100, Math.max(0, rewardPotential)));

  const execProb = (row.confidence * 0.35) + (row.alignment * 0.30) + (baseScore * 0.20) + (row.continuation * 0.15);
  const executionProbability = Math.round(Math.min(100, Math.max(0, execProb)));

  const smartMoneyAlign = (
    (data?.intelligence?.bullPressure ?? 0) * (row.direction === 'LONG' ? 1 : -1) +
    (data?.intelligence?.bearPressure ?? 0) * (row.direction === 'SHORT' ? 1 : -1)
  ) / 100;
  const smartMoneyAlignment = Math.round(Math.min(100, Math.max(0, 50 + (smartMoneyAlign * 25))));

  const flowMetrics = fractal.components.volumeLiquidity + fractal.components.directionalConfirmation;
  const institutionalFlow = Math.round(Math.min(100, Math.max(0, (flowMetrics / 40) * 100)));

  const riskRewardRatio = riskScore > 0 ? (rewardScore / riskScore) : 0;
  const drawdownRisk = Math.max(0, 100 - (row.alignment + row.continuation) / 2);
  const profitFactor = executionProbability > 0 ? (rewardScore / Math.max(1, riskScore)) : 0;

  return {
    confluenceScore,
    riskScore,
    rewardScore,
    executionProbability,
    smartMoneyAlignment,
    institutionalFlow,
    volatilityRisk,
    riskRewardRatio: Math.round(riskRewardRatio * 100) / 100,
    drawdownRisk: Math.round(drawdownRisk),
    profitFactor: Math.round(profitFactor * 100) / 100,
  };
}

function buildConvergenceRow(row: FractalDeskRow, data: SymbolStrikeData | null): ConvergenceRow {
  return {
    ...row,
    ...computeConvergenceMetrics(row, data),
  };
}

function filterRows(rows: FractalDeskRow[], focus: SymbolFocus, filter: FractalFilter): FractalDeskRow[] {
  return rows.filter((row) => {
    if (focus !== 'ALL' && row.symbol !== focus) return false;
    if (filter === 'LONG') return row.direction === 'LONG';
    if (filter === 'SHORT') return row.direction === 'SHORT';
    if (filter === 'HIGH_CONF') return row.confidence >= 72 && row.alignment >= 68;
    if (filter === 'INSTITUTIONAL') {
      const metrics = (row as any as ConvergenceRow);
      return metrics.executionProbability >= 70 && metrics.smartMoneyAlignment >= 65 && metrics.institutionalFlow >= 60;
    }
    if (filter === 'HIGH_RISK') {
      const metrics = (row as any as ConvergenceRow);
      return metrics.riskRewardRatio >= 1.5 && metrics.rewardScore >= 65;
    }
    return true;
  });
}

function getConfluenceState(data: SymbolStrikeData | null) {
  const fractal = data?.intelligence?.quantumFractal;
  if (!fractal) return null;

  const bullishBias = isBuyerSignal(fractal.signal) && fractal.prediction.nextMove === 'UP';
  const bearishBias = isSellerSignal(fractal.signal) && fractal.prediction.nextMove === 'DOWN';
  const directionalBias: FractalDirection = bullishBias ? 'LONG' : bearishBias ? 'SHORT' : 'NEUTRAL';

  const structureScore = directionalBias === 'SHORT'
    ? -fractal.components.marketStructure
    : fractal.components.marketStructure;
  const liquidityScore = directionalBias === 'SHORT'
    ? -fractal.components.volumeLiquidity
    : fractal.components.volumeLiquidity;
  const continuationScore = directionalBias === 'SHORT'
    ? 100 - fractal.continuationProbability
    : fractal.continuationProbability;
  const directionalProb = directionalBias === 'SHORT'
    ? (fractal.prediction.nextMove === 'DOWN' ? fractal.prediction.probabilityPct : 100 - fractal.prediction.probabilityPct)
    : fractal.prediction.probabilityPct;

  const checks = [
    {
      name: 'Directional signal',
      pass: directionalBias !== 'NEUTRAL',
      detail: fractal.signal,
    },
    {
      name: 'Confidence gate >= 70',
      pass: fractal.confidence >= 70,
      detail: `${fractal.confidence}%`,
    },
    {
      name: 'MTF alignment >= 68',
      pass: fractal.mtf.alignmentPct >= 68,
      detail: `${fractal.mtf.alignmentPct}%`,
    },
    {
      name: 'Prediction bias up >= 64',
      pass: directionalBias !== 'NEUTRAL' && directionalProb >= 64,
      detail: `${fractal.prediction.nextMove} ${fractal.prediction.probabilityPct}%`,
    },
    {
      name: 'Continuation >= 58',
      pass: continuationScore >= 58,
      detail: `${Math.round(continuationScore)}%`,
    },
    {
      name: 'Structure score >= 10',
      pass: structureScore >= 10,
      detail: `${Math.round(structureScore)}`,
    },
    {
      name: 'Liquidity score >= 8',
      pass: liquidityScore >= 8,
      detail: `${Math.round(liquidityScore)}`,
    },
    {
      name: 'Regime not compression',
      pass: fractal.volatilityRegime !== 'COMPRESSION',
      detail: fractal.volatilityRegime,
    },
  ];

  const blockers = [
    directionalBias === 'NEUTRAL' ? 'Directional engine has no clear bias' : null,
    fractal.prediction.nextMove === 'SIDEWAYS' && fractal.prediction.probabilityPct >= 55
      ? 'Predictive path is sideways-dominant'
      : null,
    data?.intelligence?.worldMarket?.bias === 'BEARISH' && (data.intelligence.worldMarket.influenceScore || 0) >= 65
      ? (directionalBias === 'LONG' ? 'Global risk overlay opposes long setup' : null)
      : null,
    data?.intelligence?.worldMarket?.bias === 'BULLISH' && (data.intelligence.worldMarket.influenceScore || 0) >= 65
      ? (directionalBias === 'SHORT' ? 'Global risk overlay opposes short setup' : null)
      : null,
  ].filter((item): item is string => Boolean(item));

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const confluenceScore = Math.round((passed / total) * 100);

  const canTrade = blockers.length === 0 && passed >= 7 && directionalBias !== 'NEUTRAL';
  const action = canTrade
    ? directionalBias === 'LONG'
      ? 'LONG READY'
      : 'SHORT READY'
    : 'WAIT';

  return {
    checks,
    blockers,
    passed,
    total,
    confluenceScore,
    action,
  };
}

function getActionTone(action: ConfluenceState['action']) {
  if (action === 'LONG READY') return 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10';
  if (action === 'SHORT READY') return 'text-red-200 border-red-500/40 bg-red-500/10';
  return 'text-amber-200 border-amber-500/40 bg-amber-500/10';
}

function getScoreTone(score: number) {
  if (score >= 87) return 'from-emerald-500 to-cyan-400';
  if (score >= 62) return 'from-amber-500 to-yellow-400';
  return 'from-rose-500 to-orange-400';
}

const ConfluenceCheckChip = memo<{ check: ConfluenceCheck }>(({ check }) => (
  <div className={`min-w-0 rounded-lg border px-3 py-2.5 ${check.pass ? 'border-emerald-500/30 bg-emerald-500/8' : 'border-rose-500/30 bg-rose-500/8'}`}>
    <div className="flex items-start justify-between gap-2">
      <span className="min-w-0 text-[11px] sm:text-[12px] text-slate-100 font-semibold leading-snug">{check.name}</span>
      <span className={`shrink-0 text-[10px] sm:text-[11px] font-black ${check.pass ? 'text-emerald-300' : 'text-rose-300'}`}>
        {check.pass ? 'PASS' : 'MISS'}
      </span>
    </div>
    <p className="mt-1.5 break-words text-[10px] sm:text-[11px] font-mono text-slate-300">{check.detail}</p>
  </div>
));

ConfluenceCheckChip.displayName = 'ConfluenceCheckChip';

const ConfluenceSymbolCard = memo<{
  symbol: typeof SYMBOLS[number];
  state: ConfluenceState;
}>(({ symbol, state }) => {
  const progressWidth = `${Math.max(0, Math.min(100, state.confluenceScore))}%`;

  return (
    <article className="min-w-0 h-full rounded-2xl border border-slate-700/40 bg-slate-950/55 p-3.5 shadow-lg shadow-slate-950/20">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex min-h-[2.2rem] items-center rounded-md border border-cyan-400/35 bg-cyan-500/10 px-3 py-1.5 text-[11px] sm:text-[13px] font-black tracking-[0.1em] text-cyan-200 uppercase">
              {SYMBOL_LABELS[symbol]}
            </span>
            <span className={`inline-flex min-h-[2.2rem] min-w-[7.3rem] justify-center items-center rounded-md border px-3 py-1.5 text-[11px] sm:text-[12px] font-black tracking-[0.08em] transition-colors duration-100 motion-reduce:transition-none ${getActionTone(state.action)}`}>
              {state.action}
            </span>
          </div>
        </div>
        <div className="shrink-0 min-w-[8.4rem] rounded-xl border border-slate-700/45 bg-slate-900/80 px-3.5 py-2.5 text-right">
          <p className="text-[10px] sm:text-[11px] uppercase tracking-[0.1em] text-slate-400">Confluence</p>
          <p className="mt-1 text-[18px] sm:text-[20px] font-black font-mono tabular-nums text-slate-100">{state.confluenceScore}%</p>
          <p className="text-[10px] sm:text-[11px] font-mono tabular-nums text-slate-300">{state.passed}/{state.total} gates</p>
        </div>
      </div>

      <div className="mt-3">
        <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
          <div
            className={`h-full rounded-full bg-gradient-to-r ${getScoreTone(state.confluenceScore)} transition-[width,background-color] duration-150 ease-linear motion-reduce:transition-none`}
            style={{ width: progressWidth }}
          />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {state.checks.map((check) => (
          <ConfluenceCheckChip key={check.name} check={check} />
        ))}
      </div>

    </article>
  );
});

ConfluenceSymbolCard.displayName = 'ConfluenceSymbolCard';

const ConfluenceHeatmapCell = memo<{
  value: number;
  label: string;
  maxValue?: number;
  suffix?: string;
}>(({ value, label, maxValue = 100, suffix = '' }) => {
  const pct = Math.min(100, (value / maxValue) * 100);
  const bgColor = value >= 75 ? 'bg-emerald-500/25' : value >= 50 ? 'bg-cyan-500/20' : value >= 35 ? 'bg-amber-500/15' : 'bg-rose-500/15';
  const textColor = value >= 75 ? 'text-emerald-200' : value >= 50 ? 'text-cyan-200' : value >= 35 ? 'text-amber-200' : 'text-rose-200';

  return (
    <div className={`rounded-xl border px-3 py-2.5 overflow-hidden ${bgColor} border-slate-700/45 relative`}>
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-200" />
      <div className="relative">
        <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <p className={`mt-1 text-lg font-black font-mono tabular-nums ${textColor}`}>
          {Math.round(value)}{suffix}
        </p>
        <div className="mt-1.5 h-1 rounded-full bg-slate-800/60 overflow-hidden">
          <div className={`h-full rounded-full bg-gradient-to-r ${value >= 75 ? 'from-emerald-500 to-cyan-400' : value >= 50 ? 'from-cyan-500 to-blue-400' : value >= 35 ? 'from-amber-500 to-orange-400' : 'from-rose-500 to-red-400'} transition-[width] duration-300`} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
});

ConfluenceHeatmapCell.displayName = 'ConfluenceHeatmapCell';

const RiskRewardMatrix = memo<{ convergenceRows: ConvergenceRow[] }>(({ convergenceRows }) => {
  const maxReward = Math.max(...convergenceRows.map((r) => r.rewardScore), 50);
  const maxRisk = Math.max(...convergenceRows.map((r) => r.riskScore), 50);

  return (
    <div className="rounded-2xl border border-slate-700/35 bg-slate-950/70 p-4 overflow-hidden">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300 mb-4">Risk / Reward Distribution</p>
      <div className="relative h-[280px] border border-slate-700/50 rounded-xl bg-slate-900/50 p-4 overflow-auto">
        <svg width="100%" height="280" className="absolute inset-0" style={{ minWidth: '400px' }}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(100,116,139,0.1)" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          <line x1="40" y1="260" x2="360" y2="260" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />
          <line x1="40" y1="260" x2="40" y2="20" stroke="rgba(148,163,184,0.3)" strokeWidth="1" />
          {convergenceRows.map((row, idx) => {
            const x = 50 + (row.riskScore / maxRisk) * 300;
            const y = 250 - (row.rewardScore / maxReward) * 220;
            const color = row.direction === 'LONG' ? '#10b981' : row.direction === 'SHORT' ? '#ef4444' : '#94a3b8';
            return (
              <g key={idx}>
                <circle cx={x} cy={y} r="5" fill={color} opacity="0.6" />
                <circle cx={x} cy={y} r="7" fill="none" stroke={color} strokeWidth="1.5" opacity="0.3" />
              </g>
            );
          })}
        </svg>
        <div className="relative z-10 text-[8px] text-slate-500 pointer-events-none">
          <span className="absolute bottom-2 left-2">0 Risk</span>
          <span className="absolute bottom-2 right-2">High Risk</span>
          <span className="absolute top-2 left-0 -rotate-90 origin-left">Low Reward</span>
          <span className="absolute top-2 right-0 -rotate-90 origin-right">High Reward</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Long Setup</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500" /> Short Setup</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-500" /> Neutral</span>
      </div>
    </div>
  );
});

RiskRewardMatrix.displayName = 'RiskRewardMatrix';

const InstitutionalConvergenceBoard = memo<{ convergenceRows: ConvergenceRow[] }>(({ convergenceRows }) => {
  const avgConfluence = convergenceRows.length ? Math.round(convergenceRows.reduce((sum, r) => sum + r.confluenceScore, 0) / convergenceRows.length) : 0;
  const avgExecution = convergenceRows.length ? Math.round(convergenceRows.reduce((sum, r) => sum + r.executionProbability, 0) / convergenceRows.length) : 0;
  const avgSmartMoney = convergenceRows.length ? Math.round(convergenceRows.reduce((sum, r) => sum + r.smartMoneyAlignment, 0) / convergenceRows.length) : 0;
  const avgInstitutional = convergenceRows.length ? Math.round(convergenceRows.reduce((sum, r) => sum + r.institutionalFlow, 0) / convergenceRows.length) : 0;
  const bestRiskReward = convergenceRows.length ? Math.max(...convergenceRows.map((r) => r.riskRewardRatio)) : 0;
  const institutionalGradeCount = convergenceRows.filter((r) => r.executionProbability >= 70 && r.smartMoneyAlignment >= 65).length;

  return (
    <div className="rounded-2xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/15 via-slate-950/85 to-slate-900/80 p-4 sm:p-5 lg:p-6 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.12),transparent_40%)]" />
      <div className="relative">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-1 h-6 rounded-full bg-gradient-to-b from-indigo-400 to-purple-500/40" />
              <h3 className="text-[13px] sm:text-[16px] font-black uppercase tracking-[0.16em] text-indigo-200">Institutional Convergence Board</h3>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-[9px] sm:text-[10px] font-black text-emerald-300 uppercase tracking-[0.12em]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> {institutionalGradeCount} INSTITUTIONAL
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            <ConfluenceHeatmapCell value={avgConfluence} label="Confluence" />
            <ConfluenceHeatmapCell value={avgExecution} label="Exec Probability" />
            <ConfluenceHeatmapCell value={avgSmartMoney} label="Smart Money" />
            <ConfluenceHeatmapCell value={avgInstitutional} label="Inst. Flow" />
            <ConfluenceHeatmapCell value={bestRiskReward} label="Best R:R" maxValue={3} suffix="x" />
            <div className="rounded-xl border border-slate-700/45 bg-slate-900/65 px-3 py-2.5">
              <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Status</p>
              <p className={`mt-1 text-sm font-black ${avgExecution >= 70 && avgSmartMoney >= 65 ? 'text-emerald-300' : avgExecution >= 55 ? 'text-amber-300' : 'text-slate-300'}`}>
                {avgExecution >= 70 && avgSmartMoney >= 65 ? 'LIVE' : avgExecution >= 55 ? 'ACTIVE' : 'WATCH'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

InstitutionalConvergenceBoard.displayName = 'InstitutionalConvergenceBoard';

const InstitutionalConfluenceCard = memo<{ convergenceRow: ConvergenceRow }>(({ convergenceRow }) => {
  const riskColor = convergenceRow.riskScore <= 35 ? 'text-emerald-300' : convergenceRow.riskScore <= 55 ? 'text-amber-300' : 'text-red-300';
  const rewardColor = convergenceRow.rewardScore >= 65 ? 'text-emerald-300' : convergenceRow.rewardScore >= 45 ? 'text-cyan-300' : 'text-slate-300';
  const execColor = convergenceRow.executionProbability >= 70 ? 'text-emerald-300' : convergenceRow.executionProbability >= 55 ? 'text-amber-300' : 'text-slate-300';

  return (
    <div className="rounded-2xl border border-slate-700/45 bg-slate-950/70 p-3.5 overflow-hidden group hover:border-slate-600/60 transition-colors duration-200">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-100">{convergenceRow.label}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-black uppercase ${getDirectionTone(convergenceRow.direction)}`}>
              {convergenceRow.direction}
            </span>
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[8px] font-black uppercase ${getStatusTone(convergenceRow.status)}`}>
              {convergenceRow.status}
            </span>
          </div>
        </div>
        <div className="text-right">
          <p className={`text-[16px] font-black font-mono leading-none ${convergenceRow.confluenceScore >= 75 ? 'text-emerald-300' : convergenceRow.confluenceScore >= 50 ? 'text-cyan-300' : 'text-slate-300'}`}>
            {convergenceRow.confluenceScore}%
          </p>
          <p className="text-[9px] font-mono text-slate-400 mt-1">confluence</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 text-[9px] mb-3">
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
          <p className="text-slate-500">Reward</p>
          <p className={`font-black ${rewardColor}`}>{convergenceRow.rewardScore}%</p>
        </div>
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
          <p className="text-slate-500">Risk</p>
          <p className={`font-black ${riskColor}`}>{convergenceRow.riskScore}%</p>
        </div>
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
          <p className="text-slate-500">R:R</p>
          <p className="font-black text-violet-300">{convergenceRow.riskRewardRatio.toFixed(1)}x</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[9px]">
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
          <p className="text-slate-500">Exec</p>
          <p className={`font-black ${execColor}`}>{convergenceRow.executionProbability}%</p>
        </div>
        <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
          <p className="text-slate-500">SmartMoney</p>
          <p className="font-black text-cyan-300">{convergenceRow.smartMoneyAlignment}%</p>
        </div>
      </div>
    </div>
  );
});

InstitutionalConfluenceCard.displayName = 'InstitutionalConfluenceCard';

const FractalCommandDeck = memo<{
  rows: FractalDeskRow[];
  visibleRows: FractalDeskRow[];
  focus: SymbolFocus;
  filter: FractalFilter;
  onFocusChange: (next: SymbolFocus) => void;
  onFilterChange: (next: FractalFilter) => void;
}>(({ rows, visibleRows, focus, filter, onFocusChange, onFilterChange }) => {
  const avgConfidence = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.confidence, 0) / rows.length) : 0;
  const avgAlignment = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.alignment, 0) / rows.length) : 0;
  const avgFlowDepth = rows.length ? Math.round(rows.reduce((sum, row) => sum + row.flowDepth, 0) / rows.length) : 0;
  const netScore = rows.reduce((sum, row) => sum + row.score, 0);
  const liveBooks = rows.filter((row) => row.status === 'LIVE').length;
  const longCount = visibleRows.filter((row) => row.direction === 'LONG').length;
  const shortCount = visibleRows.filter((row) => row.direction === 'SHORT').length;

  return (
    <div className="relative overflow-hidden rounded-[1.5rem] border border-cyan-500/25 bg-gradient-to-br from-cyan-950/18 via-slate-950/90 to-slate-900/85 p-4 sm:p-5 lg:p-6 shadow-[0_12px_36px_rgba(8,47,73,0.35)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.15),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(6,182,212,0.12),transparent_34%)]" />
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="h-6 w-1 rounded-full bg-gradient-to-b from-cyan-400 to-cyan-600/40" />
              <h3 className="text-[13px] sm:text-[16px] font-black uppercase tracking-[0.16em] text-cyan-200">Quantum Command Deck</h3>
            </div>
            <p className="mt-2 text-[11px] sm:text-[12px] leading-relaxed text-slate-300">
              Real-time multi-timeframe fractal intelligence with desk-level directional filtering, confluence gating, and execution readiness controls.
            </p>
          </div>
          <div className="rounded-xl border border-slate-700/45 bg-slate-900/65 px-3 py-2.5">
            <p className="text-[8px] font-black uppercase tracking-[0.18em] text-slate-500">Shortcuts</p>
            <p className="mt-1 text-[10px] font-mono text-slate-300">0 all · 1/2/3 symbol · F filter · R reset</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Net Score</p>
            <p className={`mt-1 text-lg font-black font-mono ${netScore >= 25 ? 'text-emerald-300' : netScore <= -25 ? 'text-red-300' : 'text-amber-300'}`}>{netScore > 0 ? '+' : ''}{netScore}</p>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Confidence</p>
            <p className="mt-1 text-lg font-black font-mono text-cyan-300">{avgConfidence}%</p>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Alignment</p>
            <p className="mt-1 text-lg font-black font-mono text-violet-300">{avgAlignment}%</p>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Flow Depth</p>
            <p className="mt-1 text-lg font-black font-mono text-amber-300">{avgFlowDepth}</p>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Live Books</p>
            <p className="mt-1 text-lg font-black font-mono text-emerald-300">{liveBooks}/{rows.length}</p>
          </div>
          <div className="rounded-xl border border-slate-800/55 bg-slate-900/65 p-2.5">
            <p className="text-[8px] font-bold uppercase tracking-[0.14em] text-slate-500">Visible Bias</p>
            <p className="mt-1 text-sm font-black text-slate-100">L {longCount} · S {shortCount}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {([{ value: 'ALL', label: 'ALL' }, ...SYMBOLS.map((sym) => ({ value: sym, label: SYMBOL_LABELS[sym] }))] as const).map((entry) => {
            const active = focus === entry.value;
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => onFocusChange(entry.value as SymbolFocus)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors duration-100 ${active ? 'border-cyan-400/55 bg-cyan-500/12 text-cyan-100' : 'border-slate-600/45 bg-slate-900/60 text-slate-300 hover:text-slate-100'}`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTER_SEQUENCE.map((entry) => {
            const active = filter === entry;
            return (
              <button
                key={entry}
                type="button"
                onClick={() => onFilterChange(entry)}
                aria-pressed={active}
                className={`rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.12em] transition-colors duration-100 ${active ? 'border-indigo-400/55 bg-indigo-500/15 text-indigo-100' : 'border-slate-600/45 bg-slate-900/60 text-slate-300 hover:text-slate-100'}`}
              >
                {FILTER_LABELS[entry]}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {visibleRows.map((row) => (
            <div key={row.symbol} className="rounded-2xl border border-slate-700/45 bg-slate-950/70 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-100">{row.label}</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] ${getSignalTone(row.signal)}`}>{row.signal.replace('_', ' ')}</span>
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] ${getDirectionTone(row.direction)}`}>{row.direction}</span>
                    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.1em] ${getStatusTone(row.status)}`}>{row.status}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-[17px] font-black font-mono leading-none ${row.score >= 14 ? 'text-emerald-300' : row.score <= -14 ? 'text-red-300' : 'text-amber-300'}`}>{row.score > 0 ? '+' : ''}{row.score}</p>
                  <p className="mt-1 text-[10px] font-mono font-black text-cyan-300">{row.confidence}%</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[9px]">
                <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
                  <p className="text-slate-500">Align</p>
                  <p className="mt-0.5 font-black text-violet-300">{row.alignment}%</p>
                </div>
                <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
                  <p className="text-slate-500">Prob</p>
                  <p className="mt-0.5 font-black text-cyan-300">{row.probability}%</p>
                </div>
                <div className="rounded-lg border border-slate-800/60 bg-slate-900/70 px-2 py-1.5">
                  <p className="text-slate-500">Flow</p>
                  <p className="mt-0.5 font-black text-amber-300">{row.flowDepth}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

FractalCommandDeck.displayName = 'FractalCommandDeck';

const InstitutionalConfluenceEngine = memo<{ strikeData: ReturnType<typeof useStrikeIntelligence>['strikeData'] }>(({ strikeData }) => {
  const convergenceRows = useMemo(() => {
    return SYMBOLS
      .map((sym) => {
        const deskRow = buildDeskRow(sym, strikeData[sym]);
        if (!deskRow) return null;
        return buildConvergenceRow(deskRow, strikeData[sym]);
      })
      .filter((item): item is ConvergenceRow => item !== null);
  }, [strikeData]);

  const confluenceSymbols = useMemo(() => {
    return SYMBOLS
      .map((sym) => {
        const state = getConfluenceState(strikeData[sym]);
        return { sym, state };
      })
      .filter((item) => item.state !== null) as Array<{
        sym: typeof SYMBOLS[number];
        state: ConfluenceState;
      }>;
  }, [strikeData]);

  if (!convergenceRows.length) {
    return (
      <div className="relative mt-6 overflow-hidden rounded-[1.6rem] border border-indigo-500/25 bg-gradient-to-br from-indigo-950/20 via-slate-950/80 to-slate-900/80 p-4 shadow-xl shadow-indigo-500/10 sm:p-5 lg:p-6">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.14),transparent_38%)]" />
        <div className="relative">
          <h3 className="text-[13px] sm:text-[16px] uppercase tracking-[0.14em] font-black text-indigo-100 leading-tight">
            Institutional Confluence Engine
          </h3>
          <p className="mt-3 text-[11px] sm:text-[12px] text-slate-300 leading-relaxed">
            Waiting for strike intelligence stream. This panel will auto-populate when backend
            endpoint /api/strike-intelligence is reachable and live/cached payload arrives.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-6 overflow-hidden rounded-[1.6rem] border border-indigo-500/30 bg-gradient-to-br from-indigo-950/25 via-slate-950/90 to-slate-900/85 p-4 shadow-xl shadow-indigo-500/10 sm:p-5 lg:p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(99,102,241,0.16),transparent_38%),radial-gradient(circle_at_bottom_left,rgba(14,165,233,0.08),transparent_34%)]" />
      <div className="relative flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-indigo-400 to-cyan-500/50" />
              <h3 className="text-[14px] sm:text-[18px] uppercase tracking-[0.14em] font-black text-indigo-100 leading-tight">
                Institutional Confluence Engine
              </h3>
            </div>
            <p className="mt-2 text-[11px] sm:text-[12px] text-slate-300">Enterprise-grade confluence analytics with risk/reward matrix, execution probability, and smart money alignment.</p>
          </div>
        </div>

        <InstitutionalConvergenceBoard convergenceRows={convergenceRows} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <RiskRewardMatrix convergenceRows={convergenceRows} />
          <div className="rounded-2xl border border-slate-700/35 bg-slate-950/70 p-4 overflow-y-auto max-h-[380px]">
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300 mb-3 sticky top-0 bg-slate-950/70 pb-2">Convergence Signals</p>
            <div className="flex flex-col gap-2.5">
              {confluenceSymbols.slice(0, 6).map(({ sym, state }) => (
                <div key={sym} className="rounded-lg border border-slate-700/40 bg-slate-900/50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black text-cyan-300 uppercase">{SYMBOL_LABELS[sym]}</span>
                    <span className={`text-[11px] font-black px-1.5 py-0.5 rounded ${state.action === 'LONG READY' ? 'text-emerald-300 bg-emerald-500/20' : state.action === 'SHORT READY' ? 'text-red-300 bg-red-500/20' : 'text-amber-300 bg-amber-500/20'}`}>
                      {state.action}
                    </span>
                  </div>
                  <div className="mt-1.5 flex gap-1.5 text-[8px]">
                    <span className="text-slate-400">Conf: <span className="text-slate-200 font-bold">{state.confluenceScore}%</span></span>
                    <span className="text-slate-400">Gates: <span className="text-slate-200 font-bold">{state.passed}/{state.total}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-700/40 bg-slate-900/45 p-3.5 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300 mb-3">Convergence Cards (Executive Desk)</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {convergenceRows.map((row) => (
              <InstitutionalConfluenceCard key={row.symbol} convergenceRow={row} />
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700/40 bg-slate-900/45 p-3.5 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-300 mb-3">Confluence Gate Analysis</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {confluenceSymbols.map(({ sym, state }) => (
              <ConfluenceSymbolCard key={sym} symbol={sym} state={state} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
});

InstitutionalConfluenceEngine.displayName = 'InstitutionalConfluenceEngine';

const QuantumFractalSection = memo(() => {
  const { strikeData } = useStrikeIntelligence();
  const [focus, setFocus] = useState<SymbolFocus>('ALL');
  const [filter, setFilter] = useState<FractalFilter>('ALL');

  const deskRows = useMemo(
    () => SYMBOLS.map((sym) => buildDeskRow(sym, strikeData[sym])).filter((row): row is FractalDeskRow => row !== null),
    [strikeData],
  );

  const filteredRows = useMemo(
    () => filterRows(deskRows, focus, filter),
    [deskRows, focus, filter],
  );

  const visibleSymbols = useMemo(
    () => new Set(filteredRows.map((row) => row.symbol)),
    [filteredRows],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      if (tagName === 'input' || tagName === 'textarea' || target?.isContentEditable) return;

      if (event.key === '0') {
        setFocus('ALL');
        return;
      }
      if (event.key === '1') {
        setFocus('NIFTY');
        return;
      }
      if (event.key === '2') {
        setFocus('BANKNIFTY');
        return;
      }
      if (event.key === '3') {
        setFocus('SENSEX');
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        setFilter((prev) => {
          const currentIndex = FILTER_SEQUENCE.indexOf(prev);
          return FILTER_SEQUENCE[(currentIndex + 1) % FILTER_SEQUENCE.length];
        });
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        setFocus('ALL');
        setFilter('ALL');
      }
    };

    window.addEventListener('keydown', onKeyDown, { passive: true });
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const hasAny = SYMBOLS.some((sym) => strikeData[sym]?.intelligence?.quantumFractal);
  if (!hasAny) {
    return (
      <section className="w-full mt-6 mb-2 min-w-0">
        <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/15 via-slate-950/85 to-slate-900/85 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-cyan-600/40 shrink-0" />
            <h2 className="text-[13px] sm:text-[16px] uppercase tracking-[0.18em] font-black text-cyan-300/95 leading-none">
              Quantum Fractal Intelligence Engine
            </h2>
            <span className="inline-flex items-center rounded border border-amber-500/35 bg-amber-500/10 px-2 py-1 text-[9px] sm:text-[10px] font-black text-amber-200 tracking-[0.14em] uppercase shrink-0">
              WAITING DATA
            </span>
          </div>
          <p className="mt-3 text-[11px] sm:text-[12px] text-slate-300 leading-relaxed">
            No fractal payload yet. Verify backend /api/strike-intelligence and websocket
            /ws/strike-intelligence are available. Section will render automatically when data arrives.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {SYMBOLS.map((symbol) => (
              <div key={symbol} className="rounded-xl border border-slate-700/45 bg-slate-900/50 p-3 animate-pulse">
                <div className="h-4 w-24 rounded bg-slate-700/70" />
                <div className="mt-3 h-3 w-full rounded bg-slate-700/60" />
                <div className="mt-2 h-3 w-[85%] rounded bg-slate-700/60" />
                <div className="mt-2 h-3 w-[65%] rounded bg-slate-700/60" />
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full mt-6 mb-2 min-w-0">

      {/* ── Section header ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5 px-0.5">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Decorative left bar */}
            <div className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-cyan-600/40 shrink-0" />
            <h2 className="text-[13px] sm:text-[16px] uppercase tracking-[0.18em] font-black text-cyan-300/95 leading-none">
              Quantum Fractal Intelligence Engine
            </h2>
          </div>
          <p className="text-[11px] sm:text-[12px] text-slate-400 leading-relaxed pl-4">
            Multi-timeframe fractal analysis · Institutional momentum · Predictive behavior modeling
          </p>
        </div>

        {/* Live indicator */}
        <div className="flex items-center gap-2 shrink-0 self-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/8 px-3 py-1.5 text-[10px] sm:text-[11px] font-bold text-emerald-300 tracking-[0.1em] uppercase">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            LIVE
          </span>
        </div>
      </div>

      <FractalCommandDeck
        rows={deskRows}
        visibleRows={filteredRows}
        focus={focus}
        filter={filter}
        onFocusChange={setFocus}
        onFilterChange={setFilter}
      />

      {/* ── Cards grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {SYMBOLS.map((sym) => {
          const fractal = strikeData[sym]?.intelligence?.quantumFractal;
          if (!fractal || !visibleSymbols.has(sym)) return null;
          return (
            <div key={sym} className="min-w-0">
              <QuantumFractalPanel fractal={fractal} symbol={SYMBOL_LABELS[sym]} />
            </div>
          );
        })}
      </div>

      <InstitutionalConfluenceEngine strikeData={strikeData} />
    </section>
  );
});

QuantumFractalSection.displayName = 'QuantumFractalSection';
export default QuantumFractalSection;


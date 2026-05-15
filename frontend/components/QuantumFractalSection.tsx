'use client';

import React, { memo } from 'react';
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
  action: 'BUY READY' | 'WAIT';
};

function isBuyerSignal(signal: StrikeSignal | undefined): boolean {
  return signal === 'BUY' || signal === 'STRONG_BUY';
}

function isSellerSignal(signal: StrikeSignal | undefined): boolean {
  return signal === 'SELL' || signal === 'STRONG_SELL';
}

function getConfluenceState(data: SymbolStrikeData | null) {
  const fractal = data?.intelligence?.quantumFractal;
  if (!fractal) return null;

  const checks = [
    {
      name: 'Directional signal',
      pass: isBuyerSignal(fractal.signal),
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
      pass: fractal.prediction.nextMove === 'UP' && fractal.prediction.probabilityPct >= 64,
      detail: `${fractal.prediction.nextMove} ${fractal.prediction.probabilityPct}%`,
    },
    {
      name: 'Continuation >= 58',
      pass: fractal.continuationProbability >= 58,
      detail: `${fractal.continuationProbability}%`,
    },
    {
      name: 'Structure score >= 10',
      pass: fractal.components.marketStructure >= 10,
      detail: `${fractal.components.marketStructure}`,
    },
    {
      name: 'Liquidity score >= 8',
      pass: fractal.components.volumeLiquidity >= 8,
      detail: `${fractal.components.volumeLiquidity}`,
    },
    {
      name: 'Regime not compression',
      pass: fractal.volatilityRegime !== 'COMPRESSION',
      detail: fractal.volatilityRegime,
    },
  ];

  const blockers = [
    isSellerSignal(fractal.signal) ? 'Primary engine is bearish' : null,
    fractal.prediction.nextMove === 'DOWN' && fractal.prediction.probabilityPct >= 60
      ? 'Predictive path is down-dominant'
      : null,
    data?.intelligence?.worldMarket?.bias === 'BEARISH' && (data.intelligence.worldMarket.influenceScore || 0) >= 65
      ? 'Global risk overlay is bearish'
      : null,
  ].filter((item): item is string => Boolean(item));

  const passed = checks.filter((c) => c.pass).length;
  const total = checks.length;
  const confluenceScore = Math.round((passed / total) * 100);

  const canTrade = blockers.length === 0 && passed >= 7;
  const action = canTrade ? 'BUY READY' : 'WAIT';

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
  return action === 'BUY READY'
    ? 'text-emerald-200 border-emerald-500/40 bg-emerald-500/10'
    : 'text-amber-200 border-amber-500/40 bg-amber-500/10';
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

const InstitutionalConfluenceEngine = memo<{ strikeData: ReturnType<typeof useStrikeIntelligence>['strikeData'] }>(({ strikeData }) => {
  const symbols = SYMBOLS
    .map((sym) => {
      const state = getConfluenceState(strikeData[sym]);
      return { sym, state };
    })
    .filter((item) => item.state !== null) as Array<{
      sym: typeof SYMBOLS[number];
      state: ConfluenceState;
    }>;

  if (!symbols.length) {
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
      <div className="relative flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="h-6 w-1 shrink-0 rounded-full bg-gradient-to-b from-indigo-400 to-cyan-500/50" />
              <h3 className="text-[14px] sm:text-[18px] uppercase tracking-[0.14em] font-black text-indigo-100 leading-tight">
                Institutional Confluence Engine
              </h3>
            </div>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-700/40 bg-slate-900/45 p-3.5 sm:p-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {symbols.map(({ sym, state }) => (
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

      {/* ── Cards grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {SYMBOLS.map((sym) => {
          const fractal = strikeData[sym]?.intelligence?.quantumFractal;
          if (!fractal) return null;
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


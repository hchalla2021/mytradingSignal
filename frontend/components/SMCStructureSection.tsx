'use client';

import React, { useState } from 'react';
import {
  useSMCStructure,
  SMCIndexData,
  SMCVerdict,
  SMCBias,
} from '@/hooks/useSMCStructure';

// ── Small display helpers ─────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, nd = 2): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(nd);

const fmtZone = (zone: (number | null)[] | null): string =>
  zone && zone[0] != null && zone[1] != null ? `${fmt(zone[0])} – ${fmt(zone[1])}` : '—';

const verdictMeta: Record<SMCVerdict, { label: string; cls: string; bar: string }> = {
  STRONG_BUY: { label: 'STRONG BUY', cls: 'border-emerald-300/60 bg-emerald-500/20 text-emerald-100', bar: 'bg-emerald-400' },
  BUY: { label: 'BUY', cls: 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200', bar: 'bg-emerald-500' },
  NEUTRAL: { label: 'NEUTRAL', cls: 'border-amber-400/40 bg-amber-500/10 text-amber-200', bar: 'bg-amber-400' },
  SELL: { label: 'SELL', cls: 'border-rose-400/40 bg-rose-500/10 text-rose-200', bar: 'bg-rose-500' },
  STRONG_SELL: { label: 'STRONG SELL', cls: 'border-rose-300/60 bg-rose-500/20 text-rose-100', bar: 'bg-rose-400' },
};

const biasCls = (b: SMCBias): string =>
  b === 'BULLISH' ? 'text-emerald-300' : b === 'BEARISH' ? 'text-rose-300' : 'text-amber-300';

const chip = (text: string, cls: string, key?: string) => (
  <span key={key ?? text} className={`rounded border px-1.5 py-0.5 text-[9px] font-black tracking-wide whitespace-nowrap ${cls}`}>
    {text}
  </span>
);

// ── Probability bar ───────────────────────────────────────────────────────────

function ProbBar({ probs }: { probs: SMCIndexData['probabilities'] }) {
  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div className="bg-emerald-500/80" style={{ width: `${probs.continuation}%` }} />
        <div className="bg-slate-500/60" style={{ width: `${probs.chop}%` }} />
        <div className="bg-rose-500/80" style={{ width: `${probs.reversal}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-bold text-slate-400">
        <span className="text-emerald-300">CONT {probs.continuation}%</span>
        <span>CHOP {probs.chop}%</span>
        <span className="text-rose-300">REV {probs.reversal}%</span>
      </div>
    </div>
  );
}

function PredictionPanel({ prediction }: { prediction: NonNullable<SMCIndexData['prediction']> }) {
  const directionTone = prediction.direction === 'UP'
    ? 'text-emerald-300'
    : prediction.direction === 'DOWN' ? 'text-rose-300' : 'text-amber-300';
  const directionMark = prediction.direction === 'UP' ? '▲' : prediction.direction === 'DOWN' ? '▼' : '•';
  const magnetLabel = prediction.magnet
    ? `${prediction.magnet.kind} @ ${fmt(prediction.magnet.level)}`
    : 'No clean liquidity target';

  return (
    <div className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-2 text-[10px]">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-black tracking-wide text-cyan-200">NEXT MOVE OUTLOOK</span>
        <span className={`font-black ${directionTone}`}>
          {directionMark} {prediction.direction} · {prediction.conviction}% · {prediction.horizonMinutes}m
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-slate-300">
        <div><span className="text-slate-500">Primary draw</span> <span className="font-bold text-cyan-200">{magnetLabel}</span></div>
        <div><span className="text-slate-500">Next window</span> <span className="font-bold text-slate-200">{prediction.timing.nextWindow}</span></div>
        <div><span className="text-slate-500">5m / 15m</span> <span className="font-bold">{fmt(prediction.projection.m5.expected)} / {fmt(prediction.projection.m15.expected)}</span></div>
        <div><span className="text-slate-500">Stops</span> <span className="font-bold">above {fmt(prediction.traderMap.buyStopsAbove)} · below {fmt(prediction.traderMap.sellStopsBelow)}</span></div>
      </div>
      <div className="mt-1 text-slate-400">{prediction.note}</div>
      {prediction.sequence.length > 0 && (
        <div className="mt-1 flex flex-col gap-0.5">
          {prediction.sequence.slice(0, 3).map(step => (
            <div key={step.step} className="flex gap-1 text-slate-300">
              <span className="font-black text-cyan-400">{step.step}.</span>
              <span>{step.event} <span className="text-slate-500">({step.probability}%)</span></span>
            </div>
          ))}
        </div>
      )}
      {prediction.trapRisk.level >= 45 && (
        <div className="mt-1 rounded border border-orange-400/30 bg-orange-500/10 px-1.5 py-1 text-orange-200">
          Trap risk {prediction.trapRisk.level}%{prediction.trapRisk.side ? ` · ${prediction.trapRisk.side.replace('_', ' ')}` : ''}: {prediction.trapRisk.note}
        </div>
      )}
      {prediction.earlyWarnings.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {prediction.earlyWarnings.slice(0, 3).map(warning => (
            <span key={warning.signal} className={`rounded border px-1.5 py-0.5 font-bold ${
              warning.urgency === 'HIGH'
                ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                : warning.urgency === 'MEDIUM'
                  ? 'border-amber-400/40 bg-amber-500/10 text-amber-200'
                  : 'border-slate-600/60 bg-slate-800/60 text-slate-300'
            }`}>
              {warning.signal.replaceAll('_', ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Per-index card ────────────────────────────────────────────────────────────

function SMCCard({ row }: { row: SMCIndexData }) {
  const [open, setOpen] = useState(false);
  const vm = verdictMeta[row.verdict] ?? verdictMeta.NEUTRAL;
  const plan = row.tradePlan;
  const ltf = row.structure.ltf;
  const htf = row.structure.htf;
  const dr = row.dealingRange;
  const trap = row.liquidity.sweeps.find(s => s.trapConfirmed);

  const riskTone =
    plan.riskScore >= 65 ? 'text-rose-300' : plan.riskScore >= 45 ? 'text-amber-300' : 'text-emerald-300';

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-950/80 p-3 flex flex-col gap-2.5">
      {/* Header: symbol + price + verdict */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm font-black tracking-wide text-slate-100">{row.symbol}</span>
          <span className="font-mono text-xs font-bold text-slate-300">{fmt(row.metrics.price)}</span>
          <span className={`font-mono text-[10px] font-bold ${(row.metrics.changePct ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
            {(row.metrics.changePct ?? 0) >= 0 ? '+' : ''}{fmt(row.metrics.changePct)}%
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-black ${vm.cls}`}>{vm.label}</span>
          <span className="rounded-md border border-slate-600/60 bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-black text-slate-200">
            {row.confidence}%
          </span>
        </div>
      </div>

      <ProbBar probs={row.probabilities} />

      {/* Structure + location row */}
      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1.5">
          <div className="text-slate-500 font-bold">STRUCTURE 15m / 5m</div>
          <div className="font-black">
            <span className={biasCls(htf.bias)}>{htf.bias}</span>
            <span className="text-slate-500"> / </span>
            <span className={biasCls(ltf.bias)}>{ltf.bias}</span>
            {row.structure.aligned && <span className="ml-1 text-cyan-300">✓ ALIGNED</span>}
          </div>
          {ltf.lastEvent && (
            <div className="mt-0.5 font-mono text-slate-400">
              {ltf.lastEvent.type} {ltf.lastEvent.direction === 'BULLISH' ? '▲' : '▼'} @ {fmt(ltf.lastEvent.level)}
              {ltf.lastEvent.displacement ? ' ⚡' : ''}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 px-2 py-1.5">
          <div className="text-slate-500 font-bold">DEALING RANGE</div>
          <div className={`font-black ${dr.zone === 'DISCOUNT' ? 'text-emerald-300' : dr.zone === 'PREMIUM' ? 'text-rose-300' : 'text-amber-300'}`}>
            {dr.zone} {dr.positionPct != null ? `· ${dr.positionPct}%` : ''}
          </div>
          <div className="mt-0.5 font-mono text-slate-400">
            EQ {fmt(dr.equilibrium)} · {fmt(dr.low, 0)}–{fmt(dr.high, 0)}
          </div>
        </div>
      </div>

      {/* Context chips */}
      <div className="flex flex-wrap gap-1">
        {chip(`${row.regime.market} · ${row.regime.volatility}`, 'border-blue-400/40 bg-blue-500/10 text-blue-200')}
        {chip(row.session.name.replaceAll('_', ' '), 'border-purple-400/40 bg-purple-500/10 text-purple-200')}
        {chip(`${row.intent.phase} ${row.intent.direction === 'NEUTRAL' ? '' : row.intent.direction === 'BULLISH' ? '▲' : '▼'}`,
          row.intent.direction === 'BULLISH' ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
            : row.intent.direction === 'BEARISH' ? 'border-rose-400/40 bg-rose-500/10 text-rose-200'
              : 'border-slate-600/60 bg-slate-800/60 text-slate-300')}
        {trap && chip('🪤 TRAP CONFIRMED', 'border-orange-400/50 bg-orange-500/15 text-orange-200')}
        {row.liquidity.inducement && chip('🎣 INDUCEMENT', 'border-yellow-400/40 bg-yellow-500/10 text-yellow-200')}
        {row.smt.state !== 'IN_SYNC' && row.smt.state !== 'NO_PEER_DATA' &&
          chip(`SMT: ${row.smt.state.replaceAll('_', ' ')}`, 'border-cyan-400/40 bg-cyan-500/10 text-cyan-200')}
        {row.behavior.absorption && chip('🧲 ABSORPTION', 'border-teal-400/40 bg-teal-500/10 text-teal-200')}
        {row.behavior.exhaustion && chip('⛽ EXHAUSTION', 'border-pink-400/40 bg-pink-500/10 text-pink-200')}
      </div>

      {row.prediction && <PredictionPanel prediction={row.prediction} />}

      {/* Trade plan */}
      <div className="rounded-lg border border-slate-700/70 bg-slate-900/70 p-2 text-[10px]">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-black text-slate-300">TRADE PLAN</span>
          <span className={`font-black ${riskTone}`}>RISK {plan.riskScore}/100</span>
        </div>
        {plan.entryZone ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono">
            <div><span className="text-slate-500">Entry</span> <span className="text-cyan-200 font-bold">{fmtZone(plan.entryZone)}</span></div>
            <div><span className="text-slate-500">SL</span> <span className="text-rose-300 font-bold">{fmt(plan.stopLoss)}</span></div>
            <div><span className="text-slate-500">T1</span> <span className="text-emerald-300 font-bold">{fmt(plan.targets[0]?.level)}</span> <span className="text-slate-500">{plan.targets[0]?.label ?? ''}</span></div>
            <div><span className="text-slate-500">T2</span> <span className="text-emerald-300 font-bold">{fmt(plan.targets[1]?.level)}</span> <span className="text-slate-500">{plan.targets[1]?.label ?? ''}</span></div>
            <div><span className="text-slate-500">Invalidation</span> <span className="text-amber-200 font-bold">{fmt(plan.invalidation)}</span></div>
            <div><span className="text-slate-500">R:R</span> <span className="text-slate-200 font-bold">{plan.riskReward != null ? `1:${fmt(plan.riskReward)}` : '—'}</span></div>
          </div>
        ) : (
          <div className="text-slate-400 font-semibold">{plan.entryNote}</div>
        )}
        {plan.entryZone && <div className="mt-1 text-slate-500">{plan.entryNote}</div>}
      </div>

      {/* Expand: zones, liquidity, factors, reasoning */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full rounded-md border border-slate-700/60 bg-slate-900/60 py-1 text-[10px] font-black text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 transition-colors"
      >
        {open ? '▲ HIDE INSTITUTIONAL DETAIL' : '▼ ORDER BLOCKS · LIQUIDITY MAP · REASONING'}
      </button>

      {open && (
        <div className="flex flex-col gap-2 text-[10px]">
          {/* Liquidity pools */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
            <div className="mb-1 font-black text-slate-400">LIQUIDITY POOLS (draw targets)</div>
            <div className="flex flex-col gap-0.5 font-mono">
              {row.liquidity.pools.length === 0 && <span className="text-slate-500">No mapped pools yet</span>}
              {row.liquidity.pools.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className={p.side === 'BSL' ? 'text-emerald-300' : 'text-rose-300'}>
                    {p.side === 'BSL' ? '▲' : '▼'} {p.kind} <span className="text-slate-500">({p.scope})</span>
                    {p.swept ? <span className="text-orange-300"> · swept</span> : ''}
                  </span>
                  <span className="text-slate-300">{fmt(p.level)} <span className="text-slate-500">({p.distancePct != null ? `${p.distancePct > 0 ? '+' : ''}${p.distancePct}%` : '—'})</span></span>
                </div>
              ))}
            </div>
          </div>

          {/* Zones */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
            <div className="mb-1 font-black text-slate-400">ORDER BLOCKS & FVG</div>
            <div className="flex flex-col gap-0.5 font-mono">
              {row.zones.orderBlocks.map((o, i) => (
                <div key={`ob-${i}`} className="flex items-center justify-between">
                  <span className={o.side === 'DEMAND' ? 'text-emerald-300' : 'text-rose-300'}>
                    OB {o.side} <span className="text-slate-500">[{o.state}]</span>
                  </span>
                  <span className="text-slate-300">{fmt(o.low)} – {fmt(o.high)}</span>
                </div>
              ))}
              {row.zones.fvgs.map((g, i) => (
                <div key={`fvg-${i}`} className="flex items-center justify-between">
                  <span className={g.side === 'BULLISH' ? 'text-emerald-300/80' : 'text-rose-300/80'}>
                    FVG {g.side} <span className="text-slate-500">[{g.state}]</span>
                  </span>
                  <span className="text-slate-300">{fmt(g.low)} – {fmt(g.high)}</span>
                </div>
              ))}
              {row.zones.bpr && (
                <div className="flex items-center justify-between">
                  <span className="text-violet-300">BPR</span>
                  <span className="text-slate-300">{fmt(row.zones.bpr.low)} – {fmt(row.zones.bpr.high)}</span>
                </div>
              )}
              {row.zones.orderBlocks.length === 0 && row.zones.fvgs.length === 0 && (
                <span className="text-slate-500">No active zones near price</span>
              )}
            </div>
          </div>

          {/* Factor weights */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
            <div className="mb-1 font-black text-slate-400">FACTOR SCORES (regime-weighted)</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {Object.entries(row.factors).map(([name, f]) => (
                <div key={name}>
                  <div className="flex justify-between font-mono">
                    <span className="text-slate-400">{name.toUpperCase()} <span className="text-slate-600">×{(f.weight * 100).toFixed(0)}%</span></span>
                    <span className={f.score > 0.08 ? 'text-emerald-300' : f.score < -0.08 ? 'text-rose-300' : 'text-slate-400'}>
                      {f.score > 0 ? '+' : ''}{fmt(f.score)}
                    </span>
                  </div>
                  <div className="h-1 w-full rounded bg-slate-800">
                    <div
                      className={`h-1 rounded ${f.score >= 0 ? 'bg-emerald-400/70' : 'bg-rose-400/70'}`}
                      style={{ width: `${Math.min(100, Math.abs(f.score) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Reasoning */}
          <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
            <div className="mb-1 font-black text-slate-400">WHY (engine reasoning)</div>
            <ul className="flex flex-col gap-0.5 text-slate-300">
              {row.reasoning.map((r, i) => (
                <li key={i} className="flex gap-1"><span className="text-slate-600">•</span><span>{r}</span></li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

export default function SMCStructureSection() {
  const { data, isConnected, lastUpdate } = useSMCStructure();
  const rows = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const)
    .map(sym => data[sym])
    .filter((r): r is SMCIndexData => r !== null);

  return (
    <section
      aria-label="Advanced SMC and Market Structure"
      className="mb-3 rounded-xl border border-indigo-400/20 bg-gradient-to-br from-slate-950 via-slate-900/80 to-indigo-950/20 px-3 py-3 sm:px-4"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-[13px] sm:text-[16px] font-extrabold tracking-tight text-indigo-100">
            🏛️ ADVANCED SMC & MARKET STRUCTURE
          </span>
          <span className="rounded-full border border-indigo-300/40 bg-indigo-500/10 px-2 py-0.5 text-[9px] font-black text-indigo-100">
            HTF+LTF · BOS/CHoCH/MSS · OB/FVG · LIQUIDITY MAP
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black ${
            isConnected
              ? 'border-emerald-300/40 bg-emerald-500/10 text-emerald-200'
              : 'border-amber-300/40 bg-amber-500/10 text-amber-200'
          }`}>
            {isConnected ? '● LIVE STREAM' : '○ POLLING'}
          </span>
          <span className="rounded-full border border-slate-600/50 bg-slate-800/60 px-2 py-0.5 text-[9px] font-black text-slate-300">
            PROBABILISTIC · NO REPAINT
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-slate-700/50 bg-slate-900/50 px-3 py-4 text-center text-xs font-semibold text-slate-400">
          Building structure map… engine needs ~1 hour of 5m candles after market open.
          {lastUpdate === null && ' Waiting for first data frame.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {rows.map(row => <SMCCard key={row.symbol} row={row} />)}
        </div>
      )}

      <p className="mt-2 text-[9px] font-medium text-slate-500">
        Institutional-behavior model on closed candles only — swings need 2-bar confirmation, events never repaint.
        Outputs are probabilities, not certainties; size risk off the invalidation level.
      </p>
    </section>
  );
}

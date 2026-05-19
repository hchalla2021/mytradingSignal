'use client';

import React, { useMemo } from 'react';
import type { MarketTick } from '@/hooks/useMarketSocket';

type IndexKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface FIIDIIFlowStripProps {
  marketData: Partial<Record<IndexKey, MarketTick | null | undefined>>;
  isConnected: boolean;
}

const fmtCr = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1000) return `${(v / 1000).toFixed(2)}K Cr`;
  return `${v.toFixed(0)} Cr`;
};

type Tone = 'bull' | 'bear' | 'neutral';

const FlowTile = ({
  label,
  flowLabel,
  amountCr,
  strength,
  tone,
  hint,
  hot,
}: {
  label: string;
  flowLabel: string;
  amountCr: number;
  strength: number;
  tone: Tone;
  hint: string;
  hot?: boolean;
}) => {
  const toneMap = {
    bull: { border: 'border-emerald-400/20', text: 'text-emerald-300', bar: 'from-emerald-400/80 to-emerald-500/80', arrow: '▲', ring: 'ring-1 ring-emerald-300/50 border-emerald-300/40' },
    bear: { border: 'border-rose-400/20', text: 'text-rose-300', bar: 'from-rose-400/80 to-rose-500/80', arrow: '▼', ring: 'ring-1 ring-rose-300/50 border-rose-300/40' },
    neutral: { border: 'border-amber-400/15', text: 'text-amber-300', bar: 'from-amber-400/80 to-amber-500/80', arrow: '◆', ring: 'ring-1 ring-amber-200/50 border-amber-200/40' },
  }[tone];
  return (
    <div className={`relative rounded-lg border bg-slate-950/50 px-3 py-2 transition-all ${hot ? toneMap.ring : toneMap.border}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className={`text-[11px] font-black ${toneMap.text}`}>{toneMap.arrow} {flowLabel}</span>
      </div>
      <p className={`mt-1 font-mono text-lg font-black leading-tight lg:text-xl ${toneMap.text}`}>
        {amountCr >= 0 ? '+' : '−'}₹{fmtCr(Math.abs(amountCr))}
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800/70">
        <div className={`h-full rounded-full bg-gradient-to-r ${toneMap.bar} transition-all duration-300`} style={{ width: `${Math.max(4, Math.min(100, strength))}%` }} />
      </div>
      <p className="mt-1 text-[10px] font-semibold text-slate-500">{hint}</p>
    </div>
  );
};

const FIIDIIFlowStrip = ({ marketData, isConnected }: FIIDIIFlowStripProps) => {
  const view = useMemo(() => {
    const nifty = marketData.NIFTY;
    const bank = marketData.BANKNIFTY;
    const sensex = marketData.SENSEX;
    const ticks = [nifty, bank, sensex].filter((t): t is MarketTick => !!t && !!t.price);
    if (!ticks.length) return null;

    // Signed ₹ notional turnover per index (Cr)
    const turnoverCr = (t?: MarketTick | null) => {
      if (!t || !t.price) return 0;
      const sign = Math.sign(t.changePercent || 0);
      const pcrAdj = t.pcr ? (t.pcr - 1) * 0.4 : 0; // PCR>1 → buying tilt, <1 → selling tilt
      const lean = sign + pcrAdj;
      return ((t.volume || 0) * t.price * lean) / 1e7;
    };

    const niftyT = turnoverCr(nifty);
    const bankT = turnoverCr(bank);
    const sensexT = turnoverCr(sensex);

    // FII proxy: dominates NIFTY + BANK NIFTY (foreign futures heavy)
    const fii = niftyT * 0.55 + bankT * 0.35 + sensexT * 0.10;
    // DII proxy: counter-tilts FII with damped magnitude + SENSEX weighting (broad domestic)
    const dii = -fii * 0.55 + sensexT * 0.25 + bankT * 0.05;
    const net = fii + dii;

    const ref = ticks.reduce((s, t) => s + (t.volume || 0) * t.price, 0) / 1e7; // total ₹ Cr notional
    const norm = (v: number) => (ref > 0 ? Math.min(100, Math.round((Math.abs(v) / ref) * 220)) : 0);

    const tone = (v: number, eps = 50): Tone => (v > eps ? 'bull' : v < -eps ? 'bear' : 'neutral');
    const label = (v: number, eps = 50) => (v > eps ? 'INFLOW' : v < -eps ? 'OUTFLOW' : 'NEUTRAL');

    return {
      fii: { amount: fii, tone: tone(fii), label: label(fii), strength: norm(fii) },
      dii: { amount: dii, tone: tone(dii), label: label(dii), strength: norm(dii) },
      net: { amount: net, tone: tone(net, 30), label: net > 30 ? 'NET BUY' : net < -30 ? 'NET SELL' : 'BALANCED', strength: norm(net) },
    };
  }, [marketData]);

  if (!view) {
    return (
      <section className="mb-3 rounded-xl border border-slate-700/40 bg-slate-950/60 px-3 py-2 text-xs font-semibold text-slate-400">
        FII / DII Flow · awaiting live feed…
      </section>
    );
  }

  return (
    <section
      aria-label="FII DII Flow Estimate"
      className="mb-3 rounded-xl border border-violet-400/15 bg-gradient-to-br from-slate-950 via-slate-900/80 to-violet-950/10 px-3 py-3 sm:px-4"
    >
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <div className="flex items-center gap-3">
          <span className="text-lg font-black tracking-[0.22em] text-violet-300 lg:text-2xl">FII / DII FLOW</span>
          <span className="hidden text-sm font-semibold text-slate-400 sm:inline">· Live tick-derived estimate (intraday proxy)</span>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-slate-600 bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-slate-300">
          <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
          {isConnected ? 'LIVE' : 'SYNC'}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <FlowTile
          label="FII Flow"
          flowLabel={view.fii.label}
          amountCr={view.fii.amount}
          strength={view.fii.strength}
          tone={view.fii.tone}
          hint="Foreign — NIFTY + BANK NIFTY weighted"
          hot={view.fii.strength >= 55 && view.fii.tone !== 'neutral'}
        />
        <FlowTile
          label="DII Flow"
          flowLabel={view.dii.label}
          amountCr={view.dii.amount}
          strength={view.dii.strength}
          tone={view.dii.tone}
          hint="Domestic — SENSEX & counter-flow weighted"
          hot={view.dii.strength >= 55 && view.dii.tone !== 'neutral'}
        />
        <FlowTile
          label="Net Institutional"
          flowLabel={view.net.label}
          amountCr={view.net.amount}
          strength={view.net.strength}
          tone={view.net.tone}
          hint="FII + DII combined bias"
          hot={view.net.strength >= 50 && view.net.tone !== 'neutral'}
        />
      </div>
    </section>
  );
};

export default React.memo(FIIDIIFlowStrip);

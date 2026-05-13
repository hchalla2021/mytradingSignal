'use client';

import React, { memo } from 'react';
import { useStrikeIntelligence } from '@/hooks/useStrikeIntelligence';
import { QuantumFractalPanel } from '@/components/StrikeIntelligence';

const SYMBOLS = ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const;
const SYMBOL_LABELS: Record<string, string> = {
  NIFTY:     'NIFTY 50',
  BANKNIFTY: 'BANK NIFTY',
  SENSEX:    'SENSEX',
};

const QuantumFractalSection = memo(() => {
  const { strikeData } = useStrikeIntelligence();

  const hasAny = SYMBOLS.some((sym) => strikeData[sym]?.intelligence?.quantumFractal);
  if (!hasAny) return null;

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
            <span className="inline-flex items-center rounded border border-cyan-500/30 bg-cyan-500/8 px-2 py-1 text-[9px] sm:text-[10px] font-black text-cyan-300 tracking-[0.14em] uppercase shrink-0">
              LIVE PROBE
            </span>
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
    </section>
  );
});

QuantumFractalSection.displayName = 'QuantumFractalSection';
export default QuantumFractalSection;


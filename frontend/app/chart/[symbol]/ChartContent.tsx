'use client';

import React, { useState, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useChartIntelligence } from '@/hooks/useChartIntelligence';
import { useMarketSocket } from '@/hooks/useMarketSocket';

const SymbolChartCard = dynamic(
  () => import('@/components/ChartIntelligence').then(m => m.SymbolChartCard),
  { ssr: false, loading: () => (
    <div className="flex items-center justify-center h-64 text-slate-500 text-sm">Loading chart…</div>
  )}
);

type SymbolKey = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

const SYMBOL_LABELS: Record<SymbolKey, string> = {
  NIFTY: 'NIFTY 50',
  BANKNIFTY: 'BANK NIFTY',
  SENSEX: 'SENSEX',
};

export default function ChartContent({ symbol: rawSymbol }: { symbol: string }) {
  const symbol = rawSymbol.toUpperCase() as SymbolKey;
  const isValid = ['NIFTY', 'BANKNIFTY', 'SENSEX'].includes(symbol);

  const { chartData } = useChartIntelligence();
  const { marketData } = useMarketSocket();

  const topBarRef = useRef<HTMLDivElement>(null);
  const [chartH, setChartH] = useState(600);

  useEffect(() => {
    const compute = () => {
      const topH = topBarRef.current?.getBoundingClientRect().height ?? 40;
      // card header ~50px, footer intelligence ~95px, legend hint ~26px, gaps ~8px
      setChartH(Math.max(300, window.innerHeight - topH - 179));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  const data = isValid ? (chartData[symbol] ?? null) : null;
  const liveSpot = isValid ? marketData[symbol]?.price : undefined;
  const label = isValid ? SYMBOL_LABELS[symbol] : symbol;

  if (!isValid) {
    return (
      <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-red-400 text-lg font-bold">Unknown symbol: {rawSymbol}</p>
          <p className="text-slate-500 text-sm">Valid values: NIFTY, BANKNIFTY, SENSEX</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-1.5 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 transition-colors"
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-[#0d1117] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div
        ref={topBarRef}
        className="flex items-center gap-3 px-3 sm:px-5 py-2 border-b border-slate-700/50 bg-[#161b27] shrink-0 select-none"
      >
        <button
          onClick={() => window.close()}
          title="Close tab"
          className="w-3 h-3 rounded-full bg-[#ff5f57] hover:bg-[#ff3b30] border border-[#c03b35]/60 transition-colors shrink-0"
        />
        <span className="text-[12px] sm:text-[14px] font-semibold text-slate-200 tracking-tight truncate">
          {label}
        </span>
        <span className="text-[9px] font-mono text-indigo-400/70 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded shrink-0">
          LIVE CHART
        </span>
        <span className="hidden sm:inline text-[9px] text-slate-600 ml-auto">
          FVG · OB · Liquidity · BOS · CHoCH · Fractals · S/R
        </span>
      </div>

      {/* Chart — no padding, fills the remaining height */}
      <div className="flex-1 overflow-hidden">
        <SymbolChartCard
          data={data}
          name={label}
          liveSpot={liveSpot}
          forceChartHeight={chartH}
          fullPage
        />
      </div>
    </div>
  );
}


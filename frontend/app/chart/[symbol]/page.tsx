'use client';

import React from 'react';
import dynamic from 'next/dynamic';

// Load all chart logic client-side only:
// useChartIntelligence initialises from localStorage which doesn't exist on the
// server, causing a hydration mismatch if we let Next.js SSR this component.
const ChartContent = dynamic(() => import('./ChartContent'), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center">
      <span className="text-slate-500 text-sm">Loading chart…</span>
    </div>
  ),
});

export default function ChartPage({ params }: { params: { symbol: string } }) {
  return <ChartContent symbol={params.symbol} />;
}

import { Suspense } from 'react';
import ChartIntelContent from './ChartIntelContent';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED = new Set(['NIFTY', 'BANKNIFTY', 'SENSEX']);

export default function ChartIntelPage({ params }: { params: { symbol: string } }) {
  const sym = (params.symbol || 'NIFTY').toUpperCase();
  const symbol = ALLOWED.has(sym) ? sym : 'NIFTY';
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050816] text-white p-6">Loading…</div>}>
      <ChartIntelContent symbol={symbol} />
    </Suspense>
  );
}

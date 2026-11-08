'use client';

import ExpiryEdgeAIPanel from '@/components/ExpiryEdgeAIPanel';
import { useMarketSocket } from '@/hooks/useMarketSocket';

export default function ExpiryEdgeAIPage() {
  const { marketData, isConnected } = useMarketSocket();

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-7xl">
        <ExpiryEdgeAIPanel marketData={marketData} isConnected={isConnected} />
      </div>
    </main>
  );
}

'use client';

import dynamic from 'next/dynamic';
import IndexTabs from '@/components/IndexTabs';
import type { MarketTick } from '@/hooks/useMarketSocket';
import type { AIAlertTooltipData } from '@/types/ai';

const IndexCard = dynamic(() => import('@/components/IndexCard'), {
  ssr: false,
  loading: () => (
    <div className="bg-dark-surface/60 rounded-xl p-6 animate-pulse border border-emerald-500/20">
      <div className="h-6 bg-gray-700 rounded mb-4"></div>
      <div className="h-4 bg-gray-700 rounded mb-2"></div>
      <div className="h-4 bg-gray-700 rounded w-3/4"></div>
    </div>
  ),
});

type IndexSymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface LiveMarketIndexTabsProps {
  marketData: Record<IndexSymbol, MarketTick | null>;
  isConnected: boolean;
  alertData: Partial<Record<IndexSymbol, AIAlertTooltipData>>;
}

export default function LiveMarketIndexTabs({ marketData, isConnected, alertData }: LiveMarketIndexTabsProps) {
  return (
    <IndexTabs idPrefix="live-market" label="Live market index">
      {(symbol, name) => (
        <IndexCard
          symbol={symbol}
          name={name}
          data={marketData[symbol]}
          isConnected={isConnected}
          aiAlertData={alertData[symbol]}
        />
      )}
    </IndexTabs>
  );
}

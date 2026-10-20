'use client';

import dynamic from 'next/dynamic';
import type { TradeStatusPluginDefinition } from '@/types/trade-status';

function ModuleSkeleton(): JSX.Element {
  return (
    <div className="animate-pulse rounded-xl border border-slate-700/40 bg-slate-900/40 p-4">
      <div className="mb-3 h-4 w-40 rounded bg-slate-700/50" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-20 rounded bg-slate-700/30" />
        <div className="h-20 rounded bg-slate-700/30" />
      </div>
    </div>
  );
}

const MarketLiquidityIntelligence = dynamic(
  () => import('@/components/MarketLiquidityIntelligence'),
  {
    ssr: false,
    loading: ModuleSkeleton,
  }
);

const CandleIntelligenceEngine = dynamic(() => import('@/components/CandleIntelligenceEngine'), {
  ssr: false,
  loading: ModuleSkeleton,
});

const MarketCompassDashboard = dynamic(() => import('@/components/MarketCompassDashboard'), {
  ssr: false,
  loading: ModuleSkeleton,
});

const TradingSignalPanel = dynamic(() => import('@/components/TradingSignalPanel'), {
  ssr: false,
  loading: ModuleSkeleton,
});

export const TRADE_STATUS_PLUGINS: TradeStatusPluginDefinition[] = [
  {
    id: 'market_liquidity',
    title: 'Liquidity Intelligence',
    subtitle: 'Execution-quality and microstructure pressure',
    description: 'Shows liquidity concentration, absorptions, and trade readiness.',
    zone: 'execution',
    priority: 20,
    minHeightPx: 520,
    dense: false,
    supportsSymbols: true,
    supportsCollapse: true,
    defaultEnabled: true,
    health: 'healthy',
    render: () => <MarketLiquidityIntelligence />,
  },
  {
    id: 'market_compass',
    title: 'Market Compass',
    subtitle: 'Regime, sentiment, and risk context',
    description: 'Correlates structure, sentiment, and risk into directional context.',
    zone: 'intel',
    priority: 30,
    minHeightPx: 420,
    dense: true,
    supportsSymbols: true,
    supportsCollapse: true,
    defaultEnabled: true,
    health: 'healthy',
    render: ({ symbol }) => <MarketCompassDashboard symbol={symbol} refreshInterval={3000} />,
  },
  {
    id: 'candle_intel',
    title: 'Candle Intelligence',
    subtitle: 'Realtime candle quality and intent scanning',
    description: 'Interprets candle intent for short-horizon decision precision.',
    zone: 'signals',
    priority: 40,
    minHeightPx: 420,
    dense: true,
    supportsSymbols: true,
    supportsCollapse: true,
    defaultEnabled: true,
    health: 'healthy',
    render: () => <CandleIntelligenceEngine />,
  },
  {
    id: 'trading_signals',
    title: 'Execution Signal Deck',
    subtitle: 'Actionable entry, stop, and probability profile',
    description: 'Institutional-style signal execution pane with risk accounting.',
    zone: 'execution',
    priority: 50,
    minHeightPx: 360,
    dense: true,
    supportsSymbols: true,
    supportsCollapse: true,
    defaultEnabled: true,
    health: 'healthy',
    render: ({ symbol }) => (
      <TradingSignalPanel symbol={symbol} accountSize={100000} refreshInterval={5000} />
    ),
  },
];

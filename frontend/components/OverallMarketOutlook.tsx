'use client';

/**
 * Overall Market Outlook – PROFESSIONAL MINIMAL DASHBOARD
 * Clean, fast, professional trading interface
 * - Real-time 16-signal aggregation
 * - Multi-symbol sentiment dashboard
 * - 5-minute prediction alerts
 * - Zero clutter, maximum clarity
 */

import React, { useState, useEffect, memo, useMemo, useCallback } from 'react';
import { useIndiaVIX } from '@/hooks/useIndiaVIX';
import IndiaVIXBadge from '@/components/IndiaVIXBadge';

interface SymbolData {
  symbol: string;
  signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  confidence: number;
  buy_signals: number;
  sell_signals: number;
  prediction_5m_direction: 'UP' | 'DOWN' | 'FLAT';
  prediction_5m_signal: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  prediction_5m_confidence: number;
  timestamp: string;
}

interface MarketOutlookResponse {
  NIFTY: SymbolData;
  BANKNIFTY: SymbolData;
  SENSEX: SymbolData;
}

// Minimal color utilities - no complexity
const signalColor = {
  'STRONG_BUY': '#10b981',
  'BUY': '#6ee7b7',
  'NEUTRAL': '#fbbf24',
  'SELL': '#f87171',
  'STRONG_SELL': '#dc2626'
};

const SignalCard = memo(({ data }: { data: SymbolData }) => (
  <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-6 backdrop-blur-sm hover:bg-slate-800/70 transition-colors">
    {/* Header: Symbol + Confidence */}
    <div className="flex items-baseline justify-between mb-6">
      <h3 className="text-2xl font-bold text-white">{data.symbol}</h3>
      <span className="text-sm font-semibold px-2 py-1 rounded" style={{
        backgroundColor: `${signalColor[data.signal]}20`,
        color: signalColor[data.signal]
      }}>
        {data.confidence}%
      </span>
    </div>

    {/* Main Signal - Bold */}
    <div className="mb-8">
      <div className="text-4xl font-black mb-2" style={{ color: signalColor[data.signal] }}>
        {data.signal}
      </div>
      <div className="h-1 w-12 rounded-full" style={{ backgroundColor: signalColor[data.signal] }} />
    </div>

    {/* 16-Signal Consensus - Clean Bars */}
    <div className="mb-8 space-y-4">
      <div className="text-xs uppercase tracking-wide text-gray-400 font-bold">16 Signal Consensus</div>
      
      {/* BUY Bar */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-300 font-medium">▲ BUY</span>
          <span className="text-white font-bold">{data.buy_signals}%</span>
        </div>
        <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-300"
            style={{ width: `${data.buy_signals}%` }}
          />
        </div>
      </div>

      {/* SELL Bar */}
      <div>
        <div className="flex justify-between text-sm mb-2">
          <span className="text-gray-300 font-medium">▼ SELL</span>
          <span className="text-white font-bold">{data.sell_signals}%</span>
        </div>
        <div className="h-2 bg-slate-700/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-red-500 to-red-400 rounded-full transition-all duration-300"
            style={{ width: `${data.sell_signals}%` }}
          />
        </div>
      </div>
    </div>

    {/* 5-Minute Prediction - Prominent Section */}
    <div className="pt-6 border-t border-slate-700/50">
      <div className="text-xs uppercase tracking-wide text-gray-400 font-bold mb-4">⚡ 5-Min Prediction</div>
      
      <div className="flex items-start justify-between mb-6">
        {/* Direction + Signal */}
        <div>
          <div className="text-3xl font-black mb-1" style={{ color: signalColor[data.prediction_5m_signal] }}>
            {data.prediction_5m_direction === 'UP' ? '▲' : data.prediction_5m_direction === 'DOWN' ? '▼' : '→'}
          </div>
          <div className="text-lg font-bold text-white">{data.prediction_5m_signal}</div>
        </div>

        {/* Confidence */}
        <div className="text-right">
          <div className="text-sm text-gray-400 mb-1">CONFIDENCE</div>
          <div className="text-3xl font-black" style={{ color: signalColor[data.prediction_5m_signal] }}>
            {data.prediction_5m_confidence}%
          </div>
        </div>
      </div>

      {/* Prediction Bars - VISIBLE BOTH COLORS */}
      <div className="space-y-4">
        {/* Bull Bar - GREEN */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-emerald-400 font-medium">▲ BULL</span>
            <span className="text-white font-bold">{data.prediction_5m_confidence}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden border border-slate-600/30">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-300 shadow-sm shadow-emerald-500/40"
              style={{ width: `${Math.max(data.prediction_5m_confidence, 2)}%` }}
            />
          </div>
        </div>

        {/* Bear Bar - RED */}
        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-red-400 font-medium">▼ BEAR</span>
            <span className="text-white font-bold">{100 - data.prediction_5m_confidence}%</span>
          </div>
          <div className="w-full h-2.5 bg-slate-700/50 rounded-full overflow-hidden border border-slate-600/30">
            <div
              className="h-full bg-red-500 rounded-full transition-all duration-300 shadow-sm shadow-red-500/40"
              style={{ width: `${Math.max(100 - data.prediction_5m_confidence, 2)}%` }}
            />
          </div>
        </div>
      </div>
    </div>

    {/* Footer: Last Update */}
    <div className="mt-6 pt-4 border-t border-slate-700/50 text-xs text-gray-500 text-center">
      {new Date(data.timestamp).toLocaleTimeString()}
    </div>
  </div>
), (prev, next) => JSON.stringify(prev.data) === JSON.stringify(next.data));

SignalCard.displayName = 'SignalCard';

export default function OverallMarketOutlook() {
  const [data, setData] = useState<MarketOutlookResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const { vixData, loading: vixLoading } = useIndiaVIX();

  // Fast fetch with abort signal
  const fetchData = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${apiUrl}/api/analysis/market-outlook-all`, {
        cache: 'no-store',
        signal: controller.signal
      });

      clearTimeout(timeout);
      if (res.ok) {
        const result = await res.json();
        setData(result);
        setLoading(false);
      }
    } catch (err) {
      console.error('Fetch error:', err);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 500); // Fast updates
    return () => clearInterval(interval);
  }, [fetchData]);

  const symbols = useMemo(() => ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="h-10 w-64 bg-slate-700/50 rounded animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-96 bg-slate-700/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Clean Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-white">MARKET OUTLOOK</h1>
          <p className="text-sm text-gray-400 mt-2">16-Signal Consensus • 5-Minute Prediction</p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            LIVE
          </div>
          <IndiaVIXBadge
            value={vixData.value}
            changePercent={vixData.changePercent}
            volatilityLevel={vixData.volatilityLevel}
            marketFearScore={vixData.marketFearScore}
            loading={vixLoading}
          />
        </div>
      </div>

      {/* Three-Symbol Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {symbols.map(symbol => (
          <SignalCard key={symbol} data={data[symbol as keyof MarketOutlookResponse]} />
        ))}
      </div>

      {/* Footer */}
      <div className="text-xs text-gray-500 text-center pt-4">
        16 integrated market signals • 5-minute forecast • {' '}
        <span className="text-emerald-600 font-semibold">{'<'}15ms latency</span>
      </div>
    </div>
  );
}

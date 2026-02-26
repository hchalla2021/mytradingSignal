'use client';

import React, { useState } from 'react';
import OverallMarketOutlook from '@/components/OverallMarketOutlook';

type SymbolType = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';

interface SymbolOption {
  label: string;
  value: SymbolType;
}

export default function DashboardPage(): JSX.Element {
  const [selectedSymbol, setSelectedSymbol] = useState<SymbolType>('NIFTY');

  const symbols: SymbolOption[] = [
    { label: 'NIFTY 50', value: 'NIFTY' },
    { label: 'BANKNIFTY', value: 'BANKNIFTY' },
    { label: 'SENSEX', value: 'SENSEX' },
  ];

  const handleSymbolClick = (symbol: SymbolType): void => {
    setSelectedSymbol(symbol);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            🎯 Professional Trading Dashboard
          </h1>
          <p className="text-gray-400">
            14 Integrated Signals • Live Confidence Analysis • Real-Time Market Outlook
          </p>
        </div>

        {/* Symbol Selector */}
        <div className="mb-6 flex gap-3">
          {symbols.map((symbol) => (
            <button
              key={symbol.value}
              onClick={() => handleSymbolClick(symbol.value)}
              className={`px-6 py-2 rounded-lg font-semibold transition-all ${
                selectedSymbol === symbol.value
                  ? 'bg-blue-600 text-white shadow-lg'
                  : 'bg-slate-800 text-gray-300 hover:bg-slate-700'
              }`}
              type="button"
            >
              {symbol.label}
            </button>
          ))}
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 gap-8">
          {/* Overall Market Outlook - 14 Signals */}
          <div>
            <OverallMarketOutlook symbol={selectedSymbol} />
          </div>

          {/* Index Card for Quick Reference */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-lg p-6 border border-slate-700">
            <h2 className="text-xl font-bold text-white mb-4">📊 Quick Reference - {selectedSymbol}</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-slate-950/50 rounded p-4">
                <p className="text-gray-400 text-sm mb-2">This panel will display</p>
                <p className="text-emerald-400 font-semibold">Live Market Data</p>
                <p className="text-gray-500 text-xs mt-2">OHLC • Volume • Trends</p>
              </div>
              <div className="bg-slate-950/50 rounded p-4">
                <p className="text-gray-400 text-sm mb-2">Real-time updates from</p>
                <p className="text-blue-400 font-semibold">WebSocket Feed</p>
                <p className="text-gray-500 text-xs mt-2">Every tick • Low latency</p>
              </div>
              <div className="bg-slate-950/50 rounded p-4">
                <p className="text-gray-400 text-sm mb-2">Connected via</p>
                <p className="text-purple-400 font-semibold">Zerodha Kite API</p>
                <p className="text-gray-500 text-xs mt-2">Professional grade • Reliable</p>
              </div>
            </div>
          </div>

          {/* Info Box */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-300 mb-3">📚 Signal Definitions</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-300">
              <div>
                <p className="font-semibold text-white mb-2">Technical Indicators:</p>
                <ul className="space-y-1 text-xs">
                  <li>✓ <strong>Trend Base:</strong> Higher-Low structure analysis</li>
                  <li>✓ <strong>Volume Pulse:</strong> Candle volume strength</li>
                  <li>✓ <strong>Candle Intent:</strong> Bullish/bearish candle structure</li>
                  <li>✓ <strong>Pivot Points:</strong> Support/Resistance levels</li>
                  <li>✓ <strong>ORB:</strong> Opening Range Breakout detection</li>
                  <li>✓ <strong>SuperTrend:</strong> (10,2) trend following indicator</li>
                  <li>✓ <strong>Parabolic SAR:</strong> Trend reversal detector</li>
                </ul>
              </div>
              <div>
                <p className="font-semibold text-white mb-2">Advanced Signals:</p>
                <ul className="space-y-1 text-xs">
                  <li>✓ <strong>RSI 60/40:</strong> Momentum overbought/oversold zones</li>
                  <li>✓ <strong>Camarilla:</strong> CPR (Central Pivot Range) zones</li>
                  <li>✓ <strong>VWMA 20:</strong> Volume-weighted entry filter</li>
                  <li>✓ <strong>High Volume:</strong> Anomaly scanner for volume spikes</li>
                  <li>✓ <strong>Smart Money:</strong> Order structure intelligence</li>
                  <li>✓ <strong>Trade Zones:</strong> Buy/Sell signal zones</li>
                  <li>✓ <strong>OI Momentum:</strong> Open Interest based momentum</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

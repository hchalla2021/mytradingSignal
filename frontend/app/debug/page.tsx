'use client';

import { useMarketSocket } from '@/hooks/useMarketSocket';
import { useEffect, useState } from 'react';

export default function DebugPage() {
  const { marketData, isConnected, connectionStatus } = useMarketSocket();
  const [tickCount, setTickCount] = useState(0);

  useEffect(() => {
    console.log('🔍 DEBUG PAGE - Data change detected:', marketData);
    setTickCount(prev => prev + 1);
  }, [marketData]);

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">WebSocket Debug Page</h1>
      
      <div className="bg-gray-800 p-4 rounded-lg mb-4">
        <h2 className="text-xl font-semibold mb-2">Connection Status</h2>
        <p>Is Connected: <span className={isConnected ? 'text-green-400' : 'text-red-400'}>{isConnected ? 'YES' : 'NO'}</span></p>
        <p>Status: <span className="text-yellow-400">{connectionStatus}</span></p>
        <p>Updates Received: <span className="text-cyan-400">{tickCount}</span></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* NIFTY */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-lg font-bold mb-2 text-cyan-400">NIFTY</h3>
          {marketData.NIFTY ? (
            <div className="space-y-1 text-sm">
              <p>Price: <span className="font-mono text-green-400">{marketData.NIFTY.price}</span></p>
              <p>Change: <span className="font-mono">{marketData.NIFTY.change}</span></p>
              <p>Status: <span className="font-semibold">{marketData.NIFTY.status}</span></p>
              <p>Open: {marketData.NIFTY.open}</p>
              <p>High: {marketData.NIFTY.high}</p>
              <p>Low: {marketData.NIFTY.low}</p>
              <p className="text-xs text-gray-400">Time: {marketData.NIFTY.timestamp}</p>
            </div>
          ) : (
            <p className="text-red-400">No data</p>
          )}
        </div>

        {/* BANKNIFTY */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-lg font-bold mb-2 text-cyan-400">BANKNIFTY</h3>
          {marketData.BANKNIFTY ? (
            <div className="space-y-1 text-sm">
              <p>Price: <span className="font-mono text-green-400">{marketData.BANKNIFTY.price}</span></p>
              <p>Change: <span className="font-mono">{marketData.BANKNIFTY.change}</span></p>
              <p>Status: <span className="font-semibold">{marketData.BANKNIFTY.status}</span></p>
              <p>Open: {marketData.BANKNIFTY.open}</p>
              <p>High: {marketData.BANKNIFTY.high}</p>
              <p>Low: {marketData.BANKNIFTY.low}</p>
              <p className="text-xs text-gray-400">Time: {marketData.BANKNIFTY.timestamp}</p>
            </div>
          ) : (
            <p className="text-red-400">No data</p>
          )}
        </div>

        {/* SENSEX */}
        <div className="bg-gray-800 p-4 rounded-lg">
          <h3 className="text-lg font-bold mb-2 text-cyan-400">SENSEX</h3>
          {marketData.SENSEX ? (
            <div className="space-y-1 text-sm">
              <p>Price: <span className="font-mono text-green-400">{marketData.SENSEX.price}</span></p>
              <p>Change: <span className="font-mono">{marketData.SENSEX.change}</span></p>
              <p>Status: <span className="font-semibold">{marketData.SENSEX.status}</span></p>
              <p>Open: {marketData.SENSEX.open}</p>
              <p>High: {marketData.SENSEX.high}</p>
              <p>Low: {marketData.SENSEX.low}</p>
              <p className="text-xs text-gray-400">Time: {marketData.SENSEX.timestamp}</p>
            </div>
          ) : (
            <p className="text-red-400">No data</p>
          )}
        </div>
      </div>

      <div className="mt-6 bg-gray-800 p-4 rounded-lg">
        <h2 className="text-xl font-semibold mb-2">Raw Data (JSON)</h2>
        <pre className="text-xs overflow-auto max-h-96 bg-gray-900 p-4 rounded">
          {JSON.stringify(marketData, null, 2)}
        </pre>
      </div>

      <div className="mt-4">
        <a href="/" className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded inline-block">
          ← Back to Dashboard
        </a>
      </div>
    </div>
  );
}

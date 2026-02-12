'use client';

import React, { useState, useEffect } from 'react';

interface CacheData {
  NIFTY: any;
  BANKNIFTY: any;
  SENSEX: any;
}

export default function CacheDebugBanner() {
  const [cacheData, setCacheData] = useState<CacheData | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const saved = localStorage.getItem('lastMarketData');
      if (saved) {
        const parsed = JSON.parse(saved);
        setCacheData(parsed);
        console.log('✅ Cache found:', parsed);
      } else {
        console.log('⚠️ No cache in localStorage');
      }
    } catch (e) {
      console.error('Cache read error:', e);
    }
  }, []);

  const hasCache = !!cacheData && (cacheData.NIFTY || cacheData.BANKNIFTY || cacheData.SENSEX);

  if (!hasCache) {
    return (
      <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
        <div className="bg-red-900/20 border border-red-500/40 rounded-lg p-3 text-sm text-red-300">
          <span className="font-bold">⚠️ No Market Cache:</span> Connect to backend to populate cache.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-2">
      <div className="bg-green-900/20 border border-green-500/40 rounded-lg p-3">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full text-left flex items-center justify-between text-sm text-green-300 hover:text-green-200 transition-colors"
        >
          <span className="font-bold">✅ Market Cache Available ({Object.keys(cacheData).filter(k => cacheData[k as keyof CacheData]).length} indices)</span>
          <span className="text-xs">{showDetails ? '▼' : '▶'}</span>
        </button>

        {showDetails && (
          <div className="mt-3 space-y-2 text-xs text-green-200">
            {['NIFTY', 'BANKNIFTY', 'SENSEX'].map((symbol) => {
              const data = cacheData[symbol as keyof CacheData];
              return data ? (
                <div key={symbol} className="p-2 bg-green-900/30 rounded border border-green-500/20">
                  <div className="font-bold text-green-300 mb-1">📊 {symbol}</div>
                  <div className="space-y-0.5 text-green-200">
                    <div>Price: ₹{data.price?.toFixed(2)}</div>
                    <div>Change: {data.change >= 0 ? '+' : ''}{data.change?.toFixed(2)} ({data.changePercent > 0 ? '+' : ''}{data.changePercent?.toFixed(2)}%)</div>
                    <div>High: ₹{data.high?.toFixed(2)} | Low: ₹{data.low?.toFixed(2)}</div>
                    <div className="text-[10px] text-green-300 font-mono mt-1">
                      {new Date(data.timestamp).toLocaleTimeString('en-IN')}
                    </div>
                  </div>
                </div>
              ) : null;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

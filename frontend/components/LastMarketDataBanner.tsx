'use client';

import React, { useState, useEffect } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface LastMarketData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
  timestamp: string;
}

interface MarketStats {
  NIFTY?: LastMarketData;
  BANKNIFTY?: LastMarketData;
  SENSEX?: LastMarketData;
}

export default function LastMarketDataBanner() {
  const [marketData, setMarketData] = useState<MarketStats>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLastMarketData = async () => {
      try {
        setLoading(true);
        setError(null);

        const url = API_CONFIG.endpoint('/api/advanced/pivot-indicators/last-session');
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        
        // Extract market data from response
        const processed: MarketStats = {};
        
        ['NIFTY', 'BANKNIFTY', 'SENSEX'].forEach(symbol => {
          if (data[symbol]) {
            const d = data[symbol];
            processed[symbol as keyof MarketStats] = {
              symbol,
              price: d.current_price || d.open || 0,
              change: (d.current_price || 0) - (d.open || 0),
              changePercent: d.change_percent || 0,
              high: d.high || 0,
              low: d.low || 0,
              open: d.open || 0,
              close: d.close || 0,
              volume: d.volume || 0,
              timestamp: d.timestamp || new Date().toISOString()
            };
          }
        });

        setMarketData(processed);
      } catch (err) {
        console.error('Error fetching last market data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchLastMarketData();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchLastMarketData, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatPrice = (price: number | undefined) => {
    if (!price) return '—';
    return price.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };

  const formatVolume = (vol: number | undefined) => {
    if (!vol) return '—';
    if (vol >= 1000000) return (vol / 1000000).toFixed(1) + 'M';
    if (vol >= 1000) return (vol / 1000).toFixed(1) + 'K';
    return vol.toString();
  };

  const getChangeColor = (change: number | undefined) => {
    if (!change) return 'text-gray-400';
    return change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-400';
  };

  return (
    <div className="w-full px-2 sm:px-4 lg:px-6 xl:px-8 py-3 sm:py-4 mt-4">
      <div className="bg-gradient-to-r from-slate-900/60 via-slate-800/60 to-slate-900/60 backdrop-blur-sm rounded-xl border-2 border-slate-600/40 shadow-xl p-3 sm:p-4">
        
        {/* Header */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xl">📊</span>
          <h2 className="text-sm sm:text-base font-bold text-slate-200">Last Market Session Data</h2>
          <span className="text-[10px] sm:text-xs text-slate-400 ml-auto">Auto-refreshes every 30s</span>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-2 mb-3 text-xs text-red-300">
            ⚠️ {error}
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-3">
            {['NIFTY', 'BANKNIFTY', 'SENSEX'].map(s => (
              <div key={s} className="bg-slate-700/20 rounded-lg p-2 animate-pulse border border-slate-600/20">
                <div className="h-4 bg-slate-600 rounded w-20 mb-2"></div>
                <div className="h-3 bg-slate-600 rounded w-16"></div>
              </div>
            ))}
          </div>
        )}

        {/* Data Grid */}
        {!loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-3">
            
            {/* NIFTY */}
            {marketData.NIFTY && (
              <div className="bg-slate-800/40 border border-emerald-500/30 rounded-lg p-2.5 sm:p-3 hover:border-emerald-500/50 transition-colors">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs sm:text-sm font-bold text-slate-200">NIFTY 50</span>
                  <span className={`text-[10px] sm:text-xs font-bold ${getChangeColor(marketData.NIFTY.change)}`}>
                    {marketData.NIFTY.change > 0 ? '↑' : '↓'} {Math.abs(marketData.NIFTY.change).toFixed(2)}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Price:</span>
                    <span className="text-slate-100 font-semibold">₹{formatPrice(marketData.NIFTY.price)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Change:</span>
                    <span className={`font-semibold ${getChangeColor(marketData.NIFTY.changePercent)}`}>
                      {marketData.NIFTY.changePercent > 0 ? '+' : ''}{marketData.NIFTY.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">High:</span>
                    <span className="text-green-400">₹{formatPrice(marketData.NIFTY.high)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Low:</span>
                    <span className="text-red-400">₹{formatPrice(marketData.NIFTY.low)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Volume:</span>
                    <span className="text-slate-300">{formatVolume(marketData.NIFTY.volume)}</span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-600/30 text-[9px] text-slate-500">
                  {new Date(marketData.NIFTY.timestamp).toLocaleString('en-IN')}
                </div>
              </div>
            )}

            {/* BANKNIFTY */}
            {marketData.BANKNIFTY && (
              <div className="bg-slate-800/40 border border-amber-500/30 rounded-lg p-2.5 sm:p-3 hover:border-amber-500/50 transition-colors">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs sm:text-sm font-bold text-slate-200">BANKNIFTY</span>
                  <span className={`text-[10px] sm:text-xs font-bold ${getChangeColor(marketData.BANKNIFTY.change)}`}>
                    {marketData.BANKNIFTY.change > 0 ? '↑' : '↓'} {Math.abs(marketData.BANKNIFTY.change).toFixed(2)}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Price:</span>
                    <span className="text-slate-100 font-semibold">₹{formatPrice(marketData.BANKNIFTY.price)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Change:</span>
                    <span className={`font-semibold ${getChangeColor(marketData.BANKNIFTY.changePercent)}`}>
                      {marketData.BANKNIFTY.changePercent > 0 ? '+' : ''}{marketData.BANKNIFTY.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">High:</span>
                    <span className="text-green-400">₹{formatPrice(marketData.BANKNIFTY.high)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Low:</span>
                    <span className="text-red-400">₹{formatPrice(marketData.BANKNIFTY.low)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Volume:</span>
                    <span className="text-slate-300">{formatVolume(marketData.BANKNIFTY.volume)}</span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-600/30 text-[9px] text-slate-500">
                  {new Date(marketData.BANKNIFTY.timestamp).toLocaleString('en-IN')}
                </div>
              </div>
            )}

            {/* SENSEX */}
            {marketData.SENSEX && (
              <div className="bg-slate-800/40 border border-cyan-500/30 rounded-lg p-2.5 sm:p-3 hover:border-cyan-500/50 transition-colors">
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-xs sm:text-sm font-bold text-slate-200">SENSEX</span>
                  <span className={`text-[10px] sm:text-xs font-bold ${getChangeColor(marketData.SENSEX.change)}`}>
                    {marketData.SENSEX.change > 0 ? '↑' : '↓'} {Math.abs(marketData.SENSEX.change).toFixed(2)}
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Price:</span>
                    <span className="text-slate-100 font-semibold">₹{formatPrice(marketData.SENSEX.price)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Change:</span>
                    <span className={`font-semibold ${getChangeColor(marketData.SENSEX.changePercent)}`}>
                      {marketData.SENSEX.changePercent > 0 ? '+' : ''}{marketData.SENSEX.changePercent.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">High:</span>
                    <span className="text-green-400">₹{formatPrice(marketData.SENSEX.high)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Low:</span>
                    <span className="text-red-400">₹{formatPrice(marketData.SENSEX.low)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Volume:</span>
                    <span className="text-slate-300">{formatVolume(marketData.SENSEX.volume)}</span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-600/30 text-[9px] text-slate-500">
                  {new Date(marketData.SENSEX.timestamp).toLocaleString('en-IN')}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!loading && Object.keys(marketData).length === 0 && !error && (
          <div className="text-center py-4 text-slate-400 text-sm">
            No market data available. Market data will appear after market open.
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface MarketData {
  symbol: string;
  current_price: number;
  high: number;
  low: number;
  open: number;
  close: number;
  change: number;
  change_percent: number;
  volume: number;
  iv?: number;
  status?: string;
  timestamp?: string;
}

interface LastMarketDataCardProps {
  symbol: 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
  compact?: boolean;
  showFullDetails?: boolean;
}

export default function LastMarketDataCard({ 
  symbol, 
  compact = false, 
  showFullDetails = true 
}: LastMarketDataCardProps) {
  const [data, setData] = useState<MarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
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

        const result = await response.json();
        if (result[symbol]) {
          setData(result[symbol]);
        }
      } catch (err) {
        console.error(`Error fetching ${symbol} data:`, err);
        setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [symbol]);

  const getBorderColor = () => {
    if (symbol === 'NIFTY') return 'border-emerald-500/30 hover:border-emerald-500/50';
    if (symbol === 'BANKNIFTY') return 'border-amber-500/30 hover:border-amber-500/50';
    return 'border-cyan-500/30 hover:border-cyan-500/50';
  };

  const getTextColor = () => {
    if (symbol === 'NIFTY') return 'text-emerald-400';
    if (symbol === 'BANKNIFTY') return 'text-amber-400';
    return 'text-cyan-400';
  };

  const getChangeColor = (change: number) => {
    return change > 0 ? 'text-green-400' : change < 0 ? 'text-red-400' : 'text-gray-400';
  };

  if (loading) {
    return (
      <div className={`bg-slate-800/40 rounded-lg ${getBorderColor()} border animate-pulse p-2 sm:p-3`}>
        <div className="h-4 bg-slate-600 rounded w-20 mb-2"></div>
        <div className="h-3 bg-slate-600 rounded w-16"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`bg-slate-800/40 rounded-lg ${getBorderColor()} border p-2 sm:p-3`}>
        <div className={`text-xs sm:text-sm font-bold ${getTextColor()} mb-1`}>{symbol}</div>
        <div className="text-[9px] text-slate-400">No data</div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className={`bg-slate-800/40 rounded-lg ${getBorderColor()} border p-2 sm:p-3 transition-colors hover:bg-slate-800/60`}>
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs sm:text-sm font-bold ${getTextColor()}`}>{symbol}</span>
          <span className={`text-[10px] sm:text-xs font-bold ${getChangeColor(data.change)}`}>
            {data.change > 0 ? '↑' : '↓'} {Math.abs(data.change).toFixed(2)}
          </span>
        </div>
        <div className="flex justify-between items-baseline">
          <span className="text-slate-300 font-semibold">₹{data.current_price?.toFixed(2) || '—'}</span>
          <span className={`text-[10px] font-semibold ${getChangeColor(data.change_percent)}`}>
            {data.change_percent > 0 ? '+' : ''}{data.change_percent.toFixed(2)}%
          </span>
        </div>
        {data.timestamp && (
          <div className="text-[8px] text-slate-500 mt-1">
            {new Date(data.timestamp).toLocaleTimeString('en-IN', { 
              hour: '2-digit', 
              minute: '2-digit' 
            })}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-slate-800/40 rounded-lg ${getBorderColor()} border transition-colors hover:bg-slate-800/60 p-3 space-y-1.5`}>
      {/* Header */}
      <div className="flex justify-between items-baseline">
        <span className={`text-sm font-bold ${getTextColor()}`}>{symbol}</span>
        <span className="text-[10px] text-slate-400">Last Session</span>
      </div>

      {/* Price */}
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Price:</span>
        <span className="text-slate-100 font-semibold">₹{data.current_price?.toFixed(2) || '—'}</span>
      </div>

      {/* Change */}
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">Change:</span>
        <span className={`font-semibold ${getChangeColor(data.change_percent)}`}>
          {data.change > 0 ? '↑' : '↓'} {Math.abs(data.change).toFixed(2)} ({data.change_percent > 0 ? '+' : ''}{data.change_percent.toFixed(2)}%)
        </span>
      </div>

      {showFullDetails && (
        <>
          {/* High/Low */}
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">High:</span>
            <span className="text-green-400">{data.high?.toFixed(2) || '—'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Low:</span>
            <span className="text-red-400">{data.low?.toFixed(2) || '—'}</span>
          </div>

          {/* Open/Close */}
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Open:</span>
            <span className="text-slate-300">{data.open?.toFixed(2) || '—'}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-slate-400">Close:</span>
            <span className="text-slate-300">{data.close?.toFixed(2) || '—'}</span>
          </div>

          {/* Volume */}
          {data.volume && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Volume:</span>
              <span className="text-slate-300">
                {data.volume >= 1000000 ? (data.volume / 1000000).toFixed(1) + 'M' : 
                 data.volume >= 1000 ? (data.volume / 1000).toFixed(1) + 'K' : 
                 data.volume}
              </span>
            </div>
          )}

          {/* IV */}
          {data.iv && (
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">IV:</span>
              <span className="text-slate-300">{data.iv.toFixed(2)}%</span>
            </div>
          )}
        </>
      )}

      {/* Timestamp */}
      {data.timestamp && (
        <div className="text-[9px] text-slate-500 pt-1 border-t border-slate-600/30">
          {new Date(data.timestamp).toLocaleString('en-IN')}
        </div>
      )}

      {/* Status Badge */}
      {data.status === 'HISTORICAL' && (
        <div className="text-[9px] text-center text-slate-400 bg-slate-700/30 rounded px-2 py-0.5">
          📊 Historical Data
        </div>
      )}
    </div>
  );
}

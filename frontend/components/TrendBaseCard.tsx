'use client';

import React, { memo, useEffect, useState } from 'react';
import { GitBranch, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

interface TrendBaseData {
  symbol: string;
  structure: {
    type: string;
    integrity_score: number;
    swing_points: {
      last_high: number;
      last_low: number;
      prev_high: number;
      prev_low: number;
      high_diff: number;
      low_diff: number;
    };
  };
  signal: string;
  confidence: number;
  trend: string;
  status: string;
  timestamp: string;
}

interface TrendBaseCardProps {
  symbol: string;
  name: string;
}

const TrendBaseCard = memo<TrendBaseCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<TrendBaseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
        const response = await fetch(`${apiUrl}/api/advanced/trend-base/${symbol}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        // 🔥 FIX: Check if backend returned error status (TOKEN_EXPIRED, ERROR, NO_DATA, etc.)
        if (result.status === 'TOKEN_EXPIRED' || result.status === 'ERROR' || !result.structure) {
          setError(result.message || 'Token expired - Please login');
          setData(null);
          console.warn(`[TREND-BASE] ${symbol} - ${result.status}: ${result.message}`);
          setLoading(false);
          return;
        }
        
        // Handle CACHED_DATA status (last session data)
        if (result.status === 'CACHED_DATA') {
          // Show cached data with indicator
          setData({ ...result, _isCached: true });
          setError(null);
          console.log(`[TREND-BASE] ${symbol} - Showing last session data (market closed)`);
          setLoading(false);
          return;
        }
        
        // Handle NO_DATA status (market closed, no backup cache)
        if (result.status === 'NO_DATA') {
          setError(result.message || 'Market closed - No data available');
          setData(null);
          console.log(`[TREND-BASE] ${symbol} - Market closed, waiting for market open`);
          setLoading(false);
          return;
        }
        
        setData(result);
        setError(null);
      } catch (err) {
        setError('Data unavailable');
        console.error(`[TREND-BASE] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '5000', 10);
    const interval = setInterval(fetchData, refreshInterval);

    return () => clearInterval(interval);
  }, [symbol]);

  const getSignalColor = (signal: string) => {
    if (signal === 'BUY') return 'text-bullish';
    if (signal === 'SELL') return 'text-bearish';
    return 'text-neutral';
  };

  const getSignalBg = (signal: string) => {
    if (signal === 'BUY') return 'bg-bullish/10';
    if (signal === 'SELL') return 'bg-bearish/10';
    return 'bg-neutral/10';
  };

  const getSignalIcon = (signal: string) => {
    if (signal === 'BUY') return <TrendingUp className="w-4 h-4" />;
    if (signal === 'SELL') return <TrendingDown className="w-4 h-4" />;
    return <GitBranch className="w-4 h-4" />;
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-emerald-400 bg-emerald-950/30 border-emerald-500/50';
    if (confidence >= 60) return 'text-green-400 bg-green-950/30 border-green-500/40';
    if (confidence >= 40) return 'text-yellow-400 bg-yellow-950/30 border-yellow-500/40';
    if (confidence >= 20) return 'text-orange-400 bg-orange-950/30 border-orange-500/40';
    return 'text-red-400 bg-red-950/30 border-red-500/40';
  };

  const getSignalColorEnhanced = (signal: string) => {
    const upperSignal = signal.toUpperCase();
    // EXTREME BUY - Brightest Green
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-green-900/40 text-green-300 border-green-400/70 shadow-lg shadow-green-500/20';
    }
    // STRONG BUY - Strong Green
    if (upperSignal.includes('STRONG') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-emerald-950/35 text-emerald-300 border-emerald-500/60';
    }
    // BUY - Standard Green
    if (upperSignal.includes('BUY') || upperSignal === 'BULLISH') {
      return 'bg-emerald-950/30 text-emerald-400 border-emerald-500/50';
    }
    // EXTREME SELL - Brightest Red
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-red-900/40 text-red-300 border-red-400/70 shadow-lg shadow-red-500/20';
    }
    // STRONG SELL - Strong Red
    if (upperSignal.includes('STRONG') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-rose-950/35 text-rose-300 border-rose-500/60';
    }
    // SELL - Standard Red
    if (upperSignal.includes('SELL') || upperSignal === 'BEARISH') {
      return 'bg-rose-950/30 text-rose-400 border-rose-500/50';
    }
    // NEUTRAL/WAIT - Gray
    if (upperSignal === 'NEUTRAL' || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') {
      return 'bg-gray-950/30 text-gray-400 border-gray-500/40';
    }
    // Other - Amber
    return 'bg-amber-950/30 text-amber-400 border-amber-500/40';
  };

  const getStructureEmoji = (type: string) => {
    if (type.includes('HIGHER-HIGH-HIGHER-LOW')) return '📈';
    if (type.includes('LOWER-HIGH-LOWER-LOW')) return '📉';
    return '⚡';
  };

  const formatPrice = (price: number): string => {
    return price.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  };

  if (loading) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4 animate-pulse">
        <div className="h-24 bg-dark-border rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4">
        <div className="flex items-center gap-2 text-dark-muted text-sm">
          <AlertTriangle className="w-4 h-4" />
          <span>{name} - {error}</span>
        </div>
      </div>
    );
  }

  const { structure, signal, confidence, trend } = data;

  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-3 sm:p-4 hover:border-dark-muted/50 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-accent" />
          <h3 className="text-sm sm:text-base font-bold text-white">{name}</h3>
          {data._isCached && (
            <span className="text-[9px] bg-amber-900/30 text-amber-400 px-1.5 py-0.5 rounded border border-amber-500/30">
              📊 LAST SESSION
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold ${getSignalBg(signal)} ${getSignalColor(signal)}`}>
          {getSignalIcon(signal)}
          <span>{signal}</span>
        </div>
      </div>

      {/* Structure Type */}
      <div className="mb-3 p-2 bg-dark-bg rounded">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-dark-muted font-medium">STRUCTURE</span>
          <span className="text-lg">{getStructureEmoji(structure.type)}</span>
        </div>
        <p className="text-xs font-bold text-white mt-1 leading-tight">
          {structure.type.replace(/-/g, ' ')}
        </p>
      </div>

      {/* Integrity Score */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] sm:text-xs text-dark-muted font-bold">INTEGRITY SCORE</span>
          <span className="text-base sm:text-lg font-bold text-white px-2 py-1 rounded-lg bg-accent/20 border-2 border-accent/40 shadow-md shadow-accent/20">{structure.integrity_score}%</span>
        </div>
        <div className="w-full bg-dark-border rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              structure.integrity_score >= 70 ? 'bg-bullish' : 
              structure.integrity_score >= 50 ? 'bg-accent' : 'bg-bearish'
            }`}
            style={{ width: `${structure.integrity_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[9px] text-dark-muted mt-1">
          <span>Broken</span>
          <span>Intact</span>
          <span>Strong</span>
        </div>
      </div>

      {/* Swing Points */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {/* Highs */}
        <div className="bg-dark-bg rounded-lg p-2 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <p className="text-[10px] sm:text-xs text-dark-muted font-bold mb-1.5">📍 HIGHS</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm sm:text-base font-bold text-white px-2 py-1 rounded-lg bg-blue-950/30 border-2 border-blue-500/40 shadow-md shadow-blue-500/20 inline-block">{formatPrice(structure.swing_points.last_high)}</p>
            <span className={`text-xs ${structure.swing_points.high_diff >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {structure.swing_points.high_diff >= 0 ? '▲' : '▼'}
            </span>
          </div>
          <p className="text-[10px] text-dark-muted mt-1">
            <span className="font-bold">Prev:</span> <span className="px-1.5 py-0.5 rounded bg-gray-800/40 border border-gray-600/30 text-gray-300">{formatPrice(structure.swing_points.prev_high)}</span>
          </p>
        </div>

        {/* Lows */}
        <div className="bg-dark-bg rounded-lg p-2 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <p className="text-[10px] sm:text-xs text-dark-muted font-bold mb-1.5">📍 LOWS</p>
          <div className="flex items-center gap-1.5">
            <p className="text-sm sm:text-base font-bold text-white px-2 py-1 rounded-lg bg-blue-950/30 border-2 border-blue-500/40 shadow-md shadow-blue-500/20 inline-block">{formatPrice(structure.swing_points.last_low)}</p>
            <span className={`text-xs ${structure.swing_points.low_diff >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {structure.swing_points.low_diff >= 0 ? '▲' : '▼'}
            </span>
          </div>
          <p className="text-[10px] text-dark-muted mt-1">
            <span className="font-bold">Prev:</span> <span className="px-1.5 py-0.5 rounded bg-gray-800/40 border border-gray-600/30 text-gray-300">{formatPrice(structure.swing_points.prev_low)}</span>
          </p>
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="flex items-center justify-between pt-2 border-t border-dark-border">
        <div>
          <p className="text-[10px] text-dark-muted font-bold">CONFIDENCE</p>
          <p className="text-sm font-bold text-accent">{confidence}%</p>
        </div>
        <div>
          <p className="text-[10px] text-dark-muted font-bold">TREND</p>
          <p className={`text-sm font-bold ${
            trend === 'UPTREND' ? 'text-bullish' : trend === 'DOWNTREND' ? 'text-bearish' : 'text-neutral'
          }`}>
            {trend}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-dark-muted font-bold">STATUS</p>
          <p className="text-sm font-bold text-white">{data.status}</p>
        </div>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';

export default TrendBaseCard;

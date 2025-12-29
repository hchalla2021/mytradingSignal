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
          <h3 className="text-xs sm:text-sm font-bold text-white">{name}</h3>
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
          <span className="text-[10px] text-dark-muted font-medium">INTEGRITY SCORE</span>
          <span className="text-sm font-bold text-white">{structure.integrity_score}%</span>
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
        <div className="bg-dark-bg rounded p-2">
          <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium mb-1">📍 HIGHS</p>
          <div className="flex items-center gap-1">
            <p className="text-xs font-bold text-white">{formatPrice(structure.swing_points.last_high)}</p>
            <span className={`text-[9px] ${structure.swing_points.high_diff >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {structure.swing_points.high_diff >= 0 ? '▲' : '▼'}
            </span>
          </div>
          <p className="text-[9px] text-dark-muted">Prev: {formatPrice(structure.swing_points.prev_high)}</p>
        </div>

        {/* Lows */}
        <div className="bg-dark-bg rounded p-2">
          <p className="text-[9px] sm:text-[10px] text-dark-muted font-medium mb-1">📍 LOWS</p>
          <div className="flex items-center gap-1">
            <p className="text-xs font-bold text-white">{formatPrice(structure.swing_points.last_low)}</p>
            <span className={`text-[9px] ${structure.swing_points.low_diff >= 0 ? 'text-bullish' : 'text-bearish'}`}>
              {structure.swing_points.low_diff >= 0 ? '▲' : '▼'}
            </span>
          </div>
          <p className="text-[9px] text-dark-muted">Prev: {formatPrice(structure.swing_points.prev_low)}</p>
        </div>
      </div>

      {/* Bottom Stats */}
      <div className="flex items-center justify-between pt-2 border-t border-dark-border">
        <div>
          <p className="text-[9px] text-dark-muted">CONFIDENCE</p>
          <p className="text-xs font-bold text-accent">{confidence}%</p>
        </div>
        <div>
          <p className="text-[9px] text-dark-muted">TREND</p>
          <p className={`text-xs font-bold ${
            trend === 'UPTREND' ? 'text-bullish' : trend === 'DOWNTREND' ? 'text-bearish' : 'text-neutral'
          }`}>
            {trend}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-dark-muted">STATUS</p>
          <p className="text-xs font-bold text-white">{data.status}</p>
        </div>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';

export default TrendBaseCard;

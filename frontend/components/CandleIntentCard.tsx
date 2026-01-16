'use client';

import React, { memo, useEffect, useState } from 'react';
import { Flame, TrendingUp, TrendingDown, AlertTriangle, Minus, Zap } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

interface CandlePattern {
  type: string;
  strength: number;
  intent: string;
  interpretation: string;
  confidence: number;
}

interface WickAnalysis {
  upper_wick_pct: number;
  lower_wick_pct: number;
  upper_strength: number;
  lower_strength: number;
  upper_signal: string;
  lower_signal: string;
  upper_interpretation: string;
  lower_interpretation: string;
  dominant_wick: string;
}

interface BodyAnalysis {
  body_ratio_pct: number;
  body_type: string;
  color: string;
  is_bullish: boolean;
  strength: number;
  conviction: string;
  interpretation: string;
}

interface VolumeAnalysis {
  volume: number;
  avg_volume: number;
  volume_ratio: number;
  volume_type: string;
  volume_interpretation: string;
  efficiency: string;
  efficiency_interpretation: string;
  signal: string;
}

interface CandleIntentData {
  symbol: string;
  timestamp: string;
  current_candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    range: number;
    body_size: number;
    upper_wick: number;
    lower_wick: number;
  };
  pattern: CandlePattern;
  wick_analysis: WickAnalysis;
  body_analysis: BodyAnalysis;
  volume_analysis: VolumeAnalysis;
  near_zone: boolean;
  professional_signal: string;
  status?: string;
  error?: string;
}

interface CandleIntentCardProps {
  symbol: string;
  name: string;
}

const CandleIntentCard = memo<CandleIntentCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<CandleIntentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const fetchData = async () => {
      try {
        const response = await fetch(API_CONFIG.endpoint(`/api/advanced/candle-intent/${symbol}`));
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        // Debug removed for production
        
        // Check for error statuses
        if (result.status === 'TOKEN_EXPIRED' || result.status === 'ERROR' || result.error) {
          setError(result.message || result.error || 'Token expired - Please login');
          setData(null);
        } else if (result.status === 'NO_DATA') {
          setError(result.message || 'Market closed - No data available');
          setData(null);
        } else {
          setData(result);
          setError(null);
        }
      } catch (err) {
        setError('Data unavailable');
        console.error(`[CANDLE-INTENT] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    // Initial fetch + Fast polling (every 5 seconds)
    fetchData();
    // Optimized: 12s polling to reduce API load (was 5s)
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '12000', 10);
    interval = setInterval(fetchData, refreshInterval);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Flame className="w-5 h-5 text-emerald-500 animate-pulse" />
          <h3 className="text-lg font-semibold text-white">{name} - Candle Intent</h3>
        </div>
        <div className="text-gray-400">Loading candle analysis...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-800 p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Flame className="w-5 h-5 text-emerald-500" />
          <h3 className="text-lg font-semibold text-white">{name} - Candle Intent</h3>
        </div>
        <div className="text-red-400">{error || 'Failed to load data'}</div>
      </div>
    );
  }

  // Helper functions for styling
  const getSignalColor = (signal: string) => {
    switch (signal) {
      case 'STRONG_BUY':
        return 'text-emerald-400 bg-gradient-to-br from-emerald-500/20 to-green-500/15 border-emerald-500/50 shadow-emerald-500/30';
      case 'BUY':
        return 'text-emerald-300 bg-gradient-to-br from-emerald-500/15 to-green-500/10 border-emerald-500/40 shadow-emerald-500/20';
      case 'SELL':
        return 'text-rose-300 bg-gradient-to-br from-rose-500/15 to-red-500/10 border-rose-500/40 shadow-rose-500/20';
      case 'STRONG_SELL':
        return 'text-rose-400 bg-gradient-to-br from-rose-500/20 to-red-500/15 border-rose-500/50 shadow-rose-500/30';
      default:
        return 'text-gray-400 bg-gradient-to-br from-gray-800/40 to-gray-700/30 border-gray-600/40 shadow-gray-800/20';
    }
  };

  const getPatternColor = (pattern: string) => {
    switch (pattern) {
      case 'REJECTION':
        return 'text-rose-400';
      case 'ABSORPTION':
        return 'text-emerald-400';
      case 'EMOTIONAL':
        return 'text-amber-400';
      case 'BREAKOUT_SETUP':
        return 'text-orange-400';
      case 'HEALTHY_MOVE':
        return 'text-cyan-400';
      default:
        return 'text-gray-400';
    }
  };

  const getIntentIcon = (intent: string) => {
    switch (intent) {
      case 'BULLISH':
        return <TrendingUp className="w-4 h-4 text-emerald-400" />;
      case 'BEARISH':
        return <TrendingDown className="w-4 h-4 text-rose-400" />;
      default:
        return <Minus className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <div className="bg-gradient-to-br from-gray-900 via-orange-950/10 to-gray-900 rounded-xl border-2 border-orange-500/40 hover:border-orange-400/60 transition-all shadow-xl shadow-orange-500/10 hover:shadow-orange-500/20 p-6">
      {/* Cached Data Status Badge */}
      {data.status === 'CACHED' && (
        <div className="mb-3 px-2 py-1 rounded-lg bg-blue-900/30 text-blue-200 border border-blue-700/40 text-[9px] font-semibold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
          📊 LAST MARKET SESSION DATA • Market Closed
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <div className="p-2 bg-orange-500/10 rounded-lg border border-orange-500/30">
            <Flame className="w-5 h-5 text-orange-400" />
          </div>
          <h3 className="text-lg font-bold text-white">{name}</h3>
        </div>
        <div className={`px-3 py-1 rounded-lg text-sm font-bold border-2 shadow-lg ${getSignalColor(data.professional_signal || 'NEUTRAL')}`}>
          {data.professional_signal?.replace('_', ' ') || 'N/A'}
        </div>
      </div>

      {/* Current Candle OHLCV */}
      <div className="grid grid-cols-5 gap-2 mb-4 text-xs">
        <div className="bg-gray-800/20 rounded-lg p-2 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-gray-400 text-[10px]">Open</div>
          <div className="text-white font-bold">₹{data.current_candle?.open?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-gray-800/20 rounded-lg p-2 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-gray-400 text-[10px]">High</div>
          <div className="text-emerald-400 font-bold">₹{data.current_candle?.high?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-gray-800/20 rounded-lg p-2 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-gray-400 text-[10px]">Low</div>
          <div className="text-rose-400 font-bold">₹{data.current_candle?.low?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-gray-800/20 rounded-lg p-2 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-gray-400 text-[10px]">Close</div>
          <div className={`font-bold ${(data.current_candle?.close || 0) >= (data.current_candle?.open || 0) ? 'text-emerald-400' : 'text-rose-400'}`}>
            ₹{data.current_candle?.close?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="bg-gray-800/20 rounded-lg p-2 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-gray-400 text-[10px]">Volume</div>
          <div className={`font-bold ${
            (data.volume_analysis?.volume_ratio || 0) >= 2 ? 'text-emerald-400' :
            (data.volume_analysis?.volume_ratio || 0) >= 1 ? 'text-cyan-400' : 'text-gray-400'
          }`}>
            {((data.volume_analysis?.volume || 0) / 1000).toFixed(0)}K
          </div>
        </div>
      </div>

      {/* Pattern Detection */}
      <div className="bg-gray-800/20 rounded-xl p-4 mb-4 border border-emerald-400/25 hover:border-emerald-400/35 transition-all backdrop-blur-sm">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className={`font-bold text-base ${getPatternColor(data.pattern?.type || 'NEUTRAL')}`}>
              {data.pattern?.type?.replace(/_/g, ' ') || 'N/A'}
            </span>
            {getIntentIcon(data.pattern?.intent || 'NEUTRAL')}
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Confidence: </span>
            <span className={`font-bold ${
              (data.pattern?.confidence || 0) >= 80 ? 'text-emerald-400' :
              (data.pattern?.confidence || 0) >= 60 ? 'text-amber-400' : 'text-gray-400'
            }`}>
              {data.pattern?.confidence || 0}%
            </span>
          </div>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">
          {data.pattern?.interpretation || 'No pattern data available'}
        </p>
      </div>

      {/* Wick Analysis */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between bg-gray-800/20 rounded-lg p-3 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="flex items-center space-x-3">
            <div className="w-2 h-10 bg-gradient-to-b from-rose-500/70 via-rose-400/60 to-transparent rounded-full"></div>
            <div>
              <div className="text-xs text-gray-400 font-semibold">Upper Wick</div>
              <div className="text-sm text-white font-bold">{data.wick_analysis?.upper_wick_pct?.toFixed(1) || '0.0'}%</div>
            </div>
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${
            data.wick_analysis?.upper_signal === 'BEARISH' ? 'bg-rose-500/10 text-rose-300 border-emerald-400/25' :
            data.wick_analysis?.upper_signal === 'SLIGHTLY_BEARISH' ? 'bg-amber-500/10 text-amber-300 border-emerald-400/25' :
            'bg-gray-800/40 text-gray-400 border-emerald-400/20'
          }`}>
            {data.wick_analysis?.upper_signal?.replace('_', ' ') || 'N/A'}
          </div>
        </div>

        <div className="flex items-center justify-between bg-gray-800/20 rounded-lg p-3 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="flex items-center space-x-3">
            <div className="w-2 h-10 bg-gradient-to-t from-emerald-500/70 via-emerald-400/60 to-transparent rounded-full"></div>
            <div>
              <div className="text-xs text-gray-400 font-semibold">Lower Wick</div>
              <div className="text-sm text-white font-bold">{data.wick_analysis?.lower_wick_pct?.toFixed(1) || '0.0'}%</div>
            </div>
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${
            data.wick_analysis?.lower_signal === 'BULLISH' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/25' :
            data.wick_analysis?.lower_signal === 'SLIGHTLY_BULLISH' ? 'bg-cyan-500/10 text-cyan-300 border-emerald-400/25' :
            'bg-gray-800/40 text-gray-400 border-emerald-400/20'
          }`}>
            {data.wick_analysis?.lower_signal?.replace('_', ' ') || 'N/A'}
          </div>
        </div>
      </div>

      {/* Body & Volume Analysis */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-gray-800/20 rounded-lg p-3 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-xs text-emerald-400 mb-1 font-bold">Body Structure</div>
          <div className={`text-sm font-bold mb-1 ${
            data.body_analysis?.color === 'GREEN' ? 'text-emerald-400' : 'text-rose-400'
          }`}>
            {data.body_analysis?.body_type?.replace('_', ' ') || 'N/A'}
          </div>
          <div className="text-xs text-gray-300 font-semibold">{data.body_analysis?.body_ratio_pct?.toFixed(1) || '0.0'}% of range</div>
        </div>

        <div className="bg-gray-800/20 rounded-lg p-3 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
          <div className="text-xs text-emerald-400 mb-1 font-bold">Volume Efficiency</div>
          <div className={`text-sm font-bold mb-1 ${
            data.volume_analysis?.efficiency === 'ABSORPTION' ? 'text-emerald-400' :
            data.volume_analysis?.efficiency === 'EMOTIONAL_MOVE' ? 'text-amber-400' :
            data.volume_analysis?.efficiency === 'HEALTHY' ? 'text-cyan-400' : 'text-gray-400'
          }`}>
            {data.volume_analysis?.efficiency?.replace('_', ' ') || 'N/A'}
          </div>
          <div className="text-xs text-gray-300 font-semibold">{data.volume_analysis?.volume_ratio?.toFixed(2) || '0.00'}x avg</div>
        </div>
      </div>

      {/* Volume Details */}
      <div className="bg-gray-800/20 rounded-lg p-3 mb-4 border border-emerald-400/25 hover:border-emerald-400/35 transition-all">
        <div className="text-xs text-emerald-400 mb-2 font-bold">Volume Analysis</div>
        <div className="grid grid-cols-3 gap-3 text-xs">
          <div>
            <div className="text-gray-400 mb-1">Current</div>
            <div className="text-white font-bold">{((data.volume_analysis?.volume || 0) / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-gray-400 mb-1">Average</div>
            <div className="text-gray-300 font-bold">{((data.volume_analysis?.avg_volume || 0) / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-gray-400 mb-1">Type</div>
            <div className={`font-bold ${
              data.volume_analysis?.volume_type === 'VERY_HIGH' ? 'text-emerald-400' :
              data.volume_analysis?.volume_type === 'HIGH' ? 'text-cyan-400' :
              data.volume_analysis?.volume_type === 'LOW' ? 'text-amber-400' : 'text-gray-400'
            }`}>
              {data.volume_analysis?.volume_type?.replace('_', ' ') || 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Zone Proximity Alert */}
      {data.near_zone && (
        <div className="bg-emerald-500/5 border border-emerald-400/30 rounded-lg p-3 mb-4 backdrop-blur-sm">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-emerald-400 animate-pulse" />
            <span className="text-sm text-emerald-300 font-bold">Near Support/Resistance Zone</span>
          </div>
          <p className="text-xs text-emerald-200 mt-1 font-semibold">Watch for breakout or bounce</p>
        </div>
      )}

      {/* Professional Insight */}
      <div className="bg-emerald-500/5 border border-emerald-400/25 rounded-lg p-3 backdrop-blur-sm">
        <div className="flex items-center space-x-2 mb-2">
          <Flame className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-bold text-emerald-300 flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
            Market Insights
          </span>
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">
          {data.volume_analysis?.efficiency_interpretation || 'No market insights available'}
        </p>
      </div>

      {/* Timestamp */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        {data.status === 'CACHED' && '📦 Cached • '}
        Last updated: {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'N/A'}
      </div>
    </div>
  );
});

CandleIntentCard.displayName = 'CandleIntentCard';

export default CandleIntentCard;

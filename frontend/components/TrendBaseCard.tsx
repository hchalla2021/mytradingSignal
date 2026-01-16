'use client';

import React, { memo, useEffect, useState } from 'react';
import { GitBranch, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// Production-safe logging - only logs in development
const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  error: console.error, // Always log errors
};

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
  const [previousData, setPreviousData] = useState<TrendBaseData | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [unchangedCount, setUnchangedCount] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(API_CONFIG.endpoint(`/api/advanced/trend-base/${symbol}`));
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        const currentRefresh = refreshCount + 1;
        setRefreshCount(currentRefresh);
        
        // Debug logging (development only)
        log.debug(`[TREND-BASE] Refresh #${currentRefresh} for ${symbol}`);
        
        // Alert for missing critical data
        if (!result.structure?.swing_points?.last_high || !result.structure?.swing_points?.last_low) {
          log.warn(`[TREND-BASE] ${symbol} missing swing point data`);
        }
        
        // Track changes from previous data
        if (previousData && previousData.structure && result.structure) {
          const hasChanged = 
            previousData.structure.integrity_score !== result.structure.integrity_score ||
            previousData.signal !== result.signal;
          
          if (hasChanged) {
            setUnchangedCount(0);
          } else {
            setUnchangedCount(prev => prev + 1);
          }
        }
        
        // Store previous data for next comparison
        setPreviousData(data);
        
        // 🔥 FIX: Check if backend returned error status (TOKEN_EXPIRED, ERROR, NO_DATA, etc.)
        if (result.status === 'TOKEN_EXPIRED' || result.status === 'ERROR' || !result.structure) {
          setError(result.message || 'Token expired - Please login');
          setData(null);
          setLoading(false);
          return;
        }
        
        // Handle CACHED_DATA status (last session data)
        if (result.status === 'CACHED_DATA') {
          setData({ ...result, _isCached: true });
          setError(null);
          setLoading(false);
          return;
        }
        
        // Handle NO_DATA status (market closed, no backup cache)
        if (result.status === 'NO_DATA') {
          setError(result.message || 'Market closed - No data available');
          setData(null);
          setLoading(false);
          return;
        }
        
        setData(result);
        setError(null);
      } catch (err) {
        setError('Data unavailable');
        log.error(`[TREND-BASE] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Optimized: 10s polling for live trend updates (backend cache is 5s)
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '10000', 10);
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
  
  // Value validation
  const hasValidData = structure && structure.swing_points && structure.swing_points.last_high > 0;
  const isStrongTrend = structure?.integrity_score >= 70;
  const isModerateTrend = structure?.integrity_score >= 50;

  return (
    <div className="bg-gradient-to-br from-slate-900/60 to-slate-800/60 border border-emerald-600/40 rounded-lg p-3 sm:p-4 hover:border-emerald-500/50 transition-all shadow-lg">
      {/* Data Status Alerts */}
      {!hasValidData && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-rose-900/40 text-rose-200 border border-rose-700/50 text-[10px] font-semibold flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          NO SWING DATA - Waiting for price swings to form
        </div>
      )}
      
      {/* Stale Data Warning */}
      {unchangedCount >= 3 && hasValidData && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-amber-900/40 text-amber-200 border border-amber-700/50 text-[10px] font-semibold flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          VALUES NOT CHANGING ({unchangedCount} refreshes) - Market may be closed or sideways
        </div>
      )}
      
      {/* Live Status */}
      {data.data_status === 'LIVE' && hasValidData && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-emerald-900/30 text-emerald-200 border border-emerald-700/40 text-[9px] font-semibold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
          LIVE TREND • Refresh #{refreshCount}
          {data.candles_analyzed && ` • ${data.candles_analyzed} Candles`}
          {unchangedCount === 0 && refreshCount > 1 && <span className="ml-1 text-emerald-300">✓ UPDATING</span>}
        </div>
      )}
      {data.status === 'CACHED' && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-blue-900/30 text-blue-200 border border-blue-700/40 text-[9px] font-semibold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-blue-400 rounded-full"></span>
          📊 LAST MARKET SESSION DATA • Market Closed
        </div>
      )}
      
      {/* Header - Trader Friendly */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-4 h-4 text-blue-300" />
          <h3 className="text-sm sm:text-base font-bold text-gray-100">{name}</h3>
          {data._isCached && (
            <span className="text-[9px] bg-amber-900/30 text-amber-200 px-1.5 py-0.5 rounded border border-amber-700/40 font-semibold">
              📊 LAST SESSION
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-bold border shadow-lg ${
          signal === 'BUY' ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50' :
          signal === 'SELL' ? 'bg-rose-900/40 text-rose-200 border-rose-700/50' :
          'bg-slate-800/60 text-slate-300 border-slate-600/50'
        }`}>
          {getSignalIcon(signal)}
          <span>{signal}</span>
        </div>
      </div>

      {/* Trend Structure - Beginner Friendly */}
      <div className="mb-3 bg-slate-800/40 rounded-xl p-3 border border-emerald-600/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-300 font-bold tracking-wide">📈 TREND PATTERN</span>
          <span className="text-2xl">{getStructureEmoji(structure.type)}</span>
        </div>
        <p className="text-sm font-bold ${
          structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? 'text-emerald-300' :
          structure.type.includes('LOWER-HIGH-LOWER-LOW') ? 'text-rose-300' :
          'text-slate-300'
        } leading-tight mb-2">
          {structure.type.replace(/-/g, ' ')}
        </p>
        
        {/* Beginner Explanation */}
        <div className="pt-2 border-t border-emerald-600/30">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
              <span className="text-emerald-300 font-semibold">✅ Uptrend: Price making higher peaks & higher valleys (Good for buying)</span>
            ) : structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
              <span className="text-rose-300 font-semibold">⚠️ Downtrend: Price making lower peaks & lower valleys (Risky for buying)</span>
            ) : (
              <span className="text-slate-300 font-semibold">⚠️ Sideways: No clear trend direction (Wait for confirmation)</span>
            )}
          </p>
        </div>
      </div>

      {/* Trend Strength - Eye Friendly */}
      <div className="mb-3 bg-slate-800/40 rounded-xl p-3 border border-emerald-600/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-300 font-bold tracking-wide">⚡ TREND STRENGTH</span>
          <span className="text-lg font-bold ${
            structure.integrity_score >= 70 ? 'text-emerald-300' :
            structure.integrity_score >= 50 ? 'text-amber-300' :
            'text-rose-300'
          }">{structure.integrity_score}%</span>
        </div>
        <div className="w-full bg-gradient-to-r from-rose-900/40 via-slate-700/50 to-emerald-900/40 rounded-full h-2.5 overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-700 rounded-full ${
              structure.integrity_score >= 70 ? 'bg-gradient-to-r from-emerald-400 to-emerald-300 shadow-lg shadow-emerald-500/40' :
              structure.integrity_score >= 50 ? 'bg-gradient-to-r from-amber-400 to-amber-300 shadow-lg shadow-amber-500/30' :
              'bg-gradient-to-r from-rose-400 to-rose-300 shadow-lg shadow-rose-500/40'
            }`}
            style={{ width: `${structure.integrity_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 font-semibold mt-1.5">
          <span className="text-rose-300">WEAK</span>
          <span className="text-slate-400">MODERATE</span>
          <span className="text-emerald-300">STRONG</span>
        </div>
        
        {/* Strength Explanation */}
        <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
          {structure.integrity_score >= 70 ? (
            <span className="text-emerald-300 font-semibold">✅ Strong trend - Pattern is intact and reliable</span>
          ) : structure.integrity_score >= 50 ? (
            <span className="text-amber-300 font-semibold">⚠️ Moderate trend - Some consistency but not perfect</span>
          ) : (
            <span className="text-rose-300 font-semibold">⚠️ Weak trend - Pattern is breaking or unclear</span>
          )}
        </p>
      </div>

      {/* Price Swings - Eye Friendly & Clear */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Last Peak (High) */}
        <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 rounded-xl p-3 border border-emerald-700/30 shadow-lg">
          <p className="text-[10px] text-emerald-200 font-bold tracking-wider mb-2">▲ LAST PEAK</p>
          <p className="text-base font-bold text-emerald-300 mb-1">
            {formatPrice(structure.swing_points.last_high)}
          </p>
          <div className="flex items-center justify-between text-[9px] text-emerald-200/70">
            <span>Previous: {formatPrice(structure.swing_points.prev_high)}</span>
            <span className={`px-1.5 py-0.5 rounded font-semibold ${
              structure.swing_points.high_diff >= 0 ? 'bg-emerald-800/40 text-emerald-200' : 'bg-rose-800/40 text-rose-200'
            }`}>
              {structure.swing_points.high_diff >= 0 ? '▲' : '▼'} {Math.abs(structure.swing_points.high_diff).toFixed(0)}
            </span>
          </div>
        </div>

        {/* Last Valley (Low) */}
        <div className="bg-gradient-to-br from-blue-900/20 to-blue-950/10 rounded-xl p-3 border border-blue-700/30 shadow-lg">
          <p className="text-[10px] text-blue-200 font-bold tracking-wider mb-2">▼ LAST VALLEY</p>
          <p className="text-base font-bold text-blue-300 mb-1">
            {formatPrice(structure.swing_points.last_low)}
          </p>
          <div className="flex items-center justify-between text-[9px] text-blue-200/70">
            <span>Previous: {formatPrice(structure.swing_points.prev_low)}</span>
            <span className={`px-1.5 py-0.5 rounded font-semibold ${
              structure.swing_points.low_diff >= 0 ? 'bg-emerald-800/40 text-emerald-200' : 'bg-rose-800/40 text-rose-200'
            }`}>
              {structure.swing_points.low_diff >= 0 ? '▲' : '▼'} {Math.abs(structure.swing_points.low_diff).toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Stats - Eye Friendly */}
      <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-emerald-600/30">
        <div className="bg-slate-800/30 rounded-lg p-2 border border-emerald-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">CONFIDENCE</p>
          <p className={`text-sm font-bold ${
            confidence >= 70 ? 'text-emerald-300' :
            confidence >= 50 ? 'text-amber-300' :
            'text-rose-300'
          }`}>{confidence}%</p>
        </div>
        <div className="bg-slate-800/30 rounded-lg p-2 border border-emerald-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">TREND</p>
          <p className={`text-sm font-bold ${
            trend === 'UPTREND' ? 'text-emerald-300' :
            trend === 'DOWNTREND' ? 'text-rose-300' :
            'text-slate-300'
          }`}>
            {trend === 'UPTREND' ? '↑ UP' : trend === 'DOWNTREND' ? '↓ DOWN' : 'SIDE'}
          </p>
        </div>
        <div className="bg-slate-800/30 rounded-lg p-2 border border-emerald-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">STATUS</p>
          <p className="text-sm font-bold text-slate-300">{data.status}</p>
        </div>
      </div>
      
      {/* Beginner Trading Advice */}
      <div className={`rounded-lg p-2.5 border ${
        isStrongTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? 'bg-emerald-900/20 border-emerald-700/40' :
        isStrongTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? 'bg-rose-900/20 border-rose-700/40' :
        'bg-slate-800/30 border-emerald-600/30'
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] text-slate-300 font-bold tracking-wider">💡 WHAT TO DO?</span>
        </div>
        <p className="text-[10px] text-slate-200 leading-relaxed">
          {!hasValidData ? (
            <span className="text-amber-300">⚠️ Waiting for swing points to form. Need more price movement.</span>
          ) : isStrongTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
            <span className="text-emerald-300">Strong uptrend! Price making higher peaks & valleys = Good time for buying.</span>
          ) : isModerateTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
            <span className="text-emerald-300">Moderate uptrend. Pattern present but not very strong yet.</span>
          ) : isStrongTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
            <span className="text-rose-300">Strong downtrend! Price making lower peaks & valleys = Avoid buying, wait.</span>
          ) : isModerateTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
            <span className="text-rose-300">Moderate downtrend. Be cautious with new positions.</span>
          ) : (
            <span className="text-slate-300">No clear trend. Price moving sideways. Wait for direction.</span>
          )}
        </p>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';

export default TrendBaseCard;

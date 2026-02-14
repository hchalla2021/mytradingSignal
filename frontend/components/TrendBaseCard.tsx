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
  data_status?: string;
  candles_analyzed?: number;
  _isCached?: boolean;
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

  // Calculate market status based confidence with enhanced accuracy
  const calculateTrendConfidence = (data: TrendBaseData): number => {
    if (!data || !data.structure) return 30;
    
    let confidence = 50; // Base confidence
    const { structure, signal, trend, status } = data;
    
    // Market Status Impact (20% weight)
    if (status === 'LIVE' || status === 'ACTIVE') {
      confidence += 15; // Live data is most accurate
    } else if (status === 'CACHED') {
      confidence += 5; // Cached data is still useful
    } else {
      confidence -= 10; // Offline data is less reliable
    }
    
    // Pattern Integrity Score (30% weight)
    const integrityScore = structure.integrity_score || 50;
    if (integrityScore >= 80) confidence += 25; // Very strong pattern
    else if (integrityScore >= 70) confidence += 20; // Strong pattern
    else if (integrityScore >= 60) confidence += 15; // Good pattern
    else if (integrityScore >= 50) confidence += 10; // Moderate pattern
    else if (integrityScore < 30) confidence -= 15; // Very weak pattern
    
    // Signal Clarity (20% weight)
    if (signal === 'BUY' || signal === 'SELL') {
      confidence += 12; // Clear directional signal
    } else if (signal === 'NEUTRAL') {
      confidence -= 8; // No clear direction
    }
    
    // Trend Consistency (15% weight)
    if (trend === 'UPTREND' || trend === 'DOWNTREND') {
      confidence += 10; // Clear trend direction
    } else if (trend === 'SIDEWAYS') {
      confidence -= 5; // Sideways = less reliable
    }
    
    // Pattern Type Quality (10% weight)
    if (structure.type) {
      if (structure.type.includes('HIGHER-HIGH-HIGHER-LOW') || structure.type.includes('LOWER-HIGH-LOWER-LOW')) {
        confidence += 8; // Classic trend patterns
      } else if (structure.type.includes('HIGHER-HIGH-LOWER-LOW')) {
        confidence -= 5; // Mixed pattern = topping/bottoming
      }
    }
    
    // Swing Points Quality (5% weight)
    if (structure.swing_points) {
      const hasValidSwings = structure.swing_points.last_high > 0 && structure.swing_points.last_low > 0;
      if (hasValidSwings) {
        confidence += 5; // Valid swing data
      } else {
        confidence -= 10; // Invalid/missing swing data
      }
    }
    
    // Market timing accuracy bonus
    const currentHour = new Date().getHours();
    if (status === 'LIVE' && currentHour >= 9 && currentHour <= 15) {
      confidence += 5; // Market hours boost for live data
    }
    
    return Math.min(95, Math.max(25, Math.round(confidence)));
  };

  // Check if we have valid swing data
  const hasValidData = !!(
    data?.structure?.swing_points?.last_high && 
    data?.structure?.swing_points?.last_low &&
    data?.structure?.swing_points?.last_high > 0 &&
    data?.structure?.swing_points?.last_low > 0
  );

  // Extract commonly used values from data
  const signal = data.signal || 'NEUTRAL';
  const structure = data.structure || { 
    type: 'UNKNOWN', 
    integrity_score: 0, 
    swing_points: {
      last_high: 0,
      last_low: 0,
      prev_high: 0,
      prev_low: 0,
      high_diff: 0,
      low_diff: 0
    }
  };
  const confidence = data.confidence || calculateTrendConfidence(data);
  const trend = data.trend || 'SIDEWAYS';
  const isStrongTrend = structure.integrity_score >= 70;
  const isModerateTrend = structure.integrity_score >= 40 && structure.integrity_score < 70;

  return (
    <div className="bg-gradient-to-br from-green-900/10 to-green-950/5 border-2 border-green-500/40 rounded-xl p-3 sm:p-4 hover:border-green-500/50 transition-all shadow-lg shadow-green-500/10">
      {/* Data Status Alerts */}
      {!hasValidData && (
        <div className="mb-2 px-2 py-1.5 rounded-lg bg-red-900/30 text-red-300 border border-red-500/40 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          NO SWING DATA - Waiting for price swings to form
        </div>
      )}
      
      {/* Stale Data Warning */}
      {unchangedCount >= 3 && hasValidData && (
        <div className="mb-2 px-2 py-1.5 rounded-lg bg-yellow-900/30 text-yellow-300 border border-yellow-500/40 text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          VALUES NOT CHANGING ({unchangedCount} refreshes) - Market may be closed
        </div>
      )}
      
      {/* Live Status */}
      {data.data_status === 'LIVE' && hasValidData && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/5 text-green-300 border border-green-500/40 text-xs font-semibold flex items-center gap-2">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
          LIVE TREND • Refresh #{refreshCount}
          {data.candles_analyzed && ` • ${data.candles_analyzed} Candles`}
          {unchangedCount === 0 && refreshCount > 1 && <span className="ml-1 text-green-300">✓ UPDATING</span>}
        </div>
      )}
      {data.status === 'CACHED' && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-blue-500/5 text-blue-300 border border-blue-500/40 text-xs font-semibold flex items-center gap-2">
          <span className="w-2 h-2 bg-blue-400 rounded-full"></span>
          📊 LAST MARKET SESSION DATA • Market Closed
        </div>
      )}
      
      {/* Header - Trader Friendly */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <GitBranch className="w-5 h-5 text-green-400" />
          <h3 className="text-base sm:text-lg font-bold text-white">{name}</h3>
          {data._isCached && (
            <span className="text-xs bg-yellow-900/30 text-yellow-300 px-2 py-1 rounded border border-yellow-500/40 font-semibold">
              📊 LAST SESSION
            </span>
          )}
        </div>
        <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border shadow-lg ${
          signal === 'BUY' ? 'bg-[#00C087]/20 text-[#00C087] border-[#00C087]/40' :
          signal === 'SELL' ? 'bg-[#EB5B3C]/20 text-[#EB5B3C] border-[#EB5B3C]/40' :
          'bg-gray-800/60 text-gray-300 border-gray-500/50'
        }`}>
          {getSignalIcon(signal)}
          <span>{signal}</span>
        </div>
      </div>

      {/* Trend Structure - Beginner Friendly */}
      <div className="mb-3 bg-green-500/5 rounded-xl p-3 border-2 border-green-500/30 shadow-sm">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white font-bold tracking-wide">📈 TREND PATTERN</span>
          <span className="text-3xl">{getStructureEmoji(structure.type)}</span>
        </div>
        <p className={`text-base font-bold leading-tight mb-2 ${
          structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? 'text-[#00C087]' :
          structure.type.includes('LOWER-HIGH-LOWER-LOW') ? 'text-[#EB5B3C]' :
          'text-gray-300'
        }`}>
          {structure.type.replace(/-/g, ' ')}
        </p>
        
        {/* Beginner Explanation */}
        <div className="pt-2 border-t border-green-500/30">
          <p className="text-xs text-gray-300 leading-relaxed">
            {structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
              <span className="text-[#00C087] font-semibold">✅ Uptrend: Price making higher peaks & higher valleys (Good for buying)</span>
            ) : structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
              <span className="text-[#EB5B3C] font-semibold">⚠️ Downtrend: Price making lower peaks & lower valleys (Risky for buying)</span>
            ) : (
              <span className="text-gray-300 font-semibold">⚠️ Sideways: No clear trend direction (Wait for confirmation)</span>
            )}
          </p>
        </div>
      </div>

      {/* Trend Strength - Eye Friendly */}
      <div className="mb-3 bg-green-500/5 rounded-xl p-3 border-2 border-green-500/30 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-white font-bold tracking-wide">⚡ TREND STRENGTH</span>
          <span className={`text-2xl font-bold ${
            structure.integrity_score >= 70 ? 'text-[#00C087]' :
            structure.integrity_score >= 50 ? 'text-yellow-400' :
            'text-[#EB5B3C]'
          }`}>{structure.integrity_score}%</span>
        </div>
        <div className="w-full bg-gray-800/50 rounded-full h-3 overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-700 rounded-full ${
              structure.integrity_score >= 70 ? 'bg-gradient-to-r from-[#00C087] to-green-400 shadow-lg shadow-green-500/40' :
              structure.integrity_score >= 50 ? 'bg-gradient-to-r from-yellow-500 to-yellow-400 shadow-lg shadow-yellow-500/30' :
              'bg-gradient-to-r from-[#EB5B3C] to-red-400 shadow-lg shadow-red-500/40'
            }`}
            style={{ width: `${structure.integrity_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-xs text-gray-400 font-semibold mt-2">
          <span className="text-[#EB5B3C]">WEAK</span>
          <span className="text-gray-400">MODERATE</span>
          <span className="text-[#00C087]">STRONG</span>
        </div>
        
        {/* Strength Explanation */}
        <p className="text-xs text-gray-300 mt-2 leading-relaxed">
          {structure.integrity_score >= 70 ? (
            <span className="text-[#00C087] font-semibold">✅ Strong trend - Pattern is intact and reliable</span>
          ) : structure.integrity_score >= 50 ? (
            <span className="text-yellow-400 font-semibold">⚠️ Moderate trend - Some consistency but not perfect</span>
          ) : (
            <span className="text-[#EB5B3C] font-semibold">⚠️ Weak trend - Pattern is breaking or unclear</span>
          )}
        </p>
      </div>

      {/* Price Swings - Eye Friendly & Clear */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Last Peak (High) */}
        <div className="bg-gradient-to-br from-green-500/15 to-green-500/8 rounded-xl p-3 border-2 border-green-500/40 shadow-lg">
          <p className="text-xs text-green-300 font-bold tracking-wider mb-2">▲ LAST PEAK</p>
          <p className="text-xl font-bold text-[#00C087] mb-1">
            {formatPrice(structure.swing_points.last_high)}
          </p>
          <div className="flex flex-col gap-1 text-xs text-green-300/80">
            <span>Prev: {formatPrice(structure.swing_points.prev_high)}</span>
            <span className={`px-2 py-1 rounded font-semibold text-center ${
              structure.swing_points.high_diff >= 0 ? 'bg-green-800/40 text-[#00C087]' : 'bg-red-800/40 text-[#EB5B3C]'
            }`}>
              {structure.swing_points.high_diff >= 0 ? '▲' : '▼'} {Math.abs(structure.swing_points.high_diff).toFixed(0)}
            </span>
          </div>
        </div>

        {/* Last Valley (Low) */}
        <div className="bg-gradient-to-br from-blue-500/15 to-blue-500/8 rounded-xl p-3 border-2 border-blue-500/40 shadow-lg">
          <p className="text-xs text-blue-300 font-bold tracking-wider mb-2">▼ LAST VALLEY</p>
          <p className="text-xl font-bold text-blue-400 mb-1">
            {formatPrice(structure.swing_points.last_low)}
          </p>
          <div className="flex flex-col gap-1 text-xs text-blue-300/80">
            <span>Prev: {formatPrice(structure.swing_points.prev_low)}</span>
            <span className={`px-2 py-1 rounded font-semibold text-center ${
              structure.swing_points.low_diff >= 0 ? 'bg-green-800/40 text-[#00C087]' : 'bg-red-800/40 text-[#EB5B3C]'
            }`}>
              {structure.swing_points.low_diff >= 0 ? '▲' : '▼'} {Math.abs(structure.swing_points.low_diff).toFixed(0)}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Stats - Eye Friendly */}
      <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-green-500/30">
        <div className="bg-green-500/5 rounded-lg p-2 border border-green-500/30">
          <p className="text-xs text-gray-400 font-semibold mb-1">CONFIDENCE</p>
          <p className={`text-base font-bold ${
            confidence >= 70 ? 'text-[#00C087]' :
            confidence >= 50 ? 'text-yellow-400' :
            'text-[#EB5B3C]'
          }`}>{confidence}%</p>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2 border border-green-500/30">
          <p className="text-xs text-gray-400 font-semibold mb-1">TREND</p>
          <p className={`text-base font-bold ${
            trend === 'UPTREND' ? 'text-[#00C087]' :
            trend === 'DOWNTREND' ? 'text-[#EB5B3C]' :
            'text-gray-300'
          }`}>
            {trend === 'UPTREND' ? '↑ UP' : trend === 'DOWNTREND' ? '↓ DOWN' : 'SIDE'}
          </p>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2 border border-green-500/30">
          <p className="text-xs text-gray-400 font-semibold mb-1">STATUS</p>
          <p className="text-base font-bold text-gray-300">{data.status}</p>
        </div>
      </div>
      
      {/* Beginner Trading Advice */}
      <div className={`rounded-xl p-3 border-2 shadow-sm ${
        isStrongTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? 'bg-green-500/10 border-green-500/40' :
        isStrongTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? 'bg-rose-500/10 border-red-500/40' :
        'bg-green-500/5 border-green-500/30'
      }`}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-white font-bold tracking-wider">💡 WHAT TO DO?</span>
        </div>
        <p className="text-xs text-white leading-relaxed">
          {!hasValidData ? (
            <span className="text-yellow-400">⚠️ Waiting for swing points to form. Need more price movement.</span>
          ) : isStrongTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
            <span className="text-[#00C087] font-semibold">Strong uptrend! Price making higher peaks & valleys = Good time for buying.</span>
          ) : isModerateTrend && structure.type.includes('HIGHER-HIGH-HIGHER-LOW') ? (
            <span className="text-[#00C087]">Moderate uptrend. Pattern present but not very strong yet.</span>
          ) : isStrongTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
            <span className="text-[#EB5B3C] font-semibold">Strong downtrend! Price making lower peaks & valleys = Avoid buying, wait.</span>
          ) : isModerateTrend && structure.type.includes('LOWER-HIGH-LOWER-LOW') ? (
            <span className="text-[#EB5B3C]">Moderate downtrend. Be cautious with new positions.</span>
          ) : (
            <span className="text-gray-300">No clear trend. Price moving sideways. Wait for direction.</span>
          )}
        </p>
      </div>
    </div>
  );
});

TrendBaseCard.displayName = 'TrendBaseCard';

export default TrendBaseCard;

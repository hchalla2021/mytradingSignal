'use client';

import React, { memo, useEffect, useState } from 'react';
import { Activity, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';

// Production-safe logging
const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  error: console.error,
};

interface VolumePulseData {
  symbol: string;
  volume_data: {
    green_candle_volume: number;
    red_candle_volume: number;
    green_percentage: number;
    red_percentage: number;
    ratio: number;
  };
  pulse_score: number;
  signal: string;
  confidence: number;
  trend: string;
  status: string;
  timestamp: string;
}

interface VolumePulseCardProps {
  symbol: string;
  name: string;
}

const VolumePulseCard = memo<VolumePulseCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<VolumePulseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(API_CONFIG.endpoint(`/api/advanced/volume-pulse/${symbol}`));
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        // Debug logging (development only)
        log.debug(`[VOLUME-PULSE] ${symbol}: signal=${result.signal}, pulse=${result.pulse_score}`);
        
        setData(result);
        setError(null);
      } catch (err) {
        setError('Data unavailable');
        log.error(`[VOLUME-PULSE] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Optimized: 15s polling to reduce API load (was 5s)
    const refreshInterval = parseInt(process.env.NEXT_PUBLIC_REFRESH_INTERVAL || '15000', 10);
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
    return <Activity className="w-4 h-4" />;
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

  const formatVolume = (vol: number): string => {
    if (vol >= 10000000) return `${(vol / 10000000).toFixed(2)} Cr`;
    if (vol >= 100000) return `${(vol / 100000).toFixed(2)} L`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(1)} K`;
    return vol.toString();
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

  const { volume_data, pulse_score, signal, confidence, trend } = data;
  
  // 🚨 Volume Health Check
  const totalVolume = volume_data.green_candle_volume + volume_data.red_candle_volume;
  const isLowVolume = totalVolume < 100000; // Less than 1L total
  const hasData = totalVolume > 0;

  return (
    <div className="bg-gradient-to-br from-slate-900/60 to-slate-800/60 border border-slate-600/40 rounded-lg p-3 sm:p-4 hover:border-slate-500/50 transition-all shadow-lg">
      {/* Volume Health Alert */}
      {!hasData && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-rose-900/40 text-rose-200 border border-rose-700/50 text-[10px] font-semibold flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          NO VOLUME DATA - May be outside trading hours or data issue
        </div>
      )}
      {hasData && isLowVolume && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-amber-900/40 text-amber-200 border border-amber-700/50 text-[10px] font-semibold flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          LOW VOLUME ({formatVolume(totalVolume)}) - Wait for higher activity
        </div>
      )}
      
      {/* Live Status - Eye Friendly */}
      {data.status === 'LIVE' && hasData && !isLowVolume && (
        <div className="mb-2 px-2 py-1 rounded-lg bg-emerald-900/30 text-emerald-200 border border-emerald-700/40 text-[9px] font-semibold flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
          LIVE VOLUME
          {data.candles_analyzed && ` • ${data.candles_analyzed} Candles`}
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
          <Activity className="w-4 h-4 text-purple-300" />
          <h3 className="text-sm sm:text-base font-bold text-gray-100">{name}</h3>
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

      {/* Buying Pressure - FAST Recognition */}
      <div className="mb-3 bg-slate-800/40 rounded-xl p-3 border border-slate-600/30">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-300 font-bold tracking-wide">⚡ BUYING PRESSURE</span>
          <span className="text-lg font-bold ${
            pulse_score >= 70 ? 'text-emerald-300' : 
            pulse_score >= 50 ? 'text-amber-300' : 
            'text-rose-300'
          }">{pulse_score}%</span>
        </div>
        <div className="w-full bg-gradient-to-r from-rose-900/40 via-slate-700/50 to-emerald-900/40 rounded-full h-2.5 overflow-hidden shadow-inner">
          <div
            className={`h-full transition-all duration-700 rounded-full ${
              pulse_score >= 70 ? 'bg-gradient-to-r from-emerald-400 to-emerald-300 shadow-lg shadow-emerald-500/40' : 
              pulse_score >= 50 ? 'bg-gradient-to-r from-amber-400 to-amber-300 shadow-lg shadow-amber-500/30' : 
              'bg-gradient-to-r from-rose-400 to-rose-300 shadow-lg shadow-rose-500/40'
            }`}
            style={{ width: `${pulse_score}%` }}
          ></div>
        </div>
        <div className="flex justify-between text-[10px] text-slate-400 font-semibold mt-1.5">
          <span className="text-rose-300">🔴 SELLERS</span>
          <span className="text-slate-400">NEUTRAL</span>
          <span className="text-emerald-300">🟢 BUYERS</span>
        </div>
        
        {/* Beginner Explanation */}
        <div className="mt-2 pt-2 border-t border-slate-600/30">
          <p className="text-[10px] text-slate-400 leading-relaxed">
            {pulse_score >= 70 ? (
              <span className="text-emerald-300 font-semibold">✅ Strong Buying: More people buying (green candles have higher volume)</span>
            ) : pulse_score >= 50 ? (
              <span className="text-amber-300 font-semibold">⚠️ Balanced: Equal buying & selling pressure</span>
            ) : (
              <span className="text-rose-300 font-semibold">⚠️ Strong Selling: More people selling (red candles have higher volume)</span>
            )}
          </p>
        </div>
      </div>

      {/* REAL CANDLE VOLUME - Eye-Friendly & FAST */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* BUY Candles (Green) */}
        <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 rounded-xl p-3 border border-emerald-700/30 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-emerald-400/5 rounded-full -mr-6 -mt-6"></div>
          <div className="flex items-center justify-between mb-2 relative z-10">
            <p className="text-[10px] text-emerald-200 font-bold tracking-wider">🟢 BUY CANDLES</p>
            {data.status === 'LIVE' && (
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse shadow-lg shadow-emerald-400/50"></span>
            )}
          </div>
          <p className="text-lg sm:text-xl font-bold text-emerald-300 mb-1 relative z-10">
            {formatVolume(volume_data.green_candle_volume)}
          </p>
          <div className="flex items-center gap-2 relative z-10 mb-1">
            <div className="flex-1 bg-slate-700/40 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${volume_data.green_percentage}%` }}></div>
            </div>
            <span className="text-xs text-emerald-300 font-semibold">{volume_data.green_percentage.toFixed(0)}%</span>
          </div>
          <p className="text-[9px] text-emerald-200/70 relative z-10">When price went UP</p>
        </div>

        {/* SELL Candles (Red) */}
        <div className="bg-gradient-to-br from-rose-900/20 to-rose-950/10 rounded-xl p-3 border border-rose-700/30 shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-16 h-16 bg-rose-400/5 rounded-full -mr-6 -mt-6"></div>
          <div className="flex items-center justify-between mb-2 relative z-10">
            <p className="text-[10px] text-rose-200 font-bold tracking-wider">🔴 SELL CANDLES</p>
            {data.status === 'LIVE' && (
              <span className="w-1.5 h-1.5 bg-rose-400 rounded-full animate-pulse shadow-lg shadow-rose-400/50"></span>
            )}
          </div>
          <p className="text-lg sm:text-xl font-bold text-rose-300 mb-1 relative z-10">
            {formatVolume(volume_data.red_candle_volume)}
          </p>
          <div className="flex items-center gap-2 relative z-10 mb-1">
            <div className="flex-1 bg-slate-700/40 rounded-full h-1 overflow-hidden">
              <div className="h-full bg-rose-400 rounded-full" style={{ width: `${volume_data.red_percentage}%` }}></div>
            </div>
            <span className="text-xs text-rose-300 font-semibold">{volume_data.red_percentage.toFixed(0)}%</span>
          </div>
          <p className="text-[9px] text-rose-200/70 relative z-10">When price went DOWN</p>
        </div>
      </div>

      {/* Trading Metrics - Eye Friendly */}
      <div className="grid grid-cols-3 gap-2 mb-3 pt-3 border-t border-slate-600/30">
        <div className="bg-slate-800/30 rounded-lg p-2 border border-slate-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">RATIO</p>
          <p className="text-sm font-bold ${
            volume_data.ratio > 1.5 ? 'text-emerald-300' :
            volume_data.ratio < 0.67 ? 'text-rose-300' :
            'text-slate-300'
          }">{volume_data.ratio.toFixed(2)}</p>
        </div>
        <div className="bg-slate-800/30 rounded-lg p-2 border border-slate-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">CONFIDENCE</p>
          <p className={`text-sm font-bold ${
            confidence >= 70 ? 'text-emerald-300' :
            confidence >= 50 ? 'text-amber-300' :
            'text-rose-300'
          }`}>{confidence}%</p>
        </div>
        <div className="bg-slate-800/30 rounded-lg p-2 border border-slate-600/30">
          <p className="text-[9px] text-slate-400 font-semibold mb-1">TREND</p>
          <p className={`text-sm font-bold ${
            trend === 'BULLISH' ? 'text-emerald-300' : 
            trend === 'BEARISH' ? 'text-rose-300' : 
            'text-slate-300'
          }`}>
            {trend}
          </p>
        </div>
      </div>
      
      {/* Beginner Trading Advice */}
      <div className={`rounded-lg p-2.5 border ${
        signal === 'BUY' ? 'bg-emerald-900/20 border-emerald-700/40' :
        signal === 'SELL' ? 'bg-rose-900/20 border-rose-700/40' :
        'bg-slate-800/30 border-slate-600/30'
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          <span className="text-[9px] text-slate-300 font-bold tracking-wider">💡 WHAT TO DO?</span>
        </div>
        <p className="text-[10px] text-slate-200 leading-relaxed">
          {!hasData ? (
            <span className="text-amber-300">⚠️ No volume data. Market may be closed or wait for trading hours.</span>
          ) : isLowVolume ? (
            <span className="text-amber-300">⚠️ Very low volume ({formatVolume(totalVolume)}). Wait for more activity before trading.</span>
          ) : signal === 'BUY' && confidence >= 70 ? (
            <span className="text-emerald-300">Strong buying happening! More green candles with high volume = buyers in control.</span>
          ) : signal === 'BUY' && confidence >= 50 ? (
            <span className="text-emerald-300">Moderate buying seen. Green volume higher but not very strong yet.</span>
          ) : signal === 'SELL' && confidence >= 70 ? (
            <span className="text-rose-300">Strong selling happening! More red candles with high volume = sellers in control.</span>
          ) : signal === 'SELL' && confidence >= 50 ? (
            <span className="text-rose-300">Moderate selling seen. Red volume higher but not very strong yet.</span>
          ) : (
            <span className="text-slate-300">Balanced volume. No clear direction yet. Wait for confirmation.</span>
          )}
        </p>
      </div>
    </div>
  );
});

VolumePulseCard.displayName = 'VolumePulseCard';

export default VolumePulseCard;

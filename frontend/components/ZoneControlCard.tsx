'use client';

import React, { memo, useEffect, useState } from 'react';
import { Target, Shield, AlertOctagon, TrendingDown, TrendingUp, CircleDot } from 'lucide-react';

// Production-safe logging
const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  warn: (...args: unknown[]) => isDev && console.warn(...args),
  error: console.error,
};

interface Zone {
  level: number;
  touches: number;
  volume_strength: number;
  distance_pct: number;
  strength: number;
  active: boolean;
}

interface ZoneControlData {
  symbol: string;
  current_price: number;
  zones: {
    support: Zone[];
    resistance: Zone[];
  };
  nearest_zones: {
    support: {
      level: number | null;
      distance_pct: number | null;
      strength: number;
      touches: number;
      zone_label?: string;
    };
    resistance: {
      level: number | null;
      distance_pct: number | null;
      strength: number;
      touches: number;
      zone_label?: string;
    };
  };
  // 🔥 Top-level risk fields (NEW API structure)
  breakdown_risk: number;
  bounce_probability: number;
  zone_strength: string;
  // Professional quality metrics (nested, for future use)
  risk_metrics: {
    nearest_support_quality?: any;
    nearest_resistance_quality?: any;
    overall_zone_health?: string;
  };
  signal: string;
  confidence: number;
  recommendation: string;
  timestamp: string;
  status?: string;  // LIVE, HISTORICAL, ERROR
  message?: string;  // Status message
  candles_analyzed?: number;
}

interface ZoneControlCardProps {
  symbol: string;
  name: string;
}

const ZoneControlCard = memo<ZoneControlCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<ZoneControlData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://mydailytradesignals.com';
        const response = await fetch(`${apiUrl}/api/advanced/zone-control/${symbol}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        // Debug logging (development only)
        log.debug(`[ZONE-CONTROL] Data for ${symbol}:`, result.signal, result.confidence);
        
        // Check for error statuses
        if (result.status === 'TOKEN_EXPIRED' || result.status === 'ERROR') {
          setError(result.message || 'Token expired - Please login');
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
        log.error(`[ZONE-CONTROL] Error fetching ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    // Refresh every 10 seconds for live updates (faster than other cards)
    const interval = setInterval(fetchData, 10000);

    return () => clearInterval(interval);
  }, [symbol]);

  const getSignalColor = (signal: string) => {
    if (signal === 'BUY_ZONE') return 'text-emerald-400';
    if (signal === 'SELL_ZONE') return 'text-rose-400';
    return 'text-amber-400';
  };

  const getSignalBg = (signal: string) => {
    if (signal === 'BUY_ZONE') return 'bg-emerald-500/10 border-emerald-500/30';
    if (signal === 'SELL_ZONE') return 'bg-rose-500/10 border-rose-500/30';
    return 'bg-amber-500/10 border-amber-500/30';
  };

  const getRiskColor = (risk: number) => {
    if (risk >= 70) return 'text-rose-500';
    if (risk >= 50) return 'text-amber-500';
    return 'text-emerald-500';
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
    if (upperSignal.includes('BUY') || upperSignal === 'BULLISH' || upperSignal === 'BUY_ZONE') {
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
    if (upperSignal.includes('SELL') || upperSignal === 'BEARISH' || upperSignal === 'SELL_ZONE') {
      return 'bg-rose-950/30 text-rose-400 border-rose-500/50';
    }
    // NEUTRAL/WAIT - Gray
    if (upperSignal === 'NEUTRAL' || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') {
      return 'bg-gray-950/30 text-gray-400 border-gray-500/40';
    }
    // Other - Amber
    return 'bg-amber-950/30 text-amber-400 border-amber-500/40';
  };

  const getBounceColor = (prob: number) => {
    if (prob >= 70) return 'text-emerald-500';
    if (prob >= 50) return 'text-amber-500';
    return 'text-rose-500';
  };

  const getZoneStrengthColor = (strength: string) => {
    if (strength === 'STRONG') return 'text-emerald-400';
    if (strength === 'MODERATE') return 'text-amber-400';
    return 'text-rose-400';
  };

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'N/A';
    return `₹${price.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="bg-dark-card border-2 border-emerald-500/30 rounded-lg p-3 sm:p-4 animate-pulse shadow-lg shadow-emerald-500/10">
        <div className="h-32 bg-dark-border rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-dark-card border-2 border-rose-500/30 rounded-lg p-3 sm:p-4 shadow-lg shadow-rose-500/10">
        <div className="flex items-center gap-2 text-rose-400 text-sm font-bold">
          <AlertOctagon className="w-4 h-4" />
          <span>{name} - Connection Error</span>
        </div>
        <p className="text-[10px] text-dark-muted mt-2">Retrying...</p>
      </div>
    );
  }

  const { current_price, nearest_zones, breakdown_risk, bounce_probability, zone_strength, signal, confidence, recommendation, status, message, candles_analyzed } = data;

  return (
    <div className="bg-dark-card border-2 border-emerald-500/30 rounded-lg p-3 sm:p-4 hover:border-emerald-400/50 hover:shadow-emerald-500/20 transition-all shadow-lg shadow-emerald-500/10">
      {/* Header with unique styling */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-emerald-400 animate-pulse" />
          <h3 className="text-sm sm:text-base font-bold text-white tracking-wide">{name}</h3>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-black border ${getSignalBg(signal)} ${getSignalColor(signal)}`}>
          {signal === 'BUY_ZONE' && <Shield className="w-3.5 h-3.5" />}
          {signal === 'SELL_ZONE' && <AlertOctagon className="w-3.5 h-3.5" />}
          {signal === 'NEUTRAL' && <CircleDot className="w-3.5 h-3.5" />}
          <span>{signal.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Live Status Indicator - Always show when data is live */}
      {status === 'LIVE' && (
        <div className="mb-3 p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-2">
          <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
          LIVE MARKET DATA
          {candles_analyzed && candles_analyzed > 0 && ` • ${candles_analyzed} candles`}
        </div>
      )}
      
      {/* Historical Data - Only show if market is closed */}
      {status && status === 'HISTORICAL' && (
        <div className="mb-3 p-2 rounded-lg text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/30">
          📊 Last session data - Market closed
          {candles_analyzed && candles_analyzed > 0 && ` • ${candles_analyzed} candles`}
        </div>
      )}

      {/* Token Expired Warning - Only show if token actually expired */}
      {status && status === 'TOKEN_EXPIRED' && (
        <div className="mb-3 p-2 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/30 text-[10px] font-bold">
          🔑 Token expired - Click LOGIN in header to refresh
        </div>
      )}

      {/* Current Price - Eye-Friendly Display */}
      <div className="mb-4 p-4 bg-gradient-to-br from-slate-800/60 via-gray-800/50 to-slate-900/60 rounded-xl border border-slate-600/40 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-slate-300 font-bold tracking-wider">CURRENT PRICE</p>
          <div className="flex items-center gap-1">
            {nearest_zones.support.distance_pct !== null && nearest_zones.support.distance_pct < 0 ? (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-emerald-900/40 text-emerald-300 font-semibold">↑ Above Support</span>
            ) : (
              <span className="text-[9px] px-2 py-0.5 rounded-full bg-rose-900/40 text-rose-300 font-semibold">↓ Below Support</span>
            )}
          </div>
        </div>
        <p className="text-xl sm:text-2xl font-bold text-gray-100 tracking-tight mb-1">{formatPrice(current_price)}</p>
        <div className="flex items-center gap-2 text-[10px]">
          {nearest_zones.support.level && (
            <span className="text-gray-400">Gap to Support: <span className="text-emerald-300 font-semibold">{Math.abs(nearest_zones.support.distance_pct || 0).toFixed(2)}%</span></span>
          )}
          {nearest_zones.resistance.level && (
            <span className="text-gray-400">• Gap to Resistance: <span className="text-rose-300 font-semibold">{Math.abs(nearest_zones.resistance.distance_pct || 0).toFixed(2)}%</span></span>
          )}
        </div>
      </div>

      {/* Zone Information - Dual Panel */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Support Zone - BUY SIDE - Eye Friendly */}
        <div className="bg-gradient-to-br from-emerald-900/30 to-emerald-950/20 rounded-xl p-3 border border-emerald-700/30 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            <p className="text-xs text-emerald-200 font-bold tracking-wider">BUY ZONE</p>
            {nearest_zones.support.zone_label && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-emerald-800/40 text-emerald-200 font-semibold ml-auto">
                {nearest_zones.support.zone_label}
              </span>
            )}
          </div>
          {nearest_zones.support.level !== null ? (
            <>
              <p className="text-lg sm:text-xl font-bold text-emerald-300 mb-3 tracking-tight">
                {formatPrice(nearest_zones.support.level)}
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-black/30 rounded-lg px-2 py-1.5">
                  <span className="text-xs text-emerald-100 font-semibold">Distance</span>
                  <span className="text-sm font-semibold text-gray-100">
                    {Math.abs(nearest_zones.support.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center bg-black/30 rounded-lg px-2 py-1.5">
                  <span className="text-xs text-emerald-100 font-semibold">Reliability</span>
                  <div className="flex items-center gap-2">
                    <div className="w-12 bg-gray-700/60 rounded-full h-1.5">
                      <div className={`h-full rounded-full ${
                        nearest_zones.support.strength >= 70 ? 'bg-emerald-400' :
                        nearest_zones.support.strength >= 50 ? 'bg-amber-400' : 'bg-gray-400'
                      }`} style={{ width: `${nearest_zones.support.strength}%` }}></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-100">
                      {nearest_zones.support.strength}%
                    </span>
                  </div>
                </div>
                <div className="text-center text-xs text-emerald-200 font-semibold bg-emerald-900/30 rounded-lg py-1">
                  Tested {nearest_zones.support.touches}x • {nearest_zones.support.strength >= 70 ? 'Strong' : nearest_zones.support.strength >= 50 ? 'Moderate' : 'Weak'}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 font-semibold">No support zone</p>
          )}
        </div>

        {/* Resistance Zone - SELL SIDE - Eye Friendly */}
        <div className="bg-gradient-to-br from-rose-900/30 to-rose-950/20 rounded-xl p-3 border border-rose-700/30 shadow-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertOctagon className="w-4 h-4 text-rose-400" />
            <p className="text-xs text-rose-200 font-bold tracking-wider">SELL ZONE</p>
            {nearest_zones.resistance.zone_label && (
              <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-rose-800/40 text-rose-200 font-semibold ml-auto">
                {nearest_zones.resistance.zone_label}
              </span>
            )}
          </div>
          {nearest_zones.resistance.level !== null ? (
            <>
              <p className="text-lg sm:text-xl font-bold text-rose-300 mb-3 tracking-tight">
                {formatPrice(nearest_zones.resistance.level)}
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-black/30 rounded-lg px-2 py-1.5">
                  <span className="text-xs text-rose-100 font-semibold">Distance</span>
                  <span className="text-sm font-semibold text-gray-100">
                    {Math.abs(nearest_zones.resistance.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center bg-black/30 rounded-lg px-2 py-1.5">
                  <span className="text-xs text-rose-100 font-semibold">Reliability</span>
                  <div className="flex items-center gap-2">
                    <div className="w-12 bg-gray-700/60 rounded-full h-1.5">
                      <div className={`h-full rounded-full ${
                        nearest_zones.resistance.strength >= 70 ? 'bg-rose-400' :
                        nearest_zones.resistance.strength >= 50 ? 'bg-amber-400' : 'bg-gray-400'
                      }`} style={{ width: `${nearest_zones.resistance.strength}%` }}></div>
                    </div>
                    <span className="text-sm font-semibold text-gray-100">
                      {nearest_zones.resistance.strength}%
                    </span>
                  </div>
                </div>
                <div className="text-center text-xs text-rose-200 font-semibold bg-rose-900/30 rounded-lg py-1">
                  Tested {nearest_zones.resistance.touches}x • {nearest_zones.resistance.strength >= 70 ? 'Strong' : nearest_zones.resistance.strength >= 50 ? 'Moderate' : 'Weak'}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400 font-semibold">No resistance zone</p>
          )}
        </div>
      </div>

      {/* Risk Analysis - Eye-Friendly Colors */}
      <div className="mb-4 p-4 bg-gradient-to-br from-slate-800/40 to-slate-900/40 rounded-xl border border-slate-600/30 shadow-lg">
        <p className="text-xs text-slate-300 font-bold tracking-wider mb-3 text-center">⚡ RISK CHECK</p>
        
        <div className="grid grid-cols-2 gap-4 mb-3">
          {/* Breakdown Risk */}
          <div className="bg-gradient-to-br from-rose-900/20 to-rose-950/10 rounded-lg p-3 border border-rose-800/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <TrendingDown className="w-4 h-4 text-rose-300" />
                <span className="text-[10px] text-rose-200 font-bold">BREAK RISK</span>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                breakdown_risk >= 70 ? 'bg-rose-900/50 text-rose-200' :
                breakdown_risk >= 50 ? 'bg-amber-900/50 text-amber-200' :
                'bg-emerald-900/50 text-emerald-200'
              }`}>
                {breakdown_risk >= 70 ? 'HIGH' : breakdown_risk >= 50 ? 'MEDIUM' : 'LOW'}
              </span>
            </div>
            <p className={`text-xl font-bold ${getRiskColor(breakdown_risk)}`}>
              {breakdown_risk}%
            </p>
            <div className="mt-2 w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  breakdown_risk >= 70 ? 'bg-rose-400' :
                  breakdown_risk >= 50 ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
                style={{ width: `${breakdown_risk}%` }}
              ></div>
            </div>
          </div>

          {/* Bounce Probability */}
          <div className="bg-gradient-to-br from-emerald-900/20 to-emerald-950/10 rounded-lg p-3 border border-emerald-800/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4 text-emerald-300" />
                <span className="text-[10px] text-emerald-200 font-bold">BOUNCE UP</span>
              </div>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold ${
                bounce_probability >= 70 ? 'bg-emerald-900/50 text-emerald-200' :
                bounce_probability >= 50 ? 'bg-amber-900/50 text-amber-200' :
                'bg-rose-900/50 text-rose-200'
              }`}>
                {bounce_probability >= 70 ? 'HIGH' : bounce_probability >= 50 ? 'MEDIUM' : 'LOW'}
              </span>
            </div>
            <p className={`text-xl font-bold ${getBounceColor(bounce_probability)}`}>
              {bounce_probability}%
            </p>
            <div className="mt-2 w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  bounce_probability >= 70 ? 'bg-emerald-400' :
                  bounce_probability >= 50 ? 'bg-amber-400' : 'bg-rose-400'
                }`}
                style={{ width: `${bounce_probability}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Zone Health Summary */}
        <div className={`text-center py-2 rounded-lg font-semibold text-sm ${
          zone_strength === 'STRONG' ? 'bg-emerald-900/30 text-emerald-200 border border-emerald-800/40' :
          zone_strength === 'MODERATE' ? 'bg-amber-900/30 text-amber-200 border border-amber-800/40' :
          'bg-rose-900/30 text-rose-200 border border-rose-800/40'
        }`}>
          Zone Quality: {zone_strength === 'STRONG' ? '💪 STRONG' : zone_strength === 'MODERATE' ? '⚠️ MODERATE' : '❌ WEAK'}
        </div>
      </div>

      {/* Trading Action - Comfortable for Eyes */}
      <div className="bg-gradient-to-r from-slate-800/40 to-slate-900/40 rounded-lg p-3 border border-slate-600/30">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
            <p className="text-[10px] text-slate-300 font-bold tracking-wider">TRADING ADVICE</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-400 font-semibold">Confidence:</span>
            <div className="flex items-center gap-1">
              <div className="w-12 bg-gray-700/50 rounded-full h-1.5">
                <div
                  className={`h-full rounded-full ${confidence >= 70 ? 'bg-emerald-400' : confidence >= 50 ? 'bg-amber-400' : 'bg-rose-400'}`}
                  style={{ width: `${confidence}%` }}
                ></div>
              </div>
              <span className={`text-sm font-semibold ${
                confidence >= 70 ? 'text-emerald-300' :
                confidence >= 50 ? 'text-amber-300' : 'text-rose-300'
              }`}>
                {confidence}%
              </span>
            </div>
          </div>
        </div>
        <p className="text-xs font-semibold text-gray-200 leading-relaxed">
          {recommendation}
        </p>
      </div>
    </div>
  );
});

ZoneControlCard.displayName = 'ZoneControlCard';

export default ZoneControlCard;

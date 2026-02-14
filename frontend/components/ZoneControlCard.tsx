'use client';

import React, { memo, useEffect, useState } from 'react';
import { Target, Shield, AlertOctagon, TrendingDown, TrendingUp, CircleDot } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

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
        const response = await fetch(API_CONFIG.endpoint(`/api/advanced/zone-control/${symbol}`));
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
    if (signal === 'BUY_ZONE') return 'text-green-400';
    if (signal === 'SELL_ZONE') return 'text-rose-400';
    return 'text-amber-400';
  };

  const getSignalBg = (signal: string) => {
    if (signal === 'BUY_ZONE') return 'bg-green-500/10 border-green-500/30';
    if (signal === 'SELL_ZONE') return 'bg-rose-500/10 border-rose-500/40';
    return 'bg-amber-500/10 border-amber-500/40';
  };

  const getRiskColor = (risk: number) => {
    if (risk >= 70) return 'text-rose-400';
    if (risk >= 50) return 'text-amber-400';
    return 'text-green-400';
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-400 bg-green-950/20 border-green-500/40';
    if (confidence >= 60) return 'text-green-400 bg-green-950/20 border-green-500/30';
    if (confidence >= 40) return 'text-yellow-400 bg-yellow-950/30 border-yellow-500/40';
    if (confidence >= 20) return 'text-orange-400 bg-orange-950/30 border-orange-500/40';
    return 'text-red-400 bg-red-950/30 border-red-500/40';
  };

  const getSignalColorEnhanced = (signal: string) => {
    const upperSignal = signal.toUpperCase();
    // EXTREME BUY - Brightest Green
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-green-900/20 text-green-300 border-green-400/50 shadow-lg shadow-green-500/20';
    }
    // STRONG BUY - Strong Green
    if (upperSignal.includes('STRONG') && (upperSignal.includes('BUY') || upperSignal.includes('BULLISH'))) {
      return 'bg-green-950/20 text-green-300 border-green-500/40';
    }
    // BUY - Standard Green
    if (upperSignal.includes('BUY') || upperSignal === 'BULLISH' || upperSignal === 'BUY_ZONE') {
      return 'bg-green-950/20 text-green-400 border-green-500/40';
    }
    // EXTREME SELL - Brightest Red
    if (upperSignal.includes('EXTREME') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-red-900/20 text-red-300 border-red-400/50 shadow-lg shadow-red-500/20';
    }
    // STRONG SELL - Strong Red
    if (upperSignal.includes('STRONG') && (upperSignal.includes('SELL') || upperSignal.includes('BEARISH'))) {
      return 'bg-rose-950/20 text-rose-300 border-rose-500/40';
    }
    // SELL - Standard Red
    if (upperSignal.includes('SELL') || upperSignal === 'BEARISH' || upperSignal === 'SELL_ZONE') {
      return 'bg-rose-950/20 text-rose-400 border-rose-500/40';
    }
    // NEUTRAL/WAIT - Gray
    if (upperSignal === 'NEUTRAL' || upperSignal === 'WAIT' || upperSignal === 'NO_TRADE') {
      return 'bg-gray-950/30 text-gray-400 border-gray-500/40';
    }
    // Other - Amber
    return 'bg-amber-950/30 text-amber-400 border-amber-500/40';
  };

  // Calculate individual zone control confidence percentage
  const calculateZoneControlConfidence = (zoneData: ZoneControlData): number => {
    let confidence = 50; // Base confidence
    
    // Zone strength assessment (25% weight)
    if (zoneData.zone_strength === 'STRONG') confidence += 20;
    else if (zoneData.zone_strength === 'MODERATE') confidence += 10;
    else confidence -= 10; // WEAK zones
    
    // Support zone quality (20% weight)
    const supportStrength = zoneData.nearest_zones?.support?.strength || 0;
    const supportTouches = zoneData.nearest_zones?.support?.touches || 0;
    if (supportStrength >= 80 && supportTouches >= 3) confidence += 15; // Very reliable support
    else if (supportStrength >= 60 && supportTouches >= 2) confidence += 10; // Good support
    else if (supportStrength < 40) confidence -= 10; // Weak support
    
    // Resistance zone quality (15% weight)
    const resistanceStrength = zoneData.nearest_zones?.resistance?.strength || 0;
    const resistanceTouches = zoneData.nearest_zones?.resistance?.touches || 0;
    if (resistanceStrength >= 80 && resistanceTouches >= 3) confidence += 12; // Strong resistance
    else if (resistanceStrength >= 60) confidence += 8;
    else if (resistanceStrength < 40) confidence -= 8;
    
    // Risk balance assessment (20% weight)
    const breakdown = zoneData.breakdown_risk || 50;
    const bounce = zoneData.bounce_probability || 50;
    const riskSpread = Math.abs(breakdown - bounce);
    if (riskSpread >= 30) confidence += 12; // Clear directional bias
    else if (riskSpread >= 20) confidence += 8; // Moderate bias
    else confidence -= 5; // Conflicting signals
    
    // Distance to zones (10% weight)
    const supportDist = Math.abs(zoneData.nearest_zones?.support?.distance_pct || 100);
    const resistanceDist = Math.abs(zoneData.nearest_zones?.resistance?.distance_pct || 100);
    if (supportDist <= 3 || resistanceDist <= 3) confidence += 8; // Near critical levels
    else if (supportDist <= 5 || resistanceDist <= 5) confidence += 5; // Close to levels
    
    // Signal strength (10% weight)
    const signal = zoneData.signal || 'NEUTRAL';
    if (signal === 'BUY_ZONE' || signal === 'SELL_ZONE') confidence += 8;
    else confidence -= 3; // NEUTRAL signal
    
    // Data freshness adjustment
    if (zoneData.status === 'LIVE') confidence += 5;
    else if (zoneData.status === 'CACHED') confidence -= 3;
    
    return Math.min(95, Math.max(25, confidence));
  };

  const getBounceColor = (prob: number) => {
    if (prob >= 70) return 'text-green-400';
    if (prob >= 50) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getZoneStrengthColor = (strength: string) => {
    if (strength === 'STRONG') return 'text-green-400';
    if (strength === 'MODERATE') return 'text-amber-400';
    return 'text-rose-400';
  };

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'N/A';
    return `₹${price.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-green-900/10 to-green-950/5 border border-green-500/30 rounded-xl p-3 sm:p-4 animate-pulse shadow-xl shadow-green-500/10">
        <div className="h-32 bg-green-900/20 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-green-900/10 to-green-950/5 border border-rose-500/30 rounded-xl p-3 sm:p-4 shadow-xl shadow-rose-500/10">
        <div className="flex items-center gap-2 text-rose-400 text-base font-bold">
          <AlertOctagon className="w-5 h-5" />
          <span>{name} - Connection Error</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">Retrying...</p>
      </div>
    );
  }

  const { current_price, nearest_zones, breakdown_risk, bounce_probability, zone_strength, signal, confidence, recommendation, status, message, candles_analyzed } = data;

  // Calculate zone control confidence after data is available
  const zoneControlConfidence = calculateZoneControlConfidence(data);

  return (
    <div className="bg-gradient-to-br from-green-900/10 to-green-950/5 border border-green-500/30 rounded-xl p-3 sm:p-4 hover:border-green-500/40 hover:shadow-green-500/20 transition-all shadow-xl shadow-green-500/10">
      {/* Live Data Status Badge */}
      <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/30 text-xs font-semibold flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          status === 'LIVE' ? 'bg-green-400 shadow-lg shadow-green-400/50' : 
          status === 'CACHED' ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50' : 'bg-gray-400'
        }`} />
        <span className="text-white">
          {status === 'LIVE' && '📡 LIVE ZONE DATA'}
          {status === 'CACHED' && '💾 CACHED ZONE DATA • Market Closed'}
          {status === 'HISTORICAL' && '📊 HISTORICAL ZONE DATA'}
          {(!status || status === 'ERROR') && '⏸️ OFFLINE DATA'}
        </span>
        {candles_analyzed && candles_analyzed > 0 && (
          <span className="text-gray-300 ml-auto">{candles_analyzed} candles</span>
        )}
      </div>
      
      {/* Header with unique styling */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Target className="w-6 h-6 text-green-400 animate-pulse" />
          <div className="flex flex-col">
            <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">{name}</h3>
            {/* Individual Confidence Percentage */}
            <span className="text-sm font-bold text-gray-300">
              Confidence: {Math.round(zoneControlConfidence)}%
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black border-2 ${getSignalBg(signal)} ${getSignalColor(signal)}`}>
          {signal === 'BUY_ZONE' && <Shield className="w-4 h-4" />}
          {signal === 'SELL_ZONE' && <AlertOctagon className="w-4 h-4" />}
          {signal === 'NEUTRAL' && <CircleDot className="w-4 h-4" />}
          <span>{signal.replace('_', ' ')}</span>
        </div>
      </div>

      {/* Current Price - Eye-Friendly Display */}
      <div className="mb-4 p-4 bg-green-500/5 rounded-xl border border-green-500/30 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-white font-bold tracking-wider">CURRENT PRICE</p>
          <div className="flex items-center gap-1">
            {nearest_zones.support.distance_pct !== null && nearest_zones.support.distance_pct < 0 ? (
              <span className="text-xs px-3 py-1 rounded-full bg-green-900/20 text-white font-semibold border border-green-500/30">↑ Above Support</span>
            ) : (
              <span className="text-xs px-3 py-1 rounded-full bg-rose-900/20 text-white font-semibold border border-rose-500/30">↓ Below Support</span>
            )}
          </div>
        </div>
        <p className="text-2xl sm:text-3xl font-bold text-white tracking-tight mb-2">{formatPrice(current_price)}</p>
        <div className="flex items-center gap-2 text-xs">
          {nearest_zones.support.level && (
            <span className="text-gray-300">Gap to Support: <span className="text-green-300 font-semibold">{Math.abs(nearest_zones.support.distance_pct || 0).toFixed(2)}%</span></span>
          )}
          {nearest_zones.resistance.level && (
            <span className="text-gray-300">• Gap to Resistance: <span className="text-rose-300 font-semibold">{Math.abs(nearest_zones.resistance.distance_pct || 0).toFixed(2)}%</span></span>
          )}
        </div>
      </div>

      {/* Zone Information - Dual Panel with Institutional Context */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Support Zone - BUY SIDE - Eye Friendly */}
        <div className="bg-gradient-to-br from-green-500/15 to-green-500/8 rounded-xl p-3 border border-green-700/30 shadow-lg hover:shadow-green-500/20 transition-all">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-5 h-5 text-green-400 drop-shadow-[0_0_6px_rgba(74,222,128,0.5)]" />
            <p className="text-sm text-white font-bold tracking-wider">BUY ZONE</p>
            {nearest_zones.support.zone_label && (
              <span className="text-xs px-2 py-1 rounded-full bg-green-800/20 text-white font-semibold ml-auto border border-green-500/30">
                {nearest_zones.support.zone_label}
              </span>
            )}
          </div>
          {nearest_zones.support.level !== null ? (
            <>
              <p className="text-xl sm:text-2xl font-bold text-white mb-3 tracking-tight">
                {formatPrice(nearest_zones.support.level)}
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-green-500/5 rounded-lg px-3 py-2 border border-green-500/20">
                  <span className="text-sm text-white font-semibold">Distance</span>
                  <span className="text-base font-semibold text-white">
                    {Math.abs(nearest_zones.support.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center bg-green-500/5 rounded-lg px-3 py-2 border border-green-500/20">
                  <span className="text-sm text-white font-semibold">Reliability</span>
                  <div className="flex items-center gap-2">
                    <div className="w-12 bg-gray-700/60 rounded-full h-2">
                      <div className={`h-full rounded-full ${
                        nearest_zones.support.strength >= 70 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                        nearest_zones.support.strength >= 50 ? 'bg-yellow-400' : 'bg-gray-400'
                      }`} style={{ width: `${nearest_zones.support.strength}%` }}></div>
                    </div>
                    <span className="text-base font-semibold text-white">
                      {nearest_zones.support.strength}%
                    </span>
                  </div>
                </div>
                <div className="text-center text-xs text-white font-semibold bg-green-500/10 rounded-lg py-2 border border-green-500/30">
                  Tested {nearest_zones.support.touches}x • {nearest_zones.support.strength >= 70 ? 'Strong 💪' : nearest_zones.support.strength >= 50 ? 'Moderate ⚠️' : 'Weak 🔻'}
                </div>
                {/* Institutional Context */}
                {nearest_zones.support.strength >= 70 && nearest_zones.support.touches >= 3 && (
                  <div className="text-[10px] text-green-300/80 bg-green-900/20 rounded-lg py-1.5 px-2 mt-2 border border-green-500/20 flex items-center gap-1">
                    <span className="animate-pulse">🏦</span>
                    <span>Institutional Support - High Probability Bounce</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 font-semibold">No support zone detected</p>
          )}
        </div>

        {/* Resistance Zone - SELL SIDE - Eye Friendly */}
        <div className="bg-gradient-to-br from-rose-500/15 to-rose-500/8 rounded-xl p-3 border border-rose-700/30 shadow-lg hover:shadow-rose-500/20 transition-all">
          <div className="flex items-center gap-2 mb-2">
            <AlertOctagon className="w-5 h-5 text-rose-400 drop-shadow-[0_0_6px_rgba(251,113,133,0.5)]" />
            <p className="text-sm text-white font-bold tracking-wider">SELL ZONE</p>
            {nearest_zones.resistance.zone_label && (
              <span className="text-xs px-2 py-1 rounded-full bg-rose-800/40 text-white font-semibold ml-auto border border-rose-500/40">
                {nearest_zones.resistance.zone_label}
              </span>
            )}
          </div>
          {nearest_zones.resistance.level !== null ? (
            <>
              <p className="text-xl sm:text-2xl font-bold text-white mb-3 tracking-tight">
                {formatPrice(nearest_zones.resistance.level)}
              </p>
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-rose-500/5 rounded-lg px-3 py-2 border border-rose-500/20">
                  <span className="text-sm text-white font-semibold">Distance</span>
                  <span className="text-base font-semibold text-white">
                    {Math.abs(nearest_zones.resistance.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center bg-rose-500/5 rounded-lg px-3 py-2 border border-rose-500/20">
                  <span className="text-sm text-white font-semibold">Reliability</span>
                  <div className="flex items-center gap-2">
                    <div className="w-12 bg-gray-700/60 rounded-full h-2">
                      <div className={`h-full rounded-full ${
                        nearest_zones.resistance.strength >= 70 ? 'bg-gradient-to-r from-rose-500 to-rose-400' :
                        nearest_zones.resistance.strength >= 50 ? 'bg-yellow-400' : 'bg-gray-400'
                      }`} style={{ width: `${nearest_zones.resistance.strength}%` }}></div>
                    </div>
                    <span className="text-base font-semibold text-white">
                      {nearest_zones.resistance.strength}%
                    </span>
                  </div>
                </div>
                <div className="text-center text-xs text-white font-semibold bg-rose-500/10 rounded-lg py-2 border border-rose-500/30">
                  Tested {nearest_zones.resistance.touches}x • {nearest_zones.resistance.strength >= 70 ? 'Strong 💪' : nearest_zones.resistance.strength >= 50 ? 'Moderate ⚠️' : 'Weak 🔻'}
                </div>
                {/* Institutional Context */}
                {nearest_zones.resistance.strength >= 70 && nearest_zones.resistance.touches >= 3 && (
                  <div className="text-[10px] text-rose-300/80 bg-rose-900/20 rounded-lg py-1.5 px-2 mt-2 border border-rose-500/20 flex items-center gap-1">
                    <span className="animate-pulse">🏦</span>
                    <span>Institutional Resistance - High Probability Rejection</span>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-400 font-semibold">No resistance zone detected</p>
          )}
        </div>
      </div>

      {/* Liquidity Sweep Indicator */}
      {(nearest_zones.support.distance_pct !== null && Math.abs(nearest_zones.support.distance_pct) <= 1) && (
        <div className="mb-4 p-3 bg-cyan-500/10 rounded-xl border border-cyan-500/40 shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-cyan-300 text-xs font-bold">💧 LIQUIDITY SWEEP ZONE</span>
          </div>
          <p className="text-[10px] text-cyan-200/80">
            Price approaching major support - Watch for liquidity sweep below support before reversal. Smart money may accumulate here.
          </p>
        </div>
      )}
      {(nearest_zones.resistance.distance_pct !== null && Math.abs(nearest_zones.resistance.distance_pct) <= 1) && (
        <div className="mb-4 p-3 bg-purple-500/10 rounded-xl border border-purple-500/40 shadow-lg">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-purple-300 text-xs font-bold">💧 LIQUIDITY SWEEP ZONE</span>
          </div>
          <p className="text-[10px] text-purple-200/80">
            Price approaching major resistance - Watch for liquidity sweep above resistance before reversal. Smart money may distribute here.
          </p>
        </div>
      )}

      {/* Risk Analysis - Eye-Friendly Colors with Advanced Metrics */}
      <div className="mb-4 p-4 bg-gradient-to-br from-indigo-500/10 to-purple-500/5 rounded-xl border border-indigo-500/30 shadow-lg">
        <p className="text-sm text-white font-bold tracking-wider mb-3 text-center flex items-center justify-center gap-2">
          <span className="text-lg">⚡</span>
          <span>ADVANCED RISK ANALYSIS</span>
        </p>
        
        <div className="grid grid-cols-2 gap-4 mb-3">
          {/* Breakdown Risk */}
          <div className="bg-gradient-to-br from-rose-500/10 to-rose-500/5 rounded-xl p-3 border border-rose-800/30 hover:border-rose-700/50 transition-all">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-rose-300" />
                <span className="text-xs text-white font-bold">BREAKDOWN</span>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                breakdown_risk >= 70 ? 'bg-rose-900/30 text-white border border-rose-500/40 animate-pulse' :
                breakdown_risk >= 50 ? 'bg-amber-900/20 text-white border border-amber-500/30' :
                'bg-green-900/20 text-white border border-green-500/30'
              }`}>
                {breakdown_risk >= 70 ? 'HIGH RISK 🔴' : breakdown_risk >= 50 ? 'MEDIUM ⚠️' : 'LOW RISK 🟢'}
              </span>
            </div>
            <p className={`text-2xl font-bold ${getRiskColor(breakdown_risk)}`}>
              {breakdown_risk}%
            </p>
            <div className="mt-2 w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  breakdown_risk >= 70 ? 'bg-gradient-to-r from-rose-500 to-rose-400 shadow-lg shadow-rose-500/50' :
                  breakdown_risk >= 50 ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50' : 'bg-gradient-to-r from-green-500 to-green-400'
                }`}
                style={{ width: `${breakdown_risk}%` }}
              ></div>
            </div>
            <p className="text-[9px] text-gray-300 mt-2 text-center">Probability of support break</p>
          </div>

          {/* Bounce Probability */}
          <div className="bg-gradient-to-br from-green-500/10 to-green-500/5 rounded-xl p-3 border border-green-800/30 hover:border-green-700/50 transition-all">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-green-300" />
                <span className="text-xs text-white font-bold">BOUNCE</span>
              </div>
              <span className={`text-[10px] px-2 py-1 rounded-full font-semibold ${
                bounce_probability >= 70 ? 'bg-green-900/30 text-white border border-green-500/40 animate-pulse' :
                bounce_probability >= 50 ? 'bg-amber-900/20 text-white border border-amber-500/30' :
                'bg-rose-900/20 text-white border border-rose-500/30'
              }`}>
                {bounce_probability >= 70 ? 'HIGH 🟢' : bounce_probability >= 50 ? 'MEDIUM ⚠️' : 'LOW RISK 🔴'}
              </span>
            </div>
            <p className={`text-2xl font-bold ${getBounceColor(bounce_probability)}`}>
              {bounce_probability}%
            </p>
            <div className="mt-2 w-full bg-gray-700/50 rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  bounce_probability >= 70 ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-lg shadow-green-500/50' :
                  bounce_probability >= 50 ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50' : 'bg-gradient-to-r from-rose-500 to-rose-400'
                }`}
                style={{ width: `${bounce_probability}%` }}
              ></div>
            </div>
            <p className="text-[9px] text-gray-300 mt-2 text-center">Probability of reversal bounce</p>
          </div>
        </div>

        {/* Risk-Reward Ratio */}
        <div className="bg-gradient-to-r from-purple-500/10 to-indigo-500/10 rounded-lg p-2.5 border border-purple-500/30 mb-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-200 font-semibold">Risk-Reward Balance:</span>
            <div className="flex items-center gap-2">
              {bounce_probability > breakdown_risk + 20 ? (
                <span className="text-xs text-green-300 font-bold flex items-center gap-1">
                  <span>🟢</span> FAVORABLE
                </span>
              ) : breakdown_risk > bounce_probability + 20 ? (
                <span className="text-xs text-rose-300 font-bold flex items-center gap-1">
                  <span>🔴</span> UNFAVORABLE
                </span>
              ) : (
                <span className="text-xs text-amber-300 font-bold flex items-center gap-1">
                  <span>🟡</span> NEUTRAL
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Zone Health Summary */}
        <div className={`text-center py-2.5 rounded-lg font-bold text-sm border-2 transition-all ${
          zone_strength === 'STRONG' ? 'bg-gradient-to-r from-green-500/20 to-emerald-500/10 text-white border-green-700/60 shadow-lg shadow-green-500/20' :
          zone_strength === 'MODERATE' ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/10 text-white border-amber-700/60' :
          'bg-gradient-to-r from-rose-500/20 to-red-500/10 text-white border-rose-700/60'
        }`}>
          {zone_strength === 'STRONG' && '💪 STRONG ZONES - High Confidence Entry'}
          {zone_strength === 'MODERATE' && '⚠️ MODERATE ZONES - Cautious Entry'}
          {zone_strength === 'WEAK' && '❌ WEAK ZONES - Avoid or Wait'}
        </div>
      </div>

      {/* Trading Action - Comfortable for Eyes with Enhanced Guidance */}
      <div className="bg-gradient-to-br from-indigo-500/10 to-blue-500/5 rounded-xl p-4 border border-indigo-500/40 shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shadow-lg shadow-indigo-400/50"></div>
            <p className="text-sm text-white font-bold tracking-wider">💼 PROFESSIONAL TRADING ADVICE</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-indigo-200 font-semibold">Confidence:</span>
            <div className="flex items-center gap-1">
              <div className="w-16 bg-gray-700/50 rounded-full h-2.5">
                <div
                  className={`h-full rounded-full transition-all ${confidence >= 70 ? 'bg-gradient-to-r from-green-500 to-green-400 shadow-lg shadow-green-500/50' : confidence >= 50 ? 'bg-gradient-to-r from-yellow-400 to-amber-400 shadow-lg shadow-yellow-400/50' : 'bg-gradient-to-r from-rose-500 to-rose-400'}`}
                  style={{ width: `${confidence}%` }}
                ></div>
              </div>
              <span className={`text-base font-bold ${
                confidence >= 70 ? 'text-green-300' :
                confidence >= 50 ? 'text-yellow-300' : 'text-rose-300'
              }`}>
                {confidence}%
              </span>
            </div>
          </div>
        </div>
        
        {/* Main Recommendation */}
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 rounded-lg p-3 border border-indigo-500/30 mb-3">
          <p className="text-sm font-bold text-white leading-relaxed">
            {recommendation}
          </p>
        </div>

        {/* Trading Strategy Context */}
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          {/* Entry Strategy */}
          <div className="bg-green-500/10 rounded-lg p-2 border border-green-500/30">
            <span className="text-green-300 font-bold block mb-1">📍 Entry Strategy:</span>
            <span className="text-gray-200">
              {bounce_probability >= 70 ? 'Enter near support with tight stop-loss' : 
               bounce_probability >= 50 ? 'Wait for confirmation candle' :
               'Avoid long positions - High risk'}
            </span>
          </div>
          
          {/* Exit Strategy */}
          <div className="bg-rose-500/10 rounded-lg p-2 border border-rose-500/30">
            <span className="text-rose-300 font-bold block mb-1">🎯 Exit Strategy:</span>
            <span className="text-gray-200">
              {breakdown_risk >= 70 ? 'Book profits immediately - Exit risk high' :
               breakdown_risk >= 50 ? 'Move SL to breakeven' :
               'Trail stop-loss - Upside potential'}
            </span>
          </div>
        </div>

        {/* Risk Management Alert */}
        {(breakdown_risk >= 60 || bounce_probability <= 40) && (
          <div className="mt-3 bg-amber-500/10 rounded-lg p-2.5 border border-amber-500/40 flex items-start gap-2">
            <span className="text-amber-400 text-base">⚠️</span>
            <div>
              <p className="text-xs text-amber-300 font-bold mb-1">Risk Management Alert</p>
              <p className="text-[10px] text-amber-200/90">
                Current market conditions show elevated risk. Consider reducing position size or waiting for better entry opportunities.
              </p>
            </div>
          </div>
        )}
        
        {/* Optimal Setup Indicator */}
        {(bounce_probability >= 70 && zone_strength === 'STRONG' && confidence >= 70) && (
          <div className="mt-3 bg-gradient-to-r from-green-500/20 to-emerald-500/10 rounded-lg p-2.5 border-2 border-green-500/50 flex items-start gap-2 shadow-lg shadow-green-500/20">
            <span className="text-green-300 text-base animate-pulse">✨</span>
            <div>
              <p className="text-xs text-green-300 font-bold mb-1">HIGH PROBABILITY SETUP</p>
              <p className="text-[10px] text-green-200/90">
                All conditions favorable - Strong zones + High bounce probability + Good confidence. This is an institutional-grade opportunity!
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

ZoneControlCard.displayName = 'ZoneControlCard';

export default ZoneControlCard;

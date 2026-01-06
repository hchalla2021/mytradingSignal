'use client';

import React, { memo, useEffect, useState } from 'react';
import { Target, Shield, AlertOctagon, TrendingDown, TrendingUp, CircleDot } from 'lucide-react';

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
    };
    resistance: {
      level: number | null;
      distance_pct: number | null;
      strength: number;
      touches: number;
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
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
        const response = await fetch(`${apiUrl}/api/advanced/zone-control/${symbol}`);
        if (!response.ok) throw new Error('Failed to fetch');
        const result = await response.json();
        
        // 🔍 DETAILED LOGGING for debugging
        console.log(`[ZONE-CONTROL] ✅ Data received for ${symbol}:`, {
          status: result.status,
          signal: result.signal,
          confidence: result.confidence,
          current_price: result.current_price,
          breakdown_risk: result.breakdown_risk,
          bounce_probability: result.bounce_probability,
          zone_strength: result.zone_strength,
          support_level: result.nearest_zones?.support?.level,
          resistance_level: result.nearest_zones?.resistance?.level,
          candles_analyzed: result.candles_analyzed
        });
        
        // 🚨 ALERT if values are missing or zero
        if (result.breakdown_risk === undefined) {
          console.warn(`[ZONE-CONTROL] ⚠️ ${symbol} missing breakdown_risk!`, result);
        }
        if (result.bounce_probability === undefined) {
          console.warn(`[ZONE-CONTROL] ⚠️ ${symbol} missing bounce_probability!`, result);
        }
        
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
        console.error(`[ZONE-CONTROL] ❌ Error fetching ${symbol}:`, err);
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

      {/* Current Price - Bold Display */}
      <div className="mb-4 p-3 bg-gradient-to-br from-emerald-500/5 to-emerald-500/10 rounded-lg border border-emerald-500/20">
        <p className="text-[10px] text-emerald-400 font-black mb-1">💰 CURRENT PRICE</p>
        <p className="text-xl sm:text-2xl font-black text-white tracking-tight">{formatPrice(current_price)}</p>
      </div>

      {/* Zone Information - Dual Panel */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {/* Support Zone */}
        <div className="bg-dark-bg rounded-lg p-3 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <div className="flex items-center gap-1.5 mb-2">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <p className="text-[9px] sm:text-[10px] text-emerald-400 font-black">SUPPORT</p>
          </div>
          {nearest_zones.support.level !== null ? (
            <>
              <p className="text-base sm:text-lg font-black text-emerald-400 mb-1">
                {formatPrice(nearest_zones.support.level)}
              </p>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Distance</span>
                  <span className="text-xs sm:text-sm font-extrabold text-white">
                    {Math.abs(nearest_zones.support.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Strength</span>
                  <span className="text-xs sm:text-sm font-extrabold text-emerald-400">
                    {nearest_zones.support.strength}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Touches</span>
                  <span className="text-xs sm:text-sm font-extrabold text-white">
                    {nearest_zones.support.touches}x
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-dark-muted font-semibold">No active support</p>
          )}
        </div>

        {/* Resistance Zone */}
        <div className="bg-dark-bg rounded-lg p-3 border-2 border-emerald-500/30 shadow-sm shadow-emerald-500/10">
          <div className="flex items-center gap-1.5 mb-2">
            <AlertOctagon className="w-3.5 h-3.5 text-rose-400" />
            <p className="text-[9px] sm:text-[10px] text-rose-400 font-black">RESISTANCE</p>
          </div>
          {nearest_zones.resistance.level !== null ? (
            <>
              <p className="text-base sm:text-lg font-black text-rose-400 mb-1">
                {formatPrice(nearest_zones.resistance.level)}
              </p>
              <div className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Distance</span>
                  <span className="text-xs sm:text-sm font-extrabold text-white">
                    {Math.abs(nearest_zones.resistance.distance_pct || 0).toFixed(2)}%
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Strength</span>
                  <span className="text-xs sm:text-sm font-extrabold text-rose-400">
                    {nearest_zones.resistance.strength}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[9px] text-dark-muted font-bold">Touches</span>
                  <span className="text-xs sm:text-sm font-extrabold text-white">
                    {nearest_zones.resistance.touches}x
                  </span>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-dark-muted font-semibold">No active resistance</p>
          )}
        </div>
      </div>

      {/* Risk Metrics - Triple Display */}
      <div className="grid grid-cols-3 gap-2 mb-3 p-3 bg-gradient-to-r from-emerald-500/5 via-amber-500/5 to-rose-500/5 rounded-lg border border-emerald-500/20">
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingDown className={`w-3 h-3 ${getRiskColor(breakdown_risk)}`} />
            <p className="text-[8px] sm:text-[9px] text-dark-muted font-black">BREAKDOWN</p>
          </div>
          <p className={`text-sm sm:text-base font-black ${getRiskColor(breakdown_risk)}`}>
            {breakdown_risk}%
          </p>
        </div>

        <div className="text-center border-x border-emerald-500/20">
          <div className="flex items-center justify-center gap-1 mb-1">
            <TrendingUp className={`w-3 h-3 ${getBounceColor(bounce_probability)}`} />
            <p className="text-[8px] sm:text-[9px] text-dark-muted font-black">BOUNCE</p>
          </div>
          <p className={`text-sm sm:text-base font-black ${getBounceColor(bounce_probability)}`}>
            {bounce_probability}%
          </p>
        </div>

        <div className="text-center">
          <p className="text-[8px] sm:text-[9px] text-dark-muted font-black mb-1">ZONE</p>
          <p className={`text-xs sm:text-sm font-black ${getZoneStrengthColor(zone_strength)}`}>
            {zone_strength}
          </p>
        </div>
      </div>

      {/* Bottom Stats with Confidence */}
      <div className="flex items-center justify-between pt-3 border-t border-emerald-500/20">
        <div>
          <p className="text-[9px] text-emerald-400 font-black mb-0.5">CONFIDENCE</p>
          <div className="flex items-center gap-2">
            <p className="text-base font-black text-white">{confidence}%</p>
            <div className="w-16 bg-dark-border rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full ${confidence >= 70 ? 'bg-emerald-500' : confidence >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                style={{ width: `${confidence}%` }}
              ></div>
            </div>
          </div>
        </div>
        <div className="text-right max-w-[60%]">
          <p className="text-[8px] text-dark-muted font-black mb-0.5">RECOMMENDATION</p>
          <p className="text-[9px] font-bold text-emerald-400 line-clamp-2">
            {recommendation}
          </p>
        </div>
      </div>
    </div>
  );
});

ZoneControlCard.displayName = 'ZoneControlCard';

export default ZoneControlCard;

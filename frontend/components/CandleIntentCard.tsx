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
        return 'text-emerald-400 bg-gradient-to-br from-emerald-500/12 to-green-500/10 border-emerald-500/40 shadow-emerald-500/20';
      case 'BUY':
        return 'text-emerald-300 bg-gradient-to-br from-emerald-500/10 to-green-500/8 border-emerald-500/30 shadow-emerald-500/15';
      case 'SELL':
        return 'text-rose-300 bg-gradient-to-br from-rose-500/10 to-red-500/8 border-rose-500/30 shadow-rose-500/15';
      case 'STRONG_SELL':
        return 'text-rose-400 bg-gradient-to-br from-rose-500/12 to-red-500/10 border-rose-500/40 shadow-rose-500/20';
      default:
        return 'text-gray-400 bg-gradient-to-br from-gray-800/40 to-gray-700/30 border-gray-600/40 shadow-gray-800/20';
    }
  };

  // Calculate individual candle confidence percentage 
  const calculateCandleConfidence = (): number => {
    if (!data) return 50;
    
    let confidence = 50; // Base confidence
    
    // Pattern confidence scaling (30% weight)
    const patternConf = data.pattern?.confidence || 0;
    if (patternConf >= 80) confidence += 20; // High pattern confidence
    else if (patternConf >= 60) confidence += 12; // Medium pattern confidence  
    else if (patternConf >= 40) confidence += 5;  // Low pattern confidence
    else confidence -= 10; // Very low pattern confidence
    
    // Professional signal strength (25% weight)
    const signal = data.professional_signal || 'NEUTRAL';
    if (signal === 'STRONG_BUY' || signal === 'STRONG_SELL') confidence += 15;
    else if (signal === 'BUY' || signal === 'SELL') confidence += 10;
    else confidence -= 5; // NEUTRAL signal
    
    // Volume analysis efficiency (20% weight) 
    const volumeEff = data.volume_analysis?.efficiency || '';
    const volumeRatio = data.volume_analysis?.volume_ratio || 0;
    if (volumeEff === 'ABSORPTION' && volumeRatio >= 2) confidence += 12; // Strong absorption
    else if (volumeEff === 'HEALTHY' && volumeRatio >= 1.5) confidence += 8;  // Healthy volume
    else if (volumeRatio < 0.8) confidence -= 8; // Low volume
    
    // Body structure strength (15% weight)
    const bodyStrength = data.body_analysis?.strength || 0;
    const bodyRatio = data.body_analysis?.body_ratio_pct || 0;
    if (bodyStrength >= 80 && bodyRatio >= 60) confidence += 10; // Strong decisive body
    else if (bodyStrength >= 60) confidence += 5; // Moderate body strength
    else if (bodyRatio < 30) confidence -= 5; // Weak indecisive body
    
    // Wick analysis signals (10% weight)
    const upperSignal = data.wick_analysis?.upper_signal || '';
    const lowerSignal = data.wick_analysis?.lower_signal || '';
    const dominantWick = data.wick_analysis?.dominant_wick || '';
    
    // Wick confirmation signals
    if ((upperSignal === 'BEARISH' && signal.includes('SELL')) ||
        (lowerSignal === 'BULLISH' && signal.includes('BUY'))) {
      confidence += 8; // Wick confirms signal
    }
    
    // Market data status adjustment
    if (data.status === 'LIVE') confidence += 5;
    else if (data.status === 'CACHED') confidence -= 3;
    
    // Near support/resistance zone adjustment
    if (data.near_zone) {
      confidence += 5; // Critical level proximity increases significance
    }
    
    // Cap confidence at reasonable ranges
    return Math.min(95, Math.max(25, confidence));
  };

  const candleConfidence = calculateCandleConfidence();

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
    <div className="bg-gradient-to-br from-green-900/10 to-green-950/5 rounded-xl border border-green-500/40 hover:border-green-500/50 transition-all shadow-xl shadow-green-500/10 hover:shadow-green-500/20 p-4 sm:p-6">
      {/* Live Data Status Badge */}
      <div className="mb-3 px-3 py-2 rounded-lg bg-green-500/5 border border-green-500/40 text-xs font-semibold flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${
          data.status === 'LIVE' ? 'bg-green-400 animate-pulse' : 
          data.status === 'CACHED' ? 'bg-yellow-400' : 'bg-gray-400'
        }`} />
        <span className="text-white">
          {data.status === 'LIVE' && '📡 LIVE CANDLE DATA'}
          {data.status === 'CACHED' && '💾 CACHED CANDLE DATA • Market Closed'}
          {!data.status && '⏸️ OFFLINE DATA'}
        </span>
      </div>
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-green-500/10 rounded-lg border border-green-500/40">
            <Flame className="w-6 h-6 text-green-400" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-base sm:text-lg font-bold text-white">{name}</h3>
            {/* Individual Confidence Percentage */}
            <span className={`text-sm font-bold ${
              candleConfidence >= 70 ? 'text-[#00C087]' :
              candleConfidence >= 50 ? 'text-yellow-400' :
              'text-[#EB5B3C]'
            }`}>
              Confidence: {Math.round(candleConfidence)}%
            </span>
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-sm font-bold border shadow-lg ${
          data.professional_signal?.includes('BUY') ? 'bg-[#00C087]/12 text-[#00C087] border-[#00C087]/30' :
          data.professional_signal?.includes('SELL') ? 'bg-[#EB5B3C]/12 text-[#EB5B3C] border-[#EB5B3C]/30' :
          'bg-gray-800/40 text-gray-300 border-gray-500/40'
        }`}>
          {data.professional_signal?.replace('_', ' ') || 'N/A'}
        </div>
      </div>

      {/* Current Candle OHLCV */}
      <div className="grid grid-cols-5 gap-2 mb-4">
        <div className="bg-green-500/5 rounded-lg p-2.5 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="text-gray-400 text-xs font-semibold">Open</div>
          <div className="text-white font-bold text-sm">₹{data.current_candle?.open?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2.5 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="text-gray-400 text-xs font-semibold">High</div>
          <div className="text-[#00C087] font-bold text-sm">₹{data.current_candle?.high?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2.5 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="text-gray-400 text-xs font-semibold">Low</div>
          <div className="text-[#EB5B3C] font-bold text-sm">₹{data.current_candle?.low?.toFixed(2) || '0.00'}</div>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2.5 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="text-gray-400 text-xs font-semibold">Close</div>
          <div className={`font-bold text-sm ${(data.current_candle?.close || 0) >= (data.current_candle?.open || 0) ? 'text-[#00C087]' : 'text-[#EB5B3C]'}`}>
            ₹{data.current_candle?.close?.toFixed(2) || '0.00'}
          </div>
        </div>
        <div className="bg-green-500/5 rounded-lg p-2.5 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="text-gray-400 text-xs font-semibold">Volume</div>
          <div className={`font-bold text-sm ${
            (data.volume_analysis?.volume_ratio || 0) >= 2 ? 'text-[#00C087]' :
            (data.volume_analysis?.volume_ratio || 0) >= 1 ? 'text-cyan-400' : 'text-gray-400'
          }`}>
            {((data.volume_analysis?.volume || 0) / 1000).toFixed(0)}K
          </div>
        </div>
      </div>

      {/* Pattern Detection */}
      <div className="bg-green-500/5 rounded-xl p-4 mb-4 border border-green-500/30 hover:border-green-500/40 transition-all shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <span className={`font-bold text-base ${
              data.pattern?.intent === 'BULLISH' ? 'text-[#00C087]' :
              data.pattern?.intent === 'BEARISH' ? 'text-[#EB5B3C]' :
              'text-gray-300'
            }`}>
              {data.pattern?.type?.replace(/_/g, ' ') || 'N/A'}
            </span>
            {getIntentIcon(data.pattern?.intent || 'NEUTRAL')}
          </div>
          <div className="text-sm">
            <span className="text-gray-400">Confidence: </span>
            <span className={`font-bold text-base ${
              (data.pattern?.confidence || 0) >= 80 ? 'text-[#00C087]' :
              (data.pattern?.confidence || 0) >= 60 ? 'text-yellow-400' : 'text-gray-400'
            }`}>
              {data.pattern?.confidence || 0}%
            </span>
          </div>
        </div>
        <p className="text-xs text-white leading-relaxed">
          {data.pattern?.interpretation || 'No pattern data available'}
        </p>
      </div>

      {/* Wick Analysis */}
      <div className="space-y-3 mb-4">
        <div className="flex items-center justify-between bg-green-500/5 rounded-lg p-3 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-12 bg-gradient-to-b from-[#EB5B3C]/70 via-red-400/60 to-transparent rounded-full shadow-lg"></div>
            <div>
              <div className="text-xs text-gray-300 font-semibold">Upper Wick</div>
              <div className="text-base text-white font-bold">{data.wick_analysis?.upper_wick_pct?.toFixed(1) || '0.0'}%</div>
            </div>
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${
            data.wick_analysis?.upper_signal === 'BEARISH' ? 'bg-[#EB5B3C]/12 text-[#EB5B3C] border-[#EB5B3C]/30' :
            data.wick_analysis?.upper_signal === 'SLIGHTLY_BEARISH' ? 'bg-yellow-500/12 text-yellow-400 border-yellow-500/30' :
            'bg-gray-800/40 text-gray-400 border-gray-500/40'
          }`}>
            {data.wick_analysis?.upper_signal?.replace('_', ' ') || 'N/A'}
          </div>
        </div>

        <div className="flex items-center justify-between bg-green-500/5 rounded-lg p-3 border border-green-500/30 hover:border-green-500/40 transition-all">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-12 bg-gradient-to-t from-[#00C087]/70 via-green-400/60 to-transparent rounded-full shadow-lg"></div>
            <div>
              <div className="text-xs text-gray-300 font-semibold">Lower Wick</div>
              <div className="text-base text-white font-bold">{data.wick_analysis?.lower_wick_pct?.toFixed(1) || '0.0'}%</div>
            </div>
          </div>
          <div className={`text-xs px-3 py-1.5 rounded-lg font-bold border ${
            data.wick_analysis?.lower_signal === 'BULLISH' ? 'bg-[#00C087]/12 text-[#00C087] border-[#00C087]/30' :
            data.wick_analysis?.lower_signal === 'SLIGHTLY_BULLISH' ? 'bg-cyan-500/12 text-cyan-400 border-cyan-500/30' :
            'bg-gray-800/40 text-gray-400 border-gray-500/40'
          }`}>
            {data.wick_analysis?.lower_signal?.replace('_', ' ') || 'N/A'}
          </div>
        </div>
      </div>

      {/* Body & Volume Analysis */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/30 hover:border-green-500/40 transition-all shadow-sm">
          <div className="text-xs text-green-400 mb-2 font-bold">Body Structure</div>
          <div className={`text-base font-bold mb-1 ${
            data.body_analysis?.color === 'GREEN' ? 'text-[#00C087]' : 'text-[#EB5B3C]'
          }`}>
            {data.body_analysis?.body_type?.replace('_', ' ') || 'N/A'}
          </div>
          <div className="text-xs text-white font-semibold">{data.body_analysis?.body_ratio_pct?.toFixed(1) || '0.0'}% of range</div>
        </div>

        <div className="bg-green-500/5 rounded-lg p-3 border border-green-500/30 hover:border-green-500/40 transition-all shadow-sm">
          <div className="text-xs text-green-400 mb-2 font-bold">Volume Efficiency</div>
          <div className={`text-base font-bold mb-1 ${
            data.volume_analysis?.efficiency === 'ABSORPTION' ? 'text-[#00C087]' :
            data.volume_analysis?.efficiency === 'EMOTIONAL_MOVE' ? 'text-yellow-400' :
            data.volume_analysis?.efficiency === 'HEALTHY' ? 'text-cyan-400' : 'text-gray-400'
          }`}>
            {data.volume_analysis?.efficiency?.replace('_', ' ') || 'N/A'}
          </div>
          <div className="text-xs text-white font-semibold">{data.volume_analysis?.volume_ratio?.toFixed(2) || '0.00'}x avg</div>
        </div>
      </div>

      {/* Volume Details */}
      <div className="bg-green-500/5 rounded-lg p-3 mb-4 border-2 border-green-500/30 hover:border-green-500/40 transition-all shadow-sm">
        <div className="text-xs text-green-400 mb-3 font-bold">Volume Analysis</div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-gray-400 mb-1 text-xs font-semibold">Current</div>
            <div className="text-white font-bold text-sm">{((data.volume_analysis?.volume || 0) / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-gray-400 mb-1 text-xs font-semibold">Average</div>
            <div className="text-gray-300 font-bold text-sm">{((data.volume_analysis?.avg_volume || 0) / 1000).toFixed(0)}K</div>
          </div>
          <div>
            <div className="text-gray-400 mb-1 text-xs font-semibold">Type</div>
            <div className={`font-bold text-sm ${
              data.volume_analysis?.volume_type === 'VERY_HIGH' ? 'text-[#00C087]' :
              data.volume_analysis?.volume_type === 'HIGH' ? 'text-cyan-400' :
              data.volume_analysis?.volume_type === 'LOW' ? 'text-yellow-400' : 'text-gray-400'
            }`}>
              {data.volume_analysis?.volume_type?.replace('_', ' ') || 'N/A'}
            </div>
          </div>
        </div>
      </div>

      {/* Zone Proximity Alert */}
      {data.near_zone && (
        <div className="bg-green-500/10 border-2 border-green-500/40 rounded-xl p-3 mb-4 shadow-sm">
          <div className="flex items-center space-x-2">
            <Zap className="w-5 h-5 text-green-400 animate-pulse" />
            <span className="text-sm text-green-300 font-bold">Near Support/Resistance Zone</span>
          </div>
          <p className="text-xs text-white mt-1 font-semibold">Watch for breakout or bounce</p>
        </div>
      )}

      {/* Professional Insight */}
      <div className="bg-green-500/5 border-2 border-green-500/30 rounded-xl p-3 shadow-sm">
        <div className="flex items-center space-x-2 mb-2">
          <Flame className="w-5 h-5 text-green-400" />
          <span className="text-xs font-bold text-green-300 flex items-center gap-2">
            <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
            Market Insights
          </span>
        </div>
        <p className="text-xs text-white leading-relaxed">
          {data.volume_analysis?.efficiency_interpretation || 'No market insights available'}
        </p>
      </div>

      {/* Timestamp */}
      <div className="mt-4 text-xs text-gray-400 text-center font-semibold">
        {data.status === 'CACHED' && '📦 Cached • '}
        Last updated: {data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'N/A'}
      </div>
    </div>
  );
});

CandleIntentCard.displayName = 'CandleIntentCard';

export default CandleIntentCard;

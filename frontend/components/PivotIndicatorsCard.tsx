'use client';

import React, { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Target } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

interface PivotData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
  current_price: number | null;
  timestamp: string;
  classic_pivots: {
    pivot: number | null;
    r1: number | null;
    r2: number | null;
    s1: number | null;
    s2: number | null;
    bias: string;
  };
  supertrend_10_3: {
    value: number | null;
    trend: string;
    signal: string;
    distance_pct: number;
  };
  supertrend_7_3: {
    value: number | null;
    trend: string;
    signal: string;
    distance_pct: number;
  };
  overall_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  bullish_signals: number;
  bearish_signals: number;
}

interface Props {
  symbol: string;
  name: string;
}

// Helper: Get trading signal based on pivot analysis
const getPivotSignal = (data: PivotData): string => {
  const { classic_pivots, supertrend_10_3, supertrend_7_3, overall_bias, bullish_signals, bearish_signals, current_price } = data;
  
  // Strong signals when multiple factors align
  if (overall_bias === 'BULLISH' && bullish_signals >= 4 && 
      supertrend_10_3.trend === 'BULLISH' && supertrend_7_3.trend === 'BULLISH') {
    return 'STRONG BUY';
  }
  if (overall_bias === 'BEARISH' && bearish_signals >= 4 &&
      supertrend_10_3.trend === 'BEARISH' && supertrend_7_3.trend === 'BEARISH') {
    return 'STRONG SELL';
  }
  
  // Regular signals based on pivot bias and supertrend
  if (overall_bias === 'BULLISH' || (classic_pivots.bias === 'BULLISH' && supertrend_10_3.trend === 'BULLISH')) {
    return 'BUY';
  }
  if (overall_bias === 'BEARISH' || (classic_pivots.bias === 'BEARISH' && supertrend_10_3.trend === 'BEARISH')) {
    return 'SELL';
  }
  
  // Check price position relative to pivot
  if (current_price && classic_pivots.pivot) {
    const distFromPivot = ((current_price - classic_pivots.pivot) / classic_pivots.pivot) * 100;
    if (distFromPivot > 1 && supertrend_10_3.trend === 'BULLISH') return 'BUY';
    if (distFromPivot < -1 && supertrend_10_3.trend === 'BEARISH') return 'SELL';
  }
  
  return 'SIDEWAYS';
};

// Helper: Calculate realistic confidence (35-85%)
const calculatePivotConfidence = (data: PivotData): number => {
  let confidence = 50; // Base
  
  // Overall bias strength (20% weight)
  if (data.overall_bias === 'BULLISH' && data.bullish_signals >= 4) confidence += 15;
  else if (data.overall_bias === 'BEARISH' && data.bearish_signals >= 4) confidence += 15;
  else if (data.overall_bias === 'BULLISH' && data.bullish_signals >= 3) confidence += 10;
  else if (data.overall_bias === 'BEARISH' && data.bearish_signals >= 3) confidence += 10;
  else if (data.overall_bias === 'NEUTRAL') confidence -= 10;
  
  // Supertrend alignment (25% weight)
  const st10Trend = data.supertrend_10_3.trend;
  const st7Trend = data.supertrend_7_3.trend;
  if (st10Trend === st7Trend && st10Trend !== 'NEUTRAL') confidence += 18; // Both trends agree
  else if (st10Trend !== 'NEUTRAL' || st7Trend !== 'NEUTRAL') confidence += 10; // One trend clear
  else confidence -= 8; // Both neutral
  
  // Distance from supertrend (15% weight)
  const st10Distance = Math.abs(data.supertrend_10_3.distance_pct || 0);
  const st7Distance = Math.abs(data.supertrend_7_3.distance_pct || 0);
  if (st10Distance <= 1 || st7Distance <= 1) confidence += 12; // Very close to ST
  else if (st10Distance <= 2 || st7Distance <= 2) confidence += 8; // Close to ST
  else if (st10Distance > 5 && st7Distance > 5) confidence -= 5; // Far from both
  
  // Pivot bias confirmation (15% weight)
  const pivotBias = data.classic_pivots.bias;
  const signal = getPivotSignal(data);
  if ((pivotBias === 'BULLISH' && signal.includes('BUY')) ||
      (pivotBias === 'BEARISH' && signal.includes('SELL'))) {
    confidence += 12; // Pivot confirms signal
  } else if (pivotBias === 'NEUTRAL') {
    confidence -= 5;
  }
  
  // Price position relative to pivot (10% weight)
  if (data.current_price && data.classic_pivots.pivot) {
    const distFromPivot = Math.abs(((data.current_price - data.classic_pivots.pivot) / data.classic_pivots.pivot) * 100);
    if (distFromPivot <= 0.5) confidence += 8; // At pivot - key decision point
    else if (distFromPivot >= 3) confidence -= 5; // Far from pivot
  }
  
  // Signal strength (10% weight)
  if (signal.includes('STRONG')) confidence += 8;
  else if (signal !== 'SIDEWAYS') confidence += 4;
  else confidence -= 5;
  
  // Market status (5% weight)
  if (data.status === 'LIVE') confidence += 5;
  else if (data.status === 'CACHED' || data.status === 'CLOSED') confidence -= 3;
  
  // Clamp to realistic range 35-85%
  return Math.min(85, Math.max(35, Math.round(confidence)));
};

const PivotIndicatorsCard = memo<Props>(({ symbol, name }) => {
  const [data, setData] = useState<PivotData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(
          API_CONFIG.endpoint(`/api/advanced/pivot-indicators/${symbol}`),
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.status === 'ERROR' || !result.current_price) {
          setError('Data unavailable');
          setData(null);
        } else {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setError('Timeout - Server slow');
        } else {
          setError('Connection error');
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [symbol]);

  const formatPrice = (price: number | null): string => {
    if (price === null) return 'N/A';
    return `â‚¹${price.toFixed(2)}`;
  };

  if (loading) {
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-gray-950/30 border border-gray-700/40 rounded-xl p-4 animate-pulse">
        <div className="h-32 bg-gray-800/30 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-gradient-to-br from-gray-900/50 to-gray-950/30 border border-rose-500/40 rounded-xl p-4">
        <div className="flex items-center gap-2 text-rose-400 font-semibold">
          <Target className="w-5 h-5" />
          <span>{name}</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">{error || 'No data'}</p>
      </div>
    );
  }

  const signal = getPivotSignal(data);
  const confidence = calculatePivotConfidence(data);
  
  // Signal colors
  const getSignalColor = () => {
    if (signal === 'STRONG BUY') return 'text-emerald-300';
    if (signal === 'BUY') return 'text-green-400';
    if (signal === 'SELL') return 'text-rose-400';
    if (signal === 'STRONG SELL') return 'text-red-400';
    return 'text-amber-400';
  };
  
  const getSignalBg = () => {
    if (signal === 'STRONG BUY') return 'bg-emerald-500/20 border-emerald-400/40';
    if (signal === 'BUY') return 'bg-green-500/15 border-green-400/30';
    if (signal === 'SELL') return 'bg-rose-500/15 border-rose-400/30';
    if (signal === 'STRONG SELL') return 'bg-red-500/20 border-red-400/40';
    return 'bg-amber-500/15 border-amber-400/30';
  };
  
  // Confidence level text
  const getConfidenceLabel = () => {
    if (confidence >= 70) return 'High';
    if (confidence >= 55) return 'Medium';
    return 'Low';
  };

  return (
    <div className="bg-gradient-to-br from-gray-900/50 to-gray-950/30 border border-gray-700/40 rounded-xl p-4 hover:border-gray-600/50 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-cyan-400" />
          <h3 className="text-base font-semibold text-white">{name}</h3>
        </div>
        
        {/* Live Status Badge */}
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800/50 border border-gray-700/40">
          <span className={`w-1.5 h-1.5 rounded-full ${
            data.status === 'LIVE' ? 'bg-green-400 animate-pulse' : 
            data.status === 'CACHED' ? 'bg-yellow-400' : 'bg-gray-500'
          }`} />
          {data.status === 'LIVE' && (
            <span className="text-[10px] text-gray-400 font-medium">LIVE</span>
          )}
        </div>
      </div>

      {/* Large Signal Display */}
      <div className={`mb-4 p-4 rounded-xl border-2 ${getSignalBg()}`}>
        <div className="flex items-center justify-center gap-2 mb-2">
          {signal === 'STRONG BUY' && <TrendingUp className="w-6 h-6 text-emerald-300" />}
          {signal === 'BUY' && <TrendingUp className="w-6 h-6 text-green-400" />}
          {signal === 'SELL' && <TrendingDown className="w-6 h-6 text-rose-400" />}
          {signal === 'STRONG SELL' && <TrendingDown className="w-6 h-6 text-red-400" />}
          {signal === 'SIDEWAYS' && <Minus className="w-6 h-6 text-amber-400" />}
          <span className={`text-2xl font-bold ${getSignalColor()}`}>
            {signal}
          </span>
        </div>
        
        {/* Quick Explanation */}
        <p className="text-xs text-center text-gray-300">
          {signal === 'STRONG BUY' && 'All indicators bullish - Strong uptrend confirmed'}
          {signal === 'BUY' && 'Pivot + Supertrend bullish - Good entry'}
          {signal === 'SELL' && 'Pivot + Supertrend bearish - Consider exit'}
          {signal === 'STRONG SELL' && 'All indicators bearish - Strong downtrend confirmed'}
          {signal === 'SIDEWAYS' && 'Mixed signals - Wait for trend clarity'}
        </p>
      </div>

      {/* Confidence Meter */}
      <div className="mb-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 font-medium">Signal Confidence</span>
          <span className={`text-lg font-bold ${
            confidence >= 70 ? 'text-green-400' :
            confidence >= 55 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {confidence}%
          </span>
        </div>
        
        {/* Progress Bar */}
        <div className="relative w-full h-2 bg-gray-700/50 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${
              confidence >= 70 ? 'bg-gradient-to-r from-green-500 to-green-400' :
              confidence >= 55 ? 'bg-gradient-to-r from-amber-500 to-amber-400' :
              'bg-gradient-to-r from-rose-500 to-rose-400'
            }`}
            style={{ width: `${confidence}%` }}
          />
        </div>
        
        {/* Labels */}
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] text-gray-500">Low</span>
          <span className="text-[9px] text-gray-400 font-medium">{getConfidenceLabel()}</span>
          <span className="text-[9px] text-gray-500">High</span>
        </div>
      </div>

      {/* Current Price & Pivot */}
      <div className="mb-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400 font-medium">Current Price</span>
          <span className="text-xl font-bold text-white">{formatPrice(data.current_price)}</span>
        </div>
        
        {/* Pivot Level */}
        {data.classic_pivots.pivot && (
          <div className="mt-2 pt-2 border-t border-gray-700/40">
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">Pivot Point (P)</span>
              <span className="text-sm font-bold text-cyan-400">{formatPrice(data.classic_pivots.pivot)}</span>
            </div>
            {data.current_price && (
              <div className="text-[9px] text-gray-500 text-right mt-1">
                {((data.current_price - data.classic_pivots.pivot) / data.classic_pivots.pivot * 100).toFixed(2)}% from pivot
              </div>
            )}
          </div>
        )}
      </div>

      {/* Key Levels Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Resistance R1 */}
        <div className="bg-rose-500/10 rounded-lg p-2 border border-rose-500/20">
          <div className="flex items-center gap-1 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span className="text-[10px] text-rose-300 font-medium">Resistance R1</span>
          </div>
          <div className="text-sm font-bold text-white">
            {formatPrice(data.classic_pivots.r1)}
          </div>
          {data.current_price && data.classic_pivots.r1 && (
            <div className="text-[9px] text-gray-400 mt-1">
              {Math.abs(((data.classic_pivots.r1 - data.current_price) / data.current_price * 100)).toFixed(2)}% away
            </div>
          )}
        </div>
        
        {/* Support S1 */}
        <div className="bg-green-500/10 rounded-lg p-2 border border-green-500/20">
          <div className="flex items-center gap-1 mb-1">
            <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-[10px] text-green-300 font-medium">Support S1</span>
          </div>
          <div className="text-sm font-bold text-white">
            {formatPrice(data.classic_pivots.s1)}
          </div>
          {data.current_price && data.classic_pivots.s1 && (
            <div className="text-[9px] text-gray-400 mt-1">
              {Math.abs(((data.current_price - data.classic_pivots.s1) / data.current_price * 100)).toFixed(2)}% away
            </div>
          )}
        </div>
      </div>

      {/* Supertrend Status */}
      <div className="grid grid-cols-2 gap-2">
        {/* ST 10,3 */}
        <div className={`p-2.5 rounded-lg border ${
          data.supertrend_10_3.trend === 'BULLISH' ? 'bg-green-500/10 border-green-500/30' :
          data.supertrend_10_3.trend === 'BEARISH' ? 'bg-rose-500/10 border-rose-500/30' :
          'bg-gray-700/30 border-gray-600/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">ST 10,3</span>
          <span className={`text-sm font-bold ${
            data.supertrend_10_3.trend === 'BULLISH' ? 'text-green-400' :
            data.supertrend_10_3.trend === 'BEARISH' ? 'text-rose-400' : 'text-gray-400'
          }`}>
            {data.supertrend_10_3.trend}
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {Math.abs(data.supertrend_10_3.distance_pct).toFixed(2)}% away
          </div>
        </div>
        
        {/* ST 7,3 */}
        <div className={`p-2.5 rounded-lg border ${
          data.supertrend_7_3.trend === 'BULLISH' ? 'bg-green-500/10 border-green-500/30' :
          data.supertrend_7_3.trend === 'BEARISH' ? 'bg-rose-500/10 border-rose-500/30' :
          'bg-gray-700/30 border-gray-600/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">ST 7,3</span>
          <span className={`text-sm font-bold ${
            data.supertrend_7_3.trend === 'BULLISH' ? 'text-green-400' :
            data.supertrend_7_3.trend === 'BEARISH' ? 'text-rose-400' : 'text-gray-400'
          }`}>
            {data.supertrend_7_3.trend}
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {Math.abs(data.supertrend_7_3.distance_pct).toFixed(2)}% away
          </div>
        </div>
      </div>
    </div>
  );
});

PivotIndicatorsCard.displayName = 'PivotIndicatorsCard';

export default PivotIndicatorsCard;

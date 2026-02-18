'use client';

import React, { memo, useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Flame } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

interface CandleIntentData {
  symbol: string;
  timestamp: string;
  current_candle: {
    close: number;
    volume: number;
  };
  pattern: {
    type: string;
    intent: string;
    confidence: number;
  };
  wick_analysis: {
    upper_signal: string;
    lower_signal: string;
    dominant_wick: string;
  };
  body_analysis: {
    body_ratio_pct: number;
    is_bullish: boolean;
    strength: number;
  };
  volume_analysis: {
    volume_ratio: number;
    efficiency: string;
  };
  near_zone: boolean;
  professional_signal: string;
  status?: string;
  error?: string;
}

interface CandleIntentCardProps {
  symbol: string;
  name: string;
}

// Helper: Get trading signal based on candle analysis
const getCandleSignal = (data: CandleIntentData): string => {
  const { pattern, body_analysis, wick_analysis, volume_analysis, professional_signal } = data;
  
  // Use professional signal as base, but validate with pattern
  const profSignal = professional_signal || 'NEUTRAL';
  
  // Strong signals when all factors align
  if (profSignal === 'STRONG_BUY' && pattern.confidence >= 70 && body_analysis.is_bullish) {
    return 'STRONG BUY';
  }
  if (profSignal === 'STRONG_SELL' && pattern.confidence >= 70 && !body_analysis.is_bullish) {
    return 'STRONG SELL';
  }
  
  // Regular signals
  if (profSignal === 'BUY' || (body_analysis.is_bullish && body_analysis.strength >= 60)) {
    return 'BUY';
  }
  if (profSignal === 'SELL' || (!body_analysis.is_bullish && body_analysis.strength >= 60)) {
    return 'SELL';
  }
  
  // Check wick confirmation
  if (wick_analysis.lower_signal === 'BULLISH' && volume_analysis.volume_ratio >= 1.2) {
    return 'BUY';
  }
  if (wick_analysis.upper_signal === 'BEARISH' && volume_analysis.volume_ratio >= 1.2) {
    return 'SELL';
  }
  
  return 'SIDEWAYS';
};

// Helper: Calculate realistic confidence (35-85%)
const calculateCandleConfidence = (data: CandleIntentData): number => {
  let confidence = 50; // Base
  
  // Pattern confidence (25% weight)
  const patternConf = data.pattern.confidence;
  if (patternConf >= 80) confidence += 18;
  else if (patternConf >= 65) confidence += 12;
  else if (patternConf >= 50) confidence += 6;
  else confidence -= 8;
  
  // Body strength (20% weight)
  const bodyStrength = data.body_analysis.strength;
  const bodyRatio = data.body_analysis.body_ratio_pct;
  if (bodyStrength >= 75 && bodyRatio >= 60) confidence += 15; // Decisive candle
  else if (bodyStrength >= 60) confidence += 8;
  else if (bodyRatio < 30) confidence -= 8; // Indecisive
  
  // Volume confirmation (20% weight)
  const volumeRatio = data.volume_analysis.volume_ratio;
  const volumeEff = data.volume_analysis.efficiency;
  if (volumeRatio >= 2.0 && volumeEff === 'ABSORPTION') confidence += 15; // Strong volume
  else if (volumeRatio >= 1.5) confidence += 10;
  else if (volumeRatio >= 1.2) confidence += 5;
  else if (volumeRatio < 0.8) confidence -= 10; // Weak volume
  
  // Wick analysis (15% weight)
  const signal = getCandleSignal(data);
  const wickConfirms = 
    (signal === 'BUY' && data.wick_analysis.lower_signal === 'BULLISH') ||
    (signal === 'SELL' && data.wick_analysis.upper_signal === 'BEARISH');
  if (wickConfirms) confidence += 12;
  else if (data.wick_analysis.dominant_wick === 'NEITHER') confidence -= 5;
  
  // Signal strength (10% weight)
  if (signal.includes('STRONG')) confidence += 8;
  else if (signal !== 'SIDEWAYS') confidence += 4;
  else confidence -= 5;
  
  // Near critical zone (5% weight)
  if (data.near_zone) confidence += 5;
  
  // Market status (5% weight)
  if (data.status === 'LIVE') confidence += 5;
  else if (data.status === 'CACHED') confidence -= 3;
  
  // Clamp to realistic range 35-85%
  return Math.min(85, Math.max(35, Math.round(confidence)));
};

const CandleIntentCard = memo<CandleIntentCardProps>(({ symbol, name }) => {
  const [data, setData] = useState<CandleIntentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const response = await fetch(
          API_CONFIG.endpoint(`/api/advanced/candle-intent/${symbol}`),
          { signal: controller.signal }
        );
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.status === 'ERROR' || result.status === 'TOKEN_EXPIRED' || result.error) {
          setError(result.message || result.error || 'Authentication error');
          setData(null);
        } else if (!result.pattern || !result.current_candle) {
          setError('Incomplete data');
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
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [symbol]);

  const formatVolume = (vol: number): string => {
    if (vol >= 1000000) return `${(vol / 1000000).toFixed(2)}M`;
    if (vol >= 1000) return `${(vol / 1000).toFixed(2)}K`;
    return vol.toFixed(0);
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
          <Flame className="w-5 h-5" />
          <span>{name}</span>
        </div>
        <p className="text-xs text-gray-400 mt-2">{error || 'No data'}</p>
      </div>
    );
  }

  const signal = getCandleSignal(data);
  const confidence = calculateCandleConfidence(data);
  
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
          <Flame className="w-5 h-5 text-orange-400" />
          <h3 className="text-base font-semibold text-white">{name}</h3>
          {/* Live Status Badge */}
          {data.status === 'LIVE' && (
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-[10px] text-emerald-300 font-bold">LIVE</span>
            </div>
          )}
        </div>
        
        {/* Confidence Badge */}
        <div className={`text-center px-2.5 py-1 rounded-lg border-2 bg-black/30 ${
          confidence >= 70 ? 'border-emerald-500/40' :
          confidence >= 55 ? 'border-amber-500/40' :
          'border-rose-500/40'
        }`}>
          <div className="text-[10px] font-semibold text-white/60">Confidence</div>
          <div className="text-base font-bold text-white">{confidence}%</div>
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
          {signal === 'STRONG BUY' && 'Strong bullish candle with high volume confirmation'}
          {signal === 'BUY' && 'Bullish candle pattern - Consider entry'}
          {signal === 'SELL' && 'Bearish candle pattern - Consider exit'}
          {signal === 'STRONG SELL' && 'Strong bearish candle with high volume confirmation'}
          {signal === 'SIDEWAYS' && 'Indecisive candle - Wait for confirmation'}
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

      {/* Candle Analysis - Simplified */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Pattern Recognition */}
        <div className={`p-2.5 rounded-lg border ${
          data.pattern.intent === 'BULLISH' ? 'bg-green-500/10 border-green-500/30' :
          data.pattern.intent === 'BEARISH' ? 'bg-rose-500/10 border-rose-500/30' :
          'bg-amber-500/10 border-amber-500/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">Pattern</span>
          <span className={`text-sm font-bold ${
            data.pattern.intent === 'BULLISH' ? 'text-green-400' :
            data.pattern.intent === 'BEARISH' ? 'text-rose-400' : 'text-amber-400'
          }`}>
            {data.pattern.type}
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {data.pattern.confidence}% confidence
          </div>
        </div>
        
        {/* Body Strength */}
        <div className={`p-2.5 rounded-lg border ${
          data.body_analysis.is_bullish ? 'bg-green-500/10 border-green-500/30' :
          'bg-rose-500/10 border-rose-500/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">Body</span>
          <span className={`text-sm font-bold ${
            data.body_analysis.is_bullish ? 'text-green-400' : 'text-rose-400'
          }`}>
            {data.body_analysis.is_bullish ? 'Bullish' : 'Bearish'}
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {data.body_analysis.body_ratio_pct.toFixed(0)}% body ratio
          </div>
        </div>
      </div>

      {/* Volume & Wicks */}
      <div className="grid grid-cols-2 gap-3">
        {/* Volume Analysis */}
        <div className={`p-2.5 rounded-lg border ${
          data.volume_analysis.volume_ratio >= 1.5 ? 'bg-green-500/10 border-green-500/30' :
          data.volume_analysis.volume_ratio >= 1.0 ? 'bg-amber-500/10 border-amber-500/30' :
          'bg-rose-500/10 border-rose-500/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">Volume</span>
          <span className={`text-sm font-bold ${
            data.volume_analysis.volume_ratio >= 1.5 ? 'text-green-400' :
            data.volume_analysis.volume_ratio >= 1.0 ? 'text-amber-400' : 'text-rose-400'
          }`}>
            {data.volume_analysis.volume_ratio.toFixed(2)}x
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {formatVolume(data.current_candle.volume)}
          </div>
        </div>
        
        {/* Wick Dominance */}
        <div className={`p-2.5 rounded-lg border ${
          data.wick_analysis.dominant_wick === 'LOWER' ? 'bg-green-500/10 border-green-500/30' :
          data.wick_analysis.dominant_wick === 'UPPER' ? 'bg-rose-500/10 border-rose-500/30' :
          'bg-gray-700/30 border-gray-600/30'
        }`}>
          <span className="text-[10px] text-gray-400 font-medium block mb-1">Wick</span>
          <span className={`text-sm font-bold ${
            data.wick_analysis.dominant_wick === 'LOWER' ? 'text-green-400' :
            data.wick_analysis.dominant_wick === 'UPPER' ? 'text-rose-400' : 'text-gray-400'
          }`}>
            {data.wick_analysis.dominant_wick === 'LOWER' ? 'Lower' :
             data.wick_analysis.dominant_wick === 'UPPER' ? 'Upper' : 'Balanced'}
          </span>
          <div className="text-[9px] text-gray-400 mt-1">
            {data.wick_analysis.dominant_wick === 'LOWER' ? 'Bullish rejection' :
             data.wick_analysis.dominant_wick === 'UPPER' ? 'Bearish rejection' : 'No rejection'}
          </div>
        </div>
      </div>

      {/* Near Zone Alert */}
      {data.near_zone && (
        <div className="mt-3 p-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center gap-1.5">
            <span className="text-blue-400 text-xs">⚡</span>
            <span className="text-[10px] text-blue-300 font-medium">
              Near key support/resistance zone
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

CandleIntentCard.displayName = 'CandleIntentCard';

export default CandleIntentCard;

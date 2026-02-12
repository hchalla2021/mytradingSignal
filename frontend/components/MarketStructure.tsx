'use client';

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { MarketTick } from '@/hooks/useMarketSocket';

interface MarketStructureProps {
  symbol: string;
  name: string;
  data: MarketTick | null;
  analysis: any;
}

interface MarketLevels {
  trend: 'UPTREND' | 'DOWNTREND' | 'RANGE';
  range: {
    high: number;
    low: number;
    width: number;
    midpoint: number;
    percentFromHigh: number;
    percentFromLow: number;
  };
  supportResistance: {
    resistance: number[];
    support: number[];
  };
  liquidityZones: {
    highVolume: number[];
    lowVolume: number[];
  };
  prevDayLevels: {
    high: number;
    low: number;
    close: number;
  };
  structure: string; // "STRONG_UP" | "WEAK_UP" | "CONSOLIDATING" | "WEAK_DOWN" | "STRONG_DOWN"
}

/**
 * Market Structure Analyzer - Professional trader perspective
 * 
 * 🔥 IMPROVED: Uses weighted scoring instead of strict AND conditions
 * This makes the trend more responsive to actual market movement
 * 
 * SCORING SYSTEM (0-100):
 * - 50 = Neutral/RANGE
 * - 65+ = UPTREND (confidence increases from 65 onwards)
 * - 80+ = STRONG_UP
 * - 35- = DOWNTREND  
 * - 20- = STRONG_DOWN
 * 
 * TIME COMPLEXITY: O(1) | SPACE COMPLEXITY: O(1)
 */
function analyzeMarketStructure(data: MarketTick | null, analysis: any): MarketLevels {
  if (!data) {
    return {
      trend: 'RANGE',
      range: { high: 0, low: 0, width: 0, midpoint: 0, percentFromHigh: 0, percentFromLow: 0 },
      supportResistance: { resistance: [], support: [] },
      liquidityZones: { highVolume: [], lowVolume: [] },
      prevDayLevels: { high: 0, low: 0, close: 0 },
      structure: 'CONSOLIDATING',
    };
  }

  const current = data.price;
  const dayHigh = data.high;
  const dayLow = data.low;
  const dayClose = data.close; // Previous close
  const dayRange = dayHigh - dayLow;
  const dayMidpoint = dayLow + dayRange / 2;

  // 🔥 PROFESSIONAL PIVOT CALCULATION (Trader Standard, not arbitrary)
  const pivot = (dayHigh + dayLow + dayClose) / 3;
  const r1 = 2 * pivot - dayLow;      // True Resistance 1
  const r2 = pivot + dayRange;         // True Resistance 2
  const s1 = 2 * pivot - dayHigh;     // True Support 1
  const s2 = pivot - dayRange;         // True Support 2

  // 🔥 IMPROVED TREND ANALYSIS - Weighted Scoring System
  // Instead of strict AND conditions, use dynamic weighting
  
  const positionInRange = dayRange > 0 ? (current - dayLow) / dayRange : 0.5;
  const percentAboveClose = dayClose > 0 ? ((current - dayClose) / dayClose) * 100 : 0;
  const rangePercent = dayClose > 0 ? (dayRange / dayClose) * 100 : 0;

  // Score system (0-100, where 50 = neutral)
  let trendScore = 50;

  // Factor 1: Position in range (contributes ±30 points)
  // Top 30% of range = +30, bottom 30% = -30
  if (positionInRange > 0.7) {
    trendScore += 30 * ((positionInRange - 0.7) / 0.3);
  } else if (positionInRange < 0.3) {
    trendScore -= 30 * ((0.3 - positionInRange) / 0.3);
  }

  // Factor 2: Change from previous close (contributes ±40 points)
  // Each 0.05% change = 1 point (capped at ±40)
  if (percentAboveClose > 0) {
    trendScore += Math.min(40, percentAboveClose * 20);
  } else if (percentAboveClose < 0) {
    trendScore += Math.max(-40, percentAboveClose * 20);
  }

  // Determine trend from score
  let trend: 'UPTREND' | 'DOWNTREND' | 'RANGE' = 'RANGE';
  let structure: string = 'CONSOLIDATING';
  const trendConfidence = Math.abs(trendScore - 50); // How strong is the signal?

  // 📊 TREND CLASSIFICATION
  if (trendScore > 65) {
    trend = 'UPTREND';
    structure = trendScore > 80 ? 'STRONG_UP' : 'WEAK_UP';
  } else if (trendScore < 35) {
    trend = 'DOWNTREND';
    structure = trendScore < 20 ? 'STRONG_DOWN' : 'WEAK_DOWN';
  } else {
    trend = 'RANGE';
    // Sub-classify range periods
    if (rangePercent < 0.5) {
      structure = 'CONSOLIDATING';
    } else if (trendScore > 55) {
      structure = 'WEAK_UP';  // Slight bullish bias
    } else if (trendScore < 45) {
      structure = 'WEAK_DOWN'; // Slight bearish bias
    } else {
      structure = 'NEUTRAL_RANGE';
    }
  }

  // 🔥 PROFESSIONAL S/R LEVELS (Pivot-based, not arbitrary)
  const resistance: number[] = [r1, r2];
  const support: number[] = [s1, s2];

  // Add technical levels from analysis if available
  if (analysis?.indicators?.pivot_r1) resistance.push(analysis.indicators.pivot_r1);
  if (analysis?.indicators?.pivot_s1) support.push(analysis.indicators.pivot_s1);
  
  // EMA200 dynamic level
  if (analysis?.indicators?.ema_200) {
    const ema200 = analysis.indicators.ema_200;
    if (ema200 > dayHigh) resistance.push(ema200);
    else if (ema200 < dayLow) support.push(ema200);
  }

  // Remove duplicates (pre-rounded for comparison)
  const uniqueResistance = Array.from(new Set(resistance.map(r => Math.round(r * 100) / 100))).sort((a, b) => b - a);
  const uniqueSupport = Array.from(new Set(support.map(s => Math.round(s * 100) / 100))).sort((a, b) => a - b);

  // 🔥 LIQUIDITY ZONES - Smart zones for traders
  const highVolume: number[] = [];

  // Pivot point (highest liquidity)
  highVolume.push(pivot);
  // Round number levels
  highVolume.push(Math.round(current / 100) * 100);
  // Previous day extremes (market memory)
  highVolume.push(dayHigh, dayLow);

  const uniqueHighVolume = Array.from(new Set(highVolume.map(z => Math.round(z * 100) / 100))).sort((a, b) => a - b);

  // ✅ RANGE METRICS
  const rangeMetrics = {
    high: dayHigh,
    low: dayLow,
    width: dayRange,
    midpoint: dayMidpoint,
    percentFromHigh: ((dayHigh - current) / dayHigh) * 100,
    percentFromLow: ((current - dayLow) / dayLow) * 100,
  };

  return {
    trend,
    range: rangeMetrics,
    supportResistance: {
      resistance: uniqueResistance.slice(0, 3),
      support: uniqueSupport.slice(0, 3),
    },
    liquidityZones: {
      highVolume: uniqueHighVolume.slice(0, 3),
      lowVolume: [],
    },
    prevDayLevels: {
      high: dayHigh,
      low: dayLow,
      close: dayClose,
    },
    structure,
  };
}

// 🔥 MEMOIZED COLOR SELECTOR (outside component to prevent recreation)
const TREND_COLORS = {
  UP: { bg: 'bg-green-900/20', border: 'border-green-500/40', text: 'text-green-400' },
  DOWN: { bg: 'bg-red-900/20', border: 'border-red-500/40', text: 'text-red-400' },
  RANGE: { bg: 'bg-amber-900/20', border: 'border-amber-500/40', text: 'text-amber-400' },
};

function getTrendColor(structure: string) {
  // Handle all UP variations
  if (structure.includes('UP')) return TREND_COLORS.UP;
  // Handle all DOWN variations
  if (structure.includes('DOWN')) return TREND_COLORS.DOWN;
  // Everything else (RANGE, NEUTRAL, CONSOLIDATING, etc)
  return TREND_COLORS.RANGE;
}

const MarketStructure = ({ symbol, name, data, analysis }: MarketStructureProps) => {
  const [cachedData, setCachedData] = useState<MarketTick | null>(null);
  const [cacheLoaded, setCacheLoaded] = useState(false);

  // Load cached data from localStorage immediately on mount
  useEffect(() => {
    if (typeof window === 'undefined') {
      setCacheLoaded(true);
      return;
    }
    
    try {
      const saved = localStorage.getItem('lastMarketData');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed[symbol]) {
          setCachedData(parsed[symbol]);
        }
      }
    } catch (e) {
      console.error(`[${symbol}] Cache error:`, e);
    } finally {
      setCacheLoaded(true);
    }
  }, [symbol]);

  // Use live data if available, otherwise use cached data
  const displayData = data || cachedData;
  const isLive = !!data;
  const hasData = !!displayData;

  const structure = useMemo(() => analyzeMarketStructure(displayData, analysis), [displayData, analysis]);

  // Show loading state while waiting for cache to load OR if no cache and waiting for live data
  if (!cacheLoaded) {
    return (
      <div className="border-2 border-amber-600/30 rounded-xl p-4 bg-amber-900/20 text-amber-200 text-sm animate-pulse">
        <div className="flex items-center gap-2">
          <span className="text-xl">⏳</span>
          <span className="font-bold">Reading cache for {symbol}...</span>
        </div>
      </div>
    );
  }

  // Cache loaded but no data yet
  if (!hasData) {
    return (
      <div className="border-2 border-amber-600/30 rounded-xl p-4 bg-amber-900/20 text-amber-200 text-sm">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="text-3xl mb-2">🎯</div>
            <div className="text-xs text-dark-tertiary">Waiting for data...</div>
          </div>
        </div>
      </div>
    );
  }

  const trendColors = getTrendColor(structure.structure);

  return (
    <div className={`border-2 ${trendColors.border} rounded-xl p-4 transition-all duration-300 ${trendColors.bg} backdrop-blur-sm`}>
      {/* Header */}
      <h4 className="font-bold text-dark-text text-lg mb-4 flex items-center gap-2">
        <span className="text-2xl">🏗️</span>
        {name} • Structure
        {isLive && <span className="text-[10px] ml-1 px-2 py-1 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">🟢 LIVE</span>}
        {!isLive && <span className="text-[10px] ml-1 px-2 py-1 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30">📋 CACHED</span>}
        <span className={`text-xs font-bold px-2 py-1 rounded-full ml-auto ${trendColors.bg} ${trendColors.text} border ${trendColors.border}`}>
          {structure.structure}
        </span>
      </h4>

      <div className="space-y-4">
        {/* 1️⃣ TREND ANALYSIS */}
        <div className="bg-dark-surface/40 rounded-lg border border-dark-border/40 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">Trend</div>
          <div className="flex items-baseline justify-between">
            <div className={`text-2xl font-bold ${trendColors.text}`}>
              {structure.trend === 'UPTREND' ? '📈 UP' : structure.trend === 'DOWNTREND' ? '📉 DOWN' : '➡️ RANGE'}
            </div>
            <div className="text-xs text-dark-tertiary">
              {structure.trend === 'UPTREND' && `+${structure.range.percentFromLow.toFixed(2)}% from Low`}
              {structure.trend === 'DOWNTREND' && `-${structure.range.percentFromHigh.toFixed(2)}% from High`}
              {structure.trend === 'RANGE' && 'Consolidating'}
            </div>
          </div>
        </div>

        {/* 2️⃣ INTRADAY RANGE */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-3 uppercase tracking-wider">Intraday Range</div>
          
          {/* Range Width */}
          <div className="mb-3">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-dark-secondary">Range:</span>
              <span className="font-bold text-dark-text">₹{structure.range.width.toFixed(2)}</span>
            </div>
            {/* Visual range bar */}
            <div className="h-6 bg-dark-secondary/20 rounded-full overflow-hidden flex relative">
              {/* Support zone */}
              <div className="absolute left-0 h-full w-1 bg-red-500/50" title="Support (Low)" />
              {/* Resistance zone */}
              <div className="absolute right-0 h-full w-1 bg-green-500/50" title="Resistance (High)" />
              {/* Current price position */}
              <div
                className="absolute h-full w-1 bg-yellow-400/80 border-l-2 border-yellow-300 transition-all"
                style={{ left: `${(structure.range.percentFromLow / 100) * 100}%` }}
                title={`Current: ₹${displayData!.price.toFixed(2)}`}
              />
            </div>
          </div>

          {/* High/Low/Midpoint Grid */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="bg-red-900/20 rounded p-2 border border-red-500/30 text-center">
              <div className="text-dark-secondary text-[10px]">Low</div>
              <div className="font-bold text-red-400">₹{structure.range.low.toFixed(2)}</div>
            </div>
            <div className="bg-amber-900/20 rounded p-2 border border-amber-500/30 text-center">
              <div className="text-dark-secondary text-[10px]">Mid</div>
              <div className="font-bold text-amber-400">₹{structure.range.midpoint.toFixed(2)}</div>
            </div>
            <div className="bg-green-900/20 rounded p-2 border border-green-500/30 text-center">
              <div className="text-dark-secondary text-[10px]">High</div>
              <div className="font-bold text-green-400">₹{structure.range.high.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* 3️⃣ SUPPORT & RESISTANCE */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3\">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">S/R Levels</div>
          
          {/* Resistance */}
          {structure.supportResistance.resistance.length > 0 && (
            <div className="mb-2">
              <div className="text-[10px] text-green-400 font-bold mb-1">RESISTANCE</div>
              <div className="space-y-1">
                {structure.supportResistance.resistance.map((r, i) => (
                  <div key={`r${i}`} className="flex justify-between items-center text-xs px-2 py-1 bg-green-900/30 rounded border border-green-500/30">
                    <span className="font-mono text-green-400">R{i + 1}</span>
                    <span className="font-bold text-dark-text">₹{r.toFixed(2)}</span>
                    <span className="text-[9px] text-green-300">+{((r - displayData!.price) / displayData!.price * 100).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Support */}
          {structure.supportResistance.support.length > 0 && (
            <div>
              <div className="text-[10px] text-red-400 font-bold mb-1">SUPPORT</div>
              <div className="space-y-1">
                {structure.supportResistance.support.map((s, i) => (
                  <div key={`s${i}`} className="flex justify-between items-center text-xs px-2 py-1 bg-red-900/30 rounded border border-red-500/30">
                    <span className="font-mono text-red-400">S{i + 1}</span>
                    <span className="font-bold text-dark-text">₹{s.toFixed(2)}</span>
                    <span className="text-[9px] text-red-300">{((s - displayData!.price) / displayData!.price * 100).toFixed(2)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 4️⃣ LIQUIDITY ZONES */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">Liquidity Zones</div>
          <div className="space-y-1 text-xs">
            {structure.liquidityZones.highVolume.map((zone, i) => (
              <div key={`lq${i}`} className="flex justify-between items-center px-2 py-1 bg-blue-900/30 rounded border border-blue-500/30">
                <span className="text-blue-300">💧 Zone {i + 1}</span>
                <span className="font-bold text-dark-text">₹{zone.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 5️⃣ PREVIOUS DAY CONTEXT */}
        <div className="bg-emerald-950/20 rounded-lg border border-emerald-500/30 p-3\">
          <div className="text-xs text-dark-secondary font-bold mb-2 uppercase tracking-wider">Yesterday's Levels</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-dark-secondary block text-[10px] mb-1">Yesterday High</span>
              <span className="font-bold text-dark-text">₹{structure.prevDayLevels.high.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-dark-secondary block text-[10px] mb-1">Yesterday Low</span>
              <span className="font-bold text-dark-text">₹{structure.prevDayLevels.low.toFixed(2)}</span>
            </div>
            <div className="col-span-2">
              <span className="text-dark-secondary block text-[10px] mb-1">Yesterday Close</span>
              <span className="font-bold text-dark-text">₹{structure.prevDayLevels.close.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* CURRENT STATUS */}
        <div className={`p-3 rounded-lg border-2 text-center ${trendColors.bg} ${trendColors.border}`}>
          <div className="text-[10px] text-dark-secondary font-bold mb-1">CURRENT PRICE</div>
          <div className={`text-xl font-bold ${trendColors.text}`}>₹{displayData!.price.toFixed(2)}</div>
          <div className="text-[10px] mt-1 text-dark-tertiary">
            {displayData!.change >= 0 ? '+' : ''}{displayData!.change.toFixed(2)} ({displayData!.changePercent > 0 ? '+' : ''}{displayData!.changePercent.toFixed(2)}%)
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketStructure;

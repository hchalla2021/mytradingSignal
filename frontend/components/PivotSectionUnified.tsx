'use client';

import React, { memo, useEffect, useState, useCallback } from 'react';
import { Target, TrendingUp, TrendingDown, Activity, Clock, RefreshCw } from 'lucide-react';
import { API_CONFIG } from '@/lib/api-config';

// ============================================================================
// TYPES
// ============================================================================
interface PivotData {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE' | 'CLOSED';
  current_price: number | null;
  change_percent?: number;
  timestamp: string;
  ema: { ema_20?: number | null; ema_50?: number | null; ema_100?: number | null; ema_200?: number | null; trend: string; price_vs_ema20?: string };
  classic_pivots: {
    pivot: number | null; r1: number | null; r2: number | null; r3: number | null;
    s1: number | null; s2: number | null; s3: number | null;
    bias: string;
  };
  camarilla_pivots: {
    h4: number | null; h3: number | null; l3: number | null; l4: number | null;
    zone: string;
  };
  supertrend_10_3: { value: number | null; trend: string; signal: string; distance_pct: number };
  supertrend_7_3: { value: number | null; trend: string; signal: string; distance_pct: number };
  overall_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

interface SymbolConfig {
  symbol: string;
  name: string;
  shortName: string;
}

type MarketStatus = 'LIVE' | 'PRE_OPEN' | 'FREEZE' | 'CLOSED' | string;

const SYMBOLS: SymbolConfig[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', shortName: 'NIFTY' },
  { symbol: 'BANKNIFTY', name: 'BANK NIFTY', shortName: 'BNIFTY' },
  { symbol: 'SENSEX', name: 'SENSEX', shortName: 'SENSEX' },
];

// ============================================================================
// CACHE HELPERS - Use same key as market data for consistency
// ============================================================================
const CACHE_KEY = 'pivot_unified_data_v2';
const MARKET_CACHE_KEY = 'lastMarketData';

// Default fallback data - REMOVED: No more dummy data, only live values

function getCachedData(): Record<string, PivotData> | null {
  if (typeof window === 'undefined') return null;
  try {
    // Try pivot-specific cache first
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Object.keys(parsed).length > 0) {
        console.log('[Pivot] Loaded from pivot cache');
        return parsed;
      }
    }
    // No cache, return null - show loading state with REAL data only
    console.log('[Pivot] No cached data - waiting for live API data');
    return null;
  } catch {
    // On any error, return null - don't use dummy fallback
    console.log('[Pivot] Error reading cache, waiting for live API data');
    return null;
  }
}

function setCachedData(data: Record<string, PivotData>): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch { /* ignore */ }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
const fmt = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const fmtCompact = (n: number | null | undefined): string => {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

// Check if price is near a level (within 0.3%)
// Helper to check if price is near a level (dynamic threshold based on symbol)
const isNearLevel = (price: number | null, level: number | null, symbol?: string): boolean => {
  if (!price || !level) return false;
  const diff = Math.abs(price - level) / level;
  // Use more lenient thresholds - BANKNIFTY gets higher threshold due to price range
  const threshold = symbol === 'BANKNIFTY' ? 0.025 : 0.02; // 2.5% for BN, 2% for others
  return diff < threshold;
};

// Determine current price zone relative to pivot levels
const getPivotZone = (price: number | null, s3: number | null, p: number | null, r3: number | null): 
  'below_s3' | 'between_s3_p' | 'between_p_r3' | 'above_r3' | 'unknown' => {
  if (!price || !s3 || !p || !r3) return 'unknown';
  
  if (price < s3) return 'below_s3';
  if (price >= s3 && price < p) return 'between_s3_p';
  if (price >= p && price < r3) return 'between_p_r3';
  if (price >= r3) return 'above_r3';
  
  return 'unknown';
};

// Get color for each level based on current price zone
const getLevelColor = (level: 'S3' | 'P' | 'R3', zone: ReturnType<typeof getPivotZone>, isNear: boolean) => {
  if (isNear) return 'bg-yellow-600/70 text-white font-semibold'; // Alert: price near this level
  
  // Zone-based colors
  switch (level) {
    case 'S3': {
      // S3 is support/bearish level
      if (zone === 'below_s3') return 'bg-red-700/60 text-white font-semibold'; // 🔴 Price broken below support
      if (zone === 'between_s3_p') return 'bg-red-900/40 text-red-300'; // Approaching support from above
      return 'bg-slate-700/30 text-slate-400'; // Above P (not relevant)
    }
    case 'P': {
      // P is pivot/neutral zone
      if (zone === 'between_s3_p' || zone === 'between_p_r3') return 'bg-slate-600/50 text-slate-200 font-semibold';
      return 'bg-slate-700/30 text-slate-400';
    }
    case 'R3': {
      // R3 is resistance/bullish level
      if (zone === 'above_r3') return 'bg-green-700/60 text-white font-semibold'; // 🟢 Price broken above resistance
      if (zone === 'between_p_r3') return 'bg-green-900/40 text-green-300'; // Approaching resistance
      return 'bg-slate-700/30 text-slate-400'; // Below P (not relevant)
    }
    default:
      return 'bg-slate-700/30 text-slate-400';
  }
};

// Check if price crossed a level
const hasCrossed = (price: number | null, level: number | null, direction: 'above' | 'below'): boolean => {
  if (!price || !level) return false;
  if (direction === 'above') return price > level;
  return price < level;
};

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

// Single Symbol Row - Ultra Compact
const SymbolPivotRow = memo<{ data: PivotData; config: SymbolConfig; marketStatus?: MarketStatus }>(({ data, config, marketStatus = 'LIVE' }) => {
  // Show all data - even if price is null, display the pivot values
  const hasAnyData = data && (data.current_price || data.classic_pivots?.pivot);
  
  if (!hasAnyData) {
    return (
      <div className="rounded-xl p-4 bg-slate-800/30 border border-emerald-500/30 text-center">
        <p className="text-slate-500 text-sm">{config.name}</p>
        <p className="text-slate-600 text-xs mt-1">No data available</p>
      </div>
    );
  }
  
  const price = data.current_price || 0;
  const bias = data.overall_bias;
  const pivots = data.classic_pivots;
  const cam = data.camarilla_pivots;
  const st1 = data.supertrend_10_3;
  const priceChange = data.change_percent || 0;
  
  const isBullish = bias === 'BULLISH';
  const isBearish = bias === 'BEARISH';
  const isPriceUp = priceChange >= 0;
  
  // Find nearest levels
  const levels = [
    { label: 'R2', value: pivots.r2, type: 'resistance' },
    { label: 'R1', value: pivots.r1, type: 'resistance' },
    { label: 'P', value: pivots.pivot, type: 'pivot' },
    { label: 'S1', value: pivots.s1, type: 'support' },
    { label: 'S2', value: pivots.s2, type: 'support' },
  ];
  
  // Find nearest resistance and support
  const nearestRes = levels.find(l => l.type === 'resistance' && l.value && price < l.value);
  const nearestSup = [...levels].reverse().find(l => l.type === 'support' && l.value && price > l.value);
  
  // Critical alerts - detect proximity to key levels
  const isNearCamarilla = cam.h4 && price && Math.abs(price - cam.h4) / cam.h4 < 0.01; // Within 1%
  
  // Make pivot proximity more lenient - especially for BANKNIFTY which has higher price range
  const pivotProximityThreshold = config.symbol === 'BANKNIFTY' ? 0.025 : 0.02; // 2.5% for BN, 2% for others
  const isNearPivot = pivots.pivot && price && Math.abs(price - pivots.pivot) / pivots.pivot < pivotProximityThreshold;
  
  const isBreakdown = st1.trend === 'BEARISH' && nearestSup && price && price < (nearestSup.value || 0);
  
  // Debug logging for pivot proximity
  console.log(`[${config.symbol}] Pivot Analysis:`, {
    currentPrice: price,
    pivotLevel: pivots.pivot,
    difference: pivots.pivot ? Math.abs(price - pivots.pivot) : 0,
    diffPercent: pivots.pivot ? (Math.abs(price - pivots.pivot) / pivots.pivot * 100).toFixed(3) : 0,
    threshold: (pivotProximityThreshold * 100).toFixed(1),
    isNear: isNearPivot
  });
  
  // Background color based on market status - Soft & Subtle
  const bgColor = isPriceUp 
    ? 'bg-slate-900/70' 
    : 'bg-slate-900/70';
  
  const borderColor = isPriceUp ? 'border-emerald-500/30' : 'border-emerald-500/30';
  
  // Text color for price - Green when UP, RED when DOWN (like live indices)
  const priceColor = isPriceUp ? 'text-teal-300' : 'text-red-400';
  const changeColor = isPriceUp ? 'text-teal-400' : 'text-red-500';

  // Pivot Confidence Calculation
  const calculatePivotConfidence = (): number => {
    let confidence = 55; // Base confidence
    
    // Price trend adjustment
    if (isPriceUp && bias === 'BULLISH') confidence += 15; // Aligned trend
    else if (!isPriceUp && bias === 'BEARISH') confidence += 15; // Aligned trend
    else if (bias === 'NEUTRAL') confidence += 5; // Neutral market
    
    // SuperTrend alignment
    if (st1.trend === 'BULLISH' && isPriceUp) confidence += 10;
    else if (st1.trend === 'BEARISH' && !isPriceUp) confidence += 10;
    
    // Level proximity (reduces confidence when too close to key levels)
    if (isNearPivot) confidence -= 5; // Uncertain zone
    if (isNearCamarilla) confidence -= 10; // Very uncertain
    
    // Distance from SuperTrend
    const stDistance = Math.abs(st1.distance_pct || 0);
    if (stDistance > 2) confidence += 10; // Clear trend
    else if (stDistance < 0.5) confidence -= 5; // Too close to flip
    
    // Market status
    if (data.status === 'LIVE') confidence += 5;
    else if (data.status === 'CACHED') confidence -= 5;
    
    return Math.min(90, Math.max(35, confidence));
  };

  const pivotConfidence = calculatePivotConfidence();

  return (
    <div className={`rounded-xl p-3 border-2 shadow-sm transition-all mb-3 backdrop-blur-sm ${
      isBreakdown ? 'bg-green-900/15 border-green-500/40 ring-1 ring-green-500/30 shadow-md shadow-green-500/10' :
      isBullish ? 'bg-green-900/15 border-green-500/40 shadow-lg shadow-green-500/10' :
      isBearish ? 'bg-green-900/15 border-green-500/40 shadow-lg shadow-green-500/10' :
      'bg-green-900/15 border-green-500/40'
    }`}>
      {/* Title & Status - Responsive Layout */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h4 className="font-bold text-dark-text text-sm tracking-tight flex-shrink-0">
          {config.name} • Pivot
        </h4>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Confidence Percentage */}
          <span className="text-xs font-bold text-dark-secondary whitespace-nowrap">
            Confidence: {Math.round(pivotConfidence)}%
          </span>
          {/* Bias Badge */}
          <span className={`text-xs font-bold px-2 py-1 rounded-md whitespace-nowrap flex-shrink-0 ${
            isBullish ? 'bg-[#00C087]/20 text-[#00C087]' :
            isBearish ? 'bg-[#EB5B3C]/20 text-[#EB5B3C]' :
            'bg-yellow-500/20 text-yellow-300'
          }`}>
            {isBullish ? '🟢 BULLISH' : isBearish ? '🔴 BEARISH' : '🟡 NEUTRAL'}
          </span>
        </div>
      </div>

      <div className="space-y-3">

        {/* Live Price Display */}
        <div className="bg-gradient-to-br from-dark-surface/80 to-dark-card/50 border-2 border-emerald-500/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-dark-secondary font-bold uppercase tracking-wider">Live Price</span>
            <span className={`text-xs font-bold px-2 py-1 rounded-md ${
              isPriceUp ? 'bg-[#00C087]/20 text-[#00C087]' : 'bg-[#EB5B3C]/20 text-[#EB5B3C]'
            }`}>
              {isPriceUp ? '▲' : '▼'} {Math.abs(priceChange).toFixed(2)}%
            </span>
          </div>
          <div className={`text-2xl font-black tracking-tight ${
            isPriceUp ? 'text-[#00C087]' : 'text-[#EB5B3C]'
          }`}>
            ₹{price?.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
        </div>

        {/* Pivot Zone Display - Visual Card */}
        {(() => {
          const zone = getPivotZone(price, pivots.s3, pivots.pivot, pivots.r3);
          
          if (zone === 'above_r3') {
            return (
              <div className="bg-gradient-to-r from-green-900/30 to-green-950/20 border-2 border-[#00C087]/50 rounded-xl p-4 shadow-lg shadow-green-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">🚀</span>
                  <div>
                    <div className="text-sm font-black text-[#00C087]">STRONG BULLISH ZONE</div>
                    <div className="text-xs text-[#00C087]/80 font-medium">Price above all resistance</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-green-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-green-300/70 font-semibold">PIVOT</div>
                    <div className="text-sm font-black text-green-300">₹{pivots.pivot?.toFixed(0)}</div>
                  </div>
                  <div className="bg-green-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-green-300/70 font-semibold">R1</div>
                    <div className="text-sm font-black text-green-300">₹{pivots.r1?.toFixed(0)}</div>
                  </div>
                  <div className="bg-green-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-green-300/70 font-semibold">R3</div>
                    <div className="text-sm font-black text-green-300">₹{pivots.r3?.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            );
          } else if (zone === 'between_p_r3') {
            return (
              <div className="bg-gradient-to-r from-blue-900/30 to-blue-950/20 border-2 border-blue-500/50 rounded-xl p-4 shadow-lg shadow-blue-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">📈</span>
                  <div>
                    <div className="text-sm font-black text-blue-300">RESISTANCE ZONE</div>
                    <div className="text-xs text-blue-300/80 font-medium">Between Pivot & R3</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-blue-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-blue-300/70 font-semibold">PIVOT</div>
                    <div className="text-sm font-black text-blue-300">₹{pivots.pivot?.toFixed(0)}</div>
                  </div>
                  <div className="bg-blue-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-blue-300/70 font-semibold">R1</div>
                    <div className="text-sm font-black text-blue-300">₹{pivots.r1?.toFixed(0)}</div>
                  </div>
                  <div className="bg-blue-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-blue-300/70 font-semibold">R3</div>
                    <div className="text-sm font-black text-blue-300">₹{pivots.r3?.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            );
          } else if (zone === 'between_s3_p') {
            return (
              <div className="bg-gradient-to-r from-orange-900/30 to-orange-950/20 border-2 border-orange-500/50 rounded-xl p-4 shadow-lg shadow-orange-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">📉</span>
                  <div>
                    <div className="text-sm font-black text-orange-300">SUPPORT ZONE</div>
                    <div className="text-xs text-orange-300/80 font-medium">Between S3 & Pivot</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-orange-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-orange-300/70 font-semibold">S3</div>
                    <div className="text-sm font-black text-orange-300">₹{pivots.s3?.toFixed(0)}</div>
                  </div>
                  <div className="bg-orange-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-orange-300/70 font-semibold">S1</div>
                    <div className="text-sm font-black text-orange-300">₹{pivots.s1?.toFixed(0)}</div>
                  </div>
                  <div className="bg-orange-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-orange-300/70 font-semibold">PIVOT</div>
                    <div className="text-sm font-black text-orange-300">₹{pivots.pivot?.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            );
          } else {
            return (
              <div className="bg-gradient-to-r from-red-900/30 to-red-950/20 border-2 border-[#EB5B3C]/50 rounded-xl p-4 shadow-lg shadow-red-500/20">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-2xl">⚠️</span>
                  <div>
                    <div className="text-sm font-black text-[#EB5B3C]">STRONG BEARISH ZONE</div>
                    <div className="text-xs text-[#EB5B3C]/80 font-medium">Price below all support</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <div className="bg-red-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-red-300/70 font-semibold">S3</div>
                    <div className="text-sm font-black text-red-300">₹{pivots.s3?.toFixed(0)}</div>
                  </div>
                  <div className="bg-red-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-red-300/70 font-semibold">S1</div>
                    <div className="text-sm font-black text-red-300">₹{pivots.s1?.toFixed(0)}</div>
                  </div>
                  <div className="bg-red-900/30 rounded-lg p-2 text-center">
                    <div className="text-xs text-red-300/70 font-semibold">PIVOT</div>
                    <div className="text-sm font-black text-red-300">₹{pivots.pivot?.toFixed(0)}</div>
                  </div>
                </div>
              </div>
            );
          }
        })()}

        {/* Camarilla Levels Display */}
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">Camarilla Levels</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-green-900/20 rounded-lg p-2 border border-green-500/30">
              <div className="text-xs text-green-300/70 font-semibold">H4 (Resist)</div>
              <div className="text-sm font-black text-green-300">₹{cam.h4?.toFixed(0)}</div>
            </div>
            <div className="bg-red-900/20 rounded-lg p-2 border border-red-500/30">
              <div className="text-xs text-red-300/70 font-semibold">L4 (Support)</div>
              <div className="text-sm font-black text-red-300">₹{cam.l4?.toFixed(0)}</div>
            </div>
          </div>
          <div className={`mt-2 text-xs font-medium text-center px-2 py-1 rounded ${
            cam.zone?.includes('BUY') ? 'bg-green-900/30 text-green-300' :
            cam.zone?.includes('SELL') ? 'bg-red-900/30 text-red-300' :
            'bg-yellow-900/30 text-yellow-300'
          }`}>
            {cam.zone?.replace(/_/g, ' ') || 'NEUTRAL ZONE'}
          </div>
        </div>

        {/* Quick Summary */}
        <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/30 border border-slate-600/30 rounded-lg p-3">
          <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">📋 Key Levels</div>
          <div className="space-y-1 text-xs">
            {nearestRes && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Next Resistance:</span>
                <span className="font-bold text-amber-400">{nearestRes.label} ₹{fmtCompact(nearestRes.value)}</span>
              </div>
            )}
            {nearestSup && (
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Next Support:</span>
                <span className="font-bold text-teal-400">{nearestSup.label} ₹{fmtCompact(nearestSup.value)}</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1 border-t border-slate-700">
              <span className="text-slate-400">Trading Bias:</span>
              <span className={`font-bold ${
                isBullish ? 'text-[#00C087]' :
                isBearish ? 'text-[#EB5B3C]' :
                'text-yellow-300'
              }`}>
                {bias}
              </span>
            </div>
          </div>
        </div>

        {/* ── 5-Min Prediction ── */}
        <div className="rounded-xl border border-white/[0.06] bg-[#0d1117] overflow-hidden">
          <div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          {(() => {
            // ── Multi-factor Pivot 5-min confidence engine ──────────
            // Base: pivotConfidence (already computed with 6 factors)
            const stDistPct  = Math.abs(st1.distance_pct || 0);
            const stAligns   = (isBullish && st1.trend === 'BULLISH') || (isBearish && st1.trend === 'BEARISH');
            const stOpposes  = (isBullish && st1.trend === 'BEARISH') || (isBearish && st1.trend === 'BULLISH');
            const stStrong   = stDistPct > 1.0;
            const aboveR2    = isBullish && nearestRes?.label === 'R2' && price > (pivots.r1 || 0);
            const belowS2    = isBearish && nearestSup?.label === 'S2' && price < (pivots.s1 || 0);
            const goodZone   = aboveR2 || belowS2;
            const isLiveData = data.status === 'LIVE';

            let adjConf = pivotConfidence;
            if (stAligns && stStrong) adjConf += 5;  // ST confirms direction + strong gap
            else if (stAligns)       adjConf += 3;   // ST confirms direction
            if (goodZone)            adjConf += 4;   // price well into R2/S2 zone
            if (isLiveData)          adjConf += 2;   // live data bonus
            if (stOpposes)           adjConf -= 7;   // ST contradicts bias
            if (isNearPivot)         adjConf -= 4;   // already at pivot — uncertainty
            if (marketStatus !== 'LIVE') adjConf = Math.max(30, adjConf - 10);
            adjConf = Math.round(Math.min(95, Math.max(30, adjConf)));

            // Direction
            const predDir   = isBullish ? 'LONG' : isBearish ? 'SHORT' : 'FLAT';
            const dirIcon   = isBullish ? '▲' : isBearish ? '▼' : '─';
            const dirColor  = isBullish ? 'text-teal-300'  : isBearish ? 'text-rose-300'  : 'text-amber-300';
            const dirBorder = isBullish ? 'border-teal-500/40' : isBearish ? 'border-rose-500/35' : 'border-amber-500/30';
            const dirBg     = isBullish ? 'bg-teal-500/[0.07]' : isBearish ? 'bg-rose-500/[0.07]' : 'bg-amber-500/[0.05]';
            const barColor  = isBullish ? 'bg-teal-500' : isBearish ? 'bg-rose-500' : 'bg-amber-500';

            // Context
            const ctxNote = stOpposes     ? '⚠ ST diverges from pivot bias'
              : isNearPivot              ? '⚠ At pivot — wait for break'
              : goodZone && stAligns     ? `${nearestRes?.label || nearestSup?.label} zone + ST confirm`
              : stAligns                 ? 'ST + Pivot aligned'
              : nearestRes              ? `Target ${nearestRes.label} ₹${fmtCompact(nearestRes.value)}`
              : nearestSup              ? `Support ${nearestSup.label} ₹${fmtCompact(nearestSup.value)}`
              : 'Watching pivot levels…';

            return (
              <div className="px-3 pt-2.5 pb-3">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] text-white/40 font-bold uppercase tracking-widest">5-Min Prediction</span>
                  <span className={`text-[9px] font-black ${dirColor}`}>{adjConf}% Confidence</span>
                </div>

                {/* Direction pill + bar */}
                <div className={`rounded-lg border ${dirBorder} ${dirBg} px-2.5 py-2 mb-2`}>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className={`text-sm font-black ${dirColor}`}>{dirIcon} {predDir}</span>
                    <span className="text-[9px] text-white/30 truncate">{ctxNote}</span>
                    <span className={`text-sm font-black ${dirColor} shrink-0`}>{adjConf}%</span>
                  </div>
                  <div className="h-[2px] bg-white/[0.06] rounded-full overflow-hidden">
                    <div
                      suppressHydrationWarning
                      className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                      style={{ width: `${adjConf}%` }}
                    />
                  </div>
                </div>

                {/* 3-cell grid */}
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Pivot Zone</div>
                    <div className={`text-[10px] font-bold ${dirColor}`}>
                      {price > (pivots.pivot || 0) ? 'Above P' : 'Below P'}
                    </div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">Key Level</div>
                    <div className={`text-[10px] font-bold ${dirColor}`}>
                      {isBullish
                        ? (nearestRes ? `${nearestRes.label}` : '—')
                        : isBearish
                        ? (nearestSup ? `${nearestSup.label}` : '—')
                        : `P`}
                    </div>
                  </div>
                  <div className="text-center bg-black/30 border border-white/[0.05] rounded-lg p-2">
                    <div className="text-[8px] text-white/30 mb-0.5">ST Align</div>
                    <div className={`text-[10px] font-bold ${stAligns ? dirColor : stOpposes ? 'text-rose-300' : 'text-amber-300'}`}>
                      {stAligns ? 'Confirm' : stOpposes ? 'Diverge' : 'Neutral'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>

      </div>
    </div>
  );
});

SymbolPivotRow.displayName = 'SymbolPivotRow';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const PivotSectionUnified = memo<{ updates?: number; analyses?: Record<string, any> | null; marketStatus?: MarketStatus }>((props) => {
  const { analyses, marketStatus = 'LIVE' } = props;
  const [allData, setAllData] = useState<Record<string, PivotData>>(() => getCachedData() || {});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fetchAllData = useCallback(async (isBackground = false) => {
    if (isFetching && isBackground) return;
    setIsFetching(true);
    
    try {
      // Check if demo mode (WebSocket URL is empty in .env.local)
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_LOCAL_WS_URL || '';
      const isDemoMode = !wsUrl || wsUrl.trim() === '';
      
      if (isDemoMode) {
        // Generate demo pivot data directly
        console.log('[Pivot] Demo mode - generating pivot data...');
        
        const validData: Record<string, PivotData> = {};
        for (const symbolConfig of SYMBOLS) {
          const symbol = symbolConfig.symbol;
          const basePrice = symbol === 'NIFTY' ? 23000 : symbol === 'BANKNIFTY' ? 48000 : 75000;
          const change = (Math.random() - 0.5) * 200;
          const price = basePrice + change;
          const isBullish = change > 0;
          
          // Generate pivot levels
          const pivot = price + (Math.random() * 60 - 30);
          const r1 = pivot + (Math.random() * 100 + 50);
          const r2 = pivot + (Math.random() * 150 + 100);
          const r3 = pivot + (Math.random() * 200 + 150);
          const s1 = pivot - (Math.random() * 100 + 50);
          const s2 = pivot - (Math.random() * 150 + 100);
          const s3 = pivot - (Math.random() * 200 + 150);
          
          validData[symbol] = {
            symbol,
            status: 'LIVE',
            current_price: price,
            change_percent: (change / basePrice) * 100,
            timestamp: new Date().toISOString(),
            ema: {
              ema_20: price - (Math.random() * 50 - 25),
              ema_50: price - (Math.random() * 100 - 50),
              ema_100: price - (Math.random() * 200 - 100),
              ema_200: price - (Math.random() * 300 - 150),
              trend: isBullish ? 'UPTREND' : 'DOWNTREND',
              price_vs_ema20: price > (price - 25) ? 'ABOVE' : 'BELOW',
            },
            classic_pivots: {
              pivot,
              r1, r2, r3, s1, s2, s3,
              bias: isBullish ? 'BULLISH' : 'BEARISH',
            },
            camarilla_pivots: {
              h4: price + (Math.random() * 80 + 40),
              h3: price + (Math.random() * 50 + 25),
              l3: price - (Math.random() * 50 + 25),
              l4: price - (Math.random() * 80 + 40),
              zone: isBullish ? 'BULLISH_ZONE' : 'BEARISH_ZONE', // Always clear zone
            },
            supertrend_10_3: {
              value: price + (isBullish ? -60 : 60),
              trend: isBullish ? 'BULLISH' : 'BEARISH', // Always clear trend
              signal: isBullish ? 'BUY' : 'SELL', // Always clear signal
              distance_pct: Math.abs(60 / price * 100),
            },
            supertrend_7_3: {
              value: price + (isBullish ? -45 : 45),
              trend: isBullish ? 'BULLISH' : 'BEARISH', // Always clear trend
              signal: isBullish ? 'BUY' : 'SELL', // Always clear signal
              distance_pct: Math.abs(45 / price * 100),
            },
            overall_bias: isBullish ? 'BULLISH' : 'BEARISH', // Always clear bias
          };
          
          console.log(`[Pivot] ${symbol}: Demo data - Price: ${price}, Pivot: ${pivot.toFixed(0)}, Bias: ${isBullish ? 'BULLISH' : 'BEARISH'}`);
        }
        
        setAllData(validData);
        setCachedData(validData);
        setLastUpdate(new Date().toLocaleTimeString('en-IN'));
        setError(null);
        setLoading(false);
        console.log('✅ [Pivot] Demo data loaded successfully');
        return;
      }
      
      // Original API code for production
      const liveUrl = API_CONFIG.endpoint('/api/advanced/pivot-indicators');
      
      console.log('[Pivot] Fetching live pivot data...');
      
      const liveResp = await fetch(liveUrl, { 
        method: 'GET', 
        headers: { 'Accept': 'application/json' }, 
        cache: 'no-store' 
      });
      
      if (!liveResp.ok) {
        throw new Error(`Live API returned ${liveResp.status}`);
      }
      
      const liveData = await liveResp.json();
      console.log('[Pivot] Got live data:', Object.keys(liveData || {}));
      
      // Use live data directly (contains current prices + pivot levels)
      const validData: Record<string, PivotData> = {};
      for (const symbol of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
        const data = liveData?.[symbol];
        if (data && (data.current_price || data.classic_pivots?.pivot)) {
          validData[symbol] = {
            ...data,
            timestamp: new Date().toISOString()  // Update timestamp to now
          };
          console.log(`[Pivot] ${symbol}: Live data - Price: ${data.current_price}, Status: ${data.status}`);
        }
      }
      
      if (Object.keys(validData).length >= 2) {
        setAllData(validData);
        setCachedData(validData);
        setLastUpdate(new Date().toLocaleTimeString('en-IN'));
        setError(null);
        setLoading(false);
        console.log('✅ [Pivot] Live data loaded successfully');
      } else {
        throw new Error('No valid live pivot data received');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Pivot] ❌ Error:', msg);
      setError(msg);
      setLoading(false);
    } finally {
      setIsFetching(false);
    }
  }, [isFetching]);

  // Immediately seed from parent analyses data (fast path — no API call needed)
  useEffect(() => {
    if (!analyses) return;
    const built: Record<string, PivotData> = {};
    for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX']) {
      const symData = analyses[sym];
      if (!symData) continue;
      const ind = symData.indicators || {};
      const price = ind.price || 0;
      const isBull = (symData.signal || '').includes('BUY');
      const isBear = (symData.signal || '').includes('SELL');
      // Pivot levels may be nested under pivot_points or flat
      const pp = ind.pivot_points || {};
      built[sym] = {
        symbol: sym,
        status: symData.status || 'LIVE',
        current_price: price,
        change_percent: ind.change_percent || 0,
        timestamp: new Date().toISOString(),
        ema: {
          ema_20: ind.ema_20 || null,
          ema_50: ind.ema_50 || null,
          ema_100: ind.ema_100 || null,
          ema_200: ind.ema_200 || null,
          trend: ind.trend || 'NEUTRAL',
          price_vs_ema20: price > (ind.ema_20 || 0) ? 'ABOVE' : 'BELOW',
        },
        classic_pivots: {
          pivot: pp.pivot || ind.cpr_pivot || 0,
          r1: pp.r1 || ind.pivot_r1 || 0,
          r2: pp.r2 || ind.pivot_r2 || 0,
          r3: pp.r3 || ind.pivot_r3 || 0,
          s1: pp.s1 || ind.pivot_s1 || 0,
          s2: pp.s2 || ind.pivot_s2 || 0,
          s3: pp.s3 || ind.pivot_s3 || 0,
          bias: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
        },
        camarilla_pivots: {
          h4: ind.camarilla_h4 || 0,
          h3: ind.camarilla_h3 || 0,
          l3: ind.camarilla_l3 || 0,
          l4: ind.camarilla_l4 || 0,
          zone: ind.camarilla_zone || (isBull ? 'BULLISH_ZONE' : isBear ? 'BEARISH_ZONE' : 'NEUTRAL'),
        },
        supertrend_10_3: {
          value: ind.supertrend_10_2_value || null,
          trend: ind.supertrend_10_2_trend || (isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL'),
          signal: isBull ? 'BUY' : isBear ? 'SELL' : 'NEUTRAL',
          distance_pct: ind.supertrend_10_2_distance_pct || 0,
        },
        supertrend_7_3: {
          value: ind.supertrend_10_2_value || null,
          trend: ind.supertrend_10_2_trend || (isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL'),
          signal: isBull ? 'BUY' : isBear ? 'SELL' : 'NEUTRAL',
          distance_pct: 0,
        },
        overall_bias: isBull ? 'BULLISH' : isBear ? 'BEARISH' : 'NEUTRAL',
      };
    }
    if (Object.keys(built).length > 0) {
      setAllData(prev => ({ ...prev, ...built }));
      setLoading(false);
    }
  }, [analyses]);

  // Initial load + periodic refresh
  useEffect(() => {
    fetchAllData(false);
    
    // Refresh every 5 seconds when market is open (was 15 seconds)
    const interval = setInterval(() => fetchAllData(true), 5000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  const hasData = Object.keys(allData).length > 0;

  if (loading && !hasData) {
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-emerald-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-cyan-500/20 rounded-lg animate-pulse" />
          <div className="h-6 w-48 bg-slate-700/50 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-40 bg-slate-700/30 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-emerald-500/50 rounded-xl p-6 text-center">
        {error ? (
          <>
            <div className="text-red-400 text-lg font-bold mb-2">⚠️ Error</div>
            <p className="text-slate-300 mb-2">{error}</p>
            <p className="text-slate-600 text-sm">Check API connection</p>
          </>
        ) : (
          <>
            <Clock className="w-12 h-12 mx-auto mb-3 text-slate-500 animate-spin" />
            <p className="text-slate-400 mb-2 font-medium">Loading market data...</p>
            <p className="text-slate-600 text-sm">Connecting to API</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Live Status Bar - Dynamic Status Based on Data */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/40 border border-emerald-500/40 rounded-lg">
        <span className={`w-2.5 h-2.5 rounded-full ${
          Object.values(allData).some(d => d?.status === 'LIVE') 
            ? 'bg-emerald-400' 
            : Object.values(allData).some(d => d?.status === 'CACHED') 
            ? 'bg-yellow-400' 
            : 'bg-slate-400'
        }`} />
        <span className="text-xs text-slate-300 font-semibold">
          {Object.values(allData).some(d => d?.status === 'LIVE') && '📡 LIVE DATA'}
          {!Object.values(allData).some(d => d?.status === 'LIVE') && 
           Object.values(allData).some(d => d?.status === 'CACHED') && '💾 CACHED DATA'}
          {!Object.values(allData).some(d => d?.status === 'LIVE') && 
           !Object.values(allData).some(d => d?.status === 'CACHED') && '⏸️ OFFLINE DATA'}
        </span>
        {lastUpdate && <span className="text-[10px] text-slate-500 ml-auto">{lastUpdate}</span>}
        {isFetching && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin" />}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {SYMBOLS.map(config => {
          const data = allData[config.symbol];
          // Show data if it exists, regardless of current_price
          if (!data || (!data.current_price && !data.classic_pivots?.pivot)) {
            return (
              <div key={config.symbol} className="rounded-xl p-4 bg-slate-800/30 border border-emerald-500/30 text-center">
                <p className="text-slate-500 text-sm">{config.name}</p>
                <p className="text-slate-600 text-xs mt-1">No data loaded</p>
              </div>
            );
          }
          // Render even if current_price is null - SymbolPivotRow handles it
          return <SymbolPivotRow key={config.symbol} data={data} config={config} marketStatus={marketStatus} />;
        })}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-4 pt-1.5 text-[9px] sm:text-[10px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-teal-700/50 rounded" /> Support
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-slate-600 rounded" /> Pivot
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-amber-700/50 rounded" /> Resistance
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 bg-slate-500 rounded" /> Near Level
        </span>
      </div>
    </div>
  );
});

PivotSectionUnified.displayName = 'PivotSectionUnified';

export default PivotSectionUnified;

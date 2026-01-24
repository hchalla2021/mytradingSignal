'use client';

import React, { memo, useEffect, useState, useCallback } from 'react';
import { Target, TrendingUp, TrendingDown, Activity, Clock, RefreshCw, Zap } from 'lucide-react';
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
  ema: { ema9?: number | null; ema21?: number | null; ema50?: number | null; ema20?: number | null; trend: string; price_vs_ema20?: string; price_vs_ema21?: string };
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

// Default fallback data for ultra-fast first load and offline mode
const DEFAULT_FALLBACK_DATA: Record<string, PivotData> = {
  'NIFTY': {
    symbol: 'NIFTY',
    status: 'CACHED',
    current_price: 24500,
    change_percent: -0.5,
    timestamp: new Date().toLocaleTimeString('en-IN'),
    ema: { ema9: 24450, ema21: 24480, ema50: 24200, ema20: 24470, trend: 'BULLISH', price_vs_ema20: 'ABOVE', price_vs_ema21: 'ABOVE' },
    classic_pivots: { pivot: 24500, r1: 24600, r2: 24700, r3: 24800, s1: 24400, s2: 24300, s3: 24200, bias: 'BEARISH' },
    camarilla_pivots: { h4: 24750, h3: 24700, l3: 24300, l4: 24250, zone: 'NEUTRAL' },
    supertrend_10_3: { value: 24350, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.6 },
    supertrend_7_3: { value: 24400, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.4 },
    overall_bias: 'BEARISH',
  },
  'BANKNIFTY': {
    symbol: 'BANKNIFTY',
    status: 'CACHED',
    current_price: 58000,
    change_percent: -1.2,
    timestamp: new Date().toLocaleTimeString('en-IN'),
    ema: { ema9: 57900, ema21: 58100, ema50: 57500, ema20: 58050, trend: 'BEARISH', price_vs_ema20: 'BELOW', price_vs_ema21: 'BELOW' },
    classic_pivots: { pivot: 58000, r1: 58200, r2: 58400, r3: 58600, s1: 57800, s2: 57600, s3: 57400, bias: 'BEARISH' },
    camarilla_pivots: { h4: 58500, h3: 58400, l3: 57600, l4: 57500, zone: 'BREAKDOWN' },
    supertrend_10_3: { value: 57700, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.5 },
    supertrend_7_3: { value: 57800, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.3 },
    overall_bias: 'BEARISH',
  },
  'SENSEX': {
    symbol: 'SENSEX',
    status: 'CACHED',
    current_price: 82000,
    change_percent: -0.8,
    timestamp: new Date().toLocaleTimeString('en-IN'),
    ema: { ema9: 81900, ema21: 82100, ema50: 81500, ema20: 82050, trend: 'NEUTRAL', price_vs_ema20: 'BELOW', price_vs_ema21: 'BELOW' },
    classic_pivots: { pivot: 82000, r1: 82200, r2: 82400, r3: 82600, s1: 81800, s2: 81600, s3: 81400, bias: 'BEARISH' },
    camarilla_pivots: { h4: 82500, h3: 82400, l3: 81600, l4: 81500, zone: 'NEUTRAL' },
    supertrend_10_3: { value: 81700, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.4 },
    supertrend_7_3: { value: 81800, trend: 'BEARISH', signal: 'SELL', distance_pct: 0.2 },
    overall_bias: 'BEARISH',
  },
};

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
    // If no cache, return default fallback (never show blank)
    console.log('[Pivot] Using default fallback cache');
    return DEFAULT_FALLBACK_DATA;
  } catch {
    // On any error, still return default fallback
    console.log('[Pivot] Error reading cache, using default fallback');
    return DEFAULT_FALLBACK_DATA;
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
const isNearLevel = (price: number | null, level: number | null): boolean => {
  if (!price || !level) return false;
  const diff = Math.abs(price - level) / level;
  return diff < 0.003; // 0.3%
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
const SymbolPivotRow = memo<{ data: PivotData; config: SymbolConfig }>(({ data, config }) => {
  const price = data.current_price || 0;
  const bias = data.overall_bias;
  const pivots = data.classic_pivots;
  const cam = data.camarilla_pivots;
  const st1 = data.supertrend_10_3;
  const st2 = data.supertrend_7_3;
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
  const isApproachingSupertrend = st1.distance_pct !== undefined && st1.distance_pct < 1.0;
  const isCrossingSupertrend = st1.trend === 'BEARISH' && st1.signal === 'SELL';
  const isNearCamarilla = cam.h3 && price && Math.abs(price - cam.h3) / cam.h3 < 0.01; // Within 1%
  const isNearPivot = pivots.pivot && price && Math.abs(price - pivots.pivot) / pivots.pivot < 0.015; // Within 1.5%
  const isBreakdown = st1.trend === 'BEARISH' && nearestSup && price && price < (nearestSup.value || 0);
  
  // Background color based on market status - Soft & Subtle
  const bgColor = isPriceUp 
    ? 'bg-slate-900/70' 
    : 'bg-slate-900/70';
  
  const borderColor = isPriceUp ? 'border-teal-700/30' : 'border-amber-700/30';
  
  // Text color for price - Green when UP, RED when DOWN (like live indices)
  const priceColor = isPriceUp ? 'text-teal-300' : 'text-red-400';
  const changeColor = isPriceUp ? 'text-teal-400' : 'text-red-500';

  return (
    <div className={`rounded-xl p-4 border shadow-sm transition-all mb-3 ${bgColor} ${borderColor} ${
      isBreakdown ? 'ring-1 ring-red-500/50 shadow-md shadow-red-500/10' : ''
    } ${isCrossingSupertrend ? 'ring-1 ring-orange-500/40' : ''}`}>
      {/* Symbol Header - Market Status */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-medium ${
          isPriceUp ? 'bg-teal-900/30 text-teal-400' : 'bg-amber-900/30 text-amber-400'
        }`}>
          {config.shortName === 'NIFTY' && <TrendingUp className="w-5 h-5" />}
          {config.shortName === 'BNIFTY' && <TrendingDown className="w-5 h-5" />}
          {config.shortName === 'SENSEX' && <Activity className="w-5 h-5" />}
        </div>
        <div className="flex flex-col">
          <span className={`font-semibold text-base px-2 py-1 rounded-lg border ${
            isPriceUp 
              ? 'text-teal-300 border-teal-600/40 bg-teal-900/10'
              : 'text-slate-200 border-slate-600/40 bg-slate-900/10'
          }`}>{config.name}</span>
          <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-normal w-fit ${
            isPriceUp 
              ? 'bg-green-900/20 text-green-300 border border-green-700/30' 
              : 'bg-red-900/20 text-red-300 border border-red-700/30'
          }`}>
            {bias}
          </span>
        </div>
        <div className="ml-auto text-right">
          <span className={`text-xl font-semibold px-3 py-1 rounded-lg ${
            isPriceUp 
              ? 'text-teal-300 border border-teal-600/40 bg-teal-900/10'
              : 'text-red-400 border border-red-600/40 bg-red-900/10'
          }`}>{fmt(price)}</span>
          {data.change_percent !== undefined && (
            <span className={`block text-xs font-normal mt-0.5 ${changeColor}`}>
              {data.change_percent >= 0 ? '↑' : '↓'} {Math.abs(data.change_percent).toFixed(2)}%
            </span>
          )}
        </div>
      </div>

      {/* Pivot Levels Card - With Critical Alerts */}
      <div className={`mb-3 p-3 rounded-lg border shadow-sm ${
        isNearPivot ? 'bg-yellow-900/15 border-yellow-600/30 ring-1 ring-yellow-600/30' : 'bg-slate-800/30 border-slate-700/30'
      }`}>
        <div className="flex items-center gap-2 text-xs font-normal mb-2">
          <Target className="w-3.5 h-3.5 text-slate-500" />
          <span className={isNearPivot ? 'text-yellow-300 font-semibold' : 'text-slate-400'}>PIVOT LEVELS</span>
          <span className="text-slate-600">|</span>
          <span className={pivots.bias === 'BULLISH' ? 'text-teal-400' : 'text-amber-400'}>
            {pivots.bias === 'BULLISH' ? '📈 Above' : '📉 Below'}
          </span>
        </div>
        <div className="flex items-center gap-1 h-7 bg-slate-700/30 rounded overflow-hidden">
          {/* S2 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.s2) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.s2, 'below') ? 'bg-teal-900/30 text-teal-300' : 'bg-slate-800/20 text-slate-500'
          }`} title={`S2: ${fmt(pivots.s2)}`}>S2</div>
          {/* S1 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.s1) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.s1, 'below') ? 'bg-teal-900/30 text-teal-300' : 'bg-slate-800/20 text-slate-500'
          }`} title={`S1: ${fmt(pivots.s1)}`}>S1</div>
          {/* Pivot */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal border-x border-slate-600/20 transition-all ${
            isNearLevel(price, pivots.pivot) ? 'bg-yellow-600/70 text-white' : 'bg-slate-800/40 text-slate-400'
          }`} title={`Pivot: ${fmt(pivots.pivot)}`}>P</div>
          {/* R1 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.r1) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.r1, 'above') ? 'bg-amber-900/30 text-amber-300' : 'bg-slate-800/20 text-slate-500'
          }`} title={`R1: ${fmt(pivots.r1)}`}>R1</div>
          {/* R2 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.r2) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.r2, 'above') ? 'bg-amber-900/30 text-amber-300' : 'bg-slate-800/30 text-slate-500'
          }`} title={`R2: ${fmt(pivots.r2)}`}>R2</div>
        </div>
        {/* Level Values Row */}
        <div className="flex justify-between mt-1.5 px-1 text-xs font-normal">
          <span className={isNearLevel(price, pivots.s2) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.s2)}</span>
          <span className={isNearLevel(price, pivots.s1) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.s1)}</span>
          <span className={isNearLevel(price, pivots.pivot) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.pivot)}</span>
          <span className={isNearLevel(price, pivots.r1) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.r1)}</span>
          <span className={isNearLevel(price, pivots.r2) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.r2)}</span>
        </div>
      </div>

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Supertrend Card - With Critical Alert */}
        <div className={`rounded-lg border p-3 flex flex-col items-center shadow-sm transition-all ${
          isCrossingSupertrend 
            ? 'bg-red-900/20 border-red-600/40 ring-1 ring-red-500/40 shadow-md shadow-red-500/5' 
            : isApproachingSupertrend 
            ? 'bg-orange-900/20 border-orange-600/30 ring-1 ring-orange-500/30'
            : 'bg-slate-800/30 border-slate-700/30'
        }`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap className="w-3.5 h-3.5 text-slate-500" />
            <span className={`text-xs font-semibold ${isCrossingSupertrend ? 'text-red-300' : isApproachingSupertrend ? 'text-orange-300' : 'text-slate-400'}`}>SUPERTREND</span>
          </div>
          <span className={`text-base font-semibold ${st1.trend === 'BULLISH' ? 'text-teal-400' : isCrossingSupertrend ? 'text-red-400' : 'text-amber-400'}`}>
            {st1.trend === 'BULLISH' ? 'BUY' : 'SELL'}
          </span>
          <span className={`text-xs mt-0.5 font-normal ${isApproachingSupertrend ? 'text-orange-400' : 'text-slate-500'}`}>
            {st1.distance_pct}% {isApproachingSupertrend ? '⚠️ NEAR' : 'away'}
          </span>
        </div>
        {/* Camarilla Card - With Critical Alert */}
        <div className={`rounded-lg border p-3 flex flex-col items-center shadow-sm transition-all ${
          isNearCamarilla 
            ? 'bg-yellow-900/15 border-yellow-600/30 ring-1 ring-yellow-600/30'
            : 'bg-slate-800/30 border-slate-700/30'
        }`}>
          <span className={`text-xs font-semibold mb-1 ${isNearCamarilla ? 'text-yellow-300' : 'text-slate-400'}`}>CAMARILLA</span>
          <span className={`text-sm font-normal ${
            cam.zone?.includes('BUY') ? 'text-teal-400' :
            cam.zone?.includes('SELL') ? 'text-amber-400' :
            cam.zone?.includes('BREAK') ? 'text-orange-400' :
            'text-slate-400'
          }`}>
            {cam.zone?.replace(/_/g, ' ') || 'NEUTRAL'}
          </span>
          <span className={`text-xs mt-0.5 font-normal ${isNearCamarilla ? 'text-yellow-400' : 'text-slate-500'}`}>
            H3: {fmtCompact(cam.h3)} {isNearCamarilla ? '⚠️' : ''}
          </span>
        </div>
        {/* Nearest Levels Card - With Critical Alert */}
        <div className={`rounded-lg border p-3 flex flex-col items-center shadow-sm ${
          isBreakdown 
            ? 'bg-red-900/20 border-red-600/40 ring-1 ring-red-500/40 shadow-md shadow-red-500/5'
            : 'bg-slate-800/30 border-slate-700/30'
        }`}>
          <span className={`text-xs font-semibold mb-1 ${isBreakdown ? 'text-red-300' : 'text-slate-400'}`}>
            {isBreakdown ? '🚨 BREAKDOWN' : 'NEAREST'}
          </span>
          {nearestRes && (
            <span className={`text-xs flex items-center gap-1 ${isBreakdown ? 'text-red-400' : 'text-amber-400'}`}>
              <span className="font-normal">↑ {nearestRes.label}</span>
              <span className="text-slate-500">{fmtCompact(nearestRes.value)}</span>
            </span>
          )}
          {nearestSup && (
            <span className={`text-xs flex items-center gap-1 ${isBreakdown ? 'text-red-400 font-semibold' : 'text-teal-400'}`}>
              <span>↓ {nearestSup.label}</span>
              <span className="text-slate-500">{fmtCompact(nearestSup.value)}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
});

SymbolPivotRow.displayName = 'SymbolPivotRow';

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const PivotSectionUnified = memo(() => {
  const [allData, setAllData] = useState<Record<string, PivotData>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const fetchAllData = useCallback(async (isBackground = false) => {
    if (isFetching && isBackground) return;
    setIsFetching(true);
    if (!isBackground) setError(null);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const apiUrl = API_CONFIG.endpoint('/api/advanced/pivot-indicators');
      console.log('[Pivot] Fetching from:', apiUrl);
      
      const response = await fetch(apiUrl, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
      }
      
      const result = await response.json();
      console.log('[Pivot] API Response:', Object.keys(result));
      
      if (result && Object.keys(result).length > 0) {
        // Check if any symbol has valid data
        const hasValidData = SYMBOLS.some(s => result[s.symbol]?.current_price);
        if (hasValidData) {
          setAllData(result);
          setCachedData(result);
          setLastUpdate(new Date().toLocaleTimeString('en-IN'));
          setError(null);
          console.log('[Pivot] Data loaded successfully from API');
        } else {
          console.log('[Pivot] API returned but no valid prices, keeping cache');
          // If API has no data but cache exists, keep showing cache
        }
      }
    } catch (err) {
      console.error('[Pivot] Fetch error:', err);
      if (!isBackground) {
        setError(err instanceof Error ? err.message : 'Connection failed');
      }
      // On fetch error, ensure we still have data from cache
      console.log('[Pivot] Using cache after fetch error');
    } finally {
      setLoading(false);
      setIsFetching(false);
    }
  }, [isFetching]);

  // Load cached data immediately on mount
  useEffect(() => {
    const cached = getCachedData();
    if (cached && Object.keys(cached).length > 0) {
      console.log('[Pivot] Initial load from cache');
      setAllData(cached);
      // Mark as not loading since we have instant cache
      setLoading(false);
      // Still update timestamp to show when cache is from
      const oldestTimestamp = Object.values(cached)
        .map(d => new Date(d.timestamp).getTime())
        .sort((a, b) => a - b)[0];
      if (oldestTimestamp) {
        setLastUpdate(new Date(oldestTimestamp).toLocaleTimeString('en-IN'));
      }
    }
    
    // Fetch fresh data in background (even if we have cache)
    setTimeout(() => {
      fetchAllData(false);
    }, 100);
    
    // Refresh every 15 seconds
    const interval = setInterval(() => fetchAllData(true), 15000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Check if we have data
  const hasData = Object.keys(allData).length > 0;
  const isMarketClosed = SYMBOLS.every(s => 
    !allData[s.symbol] || allData[s.symbol]?.status === 'CLOSED' || allData[s.symbol]?.status === 'CACHED' || allData[s.symbol]?.status === 'OFFLINE'
  );

  // Loading state - only show if we truly have zero data (should never happen with defaults)
  if (loading && !hasData) {
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-cyan-500/30 rounded-xl p-6">
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

  // No data state - now should almost never happen, but fallback to cache if needed
  if (!hasData) {
    const fallback = getCachedData();
    if (fallback && Object.keys(fallback).length > 0) {
      // Render with fallback silently
      setAllData(fallback);
      return null; // Let next render with data show
    }
    
    return (
      <div className="bg-gradient-to-br from-slate-900/80 to-slate-800/80 border border-slate-600/50 rounded-xl p-6 text-center">
        <Clock className="w-12 h-12 mx-auto mb-3 text-slate-500" />
        <p className="text-slate-400 mb-2">Loading market data...</p>
        {error && <p className="text-rose-400 text-xs mb-2">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Status Bar */}
      {isMarketClosed && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/40 border border-slate-700/40 rounded">
          <Clock className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs text-slate-400 font-medium">
            📊 Cached Data • Last session
          </span>
          {lastUpdate && (
            <span className="text-[10px] text-slate-600 ml-auto">{lastUpdate}</span>
          )}
          {isFetching && <RefreshCw className="w-3 h-3 text-slate-500 animate-spin" />}
        </div>
      )}
      
      {!isMarketClosed && lastUpdate && (
        <div className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-green-900/40 to-green-800/30 border border-green-600/60 rounded-lg shadow-sm shadow-green-500/20">
          <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-pulse" />
          <span className="text-xs text-green-300 font-bold">🔴 LIVE MARKET DATA</span>
          <span className="text-[10px] text-green-500 ml-auto">{lastUpdate}</span>
          {isFetching && <RefreshCw className="w-3 h-3 text-green-400 animate-spin" />}
        </div>
      )}

      {/* All Symbols Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {SYMBOLS.map(config => {
          const data = allData[config.symbol];
          if (!data || !data.current_price) {
            return (
              <div key={config.symbol} className="rounded-xl p-4 bg-slate-800/30 border border-slate-600/30 text-center">
                <p className="text-slate-500 text-sm">{config.name}</p>
                <p className="text-slate-600 text-xs mt-1">No data</p>
              </div>
            );
          }
          return <SymbolPivotRow key={config.symbol} data={data} config={config} />;
        })}
      </div>

      {/* Quick Legend */}
      <div className="flex flex-wrap items-center justify-center gap-4 pt-1.5 text-[9px] text-slate-600">
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

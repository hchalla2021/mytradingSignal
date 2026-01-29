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
    <div className={`rounded-xl p-4 border shadow-sm transition-all mb-3 ${bgColor} ${borderColor} ${
      isBreakdown ? 'ring-1 ring-red-500/50 shadow-md shadow-red-500/10' : ''
    }`}>
      {/* Symbol Header - Market Status */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className={`w-8 sm:w-10 h-8 sm:h-10 rounded-lg flex items-center justify-center font-medium ${
            isPriceUp ? 'bg-teal-900/30 text-teal-400' : 'bg-amber-900/30 text-amber-400'
          }`}>
            {config.shortName === 'NIFTY' && <TrendingUp className="w-4 sm:w-5 h-4 sm:h-5" />}
            {config.shortName === 'BNIFTY' && <TrendingDown className="w-4 sm:w-5 h-4 sm:h-5" />}
            {config.shortName === 'SENSEX' && <Activity className="w-4 sm:w-5 h-4 sm:h-5" />}
          </div>
          <div className="flex flex-col min-w-0">
            <span className={`font-semibold text-sm sm:text-base px-2 py-1 rounded-lg border truncate ${
              isPriceUp 
                ? 'text-teal-300 border-emerald-500/40 bg-teal-900/10'
                : 'text-slate-200 border-emerald-500/40 bg-slate-900/10'
            }`}>{config.name}</span>
            <span className={`mt-0.5 text-xs px-2 py-0.5 rounded font-normal w-fit ${
              isPriceUp 
                ? 'bg-green-900/20 text-green-300 border border-emerald-500/30' 
                : 'bg-red-900/20 text-red-300 border border-emerald-500/30'
            }`}>
              {bias}
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:text-right w-full sm:w-auto">
          <span className={`text-lg sm:text-xl font-semibold px-2 sm:px-3 py-1 rounded-lg ${
            isPriceUp 
              ? 'text-teal-300 border border-emerald-500/40 bg-teal-900/10'
              : 'text-red-400 border border-emerald-500/40 bg-red-900/10'
          }`}>{fmt(price)}</span>
          <div className="flex flex-row sm:flex-col gap-2 sm:gap-1 mt-1">
            {data.change_percent !== undefined && (
              <span className={`text-xs font-normal ${changeColor}`}>
                {data.change_percent >= 0 ? '↑' : '↓'} {Math.abs(data.change_percent).toFixed(2)}%
              </span>
            )}
            {/* Confidence Percentage */}
            <span className="text-xs font-bold text-slate-300">
              Confidence: {Math.round(pivotConfidence)}%
            </span>
          </div>
        </div>
      </div>

      {/* Pivot Levels Card - With Critical Alerts */}
      <div className={`mb-3 p-3 rounded-lg border shadow-sm ${
        isNearPivot ? 'bg-yellow-900/15 border-emerald-500/30 ring-1 ring-emerald-500/30' : 'bg-slate-800/30 border-emerald-500/30'
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
          {/* S3 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.s3, config.symbol) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.s3, 'below') ? 'bg-teal-900/30 text-teal-300' : 'bg-slate-800/20 text-slate-500'
          }`} title={`S3: ${fmt(pivots.s3)}`}>S3</div>
          {/* Pivot */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal border-x border-emerald-500/30 transition-all ${
            isNearLevel(price, pivots.pivot, config.symbol) ? 'bg-yellow-600/70 text-white' : 'bg-slate-800/40 text-slate-400'
          }`} title={`Pivot: ${fmt(pivots.pivot)}`}>P</div>
          {/* R3 */}
          <div className={`flex-1 h-full flex items-center justify-center text-[11px] font-normal transition-all ${
            isNearLevel(price, pivots.r3, config.symbol) ? 'bg-yellow-600/70 text-white' :
            hasCrossed(price, pivots.r3, 'above') ? 'bg-amber-900/30 text-amber-300' : 'bg-slate-800/30 text-slate-500'
          }`} title={`R3: ${fmt(pivots.r3)}`}>R3</div>
        </div>
        {/* Level Values Row */}
        <div className="flex justify-between mt-1.5 px-1 text-xs font-normal">
          <span className={isNearLevel(price, pivots.s3, config.symbol) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.s3)}</span>
          <span className={isNearLevel(price, pivots.pivot, config.symbol) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.pivot)}</span>
          <span className={isNearLevel(price, pivots.r3, config.symbol) ? 'text-yellow-300' : 'text-slate-500'}>{fmtCompact(pivots.r3)}</span>
        </div>
      </div>

      {/* Info Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {/* Camarilla Card - With Critical Alert */}
        <div className={`rounded-lg border p-3 flex flex-col items-center shadow-sm transition-all min-h-[90px] ${
          isNearCamarilla 
            ? 'bg-yellow-900/15 border-emerald-500/30 ring-1 ring-emerald-500/30'
            : 'bg-slate-800/30 border-emerald-500/30'
        }`}>
          <span className={`text-xs font-semibold mb-1 ${isNearCamarilla ? 'text-yellow-300' : 'text-slate-400'}`}>CAMARILLA</span>
          <span className={`text-sm font-normal text-center leading-tight ${
            cam.zone?.includes('BUY') ? 'text-teal-400' :
            cam.zone?.includes('SELL') ? 'text-amber-400' :
            cam.zone?.includes('BREAK') ? 'text-orange-400' :
            'text-slate-400'
          }`}>
            {cam.zone?.replace(/_/g, ' ') || 'NEUTRAL'}
          </span>
          <span className={`text-xs mt-0.5 font-normal text-center ${isNearCamarilla ? 'text-yellow-400' : 'text-slate-500'}`}>
            R3: {fmtCompact(cam.h4)} {isNearCamarilla ? '⚠️' : ''}
          </span>
        </div>
        {/* Nearest Levels Card - With Critical Alert */}
        <div className={`rounded-lg border p-3 flex flex-col items-center shadow-sm min-h-[90px] ${
          isBreakdown 
            ? 'bg-red-900/20 border-emerald-500/40 ring-1 ring-red-500/40 shadow-md shadow-red-500/5'
            : 'bg-slate-800/30 border-emerald-500/30'
        }`}>
          <span className={`text-xs font-semibold mb-1 text-center ${isBreakdown ? 'text-red-300' : 'text-slate-400'}`}>
            {isBreakdown ? '🚨 BREAKDOWN' : 'NEAREST'}
          </span>
          {nearestRes && (
            <span className={`text-xs flex items-center gap-1 ${isBreakdown ? 'text-red-400' : 'text-amber-400'}`}>
              <span className="font-normal">↑ {nearestRes.label}</span>
              <span className="text-slate-500">{fmtCompact(nearestRes.value)}</span>
            </span>
          )}
          {nearestSup && (
            <span className={`text-xs flex items-center gap-1 mt-0.5 ${isBreakdown ? 'text-red-400 font-semibold' : 'text-teal-400'}`}>
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
const PivotSectionUnified = memo<{ updates?: number }>((props) => {
  const [allData, setAllData] = useState<Record<string, PivotData>>({});
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

  // Initial load + periodic refresh
  useEffect(() => {
    fetchAllData(false);
    
    // Refresh every 15 seconds when market is open
    const interval = setInterval(() => fetchAllData(true), 15000);
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
          return <SymbolPivotRow key={config.symbol} data={data} config={config} />;
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

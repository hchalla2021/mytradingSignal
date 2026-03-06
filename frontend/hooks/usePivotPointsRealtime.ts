/**
 * usePivotPointsRealtime – Ultra-Fast Live Market Data Integration
 * ══════════════════════════════════════════════════════════════════════════════
 * Architecture: WebSocket ticks → Batched updates (200ms window) + API every 3s
 * Performance: Real-time price updates + Pivot analysis refresh every 3s
 * 
 * Key Optimizations:
 * 1. Live ticks update price instantly (0ms latency)
 * 2. API analysis refreshes every 3s (not 5s)
 * 3. Batched state updates avoid excessive re-renders (200ms window)
 * 4. Memoized pivot calculations for expensive operations
 * 5. Smart debouncing: 200ms batch window for live price
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface MarketTick {
  symbol: string;
  time: number;
  ltp: number;
  price: number;
  changePercent: number;
  change: number;
  high?: number;
  low?: number;
  volume?: number;
}

interface EnhancedPivotResponse {
  symbol: string;
  status: 'LIVE' | 'CACHED' | 'OFFLINE';
  current_price: number;
  classic_pivots: {
    s3: number;
    s2: number;
    s1: number;
    pivot: number;
    r1: number;
    r2: number;
    r3: number;
  };
  camarilla_pivots: {
    l4: number;
    l3: number;
    h3: number;
    h4: number;
  };
  market_status: 'STRONG_BULLISH' | 'BULLISH' | 'NEUTRAL' | 'BEARISH' | 'STRONG_BEARISH';
  pivot_confidence: number;
  pivot_confidence_reasons: string[];
  nearest_resistance?: {
    name: string;
    value: number;
    distance: number;
    distance_pct: number;
  };
  nearest_support?: {
    name: string;
    value: number;
    distance: number;
    distance_pct: number;
  };
  prediction_direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  prediction_confidence: number;
  prediction_reasons: string[];
  timestamp: string;
}

interface PivotRealtimeData extends EnhancedPivotResponse {
  isLive: boolean;
  liveTick?: MarketTick;
  lastUpdateTime: number;
}

/**
 * Hook: Real-time Pivot Points Analysis for Single Symbol
 * 
 * Update Flow:
 * 1. [0ms] WebSocket tick arrives → Updates price (instant)
 * 2. [200ms] Batched state update → Component re-renders with live price
 * 3. [3000ms] API fetch → Updates pivot confidence, market status, prediction
 * 4. Fallback: If WS down → Use 3s API polling as backup
 */
export function usePivotPointsRealtime(symbol: string) {
  const [data, setData] = useState<PivotRealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Live tick buffer (batch updates to avoid excessive re-renders) ────────
  const liveTickRef = useRef<MarketTick | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);
  const lastUpdateTimeRef = useRef<number>(0);
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const apiTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── 🔥 Fast API fetch (3s instead of 5s) ───────────────────────────────────
  const fetchAnalysis = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/pivot-indicators/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result: EnhancedPivotResponse = await res.json();

      if (result?.status === 'OFFLINE') {
        setError('Market offline');
        setLoading(false);
        return;
      }

      // Merge live tick data with API analysis
      setData({
        ...result,
        isLive: result.status === 'LIVE',
        liveTick: liveTickRef.current || undefined,
        lastUpdateTime: Date.now(),
      });

      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError('Connection error');
      setLoading(false);
    }
  }, [symbol]);

  // ── 🔥 Process batched live tick updates (200ms window) ───────────────────
  const processBatchedUpdate = useCallback(() => {
    if (!liveTickRef.current || !data) return;

    const tick = liveTickRef.current;
    const now = Date.now();

    // Only update state if 200ms has passed since last update
    if (now - lastUpdateTimeRef.current < 200) {
      pendingUpdateRef.current = true;
      return;
    }

    lastUpdateTimeRef.current = now;
    pendingUpdateRef.current = false;

    // Update data with live tick (instant price update)
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        current_price: tick.price || prev.current_price,
        liveTick: tick,
        lastUpdateTime: now,
      };
    });

    // Schedule next batch window
    batchTimerRef.current = setTimeout(() => {
      if (pendingUpdateRef.current) {
        processBatchedUpdate();
      }
    }, 200);
  }, [data]);

  // ── 🔥 WebSocket listener (ultra-fast, no debouncing) ──────────────────────
  const handleWebSocketTick = useCallback(
    (tick: any) => {
      if (tick?.symbol !== symbol) return;

      // 🔥 Store tick immediately for next batch window
      liveTickRef.current = {
        symbol: tick.symbol,
        time: tick.time || Date.now(),
        ltp: tick.ltp || tick.price,
        price: tick.ltp || tick.price,
        changePercent: tick.changePercent ?? 0,
        change: tick.change ?? 0,
        high: tick.high,
        low: tick.low,
        volume: tick.volume,
      };

      // Trigger batch update
      processBatchedUpdate();
    },
    [symbol, processBatchedUpdate]
  );

  // ── Listen for WebSocket events (subscribe/unsubscribe) ───────────────────
  useEffect(() => {
    const eventName = `market-tick-${symbol}`;

    window.addEventListener(eventName, (e: any) => {
      handleWebSocketTick(e.detail);
    });

    return () => {
      window.removeEventListener(eventName, (e: any) => {
        handleWebSocketTick(e.detail);
      });
    };
  }, [symbol, handleWebSocketTick]);

  // ── Initial load + 3s API refresh cycle ──────────────────────────────────
  useEffect(() => {
    fetchAnalysis();

    // Refresh every 3s (not 5s) for faster pivot level updates
    apiTimerRef.current = setInterval(() => {
      fetchAnalysis();
    }, 3000);

    return () => {
      if (apiTimerRef.current) clearInterval(apiTimerRef.current);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      abortRef.current?.abort();
    };
  }, [symbol, fetchAnalysis]);

  return {
    data,
    loading,
    error,
    refetch: fetchAnalysis,
  };
}

/**
 * Multi-Symbol Hook: Real-time Pivot Points for All Indices
 */
interface SymbolConfig {
  symbol: string;
  name: string;
}

export function usePivotPointsRealtimeMulti(symbols: SymbolConfig[]) {
  const [pivotData, setPivotData] = useState<Record<string, PivotRealtimeData>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Fetch all symbols in parallel
  const fetchAllData = useCallback(async () => {
    try {
      const results: Record<string, PivotRealtimeData> = {};
      const promises = symbols.map(async (config) => {
        const ctrl = new AbortController();
        try {
          const res = await fetch(
            API_CONFIG.endpoint(`/api/advanced/pivot-indicators/${config.symbol}`),
            { signal: ctrl.signal, cache: 'no-store' }
          );

          if (res.ok) {
            const data: EnhancedPivotResponse = await res.json();
            if (data.status !== 'OFFLINE') {
              results[config.symbol] = {
                ...data,
                isLive: data.status === 'LIVE',
                lastUpdateTime: Date.now(),
              };
            }
          }
        } catch (e) {
          console.error(`Failed to fetch ${config.symbol}:`, e);
        }
      });

      await Promise.all(promises);

      if (Object.keys(results).length > 0) {
        setPivotData(results);
        setLastUpdate(new Date());
      }

      setLoading(false);
    } catch (err) {
      setError('Failed to load pivot data');
      setLoading(false);
    }
  }, [symbols]);

  // Initial load + 3s refresh
  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 3000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  return {
    pivotData,
    loading,
    error,
    lastUpdate,
    refetch: fetchAllData,
  };
}

/**
 * Memoized pivot level calculations
 */
export function useMemoizedPivotLevels(pivots: EnhancedPivotResponse['classic_pivots'] | undefined) {
  return useMemo(() => {
    if (!pivots) return null;

    return {
      resistance: [pivots.r1, pivots.r2, pivots.r3],
      support: [pivots.s1, pivots.s2, pivots.s3],
      pivot: pivots.pivot,
      allLevels: [pivots.r3, pivots.r2, pivots.r1, pivots.pivot, pivots.s1, pivots.s2, pivots.s3],
    };
  }, [pivots]);
}

/**
 * useSupertrendRealtime – Ultra-Fast SuperTrend (10,2) Trend Following
 * ════════════════════════════════════════════════════════════════════════════
 * Architecture: WebSocket ticks → Batched updates (200ms window)
 * Performance: Real-time price updates + SuperTrend refresh every 3s
 * 
 * Key Optimizations:
 * 1. Live ticks update price/distance instantly (0ms latency)
 * 2. SuperTrend analysis refreshes every 3s (not 5s) with intelligent caching
 * 3. Batched state updates avoid excessive re-renders
 * 4. Memoized ST calculations for expensive operations
 * 5. Smart debouncing: 200ms batch window for live data
 * 
 * Strategy: SuperTrend (10,2)
 * - Period: 10 bars (lookback for ATR calculation)
 * - Multiplier: 2x ATR (volatility adjustment)
 * - BULLISH trend: Price above ST line
 * - BEARISH trend: Price below ST line
 * - Excellent for intraday 5m/15m trading
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

interface SupertrendResponse {
  symbol: string;
  timestamp: string;
  current_price: number;
  st_10_2_value: number;
  st_10_2_trend: string; // BULLISH | BEARISH | NEUTRAL
  st_10_2_signal: string; // BUY | SELL | HOLD
  st_distance: number;
  st_distance_pct: number;
  st_10_2_confidence: number; // 40-95
  atr_10: number;
  atr_pct: number;
  status: string;
  data_status: string;
  token_valid: boolean;
  candles_analyzed: number;
}

interface SupertrendRealtimeData extends SupertrendResponse {
  isLive: boolean;
  liveTick?: MarketTick;
  lastUpdateTime: number;
}

/**
 * Hook: Real-time SuperTrend (10,2) Analysis
 * 
 * Update Flow:
 * 1. [0ms] WebSocket tick arrives → Updates price/distance (instant)
 * 2. [200ms] Batched state update → Component re-renders with live price
 * 3. [3000ms] API fetch → Updates ST line, trend, confidence
 * 4. Fallback: If WS down → Use 3s API polling as backup
 */
export function useSupertrendRealtime(symbol: string) {
  const [data, setData] = useState<SupertrendRealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // ── Live tick buffer (batch updates to avoid excessive re-renders) ────────
  const liveTickRef = useRef<MarketTick | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);
  const lastUpdateTimeRef = useRef<number>(0);
  const prevTrendRef = useRef<string>('');
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
        API_CONFIG.endpoint(`/api/advanced/supertrend/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result: SupertrendResponse = await res.json();

      if (result?.status === 'TOKEN_EXPIRED') {
        setError('Auth required');
        setLoading(false);
        return;
      }
      if (result?.status === 'ERROR') {
        setError('Feed error');
        setLoading(false);
        return;
      }

      // 🔥 Flash on trend change (visual confirmation of flip)
      if (prevTrendRef.current && prevTrendRef.current !== result.st_10_2_trend) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevTrendRef.current = result.st_10_2_trend;

      // Merge live tick data with API analysis
      setData({
        ...result,
        isLive: result.status === 'LIVE' || result.status === 'ACTIVE',
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

    // Recalculate distance based on live price
    let updatedDistance = data.st_distance;
    let updatedDistancePct = data.st_distance_pct;

    if (data.st_10_2_value > 0) {
      updatedDistance = Math.abs(tick.price - data.st_10_2_value);
      updatedDistancePct = (updatedDistance / data.st_10_2_value) * 100;
    }

    // Update data with live tick (instant price update)
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        current_price: tick.price || prev.current_price,
        st_distance: updatedDistance,
        st_distance_pct: updatedDistancePct,
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
    
    const handleEvent = (e: any) => {
      handleWebSocketTick(e.detail);
    };

    window.addEventListener(eventName, handleEvent);

    return () => {
      window.removeEventListener(eventName, handleEvent);
    };
  }, [symbol, handleWebSocketTick]);

  // ── Initial load + 3s API refresh cycle ──────────────────────────────────
  useEffect(() => {
    fetchAnalysis();

    // Refresh every 3s (not 5s) for faster ST line updates
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
    flash,
    refetch: fetchAnalysis,
  };
}

/**
 * Additional hook: Memoized SuperTrend calculations
 * Prevents expensive recalculations on every render
 */
export function useMemoizedSupertrendAnalysis(stData: SupertrendResponse | null) {
  return useMemo(() => {
    if (!stData) {
      return {
        isBullish: false,
        isBearish: false,
        distanceFromST: 0,
        trendStrength: 'WEAK',
        isNearCrossover: false,
      };
    }

    return {
      isBullish: stData.st_10_2_trend === 'BULLISH',
      isBearish: stData.st_10_2_trend === 'BEARISH',
      distanceFromST: stData.st_distance,
      trendStrength: 
        stData.st_distance_pct > 2.0 ? 'STRONG' :
        stData.st_distance_pct > 1.0 ? 'MODERATE' :
        stData.st_distance_pct > 0.5 ? 'WEAK' : 'FORMING',
      isNearCrossover: stData.st_distance_pct < 0.3,
    };
  }, [stData]);
}

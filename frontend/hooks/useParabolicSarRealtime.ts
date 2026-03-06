/**
 * useParabolicSarRealtime – Ultra-Fast Parabolic SAR Trend Following
 * ════════════════════════════════════════════════════════════════════════════
 * Architecture: WebSocket ticks → Batched updates (200ms window)
 * Performance: Real-time price updates + SAR refresh every 3s
 * 
 * Key Optimizations:
 * 1. Live ticks update price/distance instantly (0ms latency)
 * 2. SAR analysis refreshes every 3s (not 5s) with intelligent caching
 * 3. Batched state updates avoid excessive re-renders
 * 4. Memoized SAR calculations for expensive operations
 * 5. Smart debouncing: 200ms batch window for live data
 * 
 * Strategy: Parabolic SAR (Stop and Reverse)
 * - SAR below price = Uptrend, SAR is dynamic stop loss
 * - SAR above price = Downtrend, SAR is dynamic stop loss
 * - When SAR touches price = Trend reversal/flip
 * - Perfect for intraday trend following with automated stops
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

interface ParabolicSarResponse {
  symbol: string;
  timestamp: string;
  current_price: number;
  sar_value: number;
  sar_position: string; // BELOW | ABOVE | NEUTRAL
  sar_trend: string; // BULLISH | BEARISH | NEUTRAL
  sar_signal: string; // BUY | SELL | HOLD
  distance_to_sar: number;
  distance_pct: number;
  sar_confidence: number; // 40-95
  status: string;
  data_status: string;
  token_valid: boolean;
  candles_analyzed: number;
}

interface ParabolicSarRealtimeData extends ParabolicSarResponse {
  isLive: boolean;
  liveTick?: MarketTick;
  lastUpdateTime: number;
}

/**
 * Hook: Real-time Parabolic SAR Analysis
 * 
 * Update Flow:
 * 1. [0ms] WebSocket tick arrives → Updates price/distance (instant)
 * 2. [200ms] Batched state update → Component re-renders with live price
 * 3. [3000ms] API fetch → Updates SAR level, trend, confidence
 * 4. Fallback: If WS down → Use 3s API polling as backup
 */
export function useParabolicSarRealtime(symbol: string) {
  const [data, setData] = useState<ParabolicSarRealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // ── Live tick buffer (batch updates to avoid excessive re-renders) ────────
  const liveTickRef = useRef<MarketTick | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);
  const lastUpdateTimeRef = useRef<number>(0);
  const prevSignalRef = useRef<string>('');
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
        API_CONFIG.endpoint(`/api/advanced/parabolic-sar/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result: ParabolicSarResponse = await res.json();

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

      // 🔥 Flash on signal change (visual confirmation of flip)
      if (prevSignalRef.current && prevSignalRef.current !== result.sar_signal) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevSignalRef.current = result.sar_signal;

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
    let updatedDistance = data.distance_to_sar;
    let updatedDistancePct = data.distance_pct;

    if (data.sar_value > 0) {
      updatedDistance = Math.abs(tick.price - data.sar_value);
      updatedDistancePct = (updatedDistance / tick.price) * 100;
    }

    // Update data with live tick (instant price update)
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        current_price: tick.price || prev.current_price,
        distance_to_sar: updatedDistance,
        distance_pct: updatedDistancePct,
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

    // Refresh every 3s (not 5s) for faster SAR updates
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
 * Additional hook: Memoized Parabolic SAR calculations
 * Prevents expensive recalculations on every render
 */
export function useMemoizedSarAnalysis(sarData: ParabolicSarResponse | null) {
  return useMemo(() => {
    if (!sarData) {
      return {
        isBelowSar: false,
        isAboveSar: false,
        sarStopLoss: 0,
        distanceToStop: 0,
        isNearFlip: false,
        riskLevel: 'NONE',
      };
    }

    return {
      isBelowSar: sarData.sar_position === 'BELOW',
      isAboveSar: sarData.sar_position === 'ABOVE',
      sarStopLoss: sarData.sar_value,
      distanceToStop: sarData.distance_to_sar,
      isNearFlip: sarData.distance_pct < 0.5,
      riskLevel: 
        sarData.distance_pct > 2.0 ? 'LOW' :
        sarData.distance_pct > 1.0 ? 'MEDIUM' :
        sarData.distance_pct > 0.5 ? 'HIGH' : 'CRITICAL',
    };
  }, [sarData]);
}

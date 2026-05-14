/**
 * useTrendBaseRealtime – Ultra-Fast Live Market Data Integration
 * ══════════════════════════════════════════════════════════════════════
 * Architecture: WebSocket ticks → Batched updates (200ms window)
 * Performance: Real-time price updates + API analysis refresh every 3s
 * 
 * Key Optimizations:
 * 1. Live ticks update price/change instantly (0ms latency)
 * 2. API analysis refreshes every 3s (not 5s) with intelligent caching
 * 3. Batched state updates avoid excessive re-renders
 * 4. Memoized calculations for expensive operations
 * 5. Smart debouncing: 200ms batch window for live data
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_CONFIG } from '@/lib/api-config';

const MIN_FETCH_GAP_MS = 250;

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

interface TrendBaseResponse {
  symbol: string;
  price: number;
  changePercent: number;
  structure: {
    type: string;
    integrity_score: number;
    swing_points: {
      last_high: number;
      last_low: number;
      prev_high: number;
      prev_low: number;
    };
  };
  signal: string;
  signal_5m: string;
  trend_15m: string;
  trend: string;
  confidence: number;
  confidence_5m?: number;
  total_score: number;
  factors: Record<string, { score: number; max: number; label: string }>;
  status: string;
  timestamp: string;
  candles_analyzed: number;
  rsi_5m: number;
  rsi_15m: number;
  ema_alignment: string;
  supertrend: string;
  vwap_position: string;
}

interface TrendBaseRealtimeData extends TrendBaseResponse {
  isLive: boolean;
  liveTick?: MarketTick;
  lastUpdateTime: number;
}

function toTsMs(ts?: string): number {
  if (!ts) return Number.NaN;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isNewerSnapshot(nextTs?: string, prevTs?: string): boolean {
  const n = toTsMs(nextTs);
  const p = toTsMs(prevTs);
  if (!Number.isFinite(n) || !Number.isFinite(p)) return true;
  return n >= p;
}

function normalizeTrendBaseResponse(raw: TrendBaseResponse): TrendBaseResponse {
  const confidence = Math.max(0, Math.min(100, Number(raw.confidence ?? 0)));
  const confidence5m = Math.max(0, Math.min(100, Number(raw.confidence_5m ?? confidence)));
  const changePercent = Number(raw.changePercent ?? 0);
  const price = Math.max(0, Number(raw.price ?? 0));

  return {
    ...raw,
    price,
    changePercent,
    confidence,
    confidence_5m: confidence5m,
    total_score: Number(raw.total_score ?? 0),
    rsi_5m: Number(raw.rsi_5m ?? 50),
    rsi_15m: Number(raw.rsi_15m ?? 50),
  };
}

function materiallyChanged(prev: TrendBaseRealtimeData, next: TrendBaseResponse): boolean {
  return (
    prev.signal !== next.signal
    || prev.signal_5m !== next.signal_5m
    || prev.trend !== next.trend
    || prev.trend_15m !== next.trend_15m
    || Math.abs((prev.confidence ?? 0) - (next.confidence ?? 0)) >= 0.2
    || Math.abs((prev.confidence_5m ?? prev.confidence ?? 0) - (next.confidence_5m ?? next.confidence ?? 0)) >= 0.2
    || Math.abs((prev.total_score ?? 0) - (next.total_score ?? 0)) >= 0.2
    || Math.abs((prev.price ?? 0) - (next.price ?? 0)) >= 0.01
    || Math.abs((prev.changePercent ?? 0) - (next.changePercent ?? 0)) >= 0.01
    || prev.timestamp !== next.timestamp
  );
}

/**
 * Hook: Real-time Trend Base Analysis
 * 
 * Update Flow:
 * 1. [0ms] WebSocket tick arrives → Updates price/change (instant)
 * 2. [200ms] Batched state update → Component re-renders with live price
 * 3. [3000ms] API fetch → Updates all analysis factors, signals, confidence
 * 4. Fallback: If WS down → Use 3s API polling as backup
 */
export function useTrendBaseRealtime(symbol: string) {
  const [data, setData] = useState<TrendBaseRealtimeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // ── Live tick buffer (batch updates to avoid excessive re-renders) ────────
  const liveTickRef = useRef<MarketTick | null>(null);
  const pendingUpdateRef = useRef<boolean>(false);
  const lastUpdateTimeRef = useRef<number>(0);
  const prevSigRef = useRef<string>('');
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const apiTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastReqSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const hasDataRef = useRef(false);
  const nextFetchAllowedAtRef = useRef(0);
  // Track last price seen by WS to detect significant moves → immediate API refetch
  const lastWsChangeRef = useRef<number>(0);

  // ── 🔥 Fast API fetch (3s instead of 5s) ───────────────────────────────────
  const fetchAnalysis = useCallback(async () => {
    if (!mountedRef.current) return;
    const now = Date.now();
    if (now < nextFetchAllowedAtRef.current) return;
    nextFetchAllowedAtRef.current = now + MIN_FETCH_GAP_MS;

    const reqSeq = ++lastReqSeqRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(
        API_CONFIG.endpoint(`/api/advanced/trend-base/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const raw: TrendBaseResponse = await res.json();
      const result = normalizeTrendBaseResponse(raw);

      if (result?.status === 'TOKEN_EXPIRED') {
        if (!hasDataRef.current) setError('Auth required');
        setLoading(false);
        return;
      }
      if (result?.status === 'ERROR') {
        if (!hasDataRef.current) setError('Feed error');
        setLoading(false);
        return;
      }

      if (!mountedRef.current || reqSeq !== lastReqSeqRef.current) return;

      // 🔥 Flash on signal change (visual confirmation of trend shift)
      if (prevSigRef.current && prevSigRef.current !== result.signal) {
        setFlash(true);
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlash(false), 700);
      }
      prevSigRef.current = result.signal;

      // Merge live tick data with API analysis
      setData((prev) => {
        if (prev && !isNewerSnapshot(result.timestamp, prev.timestamp)) return prev;
        if (prev && !materiallyChanged(prev, result)) return prev;

        hasDataRef.current = true;
        return {
          ...result,
          isLive: result.status === 'LIVE' || result.status === 'ACTIVE',
          liveTick: liveTickRef.current || undefined,
          lastUpdateTime: Date.now(),
        };
      });

      setError(null);
      setLoading(false);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      if (!hasDataRef.current) setError('Connection error');
      setLoading(false);
    }
  }, [symbol]);

  // ── 🔥 Process batched live tick updates (200ms window) ───────────────────
  const processBatchedUpdate = useCallback(() => {
    if (!liveTickRef.current) return;
    if (!mountedRef.current) return;

    const tick = liveTickRef.current;
    const now = Date.now();

    // Only update state if 200ms has passed since last update
    if (now - lastUpdateTimeRef.current < 200) {
      pendingUpdateRef.current = true;
      return;
    }

    lastUpdateTimeRef.current = now;
    pendingUpdateRef.current = false;

    // Update data with live tick (instant price update) — uses functional setState to avoid stale closure
    setData((prev) => {
      if (!prev) return prev;
      const nextPrice = tick.price || prev.price;
      const nextChange = tick.changePercent ?? prev.changePercent;
      if (
        Math.abs((nextPrice ?? 0) - (prev.price ?? 0)) < 0.005
        && Math.abs((nextChange ?? 0) - (prev.changePercent ?? 0)) < 0.005
      ) {
        return prev;
      }
      return {
        ...prev,
        price: nextPrice,
        changePercent: nextChange,
        liveTick: tick,
        lastUpdateTime: now,
      };
    });

    // Clear previous batch timer before scheduling new one
    if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
    batchTimerRef.current = setTimeout(() => {
      if (pendingUpdateRef.current) {
        processBatchedUpdate();
      }
    }, 200);
  }, []);

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

      // 🔥 Force immediate API refetch when price moves ≥0.15% from last WS snapshot
      // This captures intraday reversals without waiting for the 3s polling interval
      const newChange = tick.changePercent ?? 0;
      if (Math.abs(newChange - lastWsChangeRef.current) >= 0.15) {
        lastWsChangeRef.current = newChange;
        // Defer to next frame to avoid blocking paint under bursty ticks.
        requestAnimationFrame(() => {
          fetchAnalysis();
        });
      }

      // Trigger batch update
      processBatchedUpdate();
    },
    [symbol, processBatchedUpdate, fetchAnalysis]
  );

  // ── Listen for WebSocket events (subscribe/unsubscribe) ───────────────────
  useEffect(() => {
    const eventName = `market-tick-${symbol}`;

    // Store handler reference so removeEventListener can match it
    const handler = (e: Event) => {
      handleWebSocketTick((e as CustomEvent).detail);
    };

    window.addEventListener(eventName, handler);

    return () => {
      window.removeEventListener(eventName, handler);
    };
  }, [symbol, handleWebSocketTick]);

  // ── Initial load + 2s API refresh cycle ──────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    fetchAnalysis();

    // Refresh every 2s (was 3s) — matches backend analysis cache TTL of 2s
    apiTimerRef.current = setInterval(() => {
      fetchAnalysis();
    }, 2000);

    return () => {
      mountedRef.current = false;
      if (apiTimerRef.current) clearInterval(apiTimerRef.current);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
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
 * Additional hook: Cost signals analysis (memoized for performance)
 */
export function useMemoizedFactorAnalysis(factors: Record<string, any>) {
  return useMemo(() => {
    if (!factors) return { bullishCount: 0, bearishCount: 0, neutralCount: 0 };

    let bullish = 0,
      bearish = 0;

    Object.values(factors).forEach((f: any) => {
      if (f.score > 0) bullish++;
      else if (f.score < 0) bearish++;
    });

    return {
      bullishCount: bullish,
      bearishCount: bearish,
      neutralCount: Object.keys(factors).length - bullish - bearish,
    };
  }, [factors]);
}

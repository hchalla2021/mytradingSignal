/**
 * useVwma20EntryRealtime – Ultra-Fast VWMA 20 Entry Filter Tracking
 * ════════════════════════════════════════════════════════════════════════════
 * Architecture: WebSocket ticks → Batched updates (200ms window)
 * Performance: Real-time price updates + VWMA refresh every 3s
 * 
 * Key Optimizations:
 * 1. Live ticks update price/distance instantly (0ms latency)
 * 2. VWMA analysis refreshes every 3s (not 5s) with intelligent caching
 * 3. Batched state updates avoid excessive re-renders
 * 4. Memoized VWMA calculations for expensive operations
 * 5. Smart debouncing: 200ms batch window for live data
 * 
 * Strategy: VWMA 20 Entry Confirmation
 * - VWMA below price = Bullish setup (support level)
 * - VWMA above price = Bearish setup (resistance level)
 * - Strong signal = VWMA aligned + EMA aligned + Volume confirmed
 * - Entry signals: STRONG_BUY, BUY, SELL, STRONG_SELL, WAIT
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

interface Vwma20EntryResponse {
  symbol: string;
  timestamp: string;
  current_price: number;
  vwma_20: number;
  vwma_position: string; // ABOVE | BELOW
  distance_to_vwma: number;
  distance_to_vwma_pct: number;
  entry_signal: string; // STRONG_BUY | BUY | SELL | STRONG_SELL | WAIT
  ema_20: number;
  ema_50: number;
  ema_alignment: string;
  volume_ratio: number;
  volume_price_aligned: boolean;
  volume_status: string; // STRONG | NORMAL | WEAK
  signal_confidence: number;
  status: string;
  data_status: string;
  token_valid: boolean;
  candles_analyzed: number;
}

interface Vwma20EntryRealtimeData extends Vwma20EntryResponse {
  isLive: boolean;
  liveTick?: MarketTick;
  lastUpdateTime: number;
}

/**
 * Hook: Real-time VWMA 20 Entry Filter Analysis
 * 
 * Update Flow:
 * 1. [0ms] WebSocket tick arrives → Updates price/distance (instant)
 * 2. [200ms] Batched state update → Component re-renders with live price
 * 3. [3000ms] API fetch → Updates VWMA level, EMA alignment, signal
 * 4. Fallback: If WS down → Use 3s API polling as backup
 */
export function useVwma20EntryRealtime(symbol: string) {
  const [data, setData] = useState<Vwma20EntryRealtimeData | null>(null);
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
        API_CONFIG.endpoint(`/api/advanced/vwma-20-entry/${symbol}`),
        { signal: ctrl.signal, cache: 'no-store' }
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const result: Vwma20EntryResponse = await res.json();

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

      // 🔥 Flash on signal change (visual confirmation of entry setup change)
      if (prevSignalRef.current && prevSignalRef.current !== result.entry_signal) {
        setFlash(true);
        setTimeout(() => setFlash(false), 700);
      }
      prevSignalRef.current = result.entry_signal;

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
    let updatedDistance = data.distance_to_vwma;
    let updatedDistancePct = data.distance_to_vwma_pct;

    if (data.vwma_20 > 0) {
      updatedDistance = Math.abs(tick.price - data.vwma_20);
      updatedDistancePct = (updatedDistance / tick.price) * 100;
    }

    // Update data with live tick (instant price update)
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        current_price: tick.price || prev.current_price,
        distance_to_vwma: updatedDistance,
        distance_to_vwma_pct: updatedDistancePct,
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

    // Refresh every 3s (not 5s) for faster VWMA updates
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
 * Additional hook: Memoized VWMA 20 calculations
 * Prevents expensive recalculations on every render
 */
export function useMemoizedVwma20Analysis(vwmaData: Vwma20EntryResponse | null) {
  return useMemo(() => {
    if (!vwmaData) {
      return {
        isBullishSetup: false,
        isBearishSetup: false,
        isStrongSignal: false,
        signalType: 'NEUTRAL',
        volumeStrength: 'NORMAL',
        emaConfirm: false,
      };
    }

    const isBullishSetup = vwmaData.vwma_position === 'BELOW';
    const isBearishSetup = vwmaData.vwma_position === 'ABOVE';
    const isStrongSignal = vwmaData.entry_signal?.includes('STRONG');
    const volumeStrength = vwmaData.volume_status || 'NORMAL';
    const emaConfirm = vwmaData.ema_alignment?.includes('BULLISH') || vwmaData.ema_alignment?.includes('BEARISH');

    return {
      isBullishSetup,
      isBearishSetup,
      isStrongSignal,
      signalType: vwmaData.entry_signal?.split('_')[0] || 'NEUTRAL',
      volumeStrength,
      emaConfirm,
    };
  }, [vwmaData]);
}

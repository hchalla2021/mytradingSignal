/**
 * useCRTBTSTRealtime — Real-Time CRT + BTST Hook
 * ══════════════════════════════════════════════════
 * Architecture: MarketTick prop → CRT Engine → Debounced UI updates
 *
 * Data flow:
 *   useMarketSocket (WS ticks) → page.tsx marketData → CRTBTSTCard data prop
 *   → this hook's initialData → analyzeCRT() → state update
 *
 * Features:
 * 1. Debounced analysis (500ms) to avoid excessive re-renders on rapid ticks
 * 2. Full CRT analysis computed client-side (~0.1ms per run)
 * 3. localStorage persistence — data survives after market close
 * 4. Signal flash on BTST signal change
 * 5. No backend dependency — uses existing WebSocket tick data only
 *
 * CRITICAL: During live market, `close` from Zerodha = yesterday's close.
 * We use `price` (LTP) as the candle's live close for all factor scoring.
 */

'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { analyzeCRT, type CRTAnalysis, type CRTInput } from '@/lib/crt-engine';

const CACHE_KEY_PREFIX = 'crt_btst_';
const ANALYSIS_DEBOUNCE = 500; // ms between full CRT recalculations

interface CRTBTSTRealtimeState {
  analysis: CRTAnalysis | null;
  isLive: boolean;
  lastTickTime: number;
  fromCache: boolean;
}

// ── localStorage helpers ───────────────────────────────────────────────

function loadCached(symbol: string): CRTAnalysis | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${symbol}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CRTAnalysis;
    // Cache valid for 18 hours (covers overnight + pre-market)
    if (Date.now() - parsed.timestamp < 18 * 60 * 60 * 1000) return parsed;
    return null;
  } catch {
    return null;
  }
}

function saveToCache(symbol: string, analysis: CRTAnalysis): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(`${CACHE_KEY_PREFIX}${symbol}`, JSON.stringify(analysis));
  } catch { /* quota exceeded — ignore */ }
}

// ── Main Hook ──────────────────────────────────────────────────────────

export function useCRTBTSTRealtime(symbol: string, initialData?: any) {
  const [state, setState] = useState<CRTBTSTRealtimeState>(() => {
    const cached = loadCached(symbol);
    return {
      analysis: cached,
      isLive: false,
      lastTickTime: cached?.timestamp || 0,
      fromCache: !!cached,
    };
  });
  const [flash, setFlash] = useState(false);
  const [loading, setLoading] = useState(!state.analysis);

  // Refs for debouncing & deduplication
  const lastPriceRef = useRef<number>(state.analysis?.price || 0);
  const lastHighRef = useRef<number>(0);
  const lastLowRef = useRef<number>(0);
  const analysisTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevSignalRef = useRef<string>(state.analysis?.btst.signal || '');

  // ── Run CRT analysis ───────────────────────────────────────────────
  const runAnalysis = useCallback((tick: any) => {
    if (!tick || !tick.price) return;

    const ltp = tick.price || tick.ltp || 0;
    const isLiveMarket = tick.status === 'LIVE' || tick.status === 'PRE_OPEN';

    // CRITICAL: During live market, Zerodha's `close` = yesterday's close.
    // Use LTP as the candle's current close for all factor scoring.
    const candleClose = isLiveMarket ? ltp : (tick.close || ltp);

    const input: CRTInput = {
      symbol: tick.symbol || symbol,
      price: ltp,
      open: tick.open || ltp,
      high: tick.high || ltp,
      low: tick.low || ltp,
      close: candleClose,
      volume: tick.volume || 0,
      change: tick.change || 0,
      changePercent: tick.changePercent || 0,
      prevDayHigh: tick.prev_day_high || tick.prevDayHigh || tick.high || 0,
      prevDayLow: tick.prev_day_low || tick.prevDayLow || tick.low || 0,
      // For prevDayClose: use the actual close field (which IS yesterday's close from Zerodha)
      prevDayClose: tick.prev_day_close || tick.prevDayClose || tick.close || ltp,
      timestamp: tick.timestamp || new Date().toISOString(),
      status: tick.status || 'CLOSED',
    };

    const analysis = analyzeCRT(input);

    // Flash on signal change
    if (prevSignalRef.current && prevSignalRef.current !== analysis.btst.signal) {
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    }
    prevSignalRef.current = analysis.btst.signal;
    lastPriceRef.current = ltp;
    lastHighRef.current = tick.high || ltp;
    lastLowRef.current = tick.low || ltp;

    // Persist to cache
    saveToCache(symbol, analysis);

    setState({
      analysis,
      isLive: isLiveMarket,
      lastTickTime: Date.now(),
      fromCache: false,
    });
    setLoading(false);
  }, [symbol]);

  // ── Process initialData with debouncing ────────────────────────────
  useEffect(() => {
    if (!initialData || !initialData.price) return;

    const ltp = initialData.price;
    const high = initialData.high || ltp;
    const low = initialData.low || ltp;

    // Skip if price, high, low haven't meaningfully changed
    const priceChanged = Math.abs(ltp - lastPriceRef.current) > 0.01;
    const highChanged = Math.abs(high - lastHighRef.current) > 0.5;
    const lowChanged = Math.abs(low - lastLowRef.current) > 0.5;

    if (!priceChanged && !highChanged && !lowChanged && lastPriceRef.current > 0) return;

    // Debounce: schedule analysis, cancel if new tick arrives within window
    if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current);
    analysisTimerRef.current = setTimeout(() => {
      runAnalysis({
        symbol,
        price: ltp,
        ltp: ltp,
        open: initialData.open,
        high: high,
        low: low,
        close: initialData.close || ltp,
        volume: initialData.volume,
        change: initialData.change,
        changePercent: initialData.changePercent,
        prev_day_high: initialData.prev_day_high,
        prev_day_low: initialData.prev_day_low,
        prev_day_close: initialData.prev_day_close,
        prevDayHigh: initialData.prev_day_high,
        prevDayLow: initialData.prev_day_low,
        prevDayClose: initialData.prev_day_close,
        timestamp: initialData.timestamp,
        status: initialData.status,
      });
    }, lastPriceRef.current === 0 ? 0 : ANALYSIS_DEBOUNCE); // Run immediately on first load
  }, [initialData?.price, initialData?.high, initialData?.low, initialData?.status, symbol, runAnalysis]);

  // ── Cleanup on unmount ──────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (analysisTimerRef.current) clearTimeout(analysisTimerRef.current);
    };
  }, []);

  // ── Memoized factor summary ─────────────────────────────────────────
  const factorSummary = useMemo(() => {
    if (!state.analysis) return { bullish: 0, bearish: 0, neutral: 0, total: 8 };
    const f = state.analysis.factors;
    const scores = [
      f.rangeExpansion.score, f.sweepDetection.score, f.closePosition.score,
      f.displacement.score, f.bodyWickRatio.score, f.amdPattern.score,
      f.rangeReclaim.score, f.trendAlignment.score,
    ];
    return {
      bullish: scores.filter(s => s > 0).length,
      bearish: scores.filter(s => s < 0).length,
      neutral: scores.filter(s => s === 0).length,
      total: 8,
    };
  }, [state.analysis]);

  return {
    analysis: state.analysis,
    isLive: state.isLive,
    fromCache: state.fromCache,
    lastTickTime: state.lastTickTime,
    loading,
    flash,
    factorSummary,
  };
}

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
const LOCK_KEY_PREFIX  = 'crt_locked_';
const ANALYSIS_DEBOUNCE = 500; // ms between full CRT recalculations

/** Current IST date as 'YYYY-MM-DD' — used for daily-scoped cache keys. */
function getISTDate(): string {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
}

interface CRTBTSTRealtimeState {
  analysis: CRTAnalysis | null;
  isLive: boolean;
  lastTickTime: number;
  fromCache: boolean;
  lockedAt: number | null;   // When signal was locked at 3:20 PM (null = not from lock)
}

// ── localStorage helpers — date-scoped ('crt_btst_NIFTY_2026-05-12') ──────────

function loadCached(symbol: string): CRTAnalysis | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = `${CACHE_KEY_PREFIX}${symbol}_${getISTDate()}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CRTAnalysis;
  } catch {
    return null;
  }
}

function saveToCache(symbol: string, analysis: CRTAnalysis): void {
  if (typeof window === 'undefined') return;
  try {
    const todayKey = `${CACHE_KEY_PREFIX}${symbol}_${getISTDate()}`;
    localStorage.setItem(todayKey, JSON.stringify(analysis));
    // Purge stale keys from previous days
    const prefix = `${CACHE_KEY_PREFIX}${symbol}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== todayKey) localStorage.removeItem(k);
    }
  } catch { /* quota exceeded — ignore */ }
}

// ── Locked signal helpers — snapshot saved at 15:20–15:30 IST ───────────────

interface LockedSignal { analysis: CRTAnalysis; lockedAt: number; }

function loadLocked(symbol: string): LockedSignal | null {
  if (typeof window === 'undefined') return null;
  try {
    const key = `${LOCK_KEY_PREFIX}${symbol}_${getISTDate()}`;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as LockedSignal) : null;
  } catch {
    return null;
  }
}

function saveLocked(symbol: string, analysis: CRTAnalysis): number {
  if (typeof window === 'undefined') return Date.now();
  const lockedAt = Date.now();
  try {
    const key = `${LOCK_KEY_PREFIX}${symbol}_${getISTDate()}`;
    localStorage.setItem(key, JSON.stringify({ analysis, lockedAt }));
    // Purge stale lock keys
    const prefix = `${LOCK_KEY_PREFIX}${symbol}_`;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix) && k !== key) localStorage.removeItem(k);
    }
  } catch { /* quota exceeded */ }
  return lockedAt;
}

// ── Main Hook ──────────────────────────────────────────────────────────

export function useCRTBTSTRealtime(symbol: string, initialData?: any) {
  const [state, setState] = useState<CRTBTSTRealtimeState>(() => {
    // Priority: today's locked 3:20 PM signal > today's regular cache
    const locked = loadLocked(symbol);
    const cached = loadCached(symbol);
    const initial = locked?.analysis ?? cached;
    return {
      analysis: initial,
      isLive: false,
      lastTickTime: initial?.timestamp || 0,
      fromCache: !!initial,
      lockedAt: locked?.lockedAt ?? null,
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

    // Zerodha's `close` field = PREVIOUS DAY'S close in ALL market states (live, closed, pre-open).
    // LTP (price) is always today's candle close: live price during session, final price after close.
    const candleClose = ltp;

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

    // Persist to regular daily cache
    saveToCache(symbol, analysis);

    // Lock the signal during BTST critical window (15:20–15:30 IST)
    // Each tick during the window overwrites the lock — final tick (~15:29) is preserved
    let lockedAt: number | null = null;
    if (analysis.isBTSTCriticalWindow && isLiveMarket) {
      lockedAt = saveLocked(symbol, analysis);
    }

    setState(prev => ({
      ...prev,
      analysis,
      isLive: isLiveMarket,
      lastTickTime: Date.now(),
      fromCache: false,
      // Once locked, keep lockedAt until next day (page reload resets via date-scoped key)
      lockedAt: lockedAt ?? prev.lockedAt,
    }));
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

    // 0ms delay during BTST window (15:20–15:30 IST) for immediate lock accuracy;
    // 500ms during regular hours to reduce re-renders on rapid ticks
    const isNearClose = initialData.status === 'LIVE' &&
      typeof initialData.timestamp === 'string' &&
      (() => {
        try {
          const t = new Date(initialData.timestamp);
          const m = t.getUTCHours() * 60 + t.getUTCMinutes() + 330;
          const h = Math.floor(m / 60) % 24; const min = m % 60;
          return h === 15 && min >= 20;
        } catch { return false; }
      })();
    const delay = lastPriceRef.current === 0 || isNearClose ? 0 : ANALYSIS_DEBOUNCE;

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
    }, delay);
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
      f.prevCloseRelationship.score, f.trendAlignment.score,
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
    // Signal locking — true if analysis is from the 3:20 PM locked snapshot
    isLockedSignal: state.lockedAt !== null,
    lockedAt: state.lockedAt,
    isBTSTWindowActive: state.analysis?.isBTSTCriticalWindow === true,
  };
}

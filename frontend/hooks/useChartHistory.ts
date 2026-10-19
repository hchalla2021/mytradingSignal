'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, sessionDate, type ChartSymbol, type Timeframe } from '@/lib/chart-workspace';
import { createHistoryPageCache } from '@/lib/chart-history-cache';

interface HistoryPage {
  candles: Candle[];
  dailyCandles: Candle[];
  nextBefore: string | null;
  cached: boolean;
}
interface HistoryState {
  key: string;
  candles: Candle[];
  dailyCandles: Candle[];
  nextBefore: string | null;
  loading: boolean;
  error: string | null;
  jumpRevision: number;
}

const pageCache = createHistoryPageCache<HistoryPage>();
const contextCache = createHistoryPageCache<HistoryPage>(6);
const pageKey = (symbol: ChartSymbol, timeframe: Timeframe, before?: string) =>
  `${symbol}:${timeframe}:${before ?? `latest:${sessionDate(Date.now() / 1000)}`}`;

async function fetchPage(symbol: ChartSymbol, timeframe: Timeframe, before?: string) {
  return pageCache.load(pageKey(symbol, timeframe, before), async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('timeout'), 25_000);
    try {
      const params = new URLSearchParams({ symbol, interval: String(timeframe) });
      if (before) params.set('before', before);
      const response = await fetch(API_CONFIG.endpoint(`/api/chart-intelligence/history?${params}`), {
        signal: controller.signal, credentials: 'include',
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const detail = typeof payload === 'object' && payload !== null && 'detail' in payload && typeof payload.detail === 'string'
          ? payload.detail : `History request failed (${response.status}).`;
        throw new Error(detail);
      }
      return parsePage(payload);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('History request timed out. Retry to load this page.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  });
}

export async function prefetchChartHistory(symbol: ChartSymbol, timeframe: Timeframe) {
  if (pageCache.read(pageKey(symbol, timeframe))?.fresh) return;
  try {
    await fetchPage(symbol, timeframe);
  } catch (error) {
    console.error('Chart history preload:', error);
  }
}

function parsePage(value: unknown): HistoryPage {
  if (typeof value !== 'object' || value === null || !('candles' in value) ||
      !Array.isArray(value.candles) || !('nextBefore' in value) ||
      !(value.nextBefore === null || typeof value.nextBefore === 'string')) {
    throw new Error('Invalid chart history response.');
  }
  const parseCandle = (row: unknown): Candle => {
    if (typeof row !== 'object' || row === null || !('t' in row) || typeof row.t !== 'string' ||
        !('o' in row) || typeof row.o !== 'number' ||
        !('h' in row) || typeof row.h !== 'number' ||
        !('l' in row) || typeof row.l !== 'number' ||
        !('c' in row) || typeof row.c !== 'number' ||
        !('v' in row) || typeof row.v !== 'number') throw new Error('Invalid historical candle.');
    const candle = { t: row.t, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v };
    if (!Number.isFinite(candleTime(candle)) ||
        ![row.o, row.h, row.l, row.c, row.v].every(Number.isFinite) ||
        row.l <= 0 || row.h < Math.max(row.o, row.c) || row.l > Math.min(row.o, row.c) || row.v < 0) {
      throw new Error('Invalid historical OHLCV.');
    }
    return candle;
  };
  if ('dailyCandles' in value && !Array.isArray(value.dailyCandles)) throw new Error('Invalid daily pivot context.');
  const dailyCandles = 'dailyCandles' in value && Array.isArray(value.dailyCandles)
    ? value.dailyCandles.map(parseCandle) : [];
  return { candles: value.candles.map(parseCandle), dailyCandles, nextBefore: value.nextBefore, cached: 'cached' in value && value.cached === true };
}

export function useChartHistory(symbol: ChartSymbol, timeframe: Timeframe) {
  const key = `${symbol}:${timeframe}`;
  const [state, setState] = useState<HistoryState>({
    key, candles: [], dailyCandles: [], nextBefore: null, loading: true, error: null, jumpRevision: 0,
  });
  const activeKey = useRef(key);
  activeKey.current = key;
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const retryRequest = useRef<{ before?: string; replace: boolean }>({ replace: true });
  const historical = useRef(false);
  const cached = contextCache.read(pageKey(symbol, timeframe)) ?? pageCache.read(pageKey(symbol, timeframe));
  const latestFresh = pageCache.read(pageKey(symbol, timeframe))?.fresh === true;
  const displayed = state.key === key ? state : {
    key, candles: cached?.value.candles ?? [], dailyCandles: cached?.value.dailyCandles ?? [],
    nextBefore: cached?.value.nextBefore ?? null, loading: !latestFresh, error: null, jumpRevision: 0,
  };

  const load = useCallback(async (before?: string, replace = false, restoreCache = false) => {
    if (busy.current && !replace) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    retryRequest.current = { before, replace };
    const saved = restoreCache ? (before ? undefined : contextCache.read(pageKey(symbol, timeframe))) ??
      pageCache.read(pageKey(symbol, timeframe, before)) : undefined;
    const savedFresh = saved?.fresh === true && (before !== undefined || pageCache.read(pageKey(symbol, timeframe))?.fresh === true);
    setState(previous => ({
      ...previous, key, loading: !savedFresh, error: null,
      ...(replace ? {
        candles: saved?.value.candles ?? [], dailyCandles: saved?.value.dailyCandles ?? [],
        nextBefore: saved?.value.nextBefore ?? null,
      } : {}),
    }));
    if (savedFresh && replace) { busy.current = false; return; }
    try {
      const page = saved && savedFresh ? saved.value : await fetchPage(symbol, timeframe, before);
      if (controller.signal.aborted || request.current !== controller || activeKey.current !== key) return;
      setState(previous => {
        const merged = new Map<number, Candle>();
        const retainContext = replace && restoreCache && saved;
        for (const candle of retainContext ? saved.value.candles : replace ? [] : previous.candles) merged.set(candleTime(candle), candle);
        for (const candle of page.candles) merged.set(candleTime(candle), candle);
        const daily = new Map<number, Candle>();
        for (const candle of retainContext ? saved.value.dailyCandles : replace ? [] : previous.dailyCandles) daily.set(candleTime(candle), candle);
        // Older pages must not overwrite a more recently fetched overlapping day.
        for (const candle of page.dailyCandles) if (replace || !daily.has(candleTime(candle))) daily.set(candleTime(candle), candle);
        return {
          key, candles: Array.from(merged.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle),
          dailyCandles: Array.from(daily.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle),
          nextBefore: retainContext ? saved.value.nextBefore : page.nextBefore, loading: false, error: null,
          jumpRevision: previous.jumpRevision + (replace ? 1 : 0),
        };
      });
    } catch (error) {
      if (request.current !== controller || activeKey.current !== key) return;
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Unable to load chart history.';
      console.error('Chart history:', message);
      setState(previous => ({ ...previous, loading: false, error: message }));
    } finally {
      if (request.current === controller) busy.current = false;
    }
  }, [key, symbol, timeframe]);

  useEffect(() => {
    historical.current = false;
    void load(undefined, true, true);
    return () => { request.current?.abort(); busy.current = false; };
  }, [load]);

  useEffect(() => {
    if (state.key !== key || state.loading || state.error || historical.current) return;
    contextCache.write(pageKey(symbol, timeframe), {
      candles: state.candles, dailyCandles: state.dailyCandles, nextBefore: state.nextBefore, cached: true,
    });
  }, [key, symbol, timeframe, state]);

  const contextCutoff = sessionDate(Date.now() / 1000 - 35 * 86400);
  const warmingContext = typeof timeframe === 'number' && !historical.current &&
    displayed.nextBefore !== null && displayed.nextBefore > contextCutoff;
  useEffect(() => {
    if (!warmingContext || displayed.loading || displayed.error || !displayed.nextBefore) return;
    const timer = setTimeout(() => { void load(displayed.nextBefore!, false, true); }, 800);
    return () => clearTimeout(timer);
  }, [warmingContext, displayed.loading, displayed.error, displayed.nextBefore, load]);

  const loadOlder = useCallback(() => {
    if (displayed.nextBefore && !displayed.error) void load(displayed.nextBefore);
  }, [displayed.nextBefore, displayed.error, load]);
  const jumpToDate = useCallback((date: string) => {
    historical.current = true;
    // The API's before cursor is exclusive; include the selected session.
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    void load(nextDay.toISOString().slice(0, 10), true);
  }, [load]);
  const retry = useCallback(() => {
    void load(retryRequest.current.before, retryRequest.current.replace);
  }, [load]);
  const latest = useCallback(() => { historical.current = false; void load(undefined, true, true); }, [load]);
  return {
    candles: displayed.candles,
    dailyCandles: displayed.dailyCandles,
    loading: displayed.loading,
    error: displayed.error,
    hasMore: displayed.nextBefore !== null,
    jumpRevision: displayed.jumpRevision,
    warmingContext,
    loadOlder, jumpToDate, retry, latest,
  };
}

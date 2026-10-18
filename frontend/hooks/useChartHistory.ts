'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import type { Candle } from '@/hooks/useChartIntelligence';
import { candleTime, type ChartSymbol, type Timeframe } from '@/lib/chart-workspace';

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

  const load = useCallback(async (before?: string, replace = false) => {
    if (busy.current && !replace) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    retryRequest.current = { before, replace };
    setState(previous => ({
      ...previous, key, loading: true, error: null,
      ...(replace ? { candles: [], dailyCandles: [], nextBefore: null } : {}),
    }));
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
      const page = parsePage(payload);
      if (request.current !== controller || activeKey.current !== key) return;
      setState(previous => {
        const merged = new Map<number, Candle>();
        for (const candle of replace ? [] : previous.candles) merged.set(candleTime(candle), candle);
        for (const candle of page.candles) merged.set(candleTime(candle), candle);
        const daily = new Map<number, Candle>();
        for (const candle of replace ? [] : previous.dailyCandles) daily.set(candleTime(candle), candle);
        // Older pages must not overwrite a more recently fetched overlapping day.
        for (const candle of page.dailyCandles) if (replace || !daily.has(candleTime(candle))) daily.set(candleTime(candle), candle);
        return {
          key, candles: Array.from(merged.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle),
          dailyCandles: Array.from(daily.entries()).sort(([a], [b]) => a - b).map(([, candle]) => candle),
          nextBefore: page.nextBefore, loading: false, error: null,
          jumpRevision: previous.jumpRevision + (replace ? 1 : 0),
        };
      });
    } catch (error) {
      if (request.current !== controller || activeKey.current !== key) return;
      if (controller.signal.aborted && controller.signal.reason !== 'timeout') return;
      const message = controller.signal.aborted ? 'History request timed out. Retry to load this page.' :
        error instanceof Error ? error.message : 'Unable to load chart history.';
      console.error('Chart history:', message);
      setState(previous => ({ ...previous, loading: false, error: message }));
    } finally {
      clearTimeout(timer);
      if (request.current === controller) busy.current = false;
    }
  }, [key, symbol, timeframe]);

  useEffect(() => {
    void load(undefined, true);
    return () => { request.current?.abort(); busy.current = false; };
  }, [load]);

  const loadOlder = useCallback(() => {
    if (state.key === key && state.nextBefore && !state.error) void load(state.nextBefore);
  }, [key, state.key, state.nextBefore, state.error, load]);
  const jumpToDate = useCallback((date: string) => {
    // The API's before cursor is exclusive; include the selected session.
    const nextDay = new Date(`${date}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    void load(nextDay.toISOString().slice(0, 10), true);
  }, [load]);
  const retry = useCallback(() => {
    void load(retryRequest.current.before, retryRequest.current.replace);
  }, [load]);
  const latest = useCallback(() => { void load(undefined, true); }, [load]);
  return {
    candles: state.key === key ? state.candles : [],
    dailyCandles: state.key === key ? state.dailyCandles : [],
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    hasMore: state.key === key && state.nextBefore !== null,
    jumpRevision: state.key === key ? state.jumpRevision : 0,
    loadOlder, jumpToDate, retry, latest,
  };
}

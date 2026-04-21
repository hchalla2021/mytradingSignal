'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface FVG {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  startIdx: number;
  filled: boolean;
  strength: number;
}

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  high: number;
  low: number;
  startIdx: number;
  mitigated: boolean;
  strength: number;
}

export interface Liquidity {
  type: 'sell_side' | 'buy_side';
  level: number;
  startIdx: number;
  swept: boolean;
  sweepIdx: number | null;
  touchCount: number;
}

export interface ChartLevels {
  pdh: number;
  pdl: number;
  cdh: number;
  cdl: number;
  support: number[];
  resistance: number[];
}

export type ChartDataSource = 'LIVE' | 'CACHED' | 'MARKET_CLOSED';

export interface SymbolChartData {
  symbol: string;
  spot: number;
  candles3m: Candle[];
  candles5m: Candle[];
  fvg3m: FVG[];
  fvg5m: FVG[];
  ob3m: OrderBlock[];
  ob5m: OrderBlock[];
  liquidity3m: Liquidity[];
  liquidity5m: Liquidity[];
  levels: ChartLevels;
  dataSource: ChartDataSource;
  timestamp: string;
}

export interface ChartIntelligenceData {
  NIFTY: SymbolChartData | null;
  BANKNIFTY: SymbolChartData | null;
  SENSEX: SymbolChartData | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const config = getEnvironmentConfig();
  return config.wsUrl.replace(/\/ws\/market$/, '') + '/ws/chart-intelligence';
}

function getApiUrl(): string {
  const config = getEnvironmentConfig();
  return config.apiUrl.replace(/\/$/, '') + '/api/chart-intelligence';
}

function getLocalWsUrl(): string {
  const ws = process.env.NEXT_PUBLIC_LOCAL_WS_URL || 'ws://localhost:8000/ws/market';
  return ws.replace(/\/ws\/market$/, '') + '/ws/chart-intelligence';
}

function getLocalApiUrl(): string {
  const api = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8000';
  return api.replace(/\/$/, '') + '/api/chart-intelligence';
}

async function fetchWithFallback(): Promise<{ success?: boolean; data?: Record<string, SymbolChartData> } | null> {
  const primary = getApiUrl();
  const fallback = getLocalApiUrl();
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  const urlSet = new Set<string>();
  if (isLocal) {
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/chart-intelligence');
    urlSet.add(primary);
  } else {
    urlSet.add(primary);
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/chart-intelligence');
  }

  for (const url of Array.from(urlSet)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data && Object.keys(j.data).length > 0) return j;
      }
    } catch { /* next */ }
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'chartIntelligenceData_v1';

function saveToStorage(data: ChartIntelligenceData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): ChartIntelligenceData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChartIntelligenceData;
    // Discard data from a previous calendar day — candles are session-specific
    const today = new Date().toDateString();
    const hasStaleEntry = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).some(sym => {
      const ts = parsed[sym]?.timestamp;
      if (!ts) return true;
      return new Date(ts).toDateString() !== today;
    });
    if (hasStaleEntry) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
      return null;
    }
    return parsed;
  } catch { return null; }
}

const EMPTY: ChartIntelligenceData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChartIntelligence() {
  const [data, setData] = useState<ChartIntelligenceData>(() => loadFromStorage() ?? EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);
  const wsUrlsRef = useRef<string[]>([]);

  const mergeData = useCallback((raw: Record<string, SymbolChartData>) => {
    setData(prev => {
      const next: ChartIntelligenceData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const existing = prev[sym];
          if (existing && existing.timestamp === incoming.timestamp) continue;
          next[sym] = typeof structuredClone === 'function'
            ? structuredClone(incoming)
            : JSON.parse(JSON.stringify(incoming));
          changed = true;
        }
      }
      if (!changed) return prev;
      saveToStorage(next);
      return next;
    });
    setLastUpdate(new Date().toISOString());
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsUrlsRef.current.length === 0) {
      const primary = getWsUrl();
      const local = getLocalWsUrl();
      const port8000 = 'ws://localhost:8000/ws/chart-intelligence';
      const isLocal = window.location.hostname === 'localhost';
      const urlSet = new Set<string>();
      if (isLocal) { urlSet.add(local); urlSet.add(port8000); urlSet.add(primary); }
      else { urlSet.add(primary); urlSet.add(local); urlSet.add(port8000); }
      wsUrlsRef.current = Array.from(urlSet);
    }

    const tryConnect = (urlIndex: number) => {
      if (urlIndex >= wsUrlsRef.current.length) {
        retryDelay.current = Math.min(retryDelay.current * 1.5, 15000);
        retryRef.current = setTimeout(() => tryConnect(0), retryDelay.current);
        return;
      }

      let ws: WebSocket;
      try { ws = new WebSocket(wsUrlsRef.current[urlIndex]); }
      catch { tryConnect(urlIndex + 1); return; }

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) { ws.close(); tryConnect(urlIndex + 1); }
      }, 4000);

      wsRef.current = ws;

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setIsConnected(true);
        retryDelay.current = 1000;
        if (urlIndex > 0) {
          const working = wsUrlsRef.current[urlIndex];
          wsUrlsRef.current.splice(urlIndex, 1);
          wsUrlsRef.current.unshift(working);
        }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: Record<string, SymbolChartData>;
          };
          if ((msg.type === 'chart_intel_update' || msg.type === 'chart_intel_snapshot') && msg.data) {
            mergeData(msg.data);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        setIsConnected(false);
        if (pingRef.current) clearInterval(pingRef.current);
        if (!mountedRef.current) return;
        retryDelay.current = Math.min(retryDelay.current * 1.5, 15000);
        retryRef.current = setTimeout(() => tryConnect(0), retryDelay.current);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            fetchWithFallback()
              .then(json => { if (json?.data) mergeData(json.data); })
              .catch(() => {});
          }, 5000);
        }
      };

      ws.onerror = () => { clearTimeout(connectTimeout); ws.close(); };
    };

    tryConnect(0);
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;
    fetchWithFallback()
      .then(json => { if (json?.data && Object.keys(json.data).length > 0) mergeData(json.data); })
      .catch(() => {});
    connect();
    if (!pollRef.current) {
      pollRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        fetchWithFallback()
          .then(json => { if (json?.data && Object.keys(json.data).length > 0) mergeData(json.data); })
          .catch(() => {});
      }, 5000);
    }
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { chartData: data, isConnected, lastUpdate };
}

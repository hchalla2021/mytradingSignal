'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrikeSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type StrikeDataSource = 'LIVE' | 'CACHED' | 'MARKET_CLOSED';

export interface StrikeSideData {
  signal: StrikeSignal;
  score: number;
  breakdown: {
    buyPct: number;
    sellPct: number;
    neutralPct: number;
  };
  oi: number;
  volume: number;
  price: number;
  change: number;
}

export interface StrikeRow {
  strike: number;
  label: string;
  isATM: boolean;
  ce: StrikeSideData;
  pe: StrikeSideData;
}

export interface SymbolStrikeData {
  symbol: string;
  spot: number;
  atm: number;
  step: number;
  expiry: string;
  strikeCount: number;
  strikes: StrikeRow[];
  dataSource: StrikeDataSource;
  timestamp: string;
}

export interface StrikeIntelligenceData {
  NIFTY: SymbolStrikeData | null;
  BANKNIFTY: SymbolStrikeData | null;
  SENSEX: SymbolStrikeData | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getStrikeIntelWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/strike-intelligence`;
}

function getStrikeIntelApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/strike-intelligence`;
}

function getLocalWsUrl(): string {
  const localWs = process.env.NEXT_PUBLIC_LOCAL_WS_URL || 'ws://localhost:8000/ws/market';
  const base = localWs.replace(/\/ws\/market$/, '');
  return `${base}/ws/strike-intelligence`;
}

function getLocalApiUrl(): string {
  const localApi = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8000';
  return `${localApi.replace(/\/$/, '')}/api/strike-intelligence`;
}

async function fetchWithFallback(): Promise<{ success?: boolean; data?: Record<string, SymbolStrikeData> } | null> {
  const primary = getStrikeIntelApiUrl();
  const fallback = getLocalApiUrl();
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  // Build URL list: try local-first when on localhost, always include localhost:8000 as last resort
  const urlSet = new Set<string>();
  if (isLocal) {
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/strike-intelligence');
    urlSet.add(primary);
  } else {
    urlSet.add(primary);
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/strike-intelligence');
  }
  const urls = Array.from(urlSet);

  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data && Object.keys(j.data).length > 0) return j;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'strikeIntelligenceData_v1';

function saveToStorage(data: StrikeIntelligenceData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): StrikeIntelligenceData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StrikeIntelligenceData;
    // Discard data from a previous calendar day — strike chain values are stale
    const today = new Date().toDateString();
    const hasStaleEntry = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).some(sym => {
      const ts = parsed[sym]?.timestamp;
      if (!ts) return true; // no timestamp → treat as stale
      return new Date(ts).toDateString() !== today;
    });
    if (hasStaleEntry) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
      return null;
    }
    return parsed;
  } catch { return null; }
}

const EMPTY: StrikeIntelligenceData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStrikeIntelligence() {
  const [data, setData] = useState<StrikeIntelligenceData>(() => {
    // Eagerly load from localStorage on mount so last market data shows instantly
    const cached = loadFromStorage();
    return cached ?? EMPTY;
  });
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);
  const wsUrlsRef = useRef<string[]>([]);

  const mergeData = useCallback((raw: Record<string, SymbolStrikeData>) => {
    setData(prev => {
      const next: StrikeIntelligenceData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const existing = prev[sym];
          // Skip only if timestamp AND spot AND atm are all unchanged — avoids blocking
          // 1s spot-updated broadcasts that don't change OI/vol but DO update ATM/signals
          if (
            existing &&
            existing.timestamp === incoming.timestamp &&
            existing.spot === incoming.spot &&
            existing.atm === incoming.atm
          ) continue;
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
      const primary = getStrikeIntelWsUrl();
      const local = getLocalWsUrl();
      const port8000 = 'ws://localhost:8000/ws/strike-intelligence';
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      // Build unique URL list — always include localhost:8000
      const urlSet = new Set<string>();
      if (isLocal) {
        urlSet.add(local);
        urlSet.add(port8000);
        urlSet.add(primary);
      } else {
        urlSet.add(primary);
        urlSet.add(local);
        urlSet.add(port8000);
      }
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
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          tryConnect(urlIndex + 1);
        }
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
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: Record<string, SymbolStrikeData>;
          };
          if (msg.type === 'strike_intel_update' || msg.type === 'strike_intel_snapshot') {
            if (msg.data) mergeData(msg.data);
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
          }, 3000);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        ws.close();
      };
    };

    tryConnect(0);
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;

    // Fetch REST snapshot immediately (supplements localStorage)
    fetchWithFallback()
      .then(json => {
        if (json?.data && Object.keys(json.data).length > 0) mergeData(json.data);
      })
      .catch(() => {});

    connect();

    // Start REST polling fallback immediately in case WS takes time
    if (!pollRef.current) {
      pollRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return; // WS is live, skip
        fetchWithFallback()
          .then(json => {
            if (json?.data && Object.keys(json.data).length > 0) mergeData(json.data);
          })
          .catch(() => {});
      }, 1000);
    }

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { strikeData: data, isConnected, lastUpdate };
}

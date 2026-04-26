'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type EdgeDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type EdgeAction = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type EdgeDataSource = 'LIVE' | 'MARKET_CLOSED';

export type OIProfile =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'SHORT_BUILDUP'
  | 'LONG_UNWINDING'
  | 'NEUTRAL';

export interface EdgeSignalFactor {
  score: number;
  signal: 'BULL' | 'BEAR' | 'NEUTRAL';
  label: string;
  weight: number;
  extra?: Record<string, unknown>;
}

export interface EdgeFutures {
  price: number;
  oi: number;
  volume: number;
  basis: number;
  basisPct: number;
  contractName: string;
  prevClose: number;
  changePct: number;
}

export interface EdgeMetrics {
  price: number;
  changePct: number;
  totalOI: number;
  callOI: number;
  putOI: number;
  volume: number;
  ivEstimate: number;
  ivRank: number;
  ivPercentile: number;
  vix: number;
}

export interface EdgeIndex {
  symbol: string;
  direction: EdgeDirection;
  action: EdgeAction;
  confidence: number;
  rawScore: number;
  oiProfile: OIProfile;
  signals: {
    oi_spurts: EdgeSignalFactor;
    iv_estimation: EdgeSignalFactor;
    iv_rank: EdgeSignalFactor;
    futures_oi: EdgeSignalFactor;
    futures_basis: EdgeSignalFactor;
    live_price_momentum: EdgeSignalFactor;
  };
  futures: EdgeFutures;
  metrics: EdgeMetrics;
  dataSource: EdgeDataSource;
  timestamp: string;
}

export interface MarketEdgeData {
  NIFTY: EdgeIndex | null;
  BANKNIFTY: EdgeIndex | null;
  SENSEX: EdgeIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getEdgeWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/market-edge`;
}

function getEdgeApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/market-edge`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'marketEdgeData_v1';

function saveToStorage(data: MarketEdgeData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): MarketEdgeData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MarketEdgeData) : null;
  } catch { return null; }
}

const EMPTY: MarketEdgeData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMarketEdge() {
  const [edgeData, setEdgeData] = useState<MarketEdgeData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const mountedRef = useRef(true);

  const mergeData = useCallback((raw: Record<string, EdgeIndex>) => {
    setEdgeData(prev => {
      const next: MarketEdgeData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          if (prev[sym]?.timestamp === raw[sym].timestamp) continue;
          next[sym] = typeof structuredClone === 'function'
            ? structuredClone(raw[sym])
            : JSON.parse(JSON.stringify(raw[sym]));
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

    let ws: WebSocket;
    try { ws = new WebSocket(getEdgeWsUrl()); }
    catch { retryRef.current = setTimeout(connect, retryDelay.current); return; }

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      retryDelay.current = 3000;
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
          data?: Record<string, EdgeIndex>;
        };
        if (msg.type === 'edge_update' || msg.type === 'edge_snapshot') {
          if (msg.data) mergeData(msg.data);
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      if (!mountedRef.current) return;
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getEdgeApiUrl())
            .then(r => r.json())
            .then((json: { success?: boolean; data?: Record<string, EdgeIndex> }) => {
              if (json?.success && json.data) mergeData(json.data);
            })
            .catch(() => {});
        }, 5000);
      }
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;
    const cached = loadFromStorage();
    if (cached) setEdgeData(cached);

    fetch(getEdgeApiUrl())
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Record<string, EdgeIndex> }) => {
        if (json?.success && json.data) mergeData(json.data);
      })
      .catch(() => {});

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { edgeData, isConnected, lastUpdate };
}

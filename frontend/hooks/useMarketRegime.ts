'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type RegimeType =
  | 'STRONG_TRENDING_BULLISH'
  | 'TRENDING_BULLISH'
  | 'STRONG_TRENDING_BEARISH'
  | 'TRENDING_BEARISH'
  | 'SIDEWAYS'
  | 'NEUTRAL';

export type TrendStrength = 'STRONG' | 'MODERATE' | 'WEAK' | 'NONE';
export type TradeApproach = 'DIRECTIONAL_ONLY' | 'DIRECTIONAL_BIAS' | 'WAIT_AND_WATCH' | 'RANGE_TRADE';
export type DataSource = 'LIVE' | 'MARKET_CLOSED' | 'NO_DATA';

export interface RegimeFactor {
  score: number;
  label: string;
  signal: string;
  weight: number;
}

export interface RegimeContext {
  price: number;
  open: number;
  high: number;
  low: number;
  changePct: number;
  vix: number;
  pcr: number;
  orbHigh: number;
  orbLow: number;
}

export interface RegimeIndex {
  symbol: string;
  regime: RegimeType;
  isTrendingDay: boolean;
  trendStrength: TrendStrength;
  tradeApproach: TradeApproach;
  actionSummary: string;
  regimeScore: number;
  avgScore: number;
  scoreStability: number;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  directionStrength: number;
  factors: Record<string, RegimeFactor>;
  context: RegimeContext;
  dataSource: DataSource;
  timestamp: string;
}

export interface MarketRegimeData {
  NIFTY: RegimeIndex | null;
  BANKNIFTY: RegimeIndex | null;
  SENSEX: RegimeIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getRegimeWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/market-regime`;
}

function getLocalWsUrl(): string {
  const localWs = process.env.NEXT_PUBLIC_LOCAL_WS_URL || 'ws://localhost:8002/ws/market';
  const base = localWs.replace(/\/ws\/market$/, '');
  return `${base}/ws/market-regime`;
}

function getRegimeApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/market-regime`;
}

function getLocalApiUrl(): string {
  const localApi = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8002';
  return `${localApi.replace(/\/$/, '')}/api/market-regime`;
}

async function fetchRegimeWithFallback(): Promise<{ success?: boolean; data?: Record<string, RegimeIndex> } | null> {
  const primary = getRegimeApiUrl();
  const fallback = getLocalApiUrl();
  
  // Try local first when running on localhost (faster, avoids CORS issues with production)
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const urls = isLocal && fallback !== primary ? [fallback, primary] : [primary, fallback];
  
  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) { const j = await r.json(); if (j?.success && j.data) return j; }
    } catch { /* try next */ }
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'marketRegimeData_v1';

function saveToStorage(data: MarketRegimeData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): MarketRegimeData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MarketRegimeData) : null;
  } catch { return null; }
}

const EMPTY: MarketRegimeData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMarketRegime() {
  const [regimeData, setRegimeData] = useState<MarketRegimeData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const mountedRef = useRef(true);

  const mergeData = useCallback((raw: Record<string, RegimeIndex>) => {
    setRegimeData(prev => {
      const next: MarketRegimeData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          // Always accept new data — score/direction can change even within same timestamp
          const incoming = raw[sym];
          const existing = prev[sym];
          if (existing && existing.timestamp === incoming.timestamp &&
              existing.regimeScore === incoming.regimeScore &&
              existing.direction === incoming.direction &&
              existing.regime === incoming.regime) {
            continue; // Truly identical, skip
          }
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

  const wsUrlsRef = useRef<string[]>([]);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    // Build list of WS URLs to try — local first when running on localhost
    if (wsUrlsRef.current.length === 0) {
      const primary = getRegimeWsUrl();
      const local = getLocalWsUrl();
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      if (primary !== local) {
        wsUrlsRef.current = isLocal ? [local, primary] : [primary, local];
      } else {
        wsUrlsRef.current = [primary];
      }
    }

    const tryConnect = (urlIndex: number) => {
      if (urlIndex >= wsUrlsRef.current.length) {
        // All URLs failed, retry after delay
        retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
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
        retryDelay.current = 3000;
        // Reorder: put the working URL first for next reconnect
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
            data?: Record<string, RegimeIndex>;
          };
          if (msg.type === 'regime_update' || msg.type === 'regime_snapshot') {
            if (msg.data) mergeData(msg.data);
          }
        } catch { /* ignore malformed frames */ }
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        setIsConnected(false);
        if (pingRef.current) clearInterval(pingRef.current);
        if (!mountedRef.current) return;
        retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
        retryRef.current = setTimeout(() => tryConnect(0), retryDelay.current);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            fetchRegimeWithFallback()
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
    const cached = loadFromStorage();
    if (cached) setRegimeData(cached);

    fetchRegimeWithFallback()
      .then(json => { if (json?.data) mergeData(json.data); })
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

  return { regimeData, isConnected, lastUpdate };
}

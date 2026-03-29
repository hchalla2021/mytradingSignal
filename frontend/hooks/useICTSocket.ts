'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ICTDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ICTSignalType = 'BULL' | 'BEAR' | 'NEUTRAL';
export type ICTDataSource = 'LIVE' | 'MARKET_CLOSED';
export type ICTPrediction = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

/** One factor in the 6-signal ICT breakdown. */
export interface ICTSignalFactor {
  score: number;            // -1.0 to +1.0
  signal: ICTSignalType;
  label: string;
  weight: number;
  value?: number | null;
  extra?: Record<string, unknown>;
}

/** ICT setup classification. */
export interface ICTSetup {
  name: string;
  description: string;
  grade: string;        // A+, A, A-, B+, B, C, —
  confluences: number;
}

/** Per-index ICT analysis result. */
export interface ICTIndex {
  symbol: string;
  direction: ICTDirection;
  confidence: number;       // 1–99
  rawScore: number;
  ictSetup: ICTSetup;
  prediction5m: ICTPrediction;
  pred5mConf: number;       // 1–99
  pred5mScore: number;
  signals: {
    order_blocks:     ICTSignalFactor;
    fair_value_gaps:  ICTSignalFactor;
    market_structure: ICTSignalFactor;
    liquidity_sweeps: ICTSignalFactor;
    displacement:     ICTSignalFactor;
    smart_money_div:  ICTSignalFactor;
  };
  metrics: {
    price: number;
    changePct: number;
    oi: number;
    candleCount: number;
    swingHighs: number;
    swingLows: number;
    lastSwingHigh: number | null;
    lastSwingLow: number | null;
  };
  dataSource: ICTDataSource;
  timestamp: string;
}

export interface ICTData {
  NIFTY:     ICTIndex | null;
  BANKNIFTY: ICTIndex | null;
  SENSEX:    ICTIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getICTWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/ict`;
}

function getICTApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/ict`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'ictData_v1';

function saveToStorage(data: ICTData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): ICTData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ICTData) : null;
  } catch { return null; }
}

const EMPTY: ICTData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useICTSocket() {
  const [ictData, setICTData] = useState<ICTData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);

  const mergeData = useCallback((raw: Record<string, ICTIndex>) => {
    setICTData(prev => {
      const next: ICTData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          next[sym] = JSON.parse(JSON.stringify(raw[sym]));
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
    try { ws = new WebSocket(getICTWsUrl()); }
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
          data?: Record<string, ICTIndex>;
        };
        if (msg.type === 'ict_update' || msg.type === 'ict_snapshot') {
          if (msg.data) mergeData(msg.data);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getICTApiUrl())
            .then(r => r.json())
            .then((json: { success?: boolean; data?: Record<string, ICTIndex> }) => {
              if (json?.success && json.data) mergeData(json.data);
            })
            .catch(() => {});
        }, 2500);
      }
    };

    ws.onerror = () => {};
  }, [mergeData]);

  // Initialize: load from storage, start REST poll, then WebSocket
  useEffect(() => {
    const stored = loadFromStorage();
    if (stored) setICTData(stored);

    // Initial REST fetch
    fetch(getICTApiUrl())
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Record<string, ICTIndex> }) => {
        if (json?.success && json.data) mergeData(json.data);
      })
      .catch(() => {});

    // Connect WebSocket
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [connect, mergeData]);

  return { ictData, isConnected, lastUpdate };
}

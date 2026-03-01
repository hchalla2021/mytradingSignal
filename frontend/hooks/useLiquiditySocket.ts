'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LiquidityDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type LiquiditySignalType = 'BULL' | 'BEAR' | 'NEUTRAL';
export type LiquidityDataSource = 'LIVE' | 'MARKET_CLOSED';

/**
 * 5-minute pure-liquidity prediction — derived from OI velocity
 * and PCR momentum, not price action alone.
 */
export type LiquidityPrediction = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

/**
 * OI × Price direction matrix classification:
 *  LONG_BUILDUP     — price ↑ + OI ↑  (institutions adding longs)
 *  SHORT_COVERING   — price ↑ + OI ↓  (shorts exiting)
 *  SHORT_BUILDUP    — price ↓ + OI ↑  (institutions adding shorts)
 *  LONG_UNWINDING   — price ↓ + OI ↓  (longs exiting)
 *  NEUTRAL          — no clear pattern
 *
 * Also includes PCR-derived overrides:
 *  PCR_EXTREME_BULL — PCR ≥ 1.6 (extreme put wall)
 *  PCR_EXTREME_BEAR — PCR ≤ 0.5 (extreme call wall)
 */
export type OIProfile =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'SHORT_BUILDUP'
  | 'LONG_UNWINDING'
  | 'NEUTRAL'
  | 'PCR_EXTREME_BULL'
  | 'PCR_EXTREME_BEAR';

/** One factor in the 4-signal liquidity breakdown. */
export interface LiquiditySignalFactor {
  score: number;            // -1.0 to +1.0
  signal: LiquiditySignalType;
  label: string;            // human-readable description
  weight: number;           // e.g. 0.35
  value?: number | null;
  extra?: Record<string, unknown>;
}

export interface LiquidityIndex {
  symbol: string;
  direction: LiquidityDirection;
  confidence: number;       // 1–99
  rawScore: number;
  oiProfile: OIProfile;
  prediction5m: LiquidityPrediction;
  pred5mConf: number;       // 1–99
  signals: {
    pcr_sentiment:    LiquiditySignalFactor;
    oi_buildup:       LiquiditySignalFactor;
    price_momentum:   LiquiditySignalFactor;
    candle_conviction: LiquiditySignalFactor;
  };
  metrics: {
    price: number;
    changePct: number;
    oi: number;
    pcr: number | null;
    callOI: number;
    putOI: number;
    vwap: number | null;
    ema9: number | null;
    ema20: number | null;
    vwapDev: number | null;
  };
  dataSource: LiquidityDataSource;
  timestamp: string;
}

export interface LiquidityData {
  NIFTY:     LiquidityIndex | null;
  BANKNIFTY: LiquidityIndex | null;
  SENSEX:    LiquidityIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getLiquidityWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/liquidity`;
}

function getLiquidityApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/liquidity`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'liquidityData_v2';

function saveToStorage(data: LiquidityData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): LiquidityData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as LiquidityData) : null;
  } catch { return null; }
}

const EMPTY: LiquidityData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLiquiditySocket() {
  const [liquidityData, setLiquidityData] = useState<LiquidityData>(EMPTY);
  const [isConnected, setIsConnected]     = useState(false);
  const [lastUpdate, setLastUpdate]       = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);

  const mergeData = useCallback((raw: Record<string, LiquidityIndex>) => {
    setLiquidityData(prev => {
      const next: LiquidityData = { ...prev };
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) next[sym] = raw[sym];
      }
      saveToStorage(next);
      return next;
    });
    setLastUpdate(new Date().toISOString());
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getLiquidityWsUrl()); }
    catch { retryRef.current = setTimeout(connect, retryDelay.current); return; }

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      retryDelay.current = 3000;
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          data?: Record<string, LiquidityIndex>;
        };
        if (msg.type === 'liquidity_update' || msg.type === 'liquidity_snapshot') {
          if (msg.data) mergeData(msg.data);
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    const cached = loadFromStorage();
    if (cached) setLiquidityData(cached);

    fetch(getLiquidityApiUrl())
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Record<string, LiquidityIndex> }) => {
        if (json?.success && json.data) mergeData(json.data);
      })
      .catch(() => { /* backend may still be starting */ });

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current)  clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { liquidityData, isConnected, lastUpdate };
}

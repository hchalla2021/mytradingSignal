'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ────────────────────────────────────────────────────────────────────

export type CompassDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type CompassSignalType = 'BULL' | 'BEAR' | 'NEUTRAL';
export type DataSource = 'LIVE' | 'SPOT_ONLY' | 'MARKET_CLOSED';
export type PremiumTrend = 'EXPANDING' | 'CONTRACTING' | 'STABLE' | 'INSUFFICIENT';
export type TrendStructure = 'HH_HL' | 'LH_LL' | 'RANGING';
/** 5-minute short-term directional prediction. */
export type Prediction5m = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';

/** One factor in the 6-factor signal breakdown. */
export interface SignalFactor {
  score: number;           // -1.0 to +1.0
  signal: CompassSignalType;
  label: string;           // human-readable description
  weight: number;          // factor weight (e.g. 0.25 = 25%)
  value?: number | null;   // raw indicator value (RSI, EMA9, etc.)
  extra?: Record<string, any>;
}

export interface CompassSpot {
  price: number;
  change: number;
  changePct: number;
  // Candle-derived indicators
  vwap: number | null;
  rsi: number | null;
  ema9: number | null;
  ema20: number | null;
  ema50: number | null;
  trendStructure: TrendStructure;
  candlesUsed: number;
  prediction5m: Prediction5m;
  prediction5mConf: number;  // 40–92
}

export interface FuturesSlot {
  name: string;
  price: number;
  premium: number;
  premiumPct: number;
  changePct: number;
  expiry: string;
}

export interface CompassFutures {
  near: FuturesSlot | null;
  next: FuturesSlot | null;
  far: FuturesSlot | null;
  // Enhanced futures intelligence
  premiumTrend: PremiumTrend;
  fairValuePct: number;
  daysToExpiry: number;
  nearFutRsi: number | null;
  nearFutVwap: number | null;
  futuresLeading: boolean;
  prediction5mFut: Prediction5m;
}

export interface CompassIndex {
  symbol: string;
  spot: CompassSpot;
  futures: CompassFutures;
  /** 6-factor weighted signal breakdown */
  signals: {
    vwap:            SignalFactor;
    ema_alignment:   SignalFactor;
    trend_structure: SignalFactor;
    futures_premium: SignalFactor;
    rsi_momentum:    SignalFactor;
    volume_confirm:  SignalFactor;
  };
  direction: CompassDirection;
  confidence: number;       // 1–99
  rawScore: number;
  bias: string;             // one-line narrative
  dataSource: DataSource;
  timestamp: string;
}

export interface CompassData {
  NIFTY:     CompassIndex | null;
  BANKNIFTY: CompassIndex | null;
  SENSEX:    CompassIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getCompassWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/compass`;
}

function getCompassApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/compass`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'compassData_v2';

function saveToStorage(data: CompassData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): CompassData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

const EMPTY: CompassData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCompassSocket() {
  const [compassData, setCompassData] = useState<CompassData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);

  const mergeData = useCallback((raw: Record<string, CompassIndex>) => {
    setCompassData(prev => {
      const next: CompassData = { ...prev };
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
    try { ws = new WebSocket(getCompassWsUrl()); }
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
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'compass_update' || msg.type === 'compass_snapshot')
          mergeData(msg.data as Record<string, CompassIndex>);
      } catch { /* ignore */ }
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
    if (cached) setCompassData(cached);

    fetch(getCompassApiUrl())
      .then(r => r.json())
      .then(json => { if (json?.success && json.data) mergeData(json.data); })
      .catch(() => { /* backend may not be ready */ });

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current)  clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { compassData, isConnected, lastUpdate };
}

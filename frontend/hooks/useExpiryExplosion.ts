'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExpiryDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ExpiryAction = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type ExpiryDataSource = 'LIVE' | 'MARKET_CLOSED';

export type ExpiryPhase =
  | 'PRE_EXPIRY'
  | 'DAY_BEFORE'
  | 'EXPIRY_MORNING'
  | 'GAMMA_ZONE'
  | 'EXPLOSION_ZONE'
  | 'FINAL_MINUTES'
  | 'EXPIRED';

export type OIProfile =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'SHORT_BUILDUP'
  | 'LONG_UNWINDING'
  | 'NEUTRAL';

export interface ExpirySignalFactor {
  score: number;
  signal: 'BULL' | 'BEAR' | 'NEUTRAL';
  label: string;
  weight: number;
  extra?: Record<string, unknown>;
}

export interface StrikeLadderEntry {
  strike: number;
  type: string;
  distanceFromPrice: number;
  premiumLow: number;
  premiumHigh: number;
  premiumLabel: string;
  potential1ATR: number;
  potential2ATR: number;
  status: string;
  premiumSource?: 'LIVE' | 'EST';
  realPremium?: number | null;
  realOI?: number | null;
  tradingSymbol?: string;
}

export interface StrikeRecommendation {
  atmStrike: number;
  step: number;
  optionType: string;
  entryStrike: number;
  targetStrike: number;
  entryLabel: string;
  targetLabel: string;
  stoplossLabel: string;
  estimatedPremium: string;
  potential: string;
  bestTradeIndex?: number;
  buyable: boolean;
  buyWarning: string;
  strikeLadder?: StrikeLadderEntry[];
  tradeExpiry?: string;
  isNextExpiry?: boolean;
  expiryReason?: string;
  premiumSource?: 'LIVE' | 'ESTIMATED';
  fullOptionName?: string;
  tradingSymbol?: string;
}

export interface BreakoutLevels {
  support: number;
  resistance: number;
  atr: number;
  rangeWidth: number;
  pricePosition: number;
}

export interface ExpiryIndex {
  symbol: string;
  direction: ExpiryDirection;
  action: ExpiryAction;
  confidence: number;
  rawScore: number;
  isExpiryDay: boolean;
  isMonthlyExpiry?: boolean;
  hoursToExpiry: number;
  expiryPhase: ExpiryPhase;
  expiryLabel?: string;
  expiryDate?: string;
  signals: {
    gamma_exposure: ExpirySignalFactor;
    oi_concentration: ExpirySignalFactor;
    volume_surge: ExpirySignalFactor;
    pcr_extreme: ExpirySignalFactor;
    delta_acceleration: ExpirySignalFactor;
    iv_behavior: ExpirySignalFactor;
    theta_decay: ExpirySignalFactor;
  };
  strikeRecommendation: StrikeRecommendation;
  breakoutLevels: BreakoutLevels;
  metrics: {
    price: number;
    changePct: number;
    oi: number;
    pcr: number | null;
    callOI: number;
    putOI: number;
    volume: number;
  };
  dataSource: ExpiryDataSource;
  timestamp: string;
}

export interface ExpiryExplosionData {
  NIFTY: ExpiryIndex | null;
  BANKNIFTY: ExpiryIndex | null;
  SENSEX: ExpiryIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getExpiryWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/expiry-explosion`;
}

function getExpiryApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/expiry-explosion`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'expiryExplosionData_v1';

function saveToStorage(data: ExpiryExplosionData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): ExpiryExplosionData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ExpiryExplosionData) : null;
  } catch { return null; }
}

const EMPTY: ExpiryExplosionData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useExpiryExplosion() {
  const [expiryData, setExpiryData] = useState<ExpiryExplosionData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const mountedRef = useRef(true);

  const mergeData = useCallback((raw: Record<string, ExpiryIndex>) => {
    setExpiryData(prev => {
      const next: ExpiryExplosionData = { ...prev };
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
    try { ws = new WebSocket(getExpiryWsUrl()); }
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
          data?: Record<string, ExpiryIndex>;
        };
        if (msg.type === 'expiry_update' || msg.type === 'expiry_snapshot') {
          if (msg.data) mergeData(msg.data);
        }
      } catch { /* ignore malformed frames */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      // Only reconnect/poll if still mounted
      if (!mountedRef.current) return;
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getExpiryApiUrl())
            .then(r => r.json())
            .then((json: { success?: boolean; data?: Record<string, ExpiryIndex> }) => {
              if (json?.success && json.data) mergeData(json.data);
            })
            .catch(() => {});
        }, 4000);
      }
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    const cached = loadFromStorage();
    if (cached) setExpiryData(cached);

    fetch(getExpiryApiUrl())
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Record<string, ExpiryIndex> }) => {
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

  return { expiryData, isConnected, lastUpdate };
}

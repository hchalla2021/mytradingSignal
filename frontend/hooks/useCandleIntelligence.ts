'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type CandleStructure =
  | 'BULLISH_REVERSAL'
  | 'BULLISH_CONTINUATION'
  | 'BEARISH_REVERSAL'
  | 'BEARISH_CONTINUATION'
  | 'NEUTRAL';

export type CandleStrength = 'STRONG' | 'MODERATE' | 'WEAK';
export type CandleSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type CandleDataSource = 'LIVE' | 'PRE_OPEN' | 'FREEZE' | 'MARKET_CLOSED';

export interface CandlePatternInfo {
  name: string;
  structure: CandleStructure;
  weight: number;
}

export interface CandleAnatomy {
  open: number;
  high: number;
  low: number;
  close: number;
  body_ratio: number;
  upper_wick_ratio: number;
  lower_wick_ratio: number;
  is_bullish: boolean;
}

export interface TrendContext {
  direction: string;
  bullish_count: number;
  bearish_count: number;
  avg_body_ratio: number;
  candles_analyzed?: number;
}

// ── 3FA (3 Factor Alignment) Types ────────────────────────────────────────────

export interface ThreeFactorLocation {
  zone: 'NEAR_PDH' | 'NEAR_PDL' | 'ABOVE_PDH' | 'BELOW_PDL' | 'MID_ZONE' | 'UNKNOWN';
  pdh: number | null;
  pdl: number | null;
  vwap: number | null;
  distance_to_pdh: number | null;
  distance_to_pdl: number | null;
  vwap_position: 'ABOVE' | 'BELOW' | 'AT' | null;
  tradeable: boolean;
}

export interface ThreeFactorBehavior {
  type: 'REJECTION' | 'ABSORPTION' | 'BREAKOUT' | 'NONE';
  description: string;
  strength: number;
}

export interface ThreeFactorConfirmation {
  volume_ratio: number;
  volume_confirmed: boolean;
  body_strong: boolean;
  close_near_extreme: boolean;
  candle_confirmed: boolean;
  confirmed: boolean;
}

export interface ThreeFactorAlignment {
  location: ThreeFactorLocation;
  behavior: ThreeFactorBehavior;
  confirmation: ThreeFactorConfirmation;
  alignment_score: number;
  factors_pass: string[];
  factors_fail: string[];
  aligned: boolean;
  verdict: 'BUY' | 'SELL' | 'NO_TRADE';
  reason: string;
  market_active?: boolean;
}

export type CandleTimeframe = '3m' | '5m' | '15m';

export interface CandleIntelIndex {
  symbol: string;
  pattern: string | null;
  all_patterns: CandlePatternInfo[];
  structure: CandleStructure;
  strength: CandleStrength;
  signal: CandleSignal;
  confidence: number;
  confluence: number;
  candle: CandleAnatomy | null;
  trend_context: TrendContext;
  price: number;
  changePct: number;
  dataSource: CandleDataSource;
  timestamp: string;
  timeframe?: CandleTimeframe;
  /** 3 Factor Alignment analysis */
  three_factor?: ThreeFactorAlignment;
  /** Multi-timeframe analysis — each key is a full CandleIntelIndex */
  timeframes?: Record<CandleTimeframe, CandleIntelIndex>;
}

export interface CandleIntelData {
  NIFTY: CandleIntelIndex | null;
  BANKNIFTY: CandleIntelIndex | null;
  SENSEX: CandleIntelIndex | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getCandleIntelWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/candle-intelligence`;
}

function getCandleIntelApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/candle-intelligence`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'candleIntelData_v1';

function saveToStorage(data: CandleIntelData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): CandleIntelData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CandleIntelData) : null;
  } catch { return null; }
}

const EMPTY: CandleIntelData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCandleIntelligence() {
  const [data, setData] = useState<CandleIntelData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const mountedRef = useRef(true);

  const mergeData = useCallback((raw: Record<string, CandleIntelIndex>) => {
    setData(prev => {
      const next: CandleIntelData = { ...prev };
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
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getCandleIntelWsUrl()); }
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
          data?: Record<string, CandleIntelIndex>;
        };
        if (msg.type === 'candle_intel_update' || msg.type === 'candle_intel_snapshot') {
          if (msg.data) mergeData(msg.data);
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      if (pingRef.current) clearInterval(pingRef.current);
      if (!mountedRef.current) return;
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getCandleIntelApiUrl())
            .then(r => r.json())
            .then((json: { success?: boolean; data?: Record<string, CandleIntelIndex> }) => {
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
    if (cached) setData(cached);

    // Initial REST fetch
    fetch(getCandleIntelApiUrl())
      .then(r => r.json())
      .then((json: { success?: boolean; data?: Record<string, CandleIntelIndex> }) => {
        if (json?.success && json.data) mergeData(json.data);
      })
      .catch(() => {});

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect, mergeData]);

  return { data, isConnected };
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

const REST_FALLBACK_INTERVAL_MS = 3000;
const MAX_RETRY_DELAY_MS = 30000;

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
  | 'STRONG_LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'SHORT_BUILDUP'
  | 'STRONG_SHORT_BUILDUP'
  | 'LONG_UNWINDING'
  | 'QUIET_ACCUMULATION'
  | 'UNCONFIRMED_RALLY'
  | 'WEAK_SHORT_BUILDUP'
  | 'BEAR_EXHAUSTION'
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
  advanced5mPrediction?: Record<string, unknown>;  // Advanced micro-trend prediction
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

function toTsMs(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function isNewerSnapshot(next?: LiquidityIndex | null, prev?: LiquidityIndex | null): boolean {
  if (!next) return false;
  if (!prev) return true;
  return toTsMs(next.timestamp) >= toTsMs(prev.timestamp);
}

function materiallyChanged(next: LiquidityIndex, prev: LiquidityIndex): boolean {
  if (next.direction !== prev.direction) return true;
  if (next.prediction5m !== prev.prediction5m) return true;
  if (next.confidence !== prev.confidence) return true;
  if (next.pred5mConf !== prev.pred5mConf) return true;
  if (Math.abs((next.rawScore ?? 0) - (prev.rawScore ?? 0)) >= 0.02) return true;
  if (Math.abs((next.metrics?.price ?? 0) - (prev.metrics?.price ?? 0)) >= 0.05) return true;
  if ((next.oiProfile ?? 'NEUTRAL') !== (prev.oiProfile ?? 'NEUTRAL')) return true;
  return false;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLiquiditySocket() {
  const [liquidityData, setLiquidityData] = useState<LiquidityData>(EMPTY);
  const [isConnected, setIsConnected]     = useState(false);
  const [lastUpdate, setLastUpdate]       = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const mergeData = useCallback((raw: Record<string, LiquidityIndex>) => {
    let merged = false;
    setLiquidityData(prev => {
      const next: LiquidityData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        const incoming = raw[sym];
        if (incoming) {
          const current = prev[sym];
          if (current && !isNewerSnapshot(incoming, current)) continue;
          if (current && !materiallyChanged(incoming, current)) continue;
          // structuredClone is faster than JSON round-trip and handles types properly
          next[sym] = typeof structuredClone === 'function'
            ? structuredClone(incoming)
            : { ...incoming, signals: { ...incoming.signals }, metrics: { ...incoming.metrics } };
          changed = true;
        }
      }
      if (!changed) return prev; // No changes, don't trigger re-render
      merged = true;
      saveToStorage(next);
      return next;
    });
    if (merged) setLastUpdate(new Date().toISOString());
  }, []);

  const fetchSnapshot = useCallback(async () => {
    const requestSeq = ++fetchSeqRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const resp = await fetch(getLiquidityApiUrl(), { signal: ctrl.signal });
      const json = await resp.json() as { success?: boolean; data?: Record<string, LiquidityIndex> };
      if (!mountedRef.current) return;
      if (requestSeq !== fetchSeqRef.current) return;
      if (json?.success && json.data) mergeData(json.data);
    } catch {
      // Ignore aborted/failed fallback fetches.
    }
  }, [mergeData]);

  const connect = useCallback(() => {
    if (!mountedRef.current || typeof window === 'undefined') return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getLiquidityWsUrl()); }
    catch {
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      const jitter = Math.floor(Math.random() * 400);
      retryRef.current = setTimeout(connect, retryDelay.current + jitter);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      retryDelay.current = 3000;
      reconnectAttemptsRef.current = 0;
      // Stop REST polling — WebSocket is live
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
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
      if (!mountedRef.current) return;
      setIsConnected(false);
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      const jitter = Math.floor(Math.random() * 400);
      retryRef.current = setTimeout(connect, retryDelay.current + jitter);
      // Start REST polling fallback while WebSocket is down
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetchSnapshot();
        }, REST_FALLBACK_INTERVAL_MS);
      }
    };

    ws.onerror = () => ws.close();
  }, [fetchSnapshot, mergeData]);

  useEffect(() => {
    mountedRef.current = true;

    const cached = loadFromStorage();
    if (cached) setLiquidityData(cached);

    fetchSnapshot();

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current)  clearInterval(pingRef.current);
      if (pollRef.current)  clearInterval(pollRef.current);
      abortRef.current?.abort();
      wsRef.current?.close();
    };
  }, [connect, fetchSnapshot]);

  return { liquidityData, isConnected, lastUpdate };
}

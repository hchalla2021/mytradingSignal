'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

const REST_FALLBACK_INTERVAL_MS = 5000;
const MAX_RETRY_DELAY_MS = 30000;

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

export interface EdgeAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface EdgeAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface EdgeAIMicrostructure {
  liquidityDensity: number;
  structureDensity: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
}

export interface EdgeAISmc {
  state: 'BULLISH_IMBALANCE' | 'BEARISH_IMBALANCE' | 'LIQUIDITY_SWEEP_RISK' | 'BALANCED';
  score: number;
}

export interface EdgeAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
}

export interface EdgeAICommandDeck {
  streamState: 'LIVE' | 'CLOSED';
  modelProvider: 'tensorflow' | 'numpy_fallback';
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM';
  alerts: string[];
}

export interface EdgeAIInstitutionalConfluence {
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
}

export interface EdgeAIIntelligence {
  provider: 'tensorflow' | 'numpy_fallback';
  featureVersion: string;
  classProbabilities: EdgeAIClassProbabilities;
  sequencePrediction: EdgeAISequencePrediction;
  microstructure: EdgeAIMicrostructure;
  smc: EdgeAISmc;
  multiTimeframe: EdgeAIMultiTimeframe;
  commandDeck: EdgeAICommandDeck;
  institutionalConfluence: EdgeAIInstitutionalConfluence;
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
  ai?: EdgeAIIntelligence;
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

function toTsMs(ts?: string): number {
  if (!ts) return Number.NaN;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function isNewerSnapshot(next?: EdgeIndex | null, prev?: EdgeIndex | null): boolean {
  const n = toTsMs(next?.timestamp);
  const p = toTsMs(prev?.timestamp);
  if (!Number.isFinite(n) || !Number.isFinite(p)) return true;
  return n >= p;
}

function materiallyChanged(next: EdgeIndex, prev: EdgeIndex): boolean {
  return (
    next.action !== prev.action
    || next.direction !== prev.direction
    || next.oiProfile !== prev.oiProfile
    || Math.abs((next.confidence ?? 0) - (prev.confidence ?? 0)) >= 0.2
    || Math.abs((next.rawScore ?? 0) - (prev.rawScore ?? 0)) >= 0.002
    || Math.abs((next.metrics?.price ?? 0) - (prev.metrics?.price ?? 0)) >= 0.01
    || Math.abs((next.metrics?.changePct ?? 0) - (prev.metrics?.changePct ?? 0)) >= 0.01
    || next.timestamp !== prev.timestamp
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMarketEdge() {
  const [edgeData, setEdgeData] = useState<MarketEdgeData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const retryDelay = useRef(3000);
  const mountedRef = useRef(true);

  const mergeData = useCallback((raw: Record<string, EdgeIndex>) => {
    if (!mountedRef.current) return;
    setEdgeData(prev => {
      const next: MarketEdgeData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const current = prev[sym];
          if (current && !isNewerSnapshot(incoming, current)) continue;
          if (current && !materiallyChanged(incoming, current)) continue;
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

  const fetchSnapshot = useCallback(async () => {
    const requestId = ++requestSeqRef.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(getEdgeApiUrl(), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) return;
      const json = await res.json() as { success?: boolean; data?: Record<string, EdgeIndex> };
      if (!mountedRef.current || requestId !== requestSeqRef.current) return;
      if (json?.success && json.data) mergeData(json.data);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
    }
  }, [mergeData]);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getEdgeWsUrl()); }
    catch {
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      const jitter = Math.floor(Math.random() * 250);
      retryRef.current = setTimeout(connect, retryDelay.current + jitter);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      retryDelay.current = 3000;
      reconnectAttemptsRef.current = 0;
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
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      const jitter = Math.floor(Math.random() * 250);
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(connect, retryDelay.current + jitter);
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
    if (cached) setEdgeData(cached);

    fetchSnapshot();

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      abortRef.current?.abort();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, fetchSnapshot]);

  return { edgeData, isConnected, lastUpdate };
}

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

export interface CompassAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface CompassAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface CompassAIMicrostructure {
  liquidityDensity: number;
  structureDensity: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
}

export interface CompassAISmc {
  state: 'BULLISH_IMBALANCE' | 'BEARISH_IMBALANCE' | 'LIQUIDITY_SWEEP_RISK' | 'BALANCED';
  score: number;
}

export interface CompassAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
}

export interface CompassAICommandDeck {
  streamState: 'LIVE' | 'CLOSED';
  modelProvider: 'tensorflow' | 'numpy_fallback';
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM';
  alerts: string[];
}

export interface CompassAIInstitutionalConfluence {
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
}

export interface CompassAIIntelligence {
  provider: 'tensorflow' | 'numpy_fallback';
  featureVersion: string;
  classProbabilities: CompassAIClassProbabilities;
  sequencePrediction: CompassAISequencePrediction;
  microstructure: CompassAIMicrostructure;
  smc: CompassAISmc;
  multiTimeframe: CompassAIMultiTimeframe;
  commandDeck: CompassAICommandDeck;
  institutionalConfluence: CompassAIInstitutionalConfluence;
}

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
  institutionalPressure?: {
    score: number;
    label: string;
    fiiProxy: number;
    diiProxy: number;
    drivers?: Record<string, number>;
  };
  ai?: CompassAIIntelligence;
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
const STORAGE_FLUSH_MS = 1500;

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

function parseTsMs(ts: string | undefined): number {
  if (!ts) return Number.NaN;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

function sameSignalState(a: CompassIndex, b: CompassIndex): boolean {
  return (
    a.direction === b.direction
    && a.confidence === b.confidence
    && a.rawScore === b.rawScore
    && a.spot.price === b.spot.price
    && a.spot.changePct === b.spot.changePct
    && a.spot.prediction5m === b.spot.prediction5m
    && a.futures.premiumTrend === b.futures.premiumTrend
  );
}

function shouldAcceptUpdate(prev: CompassIndex | null, incoming: CompassIndex): boolean {
  if (!prev) return true;

  const prevTs = parseTsMs(prev.timestamp);
  const nextTs = parseTsMs(incoming.timestamp);

  if (Number.isFinite(prevTs) && Number.isFinite(nextTs)) {
    if (nextTs < prevTs) return false;
    if (nextTs === prevTs) return !sameSignalState(prev, incoming);
  }

  return !sameSignalState(prev, incoming);
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCompassSocket() {
  const [compassData, setCompassData] = useState<CompassData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef      = useRef<WebSocket | null>(null);
  const retryRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const storageFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingStorageRef = useRef<CompassData | null>(null);
  const mountedRef = useRef(true);
  const retryDelay = useRef(2000);

  const queueStorageSave = useCallback((data: CompassData) => {
    pendingStorageRef.current = data;
    if (storageFlushRef.current) return;
    storageFlushRef.current = setTimeout(() => {
      storageFlushRef.current = null;
      const pending = pendingStorageRef.current;
      pendingStorageRef.current = null;
      if (pending) saveToStorage(pending);
    }, STORAGE_FLUSH_MS);
  }, []);

  const mergeData = useCallback((raw: Record<string, CompassIndex>) => {
    setCompassData(prev => {
      const next: CompassData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        const incoming = raw[sym];
        if (!incoming) continue;
        if (!shouldAcceptUpdate(prev[sym], incoming)) continue;
        next[sym] = incoming;
        changed = true;
      }
      if (!changed) return prev;
      queueStorageSave(next);
      setLastUpdate(new Date().toISOString());
      return next;
    });
  }, [queueStorageSave]);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (!mountedRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getCompassWsUrl()); }
    catch { retryRef.current = setTimeout(connect, retryDelay.current); return; }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setIsConnected(true);
      retryDelay.current = 2000;
      // Stop REST polling — WebSocket is live
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
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
      if (!mountedRef.current) return;
      setIsConnected(false);
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      retryDelay.current = Math.min(retryDelay.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelay.current);
      // Start REST polling fallback while WebSocket is down
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getCompassApiUrl())
            .then(r => r.json())
            .then(json => { if (json?.success && json.data) mergeData(json.data); })
            .catch(() => {});
        }, 2500);
      }
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;
    const cached = loadFromStorage();
    if (cached) setCompassData(cached);

    fetch(getCompassApiUrl())
      .then(r => r.json())
      .then(json => { if (json?.success && json.data) mergeData(json.data); })
      .catch(() => { /* backend may not be ready */ });

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current)  { clearInterval(pingRef.current); pingRef.current = null; }
      if (pollRef.current)  { clearInterval(pollRef.current); pollRef.current = null; }
      if (storageFlushRef.current) {
        clearTimeout(storageFlushRef.current);
        storageFlushRef.current = null;
      }
      if (pendingStorageRef.current) {
        saveToStorage(pendingStorageRef.current);
        pendingStorageRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, mergeData]);

  return { data: compassData, compassData, isConnected, lastUpdate };
}

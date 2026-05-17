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

export interface ExpiryAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface ExpiryAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface ExpiryAIMicrostructure {
  liquidityDensity: number;
  structureDensity: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
}

export interface ExpiryAISmc {
  state: 'ACCUMULATION' | 'DISTRIBUTION' | 'LIQUIDITY_TRAP_RISK' | 'BALANCED';
  score: number;
}

export interface ExpiryAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
}

export interface ExpiryAICommandDeck {
  streamState: 'LIVE' | 'CLOSED';
  modelProvider: 'tensorflow' | 'numpy_fallback';
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM';
  alerts: string[];
}

export interface ExpiryAIInstitutionalConfluence {
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
}

export interface ExpiryAIIntelligence {
  provider: 'tensorflow' | 'numpy_fallback';
  featureVersion: string;
  classProbabilities: ExpiryAIClassProbabilities;
  sequencePrediction: ExpiryAISequencePrediction;
  microstructure: ExpiryAIMicrostructure;
  smc: ExpiryAISmc;
  multiTimeframe: ExpiryAIMultiTimeframe;
  commandDeck: ExpiryAICommandDeck;
  institutionalConfluence: ExpiryAIInstitutionalConfluence;
  summary: {
    direction: string;
    action: string;
    phase: string;
    expiryLabel: string;
    strikeAtm: number | undefined;
    strikeOptionType: string | undefined;
    breakoutSupport: number | undefined;
    breakoutResistance: number | undefined;
  };
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
  ai?: ExpiryAIIntelligence;
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
  const abortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
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
    if (wsRef.current?.readyState === WebSocket.OPEN || wsRef.current?.readyState === WebSocket.CONNECTING) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getExpiryWsUrl()); }
    catch { retryRef.current = setTimeout(connect, retryDelay.current); return; }

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
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(30000, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      const jitterMs = Math.floor(Math.random() * 250);
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(connect, retryDelay.current + jitterMs);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          const requestId = ++requestSeqRef.current;
          if (abortRef.current) abortRef.current.abort();
          abortRef.current = new AbortController();
          fetch(getExpiryApiUrl(), { cache: 'no-store', signal: abortRef.current.signal })
            .then(r => (r.ok ? r.json() : null))
            .then((json: { success?: boolean; data?: Record<string, ExpiryIndex> } | null) => {
              if (!mountedRef.current || requestId !== requestSeqRef.current) return;
              if (json?.success && json.data) mergeData(json.data);
            })
            .catch((err: unknown) => {
              if (err instanceof DOMException && err.name === 'AbortError') return;
            });
        }, 4000);
      }
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;

    const fetchSnapshot = () => {
      const requestId = ++requestSeqRef.current;
      if (abortRef.current) {
        abortRef.current.abort();
      }
      abortRef.current = new AbortController();

      fetch(getExpiryApiUrl(), { cache: 'no-store', signal: abortRef.current.signal })
        .then(r => (r.ok ? r.json() : null))
        .then((json: { success?: boolean; data?: Record<string, ExpiryIndex> } | null) => {
          if (!mountedRef.current || requestId !== requestSeqRef.current) return;
          if (json?.success && json.data) mergeData(json.data);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
        });
    };

    const cached = loadFromStorage();
    if (cached) setExpiryData(cached);

    fetchSnapshot();

    connect();

    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (abortRef.current) abortRef.current.abort();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect, mergeData]);

  return { expiryData, isConnected, lastUpdate };
}

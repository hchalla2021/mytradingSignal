'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

const REST_FALLBACK_INTERVAL_MS = 5000;
const MAX_RETRY_DELAY_MS = 30000;

// ── Types (mirror backend services/smc_engine.py output) ─────────────────────

export type SMCVerdict = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type SMCBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface SMCStructureEvent {
  type: 'BOS' | 'CHOCH' | 'MSS';
  direction: SMCBias;
  level: number | null;
  timestamp?: string;
  displacement?: boolean;
}

export interface SMCTimeframeStructure {
  bias: SMCBias;
  lastEvent: SMCStructureEvent | null;
  events?: SMCStructureEvent[];
  labels?: { label: string; price: number | null; timestamp?: string }[];
  protectedHigh?: number | null;
  protectedLow?: number | null;
}

export interface SMCDealingRange {
  high: number | null;
  low: number | null;
  equilibrium: number | null;
  positionPct: number | null;
  zone: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM' | 'UNKNOWN';
  ote: { buyZone: (number | null)[]; sellZone: (number | null)[] } | null;
}

export interface SMCLiquidityPool {
  side: 'BSL' | 'SSL';
  kind: string;
  level: number | null;
  strength: number;
  scope: 'INTERNAL' | 'EXTERNAL';
  distancePct: number | null;
  swept?: boolean;
}

export interface SMCSweep {
  poolKind: string;
  side: 'BSL' | 'SSL';
  level: number | null;
  timestamp?: string;
  barsAgo: number;
  trapConfirmed: boolean;
  read: string;
}

export interface SMCOrderBlock {
  side: 'DEMAND' | 'SUPPLY';
  state: 'VALID' | 'MITIGATED' | 'BREAKER';
  low: number | null;
  high: number | null;
  origin: string;
  timestamp?: string;
  barsAgo: number;
}

export interface SMCFvg {
  side: 'BULLISH' | 'BEARISH';
  state: 'OPEN' | 'PARTIAL' | 'INVERTED';
  low: number | null;
  high: number | null;
  sizePts: number | null;
  timestamp?: string;
  barsAgo: number;
}

export interface SMCFactor {
  score: number;
  note: string;
  weight: number;
}

export interface SMCTraderAction {
  call: 'BUY CE' | 'BUY PE' | 'WAIT';
  instrument: string | null;
  urgency: 'NOW' | 'HIGH' | 'ON_PULLBACK' | 'NONE';
  instruction: string;
  validity: string;
}

export interface SMCInstitutionalMap {
  exchange: 'NSE' | 'BSE';
  control: 'BUYERS' | 'SELLERS' | 'BALANCED';
  structureRead: string;
  timeframeAlignment: boolean;
  phase: string;
  phaseDirection: SMCBias;
  phaseConfidence: number;
  dealingRange: string;
  nearestBuySideLiquidity: { kind: string; level: number | null; scope: string } | null;
  nearestSellSideLiquidity: { kind: string; level: number | null; scope: string } | null;
  activePoi: { type: 'OB' | 'FVG'; side: string; state: string; low: number | null; high: number | null } | null;
  vwap: number | null;
  pcr: number | null;
  oiRead: string;
  regime: string;
}

export interface SMCTechnicalContext {
  ema: {
    status: 'READY' | 'PARTIAL' | 'INSUFFICIENT_HISTORY';
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    direction: SMCBias;
    score: number;
    priceVs200: string;
    distanceAtr?: number | null;
  };
  previousDay: { high: number | null; low: number | null };
  fourHour: { status: 'READY' | 'INSUFFICIENT_HISTORY'; closedCandles: number; direction: string };
}

export interface SMCTradePlan {
  action: SMCVerdict;
  entryZone: (number | null)[] | null;
  entryNote: string;
  stopLoss: number | null;
  invalidation: number | null;
  targets: { level: number | null; label: string }[];
  liquidityTarget: { level: number | null; kind: string; scope: string } | null;
  riskReward: number | null;
  riskScore: number;
  traderAction?: SMCTraderAction | null;
}

export interface SMCMagnet {
  level: number | null;
  kind: string;
  scope: 'INTERNAL' | 'EXTERNAL';
  side: 'BSL' | 'SSL';
  distancePts: number | null;
  probability: number;
}

export interface SMCPrediction {
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  conviction: number;
  horizonMinutes: number;
  magnet: SMCMagnet | null;
  secondaryMagnet: SMCMagnet | null;
  projection: Record<'m5' | 'm15' | 'm30', { expected: number | null; high: number | null; low: number | null }>;
  sequence: { step: number; event: string; probability: number }[];
  trapRisk: { level: number; side: 'BULL_TRAP' | 'BEAR_TRAP' | null; note: string };
  earlyWarnings: { signal: string; detail: string; urgency: 'HIGH' | 'MEDIUM' | 'LOW' }[];
  traderMap: { buyStopsAbove: number | null; sellStopsBelow: number | null; note: string };
  timing: { window: string; qualityMod: number; actNow: boolean; nextWindow: string };
  note: string;
}

export interface SMCIndexData {
  symbol: string;
  verdict: SMCVerdict;
  confidence: number;
  score: number;
  factorScore?: number;
  probabilities: { continuation: number; reversal: number; chop: number };
  alignment?: { alignedSignals: number; activeSignals: number; ratio: number; status: 'UNANIMOUS' | 'ALIGNED' | 'MIXED' };
  structure: {
    htf: SMCTimeframeStructure;
    ltf: SMCTimeframeStructure;
    aligned: boolean;
  };
  dealingRange: SMCDealingRange;
  liquidity: {
    pools: SMCLiquidityPool[];
    sweeps: SMCSweep[];
    inducement: { side: string; level: number | null; note: string } | null;
  };
  zones: {
    orderBlocks: SMCOrderBlock[];
    fvgs: SMCFvg[];
    bpr: { low: number | null; high: number | null; note: string } | null;
  };
  smt: { state: string; peer: string; score: number; note: string };
  confluence: {
    score: number | null;
    vwap: { value: number | null; score: number | null; note: string };
    volume: { score: number | null; note: string };
    oi: { score: number | null; note: string };
    pcr: { value: number | null; score: number | null; note: string };
  };
  regime: {
    market: 'TRENDING' | 'RANGING' | 'VOLATILE' | 'SQUEEZE';
    volatility: string;
    atr: number | null;
    atrPctile: number | null;
    trendStrength: number;
    trendDirection: SMCBias;
  };
  momentum: { rsi: number | null; roc5: number | null; state: string };
  session: { name: string; qualityMod: number; note: string };
  behavior: {
    absorption: { side: SMCBias; note: string } | null;
    exhaustion: { side: SMCBias; note: string } | null;
  };
  intent: { phase: string; direction: SMCBias; note: string; confidence: number };
  technical?: SMCTechnicalContext;
  institutionalMap?: SMCInstitutionalMap;
  tradePlan: SMCTradePlan;
  prediction?: SMCPrediction | null;
  factors: Record<string, SMCFactor>;
  reasoning: string[];
  metrics: {
    price: number | null;
    changePct: number | null;
    vwap: number | null;
    pdh: number | null;
    pdl: number | null;
    dayHigh: number | null;
    dayLow: number | null;
    tickTimestamp?: string | null;
    feedStatus?: string;
  };
  dataSource: 'LIVE' | 'MARKET_CLOSED';
  timestamp: string;
}

export interface SMCData {
  NIFTY: SMCIndexData | null;
  BANKNIFTY: SMCIndexData | null;
  SENSEX: SMCIndexData | null;
}

const EMPTY: SMCData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };
const STORAGE_KEY = 'smcStructureData_v1';

// ── URL helpers ───────────────────────────────────────────────────────────────

function getSMCWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/smc`;
}

function getSMCApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/smc`;
}

// ── Persistence ───────────────────────────────────────────────────────────────

function saveToStorage(data: SMCData): void {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): SMCData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SMCData) : null;
  } catch { return null; }
}

function toTsMs(value?: string | null): number {
  if (!value) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSMCStructure() {
  const [data, setData] = useState<SMCData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(3000);
  const reconnectAttemptsRef = useRef(0);
  const mountedRef = useRef(false);
  const fetchSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const mergeData = useCallback((raw: Record<string, SMCIndexData>) => {
    let merged = false;
    setData(prev => {
      const next: SMCData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        const incoming = raw[sym];
        if (!incoming) continue;
        const current = prev[sym];
        if (current && toTsMs(incoming.timestamp) < toTsMs(current.timestamp)) continue;
        next[sym] = incoming;
        changed = true;
      }
      if (!changed) return prev;
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
      const resp = await fetch(getSMCApiUrl(), { signal: ctrl.signal });
      const json = await resp.json() as { success?: boolean; data?: Record<string, SMCIndexData> };
      if (!mountedRef.current || requestSeq !== fetchSeqRef.current) return;
      if (json?.success && json.data) mergeData(json.data);
    } catch { /* aborted / transient — ignore */ }
  }, [mergeData]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchSnapshot, REST_FALLBACK_INTERVAL_MS);
  }, [fetchSnapshot]);

  const connect = useCallback(() => {
    if (!mountedRef.current || typeof window === 'undefined') return;
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return;

    let ws: WebSocket;
    try { ws = new WebSocket(getSMCWsUrl()); }
    catch {
      startPolling();
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      retryRef.current = setTimeout(connect, retryDelay.current + Math.floor(Math.random() * 400));
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setIsConnected(true);
      retryDelay.current = 3000;
      reconnectAttemptsRef.current = 0;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
      pingRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
      }, 25000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as {
          type: string;
          data?: Record<string, SMCIndexData>;
        };
        if ((msg.type === 'smc_update' || msg.type === 'smc_snapshot') && msg.data) {
          mergeData(msg.data);
        }
      } catch { /* malformed frame */ }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setIsConnected(false);
      if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
      reconnectAttemptsRef.current += 1;
      retryDelay.current = Math.min(MAX_RETRY_DELAY_MS, 1000 * (2 ** Math.min(6, reconnectAttemptsRef.current)));
      retryRef.current = setTimeout(connect, retryDelay.current + Math.floor(Math.random() * 400));
      startPolling();
    };

    ws.onerror = () => { try { ws.close(); } catch { /* ok */ } };
  }, [mergeData, fetchSnapshot, startPolling]);

  useEffect(() => {
    mountedRef.current = true;
    const cached = loadFromStorage();
    if (cached) setData(cached);
    fetchSnapshot();
    startPolling();          // active until the WS stream confirms open
    connect();
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      try { wsRef.current?.close(); } catch { /* ok */ }
      wsRef.current = null;
    };
  }, [connect, fetchSnapshot, startPolling]);

  return { data, isConnected, lastUpdate };
}

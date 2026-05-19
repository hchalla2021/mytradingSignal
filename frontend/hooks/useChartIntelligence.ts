'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Participant data (who's defending each zone) ────────────────────────────

export interface ZoneParticipants {
  bull_vol: number;      // volume from bullish candles in the zone
  bear_vol: number;      // volume from bearish candles in the zone
  total_vol: number;     // total volume at zone
  touch_count: number;   // how many candles touched the zone
  defender: 'BULLS' | 'BEARS' | 'BALANCED';  // who dominates
  bull_pct: number;      // 0–100, % of total volume that is bullish
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Candle {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface FVG {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  startIdx: number;
  filled: boolean;
  strength: number;
  quality?: 'PREMIUM' | 'STANDARD' | 'WEAK';
  partialFill?: number;
  momentum?: number;
  candles_ago?: number;
  // Candle volume participants (historical)
  bull_vol?: number;
  bear_vol?: number;
  total_vol?: number;
  touch_count?: number;
  defender?: 'BULLS' | 'BEARS' | 'BALANCED';
  bull_pct?: number;
  // Live option strike OI
  strike?: number;
  ce_oi?: number;
  pe_oi?: number;
  ce_oi_chg?: number;
  pe_oi_chg?: number;
  ce_vol?: number;
  pe_vol?: number;
  rotation?: 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE';
  oi_defender?: 'CALLS' | 'PUTS' | 'BALANCED';
  oi_interpretation?: string;
}

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  top: number;
  bottom: number;
  high: number;
  low: number;
  startIdx: number;
  mitigated: boolean;
  strength: number;
  quality?: 'PREMIUM' | 'STANDARD' | 'WEAK';
  candles_ago?: number;
  // impulse_vol: volume of the 3 candles AFTER the OB that confirmed the move.
  // For bullish OB = buying conviction; for bearish OB = selling conviction.
  // Displayed as ↑impulse on the chart (directionally meaningful, unlike bull_vol/bear_vol
  // which reflect the OB candle itself — always the opposite direction to the OB type).
  impulse_vol?: number;
  // Candle volume participants (historical)
  bull_vol?: number;
  bear_vol?: number;
  total_vol?: number;
  touch_count?: number;
  defender?: 'BULLS' | 'BEARS' | 'BALANCED';
  bull_pct?: number;
  // Live option strike OI
  strike?: number;
  ce_oi?: number;
  pe_oi?: number;
  ce_oi_chg?: number;
  pe_oi_chg?: number;
  ce_vol?: number;
  pe_vol?: number;
  rotation?: 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE';
  oi_defender?: 'CALLS' | 'PUTS' | 'BALANCED';
  oi_interpretation?: string;
}

export interface Liquidity {
  type: 'sell_side' | 'buy_side';
  level: number;
  startIdx: number;
  swept: boolean;
  sweepIdx: number | null;
  touchCount: number;
  quality?: 'PREMIUM' | 'STANDARD' | 'WEAK';
  // Candle volume participants (historical)
  bull_vol?: number;
  bear_vol?: number;
  total_vol?: number;
  touch_count?: number;
  defender?: 'BULLS' | 'BEARS' | 'BALANCED';
  bull_pct?: number;
  // Live option strike OI
  strike?: number;
  ce_oi?: number;
  pe_oi?: number;
  ce_oi_chg?: number;
  pe_oi_chg?: number;
  ce_vol?: number;
  pe_vol?: number;
  rotation?: 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE';
  oi_defender?: 'CALLS' | 'PUTS' | 'BALANCED';
  oi_interpretation?: string;
}

export interface StrikeOI {
  strike: number;
  ce_oi: number;
  pe_oi: number;
  ce_oi_chg: number;
  pe_oi_chg: number;
  ce_vol: number;
  pe_vol: number;
  rotation: 'CE_TO_PE' | 'PE_TO_CE' | 'BUILDING' | 'UNWINDING' | 'STABLE';
  oi_defender: 'CALLS' | 'PUTS' | 'BALANCED';
  oi_interpretation: string;
}

export interface LevelParticipants {
  price: number;
  bull_vol: number;
  bear_vol: number;
  total_vol: number;
  touch_count: number;
  defender: 'BULLS' | 'BEARS' | 'BALANCED';
  bull_pct: number;
  // Strike OI (optionally present)
  strike?: number;
  ce_oi?: number;
  pe_oi?: number;
  ce_oi_chg?: number;
  pe_oi_chg?: number;
  ce_vol?: number;
  pe_vol?: number;
  rotation?: string;
  oi_defender?: string;
  oi_interpretation?: string;
}

export interface ChartLevels {
  pdh: number;
  pdl: number;
  cdh: number;
  cdl: number;
  support: number[];
  resistance: number[];
  pdh_participants?: ZoneParticipants;
  pdl_participants?: ZoneParticipants;
  cdh_participants?: ZoneParticipants;
  cdl_participants?: ZoneParticipants;
  pdh_strike_oi?: StrikeOI;
  pdl_strike_oi?: StrikeOI;
  cdh_strike_oi?: StrikeOI;
  cdl_strike_oi?: StrikeOI;
  sr_participants?: {
    support: LevelParticipants[];
    resistance: LevelParticipants[];
  };
}

export interface ChartAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface ChartAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface ChartAIMicrostructure {
  liquidityDensity: number;
  structureDensity: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
}

export interface ChartAISmc {
  state: 'BULLISH_IMBALANCE' | 'BEARISH_IMBALANCE' | 'LIQUIDITY_SWEEP_RISK' | 'BALANCED';
  score: number;
}

export interface ChartAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
}

export interface ChartAICommandDeck {
  streamState: 'LIVE' | 'DELAYED' | 'CLOSED';
  modelProvider: 'tensorflow' | 'numpy_fallback';
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM' | 'COLD';
  alerts: string[];
}

export interface ChartAIInstitutionalConfluence {
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
}

export interface ChartAIEnsemble {
  provider: string;
  version: string;
  unifiedProbUp: number;
  confidence: number;
  classProbabilities: ChartAIClassProbabilities;
  signedScore: number;
  calibrator: { w: number; b: number };
  hitRatePct: number;
  samples: number;
  trail: number[];
}

export interface ChartAIIntelligence {
  provider: 'tensorflow' | 'numpy_fallback';
  featureVersion: string;
  classProbabilities: ChartAIClassProbabilities;
  sequencePrediction: ChartAISequencePrediction;
  microstructure: ChartAIMicrostructure;
  smc: ChartAISmc;
  multiTimeframe: ChartAIMultiTimeframe;
  commandDeck: ChartAICommandDeck;
  institutionalConfluence: ChartAIInstitutionalConfluence;
  ensemble?: ChartAIEnsemble;
}

export type ChartDataSource = 'LIVE' | 'CACHED' | 'MARKET_CLOSED';

export interface SymbolChartData {
  symbol: string;
  spot: number;
  candles3m: Candle[];
  candles5m: Candle[];
  fvg3m: FVG[];
  fvg5m: FVG[];
  ob3m: OrderBlock[];
  ob5m: OrderBlock[];
  liquidity3m: Liquidity[];
  liquidity5m: Liquidity[];
  levels: ChartLevels;
  ai?: ChartAIIntelligence;
  dataSource: ChartDataSource;
  timestamp: string;
}

export interface ChartIntelligenceData {
  NIFTY: SymbolChartData | null;
  BANKNIFTY: SymbolChartData | null;
  SENSEX: SymbolChartData | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getWsUrl(): string {
  const config = getEnvironmentConfig();
  return config.wsUrl.replace(/\/ws\/market$/, '') + '/ws/chart-intelligence';
}

function getApiUrl(): string {
  const config = getEnvironmentConfig();
  return config.apiUrl.replace(/\/$/, '') + '/api/chart-intelligence';
}

function getLocalWsUrl(): string {
  const ws = process.env.NEXT_PUBLIC_LOCAL_WS_URL || 'ws://localhost:8000/ws/market';
  return ws.replace(/\/ws\/market$/, '') + '/ws/chart-intelligence';
}

function getLocalApiUrl(): string {
  const api = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8000';
  return api.replace(/\/$/, '') + '/api/chart-intelligence';
}

async function fetchWithFallback(): Promise<{ success?: boolean; data?: Record<string, SymbolChartData> } | null> {
  const primary = getApiUrl();
  const fallback = getLocalApiUrl();
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  const urlSet = new Set<string>();
  if (isLocal) {
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/chart-intelligence');
    urlSet.add(primary);
  } else {
    // Production: only use configured URLs, never fall back to localhost
    urlSet.add(primary);
  }

  for (const url of Array.from(urlSet)) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data && Object.keys(j.data).length > 0) return j;
      }
    } catch { /* next */ }
  }
  return null;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'chartIntelligenceData_v1';

function saveToStorage(data: ChartIntelligenceData): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  const last = (saveToStorage as unknown as { _last?: number })._last ?? 0;
  if (now - last < 5000) return;
  (saveToStorage as unknown as { _last?: number })._last = now;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch { /* ok */ }
}

function loadFromStorage(): ChartIntelligenceData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChartIntelligenceData;
    // Discard data from a previous calendar day — candles are session-specific
    const today = new Date().toDateString();
    const hasStaleEntry = (['NIFTY', 'BANKNIFTY', 'SENSEX'] as const).some(sym => {
      const ts = parsed[sym]?.timestamp;
      if (!ts) return true;
      return new Date(ts).toDateString() !== today;
    });
    if (hasStaleEntry) {
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ok */ }
      return null;
    }
    return parsed;
  } catch { return null; }
}

function parseEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function hasMaterialChartChange(existing: SymbolChartData | null, incoming: SymbolChartData): boolean {
  if (!existing) return true;

  if (existing.timestamp !== incoming.timestamp) return true;
  if (existing.dataSource !== incoming.dataSource) return true;
  if (existing.spot !== incoming.spot) return true;

  const e5 = existing.candles5m ?? [];
  const i5 = incoming.candles5m ?? [];
  if (e5.length !== i5.length) return true;
  const e3 = existing.candles3m ?? [];
  const i3 = incoming.candles3m ?? [];
  if (e3.length !== i3.length) return true;

  const lastE5 = e5.at(-1);
  const lastI5 = i5.at(-1);
  if (
    lastE5?.t !== lastI5?.t ||
    lastE5?.o !== lastI5?.o ||
    lastE5?.h !== lastI5?.h ||
    lastE5?.l !== lastI5?.l ||
    lastE5?.c !== lastI5?.c ||
    lastE5?.v !== lastI5?.v
  ) {
    return true;
  }

  const ea = existing.ai;
  const ia = incoming.ai;
  if (!ea && ia) return true;
  if (ea && !ia) return true;
  if (ea && ia) {
    const ep = ea.classProbabilities;
    const ip = ia.classProbabilities;
    if (
      ep.STRONG_BUY !== ip.STRONG_BUY ||
      ep.BUY !== ip.BUY ||
      ep.NEUTRAL !== ip.NEUTRAL ||
      ep.SELL !== ip.SELL ||
      ep.STRONG_SELL !== ip.STRONG_SELL
    ) {
      return true;
    }

    if (
      ea.sequencePrediction.nextMove !== ia.sequencePrediction.nextMove ||
      ea.sequencePrediction.nextMovePts !== ia.sequencePrediction.nextMovePts ||
      ea.sequencePrediction.trendContinuationProb !== ia.sequencePrediction.trendContinuationProb ||
      ea.sequencePrediction.reversalProb !== ia.sequencePrediction.reversalProb
    ) {
      return true;
    }

    if (
      ea.commandDeck.streamState !== ia.commandDeck.streamState ||
      ea.commandDeck.analysisLatencyMs !== ia.commandDeck.analysisLatencyMs ||
      ea.commandDeck.eventRatePerSec !== ia.commandDeck.eventRatePerSec ||
      ea.commandDeck.queueDepth !== ia.commandDeck.queueDepth
    ) {
      return true;
    }

    if (
      ea.institutionalConfluence.executionProbability !== ia.institutionalConfluence.executionProbability ||
      ea.institutionalConfluence.smartMoneyAlignment !== ia.institutionalConfluence.smartMoneyAlignment ||
      ea.institutionalConfluence.institutionalFlow !== ia.institutionalConfluence.institutionalFlow ||
      ea.institutionalConfluence.riskRewardRatio !== ia.institutionalConfluence.riskRewardRatio
    ) {
      return true;
    }

    if (
      ea.microstructure.fakeBreakoutRisk !== ia.microstructure.fakeBreakoutRisk ||
      ea.microstructure.stopHuntRisk !== ia.microstructure.stopHuntRisk
    ) {
      return true;
    }
  }

  return false;
}

const EMPTY: ChartIntelligenceData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useChartIntelligence() {
  const [data, setData] = useState<ChartIntelligenceData>(() => loadFromStorage() ?? EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);
  const wsUrlsRef = useRef<string[]>([]);
  const rafRef = useRef<number | null>(null);
  const queuedPayloadRef = useRef<Record<string, SymbolChartData> | null>(null);

  const mergeData = useCallback((raw: Record<string, SymbolChartData>) => {
    let changedAny = false;
    let newestTs: string | null = null;

    setData(prev => {
      const next: ChartIntelligenceData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const existing = prev[sym];

          // Live-first: block only degraded CACHED overwrite of a LIVE frame.
          // Allow MARKET_CLOSED to replace LIVE so UI can transition cleanly after session end.
          if (existing?.dataSource === 'LIVE' && incoming.dataSource === 'CACHED') continue;

          // Drop older non-live frames during reconnect churn.
          const currTs = parseEpochMs(existing?.timestamp);
          const nextTs = parseEpochMs(incoming.timestamp);
          if (
            currTs != null &&
            nextTs != null &&
            nextTs < currTs &&
            incoming.dataSource !== 'LIVE'
          ) {
            continue;
          }

          if (!hasMaterialChartChange(existing ?? null, incoming)) continue;

          next[sym] = typeof structuredClone === 'function'
            ? structuredClone(incoming)
            : JSON.parse(JSON.stringify(incoming));
          changed = true;

          changedAny = true;
          if (incoming.timestamp) {
            if (!newestTs || Date.parse(incoming.timestamp) > Date.parse(newestTs)) {
              newestTs = incoming.timestamp;
            }
          }
        }
      }
      if (!changed) return prev;
      saveToStorage(next);
      return next;
    });

    if (changedAny) {
      setLastUpdate(newestTs ?? new Date().toISOString());
    }
  }, []);

  const queueMergeData = useCallback((payload: Record<string, SymbolChartData>) => {
    const queued = queuedPayloadRef.current ?? {};
    queuedPayloadRef.current = { ...queued, ...payload };

    if (rafRef.current !== null) return;

    const flush = () => {
      rafRef.current = null;
      const batch = queuedPayloadRef.current;
      queuedPayloadRef.current = null;
      if (batch && Object.keys(batch).length > 0) {
        mergeData(batch);
      }
    };

    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      rafRef.current = window.requestAnimationFrame(flush);
      return;
    }

    rafRef.current = setTimeout(flush, 0) as unknown as number;
  }, [mergeData]);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsUrlsRef.current.length === 0) {
      const primary = getWsUrl();
      const local = getLocalWsUrl();
      const port8000 = 'ws://localhost:8000/ws/chart-intelligence';
      const isLocal = window.location.hostname === 'localhost';
      const urlSet = new Set<string>();
      if (isLocal) { urlSet.add(local); urlSet.add(port8000); urlSet.add(primary); }
      else { urlSet.add(primary); urlSet.add(local); urlSet.add(port8000); }
      wsUrlsRef.current = Array.from(urlSet);
    }

    const tryConnect = (urlIndex: number) => {
      if (urlIndex >= wsUrlsRef.current.length) {
        retryDelay.current = Math.min(retryDelay.current * 1.5, 15000);
        retryRef.current = setTimeout(() => tryConnect(0), retryDelay.current);
        return;
      }

      let ws: WebSocket;
      try { ws = new WebSocket(wsUrlsRef.current[urlIndex]); }
      catch { tryConnect(urlIndex + 1); return; }

      const connectTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN) { ws.close(); tryConnect(urlIndex + 1); }
      }, 4000);

      wsRef.current = ws;

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setIsConnected(true);
        retryDelay.current = 1000;
        if (urlIndex > 0) {
          const working = wsUrlsRef.current[urlIndex];
          wsUrlsRef.current.splice(urlIndex, 1);
          wsUrlsRef.current.unshift(working);
        }
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: Record<string, SymbolChartData>;
          };
          if ((msg.type === 'chart_intel_update' || msg.type === 'chart_intel_snapshot') && msg.data) {
            queueMergeData(msg.data);
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        setIsConnected(false);
        if (pingRef.current) clearInterval(pingRef.current);
        if (!mountedRef.current) return;
        retryDelay.current = Math.min(retryDelay.current * 1.5, 15000);
        retryRef.current = setTimeout(() => tryConnect(0), retryDelay.current);
        if (!pollRef.current) {
          pollRef.current = setInterval(() => {
            fetchWithFallback()
              .then(json => { if (json?.data) queueMergeData(json.data); })
              .catch(() => {});
          }, 1500);
        }
      };

      ws.onerror = () => { clearTimeout(connectTimeout); ws.close(); };
    };

    tryConnect(0);
  }, [queueMergeData]);

  useEffect(() => {
    mountedRef.current = true;
    fetchWithFallback()
      .then(json => { if (json?.data && Object.keys(json.data).length > 0) queueMergeData(json.data); })
      .catch(() => {});
    connect();
    if (!pollRef.current) {
      pollRef.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;
        fetchWithFallback()
          .then(json => { if (json?.data && Object.keys(json.data).length > 0) queueMergeData(json.data); })
          .catch(() => {});
      }, 1500);
    }
    return () => {
      mountedRef.current = false;
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      if (rafRef.current !== null) {
        if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(rafRef.current);
        } else {
          clearTimeout(rafRef.current as unknown as ReturnType<typeof setTimeout>);
        }
        rafRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [connect, queueMergeData]);

  return { chartData: data, isConnected, lastUpdate };
}

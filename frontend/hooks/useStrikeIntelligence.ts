'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrikeSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type StrikeDataSource = 'LIVE' | 'CACHED' | 'LAST_CLOSE' | 'MARKET_CLOSED';

export interface StrikeSubSignals {
  /** Liquidity zone: "BSL" = Buy-Side Liquidity above spot, "SSL" = Sell-Side below */
  liq: 'BSL' | 'SSL' | null;
  /** BOS: structural breakout direction detected at/near ATM */
  bos: 'UP' | 'DOWN' | null;
  /** Advanced strike-level price action state from CE/PE premium behavior */
  advPriceAction?: 'IMPULSE_CONTINUATION' | 'OPPOSITE_WEAKNESS' | 'VOL_EXPANSION_NO_EDGE' | 'OTM_EXHAUSTION' | null;
  /** Black-Scholes delta (0→1 CE, -1→0 PE); BS analytical when IV solved, else synthetic */
  delta: number;
  /** Trap: high volume but price not moving in that direction = absorption */
  trap: boolean;
  /** OI Change interpretation: LB=Long Buildup, SB=Short Buildup, SC=Short Covering, LU=Long Unwinding */
  oiInterp?: 'LB' | 'SB' | 'SC' | 'LU' | null;
  /** Implied Volatility — Black-Scholes Newton-Raphson (annualised decimal: 0.145 = 14.5%) */
  iv?: number | null;
  /** Gamma: rate of delta change per ₹1 spot move (same formula CE/PE) */
  gamma?: number | null;
  /** Theta: time decay per calendar day in ₹ — negative means premium erodes */
  theta?: number | null;
  /** Vega: price sensitivity per +1% annualised IV change in ₹ */
  vega?: number | null;
}

export interface StrikeSideData {
  signal: StrikeSignal;
  score: number;
  breakdown: {
    buyPct: number;
    sellPct: number;
    neutralPct: number;
  };
  oi: number;
  /** OI change since the previous 5-second fetch (+ = buildup, − = unwinding) */
  oiChange?: number;
  volume: number;
  price: number;
  change: number;
  /** Advanced sub-signal indicators (BSL/SSL, BOS, Delta, Trap, OI Interp, IV, Greeks) */
  signals?: StrikeSubSignals;
  /** Price velocity level — auto-highlights fast-moving CE or PE sides in real-time */
  velocity?: 'COLD' | 'WARM' | 'HOT' | 'EXTREME' | null;
}

export interface StrikeRow {
  strike: number;
  label: string;
  isATM: boolean;
  ce: StrikeSideData;
  pe: StrikeSideData;
}

export interface StrikeKeyLevels {
  support: number | null;
  resistance: number | null;
  supportGapPct?: number | null;
  resistanceGapPct?: number | null;
}

export interface BestStrikeRecommendation {
  strike: number;
  label: string;
  side: 'CE' | 'PE';
  direction: 'UP' | 'DOWN';
  score: number;
  confidence: number;
  reason: string;
  greeksSummary: string;
}

export interface TradePrediction {
  strike: number;
  side: 'CE' | 'PE';
  entry: number;
  target: number;
  stopLoss: number;
  upsidePct: number;
  conviction: number;
  signal: StrikeSignal;
  delta: number;
  volume: number;
  oi: number;
  direction: 'UP' | 'DOWN';
  isATM: boolean;
  bos: string | null;
  reasons: string[];
}

export interface PricePredictions {
  primary: TradePrediction | null;
  secondary: TradePrediction | null;
  marketBias: string;
  score: number;
}

export interface WorldMarketImpact {
  status: 'LIVE' | 'PARTIAL' | 'UNAVAILABLE';
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  influenceScore: number;
  impactPts: number;
  liveCount: number;
  staleCount: number;
  totalCount: number;
  summary: string;
  components: Array<{
    symbol: string;
    changePct: number;
    status: string;
  }>;
}

export interface SymbolIntelligenceSummary {
  symbol: string;
  signal: StrikeSignal;
  score: number;
  confidence: number;
  regime: 'TRENDING' | 'RANGE' | 'TRANSITION' | 'TRAP_ZONE' | 'NO_DATA';
  agreementPct: number;
  bullPressure: number;
  bearPressure: number;
  trapRiskPct: number;
  actionability?: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
  confidenceReason?: string;
  /** Put-Call OI ratio (PE OI ÷ CE OI). >1.2 = bullish bias, <0.8 = bearish bias */
  pcr?: number;
  /** Max Pain strike — where option buyers collectively lose most at expiry */
  maxPain?: number | null;
  /** % gap from current spot to max pain strike (+ = max pain above spot) */
  maxPainGapPct?: number | null;
  /** World market risk overlay from Dow/Nasdaq/S&P/DAX/FTSE/Nikkei */
  worldMarket?: WorldMarketImpact;
  keyLevels: StrikeKeyLevels;
  /** AI Strike Recommender — best single strike to trade with direction prediction */
  bestStrike?: BestStrikeRecommendation | null;
  /** Lowest price predictions for ITM/OTM CE/PE with UP/DOWN direction */
  pricePredictions?: PricePredictions;
  insights: string[];
}

export interface SymbolStrikeData {
  symbol: string;
  spot: number;
  atm: number;
  step: number;
  expiry: string;
  strikeCount: number;
  chainTotals?: {
    totalCEVol: number;
    totalPEVol: number;
    totalCEOI?: number;
    totalPEOI?: number;
    totalVol?: number;
    totalOI?: number;
    totalCEOIChg?: number;
    totalPEOIChg?: number;
  };
  strikes: StrikeRow[];
  intelligence?: SymbolIntelligenceSummary;
  dataSource: StrikeDataSource;
  timestamp: string;
  spotUpdatedAt?: string;
  optionChainUpdatedAt?: string;
  optionChainAgeSec?: number;
  feedMode?: 'HYBRID_LIVE';
}

export interface StrikeIntelligenceData {
  NIFTY: SymbolStrikeData | null;
  BANKNIFTY: SymbolStrikeData | null;
  SENSEX: SymbolStrikeData | null;
}

// ── URL helpers ───────────────────────────────────────────────────────────────

function getStrikeIntelWsUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/strike-intelligence`;
}

function getStrikeIntelApiUrl(): string {
  const config = getEnvironmentConfig();
  const base = config.apiUrl.replace(/\/$/, '');
  return `${base}/api/strike-intelligence`;
}

function getLocalWsUrl(): string {
  const localWs = process.env.NEXT_PUBLIC_LOCAL_WS_URL || 'ws://localhost:8000/ws/market';
  const base = localWs.replace(/\/ws\/market$/, '');
  return `${base}/ws/strike-intelligence`;
}

function getLocalApiUrl(): string {
  const localApi = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8000';
  return `${localApi.replace(/\/$/, '')}/api/strike-intelligence`;
}

async function fetchWithFallback(): Promise<{ success?: boolean; data?: Record<string, SymbolStrikeData> } | null> {
  const primary = getStrikeIntelApiUrl();
  const fallback = getLocalApiUrl();
  const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';

  // Build URL list: try local-first when on localhost, always include localhost:8000 as last resort
  const urlSet = new Set<string>();
  if (isLocal) {
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/strike-intelligence');
    urlSet.add(primary);
  } else {
    urlSet.add(primary);
    urlSet.add(fallback);
    urlSet.add('http://localhost:8000/api/strike-intelligence');
  }
  const urls = Array.from(urlSet);

  for (const url of urls) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        const j = await r.json();
        if (j?.success && j.data && Object.keys(j.data).length > 0) return j;
      }
    } catch { /* try next */ }
  }
  return null;
}

const EMPTY: StrikeIntelligenceData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useStrikeIntelligence() {
  const [data, setData] = useState<StrikeIntelligenceData>(EMPTY);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelay = useRef(1000);
  const mountedRef = useRef(true);
  const wsUrlsRef = useRef<string[]>([]);

  const mergeData = useCallback((raw: Record<string, SymbolStrikeData>) => {
    setData(prev => {
      const next: StrikeIntelligenceData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const existing = prev[sym];
          // Live-first policy: do not let non-live payloads overwrite a live frame.
          if (existing?.dataSource === 'LIVE' && incoming.dataSource !== 'LIVE') continue;

          // Monotonic freshness guard: drop older or duplicate frames.
          if (existing) {
            const currTs = Date.parse(existing.timestamp || '');
            const nextTs = Date.parse(incoming.timestamp || '');
            if (Number.isFinite(currTs) && Number.isFinite(nextTs) && nextTs <= currTs) continue;
          }

          next[sym] = typeof structuredClone === 'function'
            ? structuredClone(incoming)
            : JSON.parse(JSON.stringify(incoming));
          changed = true;
        }
      }
      if (!changed) return prev;
      return next;
    });
    setLastUpdate(new Date().toISOString());
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    if (wsUrlsRef.current.length === 0) {
      const primary = getStrikeIntelWsUrl();
      const local = getLocalWsUrl();
      const port8000 = 'ws://localhost:8000/ws/strike-intelligence';
      const isLocal = typeof window !== 'undefined' && window.location.hostname === 'localhost';
      // Build unique URL list — always include localhost:8000
      const urlSet = new Set<string>();
      if (isLocal) {
        urlSet.add(local);
        urlSet.add(port8000);
        urlSet.add(primary);
      } else {
        urlSet.add(primary);
        urlSet.add(local);
        urlSet.add(port8000);
      }
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
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          tryConnect(urlIndex + 1);
        }
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
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'ping' }));
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as {
            type: string;
            data?: Record<string, SymbolStrikeData>;
          };
          if (msg.type === 'strike_intel_update' || msg.type === 'strike_intel_snapshot') {
            if (msg.data) mergeData(msg.data);
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
              .then(json => { if (json?.data) mergeData(json.data); })
              .catch(() => {});
          }, 2000);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        ws.close();
      };
    };

    tryConnect(0);
  }, [mergeData]);

  useEffect(() => {
    mountedRef.current = true;

    // Fetch REST snapshot immediately to hydrate first render before WS updates arrive.
    fetchWithFallback()
      .then(json => {
        if (json?.data && Object.keys(json.data).length > 0) mergeData(json.data);
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

  return { strikeData: data, isConnected, lastUpdate };
}

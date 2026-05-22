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

export interface QuantumFractalTimeframe {
  score: number;
  trend: 'STRONG_BULL' | 'BULL' | 'NEUTRAL' | 'BEAR' | 'STRONG_BEAR';
}

export interface QuantumFractalPrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  state: 'CONTINUATION' | 'WATCH';
  probabilityPct: number;
  horizonSec: string;
  rationale: string;
}

export interface QuantumCommandDeckPrediction {
  breakoutProbability: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
  liquidityShiftScore: number;
  institutionalFlowScore: number;
}

export interface QuantumCommandDeck {
  streamState: 'LIVE' | 'DELAYED' | 'CLOSED';
  modelProvider: string;
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM' | 'COLD';
  prediction: QuantumCommandDeckPrediction;
  alerts: string[];
}

export interface StrikeAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface StrikeAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface StrikeAIMicrostructure {
  liquidityScore: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
  institutionalActivity: number;
  ceFlowPct: number;
  peFlowPct: number;
}

export interface StrikeAISmc {
  state: 'BULLISH_DISPLACEMENT' | 'BEARISH_DISPLACEMENT' | 'LIQUIDITY_SWEEP_RISK' | 'BALANCED';
  score: number;
  bosUpCount: number;
  bosDownCount: number;
}

export interface StrikeAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
  worldCorrelationBias: 'POSITIVE_RISK_ON' | 'RISK_OFF' | 'MIXED';
}

export interface StrikeAIExecution {
  preferredSide: 'CE' | 'PE' | 'NONE';
  actionability: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: number;
}

export interface StrikeAIMLLightGBM {
  available: boolean;
  bullishProb: number | null;
  buyerMomentum: number | null;
  liquidityImbalance: number | null;
}

export interface StrikeAIMLLSTM {
  available: boolean;
  nextReturnPct: number | null;
  nextMovePts: number | null;
  confidence: number | null;
  seqLen: number;
  samples: number;
}

export interface StrikeAIMLScoring {
  provider: string;
  engines: string[];
  lgbm: StrikeAIMLLightGBM;
  lstm: StrikeAIMLLSTM;
  softmaxProvider: 'tensorflow' | 'numpy_fallback';
}

export interface StrikeAIIntelligence {
  /** Aggregate engine label, e.g. "lightgbm+torch_lstm+tensorflow" or "numpy_fallback" */
  provider: string;
  featureVersion: string;
  classProbabilities: StrikeAIClassProbabilities;
  sequencePrediction: StrikeAISequencePrediction;
  microstructure: StrikeAIMicrostructure;
  smc: StrikeAISmc;
  multiTimeframe: StrikeAIMultiTimeframe;
  execution: StrikeAIExecution;
  /** v2: LightGBM + PyTorch LSTM scoring block (optional for older payloads) */
  mlScoring?: StrikeAIMLScoring;
}

export interface InstitutionalConfluenceSummary {
  confluenceScore: number;
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
  drawdownRisk: number;
  profitFactor: number;
  liquidityTrapRisk: number;
  regimeBias: StrikeSignal;
  alerts: string[];
}

export interface QuantumFractalIntelligence {
  title: string;
  signal: StrikeSignal;
  score: number;
  confidence: number;
  fractalPressure: number;
  continuationProbability: number;
  volatilityRegime: 'EXPANSION' | 'COMPRESSION' | 'BALANCED';
  tags: string[];
  mtf: {
    micro: QuantumFractalTimeframe;
    medium: QuantumFractalTimeframe;
    macro: QuantumFractalTimeframe;
    alignmentPct: number;
  };
  components: {
    trendStrength: number;
    fractalContinuation: number;
    volumeLiquidity: number;
    marketStructure: number;
    volatilityState: number;
    directionalConfirmation: number;
  };
  prediction: QuantumFractalPrediction;
  commandDeck?: QuantumCommandDeck;
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
  /** TensorFlow-ready strike AI analytics with sequence and microstructure predictions */
  ai?: StrikeAIIntelligence;
  /** Institutional confluence analytics synthesized from AI + strike microstructure */
  institutionalConfluence?: InstitutionalConfluenceSummary;
  /** Multi-timeframe fractal market probe engine */
  quantumFractal?: QuantumFractalIntelligence;
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

function parseEpochMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function hasMaterialSymbolChange(existing: SymbolStrikeData | null, incoming: SymbolStrikeData): boolean {
  if (!existing) return true;

  if (existing.dataSource !== incoming.dataSource) return true;
  if ((existing.optionChainAgeSec ?? null) !== (incoming.optionChainAgeSec ?? null)) return true;
  if (existing.timestamp !== incoming.timestamp) return true;

  const a = existing.intelligence;
  const b = incoming.intelligence;
  if (!a && b) return true;
  if (a && !b) return true;
  if (!a || !b) return false;

  if (a.signal !== b.signal) return true;
  if (a.score !== b.score) return true;
  if (a.confidence !== b.confidence) return true;
  if (a.regime !== b.regime) return true;
  if (a.agreementPct !== b.agreementPct) return true;
  if (a.bullPressure !== b.bullPressure) return true;
  if (a.bearPressure !== b.bearPressure) return true;
  if (a.trapRiskPct !== b.trapRiskPct) return true;

  const aq = a.quantumFractal;
  const bq = b.quantumFractal;
  if (!aq && bq) return true;
  if (aq && !bq) return true;
  if (aq && bq) {
    if (aq.signal !== bq.signal) return true;
    if (aq.score !== bq.score) return true;
    if (aq.confidence !== bq.confidence) return true;
    if (aq.continuationProbability !== bq.continuationProbability) return true;
    if (aq.prediction.nextMove !== bq.prediction.nextMove) return true;
    if (aq.prediction.probabilityPct !== bq.prediction.probabilityPct) return true;
    if (aq.mtf.alignmentPct !== bq.mtf.alignmentPct) return true;
  }

  const ac = a.institutionalConfluence;
  const bc = b.institutionalConfluence;
  if (!ac && bc) return true;
  if (ac && !bc) return true;
  if (ac && bc) {
    if (ac.confluenceScore !== bc.confluenceScore) return true;
    if (ac.executionProbability !== bc.executionProbability) return true;
    if (ac.smartMoneyAlignment !== bc.smartMoneyAlignment) return true;
    if (ac.institutionalFlow !== bc.institutionalFlow) return true;
    if (ac.riskRewardRatio !== bc.riskRewardRatio) return true;
    if (ac.liquidityTrapRisk !== bc.liquidityTrapRisk) return true;
  }

  return false;
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
  const rafRef = useRef<number | null>(null);
  const queuedPayloadRef = useRef<Record<string, SymbolStrikeData> | null>(null);

  const mergeData = useCallback((raw: Record<string, SymbolStrikeData>) => {
    let changedAny = false;
    let newestTs: string | null = null;

    setData(prev => {
      const next: StrikeIntelligenceData = { ...prev };
      let changed = false;
      for (const sym of ['NIFTY', 'BANKNIFTY', 'SENSEX'] as const) {
        if (raw[sym]) {
          const incoming = raw[sym];
          const existing = prev[sym];
          // Live-first policy: do not let non-live payloads overwrite a live frame.
          if (existing?.dataSource === 'LIVE' && incoming.dataSource !== 'LIVE') continue;

          const existingTs = parseEpochMs(existing?.timestamp);
          const incomingTs = parseEpochMs(incoming.timestamp);
          if (
            existingTs != null &&
            incomingTs != null &&
            incomingTs < existingTs &&
            incoming.dataSource !== 'LIVE'
          ) {
            continue;
          }

          if (!hasMaterialSymbolChange(existing ?? null, incoming)) continue;

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
      return next;
    });

    if (changedAny) {
      setLastUpdate(newestTs ?? new Date().toISOString());
    }
  }, []);

  const queueMergeData = useCallback((payload: Record<string, SymbolStrikeData>) => {
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
            if (msg.data) queueMergeData(msg.data);
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
          }, 2000);
        }
      };

      ws.onerror = () => {
        clearTimeout(connectTimeout);
        ws.close();
      };
    };

    tryConnect(0);
  }, [queueMergeData]);

  useEffect(() => {
    mountedRef.current = true;

    // Fetch REST snapshot immediately to hydrate first render before WS updates arrive.
    fetchWithFallback()
      .then(json => {
        if (json?.data && Object.keys(json.data).length > 0) queueMergeData(json.data);
      })
      .catch(() => {});

    connect();

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

  return { strikeData: data, isConnected, lastUpdate };
}

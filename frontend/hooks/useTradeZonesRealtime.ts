import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { API_CONFIG } from '@/lib/api-config';

const isDev = process.env.NODE_ENV === 'development';
// Real-time zone detection with entry/exit signals based on EMA levels
//
// Architecture:
// - WebSocket: Live price/volume tick updates (0ms capture latency)
// - Batching: 200ms intelligent window prevents excessive re-renders
// - API: 3000ms refresh cycle (background data sync)
// - Caching: 5s live, 60s outside trading, 24h backup fallback
// - Performance: <200ms live latency, <50ms component render
//
// Zones:
// - BUY_ZONE: Price above EMA-20 + VWAP
// - SELL_ZONE: Price below EMA-20 and EMA-50
// - SUPPORT: Price at key EMA levels
// - PREMIUM_ZONE: Price above longterm support (EMA-100)
// - NEUTRAL: Awaiting momentum
//
// Returns: { data, loading, error, flash, refetch }
// ═══════════════════════════════════════════════════════════════════════════════

interface TradeZonesData {
  symbol: string;
  timestamp: string;
  current_price: number;
  zone_classification: 'BUY_ZONE' | 'SELL_ZONE' | 'SUPPORT' | 'BUY_SETUP' | 'PREMIUM_ZONE' | 'NEUTRAL';
  zone_description: string;
  ema_20: number;
  ema_50: number;
  ema_100: number;
  ema_200: number;
  distance_to_ema20_pct: number;
  distance_to_ema50_pct: number;
  distance_to_ema100_pct: number;
  buy_signal: 'STRONG_BUY' | 'BUY' | 'WEAK_BUY' | 'NO_BUY_SIGNAL';
  buy_confidence: number;
  buy_volume_pct: number;
  sell_signal: 'STRONG_SELL' | 'SELL' | 'WEAK_SELL' | 'NO_SELL_SIGNAL';
  sell_confidence: number;
  sell_volume_pct: number;
  overall_signal: 'STRONG_BUY' | 'BUY' | 'SELL' | 'STRONG_SELL' | 'NEUTRAL';
  signal_confidence: number;
  entry_quality: 'PREMIUM' | 'STANDARD' | 'ACCEPTABLE' | 'WEAK';
  entry_description: string;
  stop_loss_price: number;
  target_upside: number;
  target_downside: number;
  risk_reward_ratio: number;
  trend_structure: 'HIGHER_HIGHS_LOWS' | 'LOWER_HIGHS_LOWS' | 'SIDEWAYS';
  volume_strength: 'STRONG_VOLUME' | 'MODERATE_VOLUME' | 'WEAK_VOLUME';
  vwap_price: number;
  status: 'LIVE' | 'CACHED' | 'ERROR';
  data_status: string;
  token_valid: boolean;
  candles_analyzed: number;
  ai?: TradeZonesAIIntelligence;
}

export interface TradeZonesAIClassProbabilities {
  STRONG_BUY: number;
  BUY: number;
  NEUTRAL: number;
  SELL: number;
  STRONG_SELL: number;
}

export interface TradeZonesAISequencePrediction {
  nextMove: 'UP' | 'DOWN' | 'SIDEWAYS';
  nextMovePts: number;
  trendContinuationProb: number;
  reversalProb: number;
  horizonSec: number;
}

export interface TradeZonesAIMicrostructure {
  liquidityDensity: number;
  structureDensity: number;
  fakeBreakoutRisk: number;
  stopHuntRisk: number;
}

export interface TradeZonesAISmc {
  state: 'ACCUMULATION' | 'DISTRIBUTION' | 'LIQUIDITY_TRAP_RISK' | 'BALANCED';
  score: number;
}

export interface TradeZonesAIMultiTimeframe {
  micro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  medium: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  macro: { trend: 'BULL' | 'BEAR' | 'NEUTRAL'; momentum: number };
  alignmentPct: number;
}

export interface TradeZonesAICommandDeck {
  streamState: 'LIVE' | 'CLOSED';
  modelProvider: 'tensorflow' | 'numpy_fallback';
  analysisLatencyMs: number;
  pipelineCadenceMs: number;
  eventRatePerSec: number;
  queueDepth: number;
  cacheState: 'HOT' | 'WARM';
  alerts: string[];
}

export interface TradeZonesAIInstitutionalConfluence {
  executionProbability: number;
  smartMoneyAlignment: number;
  institutionalFlow: number;
  riskScore: number;
  rewardScore: number;
  riskRewardRatio: number;
}

export interface TradeZonesAIIntelligence {
  provider: 'tensorflow' | 'numpy_fallback';
  featureVersion: string;
  classProbabilities: TradeZonesAIClassProbabilities;
  sequencePrediction: TradeZonesAISequencePrediction;
  microstructure: TradeZonesAIMicrostructure;
  smc: TradeZonesAISmc;
  multiTimeframe: TradeZonesAIMultiTimeframe;
  commandDeck: TradeZonesAICommandDeck;
  institutionalConfluence: TradeZonesAIInstitutionalConfluence;
  summary: {
    zoneSignal: string;
    zoneClassification: string;
    signalConfidence: number;
    entryQuality: string;
    orderStructure: string;
    structureDescription: string;
    zoneDescription: string;
  };
}

interface UseTradeZonesRealtimeReturn {
  data: TradeZonesData | null;
  loading: boolean;
  error: string | null;
  flash: boolean; // 🔥 Flash when setup detected
  refetch: () => Promise<void>;
}

interface MarketSocketTick {
  symbol?: string;
  price?: number;
}

interface MarketSocketMessage {
  type?: string;
  data?: MarketSocketTick | Record<string, MarketSocketTick>;
}

/**
 * 💰 Single Symbol Hook – Live Trade Zone Detection
 * Real-time zone updates via WebSocket + intelligent 200ms batching
 * Fallback API refresh: every 3000ms
 * Cache strategy: 5s live, 60s non-trading, 24h backup
 */
export function useTradeZonesRealtime(symbol: string): UseTradeZonesRealtimeReturn {
  const [data, setData] = useState<TradeZonesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  // Refs for batching logic
  const pendingUpdatesRef = useRef<Map<string, any>>(new Map());
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const prevSignalRef = useRef<string>('NEUTRAL');
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const lastWsRefetchAtRef = useRef<number>(0);
  // 🔥 Track last price at refetch — triggers immediate re-fetch on ≥0.15% move
  const lastWsRefetchPriceRef = useRef<number>(0);

  const extractTickPrice = useCallback((message: MarketSocketMessage): number | null => {
    if (message.type === 'tick') {
      const tick = message.data as MarketSocketTick | undefined;
      if (tick?.symbol === symbol && typeof tick.price === 'number') {
        return tick.price;
      }
    }

    if (message.type === 'snapshot') {
      const snapshot = message.data as Record<string, MarketSocketTick> | undefined;
      const symbolTick = snapshot?.[symbol];
      if (symbolTick && typeof symbolTick.price === 'number') {
        return symbolTick.price;
      }
    }

    return null;
  }, [symbol]);

  /**
   * 🔥 Trigger visual flash when entry setup detected
   */
  const triggerZoneFlash = useCallback(() => {
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 800);
    return () => clearTimeout(timer);
  }, []);

  /**
   * 🌊 Process batched zone updates (200ms window)
   * Prevents excessive re-renders while maintaining responsiveness
   */
  const processBatchedUpdates = useCallback(() => {
    if (pendingUpdatesRef.current.size === 0) return;

    const latestData = Array.from(pendingUpdatesRef.current.values()).pop();
    if (latestData) {
      // 🔥 Flash on signal change (entry setup detection)
      if (latestData.overall_signal && latestData.overall_signal !== prevSignalRef.current) {
        if (
          latestData.overall_signal === 'STRONG_BUY' ||
          latestData.overall_signal === 'BUY' ||
          (latestData.entry_quality === 'PREMIUM' && latestData.overall_signal !== 'NEUTRAL')
        ) {
          triggerZoneFlash();
        }
        prevSignalRef.current = latestData.overall_signal;
      }

      // 🔄 Update state with latest data
      setData(latestData);
      setError(null);
    }

    pendingUpdatesRef.current.clear();
    batchTimerRef.current = null;
  }, [triggerZoneFlash]);

  /**
   * 📡 Queue zone update for batched processing
   */
  const queueZoneUpdate = useCallback((updates: any) => {
    pendingUpdatesRef.current.set('latest', updates);

    // Clear existing timer
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
    }

    // Schedule batch processing (200ms intelligent window)
    batchTimerRef.current = setTimeout(processBatchedUpdates, 200);
  }, [processBatchedUpdates]);

  /**
   * 📊 Fetch trade zone data from API
   */
  const fetchTradeZoneData = useCallback(async (silent = false) => {
    if (!symbol) return;

    const requestId = ++requestSeqRef.current;

    try {
      if (!silent || !dataRef.current) {
        setLoading(true);
      }
      setError(null);

      // Abort stale request before issuing a fresh one.
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      const apiUrl = API_CONFIG.baseUrl;

      const response = await fetch(`${apiUrl}/api/advanced/trade-zones/${symbol}`, {
        signal: abortControllerRef.current.signal,
        headers: {
          accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const zoneData: TradeZonesData = await response.json();

      // Ignore stale responses that returned after a newer request was sent.
      if (requestId !== requestSeqRef.current) {
        return;
      }

      // Queue update for batching
      queueZoneUpdate(zoneData);
      setLoading(false);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
        setLoading(false);
      }
    }
  }, [symbol, queueZoneUpdate]);

  /**
   * 🔄 Refetch trade zone data
   */
  const refetch = useCallback(async () => {
    await fetchTradeZoneData(false);
  }, [fetchTradeZoneData]);

  /**
   * 🌐 WebSocket Connection Management
   * Real-time price/volume tick updates
   */
  // Use ref to access latest data in WS handler without adding to deps
  const dataRef = useRef<TradeZonesData | null>(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => {
    reconnectAttemptsRef.current = 0;

    // Initial fetch
    fetchTradeZoneData(false);

    // API refresh timer (3000ms — WS provides sub-second deltas)
    const apiTimer = setInterval(() => {
      fetchTradeZoneData(true);
    }, 3000);

    // WebSocket for live updates
    const wsUrl = API_CONFIG.wsUrl;
    let ws: WebSocket | null = null;
    let wsReconnectTimer: NodeJS.Timeout | null = null;
    let shouldReconnect = true;

    const connectWebSocket = () => {
      if (!shouldReconnect) {
        return;
      }

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          reconnectAttemptsRef.current = 0;
          if (isDev) console.log(`[TRADE-ZONES] 🟢 WebSocket connected for ${symbol}`);
        };

        ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data) as MarketSocketMessage;
            const price = extractTickPrice(message);
            if (price === null) {
              return;
            }

            // 🔥 Immediate full refetch on significant price move (≥0.15%)
            // Avoids spreading stale signals — only current_price was updating locally.
            const lastPrice = lastWsRefetchPriceRef.current;
            const now = Date.now();
            const hasSignificantMove = lastPrice === 0 || Math.abs(price - lastPrice) / lastPrice >= 0.0015;
            const canRefetchNow = now - lastWsRefetchAtRef.current >= 800;
            if (hasSignificantMove && canRefetchNow) {
              lastWsRefetchPriceRef.current = price;
              lastWsRefetchAtRef.current = now;
              fetchTradeZoneData(true);
              return;
            }

            // Minor tick: update price in-place without a full API round-trip
            const current = dataRef.current;
            if (current) {
              queueZoneUpdate({
                ...current,
                current_price: price,
                timestamp: new Date().toISOString(),
              });
            }
          } catch (err) {
            console.error('[TRADE-ZONES] WebSocket message error:', err);
          }
        };

        ws.onerror = (event) => {
          console.error(`[TRADE-ZONES] 🔴 WebSocket error for ${symbol}:`, event);
          setError('WebSocket connection failed');
        };

        ws.onclose = () => {
          if (isDev) console.log(`[TRADE-ZONES] 🟠 WebSocket disconnected for ${symbol}`);

          if (!shouldReconnect) {
            return;
          }

          reconnectAttemptsRef.current += 1;
          const backoffMs = Math.min(30000, 1000 * (2 ** reconnectAttemptsRef.current));
          wsReconnectTimer = setTimeout(connectWebSocket, backoffMs);
        };
      } catch (err) {
        console.error('[TRADE-ZONES] WebSocket connection error:', err);
        reconnectAttemptsRef.current += 1;
        const backoffMs = Math.min(30000, 1000 * (2 ** reconnectAttemptsRef.current));
        wsReconnectTimer = setTimeout(connectWebSocket, backoffMs);
      }
    };

    // Connect to WebSocket
    connectWebSocket();

    // Cleanup
    return () => {
      shouldReconnect = false;

      if (batchTimerRef.current) {
        clearTimeout(batchTimerRef.current);
      }
      if (apiTimer) {
        clearInterval(apiTimer);
      }
      if (wsReconnectTimer) {
        clearTimeout(wsReconnectTimer);
      }
      if (ws) {
        ws.close();
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [symbol, fetchTradeZoneData, queueZoneUpdate]);

  return {
    data,
    loading,
    error,
    flash,
    refetch,
  };
}

/**
 * 🧮 Memoized Zone Analysis Helper
 * Prevents expensive recalculations on each render
 */
export function useMemoizedTradeZoneAnalysis(data: TradeZonesData | null) {
  return useMemo(() => {
    if (!data) return null;

    return {
      // Zone metrics
      zone: data.zone_classification,
      isBuyZone: data.zone_classification === 'BUY_ZONE',
      isSellZone: data.zone_classification === 'SELL_ZONE',
      isSupport: data.zone_classification === 'SUPPORT',
      isPremiumZone: data.zone_classification === 'PREMIUM_ZONE',

      // Signal analysis
      buySignal: data.buy_signal,
      sellSignal: data.sell_signal,
      overallSignal: data.overall_signal,
      isStrongBuy: data.overall_signal === 'STRONG_BUY',
      isBuy: data.overall_signal === 'BUY',
      isSell: data.overall_signal === 'SELL',
      isStrongSell: data.overall_signal === 'STRONG_SELL',

      // Confidence metrics
      signalConfidence: data.signal_confidence,
      confidenceLevel:
        data.signal_confidence >= 80
          ? 'EXCELLENT'
          : data.signal_confidence >= 65
            ? 'STRONG'
            : data.signal_confidence >= 50
              ? 'MODERATE'
              : 'WEAK',

      // Entry quality
      entryQuality: data.entry_quality,
      isPremiumEntry: data.entry_quality === 'PREMIUM',
      isStandardEntry: data.entry_quality === 'STANDARD',

      // Risk metrics
      riskRewardRatio: data.risk_reward_ratio,
      hasGoodRR: data.risk_reward_ratio >= 1.5,

      // EMA distances
      distanceToEMA20: data.distance_to_ema20_pct,
      distanceToEMA50: data.distance_to_ema50_pct,
      nearEMA20: Math.abs(data.distance_to_ema20_pct) < 1.0,

      // Trend
      trend: data.trend_structure,
      isUptrend: data.trend_structure === 'HIGHER_HIGHS_LOWS',
      isDowntrend: data.trend_structure === 'LOWER_HIGHS_LOWS',
    };
  }, [data]);
}

// useTradeZonesMultiRealtime removed — it called hooks inside .map() 
// violating React Rules of Hooks. Use individual useTradeZonesRealtime() calls instead.

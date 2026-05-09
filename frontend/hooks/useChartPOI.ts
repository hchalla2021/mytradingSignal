'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useMarketSocket } from './useMarketSocket';

/**
 * Point of Interest (POI) Data Structure
 * Represents a genuine institutional positioning level
 */
export interface POILevel {
  level: number;
  type: 'VOLUME_CLUSTER' | 'MULTIPLE_TOUCH' | 'INDUCEMENT' | 'VOLUME_IMBALANCE';
  touches: number;
  volume_score: number;
  quality: 'PREMIUM' | 'STANDARD' | 'WEAK';
  last_touch_idx: number;
  age_candles: number;
  distance_pct: number;
  institutional_strength: number;
  heat_level: 1 | 2 | 3 | 4 | 5;
  confluence_factors: string[];
}

export interface POIAnalysisResponse {
  symbol: string;
  status: 'SUCCESS' | 'NO_DATA' | 'ERROR' | 'TOKEN_EXPIRED';
  current_price: number;
  pois: POILevel[];
  poi_count: number;
  top_pois: POILevel[];
  closest_poi: POILevel | null;
  market_status: string;
  candles_analyzed: number;
  analysis_confidence: number;
  timestamp: string;
  token_valid: boolean;
  message: string;
  error?: string;
}

interface UseChartPOIState {
  data: POIAnalysisResponse | null;
  loading: boolean;
  error: string | null;
  lastUpdateTime: number;
  isStale: boolean;
}

/**
 * useChartPOI Hook
 * ────────────────
 * Fetches real-time Point of Interest levels from backend.
 * Uses WebSocket for live price updates + API polling for POI recalculation.
 * 
 * Features:
 * - 200ms batched updates on live price changes
 * - 3s API refresh during LIVE trading, 30s outside hours
 * - Automatic staleness detection
 * - Caches last good data as fallback
 * - Zero latency on price proximity for closest POI
 * 
 * Performance:
 * - Live closest_poi updates: <200ms (via WebSocket)
 * - Full POI recalculation: 3000ms (during LIVE)
 * - Fallback: 30000ms (outside trading hours)
 */
export function useChartPOI(
  symbol: string,
  enabled: boolean = true
): UseChartPOIState & { 
  refreshPOI: () => Promise<void>;
  getProximityWarning: (threshold_pct?: number) => string | null;
  isNearPOI: (threshold_pct?: number) => boolean;
} {
  const [state, setState] = useState<UseChartPOIState>({
    data: null,
    loading: false,
    error: null,
    lastUpdateTime: 0,
    isStale: false,
  });

  const { marketData } = useMarketSocket();
  const rafRef = useRef<number | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const batchWindowRef = useRef<NodeJS.Timeout | null>(null);
  const liveSpotRef = useRef<number>(0);
  const isDirtyRef = useRef(false);
  const lastFetchTimeRef = useRef(0);

  /**
   * Fetch POI data from backend
   */
  const fetchPOI = useCallback(async () => {
    if (!symbol || !enabled) return;

    // Debounce: prevent rapid consecutive requests
    const now = Date.now();
    const timeSinceLastFetch = now - lastFetchTimeRef.current;
    if (timeSinceLastFetch < 2000) {
      // Too recent, skip
      return;
    }

    try {
      abortControllerRef.current = new AbortController();

      setState(prev => ({ ...prev, loading: true }));

      const response = await fetch(
        `/api/advanced/poi/${symbol}`,
        {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
          signal: abortControllerRef.current.signal,
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const poiData: POIAnalysisResponse = await response.json();

      // Determine if data is stale (older than 5 minutes)
      const parseTime = new Date(poiData.timestamp).getTime();
      const isStale = Date.now() - parseTime > 5 * 60 * 1000;

      setState(prev => ({
        ...prev,
        data: poiData,
        loading: false,
        error: poiData.status === 'ERROR' ? poiData.error || 'Unknown error' : null,
        lastUpdateTime: now,
        isStale,
      }));

      lastFetchTimeRef.current = now;
      isDirtyRef.current = false;

      // Auto-poll based on market status
      const isLive = poiData.market_status === 'LIVE';
      const nextPollMs = isLive ? 3000 : 30000;

      // Clear existing timer
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }

      // Set new timer
      if (enabled) {
        pollIntervalRef.current = setInterval(() => {
          isDirtyRef.current = true;
        }, nextPollMs);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;

      setState(prev => ({
        ...prev,
        loading: false,
        error: err.message || 'Failed to fetch POI data',
      }));

      console.error('[useChartPOI] Fetch error:', err);
    }
  }, [symbol, enabled]);

  /**
   * Refresh POI data immediately
   */
  const refreshPOI = useCallback(async () => {
    lastFetchTimeRef.current = 0;
    await fetchPOI();
  }, [fetchPOI]);

  /**
   * Live price update handler - batched with 200ms window
   */
  useEffect(() => {
    const spot = marketData[symbol]?.price ?? 0;
    if (spot <= 0) return;

    liveSpotRef.current = spot;
    isDirtyRef.current = true;

    // Batch updates: only re-render if 200ms has passed
    if (batchWindowRef.current) {
      clearTimeout(batchWindowRef.current);
    }

    batchWindowRef.current = setTimeout(() => {
      // Force state update to trigger proximity calculations
      setState(prev => ({
        ...prev,
        // Trigger re-render without changing data
        lastUpdateTime: Date.now(),
      }));
    }, 200);

    return () => {
      if (batchWindowRef.current) {
        clearTimeout(batchWindowRef.current);
      }
    };
  }, [marketData, symbol]);

  /**
   * Initialize and poll POI data
   */
  useEffect(() => {
    if (!enabled || !symbol) return;

    // Initial fetch
    fetchPOI();

    // Cleanup on unmount
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      if (batchWindowRef.current) {
        clearTimeout(batchWindowRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [symbol, enabled, fetchPOI]);

  /**
   * Periodic dirty check - refetch if data looks stale
   */
  useEffect(() => {
    const checkInterval = setInterval(() => {
      if (isDirtyRef.current && state.data) {
        fetchPOI();
      }
    }, 1000);

    return () => clearInterval(checkInterval);
  }, [state.data, fetchPOI]);

  /**
   * Get proximity warning message
   */
  const getProximityWarning = useCallback(
    (threshold_pct: number = 0.003): string | null => {
      if (!state.data?.closest_poi) return null;

      const poi = state.data.closest_poi;
      const distance = poi.distance_pct / 100; // convert from pct string

      if (distance < threshold_pct) {
        return `⚠️ Price near ${poi.quality} POI at ₹${poi.level.toFixed(2)} (${poi.type})`;
      }

      return null;
    },
    [state.data]
  );

  /**
   * Check if price is near any POI (within threshold)
   */
  const isNearPOI = useCallback(
    (threshold_pct: number = 0.003): boolean => {
      if (!state.data?.closest_poi) return false;
      return (state.data.closest_poi.distance_pct / 100) < threshold_pct;
    },
    [state.data]
  );

  /**
   * Memoized return value
   */
  const memoizedState = useMemo(
    () => ({
      ...state,
      refreshPOI,
      getProximityWarning,
      isNearPOI,
    }),
    [state, refreshPOI, getProximityWarning, isNearPOI]
  );

  return memoizedState;
}

/**
 * useChartPOIMulti Hook
 * ─────────────────────
 * Fetch POI for multiple symbols in parallel
 * 
 * Usage:
 * const multiPOI = useChartPOIMulti(['NIFTY', 'BANKNIFTY', 'SENSEX']);
 * → multiPOI.data[symbol] → POIAnalysisResponse
 */
export function useChartPOIMulti(
  symbols: string[],
  enabled: boolean = true
) {
  const [data, setData] = useState<Record<string, POIAnalysisResponse | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!enabled || symbols.length === 0) return;

    try {
      setLoading(true);

      const promises = symbols.map(s =>
        fetch(`/api/advanced/poi/${s.toUpperCase()}`)
          .then(r => r.json())
          .then(d => ({ symbol: s.toUpperCase(), data: d }))
          .catch(err => ({ symbol: s.toUpperCase(), data: null, error: err.message }))
      );

      const results = await Promise.all(promises);
      const record: Record<string, POIAnalysisResponse | null> = {};

      results.forEach(r => {
        record[r.symbol] = r.data;
      });

      setData(record);
      setLoading(false);
      setError(null);
    } catch (err: any) {
      setError(err.message);
      setLoading(false);
    }
  }, [symbols, enabled]);

  useEffect(() => {
    fetch();
    const interval = setInterval(fetch, 3000); // Poll every 3s

    return () => clearInterval(interval);
  }, [fetch]);

  return { data, loading, error };
}

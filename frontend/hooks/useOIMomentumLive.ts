/**
 * 🚀 HIGH-PERFORMANCE OI MOMENTUM HOOK
 *
 * REST-polling OI Momentum signals with:
 * - ZERO initial load time (instant cached data)
 * - 3-second HTTP polling for live updates
 * - Isolated, independent functionality
 * - Smart caching for instant display
 */

import { useEffect, useState, useRef, useMemo } from "react";
import { getEnvironmentConfig } from "@/lib/env-detection";

export interface OIMomentumLiveData {
  symbol: string;
  signal_5m: string;
  signal_15m: string;
  final_signal: string;
  confidence: number;
  reasons: string[];
  metrics: {
    liquidity_grab_5m: boolean;
    liquidity_grab_15m: boolean;
    oi_buildup_5m: boolean;
    oi_buildup_15m: boolean;
    volume_spike_5m: boolean;
    volume_spike_15m: boolean;
    price_breakout_5m: boolean;
    price_breakout_15m: boolean;
    oi_change_pct_5m: number;
    oi_change_pct_15m: number;
    volume_ratio_5m: number;
    volume_ratio_15m: number;
    price_breakdown_5m: boolean;
    price_breakdown_15m: boolean;
    oi_reduction_5m: boolean;
    oi_reduction_15m: boolean;
    liquidity_grab_sell_5m: boolean;
    liquidity_grab_sell_15m: boolean;
  };
  symbol_name: string;
  current_price: number;
  timestamp: string;
  is_live?: boolean;
}

// In-memory cache shared across hook instances
const OI_MOMENTUM_CACHE = new Map<
  string,
  { data: OIMomentumLiveData; timestamp: number }
>();

export function useOIMomentumLive(symbol: string) {
  const [data, setData] = useState<OIMomentumLiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);

  const mountedRef = useRef(true);

  // Cleanup mounted flag
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // STEP 1: Show cached data instantly
  useEffect(() => {
    const cached = OI_MOMENTUM_CACHE.get(symbol);
    if (cached && Date.now() - cached.timestamp < 5000) {
      setData(cached.data);
      setLoading(false);
      setError(null);
    }
  }, [symbol]);

  // STEP 2: Initial fetch + polling every 3 seconds
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let aborted = false;

    const config = getEnvironmentConfig();
    const apiBaseUrl = config.apiUrl.replace(/\/$/, '');

    const fetchData = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/analysis/oi-momentum/${symbol}`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (aborted) return;

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();

        if (aborted || !mountedRef.current) return;

        if (result && result.final_signal) {
          setData((prev) => {
            if (
              !prev ||
              JSON.stringify(prev) !== JSON.stringify(result)
            ) {
              return result;
            }
            return prev;
          });
          setIsLive(true);
          setError(null);
          setLoading(false);

          OI_MOMENTUM_CACHE.set(symbol, {
            data: result,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        if (aborted || !mountedRef.current) return;

        const errorMsg =
          err instanceof Error ? err.message : "Unknown error";
        console.warn(`OI fetch error for ${symbol}:`, errorMsg);
        setError(errorMsg);

        // Fall back to cache
        const cached = OI_MOMENTUM_CACHE.get(symbol);
        if (cached) {
          setData(cached.data);
        }
        setLoading(false);
      }
    };

    // Initial fetch
    fetchData();

    // Poll every 3 seconds
    interval = setInterval(fetchData, 3000);

    return () => {
      aborted = true;
      if (interval) clearInterval(interval);
    };
  }, [symbol]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      isLive,
      isReady: !loading && data !== null,
    }),
    [data, loading, error, isLive]
  );
}

/**
 * Preload OI Momentum data for multiple symbols
 * Call this on app init for instant data when navigating to OI section
 */
export async function preloadOIMomentumData(symbols: string[]) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  try {
    const promises = symbols.map((symbol) =>
      fetch(`${apiUrl}/api/analysis/oi-momentum/${symbol}`, {
        signal: AbortSignal.timeout(3000),
      })
        .then((r) => r.json())
        .then((data) => {
          OI_MOMENTUM_CACHE.set(symbol, {
            data,
            timestamp: Date.now(),
          });
        })
        .catch(() => {}) // Silent fail on preload
    );

    await Promise.race([
      Promise.all(promises),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Preload timeout")), 5000)
      ),
    ]);
  } catch (err) {
    console.debug("OI preload error:", err instanceof Error ? err.message : "");
  }
}

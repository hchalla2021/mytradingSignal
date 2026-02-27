/**
 * 🚀 HIGH-PERFORMANCE OI MOMENTUM HOOK
 * 
 * Live WebSocket-based OI Momentum signals with:
 * - ZERO initial load time (instant cached data)
 * - Live tick updates via WebSocket
 * - Isolated, independent functionality
 * - Smart caching for instant display
 * 
 * Design by: 25-year veteran trader + ML engineer
 */

import { useEffect, useState, useCallback, useRef, useMemo } from "react";

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
    // Sell-side factors (required for SELL signal drivers)
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
  is_live?: boolean; // True if from live WebSocket, false if cached
}

// 🚀 IN-MEMORY CACHE (instant access, no state delays)
const OI_MOMENTUM_CACHE = new Map<string, {
  data: OIMomentumLiveData;
  timestamp: number;
}>();

// WebSocket connection pool (one per tab)
let global_ws: WebSocket | null = null;
let ws_listeners = new Map<string, Set<(data: OIMomentumLiveData) => void>>();

/**
 * Get or create global WebSocket for OI momentum updates
 * One connection per tab, shared by all components
 */
function getOIMomentumWebSocket(): WebSocket {
  if (global_ws && global_ws.readyState === WebSocket.OPEN) {
    return global_ws;
  }

  const wsUrl = `${process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws'}/market`;
  global_ws = new WebSocket(wsUrl);

  global_ws.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);

      // Handle OI Momentum updates from backend
      if (message.type === "oi_momentum_update") {
        const { symbol, data } = message;
        
        if (symbol && data) {
          // Update cache
          OI_MOMENTUM_CACHE.set(symbol, {
            data: { ...data, is_live: true },
            timestamp: Date.now(),
          });

          // Notify all listeners for this symbol
          const listeners = ws_listeners.get(symbol);
          if (listeners) {
            listeners.forEach((cb) => cb({ ...data, is_live: true }));
          }
        }
      }
    } catch (e) {
      console.error("OI Momentum WebSocket parse error:", e);
    }
  };

  global_ws.onerror = (error) => {
    console.error("OI Momentum WebSocket error:", error);
    global_ws = null;
  };

  global_ws.onclose = () => {
    global_ws = null;
  };

  return global_ws;
}

export function useOIMomentumLive(symbol: string) {
  const [data, setData] = useState<OIMomentumLiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const initialFetchDone = useRef(false);
  const lastFetchTime = useRef(0);

  // 🚀 STEP 1: Try cache first for instant display
  useEffect(() => {
    const cached = OI_MOMENTUM_CACHE.get(symbol);
    if (cached && Date.now() - cached.timestamp < 5000) {
      // Cache is fresh (< 5 seconds old)
      setData(cached.data);
      setLoading(false);
      setError(null);
    }
  }, [symbol]);

  // 🚀 STEP 2: Fetch fresh data from API
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Only fetch if not too recent to avoid spam
        const now = Date.now();
        if (now - lastFetchTime.current < 2000) return; // Don't refetch more than every 2s
        lastFetchTime.current = now;

        setLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const response = await fetch(
          `${apiUrl}/api/analysis/oi-momentum/${symbol}`,
          { signal: AbortSignal.timeout(5000) }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const result = await response.json();
        
        if (result && result.final_signal) {
          setData(result);
          setError(null);
          
          // Update cache
          OI_MOMENTUM_CACHE.set(symbol, {
            data: result,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        console.warn(`OI fetch error for ${symbol}:`, errorMsg);
        setError(errorMsg);
        
        // Try to use cached data if fetch fails
        const cached = OI_MOMENTUM_CACHE.get(symbol);
        if (cached) {
          setData(cached.data);
        }
      } finally {
        setLoading(false);
      }
    };

    // Fetch immediately on symbol change
    if (!initialFetchDone.current || symbol) {
      initialFetchDone.current = true;
      fetchData();
    }
  }, [symbol]);

  // 🚀 STEP 3: Subscribe to live WebSocket updates
  useEffect(() => {
    try {
      wsRef.current = getOIMomentumWebSocket();

      // Register listener for this symbol
      if (!ws_listeners.has(symbol)) {
        ws_listeners.set(symbol, new Set());
      }

      const updateHandler = (newData: OIMomentumLiveData) => {
        setData(newData);
        setIsLive(true);
        setLoading(false);
        setError(null);
      };

      ws_listeners.get(symbol)?.add(updateHandler);

      return () => {
        ws_listeners.get(symbol)?.delete(updateHandler);
        if (ws_listeners.get(symbol)?.size === 0) {
          ws_listeners.delete(symbol);
        }
      };
    } catch (err) {
      console.error("OI WebSocket setup error:", err);
    }
  }, [symbol]);

  // 🚀 STEP 4: Fallback HTTP polling (if WebSocket unavailable or for regular updates)
  useEffect(() => {
    const poll = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        const response = await fetch(
          `${apiUrl}/api/analysis/oi-momentum/${symbol}`,
          { signal: AbortSignal.timeout(3000) }
        );

        if (response.ok) {
          const result = await response.json();
          
          if (result && result.final_signal) {
            // Only update if data changed (avoid unnecessary re-renders)
            setData(prevData => {
              if (!prevData || JSON.stringify(prevData) !== JSON.stringify(result)) {
                return result;
              }
              return prevData;
            });
            
            setIsLive(false); // Polling, not live
            setError(null);
            
            // Update cache
            OI_MOMENTUM_CACHE.set(symbol, {
              data: result,
              timestamp: Date.now(),
            });
          }
        }
      } catch (err) {
        // Silent error - don't disrupt UI with polling errors
        console.debug(`OI poll error for ${symbol}`);
      }
    };

    // Poll every 5 seconds for fresh data
    const interval = setInterval(poll, 5000);

    return () => {
      if (interval) {
        clearInterval(interval);
      }
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

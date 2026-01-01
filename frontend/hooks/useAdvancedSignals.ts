/**
 * useAdvancedSignals - Performance-Optimized Hook
 * Senior Dev Pattern: Parallel fetching, memoization, minimal re-renders
 * Time Complexity: O(1) for state updates
 * Space Complexity: O(n) where n = 3 symbols × 3 analysis types = 9 data objects
 */

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface AdvancedSignal {
  signal: string;
  confidence: number;
}

interface AdvancedSignalsData {
  zoneControl: { [key: string]: AdvancedSignal | null };
  volumePulse: { [key: string]: AdvancedSignal | null };
  trendBase: { [key: string]: AdvancedSignal | null };
}

// ✅ All values from .env.local - No hardcoded fallbacks
const SYMBOLS = (process.env.NEXT_PUBLIC_MARKET_SYMBOLS || '').split(',').filter(Boolean);
const REFRESH_INTERVAL = parseInt(process.env.NEXT_PUBLIC_ADVANCED_REFRESH_INTERVAL || '0', 10);
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';
const ZONE_CONTROL_ENDPOINT = process.env.NEXT_PUBLIC_ZONE_CONTROL_ENDPOINT || '';
const VOLUME_PULSE_ENDPOINT = process.env.NEXT_PUBLIC_VOLUME_PULSE_ENDPOINT || '';
const TREND_BASE_ENDPOINT = process.env.NEXT_PUBLIC_TREND_BASE_ENDPOINT || '';

export const useAdvancedSignals = () => {
  const [data, setData] = useState<AdvancedSignalsData>({
    zoneControl: {},
    volumePulse: {},
    trendBase: {},
  });
  const [loading, setLoading] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  // ✅ Performance: Memoized fetch function
  const fetchAdvancedSignals = useCallback(async () => {
    // Cancel previous request if still pending
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();

    try {
      // ✅ Performance: Parallel fetching - all requests at once
      const fetchPromises = SYMBOLS.flatMap(symbol => [
        fetch(`${API_BASE_URL}${ZONE_CONTROL_ENDPOINT}/${symbol}`, { 
          signal: abortControllerRef.current!.signal 
        }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE_URL}${VOLUME_PULSE_ENDPOINT}/${symbol}`, { 
          signal: abortControllerRef.current!.signal 
        }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`${API_BASE_URL}${TREND_BASE_ENDPOINT}/${symbol}`, { 
          signal: abortControllerRef.current!.signal 
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);

      const results = await Promise.all(fetchPromises);

      // ✅ Performance: Single state update with all data
      const newData: AdvancedSignalsData = {
        zoneControl: {},
        volumePulse: {},
        trendBase: {},
      };

      SYMBOLS.forEach((symbol, idx) => {
        const baseIdx = idx * 3;
        const zoneData = results[baseIdx];
        const volumeData = results[baseIdx + 1];
        const trendData = results[baseIdx + 2];

        newData.zoneControl[symbol] = zoneData ? { 
          signal: zoneData.signal, 
          confidence: zoneData.confidence 
        } : null;
        newData.volumePulse[symbol] = volumeData ? { 
          signal: volumeData.signal, 
          confidence: volumeData.confidence 
        } : null;
        newData.trendBase[symbol] = trendData ? { 
          signal: trendData.signal, 
          confidence: trendData.confidence 
        } : null;
      });

      setData(newData);
      setLoading(false);
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('[ADVANCED-SIGNALS] Fetch error:', error);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    fetchAdvancedSignals();

    // ✅ Performance: Single interval for all updates
    const interval = setInterval(fetchAdvancedSignals, REFRESH_INTERVAL);

    return () => {
      clearInterval(interval);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchAdvancedSignals]);

  return { data, loading };
};

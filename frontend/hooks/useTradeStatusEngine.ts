'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import type {
  TradeStatusEngineAlert,
  TradeStatusEngineResponse,
  TradeSymbol,
} from '@/types/trade-status';

interface UseTradeStatusEngineOptions {
  symbol: TradeSymbol;
  refreshIntervalMs?: number;
}

interface UseTradeStatusEngineResult {
  data: TradeStatusEngineResponse | null;
  loading: boolean;
  error: string | null;
  alerts: TradeStatusEngineAlert[];
  refetch: () => Promise<void>;
}

const MAX_ALERTS = 10;

export function useTradeStatusEngine({
  symbol,
  refreshIntervalMs = 2500,
}: UseTradeStatusEngineOptions): UseTradeStatusEngineResult {
  const [data, setData] = useState<TradeStatusEngineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<TradeStatusEngineAlert[]>([]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  const fetchEngine = useCallback(async () => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    try {
      const response = await fetch(
        API_CONFIG.endpoint(`/api/trade-status/engine?symbol=${symbol}`),
        { cache: 'no-store' }
      );

      if (!response.ok) {
        throw new Error(`Engine HTTP ${response.status}`);
      }

      const payload = (await response.json()) as TradeStatusEngineResponse;
      if (requestId !== requestIdRef.current) return;

      setData(payload);
      setError(null);
      setLoading(false);

      if (Array.isArray(payload.alerts) && payload.alerts.length > 0) {
        setAlerts((previous) => {
          const merged = [...payload.alerts, ...previous];
          const deduped = merged.filter(
            (alert, index, self) => self.findIndex((item) => item.id === alert.id) === index
          );
          return deduped.slice(0, MAX_ALERTS);
        });
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setLoading(false);
      setError(err instanceof Error ? err.message : 'Unknown engine error');
    }
  }, [symbol]);

  useEffect(() => {
    let stopped = false;

    const tick = async () => {
      if (stopped) return;
      await fetchEngine();
      if (stopped) return;
      timerRef.current = setTimeout(tick, refreshIntervalMs);
    };

    tick();

    return () => {
      stopped = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [fetchEngine, refreshIntervalMs]);

  const safeAlerts = useMemo(() => alerts, [alerts]);

  return {
    data,
    loading,
    error,
    alerts: safeAlerts,
    refetch: fetchEngine,
  };
}

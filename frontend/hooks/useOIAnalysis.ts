/**
 * Advanced OI Analysis Hook — REST polling with smart caching
 * Polls /api/analysis/oi-analysis/{symbol} every 3 seconds
 */

import { useEffect, useState, useRef } from "react";
import { getEnvironmentConfig } from "@/lib/env-detection";

export interface OIAnalysisPrediction5m {
  direction: "UP" | "DOWN" | "FLAT";
  probability: number;
  context: string;
}

export interface OIAnalysisFactors {
  oi_trend_5m: string;
  oi_trend_15m: string;
  oi_change_pct_5m: number;
  oi_change_pct_15m: number;
  volume_ratio_5m: number;
  volume_ratio_15m: number;
  volume_spike_5m: boolean;
  volume_spike_15m: boolean;
  liquidity_sweep_buy_5m: boolean;
  liquidity_sweep_sell_5m: boolean;
  liquidity_sweep_buy_15m: boolean;
  liquidity_sweep_sell_15m: boolean;
  institutional_flow_5m: string;
  institutional_flow_15m: string;
  oi_velocity_5m: number;
  oi_acceleration_5m: number;
  price_breakout_5m: boolean;
  price_breakdown_5m: boolean;
  price_breakout_15m: boolean;
  price_breakdown_15m: boolean;
  trap_detected: boolean;
  trap_type: string;
}

export interface OIAnalysisData {
  symbol: string;
  signal: string;
  confidence: number;
  prediction_5m: OIAnalysisPrediction5m;
  factors: OIAnalysisFactors;
  reasons: string[];
  signal_5m: string;
  signal_15m: string;
  symbol_name: string;
  current_price: number;
  timestamp: string;
}

const OI_ANALYSIS_CACHE = new Map<string, { data: OIAnalysisData; timestamp: number }>();

export function useOIAnalysis(symbol: string) {
  const [data, setData] = useState<OIAnalysisData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const mountedRef = useRef(true);
  const fetchRef = useRef<(() => void) | null>(null);
  const dataRef = useRef<OIAnalysisData | null>(null);
  const lastSuccessRef = useRef<number>(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Instant cache
  useEffect(() => {
    const cached = OI_ANALYSIS_CACHE.get(symbol);
    if (cached && Date.now() - cached.timestamp < 5000) {
      setData(cached.data);
      dataRef.current = cached.data;
      setLoading(false);
      setError(null);
    }
  }, [symbol]);

  // Polling
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    let aborted = false;

    const config = getEnvironmentConfig();
    const apiBaseUrl = config.apiUrl.replace(/\/$/, "");

    const fetchData = async () => {
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/analysis/oi-analysis/${symbol}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (aborted) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const json = await response.json();
        if (aborted) return;

        const parsed: OIAnalysisData = {
          symbol: json.symbol ?? symbol,
          signal: json.signal ?? "NO_SIGNAL",
          confidence: json.confidence ?? 0,
          prediction_5m: json.prediction_5m ?? { direction: "FLAT", probability: 50, context: "" },
          factors: json.factors ?? {},
          reasons: json.reasons ?? [],
          signal_5m: json.signal_5m ?? "NO_SIGNAL",
          signal_15m: json.signal_15m ?? "NO_SIGNAL",
          symbol_name: json.symbol_name ?? symbol,
          current_price: json.current_price ?? 0,
          timestamp: json.timestamp ?? new Date().toISOString(),
        };

        OI_ANALYSIS_CACHE.set(symbol, { data: parsed, timestamp: Date.now() });

        if (mountedRef.current) {
          setData(parsed);
          dataRef.current = parsed;
          lastSuccessRef.current = Date.now();
          setLoading(false);
          setError(null);
          setIsLive(true);
        }
      } catch (err: any) {
        if (aborted) return;
        if (mountedRef.current) {
          // Only show error if we have no data at all
          if (!dataRef.current) {
            setError(err?.message ?? "Fetch error");
            setLoading(false);
          }
          // Mark stale if last success was > 15s ago
          if (lastSuccessRef.current > 0 && Date.now() - lastSuccessRef.current > 15000) {
            setIsLive(false);
          }
        }
      }
    };

    fetchRef.current = fetchData;
    fetchData();
    interval = setInterval(fetchData, 3000);

    return () => {
      aborted = true;
      if (interval) clearInterval(interval);
    };
  }, [symbol]);

  const refetch = () => fetchRef.current?.();

  return { data, loading, error, isLive, refetch };
}

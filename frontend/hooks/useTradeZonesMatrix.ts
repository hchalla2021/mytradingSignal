import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';

export type TradeZoneSignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL' | 'UNKNOWN';

export interface TradeZoneRow {
  symbol: string;
  current_price: number;
  zone_classification: string;
  signal_confidence: number;
  overall_signal: TradeZoneSignal;
  entry_quality: string;
  risk_reward_ratio: number;
  buy_confidence: number;
  sell_confidence: number;
  buy_volume_pct: number;
  sell_volume_pct: number;
  trend_structure: string;
  status: string;
  timestamp: string;
}

export interface TradeZoneEvent {
  id: string;
  symbol: string;
  fromSignal: TradeZoneSignal;
  toSignal: TradeZoneSignal;
  confidence: number;
  ts: string;
}

type TradeZonesSummary = {
  dominant_signal?: string;
  bullish_count?: number;
  bearish_count?: number;
  neutral_count?: number;
  avg_confidence?: number;
};

interface TradeZonesAllResponse {
  data: Record<string, TradeZoneRow>;
  summary?: TradeZonesSummary;
  timestamp: string;
}

interface UseTradeZonesMatrixResult {
  rows: TradeZoneRow[];
  events: TradeZoneEvent[];
  summary: TradeZonesSummary | undefined;
  loading: boolean;
  error: string | null;
  lastUpdate: string | null;
  refresh: () => Promise<void>;
}

const SIGNAL_RANK: Record<TradeZoneSignal, number> = {
  STRONG_BUY: 5,
  BUY: 4,
  NEUTRAL: 3,
  SELL: 2,
  STRONG_SELL: 1,
  UNKNOWN: 0,
};

function deriveSummary(rows: TradeZoneRow[]): TradeZonesSummary {
  let bullish = 0;
  let bearish = 0;
  let neutral = 0;
  let confTotal = 0;

  for (const row of rows) {
    const signal = normalizeSignal(row.overall_signal);
    if (signal === 'BUY' || signal === 'STRONG_BUY') bullish += 1;
    else if (signal === 'SELL' || signal === 'STRONG_SELL') bearish += 1;
    else neutral += 1;
    confTotal += Number.isFinite(row.signal_confidence) ? row.signal_confidence : 0;
  }

  const avgConfidence = rows.length > 0 ? Math.round(confTotal / rows.length) : 0;
  let dominant = 'NEUTRAL';
  if (bullish > bearish && bullish >= neutral) dominant = 'BULLISH';
  else if (bearish > bullish && bearish >= neutral) dominant = 'BEARISH';

  return {
    dominant_signal: dominant,
    bullish_count: bullish,
    bearish_count: bearish,
    neutral_count: neutral,
    avg_confidence: avgConfidence,
  };
}

function normalizeSignal(signal: string | undefined): TradeZoneSignal {
  const v = (signal ?? 'UNKNOWN').toUpperCase();
  if (v === 'WEAK_BUY') return 'BUY';
  if (v === 'WEAK_SELL') return 'SELL';
  if (v === 'STRONG_BUY' || v === 'BUY' || v === 'NEUTRAL' || v === 'SELL' || v === 'STRONG_SELL') {
    return v;
  }
  return 'UNKNOWN';
}

export function useTradeZonesMatrix(refreshMs = 2000): UseTradeZonesMatrixResult {
  const [rows, setRows] = useState<TradeZoneRow[]>([]);
  const [events, setEvents] = useState<TradeZoneEvent[]>([]);
  const [summary, setSummary] = useState<TradeZonesAllResponse['summary']>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);

  const prevSignalMapRef = useRef<Record<string, TradeZoneSignal>>({});
  const abortRef = useRef<AbortController | null>(null);

  const ingestSignalChanges = useCallback((nextRows: TradeZoneRow[]) => {
    const now = new Date().toISOString();
    const newEvents: TradeZoneEvent[] = [];

    for (const row of nextRows) {
      const nextSignal = normalizeSignal(row.overall_signal);
      const prevSignal = prevSignalMapRef.current[row.symbol];

      if (prevSignal && prevSignal !== nextSignal) {
        newEvents.push({
          id: `${row.symbol}-${now}-${nextSignal}`,
          symbol: row.symbol,
          fromSignal: prevSignal,
          toSignal: nextSignal,
          confidence: row.signal_confidence,
          ts: now,
        });
      }

      prevSignalMapRef.current[row.symbol] = nextSignal;
    }

    if (newEvents.length > 0) {
      setEvents((prev) => [...newEvents, ...prev].slice(0, 200));
    }
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const response = await fetch(`${API_CONFIG.baseUrl}/api/advanced/trade-zones/all`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Trade Zones API failed: ${response.status}`);
      }

      const payload = (await response.json()) as TradeZonesAllResponse;
      const list = Object.values(payload.data ?? {}).sort((a, b) => {
        return SIGNAL_RANK[normalizeSignal(b.overall_signal)] - SIGNAL_RANK[normalizeSignal(a.overall_signal)];
      });

      ingestSignalChanges(list);
      setRows(list);
      // Prefer live-derived summary so weak signals and mapping stay consistent in UI.
      setSummary(deriveSummary(list));
      setLastUpdate(payload.timestamp ?? new Date().toISOString());
      setError(null);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [ingestSignalChanges]);

  useEffect(() => {
    fetchAll();
    const timer = setInterval(fetchAll, refreshMs);

    return () => {
      clearInterval(timer);
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchAll, refreshMs]);

  return useMemo(
    () => ({ rows, events, summary, loading, error, lastUpdate, refresh: fetchAll }),
    [rows, events, summary, loading, error, lastUpdate, fetchAll],
  );
}

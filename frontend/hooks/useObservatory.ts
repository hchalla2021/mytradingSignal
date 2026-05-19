/**
 * useObservatory — Market Intelligence Observatory Data Hook
 * ==========================================================
 * Polls the backend observatory API for:
 *   - Today's strategy snapshot (every 60s)
 *   - Historical rankings & reports (every 5 min)
 *
 * Designed to be lightweight: only active while the component is mounted.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { API_CONFIG } from '@/lib/api-config';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StrategySignal {
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  detail: string;
  drivers?: string[];
  parameters?: Record<string, unknown>;
}

export interface TodaySnapshot {
  date: string;
  market_open: boolean;
  open_prices: Record<string, number>;
  snapshot_count: Record<string, number>;
  /** Latest strategies per symbol */
  current_strategies: Record<string, Record<string, StrategySignal>>;
  all_snapshots: Record<string, Array<{
    time: string;
    timestamp: string;
    strategies: Record<string, StrategySignal>;
  }>>;
}

export interface StrategyPerformance {
  strategy_name: string;
  morning_signal: string;
  morning_confidence: number;
  morning_detail?: string;
  morning_drivers?: string[];
  morning_parameters?: Record<string, unknown>;
  closing_signal?: string;
  closing_confidence?: number;
  closing_detail?: string;
  closing_drivers?: string[];
  closing_parameters?: Record<string, unknown>;
  priority_weight?: number;
  priority_band?: 'HIGH' | 'MEDIUM' | 'LOW';
  actual_direction: string;
  was_correct: boolean | null;
}

export interface DailyReport {
  date: string;
  generated_at: string;
  symbols: Record<string, {
    open_price: number;
    close_price: number;
    change_pct: number;
    direction: 'UP' | 'DOWN' | 'FLAT';
    day_classification?: string;
    snapshot_count: number;
    strategy_performance: Record<string, StrategyPerformance>;
  }>;
}

export interface StrategyRanking {
  strategy_key: string;
  strategy_name: string;
  category?: string;
  icon?: string;
  priority?: number;
  priority_band?: 'HIGH' | 'MEDIUM' | 'LOW';
  accuracy: number;
  weighted_accuracy?: number;
  correct: number;
  total: number;
  streak?: number;
  avg_confidence?: number;
}

export interface RankingsData {
  days_analyzed: number;
  rankings: StrategyRanking[];
  best_strategy: StrategyRanking | null;
  recommendation: string;
}

export interface ObservatoryState {
  todaySnapshot: TodaySnapshot | null;
  historicalReports: DailyReport[];
  rankings: RankingsData | null;
  availableDates: string[];
  loading: boolean;
  error: string | null;
  lastRefreshed: Date | null;
  reportDays: number;
  setReportDays: (days: number) => void;
  refresh: () => void;
}

function buildObservatoryUrls(path: string): string[] {
  const endpoint = API_CONFIG.endpoint(path);
  const local8000 = `http://localhost:8000${path}`;
  const local127 = `http://127.0.0.1:8000${path}`;
  const isLocal = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  const urls = isLocal
    ? [local8000, local127, endpoint]
    : [endpoint, local8000, local127];

  // Keep order but remove duplicates.
  return Array.from(new Set(urls));
}

async function fetchJsonWithFallback(path: string): Promise<any> {
  const urls = buildObservatoryUrls(path);
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      return await res.json();
    } catch {
      // Try next candidate URL.
    }
  }
  return null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useObservatory(): ObservatoryState {
  const [todaySnapshot, setTodaySnapshot] = useState<TodaySnapshot | null>(null);
  const [historicalReports, setHistoricalReports] = useState<DailyReport[]>([]);
  const [rankings, setRankings] = useState<RankingsData | null>(null);
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [reportDays, setReportDays] = useState(10);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchSnapshot = useCallback(async () => {
    try {
      const json = await fetchJsonWithFallback('/api/observatory/snapshot');
      if (json && json.success && json.data) {
        setTodaySnapshot(json.data);
        setLastRefreshed(new Date());
      }
    } catch {
      // silently keep last known state
    }
  }, []);

  const fetchReports = useCallback(async (days: number) => {
    try {
      const [reportsJson, rankingsJson, datesJson] = await Promise.all([
        fetchJsonWithFallback(`/api/observatory/report?days=${days}`),
        fetchJsonWithFallback(`/api/observatory/rankings?days=${days}`),
        fetchJsonWithFallback('/api/observatory/dates'),
      ]);

      if (reportsJson?.success) {
        setHistoricalReports(reportsJson.reports || []);
      }
      if (rankingsJson?.success) {
        setRankings(rankingsJson.data);
      }
      if (datesJson?.success) {
        setAvailableDates(datesJson.dates || []);
      }
    } catch {
      // silently keep last known state
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchSnapshot(), fetchReports(reportDays)]);
    } catch (err) {
      setError('Failed to load observatory data. Check backend at http://localhost:8000.');
    } finally {
      setLoading(false);
    }
  }, [fetchSnapshot, fetchReports, reportDays]);

  const reportDaysRef = useRef(reportDays);
  useEffect(() => { reportDaysRef.current = reportDays; }, [reportDays]);

  // Initial load + periodic refresh
  useEffect(() => {
    refresh();

    // Snapshot refreshes every 60 seconds
    snapshotTimerRef.current = setInterval(fetchSnapshot, 60_000);
    // Rankings/reports refresh every 5 minutes (read latest reportDays via ref)
    reportTimerRef.current = setInterval(() => fetchReports(reportDaysRef.current), 300_000);

    return () => {
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
      if (reportTimerRef.current) clearInterval(reportTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch reports when reportDays changes
  useEffect(() => {
    fetchReports(reportDays);
  }, [reportDays, fetchReports]);

  return {
    todaySnapshot,
    historicalReports,
    rankings,
    availableDates,
    loading,
    error,
    lastRefreshed,
    reportDays,
    setReportDays,
    refresh,
  };
}

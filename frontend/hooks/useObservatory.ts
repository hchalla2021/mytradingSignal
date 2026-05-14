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
      const res = await fetch(API_CONFIG.endpoint('/api/observatory/snapshot'), { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data) {
        setTodaySnapshot(json.data);
        setLastRefreshed(new Date());
      }
    } catch {
      // silently keep last known state
    }
  }, []);

  const fetchReports = useCallback(async (days: number) => {
    try {
      const [reportRes, rankRes, datesRes] = await Promise.all([
        fetch(API_CONFIG.endpoint(`/api/observatory/report?days=${days}`), { cache: 'no-store' }),
        fetch(API_CONFIG.endpoint(`/api/observatory/rankings?days=${days}`), { cache: 'no-store' }),
        fetch(API_CONFIG.endpoint('/api/observatory/dates'), { cache: 'no-store' }),
      ]);

      if (reportRes.ok) {
        const rj = await reportRes.json();
        if (rj.success) setHistoricalReports(rj.reports || []);
      }
      if (rankRes.ok) {
        const rkj = await rankRes.json();
        if (rkj.success) setRankings(rkj.data);
      }
      if (datesRes.ok) {
        const dj = await datesRes.json();
        if (dj.success) setAvailableDates(dj.dates || []);
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
      setError('Failed to load observatory data');
    } finally {
      setLoading(false);
    }
  }, [fetchSnapshot, fetchReports, reportDays]);

  // Initial load + periodic refresh
  useEffect(() => {
    refresh();

    // Snapshot refreshes every 60 seconds
    snapshotTimerRef.current = setInterval(fetchSnapshot, 60_000);
    // Rankings/reports refresh every 5 minutes
    reportTimerRef.current = setInterval(() => fetchReports(reportDays), 300_000);

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

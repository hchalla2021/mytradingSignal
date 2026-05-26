'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface FIIDIIRow {
  category: 'FII' | 'DII';
  date: string;
  buyValueCr: number;
  sellValueCr: number;
  netValueCr: number;
  // Derived (added by backend, all from same live NSE feed)
  grossTurnoverCr?: number;
  buySellRatio?: number;
  skew?: number;
}

export type FIIDIIBias =
  | 'bullish-domestic'
  | 'bullish-foreign'
  | 'bullish'
  | 'bearish'
  | 'neutral';

export interface FIIDIIRegime {
  label: 'DOMESTIC_LED' | 'FOREIGN_LED' | 'BOTH_BUYING' | 'BOTH_SELLING' | 'MIXED';
  bias: FIIDIIBias;
  note: string;
  netTotalCr: number;
  confidence: number;
}

export interface FIIDIIDominance {
  side: 'FII' | 'DII' | 'NONE';
  shareOfNet: number;
}

export interface FIIDIITrend {
  days: number;
  fiiCum5dCr: number;
  diiCum5dCr: number;
  netCum5dCr: number;
  fiiDayChangeCr: number;
  diiDayChangeCr: number;
  fiiStreakDays: number;
  diiStreakDays: number;
  fiiTrend: 'accumulating' | 'distributing' | 'flat';
  diiTrend: 'accumulating' | 'distributing' | 'flat';
}

export interface FIIDIIHistoryPoint {
  tradeDate: string;
  fiiNetCr: number;
  diiNetCr: number;
  netCr: number;
  fiiGrossCr: number;
  diiGrossCr: number;
}

export type FIIDIIPublishStatus =
  | 'TODAY_LIVE'
  | 'AWAITING_TODAY'
  | 'PRIOR_FINAL';

export interface FIIDIIPublish {
  status: FIIDIIPublishStatus;
  label: string;
  note: string;
  isToday: boolean;
  inPublishWindow: boolean;
  nextUpdateAt: string;
}

export interface FIIDIISnapshot {
  success: boolean;
  source: string;        // 'NSE'
  endpoint?: string;
  fetchedAt: string;
  tradeDate?: string;
  publish?: FIIDIIPublish;
  fii: FIIDIIRow | null;
  dii: FIIDIIRow | null;
  netInstitutionalCr?: number;
  grossTurnoverCr?: number;
  dominance?: FIIDIIDominance;
  absorptionPct?: number;
  regime: FIIDIIRegime | null;
  trend?: FIIDIITrend;
  history?: FIIDIIHistoryPoint[];
  fromCache?: boolean;
  error?: string;
  message?: string;
}

/* ── URL helpers ───────────────────────────────────────────────────────── */

function buildHttpUrl(force = false): string {
  const base = (API_CONFIG.baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/fii-dii${force ? '?force=1' : ''}`;
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

const REFRESH_DEFAULT_MS = 5 * 60 * 1000;       // 5 min normal poll
const REFRESH_PUBLISH_MS = 60 * 1000;           // 1 min while NSE publish window open
const REFRESH_LIVE_MS = 90 * 1000;              // 90 s when today's number is already live
const RETRY_ON_ERROR_MS = 60 * 1000;            // 1 min on failure
const FOCUS_REFRESH_COOLDOWN_MS = 30 * 1000;    // de-dupe focus refreshes

export function useFIIDIIFlow() {
  const [data, setData] = useState<FIIDIISnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);
  const lastFetchMsRef = useRef(0);

  const fetchOnce = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const res = await fetch(buildHttpUrl(force), { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as FIIDIISnapshot;
      if (closedRef.current) return;
      setData(json);
      setError(json.success ? null : (json.message || json.error || 'Unknown error'));
      lastFetchMsRef.current = Date.now();
    } catch (e) {
      if (closedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // Decide poll interval from latest snapshot's publish status.
  const nextDelayMs = useCallback((): number => {
    if (error) return RETRY_ON_ERROR_MS;
    const pub = data?.publish;
    if (pub?.inPublishWindow) return REFRESH_PUBLISH_MS;
    if (pub?.isToday) return REFRESH_LIVE_MS;
    return REFRESH_DEFAULT_MS;
  }, [data, error]);

  useEffect(() => {
    closedRef.current = false;
    fetchOnce(false);

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        await fetchOnce(false);
        schedule();
      }, nextDelayMs());
    };
    schedule();

    // Refresh when tab regains focus / becomes visible (debounced).
    const onFocus = () => {
      if (Date.now() - lastFetchMsRef.current < FOCUS_REFRESH_COOLDOWN_MS) return;
      fetchOnce(false);
    };
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        onFocus();
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onVisibility);
    }

    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', onFocus);
        document.removeEventListener('visibilitychange', onVisibility);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOnce, nextDelayMs]);

  return {
    data,
    isLoading,
    error,
    refresh: () => fetchOnce(true),
  };
}

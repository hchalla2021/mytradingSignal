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

export interface FIIDIISnapshot {
  success: boolean;
  source: string;        // 'NSE'
  endpoint?: string;
  fetchedAt: string;
  tradeDate?: string;
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

const REFRESH_MS = 5 * 60 * 1000;        // 5 min poll
const RETRY_ON_ERROR_MS = 60 * 1000;     // 1 min on failure

export function useFIIDIIFlow() {
  const [data, setData] = useState<FIIDIISnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

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
    } catch (e) {
      if (closedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    closedRef.current = false;
    fetchOnce(false);

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      const ms = error ? RETRY_ON_ERROR_MS : REFRESH_MS;
      timerRef.current = setTimeout(async () => {
        await fetchOnce(false);
        schedule();
      }, ms);
    };
    schedule();

    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchOnce]);

  return {
    data,
    isLoading,
    error,
    refresh: () => fetchOnce(true),
  };
}

/**
 * India VIX Hook — live feed only, no dummy data.
 *
 * Polls /api/vix at adaptive intervals:
 *   • 5 s when market is LIVE  (dynamic updates)
 *   • 30 s when CLOSED / CACHED (save resources)
 *
 * On error or no data the value stays null so the badge shows "VIX —".
 */

'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

export interface VIXData {
  value: number | null;
  change: number;
  changePercent: number;
  timestamp: string;
  status: 'LIVE' | 'CLOSED' | 'CACHED' | 'NO_DATA' | 'ERROR' | string;
  volatilityLevel: 'LOW' | 'NORMAL' | 'HIGH' | 'EXTREME' | 'UNKNOWN';
  marketFearScore: number;
  high?: number;
  low?: number;
  open?: number;
  close?: number;
  error?: string;
}

interface UseVIXOptions {
  enabled?: boolean;
}

const EMPTY: VIXData = {
  value: null,
  change: 0,
  changePercent: 0,
  timestamp: '',
  status: 'NO_DATA',
  volatilityLevel: 'UNKNOWN',
  marketFearScore: 0,
};

/** 5 s when LIVE, 30 s otherwise */
function intervalForStatus(status: string): number {
  return status === 'LIVE' ? 5_000 : 30_000;
}

export function useIndiaVIX(options: UseVIXOptions = {}) {
  const { enabled = true } = options;

  const [vixData, setVixData] = useState<VIXData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const fetchVIX = useCallback(async () => {
    if (!enabled) return;
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const res = await fetch(`${apiUrl}/api/vix`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VIXData = await res.json();
      if (!mountedRef.current) return;

      setVixData(data);
      setError(null);
      setLoading(false);

      // Schedule next poll based on market status
      timerRef.current = setTimeout(fetchVIX, intervalForStatus(data.status));
    } catch (err) {
      if (!mountedRef.current) return;
      const e = err instanceof Error ? err : new Error(String(err));
      setError(e);
      setLoading(false);
      // Retry in 10 s on error
      timerRef.current = setTimeout(fetchVIX, 10_000);
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) fetchVIX();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [enabled, fetchVIX]);

  return useMemo(
    () => ({ vixData, loading, error, refetch: fetchVIX }),
    [vixData, loading, error, fetchVIX],
  );
}

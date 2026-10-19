'use client';

import { useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import type { ChartSymbol, Timeframe } from '@/lib/chart-workspace';
import type { ChartPaperTrade } from '@/lib/chart-paper-overlay';

interface ChartPaperSnapshot {
  symbol: string;
  timeframe: number;
  day: string;
  trades: ChartPaperTrade[];
  pending_count: number;
  quote: { price: number; at: string } | null;
  health: { running: boolean; error: string | null };
}

export function useChartPaperTrading(symbol: ChartSymbol, timeframe: Timeframe, day: string) {
  const [snapshot, setSnapshot] = useState<ChartPaperSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${symbol}:${timeframe}:${day}`;
  const [loadedKey, setLoadedKey] = useState('');
  useEffect(() => {
    if (typeof timeframe !== 'number') return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const params = new URLSearchParams({ symbol, timeframe: String(timeframe), day });
        const response = await fetch(API_CONFIG.endpoint(`/api/paper-trading/chart?${params}`), {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Paper chart synchronization failed (${response.status})`);
        const data: ChartPaperSnapshot = await response.json();
        if (controller.signal.aborted) return;
        setSnapshot(data); setLoadedKey(key); setError(null);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Paper chart synchronization failed');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 1000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [symbol, timeframe, day, key]);
  return { snapshot: loadedKey === key ? snapshot : null, error };
}

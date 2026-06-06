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

export interface FIIDIIFnOBreakdown {
  indexFuturesCr: number;
  indexOptionsCr: number;
  stockFuturesCr: number;
  stockOptionsCr: number;
  totalFnOCr: number;
  stance: {
    indexFutures: 'bullish' | 'bearish' | 'neutral';
    indexOptions: 'bullish' | 'bearish' | 'neutral';
    stockFutures: 'bullish' | 'bearish' | 'neutral';
    stockOptions: 'bullish' | 'bearish' | 'neutral';
    overall: 'bullish' | 'bearish' | 'neutral';
  };
}

export interface FIIDIIMarketContext {
  niftyClose: number;
  niftyPrevClose: number;
  niftyChange: number;
  niftyChangePct: number;
  sensexClose: number;
  sensexPrevClose: number;
  sensexChange: number;
  sensexChangePct: number;
}

export interface FIIDIIRealtimeAggregate {
  fiiScore: number;
  diiScore: number;
  aggregateScore: number;
  confidence: number;
  signal: string;
  inflowCr: number;
  outflowCr: number;
  netCr: number;
  grossCr: number;
  note?: string;
}

export interface FIIDIIRealtimeSnapshot {
  generatedAt: string;
  aggregate: FIIDIIRealtimeAggregate;
  indices?: Record<string, unknown>;
  models?: Record<string, boolean>;
}

export interface FIIDIISnapshot {
  success: boolean;
  source: string;        // 'Moneycontrol'
  endpoint?: string;
  fetchedAt: string;
  // Freshness, provided by backend; recomputed on every response (incl. cache hits)
  dataAgeSec?: number;
  nextRefreshAt?: string;
  nextRefreshInSec?: number;
  recommendedPollSec?: number;
  staleness?: 'fresh' | 'recent' | 'stale';
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
  fiiFnO?: FIIDIIFnOBreakdown;
  marketContext?: FIIDIIMarketContext;
  realtime?: FIIDIIRealtimeSnapshot;
  fromCache?: boolean;
  error?: string;
  message?: string;
}

/* ── URL helpers ───────────────────────────────────────────────────────── */

function buildHttpUrl(force = false): string {
  const base = (API_CONFIG.baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/fii-dii${force ? '?force=1' : ''}`;
}

function buildWsUrl(): string {
  const fromApi = (API_CONFIG.baseUrl || '').replace(/\/+$/, '');
  if (fromApi) {
    try {
      const u = new URL(fromApi);
      u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
      u.pathname = '/ws/fii-dii';
      u.search = '';
      return u.toString();
    } catch {
      // fall through to wsUrl handling
    }
  }

  const wsBase = (API_CONFIG.wsUrl || '').replace(/\/+$/, '');
  if (!wsBase) return '';
  try {
    const u = new URL(wsBase);
    u.pathname = '/ws/fii-dii';
    u.search = '';
    return u.toString();
  } catch {
    return '';
  }
}

/* ── Hook ──────────────────────────────────────────────────────────────── */

const REFRESH_FALLBACK_MS = 5 * 60 * 1000;      // used when server omits recommendedPollSec
const REFRESH_MIN_MS = 15 * 1000;               // safety floor — never thrash the API
const REFRESH_MAX_MS = 30 * 60 * 1000;          // safety ceiling
const RETRY_ON_ERROR_MS = 60 * 1000;            // 1 min on failure
const FOCUS_REFRESH_COOLDOWN_MS = 30 * 1000;    // de-dupe focus refreshes
const WS_RECONNECT_MS = 5000;

export function useFIIDIIFlow() {
  const [data, setData] = useState<FIIDIISnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secsSinceFetch, setSecsSinceFetch] = useState(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      setSecsSinceFetch(json.dataAgeSec ?? 0);
    } catch (e) {
      if (closedRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  // Trust the backend's recommendedPollSec (it knows the publish window).
  const nextDelayMs = useCallback((): number => {
    if (error) return RETRY_ON_ERROR_MS;
    const rec = data?.recommendedPollSec;
    if (typeof rec === 'number' && rec > 0) {
      return Math.max(REFRESH_MIN_MS, Math.min(REFRESH_MAX_MS, rec * 1000));
    }
    return REFRESH_FALLBACK_MS;
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

  // 1-Hz freshness counter so the UI can show "AS OF HH:MM · +Ns" / countdown.
  useEffect(() => {
    if (!data?.fetchedAt) return;
    const base = Date.parse(data.fetchedAt);
    if (Number.isNaN(base)) return;
    const tick = () => setSecsSinceFetch(Math.max(0, Math.floor((Date.now() - base) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [data?.fetchedAt]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    closedRef.current = false;

    const connect = () => {
      if (closedRef.current) return;
      const url = buildWsUrl();
      if (!url) return;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onmessage = (ev) => {
          let msg: unknown;
          try {
            msg = JSON.parse(ev.data);
          } catch {
            return;
          }
          if (!msg || typeof msg !== 'object') return;

          const packet = msg as {
            type?: string;
            data?: {
              official?: FIIDIISnapshot;
              realtime?: FIIDIIRealtimeSnapshot;
            } | FIIDIIRealtimeSnapshot | FIIDIISnapshot;
          };

          if (packet.type === 'fii_dii_snapshot' && packet.data && typeof packet.data === 'object') {
            const base = packet.data as { official?: FIIDIISnapshot; realtime?: FIIDIIRealtimeSnapshot };
            if (base.official) {
              setData({
                ...base.official,
                realtime: base.realtime ?? base.official.realtime,
              });
              setError(base.official.success ? null : (base.official.message || base.official.error || 'Unknown error'));
              return;
            }
          }

          if (packet.type === 'fii_dii_official_update' && packet.data && typeof packet.data === 'object') {
            const official = packet.data as FIIDIISnapshot;
            setData((prev) => ({
              ...(prev || {}),
              ...official,
              realtime: official.realtime ?? prev?.realtime,
            } as FIIDIISnapshot));
            setError(official.success ? null : (official.message || official.error || 'Unknown error'));
            return;
          }

          if (packet.type === 'fii_dii_realtime_update' && packet.data && typeof packet.data === 'object') {
            const realtime = packet.data as FIIDIIRealtimeSnapshot;
            setData((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                realtime,
              };
            });
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          if (closedRef.current) return;
          wsRetryRef.current = setTimeout(connect, WS_RECONNECT_MS);
        };

        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            // no-op
          }
        };
      } catch {
        wsRetryRef.current = setTimeout(connect, WS_RECONNECT_MS);
      }
    };

    connect();

    return () => {
      closedRef.current = true;
      if (wsRetryRef.current) clearTimeout(wsRetryRef.current);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          // no-op
        }
      }
    };
  }, []);

  return {
    data,
    isLoading,
    error,
    secsSinceFetch,
    refresh: () => fetchOnce(true),
  };
}

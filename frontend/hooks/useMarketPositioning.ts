/**
 * useMarketPositioning — Market Positioning Intelligence Hook
 *
 * ✅ Isolated: own polling loop, own cache, zero coupling to other hooks
 * ✅ Performance: in-memory rolling history for 5-min prediction display
 * ✅ Config-driven: all URLs / intervals from .env.local
 * ✅ Dynamic: updates every NEXT_PUBLIC_POSITIONING_INTERVAL ms (default 5 s)
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PositioningClassification {
  type: string;         // LONG_BUILDUP | SHORT_BUILDUP | SHORT_COVERING | LONG_UNWINDING | MIXED_* | NEUTRAL
  label: string;        // Human-readable label
  signal: string;       // STRONG_BUY | BUY | SELL | STRONG_SELL | NEUTRAL
  trend: string;        // Strong Up / Weak Up / Strong Down / Weak Down / —
  description: string;  // Explanation sentence
}

export interface PositioningPrediction {
  signal: string;
  label: string;
  confidence: number;
  trend: string;
  reason: string;
  /** ₹ pts moved across the tick window (e.g. −12.5) — NOT a percentage */
  price_velocity: number;
  /** % vs session rolling avg (≈0 when QUOTE_VOLUMES static — FE overrides with EMA) */
  vol_velocity: number;
  /** Signed tick-flow: −100 to +100 (% of recent ticks in signal direction) */
  tick_flow_pct: number;
}

export interface SymbolPositioning {
  symbol: string;
  price: number;
  change_pct: number;
  volume: number;
  oi: number;
  positioning: PositioningClassification;
  confidence: number;         // 0-100
  signal: string;             // STRONG_BUY | BUY | SELL | STRONG_SELL | NEUTRAL
  changes: {
    price: number;            // daily % from prev close (same as header)
    price_tick: number;       // ₹ tick-to-tick velocity (pts per 5s poll)
    volume: number;           // % above/below session rolling average
    oi: number;               // tick-to-tick % change of total F&O OI
    tick_flow: number;        // 0-100 — % of recent ticks in signal direction
  };
  prediction: PositioningPrediction;   // 5-min ahead prediction
  timestamp: string;
  market_status: string;
  is_live?: boolean;
}

export interface MarketPositioningData {
  NIFTY: SymbolPositioning | null;
  BANKNIFTY: SymbolPositioning | null;
  SENSEX: SymbolPositioning | null;
}

// ─── Config from env ─────────────────────────────────────────────────────────

const API_BASE    = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ENDPOINT    = `${API_BASE}/api/market-positioning`;
const INTERVAL_MS = parseInt(process.env.NEXT_PUBLIC_POSITIONING_INTERVAL || "5000", 10);

// ─── Module-level instant cache (zero delay on mount) ─────────────────────

let _latestData: MarketPositioningData = { NIFTY: null, BANKNIFTY: null, SENSEX: null };
type Listener = (d: MarketPositioningData) => void;
const _listeners = new Set<Listener>();

function _notify(data: MarketPositioningData) {
  _latestData = data;
  _listeners.forEach(fn => fn(data));
}

// ─── Singleton polling manager ───────────────────────────────────────────────

let _timerRef: ReturnType<typeof setInterval> | null = null;
let _pollingInstances = 0;

async function _fetchAndNotify() {
  try {
    const controller = new AbortController();
    const timeoutId  = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(ENDPOINT, {
      signal: controller.signal,
      cache:  "no-store",
      headers: { "Cache-Control": "no-cache" },
    });
    clearTimeout(timeoutId);
    if (!res.ok) return;
    const json: Record<string, SymbolPositioning> = await res.json();
    _notify({
      NIFTY:      json.NIFTY      ? { ...json.NIFTY,      is_live: true } : null,
      BANKNIFTY:  json.BANKNIFTY  ? { ...json.BANKNIFTY,  is_live: true } : null,
      SENSEX:     json.SENSEX     ? { ...json.SENSEX,     is_live: true } : null,
    });
  } catch {
    // silent — network errors are transient, don't crash the UI
  }
}

function _startPolling() {
  if (_timerRef) return;
  _fetchAndNotify(); // immediate first fetch
  _timerRef = setInterval(_fetchAndNotify, INTERVAL_MS);
}

function _stopPolling() {
  if (_timerRef) {
    clearInterval(_timerRef);
    _timerRef = null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useMarketPositioning() {
  const [data, setData]       = useState<MarketPositioningData>(_latestData);
  const [loading, setLoading] = useState(_latestData.NIFTY === null);
  const [error, setError]     = useState<string | null>(null);
  const mountedRef             = useRef(true);

  const handleUpdate = useCallback((updated: MarketPositioningData) => {
    if (!mountedRef.current) return;
    setData(updated);
    setLoading(false);
    setError(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    _pollingInstances++;
    _listeners.add(handleUpdate);

    // If we already have cached data render it instantly
    if (_latestData.NIFTY !== null) {
      setData(_latestData);
      setLoading(false);
    }

    _startPolling();

    return () => {
      mountedRef.current = false;
      _listeners.delete(handleUpdate);
      _pollingInstances--;
      // Stop polling only when ALL instances unmount
      if (_pollingInstances <= 0) {
        _pollingInstances = 0;
        _stopPolling();
      }
    };
  }, [handleUpdate]);

  /** Manual refresh */
  const refresh = useCallback(() => {
    setLoading(true);
    _fetchAndNotify();
  }, []);

  return { data, loading, error, refresh };
}

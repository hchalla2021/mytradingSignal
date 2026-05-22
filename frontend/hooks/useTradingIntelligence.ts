'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';

/* ── Types ──────────────────────────────────────────────────────────────── */

export type TIESymbol = 'NIFTY' | 'BANKNIFTY' | 'SENSEX';
export type TIESignal = 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
export type TIEBias = 'Buy' | 'Sell' | 'Neutral';

export interface TIETile {
  value: number;
  bias: TIEBias;
}

export type TIEStructure = 'BOS_UP' | 'BOS_DOWN' | 'CHoCH_UP' | 'CHoCH_DOWN' | 'RANGE';
export type TIEAlertTone = 'bull' | 'bear' | 'warn' | 'info';

export interface TIEAlert {
  kind: string;
  tone: TIEAlertTone;
  text: string;
}

export interface TIEIntelligence {
  liquidityTrap: number;
  fakeBreakout: number;
  stopHunt: number;
  volumeSpike: number;
  institutional: number;
  oiIntensity: number;
  structure: TIEStructure;
  swingHigh: number;
  swingLow: number;
  alerts: TIEAlert[];
}

export interface TIEData {
  symbol: TIESymbol;
  price: number;
  change: number;
  changePercent: number;
  signal: TIESignal;
  signalStrength: number;
  confidence: number;
  probabilities: Record<TIESignal, number>;
  lstmReturnPred: number;
  bullishProbability: number;
  flowProbability: number;
  tiles: Record<'DELTA' | 'GAMMA' | 'VEGA' | 'THETA' | 'RHO' | 'VANNA', TIETile>;
  intelligence?: TIEIntelligence;
  sparkline: number[];
  engines: { numpy: boolean; lightgbm: boolean; pytorchLSTM: boolean; tensorflow: boolean };
  latencyMs: number;
  timestamp: string | number;
  status: 'LIVE' | 'CLOSED' | 'OFFLINE' | 'PRE_OPEN' | 'FREEZE' | 'DEMO';
  trend?: string;
}

export type TIESnapshot = Partial<Record<TIESymbol, TIEData>>;

interface WSMessage {
  type: 'intelligence_snapshot' | 'intelligence_update' | 'intelligence_heartbeat' | 'pong';
  data?: TIESnapshot;
  timestamp?: string | number;
}

/* ── URL helpers ────────────────────────────────────────────────────────── */

function buildWsUrl(): string {
  const base = (API_CONFIG.wsUrl || '').replace(/\/+$/, '');
  if (!base) return '';
  if (base.includes('/ws')) {
    return base.replace(/\/ws(\/[^?#]*)?$/, '/ws/intelligence');
  }
  return `${base}/ws/intelligence`;
}

function buildHttpUrl(): string {
  const base = (API_CONFIG.baseUrl || '').replace(/\/+$/, '');
  return `${base}/api/intelligence`;
}

/* ── Hook ───────────────────────────────────────────────────────────────── */

export function useTradingIntelligence() {
  const [data, setData] = useState<TIESnapshot>({});
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backoffRef = useRef(2000);
  const closedRef = useRef(false);

  const apply = useCallback((snap: TIESnapshot | undefined) => {
    if (!snap) return;
    setData(prev => {
      const next = { ...prev };
      (Object.keys(snap) as TIESymbol[]).forEach(k => {
        const incoming = snap[k];
        if (incoming) next[k] = incoming;
      });
      return next;
    });
    setLastUpdate(Date.now());
  }, []);

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(buildHttpUrl(), { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      if (json?.success && json.data) apply(json.data as TIESnapshot);
    } catch {
      /* ignore */
    }
  }, [apply]);

  const connect = useCallback(() => {
    if (closedRef.current) return;
    const url = buildWsUrl();
    if (!url) return;
    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        backoffRef.current = 2000;
        if (pingRef.current) clearInterval(pingRef.current);
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* noop */ }
          }
        }, 25000);
      };

      ws.onmessage = (ev) => {
        try {
          const msg: WSMessage = JSON.parse(ev.data);
          if (msg.type === 'intelligence_snapshot' || msg.type === 'intelligence_update') {
            apply(msg.data);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => { /* trigger onclose */ };

      ws.onclose = () => {
        setIsConnected(false);
        if (pingRef.current) { clearInterval(pingRef.current); pingRef.current = null; }
        if (closedRef.current) return;
        const delay = backoffRef.current;
        backoffRef.current = Math.min(30000, Math.round(delay * 1.5));
        reconnectRef.current = setTimeout(connect, delay);
      };
    } catch {
      setIsConnected(false);
      reconnectRef.current = setTimeout(connect, 5000);
    }
  }, [apply]);

  useEffect(() => {
    closedRef.current = false;
    fetchSnapshot();
    connect();
    return () => {
      closedRef.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (pingRef.current) clearInterval(pingRef.current);
      const ws = wsRef.current;
      if (ws) {
        try { ws.close(); } catch { /* noop */ }
      }
    };
  }, [connect, fetchSnapshot]);

  return { data, isConnected, lastUpdate, refresh: fetchSnapshot };
}

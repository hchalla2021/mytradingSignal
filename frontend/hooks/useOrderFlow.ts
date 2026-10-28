'use client';

import { useEffect, useState } from 'react';
import { API_CONFIG } from '@/lib/api-config';
import { isOrderFlowInterval, mergeOrderFlowUpdate, parseOrderFlow, type OrderFlowSnapshot } from '@/lib/order-flow';

export interface OrderFlowState {
  key: string;
  snapshot: OrderFlowSnapshot | null;
  error: string | null;
  live: boolean;
}

const orderFlowWsUrl = () => {
  const base = API_CONFIG.wsUrl || 'ws://localhost:8000/ws/market';
  return base.replace(/\/ws\/market\/?$/, '').replace(/\/$/, '') + '/ws/order-flow';
};

/**
 * Live order flow for a futures symbol: REST snapshot first (fast paint), then a WebSocket stream
 * that only sends the last bars + refreshed session analytics. Disabled for non-intraday intervals.
 * `token` restricts the view to one contract; the server records the near-month contract only.
 */
export function useOrderFlow(symbol: string, interval: unknown, token?: number | null, enabled = true, latestRecorded = false): OrderFlowState {
  const active = enabled && isOrderFlowInterval(interval);
  const key = active ? `${symbol}:${String(interval)}:${token ?? ''}:${latestRecorded ? 'L' : ''}` : '';
  const [state, setState] = useState<OrderFlowState>({ key: '', snapshot: null, error: null, live: false });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let attempts = 0;
    let streamRevision = 0;
    let streamDate: string | null = null;
    let recordedElsewhere = false;
    const controller = new AbortController();
    const params = new URLSearchParams({ symbol, interval: String(interval) });
    if (token) params.set('token', String(token));
    // Display-only: before today's recording starts, show the last recorded session (flagged latestRecorded).
    if (latestRecorded) params.set('latest', '1');

    const loadSnapshot = async () => {
      const revision = streamRevision;
      try {
        const response = await fetch(API_CONFIG.endpoint(`/api/order-flow/snapshot?${params}`), {
          signal: controller.signal, credentials: 'include',
        });
        const snapshot = parseOrderFlow(await response.json());
        if (!response.ok || !snapshot) throw new Error(`Order flow unavailable (${response.status}).`);
        if (cancelled) return null;
        if (revision !== streamRevision) return snapshot;
        streamDate = snapshot.date;
        setState(previous => ({ key, snapshot, error: null, live: previous.key === key && previous.live }));
        return snapshot;
      } catch (error) {
        if (!cancelled && !controller.signal.aborted && revision === streamRevision) {
          setState(previous => ({ ...(previous.key === key ? previous : { snapshot: null, live: false }), key,
            error: error instanceof Error ? error.message : 'Order flow unavailable.' }));
        }
        return null;
      }
    };

    const connect = () => {
      if (cancelled) return;
      socket = new WebSocket(`${orderFlowWsUrl()}?${params}`);
      socket.onopen = () => {
        attempts = 0;
        pingTimer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send('ping'); }, 25_000);
      };
      socket.onmessage = event => {
        let message: unknown;
        try { message = JSON.parse(String(event.data)); } catch { return; }
        if (typeof message !== 'object' || message === null || !('type' in message) || !('data' in message)) return;
        const incoming = parseOrderFlow(message.data);
        if (!incoming || cancelled) return;
        if (message.type !== 'snapshot' && message.type !== 'update') return;
        if (message.type === 'update' && streamDate !== null && streamDate !== incoming.date) {
          void loadSnapshot();
          return;
        }
        streamRevision++;
        streamDate = incoming.date;
        recordedElsewhere = incoming.recordedToken != null;
        setState(previous => {
          const prior = previous.key === key ? previous.snapshot : null;
          const snapshot = message.type === 'snapshot' ? incoming : mergeOrderFlowUpdate(prior, incoming);
          return { key, snapshot, error: null, live: !recordedElsewhere };
        });
      };
      socket.onclose = () => {
        clearInterval(pingTimer);
        if (cancelled || recordedElsewhere) return;
        setState(previous => previous.key === key ? { ...previous, live: false } : previous);
        retryTimer = setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts++));
      };
      socket.onerror = () => socket?.close();
    };

    connect();
    void loadSnapshot();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(retryTimer);
      clearInterval(pingTimer);
      if (socket) { socket.onclose = null; socket.close(); }
    };
  }, [active, key, symbol, interval, token, latestRecorded]);

  return state.key === key ? state : { key, snapshot: null, error: null, live: false };
}

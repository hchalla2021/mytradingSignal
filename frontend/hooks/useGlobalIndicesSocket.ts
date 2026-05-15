'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

export interface GlobalIndexTick {
  symbol: string;
  name: string;
  region: string;
  price: number;
  change: number;
  changePct: number;
  source: string;
  status: 'LIVE' | 'STALE' | 'UNAVAILABLE';
  timestamp: string;
  fetchedAt?: string;
  quoteAgeSec?: number | null;
  marketState?: string;
  liveQuality?: 'REALTIME' | 'DELAYED' | 'CLOSED' | 'UNAVAILABLE';
}

export type GlobalIndicesData = Record<string, GlobalIndexTick>;

function getWsUrl(): string {
  const cfg = getEnvironmentConfig();
  const base = cfg.wsUrl.replace(/\/ws\/market$/, '');
  return `${base}/ws/global-indices`;
}

function getApiUrl(): string {
  const cfg = getEnvironmentConfig();
  const base = cfg.apiUrl.replace(/\/$/, '');
  return `${base}/api/global-indices`;
}

export function useGlobalIndicesSocket() {
  const [data, setData] = useState<GlobalIndicesData>({});
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryDelayRef = useRef(2000);

  const mergeData = useCallback((nextData: GlobalIndicesData) => {
    setData(prev => ({ ...prev, ...nextData }));
  }, []);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(getWsUrl());
    } catch {
      retryRef.current = setTimeout(connect, retryDelayRef.current);
      return;
    }

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      retryDelayRef.current = 2000;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.type === 'global_indices_update' || msg.type === 'global_indices_snapshot') {
          mergeData(msg.data ?? {});
        }
      } catch {
        // ignore malformed packets
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      retryDelayRef.current = Math.min(retryDelayRef.current * 1.5, 30000);
      retryRef.current = setTimeout(connect, retryDelayRef.current);
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetch(getApiUrl())
            .then(r => r.json())
            .then(j => {
              if (j?.success && j?.data) mergeData(j.data as GlobalIndicesData);
            })
            .catch(() => {});
        }, 5000);
      }
    };

    ws.onerror = () => ws.close();
  }, [mergeData]);

  useEffect(() => {
    fetch(getApiUrl())
      .then(r => r.json())
      .then(j => {
        if (j?.success && j?.data) mergeData(j.data as GlobalIndicesData);
      })
      .catch(() => {});

    connect();

    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
      wsRef.current?.close();
    };
  }, [connect, mergeData]);

  return { data, isConnected };
}

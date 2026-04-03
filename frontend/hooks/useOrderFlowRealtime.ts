'use client';

import { useState, useEffect } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

interface BidAskLevel {
  price: number;
  quantity: number;
  orders: number;
}

export interface OrderFlowData {
  timestamp: string;
  bid: number;
  ask: number;
  spread: number;
  spreadPct: number;
  bidLevels: BidAskLevel[];
  askLevels: BidAskLevel[];
  totalBidQty: number;
  totalAskQty: number;
  totalBidOrders: number;
  totalAskOrders: number;
  delta: number;
  deltaPercentage: number;
  deltaTrend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  buyerAggressionRatio: number;
  sellerAggressionRatio: number;
  liquidityImbalance: number;
  bidDepth: number;
  askDepth: number;
  buyDomination: boolean;
  sellDomination: boolean;
  signal: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SELL' | 'STRONG_SELL';
  signalConfidence: number;
  fiveMinPrediction: {
    direction: string;
    confidence: number;
    reasoning: string;
    tickCount: number;
    avgDelta: number;
    buyDominancePct: number;
    sellDominancePct: number;
  };
}

export interface OrderFlowSnapshot {
  NIFTY?: OrderFlowData;
  BANKNIFTY?: OrderFlowData;
  SENSEX?: OrderFlowData;
}

const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  error: console.error,
};

// ── Shared singleton WebSocket (ONE connection for all component instances) ──
let sharedWs: WebSocket | null = null;
let sharedOrderFlow: OrderFlowSnapshot = {};
let subscriberCount = 0;
let listeners = new Set<(snapshot: OrderFlowSnapshot) => void>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let hasEverConnected = false;

function isValidDepth(of: Record<string, unknown>): boolean {
  return ((of.bid as number) > 0 || (of.totalBidQty as number) > 0 || (of.totalAskQty as number) > 0);
}

function notifyListeners() {
  const snapshot = { ...sharedOrderFlow };
  listeners.forEach(fn => fn(snapshot));
}

function connectSharedWs() {
  if (typeof window === 'undefined') return;
  if (sharedWs?.readyState === WebSocket.OPEN || sharedWs?.readyState === WebSocket.CONNECTING) return;

  try {
    const config = getEnvironmentConfig();
    const WS_URL = config.wsUrl;
    if (!WS_URL) return;

    log.debug('🔌 [OrderFlow] Connecting shared WebSocket:', WS_URL);
    const ws = new WebSocket(WS_URL);
    sharedWs = ws;

    const timeout = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) ws.close();
    }, 10000);

    ws.onopen = () => {
      clearTimeout(timeout);
      hasEverConnected = true;
      reconnectAttempts = 0;
      log.debug('✅ [OrderFlow] Shared WebSocket connected');
      notifyListeners(); // notify connection status change
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'tick' && message.data?.orderFlow) {
          const { symbol } = message.data;
          const of = message.data.orderFlow;
          if (isValidDepth(of)) {
            sharedOrderFlow = { ...sharedOrderFlow, [symbol]: of };
            notifyListeners();
          }
        } else if (message.type === 'snapshot' && message.data) {
          // Process snapshot — each symbol may have orderFlow
          let updated = false;
          for (const [sym, tickData] of Object.entries(message.data)) {
            const td = tickData as Record<string, unknown>;
            if (td?.orderFlow && isValidDepth(td.orderFlow as Record<string, unknown>)) {
              sharedOrderFlow = { ...sharedOrderFlow, [sym]: td.orderFlow as OrderFlowData };
              updated = true;
            }
          }
          if (updated) notifyListeners();
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {};

    ws.onclose = () => {
      // Only process if this is still the active WebSocket
      if (sharedWs === ws) {
        sharedWs = null;
      }
      log.debug('🔌 [OrderFlow] Shared WebSocket disconnected');
      notifyListeners(); // notify connection status change
      if (subscriberCount > 0 && hasEverConnected) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
        reconnectAttempts++;
        reconnectTimer = setTimeout(connectSharedWs, delay);
      }
    };
  } catch {
    // ignore connection errors
  }
}

function disconnectSharedWs() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectAttempts = 0;
  if (sharedWs) {
    sharedWs.onclose = null; // Prevent reconnect on intentional close
    sharedWs.close();
    sharedWs = null;
  }
}

// ── Hook (multiple instances share ONE WebSocket) ─────────────────────
export function useOrderFlowRealtime() {
  const [orderFlow, setOrderFlow] = useState<OrderFlowSnapshot>(sharedOrderFlow);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    'connecting' | 'connected' | 'disconnected' | 'error' | 'RECONNECTING'
  >('disconnected');

  useEffect(() => {
    subscriberCount++;
    connectSharedWs();

    // Subscribe to data updates
    const listener = (snapshot: OrderFlowSnapshot) => {
      setOrderFlow(snapshot);
      const connected = sharedWs?.readyState === WebSocket.OPEN;
      setIsConnected(!!connected);
      setConnectionStatus(connected ? 'connected' : hasEverConnected ? 'RECONNECTING' : 'connecting');
    };
    listeners.add(listener);

    // Sync initial status
    const connected = sharedWs?.readyState === WebSocket.OPEN;
    setIsConnected(!!connected);
    setConnectionStatus(connected ? 'connected' : hasEverConnected ? 'RECONNECTING' : 'connecting');

    return () => {
      listeners.delete(listener);
      subscriberCount--;
      if (subscriberCount <= 0) {
        subscriberCount = 0;
        disconnectSharedWs();
      }
    };
  }, []);

  return {
    orderFlow,
    isConnected,
    connectionStatus,
    connect: connectSharedWs,
    disconnect: disconnectSharedWs,
  };
}

export default useOrderFlowRealtime;

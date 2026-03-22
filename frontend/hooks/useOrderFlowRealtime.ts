'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

export function useOrderFlowRealtime() {
  const [orderFlow, setOrderFlow] = useState<OrderFlowSnapshot>({});
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error' | 'RECONNECTING'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasEverConnectedRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

  const connect = useCallback(() => {
    if (typeof window === 'undefined') return;
    
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    if (hasEverConnectedRef.current) {
      setConnectionStatus('RECONNECTING');
    } else {
      setConnectionStatus('connecting');
    }
    
    try {
      const config = getEnvironmentConfig();
      const WS_URL = config.wsUrl;
      
      if (!WS_URL) {
        console.error('WebSocket URL not configured');
        setConnectionStatus('error');
        return;
      }
      
      log.debug('🔌 Connecting to order flow WebSocket:', WS_URL);
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          log.error('Order flow WebSocket connection timeout');
          ws.close();
          setConnectionStatus('error');
        }
      }, 10000);

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        setIsConnected(true);
        setConnectionStatus('connected');
        hasEverConnectedRef.current = true;
        reconnectAttemptsRef.current = 0;
        log.debug('✅ Order flow WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);

          // Only process tick messages with order flow data
          if (message.type === 'tick' && message.data?.orderFlow) {
            const tick = message.data;
            const symbol = tick.symbol;
            
            setOrderFlow((prev) => ({
              ...prev,
              [symbol]: tick.orderFlow
            }));
            
            log.debug(`📊 Order flow received for ${symbol}:`, tick.orderFlow.signal);
          }
        } catch (err) {
          log.error('Message parse error:', err);
        }
      };

      ws.onerror = (event) => {
        log.error('Order flow WebSocket error:', event);
        setConnectionStatus('error');
      };

      ws.onclose = () => {
        setIsConnected(false);
        setConnectionStatus('disconnected');
        log.debug('🔌 Order flow WebSocket disconnected');
        
        // Auto-reconnect with exponential backoff
        if (hasEverConnectedRef.current) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current += 1;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };
      
    } catch (err) {
      log.error('Failed to connect to order flow WebSocket:', err);
      setConnectionStatus('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return {
    orderFlow,
    isConnected,
    connectionStatus,
    connect,
    disconnect
  };
}

export default useOrderFlowRealtime;

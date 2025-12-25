'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export interface MarketTick {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
  oi: number;           // Open Interest
  pcr: number;          // Put-Call Ratio
  callOI: number;       // Call Open Interest
  putOI: number;        // Put Open Interest
  trend: 'bullish' | 'bearish' | 'neutral';
  timestamp: string;
  status: 'LIVE' | 'OFFLINE' | 'DEMO';
}

export interface MarketData {
  NIFTY: MarketTick | null;
  BANKNIFTY: MarketTick | null;
  SENSEX: MarketTick | null;
}

interface WebSocketMessage {
  type: 'tick' | 'snapshot' | 'heartbeat' | 'pong' | 'keepalive';
  data?: MarketTick | Record<string, MarketTick>;
  timestamp?: string;
}

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/market';
const STORAGE_KEY = 'lastMarketData';

// Save market data to localStorage
function saveMarketData(data: MarketData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Failed to save market data:', e);
  }
}

export function useMarketSocket() {
  // Initialize with null - load from localStorage in useEffect to avoid hydration mismatch
  const [marketData, setMarketData] = useState<MarketData>({
    NIFTY: null,
    BANKNIFTY: null,
    SENSEX: null,
  });
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    // Prevent multiple connections
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    setConnectionStatus('connecting');
    
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        setConnectionStatus('connected');

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'tick':
              if (message.data && 'symbol' in message.data) {
                const tick = message.data as MarketTick;
                setMarketData((prev) => {
                  const updated = { ...prev, [tick.symbol]: tick };
                  saveMarketData(updated);
                  return updated;
                });
              }
              break;

            case 'snapshot':
              if (message.data) {
                const snapshot = message.data as Record<string, MarketTick>;
                setMarketData((prev) => {
                  const updated = { ...prev, ...snapshot };
                  saveMarketData(updated);
                  return updated;
                });
              }
              break;

            case 'heartbeat':
            case 'pong':
            case 'keepalive':
              // Connection is alive
              break;
          }
        } catch (error) {
          console.error('Failed to parse message:', error);
        }
      };

      ws.onclose = (event) => {
        // Only log if not a clean close (1000) or HMR-related
        if (event.code !== 1000 && event.code !== 1001) {
          console.log('🔌 WebSocket disconnected:', event.code);
        }
        setIsConnected(false);
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Auto-reconnect after 3 seconds (unless it's a clean close)
        if (event.code !== 1000) {
          setConnectionStatus('connecting'); // Show "Connecting..." instead of "Disconnected"
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
              console.log('🔄 Reconnecting...');
              connect();
            }
          }, 3000);
        } else {
          setConnectionStatus('disconnected');
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setConnectionStatus('error');
      };

    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setConnectionStatus('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Load cached data from localStorage on mount (client-side only)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as MarketData;
        // Mark as offline since this is cached data
        if (parsed.NIFTY) parsed.NIFTY.status = 'OFFLINE';
        if (parsed.BANKNIFTY) parsed.BANKNIFTY.status = 'OFFLINE';
        if (parsed.SENSEX) parsed.SENSEX.status = 'OFFLINE';
        setMarketData(parsed);
      }
    } catch (e) {
      console.error('Failed to load cached market data:', e);
    }
    
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    marketData,
    isConnected,
    connectionStatus,
    reconnect: connect,
  };
}

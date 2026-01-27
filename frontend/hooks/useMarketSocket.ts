'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getEnvironmentConfig } from '@/lib/env-detection';

// Production-safe logging
const isDev = process.env.NODE_ENV === 'development';
const log = {
  debug: (...args: unknown[]) => isDev && console.log(...args),
  error: console.error,
};

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
  status: 'LIVE' | 'OFFLINE' | 'DEMO' | 'CLOSED' | 'PRE_OPEN';
  analysis?: any;       // ✅ Technical analysis data from backend
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

// Auto-detect WebSocket URL based on environment
const getWebSocketURL = (): string => {
  const config = getEnvironmentConfig();
  log.debug(`WebSocket connecting to: ${config.wsUrl} (${config.displayName})`);
  return config.wsUrl;
};

const STORAGE_KEY = 'lastMarketData';

// Save market data to localStorage
function saveMarketData(data: MarketData): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    log.error('Failed to save market data:', e);
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

    // 🔥 FIX: Don't show "connecting" if we already have cached data
    // This prevents UI from showing loading spinner when data is already visible
    setConnectionStatus((prev) => prev === 'connected' ? 'connected' : 'connecting');
    
    try {
      const WS_URL = getWebSocketURL(); // Dynamic URL based on environment
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setConnectionStatus('connected');

        // Start ping interval
        const pingInterval = parseInt(process.env.NEXT_PUBLIC_WS_PING_INTERVAL || '25000', 10);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send('ping');
          }
        }, pingInterval);
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          switch (message.type) {
            case 'tick':
              if (message.data && 'symbol' in message.data) {
                const tick = message.data as MarketTick;
                setMarketData((prev) => {
                  // Create completely new object to trigger React updates
                  const updated = {
                    NIFTY: prev.NIFTY,
                    BANKNIFTY: prev.BANKNIFTY,
                    SENSEX: prev.SENSEX,
                    [tick.symbol]: { ...tick } // New object for changed symbol
                  };
                  saveMarketData(updated);
                  log.debug(`✅ Tick received for ${tick.symbol}: ₹${tick.price}, Analysis: ${tick.analysis ? 'YES' : 'NO'}`);
                  return updated;
                });
              }
              break;

            case 'snapshot':
              if (message.data) {
                const snapshot = message.data as Record<string, MarketTick>;
                log.debug('✅ WS Snapshot received:', Object.keys(snapshot));
                console.log('📊 [SNAPSHOT] Received data:', snapshot);
                setMarketData(() => {
                  // Create completely new objects to trigger React updates
                  const updated = {
                    NIFTY: snapshot.NIFTY ? { ...snapshot.NIFTY } : null,
                    BANKNIFTY: snapshot.BANKNIFTY ? { ...snapshot.BANKNIFTY } : null,
                    SENSEX: snapshot.SENSEX ? { ...snapshot.SENSEX } : null,
                  };
                  saveMarketData(updated);
                  console.log('📊 [STATE] Market data updated:', updated);
                  return updated;
                });
              }
              break;

            case 'heartbeat':
            case 'pong':
            case 'keepalive':
              // 🔥 FIX: Update market status from heartbeat if provided
              // This ensures status updates even when no ticks are coming
              if (message.type === 'heartbeat' && (message as any).marketStatus) {
                const newStatus = (message as any).marketStatus;
                // Update all symbols with current market status
                setMarketData((prev) => {
                  const updated = { ...prev };
                  Object.keys(updated).forEach(symbol => {
                    if (updated[symbol]) {
                      updated[symbol] = { ...updated[symbol]!, status: newStatus };
                    }
                  });
                  if (Object.keys(updated).length > 0) {
                    saveMarketData(updated);
                  }
                  return updated;
                });
              }
              // Connection is alive
              break;
          }
        } catch (error) {
          // Silent error handling for production
        }
      };

      ws.onclose = (event) => {
        setIsConnected(false);
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        // Auto-reconnect after delay (unless it's a clean close)
        if (event.code !== 1000) {
          setConnectionStatus('connecting'); // Show "Connecting..." instead of "Disconnected"
          const reconnectDelay = parseInt(process.env.NEXT_PUBLIC_WS_RECONNECT_DELAY || '3000', 10);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
              connect();
            }
          }, reconnectDelay);
        } else {
          setConnectionStatus('disconnected');
        }
      };

      ws.onerror = () => {
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
        console.log('💾 [CACHE] Loaded from localStorage:', parsed);
        setMarketData(parsed);
      } else {
        console.log('⚠️ [CACHE] No cached market data found');
      }
    } catch (e) {
      console.error('❌ Failed to load cached market data:', e);
    }
    
    // Connect to WebSocket
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

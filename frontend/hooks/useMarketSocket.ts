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
  status: 'LIVE' | 'OFFLINE' | 'DEMO' | 'CLOSED' | 'PRE_OPEN' | 'FREEZE';
  analysis?: any;       // ✅ Technical analysis data from backend
}

export interface MarketData {
  NIFTY: MarketTick | null;
  BANKNIFTY: MarketTick | null;
  SENSEX: MarketTick | null;
}

interface WebSocketMessage {
  type: 'tick' | 'snapshot' | 'heartbeat' | 'pong' | 'keepalive' | 'connection_status';
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
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error' | 'RECONNECTING'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const hasEverConnectedRef = useRef(false);   // track if we've ever had a successful connection
  const reconnectAttemptsRef = useRef(0);       // for exponential backoff

  const connect = useCallback(() => {
    // Guard for SSR - window must exist
    if (typeof window === 'undefined') return;
    
    // Prevent multiple connections
    if (wsRef.current?.readyState === WebSocket.OPEN || 
        wsRef.current?.readyState === WebSocket.CONNECTING) {
      return;
    }

    // Show RECONNECTING (not "connecting") if we've ever been connected before
    // This correctly labels subsequent connection attempts as re-connections
    if (hasEverConnectedRef.current) {
      setConnectionStatus('RECONNECTING');
    } else {
      setConnectionStatus('connecting');
    }
    
    try {
      const WS_URL = getWebSocketURL(); // Dynamic URL based on environment
      if (!WS_URL) {
        console.error('WebSocket URL not configured');
        setConnectionStatus('error');
        return;
      }
      
      log.debug('🔌 Attempting WebSocket connection to:', WS_URL);
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      // Mobile Safari specific timeout - Safari is slower
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          log.error('WebSocket connection timeout');
          ws.close();
          setConnectionStatus('error');
        }
      }, 10000); // 10 second timeout for mobile

      ws.onopen = () => {
        clearTimeout(connectionTimeout);
        setIsConnected(true);
        setConnectionStatus('connected');
        hasEverConnectedRef.current = true;
        reconnectAttemptsRef.current = 0;  // reset backoff on successful connect
        log.debug('✅ WebSocket connected successfully');

        // Start ping interval
        const pingInterval = parseInt(process.env.NEXT_PUBLIC_WS_PING_INTERVAL || '25000', 10);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send('ping');
            } catch (e) {
              log.error('Failed to send ping:', e);
              setConnectionStatus('error');
            }
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
                setMarketData(() => {
                  // Create completely new objects to trigger React updates
                  const updated = {
                    NIFTY: snapshot.NIFTY ? { ...snapshot.NIFTY } : null,
                    BANKNIFTY: snapshot.BANKNIFTY ? { ...snapshot.BANKNIFTY } : null,
                    SENSEX: snapshot.SENSEX ? { ...snapshot.SENSEX } : null,
                  };
                  saveMarketData(updated);
                  return updated;
                });
              }
              break;

            case 'heartbeat':
            case 'pong':
            case 'keepalive':
            case 'connection_status':
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
          log.error('Failed to parse WebSocket message:', error);
          // Don't throw - continue processing other messages
        }
      };

      ws.onclose = (event) => {
        clearTimeout(connectionTimeout);
        setIsConnected(false);
        
        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
        }

        log.debug(`WebSocket closed: code=${event.code}, reason=${event.reason}`);
        
        // Auto-reconnect after delay (unless it's a clean close)
        if (event.code !== 1000) {
          // Show RECONNECTING if we've connected before, else show connecting
          setConnectionStatus(hasEverConnectedRef.current ? 'RECONNECTING' : 'connecting');

          // Exponential backoff: 3s, 5s, 10s, 20s, 30s (max)
          reconnectAttemptsRef.current += 1;
          const baseDelay = parseInt(process.env.NEXT_PUBLIC_WS_RECONNECT_DELAY || '3000', 10);
          const backoffDelay = Math.min(baseDelay * Math.pow(1.5, reconnectAttemptsRef.current - 1), 30000);
          log.debug(`Reconnecting in ${Math.round(backoffDelay)}ms (attempt ${reconnectAttemptsRef.current})...`);
          reconnectTimeoutRef.current = setTimeout(() => {
            if (!wsRef.current || wsRef.current.readyState === WebSocket.CLOSED) {
              connect();
            }
          }, backoffDelay);
        } else {
          reconnectAttemptsRef.current = 0;
          setConnectionStatus('disconnected');
        }
      };

      ws.onerror = (error) => {
        clearTimeout(connectionTimeout);
        log.error('WebSocket error:', error);
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
    // Guard for SSR
    if (typeof window === 'undefined') return;
    
    // Load cached data from localStorage on mount (client-side only)
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as MarketData;
        setMarketData(parsed);
      }
    } catch (e) {
      console.error('❌ Failed to load cached market data:', e);
    }
    
    // Connect to WebSocket
    connect();

    // Page Visibility API: reconnect immediately when tab comes back into focus
    // Browsers throttle timers in background tabs, which can make our ping interval
    // miss the 60-second server timeout. On visibility change we reconnect proactively.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const ws = wsRef.current;
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          reconnectAttemptsRef.current = 0; // reset backoff - user is back
          connect();
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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

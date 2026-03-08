'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export type WebSocketStatus = 
  | 'OFFLINE' 
  | 'CONNECTING' 
  | 'CONNECTED' 
  | 'SUBSCRIBED'
  | 'LIVE' 
  | 'STALE' 
  | 'NO_TICKS'
  | 'WAITING'
  | 'RECONNECTING'
  | 'ERROR'
  | 'FAILED';

interface MarketData {
  symbol: string;
  price: number;
  timestamp: string;
  volume?: number;
  [key: string]: any;
}

interface UseProductionMarketSocket {
  status: WebSocketStatus;
  data: Record<string, MarketData>;
  isReceivingData: boolean;
  connectionQuality: 'excellent' | 'good' | 'connecting' | 'poor' | 'offline';
  message: string;
  lastTickTime: number | null;
  tickCount: number;
  reconnect: () => void;
}

export function useProductionMarketSocket(): UseProductionMarketSocket {
  const [status, setStatus] = useState<WebSocketStatus>('OFFLINE');
  const [data, setData] = useState<Record<string, MarketData>>({});
  const [message, setMessage] = useState('');
  const [lastTickTime, setLastTickTime] = useState<number | null>(null);
  const [tickCount, setTickCount] = useState(0);
  
  const ws = useRef<WebSocket | null>(null);
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const tickTimeout = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);

  const checkMarketTiming = useCallback(() => {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    
    const currentSeconds = hours * 3600 + minutes * 60 + seconds;
    const marketStartSeconds = 9 * 3600 + 14 * 60 + 50; // 9:14:50 AM
    
    const dayOfWeek = now.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    
    return !isWeekend && currentSeconds >= marketStartSeconds;
  }, []);

  const checkTickTimeout = useCallback(() => {
    if (!lastTickTime) return;
    
    const timeSinceLastTick = Date.now() - lastTickTime;
    const TICK_TIMEOUT = 30000; // 30 seconds
    
    if (timeSinceLastTick > TICK_TIMEOUT && status === 'LIVE') {
      setStatus('STALE');
      setMessage('No ticks for 30s');
    }
  }, [lastTickTime, status]);

  const handleWebSocketMessage = useCallback((event: MessageEvent) => {
    try {
      const parsedData = JSON.parse(event.data);
      
      if (parsedData && typeof parsedData === 'object') {
        setLastTickTime(Date.now());
        setTickCount(prev => prev + 1);
        
        // Transition from SUBSCRIBED to LIVE on first tick
        if (status !== 'LIVE') {
          setStatus('LIVE');
          setMessage('');
        }
        
        setData(prev => ({
          ...prev,
          [parsedData.symbol || 'unknown']: parsedData
        }));
      }
    } catch (err) {
      // Ignore parse errors for non-JSON messages
      console.debug('WebSocket message parse error');
    }
  }, [status]);

  const reconnect = useCallback(() => {
    if (reconnectAttempts.current > 5) {
      setStatus('FAILED');
      setMessage('Max reconnection attempts reached - please refresh');
      return;
    }

    reconnectAttempts.current++;
    setStatus('RECONNECTING');
    setMessage(`Reconnecting (attempt ${reconnectAttempts.current}/5)...`);

    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }

    reconnectTimeout.current = setTimeout(() => {
      // Attempt to reconnect by calling connect logic
      if (checkMarketTiming()) {
        // Market is open, try to connect
        try {
          const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/market';
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.close();
          }
          
          setStatus('CONNECTING');
          setMessage('Connecting to market feed...');
          
          ws.current = new WebSocket(wsUrl);

          const connectionTimeout = setTimeout(() => {
            if (ws.current?.readyState !== WebSocket.OPEN) {
              ws.current?.close();
              setStatus('ERROR');
              setMessage('Connection timeout - retrying...');
              reconnect();
            }
          }, 10000);

          ws.current.onopen = () => {
            clearTimeout(connectionTimeout);
            setStatus('SUBSCRIBED');
            setMessage('Connected, waiting for data...');
            reconnectAttempts.current = 0;
          };

          ws.current.onmessage = handleWebSocketMessage;

          ws.current.onerror = () => {
            clearTimeout(connectionTimeout);
            setStatus('ERROR');
            setMessage('Connection error, retrying...');
          };

          ws.current.onclose = () => {
            clearTimeout(connectionTimeout);
            // Don't auto-reconnect from onclose during reconnect sequence
          };
        } catch (err) {
          console.error('Reconnect attempt failed:', err);
          setStatus('ERROR');
          setMessage('Reconnection failed, retrying...');
        }
      }
    }, Math.min(1000 * Math.pow(2, reconnectAttempts.current - 1), 10000));
  }, [checkMarketTiming, handleWebSocketMessage]);

  const connect = useCallback(() => {
    if (!checkMarketTiming()) {
      setStatus('WAITING');
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      setMessage(`Market opens at 9:15 AM (IST). Current: ${hours}:${minutes.toString().padStart(2, '0')}`);
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN) return;
    if (status === 'CONNECTING' || status === 'RECONNECTING') return; // Don't try to connect twice
    
    setStatus('CONNECTING');
    setMessage('Connecting to market feed...');

    try {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/market';
      ws.current = new WebSocket(wsUrl);

      // WebSocket connection timeout (10 seconds)
      const connectionTimeout = setTimeout(() => {
        if (ws.current?.readyState !== WebSocket.OPEN) {
          ws.current?.close();
          setStatus('ERROR');
          setMessage('Connection timeout - retrying...');
        }
      }, 10000);

      ws.current.onopen = () => {
        clearTimeout(connectionTimeout);
        setStatus('SUBSCRIBED');
        setMessage('Connected, waiting for data...');
        reconnectAttempts.current = 0;
      };

      ws.current.onmessage = handleWebSocketMessage;

      ws.current.onerror = (event) => {
        clearTimeout(connectionTimeout);
        console.error('WebSocket error:', event);
        setStatus('ERROR');
        setMessage('Connection error, retrying...');
      };

      ws.current.onclose = () => {
        clearTimeout(connectionTimeout);
      };
    } catch (err) {
      console.error('WebSocket creation error:', err);
      setStatus('ERROR');
      setMessage('Failed to connect, retrying...');
    }
  }, [checkMarketTiming, handleWebSocketMessage, status]);

  const calculateConnectionQuality = useCallback((): 'excellent' | 'good' | 'connecting' | 'poor' | 'offline' => {
    const isReceiving = status === 'LIVE' && tickCount > 0;
    
    if (status === 'LIVE' && isReceiving) {
      return 'excellent';
    } else if (status === 'CONNECTED' || status === 'SUBSCRIBED') {
      return 'good';
    } else if (status === 'CONNECTING' || status === 'RECONNECTING') {
      return 'connecting';
    } else if (status === 'STALE' || status === 'NO_TICKS') {
      return 'poor';
    }
    return 'offline';
  }, [status, tickCount]);

  const isReceivingData = status === 'LIVE' && tickCount > 0;
  const connectionQuality = calculateConnectionQuality();

  useEffect(() => {
    if (typeof window === 'undefined') return;

    connect();

    // Check market timing every minute (in case it transitions from closed to open)
    const marketCheckInterval = setInterval(() => {
      if (checkMarketTiming() && status === 'WAITING') {
        connect();
      }
    }, 60000);

    // Check tick timeout every 5 seconds
    const tickCheckInterval = setInterval(() => {
      checkTickTimeout();
    }, 5000);

    // Try to reconnect if we're supposed to be connected but aren't
    const autoReconnectInterval = setInterval(() => {
      if (checkMarketTiming()) {
        if (status === 'ERROR' || status === 'FAILED') {
          reconnect();
        } else if (status !== 'LIVE' && status !== 'SUBSCRIBED' && status !== 'CONNECTING' && status !== 'RECONNECTING') {
          connect();
        }
      }
    }, 15000);

    return () => {
      clearInterval(marketCheckInterval);
      clearInterval(tickCheckInterval);
      clearInterval(autoReconnectInterval);
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (tickTimeout.current) clearTimeout(tickTimeout.current);
      if (ws.current) ws.current.close();
    };
  }, [connect, checkTickTimeout, checkMarketTiming, reconnect, status]);

  return {
    status,
    data,
    isReceivingData,
    connectionQuality,
    message,
    lastTickTime,
    tickCount,
    reconnect
  };
}


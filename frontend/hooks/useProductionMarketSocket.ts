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
        setStatus('LIVE');
        setMessage('');
        
        setData(prev => ({
          ...prev,
          [parsedData.symbol || 'unknown']: parsedData
        }));
      }
    } catch (err) {
      // Ignore parse errors
    }
  }, []);

  const reconnect = useCallback(() => {
    if (reconnectAttempts.current > 5) {
      setStatus('FAILED');
      setMessage('Max reconnection attempts reached');
      return;
    }

    reconnectAttempts.current++;
    setStatus('RECONNECTING');

    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
    }

    reconnectTimeout.current = setTimeout(() => {
      // connect called below
    }, 2000 * reconnectAttempts.current);
  }, []);

  const connect = useCallback(() => {
    if (!checkMarketTiming()) {
      setStatus('WAITING');
      setMessage('Waiting for market to open');
      return;
    }

    if (ws.current?.readyState === WebSocket.OPEN) return;
    
    setStatus('CONNECTING');
    setMessage('Connecting...');

    try {
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000/ws/market';
      ws.current = new WebSocket(wsUrl);

      ws.current.onopen = () => {
        setStatus('SUBSCRIBED');
        setMessage('Connected');
        reconnectAttempts.current = 0;
      };

      ws.current.onmessage = handleWebSocketMessage;

      ws.current.onerror = () => {
        setStatus('ERROR');
        setMessage('WebSocket error');
      };

      ws.current.onclose = () => {
        setStatus('OFFLINE');
        setMessage('Disconnected');
        reconnect();
      };
    } catch (err) {
      setStatus('ERROR');
      setMessage('Failed to create WebSocket');
    }
  }, [checkMarketTiming, handleWebSocketMessage, reconnect]);

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

    const tickCheckInterval = setInterval(() => {
      checkTickTimeout();
    }, 5000);

    return () => {
      clearInterval(tickCheckInterval);
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (tickTimeout.current) clearTimeout(tickTimeout.current);
      if (ws.current) ws.current.close();
    };
  }, [connect, checkTickTimeout]);

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


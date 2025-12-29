/**
 * Buy-on-Dip Hook
 * WebSocket connection for real-time Buy-on-Dip signals
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export interface BuyOnDipSignal {
  signal: 'BUY-ON-DIP' | 'NO BUY-ON-DIP' | 'ERROR';
  confidence: number;
  max_score: number;
  percentage: number;
  reasons: string[];
  warnings: string[];
  price: number;
  timestamp: string;
  symbol?: string;
  indicators: {
    ema20?: number;
    ema50?: number;
    rsi?: number;
    vwap?: number;
    volume_ratio?: number;
  };
  candle_info: {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    is_bullish: boolean;
  };
  error?: string;
}

export interface BuyOnDipData {
  [symbol: string]: BuyOnDipSignal;
}

interface WebSocketMessage {
  type: 'initial' | 'update' | 'error';
  data: BuyOnDipData;
  timestamp: string;
}

export const useBuyOnDip = () => {
  const [signals, setSignals] = useState<BuyOnDipData>({});
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      const wsUrl = apiUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const ws = new WebSocket(`${wsUrl}/api/buy-on-dip/ws`);

      ws.onopen = () => {
        setIsConnected(true);
        setError(null);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          
          if (message.type === 'initial' || message.type === 'update') {
            setSignals(message.data);
            setLastUpdate(message.timestamp);
          } else if (message.type === 'error') {
            setError('Error receiving signals');
          }
        } catch (err) {
          setError('Error parsing signal data');
        }
      };

      ws.onerror = (event) => {
        setError('Connection error');
      };

      ws.onclose = () => {
        setIsConnected(false);
        
        // Attempt reconnection with exponential backoff
        if (reconnectAttempts.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          
          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttempts.current++;
            connect();
          }, delay);
        } else {
          setError('Connection lost. Please refresh the page.');
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error('Error creating Buy-on-Dip WebSocket:', err);
      setError('Failed to connect');
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
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  /**
   * Get signal for a specific symbol
   */
  const getSignal = useCallback((symbol: string): BuyOnDipSignal | null => {
    return signals[symbol] || null;
  }, [signals]);

  /**
   * Check if Buy-on-Dip is active for a symbol
   */
  const isActive = useCallback((symbol: string): boolean => {
    const signal = signals[symbol];
    return signal?.signal === 'BUY-ON-DIP';
  }, [signals]);

  /**
   * Get confidence percentage for a symbol
   */
  const getConfidence = useCallback((symbol: string): number => {
    const signal = signals[symbol];
    return signal?.percentage || 0;
  }, [signals]);

  /**
   * Get all active Buy-on-Dip signals
   */
  const getActiveSignals = useCallback((): BuyOnDipData => {
    return Object.entries(signals)
      .filter(([_, signal]) => signal.signal === 'BUY-ON-DIP')
      .reduce((acc, [symbol, signal]) => {
        acc[symbol] = signal;
        return acc;
      }, {} as BuyOnDipData);
  }, [signals]);

  /**
   * Get signal status color
   */
  const getStatusColor = useCallback((symbol: string): string => {
    const signal = signals[symbol];
    if (!signal) return 'gray';
    
    if (signal.signal === 'BUY-ON-DIP') {
      return 'green';
    } else if (signal.signal === 'ERROR') {
      return 'red';
    } else {
      return 'gray';
    }
  }, [signals]);

  /**
   * Manual refresh
   */
  const refresh = useCallback(() => {
    disconnect();
    setTimeout(() => connect(), 100);
  }, [connect, disconnect]);

  return {
    signals,
    isConnected,
    error,
    lastUpdate,
    getSignal,
    isActive,
    getConfidence,
    getActiveSignals,
    getStatusColor,
    refresh,
  };
};

/**
 * useAnalysis Hook - Real-time analysis updates via WebSocket
 * Performance optimized with auto-reconnection
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { AnalysisSignal, AnalysisResponse } from '@/types/analysis';

interface UseAnalysisOptions {
  autoConnect?: boolean;
  reconnectInterval?: number;
  onError?: (error: Error) => void;
}

interface UseAnalysisReturn {
  analyses: AnalysisResponse | null;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

export function useAnalysis(options: UseAnalysisOptions = {}): UseAnalysisReturn {
  const {
    autoConnect = true,
    reconnectInterval = 5000,
    onError,
  } = options;

  const [analyses, setAnalyses] = useState<AnalysisResponse | null>(null);
  const [lastValidAnalyses, setLastValidAnalyses] = useState<AnalysisResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(autoConnect);
  const hasInitialDataRef = useRef(false);

  // Fetch initial data via REST API immediately (ULTRA FAST)
  const fetchInitialData = useCallback(async () => {
    if (hasInitialDataRef.current) return;
    
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
      console.log('🔄 Fetching initial analysis data from:', `${apiUrl}/api/analysis/analyze/all`);
      
      // Use timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout
      
      const response = await fetch(`${apiUrl}/api/analysis/analyze/all`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Initial analysis data received:', data);
        setAnalyses(data);
        setLastValidAnalyses(data);
        hasInitialDataRef.current = true;
        setIsConnected(true); // Mark as connected when data received
        console.log('✅ Initial analysis data loaded via REST');
      } else {
        console.error('❌ Failed to fetch analysis:', response.status, response.statusText);
        setError(`HTTP ${response.status}`);
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        console.warn('⏱️ REST API timeout - falling back to WebSocket');
      } else {
        console.error('❌ Error fetching initial data:', err);
      }
      setError('Backend connection failed');
    }
  }, []);

  const connect = useCallback(() => {
    try {
      // Clear any existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000';
      console.log('🔌 Connecting to analysis WebSocket:', `${wsUrl}/api/analysis/ws/analysis`);
      const ws = new WebSocket(`${wsUrl}/api/analysis/ws/analysis`);

      ws.onopen = () => {
        console.log('📊 Analysis WebSocket connected');
        setIsConnected(true);
        setError(null);
        hasInitialDataRef.current = true; // Mark as initialized
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          
          if (message.type === 'analysis_update') {
            setAnalyses(message.data);
            setLastValidAnalyses(message.data);
            hasInitialDataRef.current = true;
          }
        } catch (err) {
          console.error('Failed to parse analysis message:', err);
        }
      };

      ws.onerror = (event) => {
        const errorMsg = 'Analysis WebSocket error';
        console.error(errorMsg, event);
        setError(errorMsg);
        
        if (onError) {
          onError(new Error(errorMsg));
        }
      };

      ws.onclose = () => {
        console.log('📊 Analysis WebSocket disconnected');
        setIsConnected(false);

        // Auto-reconnect if enabled
        if (shouldReconnectRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log('🔄 Reconnecting to analysis WebSocket...');
            connect();
          }, reconnectInterval);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to connect';
      setError(errorMsg);
      
      if (onError) {
        onError(err instanceof Error ? err : new Error(errorMsg));
      }
    }
  }, [reconnectInterval, onError]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = true;
    connect();
  }, [connect]);

  useEffect(() => {
    if (autoConnect) {
      // Fetch initial data immediately via REST API
      fetchInitialData();
      
      // Then connect WebSocket for real-time updates
      connect();
    }

    return () => {
      shouldReconnectRef.current = false;
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [autoConnect, connect, fetchInitialData]);

  return {
    analyses: analyses || lastValidAnalyses,
    isConnected,
    error,
    reconnect,
  };
}

// Helper hook to get analysis for a specific symbol
export function useSymbolAnalysis(symbol: string): AnalysisSignal | null {
  const { analyses } = useAnalysis();
  return analyses?.[symbol] || null;
}

/**
 * useAnalysis Hook - PRODUCTION READY
 * Uses direct REST API polling for maximum reliability
 * NO WebSocket dependency - works independently
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { AnalysisSignal, AnalysisResponse } from '@/types/analysis';

interface UseAnalysisOptions {
  autoConnect?: boolean;
  pollingInterval?: number;
  onError?: (error: Error) => void;
}

interface UseAnalysisReturn {
  analyses: AnalysisResponse | null;
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
  refreshCount: number;
}

export function useAnalysis(options: UseAnalysisOptions = {}): UseAnalysisReturn {
  const {
    autoConnect = true,
    pollingInterval = 1000, // Poll every 1 second for real-time updates
    onError,
  } = options;

  const [analyses, setAnalyses] = useState<AnalysisResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(autoConnect);

  // Fetch analysis data via REST API
  const fetchAnalysisData = useCallback(async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000';
      const url = `${apiUrl}/api/analysis/analyze/all`;
      
      console.log('🔄 Fetching analysis from:', url);
      
      const controller = new AbortController();
      const timeout = parseInt(process.env.NEXT_PUBLIC_API_TIMEOUT || '5000', 10);
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        },
      });
      
      clearTimeout(timeoutId);
      
      console.log('📡 Response status:', response.status, response.statusText);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Analysis data received:', data);
        console.log('📊 Symbols in response:', Object.keys(data));
        
        // Log prices and timestamps to verify data is changing
        if (data.BANKNIFTY) {
          console.log('💰 BANKNIFTY:', {
            price: data.BANKNIFTY.indicators?.price,
            timestamp: data.BANKNIFTY.timestamp,
            signal: data.BANKNIFTY.signal
          });
        }
        
        // Force new object reference to ensure React detects change
        const dataWithTimestamp = { 
          ...data, 
          _fetchTime: Date.now() // Force new reference every time
        };
        setAnalyses(dataWithTimestamp);
        setRefreshCount(prev => {
          const newCount = prev + 1;
          console.log(`🔄 Refresh #${newCount} - Data updated at ${new Date().toLocaleTimeString()}.${Date.now() % 1000}`);
          return newCount;
        });
        setIsConnected(true);
        setError(null);
      } else {
        const errorText = await response.text();
        console.error('❌ API error response:', errorText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      console.error('❌ Analysis fetch error:', err);
      setIsConnected(false);
      
      if (err instanceof Error && err.name === 'AbortError') {
        setError('Timeout - retrying...');
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Unknown error');
      }
      
      if (onError && err instanceof Error) {
        onError(err);
      }
    }
  }, [onError]);

  const startPolling = useCallback(() => {
    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    // Fetch immediately
    fetchAnalysisData();

    // Then poll at interval
    intervalRef.current = setInterval(() => {
      if (isActiveRef.current) {
        fetchAnalysisData();
      }
    }, pollingInterval);
  }, [fetchAnalysisData, pollingInterval]);

  const reconnect = useCallback(() => {
    isActiveRef.current = true;
    setError(null);
    startPolling();
  }, [startPolling]);

  useEffect(() => {
    if (autoConnect) {
      console.log('📊 Starting analysis polling (every 1s for real-time updates)');
      startPolling();
    }

    return () => {
      isActiveRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoConnect, startPolling]);

  return {
    analyses,
    isConnected,
    error,
    reconnect,
    refreshCount,
  };
}

// Helper hook to get analysis for a specific symbol
export function useSymbolAnalysis(symbol: string): AnalysisSignal | null {
  const { analyses } = useAnalysis();
  return analyses?.[symbol] || null;
}

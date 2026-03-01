/**
 * useAnalysis Hook - PRODUCTION READY
 * Uses direct REST API polling for maximum reliability
 * NO WebSocket dependency - works independently
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { AnalysisSignal, AnalysisResponse } from '@/types/analysis';
import { API_CONFIG } from '@/lib/api-config';

// ─── Separate cache for last-known analysis data ──────────────────────────────
// Persists across market-closed sessions. Never cleared — only overwritten with
// fresher data. Completely independent of the live polling logic.
const ANALYSIS_CACHE_KEY = 'lastKnownAnalysisData';

function saveAnalysisCache(data: AnalysisResponse): void {
  if (typeof window === 'undefined') return;
  try {
    // Strip the synthetic _fetchTime before persisting so we don't restore
    // a stale timestamp as if it were fresh.
    const { _fetchTime, ...rest } = data as any;
    localStorage.setItem(ANALYSIS_CACHE_KEY, JSON.stringify(rest));
  } catch (e) {
    // localStorage may be full or blocked — silently ignore
  }
}

function loadAnalysisCache(): AnalysisResponse | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(ANALYSIS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AnalysisResponse;
    console.log('[useAnalysis] 💾 Loaded last-known analysis from cache');
    return parsed;
  } catch (e) {
    return null;
  }
}

/** Returns true when the API response contains at least one symbol with real data */
function isValidAnalysisData(data: any): boolean {
  const symbols = ['NIFTY', 'BANKNIFTY', 'SENSEX'];
  return symbols.some(sym => {
    const d = data?.[sym];
    return d && (d.confidence > 0 || Object.keys(d.indicators || {}).length > 0);
  });
}

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

  // Initialise with cached data immediately so market-closed screens show
  // the last known values instead of zeros.
  const [analyses, setAnalyses] = useState<AnalysisResponse | null>(() => loadAnalysisCache());
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(autoConnect);
  const attemptCountRef = useRef(0);

  // Fetch analysis data via REST API
  const fetchAnalysisData = useCallback(async () => {
    try {
      const apiUrl = API_CONFIG.baseUrl;
      
      if (!apiUrl) {
        console.error('[useAnalysis] ❌ API URL not configured. Check NEXT_PUBLIC_API_URL in .env.local');
        setError('API URL not configured');
        setIsConnected(false);
        return;
      }
      
      const url = `${apiUrl}/api/analysis/analyze/all`;
      
      attemptCountRef.current += 1;
      const attemptNum = attemptCountRef.current;
      if (attemptNum <= 3) {
        console.log(`[useAnalysis] 🔄 Attempt ${attemptNum}: Fetching from ${url}`);
      }
      
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
      
      if (response.ok) {
        const data = await response.json();
        
        if (attemptNum <= 3 || attemptNum % 10 === 0) {
          console.log('[useAnalysis] ✅ Data received:', {
            symbols: Object.keys(data),
            sampleData: Object.entries(data).slice(0, 1).reduce((acc, [k, v]: any) => {
              acc[k] = {
                signal: v.signal,
                confidence: v.confidence,
                indicators: Object.keys(v.indicators || {})
              };
              return acc;
            }, {})
          });
        }
        
        // Force new object reference to ensure React detects change
        const dataWithTimestamp = { 
          ...data, 
          _fetchTime: Date.now() // Force new reference every time
        };
        setAnalyses(dataWithTimestamp);
        setRefreshCount(prev => prev + 1);
        setIsConnected(true);
        setError(null);

        // ── Persist to last-known cache (only when data is genuinely valid) ──
        if (isValidAnalysisData(data)) {
          saveAnalysisCache(data);
        }
      } else {
        const errorText = await response.text();
        console.error('[useAnalysis] ❌ API error response:', response.status, errorText.substring(0, 200));
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (err) {
      const attemptNum = attemptCountRef.current;
      if (attemptNum <= 3 || attemptNum % 10 === 0) {
        console.error('[useAnalysis] ❌ Fetch error:', err);
      }
      setIsConnected(false);

      // ── Fall back to last-known cache on API failure ──────────────────────
      // Keep showing real values instead of zeros when market is closed or
      // the backend is temporarily unreachable.
      setAnalyses(prev => {
        if (prev !== null) return prev; // already have (cached) data — keep it
        const cached = loadAnalysisCache();
        if (cached) {
          console.log('[useAnalysis] ⚠️ API failed — restored last-known analysis from cache');
          return cached;
        }
        return null;
      });
      
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

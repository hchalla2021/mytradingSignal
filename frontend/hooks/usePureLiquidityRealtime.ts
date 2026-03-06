import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { API_CONFIG } from '@/lib/api-config';

interface CriticalLevel {
  level: number;
  volume_signature: number;
  cluster_count: number;
}

interface PrimaryCluster {
  level: number;
  volume_signature: number;
  cluster_count: number;
}

interface PureLiquidityData {
  symbol: string;
  timestamp: string;
  current_price: number;
  // Concentration metrics
  liquidity_concentration: number;
  concentration_rating: string;
  concentration_description: string;
  // Absorption metrics
  volume_absorption_rating: string;
  volume_absorption_score: number;
  absorption_description: string;
  // Buy/Sell balance
  buy_volume_pct: number;
  sell_volume_pct: number;
  buy_sell_balance: number;
  balance_status: string;
  balance_description: string;
  // Critical levels
  critical_levels: CriticalLevel[];
  level_count: number;
  primary_cluster: PrimaryCluster | null;
  // Liquidity strength
  liquidity_strength_index: number;
  liquidity_strength_rating: string;
  strength_description: string;
  // Execution quality
  execution_quality_score: number;
  execution_quality: string;
  execution_description: string;
  // Slippage risk
  slippage_risk_pct: number;
  slippage_risk: string;
  slippage_description: string;
  // Trends
  liquidity_trend: string;
  volume_trend: string;
  trend_description: string;
  // Action & confidence
  recommended_action: string;
  action_description: string;
  confidence: number;
  status: string;
  error?: string;
}

const LIVE_CACHE_TTL = 5000; // 5 seconds during trading hours
const NON_TRADING_CACHE_TTL = 60000; // 60 seconds outside trading hours
const API_POLL_INTERVAL = 3000; // 3 seconds
const BATCH_WINDOW = 200; // 200ms batch window

// Map-based cache with TTL
const pureLiquidityCache = new Map<string, { data: PureLiquidityData; timestamp: number }>();

const getCached = (symbol: string): PureLiquidityData | null => {
  const cached = pureLiquidityCache.get(symbol);
  if (!cached) return null;

  const now = Date.now();
  const ttl = checkTradingHours() ? LIVE_CACHE_TTL : NON_TRADING_CACHE_TTL;

  if (now - cached.timestamp < ttl) {
    return cached.data;
  }

  pureLiquidityCache.delete(symbol);
  return null;
};

const setCached = (symbol: string, data: PureLiquidityData): void => {
  pureLiquidityCache.set(symbol, {
    data,
    timestamp: Date.now(),
  });
};

const checkTradingHours = (): boolean => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const day = now.getDay();

  // Mon(1)-Fri(5): 09:15-15:30
  if (day >= 1 && day <= 5) {
    if (hours === 9 && minutes >= 15) return true;
    if (hours >= 10 && hours < 15) return true;
    if (hours === 15 && minutes <= 30) return true;
  }

  return false;
};

export const usePureLiquidityRealtime = (symbol: string) => {
  const [data, setData] = useState<PureLiquidityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<string>('No data');
  const [lastApiCall, setLastApiCall] = useState<string>('Never');

  const pendingUpdateRef = useRef(false);
  const batchTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPureLiquidityData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const endpoint = API_CONFIG.endpoint(`/api/advanced/pure-liquidity/${symbol}`);
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('authToken') || ''}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const newData: PureLiquidityData = await response.json();

      // Update cache
      setCached(symbol, newData);
      setData(newData);
      setLastApiCall(new Date().toLocaleTimeString());
      setLastUpdate(new Date().toLocaleTimeString());
      setLoading(false);
    } catch (err) {
      console.error(`[usePureLiquidity] Error fetching data for ${symbol}:`, err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [symbol]);

  const handleMarketTick = useCallback(() => {
    if (pendingUpdateRef.current) return;

    pendingUpdateRef.current = true;

    // Clear existing batch timer
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current);
    }

    // Schedule update after batch window
    batchTimerRef.current = setTimeout(() => {
      fetchPureLiquidityData();
      pendingUpdateRef.current = false;
    }, BATCH_WINDOW);
  }, [fetchPureLiquidityData]);

  useEffect(() => {
    // Try to restore from cache first
    const cached = getCached(symbol);
    if (cached) {
      setData(cached);
      setLastUpdate(new Date(cached.timestamp).toLocaleTimeString());
    }

    // Initial fetch
    fetchPureLiquidityData();

    // Set up market tick listener
    const handleTick = () => handleMarketTick();
    window.addEventListener(`market-tick-${symbol}`, handleTick);

    // Set up polling (3s even if no WebSocket updates)
    pollIntervalRef.current = setInterval(() => {
      if (!pendingUpdateRef.current) {
        fetchPureLiquidityData();
      }
    }, API_POLL_INTERVAL);

    return () => {
      window.removeEventListener(`market-tick-${symbol}`, handleTick);
      if (batchTimerRef.current) clearTimeout(batchTimerRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [symbol, fetchPureLiquidityData, handleMarketTick]);

  return {
    data,
    loading,
    error,
    lastUpdate,
    lastApiCall,
  };
};

export const useMemoizedPureLiquidityAnalysis = (data: PureLiquidityData | null) => {
  return useMemo(() => {
    if (!data) {
      return {
        setupColor: 'text-gray-400',
        setupLabel: 'No Data',
        executionColor: 'text-gray-400',
        slippageColor: 'text-gray-400',
        concentrationColor: 'text-gray-400',
        trendIcon: '➡️',
      };
    }

    // Determine setup quality color based on execution quality
    let setupColor = 'text-red-500';
    if (data.execution_quality === 'EXCELLENT') setupColor = 'text-green-500';
    else if (data.execution_quality === 'GOOD') setupColor = 'text-lime-500';
    else if (data.execution_quality === 'FAIR') setupColor = 'text-yellow-500';

    // Execution quality colors
    let executionColor = 'text-gray-400';
    if (data.execution_quality === 'EXCELLENT') executionColor = 'text-green-500';
    else if (data.execution_quality === 'GOOD') executionColor = 'text-lime-500';
    else if (data.execution_quality === 'FAIR') executionColor = 'text-yellow-500';
    else if (data.execution_quality === 'POOR') executionColor = 'text-red-500';

    // Slippage risk colors (inverse: low slippage = green, high = red)
    let slippageColor = 'text-gray-400';
    if (data.slippage_risk === 'LOW') slippageColor = 'text-green-500';
    else if (data.slippage_risk === 'MODERATE') slippageColor = 'text-yellow-500';
    else if (data.slippage_risk === 'HIGH') slippageColor = 'text-red-500';

    // Concentration rating colors
    let concentrationColor = 'text-gray-400';
    if (data.concentration_rating === 'EXTREME') concentrationColor = 'text-red-500';
    else if (data.concentration_rating === 'STRONG') concentrationColor = 'text-orange-500';
    else if (data.concentration_rating === 'MODERATE') concentrationColor = 'text-yellow-500';
    else if (data.concentration_rating === 'WEAK') concentrationColor = 'text-green-500';

    // Trend icon
    let trendIcon = '➡️';
    if (data.liquidity_trend === 'INCREASING') trendIcon = '📈';
    else if (data.liquidity_trend === 'DECREASING') trendIcon = '📉';
    else if (data.liquidity_trend === 'STABLE') trendIcon = '➡️';

    return {
      setupColor,
      setupLabel: data.execution_quality,
      executionColor,
      slippageColor,
      concentrationColor,
      trendIcon,
      concentrationValue: Math.round(data.liquidity_concentration),
      absorptionValue: Math.round(data.volume_absorption_score),
      strengthValue: Math.round(data.liquidity_strength_index),
    };
  }, [data]);
};

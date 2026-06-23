'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_CONFIG } from '@/lib/api-config';

export interface AlgoIndicators {
  price: number;
  ema20: number;
  ema100: number;
  ema200: number;
  rsi: number;
  vwap: number;
  pcr: number;
  pcr_bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  oi_trend: 'LONG_BUILDUP' | 'SHORT_BUILDUP' | 'SHORT_COVERING' | 'LONG_UNWINDING' | 'NEUTRAL';
  change_pct: number;
  volume: number;
  oi: number;
  near_high: boolean;
  near_low: boolean;
  price_above_ema20: boolean;
  price_above_ema100: boolean;
  price_above_ema200: boolean;
  ema20_above_ema100: boolean;
  ema100_above_ema200: boolean;
  trend: string;
  market_status: string;
}

export interface AlgoSignal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'WAIT';
  entry_price: number;
  stop_loss: number;
  target: number;
  trailing_stop_loss: number;
  confidence: number;
  sl_points: number;
  target_points: number;
  regime: 'TRENDING_UP' | 'TRENDING_DOWN' | 'SIDEWAYS' | 'VOLATILE' | 'UNKNOWN';
  strength: number;
  reasoning: string;
  indicators: AlgoIndicators;
  ai_powered: boolean;
  last_updated: number;
  market_status: string;
  option_tradingsymbol?: string;
  option_type?: 'CE' | 'PE';
  option_expiry?: string;
  option_strike?: number;
  option_ltp?: number;
  option_best_bid_price?: number;
  option_best_ask_price?: number;
  option_best_buy_price?: number;
  option_price_updated_at?: number;
  option_entry_buy_price?: number;
  option_unrealized_pnl_points?: number;
  option_unrealized_pnl_amount?: number;
  option_pnl_status?: 'PROFIT' | 'LOSS' | 'FLAT';
  recommended_option_side?: 'CE' | 'PE';
  auto_buy_ready?: boolean;
  auto_buy_block_reason?: string;
  auto_buy_gate_passed?: boolean;
  auto_buy_gate_reason?: string;
  auto_buy_ai_passed?: boolean;
  auto_buy_ai_reason?: string;
  auto_buy_ai_confidence?: number;
}

export type AlgoData = Record<string, AlgoSignal>;

interface UseSmartAlgoReturn {
  data: AlgoData;
  isConnected: boolean;
  /** Whether OpenAI AI enrichment is active on the backend (zero tokens when false) */
  aiEnabled: boolean;
  adjustSLTarget: (symbol: string, slPoints: number, targetPoints: number) => Promise<void>;
  /** Toggle AI enrichment on the backend — controls actual token spend */
  toggleAlgo: (enabled: boolean) => Promise<void>;
}

const EMPTY_SIGNAL = (symbol: string): AlgoSignal => ({
  symbol,
  signal: 'WAIT',
  entry_price: 0,
  stop_loss: 0,
  target: 0,
  trailing_stop_loss: 0,
  confidence: 0,
  sl_points: 10,
  target_points: 15,
  regime: 'UNKNOWN',
  strength: 0,
  reasoning: 'Connecting...',
  indicators: {} as AlgoIndicators,
  ai_powered: false,
  last_updated: 0,
  market_status: 'CLOSED',
  option_tradingsymbol: '',
  option_type: undefined,
  option_expiry: '',
  option_strike: 0,
  option_ltp: 0,
  option_best_bid_price: 0,
  option_best_ask_price: 0,
  option_best_buy_price: 0,
  option_price_updated_at: 0,
  option_entry_buy_price: 0,
  option_unrealized_pnl_points: 0,
  option_unrealized_pnl_amount: 0,
  option_pnl_status: 'FLAT',
  recommended_option_side: undefined,
  auto_buy_ready: false,
  auto_buy_block_reason: '',
  auto_buy_gate_passed: false,
  auto_buy_gate_reason: '',
  auto_buy_ai_passed: false,
  auto_buy_ai_reason: '',
  auto_buy_ai_confidence: 0,
});

export function useSmartAlgo(): UseSmartAlgoReturn {
  const [data, setData] = useState<AlgoData>({
    NIFTY: EMPTY_SIGNAL('NIFTY'),
    BANKNIFTY: EMPTY_SIGNAL('BANKNIFTY'),
    SENSEX: EMPTY_SIGNAL('SENSEX'),
  });
  const [isConnected, setIsConnected] = useState(false);
  // Mirror the backend ai_enabled flag so UI stays in sync with server state
  const [aiEnabled, setAiEnabled] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    try {
      // Build WS URL: replace /ws/market path with /ws/algo
      const base = API_CONFIG.wsUrl.replace(/\/ws\/market.*$/, '');
      const url = `${base}/ws/algo`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => setIsConnected(true);

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.data && typeof msg.data === 'object') {
            setData((prev) => ({ ...prev, ...msg.data }));
          }
          // Sync ai_enabled from every WS frame
          if (typeof msg.ai_enabled === 'boolean') {
            setAiEnabled(msg.ai_enabled);
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        setIsConnected(false);
        retryRef.current = setTimeout(connect, 4000);
      };

      ws.onerror = () => ws.close();
    } catch {
      retryRef.current = setTimeout(connect, 4000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  // Also do initial REST fetch for immediate render + sync ai_enabled state
  useEffect(() => {
    const fetchSnapshot = async () => {
      try {
        const res = await fetch(API_CONFIG.endpoint('/api/algo/signals'), { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json();
        if (json?.data) setData((prev) => ({ ...prev, ...json.data }));
        if (typeof json?.ai_enabled === 'boolean') setAiEnabled(json.ai_enabled);
      } catch {
        // ignore
      }
    };
    fetchSnapshot();
  }, []);

  const adjustSLTarget = useCallback(
    async (symbol: string, slPoints: number, targetPoints: number) => {
      try {
        await fetch(API_CONFIG.endpoint('/api/algo/adjust'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol, sl_points: slPoints, target_points: targetPoints }),
        });
      } catch {
        // best-effort
      }
    },
    []
  );

  /**
   * Toggle AI enrichment on the backend.
   * When disabled: rule engine continues running, OpenAI is never called → zero token spend.
   * Updates local aiEnabled state optimistically for instant UI response.
   */
  const toggleAlgo = useCallback(async (enabled: boolean) => {
    // Optimistic local update for instant UI response
    setAiEnabled(enabled);
    try {
      const res = await fetch(API_CONFIG.endpoint('/api/algo/toggle'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        const json = await res.json();
        if (typeof json?.ai_enabled === 'boolean') setAiEnabled(json.ai_enabled);
      } else {
        // Revert optimistic update on failure
        setAiEnabled(!enabled);
      }
    } catch {
      // Revert on network error
      setAiEnabled(!enabled);
    }
  }, []);

  return { data, isConnected, aiEnabled, adjustSLTarget, toggleAlgo };
}

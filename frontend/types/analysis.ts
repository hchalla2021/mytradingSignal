/**
 * Analysis Types - Complete type definitions for technical analysis
 * Type-safe, extensible, AI-ready architecture
 */

export enum SignalType {
  BUY_SIGNAL = "BUY_SIGNAL",
  SELL_SIGNAL = "SELL_SIGNAL",
  STRONG_BUY = "STRONG_BUY",
  STRONG_SELL = "STRONG_SELL",
  NO_TRADE = "NO_TRADE",
  WAIT = "WAIT",
}

export enum TrendDirection {
  UPTREND = "UPTREND",
  DOWNTREND = "DOWNTREND",
  SIDEWAYS = "SIDEWAYS",
  UNKNOWN = "UNKNOWN",
}

export enum VolumeStrength {
  STRONG_VOLUME = "STRONG_VOLUME",
  MODERATE_VOLUME = "MODERATE_VOLUME",
  WEAK_VOLUME = "WEAK_VOLUME",
}

export enum VWAPPosition {
  ABOVE_VWAP = "ABOVE_VWAP",
  BELOW_VWAP = "BELOW_VWAP",
  AT_VWAP = "AT_VWAP",
}

export interface TechnicalIndicators {
  // Price & Trend
  price: number;
  high: number;
  low: number;
  open: number;
  vwap: number;
  vwma_20: number;
  vwap_position: VWAPPosition;
  ema_20: number;
  ema_50: number;
  ema_100: number;
  ema_200: number;
  trend: TrendDirection;

  // Support & Resistance
  support: number;
  resistance: number;
  prev_day_high: number;
  prev_day_low: number;
  prev_day_close: number;

  // Volume & Momentum
  volume: number;
  volume_strength: VolumeStrength;
  rsi: number;
  momentum?: number;  // Momentum score 0-100
  candle_strength: number;

  // Options Data
  pcr: number | null;
  oi_change: number | null;

  // Time Filter
  time_quality: string;

  // EMA Touch Tracking (tracks if price touched EMA from above/below)
  ema_20_touched_below?: boolean;  // Price crossed above EMA20
  ema_20_touched_above?: boolean;  // Price crossed below EMA20
  ema_50_touched_below?: boolean;  // Price crossed above EMA50
  ema_50_touched_above?: boolean;  // Price crossed below EMA50
  ema_100_touched_below?: boolean; // Price crossed above EMA100
  ema_100_touched_above?: boolean; // Price crossed below EMA100
  ema_200_touched_below?: boolean; // Price crossed above EMA200
  ema_200_touched_above?: boolean; // Price crossed below EMA200

  // Support & Resistance Touch Tracking
  resistance_touched?: boolean;    // Price touched resistance level
  support_touched?: boolean;       // Price touched support level

  // Alignment Confidence
  ema_alignment_confidence?: number; // 30-95% confidence
}

export interface AnalysisSignal {
  symbol: string;
  symbol_name: string;
  signal: SignalType;
  confidence: number; // 0.0 to 1.0

  // Indicators
  indicators: TechnicalIndicators;

  // Signal Context
  reasons: string[];
  warnings: string[];

  // Entry/Exit
  entry_price: number | null;
  stop_loss: number | null;
  target: number | null;

  // Market Status
  status?: 'LIVE' | 'CLOSED' | 'OFFLINE';

  // Metadata
  timestamp: string;
}

export interface AnalysisResponse {
  [symbol: string]: AnalysisSignal;
}

export interface AnalysisConfig {
  ema_periods: {
    fast: number;
    medium: number;
    slow: number;
  };
  volume: {
    sma_period: number;
    strength_multiplier: number;
  };
  vwap: {
    deviation_threshold: number;
  };
  support_resistance: {
    lookback_period: number;
    threshold: number;
  };
  momentum: {
    rsi_period: number;
    rsi_overbought: number;
    rsi_oversold: number;
  };
  time_filter: {
    avoid_first_minutes: number;
    avoid_last_minutes: number;
  };
  signal: {
    require_all_indicators: boolean;
    min_confidence_score: number;
  };
}

// Helper types for UI
export interface SignalColors {
  bg: string;
  text: string;
  border: string;
  glow: string;
}

export interface IndicatorStatus {
  label: string;
  value: string | number;
  status: "positive" | "negative" | "neutral";
  icon?: string;
}

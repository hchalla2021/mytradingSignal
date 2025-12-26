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
  vwap_position: VWAPPosition;
  ema_9: number;
  ema_21: number;
  ema_50: number;
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

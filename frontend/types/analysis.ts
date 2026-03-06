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
  vwap_bias?: string;  // LONG_ONLY, SHORT_ONLY, NEUTRAL
  vwap_role?: string;  // SUPPORT, RESISTANCE, EQUILIBRIUM
  vwap_signal?: string;  // DIP_TO_VWAP_BUY, PULLBACK_TO_VWAP_SELL, etc.
  vwap_r3_s3_combo?: string;  // Institutional combo analysis
  
  ema_20: number;
  ema_50: number;
  ema_100: number;
  ema_200: number;
  ema_alignment?: string; // ALL_BULLISH, ALL_BEARISH, PARTIAL_BULLISH, PARTIAL_BEARISH, COMPRESSION, NEUTRAL
  ema_alignment_confidence?: number; // 30-95% confidence
  ema200_touch?: string;  // TOUCHING, ABOVE, BELOW
  ema200_touch_type?: string;  // FROM_ABOVE, FROM_BELOW
  ema200_action?: string;
  ema200_entry_filter?: string;
  ema200_confirmation?: string;
  
  trend: TrendDirection;
  trend_status?: string;  // STRONG_UPTREND, STRONG_DOWNTREND, COMPRESSION, WEAK_UPTREND, WEAK_DOWNTREND, TRANSITION
  trend_label?: string;
  trend_color?: string;  // BULLISH, BEARISH, NEUTRAL
  trend_structure?: string;  // HIGHER_HIGHS_LOWS, LOWER_HIGHS_LOWS, SIDEWAYS
  market_structure?: string;  // UPTREND, DOWNTREND, SIDEWAYS
  trend_5min?: string;  // UP, DOWN, NEUTRAL
  trend_15min?: string;  // UP, DOWN, NEUTRAL
  
  pullback_level?: string;  // EMA20, EMA50, EMA100, NONE
  pullback_entry?: string;
  ema_support_zone?: string;
  momentum_shift?: string;  // BULLISH_CONFIRMED, BEARISH_CONFIRMED, MOMENTUM_SHIFT, MIXED
  buy_allowed?: boolean;

  // Support & Resistance
  support: number;
  resistance: number;
  prev_day_high: number;
  prev_day_low: number;
  prev_day_close: number;

  // Camarilla R3/S3 Gate Levels
  camarilla_h3?: number;
  camarilla_l3?: number;
  camarilla_r3?: number;
  camarilla_s3?: number;
  camarilla_h4?: number;
  camarilla_l4?: number;
  camarilla_zone?: string;
  camarilla_zone_status?: string;
  camarilla_signal?: string;
  camarilla_signal_desc?: string;
  camarilla_confidence?: number;

  // CPR (Central Pivot Range) Analysis
  cpr_top_central?: number;
  cpr_bottom_central?: number;
  cpr_pivot?: number;
  cpr_tc?: number;
  cpr_bc?: number;
  cpr_width?: number;
  cpr_width_pct?: number;
  cpr_classification?: string;  // NARROW, WIDE
  cpr_description?: string;

  // Trend Day Signal
  trend_day_signal?: string;
  trend_day_confidence?: number;

  // Parabolic SAR
  sar_value?: number;
  sar_position?: string;  // BELOW, ABOVE, NEUTRAL
  sar_trend?: string;  // BULLISH, BEARISH, NEUTRAL
  sar_signal?: string;
  sar_signal_strength?: number;
  sar_flip?: boolean;
  sar_flip_type?: string;
  sar_confirmation_status?: string;
  trailing_sl?: number;
  distance_to_sar?: number;
  distance_to_sar_pct?: number;

  // SuperTrend (10,2)
  supertrend_10_2_value?: number;
  supertrend_10_2_trend?: string;  // BULLISH, BEARISH, NEUTRAL
  supertrend_10_2_signal?: string;  // BUY, SELL, HOLD
  supertrend_10_2_distance?: number;
  supertrend_10_2_distance_pct?: number;
  supertrend_10_2_confidence?: number;
  supertrend_10_2_warning?: string;
  supertrend?: string;  // Alias for frontend

  // Sideways/Ranging Detection
  is_sideways_market?: boolean;
  ema_compression_pct?: number;
  price_in_cpr?: boolean;
  atr_estimated?: number;
  atr_estimated_pct?: number;
  sideways_warning?: string;

  // Combined Confirmation Setups
  buy_setup_status?: string;
  buy_setup_confidence?: number;
  buy_setup_desc?: string;
  sell_setup_status?: string;
  sell_setup_confidence?: number;
  sell_setup_desc?: string;
  market_status_message?: string;

  // Opening Range Breakout (ORB)
  orb_high?: number;
  orb_low?: number;
  orb_range?: number;
  orb_position?: string;
  orb_status?: string;
  orb_signal?: string;
  orb_strength?: number;
  orb_confidence?: number;
  orb_confirmation?: string;
  distance_to_orb_high?: number;
  distance_to_orb_low?: number;
  orb_risk?: number;
  orb_reward_risk_ratio?: number;

  // Volume & Momentum
  volume: number;
  volume_strength: VolumeStrength;
  volume_ratio?: number;
  volume_price_alignment?: boolean;
  buy_volume_ratio?: number;
  sell_volume_ratio?: number;
  order_flow_strength?: number;
  volume_imbalance?: number;

  vwma_ema_signal?: string;  // STRONG_BUY, BUY, SELL, STRONG_SELL, WAIT
  vwma_above_ema200?: boolean;
  vwma_ema_confidence?: number;

  rsi: number;
  rsi_zone?: string;
  rsi_signal?: string;
  rsi_action?: string;
  rsi_5m?: number;
  rsi_15m?: number;
  rsi_5m_signal?: string;
  rsi_15m_signal?: string;
  rsi_momentum_status?: string;
  rsi_momentum_confidence?: number;

  momentum?: number;  // Momentum score 0-100
  candle_strength: number;
  candle_direction?: string;  // BULLISH, BEARISH, DOJI
  candle_quality_signal?: string;
  candle_quality_confidence?: number;

  // Smart Money Flow
  smart_money_signal?: string;
  smart_money_confidence?: number;

  // Options Data
  pcr: number | null;
  oi_change: number | null;

  // Price Change
  changePercent?: number;
  change?: number;

  // Market Structure
  order_block_bullish?: number;
  order_block_bearish?: number;
  bos_bullish?: boolean;
  bos_bearish?: boolean;
  fvg_bullish?: boolean;
  fvg_bearish?: boolean;
  swing_high?: number;
  swing_low?: number;
  swing_pattern?: string;
  high_volume_levels?: number[];
  structure_confidence?: number;

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
  status?: 'LIVE' | 'CLOSED' | 'OFFLINE' | 'PRE_OPEN' | 'FREEZE';

  // 🔥 PERSISTENT CACHE METADATA
  // Shows when data was last updated and whether it's coming from persistent cache
  _cache_info?: {
    last_update_unix_time: number;
    last_update_datetime: string;
    seconds_since_update: number;
    minutes_since_update: number;
    is_from_persistent_cache: boolean;
  };
  _data_source?: 'LIVE' | 'LAST_TRADED' | 'BACKUP_CACHE';  // Where the data came from

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

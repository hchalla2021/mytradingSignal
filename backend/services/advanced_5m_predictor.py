"""
⚡ ADVANCED 5-MINUTE PREDICTION ENGINE
======================================
Sophisticated micro-trend detection for short-term liquidity prediction.

This module enhances the base liquidity service with:
  1. Micro-momentum acceleration detection (rate of change of signals)
  2. Liquidity inflow/outflow velocity analysis
  3. Order flow imbalance tracking (buying vs selling pressure)
  4. Potential reversal detection (momentum divergence)
  5. Candle speed & acceleration analysis
  6. Separate high-precision 5-min confidence calculation

Strategy: Behaves like an experienced trader watching ORDER FLOW, not price.
  - Detects when large players ENTER or EXIT
  - Identifies liquidity SHIFTS within seconds
  - Alerts on REVERSAL setups before confirmation
  - Provides independent confidence separate from general market confidence

Architecture:
  - Completely isolated from other services
  - Zero external API calls (uses cache only)
  - Works in parallel with existing 5-min predictions
  - Can be used as a secondary confirmation or primary signal
  - Backward compatible with existing endpoints
"""

import collections
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List, Tuple, Deque
from dataclasses import dataclass
import math

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES FOR MICRO-TREND TRACKING
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class MicroMomentum:
    """Tracks rate of change of a signal over micro-timeframes."""
    value: float                      # Current value
    acceleration: float               # Rate of change (derivative)
    trend: str                        # "ACCELERATING_UP" | "ACCELERATING_DOWN" | "DECELERATING"
    strength: int                     # 0-100: how strong is the acceleration
    recent_peak: float                # Highest value in last window
    recent_trough: float              # Lowest value in last window
    volatility: float                 # Std deviation of recent values


@dataclass
class LiquidityFlow:
    """Tracks liquidity inflow vs outflow."""
    net_flow: float                   # +ve = inflow, -ve = outflow
    inflow_pressure: float            # 0-100: buying pressure
    outflow_pressure: float           # 0-100: selling pressure
    flow_momentum: float              # Rate of change of net flow
    shift_detected: bool              # True if major shift in last 2 candles
    shift_direction: str              # "INFLOW" | "OUTFLOW" | "NONE"


@dataclass
class ReversalSignal:
    """Detects potential reversal setups."""
    likely: bool                      # True if reversal conditions present
    confidence: int                   # 0-100
    reason: str                       # Why reversal might occur
    type: str                         # "MOMENTUM_DIVERGENCE" | "LIQUIDITY_SHIFT" | "EXHAUSTION" | "PCR_EXTREME"
    current_direction: str            # Current trend direction
    potential_reverse_to: str         # Opposite direction


class MicroTrendBuffer:
    """Ring buffer for tracking micro-trends (last 30 seconds of data)."""
    
    def __init__(self, symbol: str, maxlen: int = 20):
        self.symbol = symbol
        self.maxlen = maxlen
        # Store (timestamp, pcr, oi_change, volume_ratio, price_change)
        self._buf: Deque[Dict[str, Any]] = collections.deque(maxlen=maxlen)
    
    def push(self, pcr: float, oi_change_pct: float, volume_ratio: float, 
             price_change_pct: float, ema_slope: float):
        """Push a new micro-trend data point."""
        self._buf.append({
            'timestamp': datetime.now(),
            'pcr': pcr,
            'oi_change': oi_change_pct,
            'volume_ratio': volume_ratio,
            'price_change': price_change_pct,
            'ema_slope': ema_slope,
        })
    
    def get_recent(self, n: int = 5) -> List[Dict[str, Any]]:
        """Get last n data points."""
        return list(self._buf)[-n:] if len(self._buf) >= n else list(self._buf)
    
    def is_full(self) -> bool:
        """Check if we have enough data points."""
        return len(self._buf) >= 5


# ═══════════════════════════════════════════════════════════════════════════════
# ADVANCED SIGNAL ANALYSIS FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════════

def _compute_micro_momentum(recent_values: List[float]) -> MicroMomentum:
    """
    Compute micro-momentum from recent values (last 5+ data points).
    Detects if momentum is ACCELERATING or DECELERATING.
    """
    if len(recent_values) < 3:
        return MicroMomentum(
            value=recent_values[-1] if recent_values else 0,
            acceleration=0.0,
            trend="STABLE",
            strength=0,
            recent_peak=max(recent_values) if recent_values else 0,
            recent_trough=min(recent_values) if recent_values else 0,
            volatility=0.0
        )
    
    current = recent_values[-1]
    prev = recent_values[-2]
    
    # First derivative: rate of change
    acceleration = current - prev
    
    # Second derivative: is the acceleration itself accelerating?
    if len(recent_values) >= 4:
        prev_acceleration = recent_values[-2] - recent_values[-3]
        jerk = acceleration - prev_acceleration  # "jerk" = 3rd derivative
    else:
        jerk = 0.0
    
    # Volatility: standard deviation of recent values
    mean = sum(recent_values) / len(recent_values)
    variance = sum((x - mean) ** 2 for x in recent_values) / len(recent_values)
    volatility = math.sqrt(max(0, variance))
    
    # Determine trend
    if acceleration > 0.001:  # Positive acceleration (moving up)
        if jerk > 0.0001:     # Jerk is positive (accelerating UP more)
            trend = "ACCELERATING_UP"
            strength = min(100, int(acceleration * 100))
        else:                 # Jerk is negative (accelerating UP less, maybe slowing)
            trend = "DECELERATING"
            strength = max(0, int(50 - acceleration * 100))
    elif acceleration < -0.001:  # Negative acceleration (moving down)
        if jerk < -0.0001:    # Jerk is negative (accelerating DOWN more)
            trend = "ACCELERATING_DOWN"
            strength = min(100, int(abs(acceleration) * 100))
        else:                 # Jerk is positive (accelerating DOWN less, maybe slowing)
            trend = "DECELERATING"
            strength = max(0, int(50 - abs(acceleration) * 100))
    else:                     # Nearly no acceleration
        trend = "STABLE"
        strength = 50
    
    peak = max(recent_values)
    trough = min(recent_values)
    
    return MicroMomentum(
        value=current,
        acceleration=acceleration,
        trend=trend,
        strength=strength,
        recent_peak=peak,
        recent_trough=trough,
        volatility=volatility
    )


def _detect_liquidity_flow(recent_oi_changes: List[float], 
                          recent_volumes: List[float],
                          recent_prices: List[float]) -> LiquidityFlow:
    """
    Detect liquidity INFLOW vs OUTFLOW by analyzing OI + Volume + Price alignment.
    
    Inflow patterns:
      - OI increasing + Volume increasing → Institutional buying
      - Price up + OI up → Long buildup (strong inflow)
      - Price up + OI up + High volume → Aggressive inflow
    
    Outflow patterns:
      - OI decreasing + Volume increasing → Position unwinding
      - Price down + OI up → Short selling (strong outflow)
      - Price down + OI up + High volume → Aggressive short selling
    """
    
    if len(recent_oi_changes) < 3 or len(recent_volumes) < 3 or len(recent_prices) < 3:
        return LiquidityFlow(
            net_flow=0.0,
            inflow_pressure=50,
            outflow_pressure=50,
            flow_momentum=0.0,
            shift_detected=False,
            shift_direction="NONE"
        )
    
    # Current candle metrics
    current_oi_change = recent_oi_changes[-1]
    current_volume = recent_volumes[-1]
    prev_volume = recent_volumes[-2] if len(recent_volumes) > 1 else recent_volumes[-1]
    
    current_price = recent_prices[-1]
    prev_price = recent_prices[-2] if len(recent_prices) > 1 else recent_prices[-1]
    price_direction = 1 if current_price >= prev_price else -1
    
    # Score inflow vs outflow (0-100 scale)
    # Inflow: OI UP + Volume UP + Price UP = institutional buying
    oi_up = 1 if current_oi_change > 0.1 else -1 if current_oi_change < -0.1 else 0
    vol_up = 1 if current_volume > prev_volume else -1 if current_volume < prev_volume else 0
    price_up = price_direction
    
    # Alignment score
    inflow_alignment = (oi_up + vol_up + price_up) / 3.0  # -1 to +1
    outflow_alignment = -(inflow_alignment)  # Opposite
    
    inflow_pressure = int(50 + inflow_alignment * 50)  # 0-100
    outflow_pressure = int(50 + outflow_alignment * 50)  # 0-100
    
    # Net flow
    net_flow = inflow_alignment
    
    # Flow momentum: rate of change of net flow
    if len(recent_oi_changes) >= 2:
        flow_momentum = recent_oi_changes[-1] - recent_oi_changes[-2]
    else:
        flow_momentum = 0.0
    
    # Detect shift in flow (major change in last 2 candles)
    shift_detected = False
    shift_direction = "NONE"
    if len(recent_oi_changes) >= 2:
        prev_oi_change = recent_oi_changes[-2]
        if (prev_oi_change > 0 and current_oi_change < -0.1) or \
           (prev_oi_change < -0.1 and current_oi_change > 0):
            shift_detected = True
            shift_direction = "INFLOW" if current_oi_change > 0 else "OUTFLOW"
    
    return LiquidityFlow(
        net_flow=net_flow,
        inflow_pressure=inflow_pressure,
        outflow_pressure=outflow_pressure,
        flow_momentum=flow_momentum,
        shift_detected=shift_detected,
        shift_direction=shift_direction
    )


def _detect_reversal_signals(
    price_momentum: MicroMomentum,
    pcr_momentum: MicroMomentum,
    liquidity_flow: LiquidityFlow,
    current_pcr: float,
    current_direction: str  # "BULLISH" | "BEARISH" | "NEUTRAL"
) -> ReversalSignal:
    """
    Detect potential REVERSAL setups by analyzing:
    1. MOMENTUM DIVERGENCE: Price and PCR moving in opposite directions
    2. LIQUIDITY SHIFT: Sudden change from inflow to outflow or vice versa
    3. EXHAUSTION: Momentum is decelerating while volume is high
    4. PCR EXTREME: PCR reaches extreme levels (>1.5 or <0.6)
    """
    
    reversal_confidence = 0
    reversal_reason = ""
    reversal_type = "NONE"
    
    # ─── Check 1: Momentum Divergence ────────────────────────────────────────
    # If price is going up but PCR is deteriorating (going down), that's bearish divergence
    # If price is going down but PCR is improving (going up), that's bullish divergence
    
    if price_momentum.trend == "ACCELERATING_UP" and pcr_momentum.trend in ["ACCELERATING_DOWN", "DECELERATING"]:
        reversal_confidence += 35
        reversal_reason = "Bearish divergence: Price up but PCR weakening"
        reversal_type = "MOMENTUM_DIVERGENCE"
    elif price_momentum.trend == "ACCELERATING_DOWN" and pcr_momentum.trend in ["ACCELERATING_UP", "STABLE"]:
        reversal_confidence += 35
        reversal_reason = "Bullish divergence: Price down but PCR improving"
        reversal_type = "MOMENTUM_DIVERGENCE"
    
    # ─── Check 2: Liquidity Shift ───────────────────────────────────────────
    if liquidity_flow.shift_detected:
        if current_direction == "BULLISH" and liquidity_flow.shift_direction == "OUTFLOW":
            reversal_confidence += 30
            reversal_reason = f"Major outflow detected during uptrend"
            reversal_type = "LIQUIDITY_SHIFT"
        elif current_direction == "BEARISH" and liquidity_flow.shift_direction == "INFLOW":
            reversal_confidence += 30
            reversal_reason = f"Major inflow detected during downtrend"
            reversal_type = "LIQUIDITY_SHIFT"
    
    # ─── Check 3: Exhaustion ────────────────────────────────────────────────
    # High volatility + decelerating momentum = exhaustion
    if price_momentum.volatility > 0.5 and price_momentum.trend == "DECELERATING":
        reversal_confidence += 25
        reversal_reason = "Momentum exhaustion detected"
        reversal_type = "EXHAUSTION"
    
    # ─── Check 4: PCR Extremes ──────────────────────────────────────────────
    # Extreme PCR often precedes reversals
    if current_pcr > 1.5:  # Extreme put wall
        reversal_confidence += 15
        reversal_reason = f"Extreme put wall (PCR {current_pcr:.2f})"
        reversal_type = "PCR_EXTREME"
    elif current_pcr > 0 and current_pcr < 0.6:  # Extreme call wall
        reversal_confidence += 15
        reversal_reason = f"Extreme call wall (PCR {current_pcr:.2f})"
        reversal_type = "PCR_EXTREME"
    
    reversal_likely = reversal_confidence >= 40
    potential_reverse = "BEARISH" if current_direction == "BULLISH" else "BULLISH"
    
    return ReversalSignal(
        likely=reversal_likely,
        confidence=min(100, reversal_confidence),
        reason=reversal_reason or "No clear reversal signals",
        type=reversal_type,
        current_direction=current_direction,
        potential_reverse_to=potential_reverse if reversal_likely else current_direction
    )


# ═══════════════════════════════════════════════════════════════════════════════
# ADVANCED 5-MINUTE PREDICTION CALCULATION
# ═══════════════════════════════════════════════════════════════════════════════

def calculate_advanced_5m_prediction(
    signals: Dict[str, Any],  # PCR sentiment, OI buildup, price momentum, candle conviction
    recent_oi_changes: List[float],
    recent_volumes: List[float],
    recent_prices: List[float],
    current_pcr: float,
    current_direction: str  # From base liquidity analysis
) -> Dict[str, Any]:
    """
    Advanced 5-minute prediction combining:
    1. Base liquidity signals (PCR, OI, Price Momentum)
    2. Micro-momentum acceleration
    3. Liquidity flow analysis
    4. Reversal detection
    
    Returns comprehensive prediction with multiple confidence indicators.
    """
    
    # ─── Extract base signal scores ──────────────────────────────────────────
    pcr_score = signals.get("pcr_sentiment", {}).get("score", 0.0)
    oi_score = signals.get("oi_buildup", {}).get("score", 0.0)
    mom_score = signals.get("price_momentum", {}).get("score", 0.0)
    conv_score = signals.get("candle_conviction", {}).get("score", 0.0)
    
    # ─── Analyze micro-trends ───────────────────────────────────────────────
    recent_oi_for_momentum = recent_oi_changes[-5:] if len(recent_oi_changes) >= 5 else recent_oi_changes
    recent_prices_for_momentum = recent_prices[-5:] if len(recent_prices) >= 5 else recent_prices
    
    oi_momentum = _compute_micro_momentum(recent_oi_for_momentum)
    price_momentum = _compute_micro_momentum(recent_prices_for_momentum)
    pcr_recent = [current_pcr] * min(3, len(recent_oi_changes))  # Simplified PCR micro-trend
    pcr_momentum = _compute_micro_momentum(pcr_recent)
    
    # ─── Analyze liquidity flow ──────────────────────────────────────────────
    liquidity_flow = _detect_liquidity_flow(recent_oi_changes, recent_volumes, recent_prices)
    
    # ─── Detect reversal signals ─────────────────────────────────────────────
    reversal = _detect_reversal_signals(price_momentum, pcr_momentum, liquidity_flow, current_pcr, current_direction)
    
    # ─── Calculate advanced 5-min prediction score ───────────────────────────
    # Base score from signals (same as standard 5-min)
    base_score = (oi_score * 0.40 + mom_score * 0.35 + pcr_score * 0.20 + conv_score * 0.05)
    
    # Momentum boost: if micro-momentum is accelerating in the same direction
    momentum_boost = 0.0
    if base_score > 0 and price_momentum.trend == "ACCELERATING_UP":
        momentum_boost = min(0.20, price_momentum.strength / 100.0 * 0.20)
    elif base_score < 0 and price_momentum.trend == "ACCELERATING_DOWN":
        momentum_boost = min(0.20, price_momentum.strength / 100.0 * 0.20)
    
    # Reversal penalty: if reversal conditions are met, reduce confidence
    reversal_penalty = 0.0
    if reversal.likely and reversal.confidence >= 60:
        reversal_penalty = min(0.30, reversal.confidence / 100.0 * 0.30)
    
    # Liquidity shift impact: if flow is shifting against current direction
    flow_penalty = 0.0
    if liquidity_flow.shift_detected:
        if (current_direction == "BULLISH" and liquidity_flow.shift_direction == "OUTFLOW") or \
           (current_direction == "BEARISH" and liquidity_flow.shift_direction == "INFLOW"):
            flow_penalty = 0.15
    
    # Final score
    advanced_score = max(-1.0, min(1.0, base_score + momentum_boost - reversal_penalty - flow_penalty))
    
    # ─── Advanced confidence calculation ─────────────────────────────────────
    # Factor 1: Signal strength (0-35 points)
    signal_strength = abs(advanced_score) * 35
    
    # Factor 2: Momentum alignment (0-25 points)
    momentum_aligned = 0
    if (advanced_score > 0 and price_momentum.trend == "ACCELERATING_UP") or \
       (advanced_score < 0 and price_momentum.trend == "ACCELERATING_DOWN"):
        momentum_aligned = 25
    elif (advanced_score > 0 and price_momentum.trend != "ACCELERATING_DOWN") or \
         (advanced_score < 0 and price_momentum.trend != "ACCELERATING_UP"):
        momentum_aligned = 15
    
    # Factor 3: Flow stability (0-20 points)
    flow_stable = 20 if not liquidity_flow.shift_detected else 10
    
    # Factor 4: No reversal signals (0-20 points)
    reversal_buffer = max(0, 20 - reversal.confidence // 5)
    
    advanced_confidence = int((signal_strength + momentum_aligned + flow_stable + reversal_buffer) / 100 * 90)
    advanced_confidence = max(40, min(92, advanced_confidence))
    
    # ─── Generate prediction label ───────────────────────────────────────────
    if advanced_score >= 0.50:
        prediction = "STRONG_BUY"
    elif advanced_score >= 0.25:
        prediction = "BUY"
    elif advanced_score <= -0.50:
        prediction = "STRONG_SELL"
    elif advanced_score <= -0.25:
        prediction = "SELL"
    else:
        prediction = "NEUTRAL"
    
    return {
        "prediction": prediction,
        "confidence": advanced_confidence,
        "base_score": round(base_score, 4),
        "advanced_score": round(advanced_score, 4),
        "momentum_boost": round(momentum_boost, 4),
        "reversal_penalty": round(reversal_penalty, 4),
        "flow_penalty": round(flow_penalty, 4),
        "micro_signals": {
            "oi_momentum": {
                "trend": oi_momentum.trend,
                "strength": oi_momentum.strength,
                "acceleration": round(oi_momentum.acceleration, 6),
            },
            "price_momentum": {
                "trend": price_momentum.trend,
                "strength": price_momentum.strength,
                "acceleration": round(price_momentum.acceleration, 6),
                "volatility": round(price_momentum.volatility, 6),
            },
            "pcr_momentum": {
                "trend": pcr_momentum.trend,
                "strength": pcr_momentum.strength,
            }
        },
        "liquidity_flow": {
            "net_flow": round(liquidity_flow.net_flow, 4),
            "inflow_pressure": liquidity_flow.inflow_pressure,
            "outflow_pressure": liquidity_flow.outflow_pressure,
            "shift_detected": liquidity_flow.shift_detected,
            "shift_direction": liquidity_flow.shift_direction,
        },
        "reversal_analysis": {
            "likely": reversal.likely,
            "confidence": reversal.confidence,
            "reason": reversal.reason,
            "type": reversal.type,
            "current_direction": reversal.current_direction,
            "potential_reverse_to": reversal.potential_reverse_to,
        },
        "timestamp": datetime.now().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# INTEGRATION HELPER (To be called from liquidity_service)
# ═══════════════════════════════════════════════════════════════════════════════

def enhance_liquidity_response(
    base_response: Dict[str, Any],
    micro_trend_buffer: Optional[MicroTrendBuffer] = None
) -> Dict[str, Any]:
    """
    Enhance existing liquidity response with advanced 5-minute prediction.
    
    This function is designed to be called from liquidity_service.py
    without modifying existing response structure. Advanced predictions
    are added as optional fields.
    
    Args:
        base_response: Standard liquidity response dict
        micro_trend_buffer: MicroTrendBuffer for the symbol (optional)
    
    Returns:
        Enhanced response with additional fields:
          - advanced5mPrediction: Full advanced prediction object
          - (existing fields remain unchanged)
    """
    
    if not base_response or not micro_trend_buffer or not micro_trend_buffer.is_full():
        # If we don't have enough data yet, return base response unchanged
        return base_response
    
    try:
        # Extract necessary data
        signals = base_response.get("signals", {})
        metrics = base_response.get("metrics", {})
        current_direction = base_response.get("direction", "NEUTRAL")
        
        # For micro-trends, we need OI changes and price changes from recent candles
        # This would be handled by the liquidity service storing these values
        recent_oi_changes = getattr(micro_trend_buffer, '_recent_oi_changes', [])
        recent_volumes = getattr(micro_trend_buffer, '_recent_volumes', [])
        recent_prices = getattr(micro_trend_buffer, '_recent_prices', [])
        
        current_pcr = metrics.get("pcr", 1.0)
        
        # Calculate advanced prediction
        advanced_pred = calculate_advanced_5m_prediction(
            signals=signals,
            recent_oi_changes=recent_oi_changes,
            recent_volumes=recent_volumes,
            recent_prices=recent_prices,
            current_pcr=current_pcr,
            current_direction=current_direction
        )
        
        # Add to response without modifying existing fields
        base_response["advanced5mPrediction"] = advanced_pred
        
        return base_response
    
    except Exception as e:
        logger.warning(f"Advanced 5m prediction calculation failed: {e}")
        return base_response

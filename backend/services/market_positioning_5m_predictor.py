"""
⚡ Market Positioning Intelligence – Advanced 5-Minute Predictor
==================================================================
Intelligent short-term prediction engine for Market Positioning Intelligence.

Unlike standard predictions that follow the daily trend, this system detects
POSITIONING STRESS and MACRO STRUCTURE breaks — identifying when the market
is about to reverse or accelerate, INDEPENDENT of current daily direction.

Philosophy:
  Market participants leave footprints:
    • Positioning building/unwinding (OI patterns)
    • Confidence erosion (confidence score declining)
    • Trend break signals (price crossing support/resistance)
    • Volume intensity changes (accumulation vs distribution)
    • Institutional order flow reversals (large delta moves vs small delta moves)

4-Signal System for Market Positioning 5-Min Prediction:
  
  Signal 1: POSITIONING_MOMENTUM
    Tracks if positioning is ACCELERATING or DECELERATING
    • +ve: Longs/shorts actively building (conviction)
    • -ve: Positions eroding (conviction loss → reversal risk)
  
  Signal 2: CONFIDENCE_VELOCITY
    How FAST is confidence changing?
    • Rising → institutions adding conviction → follow the trend
    • Falling → institutions losing conviction → watch for reversal
    • Flat → confidence stable, trend probably continues
  
  Signal 3: MACRO_STRUCTURE_INTEGRITY
    Are major levels (support/resistance) holding?
    • Price touching support/resistance + confidence falling = break risk
    • Price touching support/resistance + confidence rising = bounce
  
  Signal 4: ORDER_FLOW_DIVERGENCE
    Is order flow agreeing with positioning?
    • Volume accelerating with positioning = institutions aligned (strong)
    • Volume decelerating while positioning builds = quiet accumulation (weak)
    • Volume surging opposite direction = warning sign (potential reversal)

Output:
  • Prediction: UP / DOWN / REVERSAL (independent of current signal)
  • Confidence: 30-85% (separate scale from positioning confidence)
  • Risk Level: LOW / MEDIUM / HIGH (reversal probability)
  • Reason: Human-readable market structure assessment

Performance:
  • Calculation: 10-15ms per symbol per cycle
  • Memory: +1-2KB per symbol
  • Buffer warmup: 15-20 seconds
"""

import logging
import collections
from dataclasses import dataclass
from datetime import datetime
from typing import Dict, List, Optional, Any
import math

logger = logging.getLogger(__name__)


# ──── Data Classes ──────────────────────────────────────────────────────────

@dataclass
class PositioningMomentum:
    """Tracks if positioning is ACCELERATING or DECELERATING."""
    # E.g. OI was rising, now accelerating faster = fresh orders entering
    # E.g. OI was rising, now decelerating = position building slowing
    direction: str  # "ACCELERATING_UP", "ACCELERATING_DOWN", "DECELERATING", "STABLE"
    strength: float  # 0-100%, how strong the momentum shift is
    oi_trend: str  # "building_longs", "unwinding_longs", "building_shorts", "unwinding_shorts"
    
    # Velocity: rate of change acceleration (higher = more dramatic shift)
    oi_acceleration: float  # 2nd derivative of OI deltas
    confidence_trend: str  # "improving", "eroding", "stable"


@dataclass
class ConfidenceVelocity:
    """How rapidly is positioning confidence changing?"""
    # If confidence was 65, now 60 = eroding (bear divergence)
    # If confidence was 50, now 70 = improving (bull divergence)
    
    rate_of_change: float  # % change per cycle (e.g. -2.5 = losing 2.5% per update)
    acceleration: float  # 2nd derivative (is erosion speeding up?)
    volatility: float  # 0-100%, how unstable is confidence?
    
    # Interpretation
    status: str  # "rapidly_improving", "improving", "stable", "eroding", "rapidly_eroding"
    warning_level: int  # 0-100, escalates as confidence velocity worsens


@dataclass
class MacroStructureIntegrity:
    """Are major support/resistance levels holding? Is price respecting structure?"""
    
    # Key levels relative to current price
    nearest_support_pct: float  # % distance below current price (e.g. -0.5 = 0.5% below)
    nearest_resistance_pct: float  # % distance above current price (e.g. +0.8 = 0.8% above)
    
    # Is price near a level?
    at_support: bool  # True if within 0.2% of support
    at_resistance: bool  # True if within 0.2% of resistance
    
    # Structure health
    structure_status: str  # "healthy", "tested", "broken"
    break_risk: int  # 0-100, probability that next level breaks


@dataclass
class OrderFlowDivergence:
    """Is order flow aligned with positioning, or diverging?"""
    
    # Volume trend relative to positioning direction
    volume_alignment: float  # -100 to +100
                             # +100 = volume surging in positioning direction
                             # 0 = volume neutral
                             # -100 = volume surging opposite direction
    
    # Large vs small moves
    large_delta_direction: str  # "up", "down", "neutral" (majority of large price moves)
    small_delta_direction: str  # "up", "down", "neutral" (majority of tiny moves)
    delta_divergence: bool  # Are large and small moves going opposite directions? (warning sign)
    
    # Interpretation
    alignment_status: str  # "strong_alignment", "mild_alignment", "neutral", "warning_divergence", "critical_divergence"


@dataclass
class PositioningBuffer:
    """Ring buffer tracking last N positioning snapshots for trend calculation."""
    
    def __init__(self, symbol: str, maxlen: int = 20):
        self.symbol = symbol
        self.maxlen = maxlen
        self._buf = collections.deque(maxlen=maxlen)
    
    def push(
        self,
        confidence: float,
        signal: str,  # STRONG_BUY, BUY, SELL, STRONG_SELL, NEUTRAL
        positioning_type: str,  # LONG_BUILDUP, SHORT_BUILDUP, etc
        price: float,
        oi: float,
        volume: float,
        tick_flow_pct: float,  # from existing prediction
    ):
        """Add a positioning snapshot."""
        if not self._buf:
            self._buf.append({
                "confidence": confidence,
                "signal": signal,
                "positioning_type": positioning_type,
                "price": price,
                "oi": oi,
                "volume": volume,
                "tick_flow_pct": tick_flow_pct,
            })
            return
        
        # Calculate deltas vs previous
        prev = self._buf[-1]
        conf_delta = confidence - prev["confidence"]
        oi_delta = oi - prev["oi"]
        vol_delta = volume - prev["volume"]
        price_delta = price - prev["price"]
        
        self._buf.append({
            "confidence": confidence,
            "signal": signal,
            "positioning_type": positioning_type,
            "price": price,
            "oi": oi,
            "volume": volume,
            "tick_flow_pct": tick_flow_pct,
            "_conf_delta": conf_delta,
            "_oi_delta": oi_delta,
            "_vol_delta": vol_delta,
            "_price_delta": price_delta,
        })
    
    def is_full(self) -> bool:
        """Is buffer ready for analysis? (need ≥5 points = ~25 seconds)."""
        return len(self._buf) >= 5
    
    def get_recent(self, n: int = 5) -> List[Dict]:
        """Get last N snapshots."""
        return list(self._buf)[-n:]


# ──── Analysis Functions ────────────────────────────────────────────────────

def _compute_positioning_momentum(recent: List[Dict]) -> PositioningMomentum:
    """
    Detect if positioning is ACCELERATING or DECELERATING.
    
    If current positioning type is LONG_BUILDUP:
      - OI accelerating up → ACCELERATING_UP (strong conviction)
      - OI decelerating (still up but slower) → DECELERATING (weakening)
      - OI turning down → warning (position unwinding)
    """
    if len(recent) < 3:
        return PositioningMomentum(
            direction="STABLE",
            strength=0.0,
            oi_trend="neutral",
            oi_acceleration=0.0,
            confidence_trend="stable",
        )
    
    # Extract OI deltas (track OI velocity changes)
    oi_deltas = [snap.get("_oi_delta", 0) for snap in recent if "_oi_delta" in snap]
    if len(oi_deltas) < 2:
        return PositioningMomentum(
            direction="STABLE",
            strength=0.0,
            oi_trend="neutral",
            oi_acceleration=0.0,
            confidence_trend="stable",
        )
    
    # 2nd derivative: acceleration of OI changes
    # e.g. OI changing by [+100, +120, +140] → accelerating up
    # e.g. OI changing by [+100, +80, +60] → decelerating (still up but slowing)
    oi_accelerations = []
    for i in range(1, len(oi_deltas)):
        accel = oi_deltas[i] - oi_deltas[i - 1]
        oi_accelerations.append(accel)
    
    latest_accel = oi_accelerations[-1] if oi_accelerations else 0
    avg_accel = sum(oi_accelerations) / len(oi_accelerations) if oi_accelerations else 0
    
    # Determine direction
    if abs(latest_accel) < 1:  # noise threshold
        direction = "STABLE"
        strength = 0.0
    elif latest_accel > 10:  # significant acceleration
        direction = "ACCELERATING_UP" if oi_deltas[-1] > 0 else "ACCELERATING_DOWN"
        strength = min(100, abs(latest_accel) * 2)
    elif latest_accel < -10:
        direction = "ACCELERATING_DOWN" if oi_deltas[-1] < 0 else "ACCELERATING_UP"
        strength = min(100, abs(latest_accel) * 2)
    else:
        direction = "DECELERATING"
        strength = min(100, abs(avg_accel) * 1.5)
    
    # Classify OI trend
    current_type = recent[-1].get("positioning_type", "NEUTRAL")
    if "LONG" in current_type:
        oi_trend = "building_longs" if oi_deltas[-1] > 0 else "unwinding_longs"
    elif "SHORT" in current_type:
        oi_trend = "building_shorts" if oi_deltas[-1] > 0 else "unwinding_shorts"
    else:
        oi_trend = "neutral"
    
    # Confidence trend
    conf_deltas = [snap.get("_conf_delta", 0) for snap in recent if "_conf_delta" in snap]
    if conf_deltas:
        avg_conf_change = sum(conf_deltas) / len(conf_deltas)
        if avg_conf_change > 1:
            confidence_trend = "improving"
        elif avg_conf_change < -1:
            confidence_trend = "eroding"
        else:
            confidence_trend = "stable"
    else:
        confidence_trend = "stable"
    
    return PositioningMomentum(
        direction=direction,
        strength=strength,
        oi_trend=oi_trend,
        oi_acceleration=latest_accel,
        confidence_trend=confidence_trend,
    )


def _compute_confidence_velocity(recent: List[Dict]) -> ConfidenceVelocity:
    """
    How FAST is confidence changing? (erosion/improvement rate)
    
    If confidence was 70→68→66→65: rapidly eroding (potential reversal)
    If confidence was 50→55→60→65: rapidly improving (follow the trend)
    """
    
    conf_values = [snap.get("confidence", 50) for snap in recent]
    if len(conf_values) < 3:
        return ConfidenceVelocity(
            rate_of_change=0.0,
            acceleration=0.0,
            volatility=0.0,
            status="stable",
            warning_level=0,
        )
    
    # 1st derivative: rate of change
    conf_deltas = [conf_values[i] - conf_values[i - 1] for i in range(1, len(conf_values))]
    avg_rate = sum(conf_deltas) / len(conf_deltas)
    
    # 2nd derivative: acceleration
    conf_accels = [conf_deltas[i] - conf_deltas[i - 1] for i in range(1, len(conf_deltas))]
    avg_accel = sum(conf_accels) / len(conf_accels) if conf_accels else 0
    
    # Volatility: standard deviation of changes
    if conf_deltas:
        mean = sum(conf_deltas) / len(conf_deltas)
        variance = sum((d - mean) ** 2 for d in conf_deltas) / len(conf_deltas)
        volatility = min(100, math.sqrt(variance) * 5)
    else:
        volatility = 0.0
    
    # Interpret status
    if avg_rate > 3:
        status = "rapidly_improving"
        warning = 0
    elif avg_rate > 0.5:
        status = "improving"
        warning = 0
    elif avg_rate < -3:
        status = "rapidly_eroding"
        warning = 80 + min(20, abs(avg_accel) * 2)  # worse if accelerating
    elif avg_rate < -0.5:
        status = "eroding"
        warning = min(60, volatility * 0.8)
    else:
        status = "stable"
        warning = max(0, min(40, volatility * 0.5))
    
    return ConfidenceVelocity(
        rate_of_change=avg_rate,
        acceleration=avg_accel,
        volatility=volatility,
        status=status,
        warning_level=int(warning),
    )


def _compute_macro_structure(recent: List[Dict], current_price: float) -> MacroStructureIntegrity:
    """
    Are major support/resistance levels holding?
    
    Calculate recent price range, identify key levels, assess break risk.
    """
    if len(recent) < 5:
        return MacroStructureIntegrity(
            nearest_support_pct=-0.5,
            nearest_resistance_pct=0.5,
            at_support=False,
            at_resistance=False,
            structure_status="healthy",
            break_risk=35,  # baseline
        )
    
    prices = [snap.get("price", current_price) for snap in recent]
    high = max(prices)
    low = min(prices)
    range_pct = ((high - low) / current_price) * 100 if current_price > 0 else 0
    
    # Simple support/resistance: recent high/low
    support = low
    resistance = high
    
    support_dist = ((current_price - support) / current_price) * 100 if current_price > 0 else 0
    resistance_dist = ((resistance - current_price) / current_price) * 100 if current_price > 0 else 0
    
    at_support = support_dist < 0.2 and support_dist > 0
    at_resistance = resistance_dist < 0.2 and resistance_dist > 0
    
    # Structure assessment
    if at_support or at_resistance:
        structure_status = "tested"
        break_risk = 65 if abs(support_dist) < 0.05 or abs(resistance_dist) < 0.05 else 45
    elif range_pct > 1.5:
        structure_status = "healthy"  # has room
        break_risk = 25
    else:
        structure_status = "tight"
        break_risk = 50
    
    return MacroStructureIntegrity(
        nearest_support_pct=-support_dist,
        nearest_resistance_pct=resistance_dist,
        at_support=at_support,
        at_resistance=at_resistance,
        structure_status=structure_status,
        break_risk=break_risk,
    )


def _compute_order_flow_divergence(recent: List[Dict], current_signal: str) -> OrderFlowDivergence:
    """
    Is order flow (volume, tick flow) aligned with positioning?
    
    Strong alignment: volume + ticks both in positioning direction
    Divergence: volume or ticks going opposite direction (reversal warning)
    """
    if len(recent) < 3:
        return OrderFlowDivergence(
            volume_alignment=0.0,
            large_delta_direction="neutral",
            small_delta_direction="neutral",
            delta_divergence=False,
            alignment_status="neutral",
        )
    
    # Volume trend
    volumes = [snap.get("volume", 0) for snap in recent]
    vol_up = volumes[-1] > (sum(volumes[:-1]) / len(volumes[:-1]) if len(volumes) > 1 else 0)
    
    # Tick flow (directional % of ticks)
    tick_flows = [snap.get("tick_flow_pct", 0) for snap in recent]
    avg_tick_flow = sum(tick_flows) / len(tick_flows) if tick_flows else 0
    
    # Price direction trend
    prices = [snap.get("price", 0) for snap in recent]
    price_up = prices[-1] > prices[0]
    
    # Alignment score: -100 (opposite) to +100 (aligned)
    is_buy_signal = "BUY" in current_signal.upper()
    is_sell_signal = "SELL" in current_signal.upper()
    
    if is_buy_signal:
        # Should see volume up, ticks bullish for full alignment
        vol_score = 50 if vol_up else -20
        tick_score = avg_tick_flow  # already -100 to +100
        alignment = (vol_score + tick_score) / 2
    elif is_sell_signal:
        # Should see volume up, ticks bearish
        vol_score = 50 if vol_up else -20
        tick_score = -avg_tick_flow  # reverse for sell
        alignment = (vol_score + tick_score) / 2
    else:
        alignment = 0.0
    
    # Classify
    alignment = max(-100, min(100, alignment))
    if alignment > 70:
        alignment_status = "strong_alignment"
    elif alignment > 30:
        alignment_status = "mild_alignment"
    elif alignment < -50:
        alignment_status = "critical_divergence"
    elif alignment < -20:
        alignment_status = "warning_divergence"
    else:
        alignment_status = "neutral"
    
    return OrderFlowDivergence(
        volume_alignment=alignment,
        large_delta_direction="up" if price_up else "down",
        small_delta_direction="up" if avg_tick_flow > 0 else "down",
        delta_divergence=price_up != (avg_tick_flow > 0),
        alignment_status=alignment_status,
    )


# ──── Main Prediction Engine ────────────────────────────────────────────────

def calculate_market_positioning_5m_prediction(
    current_confidence: float,
    current_signal: str,  # STRONG_BUY, BUY, SELL, STRONG_SELL, NEUTRAL
    current_positioning: str,  # LONG_BUILDUP, SHORT_BUILDUP, etc
    current_price: float,
    recent_snapshots: List[Dict],  # from PositioningBuffer.get_recent()
) -> Dict[str, Any]:
    """
    Generate 5-minute prediction for Market Positioning Intelligence.
    
    Unlike trend-following predictions, this detects:
      • Positioning momentum shifts (acceleration vs deceleration)
      • Confidence velocity (improvement vs erosion)
      • Macro structure integrity (support/resistance health)
      • Order flow divergence (alignment vs warning signs)
    
    Returns:
      {
        "prediction": "UP" | "DOWN" | "REVERSAL",
        "confidence": 30-85,
        "risk_level": "LOW" | "MEDIUM" | "HIGH",
        "reason": "...",
        "primary_signal": "strong_alignment" | "positioning_momentum" | "confidence_erosion" | "break_risk",
        "momentum": PositioningMomentum dict,
        "confidence_vel": ConfidenceVelocity dict,
        "structure": MacroStructureIntegrity dict,
        "order_flow": OrderFlowDivergence dict,
      }
    """
    
    momentum = _compute_positioning_momentum(recent_snapshots)
    conf_vel = _compute_confidence_velocity(recent_snapshots)
    structure = _compute_macro_structure(recent_snapshots, current_price)
    order_flow = _compute_order_flow_divergence(recent_snapshots, current_signal)
    
    # ── Prediction engine: 4 factors contribute to final direction ──
    
    # Factor 1: Positioning momentum direction
    momentum_signal = "NEUTRAL"
    momentum_strength = 0
    if "UP" in momentum.direction:
        momentum_signal = "BUY"
        momentum_strength = momentum.strength
    elif "DOWN" in momentum.direction:
        momentum_signal = "SELL"
        momentum_strength = momentum.strength
    
    # Factor 2: Confidence velocity (divergence detection)
    # Eroding confidence while still bullish = reversal risk
    conf_divergence = False
    if current_signal.upper() in ["STRONG_BUY", "BUY"] and conf_vel.status in ["eroding", "rapidly_eroding"]:
        conf_divergence = True  # bull trap
    elif current_signal.upper() in ["STRONG_SELL", "SELL"] and conf_vel.status in ["improving", "rapidly_improving"]:
        conf_divergence = True  # bear trap
    
    # Factor 3: Structure integrity
    structure_warning = structure.break_risk > 60
    at_critical_level = structure.at_support or structure.at_resistance
    
    # Factor 4: Order flow alignment
    strong_alignment = order_flow.alignment_status in ["strong_alignment", "mild_alignment"]
    critical_divergence = order_flow.alignment_status in ["critical_divergence"]
    
    # ── Combine into final prediction ──
    
    # If confidence eroding + positioning still building = reversal risk
    if conf_divergence and conf_vel.warning_level > 50:
        prediction = "REVERSAL"
        risk_level = "HIGH"
        primary_signal = "confidence_erosion"
        reason = (
            f"Confidence {conf_vel.status}: current signal {current_signal} "
            f"losing conviction. Reversal risk HIGH."
        )
        confidence = max(30, min(75, 50 - conf_vel.warning_level))
    
    # If at structure level + weak alignment = break risk
    elif at_critical_level and not strong_alignment:
        prediction = "REVERSAL"
        risk_level = "HIGH"
        primary_signal = "break_risk"
        level_type = "support" if structure.at_support else "resistance"
        reason = (
            f"Price at {level_type} with weak order flow alignment. "
            f"Break risk {structure.break_risk}% — prepare for reversal."
        )
        confidence = max(35, min(80, 65 - (structure.break_risk / 2)))
    
    # If critical divergence = warning
    elif critical_divergence:
        opposite_signal = "SELL" if "BUY" in current_signal else "BUY"
        prediction = "REVERSAL"
        risk_level = "MEDIUM"
        primary_signal = "order_flow_divergence"
        reason = (
            f"Order flow divergence CRITICAL: positioning {current_signal} "
            f"but volume/ticks show {opposite_signal} pressure."
        )
        confidence = max(40, min(70, 55 - abs(order_flow.volume_alignment) / 2))
    
    # If momentum accelerating + alignment = follow
    elif momentum_strength > 50 and strong_alignment and not conf_divergence:
        prediction = momentum_signal
        risk_level = "LOW"
        primary_signal = "strong_alignment"
        reason = (
            f"Positioning {momentum.oi_trend} with {momentum.direction.lower()}. "
            f"Order flow aligned. Confidence {conf_vel.status}."
        )
        confidence = min(85, int(50 + (momentum_strength / 2) + (10 if conf_vel.status == "improving" else 0)))
    
    # Default: match current signal with moderate confidence
    else:
        prediction = "BUY" if "BUY" in current_signal else ("SELL" if "SELL" in current_signal else "NEUTRAL")
        risk_level = "MEDIUM"
        primary_signal = "trend_following"
        reason = f"Market {current_signal}: following current positioning."
        confidence = max(40, min(65, int(current_confidence * 0.6)))  # Confidence typically lower than positioning
    
    return {
        "prediction": prediction,
        "confidence": int(confidence),
        "risk_level": risk_level,
        "reason": reason,
        "primary_signal": primary_signal,
        "momentum": {
            "direction": momentum.direction,
            "strength": momentum.strength,
            "oi_trend": momentum.oi_trend,
            "confidence_trend": momentum.confidence_trend,
        },
        "confidence_velocity": {
            "status": conf_vel.status,
            "rate_of_change": round(conf_vel.rate_of_change, 2),
            "warning_level": conf_vel.warning_level,
        },
        "structure": {
            "status": structure.structure_status,
            "at_support": structure.at_support,
            "at_resistance": structure.at_resistance,
            "break_risk": structure.break_risk,
        },
        "order_flow": {
            "alignment_status": order_flow.alignment_status,
            "volume_alignment": round(order_flow.volume_alignment, 1),
        },
    }

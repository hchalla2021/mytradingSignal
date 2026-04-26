"""
🕯️ Candle Intelligence Engine
===============================
Pro-grade candle analysis: Pattern Detection + Strength Classification + Market Intent.

CORE JOB: Convert raw OHLC data → Candle Strength + Market Intent → Trade Signal

ARCHITECTURE:
  - Pure computation, O(1) per candle, zero memory overhead
  - Reads from analysis_candles:{SYMBOL} cache (5-min OHLCV built by MarketFeedService)
  - Own isolated WebSocket manager, own asyncio loop
  - Broadcasts every 2s during LIVE, 30s during CLOSED

PATTERN LIBRARY (23 patterns):
  Single-candle: Hammer, Inverted Hammer, Shooting Star, Hanging Man, Doji,
                 Dragonfly Doji, Gravestone Doji, Spinning Top, Marubozu,
                 Long Lower Shadow, Long Upper Shadow
  Two-candle:    Bullish Engulfing, Bearish Engulfing, Piercing Line,
                 Dark Cloud Cover, Tweezer Bottom, Tweezer Top, Harami (Bull/Bear)
  Multi-candle:  Morning Star, Evening Star, Three White Soldiers, Three Black Crows

SIGNAL OUTPUT:
  pattern    → detected pattern name
  structure  → BULLISH_REVERSAL / BULLISH_CONTINUATION / BEARISH_REVERSAL / BEARISH_CONTINUATION / NEUTRAL
  strength   → STRONG / MODERATE / WEAK
  signal     → STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL
  body_ratio / upper_wick_ratio / lower_wick_ratio → raw candle anatomy
  multi_pattern_confluence → number of simultaneous confirming patterns
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from fastapi import WebSocket
import pytz

from services.cache import get_cache

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# Disk persistence for last good snapshot (survives server restart + market close)
_CANDLE_PERSIST_FILE = Path(__file__).resolve().parent.parent / "data" / "candle_intel_last_snapshot.json"


# ──────────────────────────────────────────────────────────────────────────────
# ENUMS
# ──────────────────────────────────────────────────────────────────────────────

STRUCTURES = {
    "BULLISH_REVERSAL",
    "BULLISH_CONTINUATION",
    "BEARISH_REVERSAL",
    "BEARISH_CONTINUATION",
    "NEUTRAL",
}

STRENGTHS = {"STRONG", "MODERATE", "WEAK"}

SIGNALS = {"STRONG_BUY", "BUY", "NEUTRAL", "SELL", "STRONG_SELL"}


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 1 — CANDLE ANATOMY (pure math, O(1))
# ──────────────────────────────────────────────────────────────────────────────

def _anatomy(c: Dict[str, float]) -> Dict[str, float]:
    """Decompose a candle into body, wicks, and ratios."""
    o, h, l, cl = c["open"], c["high"], c["low"], c["close"]
    body = abs(cl - o)
    rng = h - l
    upper_wick = h - max(o, cl)
    lower_wick = min(o, cl) - l

    if rng == 0:
        return {
            "body": 0, "range": 0,
            "upper_wick": 0, "lower_wick": 0,
            "body_ratio": 0, "upper_wick_ratio": 0, "lower_wick_ratio": 0,
            "is_bullish": cl >= o,
        }

    return {
        "body": body,
        "range": rng,
        "upper_wick": upper_wick,
        "lower_wick": lower_wick,
        "body_ratio": body / rng,
        "upper_wick_ratio": upper_wick / rng,
        "lower_wick_ratio": lower_wick / rng,
        "is_bullish": cl >= o,
    }


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 2 — STRENGTH ENGINE
# ──────────────────────────────────────────────────────────────────────────────

def _get_strength(a: Dict[str, float]) -> str:
    """
    Classify candle conviction from body dominance.
    body_ratio > 0.70 → STRONG   (institutional conviction)
    body_ratio > 0.40 → MODERATE (normal price action)
    else              → WEAK     (indecision / wick-heavy)
    """
    br = a["body_ratio"]
    if br > 0.70:
        return "STRONG"
    if br > 0.40:
        return "MODERATE"
    return "WEAK"


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 3 — PATTERN DETECTION ENGINE (23 patterns)
# ──────────────────────────────────────────────────────────────────────────────

# ── Single-candle patterns ───────────────────────────────────────────────────

def _is_doji(a: Dict) -> bool:
    return a["body_ratio"] < 0.10 and a["range"] > 0

def _is_dragonfly_doji(a: Dict) -> bool:
    return a["body_ratio"] < 0.10 and a["lower_wick_ratio"] > 0.60 and a["upper_wick_ratio"] < 0.10

def _is_gravestone_doji(a: Dict) -> bool:
    return a["body_ratio"] < 0.10 and a["upper_wick_ratio"] > 0.60 and a["lower_wick_ratio"] < 0.10

def _is_spinning_top(a: Dict) -> bool:
    return 0.10 <= a["body_ratio"] <= 0.30 and a["upper_wick_ratio"] > 0.25 and a["lower_wick_ratio"] > 0.25

def _is_hammer(a: Dict) -> bool:
    """Lower wick ≥ 2× body, tiny upper wick, body in upper third."""
    return (
        a["lower_wick"] > 2 * a["body"]
        and a["upper_wick"] < a["body"]
        and a["body_ratio"] > 0.05
        and a["lower_wick_ratio"] > 0.55
    )

def _is_inverted_hammer(a: Dict) -> bool:
    """Bullish only — long upper wick, small body at bottom."""
    return (
        a["upper_wick"] > 2 * a["body"]
        and a["lower_wick"] < a["body"]
        and a["body_ratio"] > 0.05
        and a["upper_wick_ratio"] > 0.55
        and a["is_bullish"]  # bullish candle only — bearish version is shooting star
    )

def _is_shooting_star(a: Dict) -> bool:
    """Bearish only — long upper wick, small body at bottom."""
    return (
        a["upper_wick"] > 2 * a["body"]
        and a["lower_wick"] < a["body"]
        and a["body_ratio"] > 0.05
        and a["upper_wick_ratio"] > 0.55
        and not a["is_bullish"]  # bearish candle only
    )

def _is_hanging_man(a: Dict) -> bool:
    """Bearish — same shape as hammer but bearish candle."""
    return (
        a["lower_wick"] > 2 * a["body"]
        and a["upper_wick"] < a["body"]
        and a["body_ratio"] > 0.05
        and a["lower_wick_ratio"] > 0.55
        and not a["is_bullish"]
    )

def _is_marubozu(a: Dict) -> bool:
    """No wicks — pure body candle. Maximum conviction."""
    return a["body_ratio"] > 0.90

def _is_long_lower_shadow(a: Dict) -> bool:
    return a["lower_wick_ratio"] > 0.55 and a["body_ratio"] > 0.15

def _is_long_upper_shadow(a: Dict) -> bool:
    return a["upper_wick_ratio"] > 0.55 and a["body_ratio"] > 0.15


# ── Two-candle patterns ─────────────────────────────────────────────────────

def _is_bullish_engulfing(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    return (
        not prev_a["is_bullish"]
        and curr_a["is_bullish"]
        and curr["close"] > prev["open"]
        and curr["open"] < prev["close"]
        and curr_a["body"] > prev_a["body"]
    )

def _is_bearish_engulfing(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    return (
        prev_a["is_bullish"]
        and not curr_a["is_bullish"]
        and curr["close"] < prev["open"]
        and curr["open"] > prev["close"]
        and curr_a["body"] > prev_a["body"]
    )

def _is_piercing_line(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    """Relaxed for 5-min: open below prev close (not necessarily below prev low)."""
    return (
        not prev_a["is_bullish"]
        and curr_a["is_bullish"]
        and curr["open"] <= prev["close"]
        and curr["close"] > (prev["open"] + prev["close"]) / 2
        and curr["close"] < prev["open"]
    )

def _is_dark_cloud_cover(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    """Relaxed for 5-min: open above prev close (not necessarily above prev high)."""
    return (
        prev_a["is_bullish"]
        and not curr_a["is_bullish"]
        and curr["open"] >= prev["close"]
        and curr["close"] < (prev["open"] + prev["close"]) / 2
        and curr["close"] > prev["open"]
    )

def _is_tweezer_bottom(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    threshold = prev_a["range"] * 0.05 if prev_a["range"] > 0 else 0.5
    return (
        not prev_a["is_bullish"]
        and curr_a["is_bullish"]
        and abs(prev["low"] - curr["low"]) <= threshold
    )

def _is_tweezer_top(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    threshold = prev_a["range"] * 0.05 if prev_a["range"] > 0 else 0.5
    return (
        prev_a["is_bullish"]
        and not curr_a["is_bullish"]
        and abs(prev["high"] - curr["high"]) <= threshold
    )

def _is_bullish_harami(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    return (
        not prev_a["is_bullish"]
        and curr_a["is_bullish"]
        and curr["close"] < prev["open"]
        and curr["open"] > prev["close"]
        and curr_a["body"] < prev_a["body"] * 0.6
    )

def _is_bearish_harami(prev_a: Dict, curr_a: Dict, prev: Dict, curr: Dict) -> bool:
    return (
        prev_a["is_bullish"]
        and not curr_a["is_bullish"]
        and curr["open"] < prev["close"]
        and curr["close"] > prev["open"]
        and curr_a["body"] < prev_a["body"] * 0.6
    )


# ── Three-candle patterns ───────────────────────────────────────────────────

def _is_morning_star(candles: List[Dict], anatomies: List[Dict]) -> bool:
    if len(candles) < 3:
        return False
    c0, c1, c2 = candles[-3], candles[-2], candles[-1]
    a0, a1, a2 = anatomies[-3], anatomies[-2], anatomies[-1]
    return (
        not a0["is_bullish"] and a0["body_ratio"] > 0.50
        and a1["body_ratio"] < 0.25  # small body / doji in middle
        and a2["is_bullish"] and a2["body_ratio"] > 0.40
        and c2["close"] > (c0["open"] + c0["close"]) / 2
    )

def _is_evening_star(candles: List[Dict], anatomies: List[Dict]) -> bool:
    if len(candles) < 3:
        return False
    c0, c1, c2 = candles[-3], candles[-2], candles[-1]
    a0, a1, a2 = anatomies[-3], anatomies[-2], anatomies[-1]
    return (
        a0["is_bullish"] and a0["body_ratio"] > 0.50
        and a1["body_ratio"] < 0.25
        and not a2["is_bullish"] and a2["body_ratio"] > 0.40
        and c2["close"] < (c0["open"] + c0["close"]) / 2
    )

def _is_three_white_soldiers(candles: List[Dict], anatomies: List[Dict]) -> bool:
    if len(candles) < 3:
        return False
    for i in range(-3, 0):
        if not anatomies[i]["is_bullish"] or anatomies[i]["body_ratio"] < 0.50:
            return False
    return candles[-2]["close"] > candles[-3]["close"] and candles[-1]["close"] > candles[-2]["close"]

def _is_three_black_crows(candles: List[Dict], anatomies: List[Dict]) -> bool:
    if len(candles) < 3:
        return False
    for i in range(-3, 0):
        if anatomies[i]["is_bullish"] or anatomies[i]["body_ratio"] < 0.50:
            return False
    return candles[-2]["close"] < candles[-3]["close"] and candles[-1]["close"] < candles[-2]["close"]


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 4 — STRUCTURE + SIGNAL MAPPING
# ──────────────────────────────────────────────────────────────────────────────

# pattern_name → (structure, bias_weight)
PATTERN_MAP: Dict[str, Tuple[str, float]] = {
    # Bullish reversal
    "HAMMER":             ("BULLISH_REVERSAL",       0.80),
    "INVERTED_HAMMER":    ("BULLISH_REVERSAL",       0.65),
    "BULLISH_ENGULFING":  ("BULLISH_REVERSAL",       0.90),
    "PIERCING_LINE":      ("BULLISH_REVERSAL",       0.75),
    "TWEEZER_BOTTOM":     ("BULLISH_REVERSAL",       0.70),
    "BULLISH_HARAMI":     ("BULLISH_REVERSAL",       0.55),
    "MORNING_STAR":       ("BULLISH_REVERSAL",       0.95),
    "DRAGONFLY_DOJI":     ("BULLISH_REVERSAL",       0.60),
    # Bullish continuation
    "THREE_WHITE_SOLDIERS": ("BULLISH_CONTINUATION", 0.90),
    "BULLISH_MARUBOZU":  ("BULLISH_CONTINUATION",    0.85),
    # Bearish reversal
    "SHOOTING_STAR":      ("BEARISH_REVERSAL",       0.80),
    "HANGING_MAN":        ("BEARISH_REVERSAL",       0.70),
    "BEARISH_ENGULFING":  ("BEARISH_REVERSAL",       0.90),
    "DARK_CLOUD_COVER":   ("BEARISH_REVERSAL",       0.75),
    "TWEEZER_TOP":        ("BEARISH_REVERSAL",       0.70),
    "BEARISH_HARAMI":     ("BEARISH_REVERSAL",       0.55),
    "EVENING_STAR":       ("BEARISH_REVERSAL",       0.95),
    "GRAVESTONE_DOJI":    ("BEARISH_REVERSAL",       0.60),
    # Bearish continuation
    "THREE_BLACK_CROWS":  ("BEARISH_CONTINUATION",   0.90),
    "BEARISH_MARUBOZU":   ("BEARISH_CONTINUATION",   0.85),
    # Neutral / indecision
    "DOJI":               ("NEUTRAL",                0.30),
    "SPINNING_TOP":       ("NEUTRAL",                0.25),
    "LONG_LOWER_SHADOW":  ("NEUTRAL",                0.35),
    "LONG_UPPER_SHADOW":  ("NEUTRAL",                0.35),
}


def _generate_signal(structure: str, strength: str, confluence: int, bias_weight: float) -> Tuple[str, int]:
    """
    Core decision engine — structure × strength × confluence → signal + confidence.

    Returns (signal, confidence 0-100).
    """
    base_conf = int(bias_weight * 100)

    # Confluence bonus: +8 per additional confirming pattern
    conf_bonus = min(20, (confluence - 1) * 8) if confluence > 1 else 0

    # Strength multiplier
    strength_mult = {"STRONG": 1.0, "MODERATE": 0.75, "WEAK": 0.50}.get(strength, 0.5)

    confidence = min(98, int(base_conf * strength_mult) + conf_bonus)

    if structure == "BULLISH_REVERSAL":
        if strength == "STRONG":
            return "STRONG_BUY", confidence
        return "BUY", confidence

    if structure == "BULLISH_CONTINUATION":
        if strength != "WEAK":
            return "BUY" if strength == "MODERATE" else "STRONG_BUY", confidence
        return "NEUTRAL", confidence

    if structure == "BEARISH_REVERSAL":
        if strength == "STRONG":
            return "STRONG_SELL", confidence
        return "SELL", confidence

    if structure == "BEARISH_CONTINUATION":
        if strength != "WEAK":
            return "SELL" if strength == "MODERATE" else "STRONG_SELL", confidence
        return "NEUTRAL", confidence

    return "NEUTRAL", max(15, confidence)


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 5 — MAIN ENGINE (stateless, pure function)
# ──────────────────────────────────────────────────────────────────────────────

def candle_engine(candles: List[Dict[str, float]]) -> Dict[str, Any]:
    """
    Main entry point. Accepts last N candles (newest last), returns full analysis.
    Minimum 1 candle required; 3+ candles enables multi-candle patterns.
    """
    if not candles:
        return _empty_result()

    # Compute anatomy for all candles
    anatomies = [_anatomy(c) for c in candles]
    curr = candles[-1]
    curr_a = anatomies[-1]

    prev = candles[-2] if len(candles) >= 2 else None
    prev_a = anatomies[-2] if len(anatomies) >= 2 else None

    # ── Detect all matching patterns ─────────────────────────────────────────
    detected: List[Tuple[str, str, float]] = []  # (name, structure, bias_weight)

    # Single-candle
    if _is_marubozu(curr_a):
        name = "BULLISH_MARUBOZU" if curr_a["is_bullish"] else "BEARISH_MARUBOZU"
        detected.append((name, *PATTERN_MAP[name]))
    if _is_hammer(curr_a):
        detected.append(("HAMMER", *PATTERN_MAP["HAMMER"]))
    if _is_inverted_hammer(curr_a):
        detected.append(("INVERTED_HAMMER", *PATTERN_MAP["INVERTED_HAMMER"]))
    if _is_shooting_star(curr_a):
        detected.append(("SHOOTING_STAR", *PATTERN_MAP["SHOOTING_STAR"]))
    if _is_hanging_man(curr_a):
        detected.append(("HANGING_MAN", *PATTERN_MAP["HANGING_MAN"]))
    if _is_dragonfly_doji(curr_a):
        detected.append(("DRAGONFLY_DOJI", *PATTERN_MAP["DRAGONFLY_DOJI"]))
    elif _is_gravestone_doji(curr_a):
        detected.append(("GRAVESTONE_DOJI", *PATTERN_MAP["GRAVESTONE_DOJI"]))
    elif _is_doji(curr_a):
        detected.append(("DOJI", *PATTERN_MAP["DOJI"]))
    if _is_spinning_top(curr_a):
        detected.append(("SPINNING_TOP", *PATTERN_MAP["SPINNING_TOP"]))
    if _is_long_lower_shadow(curr_a) and not _is_hammer(curr_a):
        detected.append(("LONG_LOWER_SHADOW", *PATTERN_MAP["LONG_LOWER_SHADOW"]))
    if _is_long_upper_shadow(curr_a) and not _is_shooting_star(curr_a):
        detected.append(("LONG_UPPER_SHADOW", *PATTERN_MAP["LONG_UPPER_SHADOW"]))

    # Two-candle
    if prev is not None and prev_a is not None:
        if _is_bullish_engulfing(prev_a, curr_a, prev, curr):
            detected.append(("BULLISH_ENGULFING", *PATTERN_MAP["BULLISH_ENGULFING"]))
        if _is_bearish_engulfing(prev_a, curr_a, prev, curr):
            detected.append(("BEARISH_ENGULFING", *PATTERN_MAP["BEARISH_ENGULFING"]))
        if _is_piercing_line(prev_a, curr_a, prev, curr):
            detected.append(("PIERCING_LINE", *PATTERN_MAP["PIERCING_LINE"]))
        if _is_dark_cloud_cover(prev_a, curr_a, prev, curr):
            detected.append(("DARK_CLOUD_COVER", *PATTERN_MAP["DARK_CLOUD_COVER"]))
        if _is_tweezer_bottom(prev_a, curr_a, prev, curr):
            detected.append(("TWEEZER_BOTTOM", *PATTERN_MAP["TWEEZER_BOTTOM"]))
        if _is_tweezer_top(prev_a, curr_a, prev, curr):
            detected.append(("TWEEZER_TOP", *PATTERN_MAP["TWEEZER_TOP"]))
        if _is_bullish_harami(prev_a, curr_a, prev, curr):
            detected.append(("BULLISH_HARAMI", *PATTERN_MAP["BULLISH_HARAMI"]))
        if _is_bearish_harami(prev_a, curr_a, prev, curr):
            detected.append(("BEARISH_HARAMI", *PATTERN_MAP["BEARISH_HARAMI"]))

    # Three-candle
    if len(candles) >= 3:
        if _is_morning_star(candles, anatomies):
            detected.append(("MORNING_STAR", *PATTERN_MAP["MORNING_STAR"]))
        if _is_evening_star(candles, anatomies):
            detected.append(("EVENING_STAR", *PATTERN_MAP["EVENING_STAR"]))
        if _is_three_white_soldiers(candles, anatomies):
            detected.append(("THREE_WHITE_SOLDIERS", *PATTERN_MAP["THREE_WHITE_SOLDIERS"]))
        if _is_three_black_crows(candles, anatomies):
            detected.append(("THREE_BLACK_CROWS", *PATTERN_MAP["THREE_BLACK_CROWS"]))

    # ── Pick the strongest pattern ───────────────────────────────────────────
    if not detected:
        # No pattern — classify raw candle direction
        structure = "NEUTRAL"
        pattern = None
        bias_weight = 0.20
        if curr_a["is_bullish"] and curr_a["body_ratio"] > 0.50:
            structure = "BULLISH_CONTINUATION"
            pattern = "BULLISH_CANDLE"
            bias_weight = 0.40
        elif not curr_a["is_bullish"] and curr_a["body_ratio"] > 0.50:
            structure = "BEARISH_CONTINUATION"
            pattern = "BEARISH_CANDLE"
            bias_weight = 0.40
    else:
        # Sort by bias_weight descending, pick strongest
        detected.sort(key=lambda x: x[2], reverse=True)
        pattern, structure, bias_weight = detected[0]

    strength = _get_strength(curr_a)
    confluence = len(detected)
    signal, confidence = _generate_signal(structure, strength, confluence, bias_weight)

    # ── Build all detected patterns list ─────────────────────────────────────
    all_patterns = [
        {"name": d[0], "structure": d[1], "weight": round(d[2], 2)}
        for d in detected
    ]

    # ── Trend context from recent candles ────────────────────────────────────
    trend_ctx = _compute_trend_context(candles, anatomies)

    # ── Live momentum override ────────────────────────────────────────────────
    # Root cause of "still STRONG_SELL during 30-min rally":
    # Single-candle patterns (e.g. THREE_BLACK_CROWS on a brief pullback within
    # a strong uptrend) override the broader momentum context. Fix: blend live
    # multi-anchor momentum score + trend_context direction into the final signal.
    live_price = curr.get("close", 0)
    if live_price > 0 and len(candles) >= 3:
        mom = _live_momentum_score(candles, live_price)
        trend_dir = trend_ctx["direction"]

        # Strong bullish momentum contradicts a bearish signal → flatten to NEUTRAL
        if mom >= 0.50 and signal in ("STRONG_SELL", "SELL"):
            signal = "NEUTRAL"
            confidence = min(confidence, 50)
        # Very strong bullish momentum + bullish trend → upgrade NEUTRAL to BUY
        elif mom >= 0.75 and trend_dir in ("STRONG_BULLISH", "BULLISH") and signal == "NEUTRAL":
            signal = "BUY"
            confidence = min(75, confidence + 20)
        # Strong bearish momentum contradicts a bullish signal → flatten to NEUTRAL
        elif mom <= -0.50 and signal in ("STRONG_BUY", "BUY"):
            signal = "NEUTRAL"
            confidence = min(confidence, 50)
        # Very strong bearish momentum + bearish trend → downgrade NEUTRAL to SELL
        elif mom <= -0.75 and trend_dir in ("STRONG_BEARISH", "BEARISH") and signal == "NEUTRAL":
            signal = "SELL"
            confidence = min(75, confidence + 20)

    return {
        "pattern": pattern,
        "all_patterns": all_patterns,
        "structure": structure,
        "strength": strength,
        "signal": signal,
        "confidence": confidence,
        "confluence": confluence,
        "candle": {
            "open": curr["open"],
            "high": curr["high"],
            "low": curr["low"],
            "close": curr["close"],
            "body_ratio": round(curr_a["body_ratio"], 3),
            "upper_wick_ratio": round(curr_a["upper_wick_ratio"], 3),
            "lower_wick_ratio": round(curr_a["lower_wick_ratio"], 3),
            "is_bullish": curr_a["is_bullish"],
        },
        "trend_context": trend_ctx,
    }


def _live_momentum_score(candles: List[Dict], live_price: float) -> float:
    """
    Multi-anchor live momentum score: -1.0 (strong bearish) to +1.0 (strong bullish).
    Compares live price vs completed candle closes at 4 lookback depths.
    Prevents single-candle pattern signals from contradicting 30-min sustained moves.
    """
    if len(candles) < 2 or live_price <= 0:
        return 0.0

    # Use only completed candles for anchors (exclude the live/current candle)
    completed = candles[:-1] if candles[-1].get("_live") else candles
    closes = [float(c.get("close") or 0) for c in completed if float(c.get("close") or 0) > 0]
    if not closes:
        return 0.0

    # Weighted anchor comparison — heavier weight on recent anchors
    anchors = [(1, 4), (3, 3), (5, 2), (8, 1)]  # (lookback_candles_ago, weight)
    num, den = 0.0, 0.0
    for lb, w in anchors:
        if lb <= len(closes):
            ref = closes[-lb]
            if ref > 0:
                pct = (live_price - ref) / ref * 100.0
                # ±0.3% = full score — captures small intraday moves precisely
                clamped = max(-1.0, min(1.0, pct / 0.3))
                num += clamped * w
                den += w
    if den == 0:
        return 0.0
    anchor_score = num / den

    # Supplement with recent candle direction (last 6, newest 3 weighted 2×)
    recent = completed[-6:] if len(completed) >= 6 else completed
    n_r = len(recent)
    bull_w = bear_w = 0.0
    for i, c in enumerate(recent):
        wt = 2.0 if i >= n_r - 3 else 1.0
        if float(c.get("close") or 0) >= float(c.get("open") or 0):
            bull_w += wt
        else:
            bear_w += wt
    total = bull_w + bear_w
    candle_dir = (bull_w - bear_w) / total if total > 0 else 0.0

    # 70% live-price-anchor, 30% candle-direction-bias
    return max(-1.0, min(1.0, anchor_score * 0.70 + candle_dir * 0.30))


def _compute_trend_context(candles: List[Dict], anatomies: List[Dict]) -> Dict[str, Any]:
    """Compute short-term trend from last 8 candles (extended from 5 for better context)."""
    n = min(8, len(candles))
    if n < 2:
        return {"direction": "NEUTRAL", "bullish_count": 0, "bearish_count": 0, "avg_body_ratio": 0}

    recent_a = anatomies[-n:]
    bull_count = sum(1 for a in recent_a if a["is_bullish"])
    bear_count = n - bull_count
    avg_br = sum(a["body_ratio"] for a in recent_a) / n

    # Recency-weighted direction: newest 3 candles count 2× in decision
    newest_3 = anatomies[-3:] if len(anatomies) >= 3 else anatomies
    recent_bull_w = sum(2.0 if a["is_bullish"] else 0.0 for a in newest_3)
    recent_bear_w = sum(2.0 if not a["is_bullish"] else 0.0 for a in newest_3)
    # Blend: 60% overall count + 40% recency-weighted newest-3
    blended_bull = bull_count * 0.60 + recent_bull_w * 0.40
    blended_bear = bear_count * 0.60 + recent_bear_w * 0.40

    if blended_bull >= n * 0.75:
        direction = "STRONG_BULLISH"
    elif blended_bull > blended_bear * 1.2:
        direction = "BULLISH"
    elif blended_bear >= n * 0.75:
        direction = "STRONG_BEARISH"
    elif blended_bear > blended_bull * 1.2:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    return {
        "direction": direction,
        "bullish_count": bull_count,
        "bearish_count": bear_count,
        "avg_body_ratio": round(avg_br, 3),
        "candles_analyzed": n,
    }


def _empty_result() -> Dict[str, Any]:
    return {
        "pattern": None,
        "all_patterns": [],
        "structure": "NEUTRAL",
        "strength": "WEAK",
        "signal": "NEUTRAL",
        "confidence": 0,
        "confluence": 0,
        "candle": None,
        "trend_context": {"direction": "NEUTRAL", "bullish_count": 0, "bearish_count": 0, "avg_body_ratio": 0},
        "three_factor": _empty_3fa(),
    }


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 7 — 3FA (3 FACTOR ALIGNMENT MODEL)
# ──────────────────────────────────────────────────────────────────────────────
#
# Factor 1: LOCATION  — Where price is (PDH / PDL / VWAP)
# Factor 2: BEHAVIOR  — What price is doing (Rejection / Absorption / Breakout)
# Factor 3: CONFIRMATION — Is it real? (Volume above avg + candle body strength)
#
# Final Rule:
#   BUY  only if: near PDH + (absorption|breakout) + strong candle + high volume
#   SELL only if: near PDL + (absorption|breakout) + strong candle + high volume
#   If ANY factor missing → NO TRADE
# ──────────────────────────────────────────────────────────────────────────────

# Proximity threshold: price within 0.3% of level = "near"
_LOCATION_PROXIMITY_PCT = 0.003
# Mid-zone: price more than 30% away from both PDH and PDL within the range
_MIDZONE_PCT = 0.30
# Volume: ratio above this = "above average"
_VOLUME_ABOVE_AVG_RATIO = 1.0
# Candle body strength: body_ratio above this = strong candle for confirmation
_CONFIRMATION_BODY_RATIO = 0.50
# Close-near-high threshold (for bullish confirmation): close within top 25% of range
_CLOSE_NEAR_HIGH_PCT = 0.25
# Close-near-low threshold (for bearish confirmation): close within bottom 25% of range
_CLOSE_NEAR_LOW_PCT = 0.25
# Absorption detection: small body candles holding near level (body_ratio < this)
_ABSORPTION_BODY_MAX = 0.35
# Breakout: strong candle closing beyond level (body_ratio > this)
_BREAKOUT_BODY_MIN = 0.50


def _compute_location(
    price: float,
    pdh: Optional[float],
    pdl: Optional[float],
    vwap: Optional[float],
) -> Dict[str, Any]:
    """
    Factor 1: LOCATION — classify where price sits relative to PDH / PDL / VWAP.

    Returns:
      zone: "NEAR_PDH" | "NEAR_PDL" | "ABOVE_PDH" | "BELOW_PDL" | "MID_ZONE" | "UNKNOWN"
      pdh / pdl / vwap: the reference values
      distance_to_pdh / distance_to_pdl: signed % distance
      vwap_position: "ABOVE" | "BELOW" | "AT" | None
      tradeable: bool — False for MID_ZONE / UNKNOWN
    """
    if not price or price <= 0:
        return {"zone": "UNKNOWN", "pdh": pdh, "pdl": pdl, "vwap": vwap,
                "distance_to_pdh": None, "distance_to_pdl": None,
                "vwap_position": None, "tradeable": False}

    dist_pdh = ((price - pdh) / pdh) if pdh and pdh > 0 else None
    dist_pdl = ((price - pdl) / pdl) if pdl and pdl > 0 else None

    zone = "UNKNOWN"
    tradeable = False

    if pdh and pdl and pdh > pdl:
        day_range = pdh - pdl
        mid_low = pdl + day_range * _MIDZONE_PCT
        mid_high = pdh - day_range * _MIDZONE_PCT

        if price > pdh and dist_pdh is not None and dist_pdh <= _LOCATION_PROXIMITY_PCT * 3:
            zone = "ABOVE_PDH"
            tradeable = True
        elif dist_pdh is not None and abs(dist_pdh) <= _LOCATION_PROXIMITY_PCT:
            zone = "NEAR_PDH"
            tradeable = True
        elif price < pdl and dist_pdl is not None and abs(dist_pdl) <= _LOCATION_PROXIMITY_PCT * 3:
            zone = "BELOW_PDL"
            tradeable = True
        elif dist_pdl is not None and abs(dist_pdl) <= _LOCATION_PROXIMITY_PCT:
            zone = "NEAR_PDL"
            tradeable = True
        elif mid_low <= price <= mid_high:
            zone = "MID_ZONE"
            tradeable = False
        elif price > mid_high:
            zone = "NEAR_PDH"
            tradeable = True
        elif price < mid_low:
            zone = "NEAR_PDL"
            tradeable = True
    elif pdh and dist_pdh is not None:
        if abs(dist_pdh) <= _LOCATION_PROXIMITY_PCT:
            zone = "NEAR_PDH"
            tradeable = True
    elif pdl and dist_pdl is not None:
        if abs(dist_pdl) <= _LOCATION_PROXIMITY_PCT:
            zone = "NEAR_PDL"
            tradeable = True

    vwap_pos = None
    if vwap and vwap > 0 and price > 0:
        vwap_dev = (price - vwap) / vwap
        if vwap_dev > 0.002:
            vwap_pos = "ABOVE"
        elif vwap_dev < -0.002:
            vwap_pos = "BELOW"
        else:
            vwap_pos = "AT"

    return {
        "zone": zone,
        "pdh": round(pdh, 2) if pdh else None,
        "pdl": round(pdl, 2) if pdl else None,
        "vwap": round(vwap, 2) if vwap else None,
        "distance_to_pdh": round(dist_pdh * 100, 3) if dist_pdh is not None else None,
        "distance_to_pdl": round(dist_pdl * 100, 3) if dist_pdl is not None else None,
        "vwap_position": vwap_pos,
        "tradeable": tradeable,
    }


def _compute_behavior(
    candles: List[Dict[str, float]],
    anatomies: List[Dict[str, float]],
    location_zone: str,
    pdh: Optional[float],
    pdl: Optional[float],
) -> Dict[str, Any]:
    """
    Factor 2: BEHAVIOR — what price is doing at the current location.

    3 Behaviors:
      REJECTION   — wicks rejecting level (long wick into level, body retreating)
      ABSORPTION  — small candles holding near level, not falling (accumulation before breakout)
      BREAKOUT    — strong candle closing beyond the level
      NONE        — no clear behavior

    Uses last 3 candles for absorption detection.
    """
    if not candles or not anatomies:
        return {"type": "NONE", "description": "Insufficient data", "strength": 0}

    curr = candles[-1]
    curr_a = anatomies[-1]
    price = curr.get("close", 0)
    behavior_type = "NONE"
    description = "No clear behavior at current level"
    strength = 0  # 0-100

    is_near_pdh = location_zone in ("NEAR_PDH", "ABOVE_PDH")
    is_near_pdl = location_zone in ("NEAR_PDL", "BELOW_PDL")

    if is_near_pdh and pdh and pdh > 0:
        # ── Check BREAKOUT above PDH ──
        if (curr_a["is_bullish"]
                and curr_a["body_ratio"] >= _BREAKOUT_BODY_MIN
                and price > pdh):
            behavior_type = "BREAKOUT"
            description = f"Strong bullish close above PDH ({pdh:.0f})"
            strength = min(100, int(curr_a["body_ratio"] * 100) + 20)

        # ── Check MOMENTUM above PDH (continuation after breakout) ──
        elif price > pdh and len(candles) >= 2:
            recent_a = anatomies[-min(3, len(anatomies)):]
            recent_bull = sum(1 for a in recent_a if a["is_bullish"])
            recent_bear = sum(1 for a in recent_a if not a["is_bullish"])
            avg_body = sum(a["body_ratio"] for a in recent_a) / len(recent_a) if recent_a else 0
            if recent_bull >= 2 and curr_a["is_bullish"] and avg_body >= 0.30:
                behavior_type = "MOMENTUM"
                description = f"Bullish momentum above PDH ({pdh:.0f})"
                strength = min(90, int(avg_body * 100) + 15)
            elif recent_bear >= 2 and not curr_a["is_bullish"] and avg_body >= 0.30:
                behavior_type = "MOMENTUM"
                description = f"Bearish pullback from above PDH ({pdh:.0f})"
                strength = min(90, int(avg_body * 100) + 15)
            elif curr_a["body_ratio"] >= 0.40:
                if curr_a["is_bullish"]:
                    behavior_type = "MOMENTUM"
                    description = f"Bullish continuation above PDH ({pdh:.0f})"
                    strength = min(85, int(curr_a["body_ratio"] * 100) + 10)
                else:
                    behavior_type = "MOMENTUM"
                    description = f"Bearish pullback above PDH ({pdh:.0f})"
                    strength = min(85, int(curr_a["body_ratio"] * 100) + 10)

        # ── Check ABSORPTION near PDH ──
        if behavior_type == "NONE" and len(candles) >= 3:
            recent_a = anatomies[-3:]
            small_bodies = sum(1 for a in recent_a if a["body_ratio"] < _ABSORPTION_BODY_MAX)
            # Wider proximity for ABOVE_PDH — already broken through
            prox = _LOCATION_PROXIMITY_PCT * (4 if location_zone == "ABOVE_PDH" else 2)
            holding_near = all(
                abs(c.get("close", 0) - pdh) / pdh < prox
                for c in candles[-3:]
            ) if pdh > 0 else False
            if small_bodies >= 2 and holding_near:
                behavior_type = "ABSORPTION"
                description = f"Price absorbing near PDH ({pdh:.0f}) — breakout building"
                strength = min(85, 50 + small_bodies * 10)

        # ── Check REJECTION from PDH ──
        if behavior_type == "NONE":
            if curr_a["upper_wick_ratio"] > 0.35 and not curr_a["is_bullish"]:
                behavior_type = "REJECTION"
                description = f"Wick rejection from PDH ({pdh:.0f}) — sellers strong"
                strength = min(90, int(curr_a["upper_wick_ratio"] * 100) + 10)
            elif not curr_a["is_bullish"] and curr_a["body_ratio"] >= 0.50:
                behavior_type = "REJECTION"
                description = f"Bearish reversal near PDH ({pdh:.0f})"
                strength = min(80, int(curr_a["body_ratio"] * 100))
            # Check lower wick bounce (bullish defense at PDH area)  
            elif curr_a["lower_wick_ratio"] > 0.35 and curr_a["is_bullish"]:
                behavior_type = "REJECTION"
                description = f"Buyers defending near PDH ({pdh:.0f})"
                strength = min(80, int(curr_a["lower_wick_ratio"] * 100) + 5)
            # Indecision candle near level = absorption-like
            elif curr_a["body_ratio"] < 0.20 and len(candles) >= 2:
                behavior_type = "ABSORPTION"
                description = f"Indecision near PDH ({pdh:.0f}) — waiting for direction"
                strength = min(50, 30 + int((1 - curr_a["body_ratio"]) * 30))

    elif is_near_pdl and pdl and pdl > 0:
        # ── Check BREAKOUT below PDL (breakdown) ──
        if (not curr_a["is_bullish"]
                and curr_a["body_ratio"] >= _BREAKOUT_BODY_MIN
                and price < pdl):
            behavior_type = "BREAKOUT"
            description = f"Strong bearish close below PDL ({pdl:.0f})"
            strength = min(100, int(curr_a["body_ratio"] * 100) + 20)

        # ── Check MOMENTUM below PDL (bearish continuation or bullish bounce) ──
        elif price < pdl and len(candles) >= 2:
            recent_a = anatomies[-min(3, len(anatomies)):]
            recent_bear = sum(1 for a in recent_a if not a["is_bullish"])
            recent_bull = sum(1 for a in recent_a if a["is_bullish"])
            avg_body = sum(a["body_ratio"] for a in recent_a) / len(recent_a) if recent_a else 0
            # Accept momentum if avg body across recent candles is decent (not just current)
            if recent_bear >= 2 and not curr_a["is_bullish"] and avg_body >= 0.30:
                behavior_type = "MOMENTUM"
                description = f"Bearish momentum below PDL ({pdl:.0f})"
                strength = min(90, int(avg_body * 100) + 15)
            elif recent_bull >= 2 and curr_a["is_bullish"] and avg_body >= 0.30:
                behavior_type = "MOMENTUM"
                description = f"Bullish bounce from below PDL ({pdl:.0f})"
                strength = min(90, int(avg_body * 100) + 15)
            # Single strong candle also qualifies
            elif curr_a["body_ratio"] >= 0.40:
                if curr_a["is_bullish"]:
                    behavior_type = "MOMENTUM"
                    description = f"Bullish momentum below PDL ({pdl:.0f})"
                    strength = min(85, int(curr_a["body_ratio"] * 100) + 10)
                else:
                    behavior_type = "MOMENTUM"
                    description = f"Bearish continuation below PDL ({pdl:.0f})"
                    strength = min(85, int(curr_a["body_ratio"] * 100) + 10)

        # ── Check ABSORPTION near PDL (bounce building) ──
        if behavior_type == "NONE" and len(candles) >= 3:
            recent_a = anatomies[-3:]
            small_bodies = sum(1 for a in recent_a if a["body_ratio"] < _ABSORPTION_BODY_MAX)
            # Wider proximity for BELOW_PDL — already broken through
            prox = _LOCATION_PROXIMITY_PCT * (4 if location_zone == "BELOW_PDL" else 2)
            holding_near = all(
                abs(c.get("close", 0) - pdl) / pdl < prox
                for c in candles[-3:]
            ) if pdl > 0 else False
            if small_bodies >= 2 and holding_near:
                behavior_type = "ABSORPTION"
                description = f"Price absorbing near PDL ({pdl:.0f}) — bounce building"
                strength = min(85, 50 + small_bodies * 10)

        # ── Check REJECTION from PDL (bounce) ──
        if behavior_type == "NONE":
            if curr_a["lower_wick_ratio"] > 0.35 and curr_a["is_bullish"]:
                behavior_type = "REJECTION"
                description = f"Wick rejection from PDL ({pdl:.0f}) — buyers strong"
                strength = min(90, int(curr_a["lower_wick_ratio"] * 100) + 10)
            elif curr_a["is_bullish"] and curr_a["body_ratio"] >= 0.50:
                behavior_type = "REJECTION"
                description = f"Bullish reversal near PDL ({pdl:.0f})"
                strength = min(80, int(curr_a["body_ratio"] * 100))
            # Check upper wick rejection (bearish push down from PDL area)
            elif curr_a["upper_wick_ratio"] > 0.35 and not curr_a["is_bullish"]:
                behavior_type = "REJECTION"
                description = f"Rejection below PDL ({pdl:.0f}) — sellers in control"
                strength = min(80, int(curr_a["upper_wick_ratio"] * 100) + 5)
            # Indecision candles near a level = absorption-like (small bodies holding)
            elif curr_a["body_ratio"] < 0.20 and len(candles) >= 2:
                behavior_type = "ABSORPTION"
                description = f"Indecision near PDL ({pdl:.0f}) — waiting for direction"
                strength = min(50, 30 + int((1 - curr_a["body_ratio"]) * 30))

    return {
        "type": behavior_type,
        "description": description,
        "strength": strength,
    }


def _compute_confirmation(
    curr_a: Dict[str, float],
    curr_candle: Dict[str, float],
    candles: List[Dict[str, float]],
    volume: Optional[int],
    avg_volume: Optional[float],
) -> Dict[str, Any]:
    """
    Factor 3: CONFIRMATION — validates the move is real.

    Two checks:
      1. Volume above average → real move
      2. Candle strength: big body + close near high (bullish) or near low (bearish)

    Returns confirmation dict with pass/fail for each check and overall confirmed bool.
    """
    # ── Volume check ──
    vol_ratio = 0.0
    volume_confirmed = False
    if volume and avg_volume and avg_volume > 0:
        vol_ratio = volume / avg_volume
        volume_confirmed = vol_ratio >= _VOLUME_ABOVE_AVG_RATIO
    elif volume and volume > 0:
        # No average available — check against recent candle volumes
        recent_vols = [c.get("volume", 0) for c in candles[-10:] if c.get("volume", 0) > 0]
        if recent_vols:
            avg_recent = sum(recent_vols) / len(recent_vols)
            if avg_recent > 0:
                vol_ratio = volume / avg_recent
                volume_confirmed = vol_ratio >= _VOLUME_ABOVE_AVG_RATIO

    # ── Candle strength check ──
    body_strong = curr_a["body_ratio"] >= _CONFIRMATION_BODY_RATIO
    rng = curr_a["range"]
    close_val = curr_candle.get("close", 0)
    high_val = curr_candle.get("high", 0)
    low_val = curr_candle.get("low", 0)

    if rng > 0 and curr_a["is_bullish"]:
        # Bullish: close should be near the high
        close_near_high = (high_val - close_val) / rng <= _CLOSE_NEAR_HIGH_PCT
    elif rng > 0 and not curr_a["is_bullish"]:
        # Bearish: close should be near the low
        close_near_high = (close_val - low_val) / rng <= _CLOSE_NEAR_LOW_PCT
    else:
        close_near_high = False

    candle_confirmed = body_strong and close_near_high

    overall = volume_confirmed and candle_confirmed

    return {
        "volume_ratio": round(vol_ratio, 2),
        "volume_confirmed": volume_confirmed,
        "body_strong": body_strong,
        "close_near_extreme": close_near_high,
        "candle_confirmed": candle_confirmed,
        "confirmed": overall,
    }


def _compute_vwap_from_candles(candles: List[Dict[str, float]]) -> Optional[float]:
    """Compute VWAP from candle data: sum(typical_price * volume) / sum(volume)."""
    total_tpv = 0.0
    total_vol = 0
    for c in candles:
        vol = c.get("volume", 0)
        if vol <= 0:
            continue
        typical = (c.get("high", 0) + c.get("low", 0) + c.get("close", 0)) / 3
        total_tpv += typical * vol
        total_vol += vol
    if total_vol > 0:
        return total_tpv / total_vol
    return None


def compute_3fa(
    candles: List[Dict[str, float]],
    anatomies: List[Dict[str, float]],
    price: float,
    pdh: Optional[float],
    pdl: Optional[float],
    vwap: Optional[float],
    volume: Optional[int],
    avg_volume: Optional[float],
) -> Dict[str, Any]:
    """
    3 Factor Alignment Model — combines Location + Behavior + Confirmation.

    Returns the full 3FA analysis dict including:
      - location, behavior, confirmation (individual factors)
      - aligned: bool — all 3 factors confirm
      - verdict: "BUY" | "SELL" | "NO_TRADE"
      - reason: human-readable explanation
      - alignment_score: 0-3 (how many factors pass)
    """
    if not candles or not anatomies:
        return _empty_3fa()

    # Compute VWAP from candles if not provided
    if vwap is None:
        vwap = _compute_vwap_from_candles(candles)

    curr = candles[-1]
    curr_a = anatomies[-1]

    # ── Factor 1: Location ──
    location = _compute_location(price, pdh, pdl, vwap)

    # ── Factor 2: Behavior ──
    behavior = _compute_behavior(candles, anatomies, location["zone"], pdh, pdl)

    # ── Factor 3: Confirmation ──
    confirmation = _compute_confirmation(curr_a, curr, candles, volume, avg_volume)

    # ── Alignment Logic ──
    score = 0
    factors_pass = []
    factors_fail = []

    # Factor 1 passes if location is tradeable (not mid-zone/unknown)
    if location["tradeable"]:
        score += 1
        factors_pass.append("LOCATION")
    else:
        factors_fail.append("LOCATION")

    # Factor 2 passes if behavior is actionable (not NONE)
    _btype = behavior["type"]
    if _btype in ("ABSORPTION", "BREAKOUT", "REJECTION", "MOMENTUM"):
        score += 1
        factors_pass.append("BEHAVIOR")
    else:
        factors_fail.append("BEHAVIOR")

    # Factor 3 passes if candle confirmed OR volume confirmed with decent body
    # For cash indices (no volume data), use relaxed candle-only confirmation
    _cc = confirmation["confirmed"]
    _ccc = confirmation["candle_confirmed"]
    _vc = confirmation["volume_confirmed"]
    _br = curr_a["body_ratio"]
    _no_vol = confirmation["volume_ratio"] == 0  # No volume data available
    if _cc:
        score += 1
        factors_pass.append("CONFIRMATION")
    elif _ccc or (_vc and _br >= 0.35):
        score += 1
        factors_pass.append("CONFIRMATION")
    elif _no_vol and (_br >= 0.30 or confirmation["close_near_extreme"]):
        # Cash index fallback: no volume data available, accept body or close position
        score += 1
        factors_pass.append("CONFIRMATION")
    else:
        factors_fail.append("CONFIRMATION")

    # ── Verdict ──
    aligned = score == 3
    zone = location["zone"]

    if aligned:
        btype = behavior["type"]
        if zone in ("NEAR_PDH", "ABOVE_PDH"):
            if btype == "BREAKOUT" or btype == "MOMENTUM":
                verdict = "BUY"
                reason = f"All aligned — bullish {btype.lower()} above PDH"
            elif btype == "ABSORPTION":
                verdict = "BUY"
                reason = f"All aligned — absorption at PDH, breakout imminent"
            elif btype == "REJECTION":
                verdict = "SELL"
                reason = f"All aligned — rejection from PDH, reversal likely"
            else:
                verdict = "NO_TRADE"
                reason = "Factors aligned but direction unclear"
        elif zone in ("NEAR_PDL", "BELOW_PDL"):
            if btype == "BREAKOUT":
                verdict = "SELL"
                reason = f"All aligned — breakdown below PDL"
            elif btype == "MOMENTUM":
                # Momentum below PDL: direction depends on candle
                if curr_a["is_bullish"]:
                    verdict = "BUY"
                    reason = f"All aligned — bullish bounce from below PDL"
                else:
                    verdict = "SELL"
                    reason = f"All aligned — bearish momentum below PDL"
            elif btype == "ABSORPTION":
                verdict = "SELL"
                reason = f"All aligned — absorption at PDL, breakdown imminent"
            elif btype == "REJECTION":
                verdict = "BUY"
                reason = f"All aligned — rejection from PDL, bounce likely"
            else:
                verdict = "NO_TRADE"
                reason = "Factors aligned but direction unclear"
        else:
            verdict = "NO_TRADE"
            reason = "Factors aligned but zone unclear"
    elif score >= 2:
        # Partial alignment — show directional bias without full conviction
        btype = behavior["type"]
        if zone in ("NEAR_PDH", "ABOVE_PDH") and btype in ("BREAKOUT", "MOMENTUM"):
            verdict = "BUY"
            reason = f"2/3 aligned — bullish bias near PDH (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDH", "ABOVE_PDH") and btype == "ABSORPTION":
            verdict = "BUY"
            reason = f"2/3 aligned — absorption at PDH, breakout likely (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDL", "BELOW_PDL") and btype == "BREAKOUT":
            verdict = "SELL"
            reason = f"2/3 aligned — bearish bias near PDL (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDL", "BELOW_PDL") and btype == "ABSORPTION":
            verdict = "SELL"
            reason = f"2/3 aligned — absorption at PDL, breakdown likely (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDL", "BELOW_PDL") and btype == "REJECTION":
            verdict = "BUY"
            reason = f"2/3 aligned — bounce signal from PDL (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDH", "ABOVE_PDH") and btype == "REJECTION":
            verdict = "SELL"
            reason = f"2/3 aligned — rejection from PDH (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDL", "BELOW_PDL") and btype == "MOMENTUM":
            if curr_a["is_bullish"]:
                verdict = "BUY"
                reason = f"2/3 aligned — bullish bounce below PDL (missing: {', '.join(factors_fail)})"
            else:
                verdict = "SELL"
                reason = f"2/3 aligned — bearish momentum below PDL (missing: {', '.join(factors_fail)})"
        elif zone in ("NEAR_PDH", "ABOVE_PDH") and btype == "MOMENTUM":
            if curr_a["is_bullish"]:
                verdict = "BUY"
                reason = f"2/3 aligned — bullish momentum near PDH (missing: {', '.join(factors_fail)})"
            else:
                verdict = "SELL"
                reason = f"2/3 aligned — bearish momentum near PDH (missing: {', '.join(factors_fail)})"
        else:
            verdict = "NO_TRADE"
            missing = ", ".join(factors_fail)
            reason = f"Partial alignment (missing: {missing})"
    else:
        verdict = "NO_TRADE"
        missing = ", ".join(factors_fail)
        reason = f"Missing: {missing}" if factors_fail else "Insufficient alignment"

    return {
        "location": location,
        "behavior": behavior,
        "confirmation": confirmation,
        "alignment_score": score,
        "factors_pass": factors_pass,
        "factors_fail": factors_fail,
        "aligned": aligned,
        "verdict": verdict,
        "reason": reason,
    }


def _empty_3fa() -> Dict[str, Any]:
    return {
        "location": {
            "zone": "UNKNOWN", "pdh": None, "pdl": None, "vwap": None,
            "distance_to_pdh": None, "distance_to_pdl": None,
            "vwap_position": None, "tradeable": False,
        },
        "behavior": {"type": "NONE", "description": "No data", "strength": 0},
        "confirmation": {
            "volume_ratio": 0, "volume_confirmed": False,
            "body_strong": False, "close_near_extreme": False,
            "candle_confirmed": False, "confirmed": False,
        },
        "alignment_score": 0,
        "factors_pass": [],
        "factors_fail": ["LOCATION", "BEHAVIOR", "CONFIRMATION"],
        "aligned": False,
        "verdict": "NO_TRADE",
        "reason": "Waiting for data",
    }


def _signal_to_bias(signal: str) -> int:
    if signal in ("STRONG_BUY", "BUY"):
        return 1
    if signal in ("STRONG_SELL", "SELL"):
        return -1
    return 0


def _signal_to_strength(signal: str) -> float:
    return {
        "STRONG_BUY": 1.0,
        "BUY": 0.6,
        "NEUTRAL": 0.0,
        "SELL": -0.6,
        "STRONG_SELL": -1.0,
    }.get(signal, 0.0)


# ──────────────────────────────────────────────────────────────────────────────
# SECTION 6 — LIVE SERVICE (reads cache, broadcasts via WebSocket)
# ──────────────────────────────────────────────────────────────────────────────

class CandleIntelligenceConnectionManager:
    """Isolated WebSocket manager for Candle Intelligence."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, data: Dict[str, Any]):
        if not self._connections:
            return
        msg = json.dumps(data, default=str)
        dead: Set[WebSocket] = set()
        async with self._lock:
            clients = list(self._connections)
        for ws in clients:
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=3.0)
            except Exception:
                dead.add(ws)
        if dead:
            async with self._lock:
                self._connections -= dead

    async def send_personal(self, ws: WebSocket, data: Dict[str, Any]):
        try:
            await asyncio.wait_for(ws.send_text(json.dumps(data, default=str)), timeout=3.0)
        except Exception:
            await self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


candle_intel_manager = CandleIntelligenceConnectionManager()


class CandleIntelligenceService:
    """
    Singleton service that reads candle data from cache and broadcasts
    Candle Intelligence analysis via WebSocket.

    Persistence strategy (same as ICT engine):
      - During LIVE: compute fresh analysis every 2s, save to disk periodically
      - After market close: serve last good snapshot from memory / disk
      - On server restart: load last good snapshot from disk immediately
    """
    SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]
    CANDLE_LOOKBACK = 12  # Read last 12 candles for multi-pattern analysis (was 10)
    _DISK_SAVE_INTERVAL = 15.0  # Save to disk at most every 15s

    # Multi-timeframe config: (label, cache_key_prefix)
    TIMEFRAMES: List[Tuple[str, str]] = [
        ("3m",  "analysis_candles_3m"),
        ("5m",  "analysis_candles"),       # existing 5-min key
        ("15m", "analysis_candles_15m"),
    ]

    def __init__(self):
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_snapshot: Dict[str, Any] = {}
        self._last_good: Dict[str, Any] = {}  # last non-empty per-symbol results
        self._last_disk_save: float = 0.0
        # Load persisted data on init so get_snapshot() works immediately
        self._load_from_disk()

    # ── Disk persistence ──────────────────────────────────────────────────

    def _load_from_disk(self):
        """Load last good snapshot from disk on startup."""
        try:
            if _CANDLE_PERSIST_FILE.exists():
                data = json.loads(_CANDLE_PERSIST_FILE.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    for sym in self.SYMBOLS:
                        if sym in data and isinstance(data[sym], dict):
                            data[sym]["dataSource"] = "MARKET_CLOSED"
                            self._last_good[sym] = data[sym]
                    if self._last_good:
                        self._last_snapshot = {**self._last_good}
                        logger.info(f"🕯️ Candle Intel: Loaded persisted data ({list(self._last_good.keys())})")
        except Exception as e:
            logger.warning(f"🕯️ Candle Intel: Could not load persisted data: {e}")

    def _save_to_disk(self, snapshot: Dict[str, Any]):
        """Persist snapshot to disk (best-effort, debounced)."""
        now = time.time()
        if now - self._last_disk_save < self._DISK_SAVE_INTERVAL:
            return
        try:
            _CANDLE_PERSIST_FILE.parent.mkdir(parents=True, exist_ok=True)
            _CANDLE_PERSIST_FILE.write_text(
                json.dumps(snapshot, default=str, indent=2),
                encoding="utf-8",
            )
            self._last_disk_save = now
        except Exception as e:
            logger.debug(f"🕯️ Candle Intel: Could not persist to disk: {e}")

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("🕯️ Candle Intelligence Engine started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Final save on shutdown
        if self._last_snapshot:
            self._last_disk_save = 0  # force save
            self._save_to_disk(self._last_snapshot)
        logger.info("🕯️ Candle Intelligence Engine stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        return self._last_snapshot

    async def _loop(self):
        """Main loop — 2s LIVE/PRE_OPEN/FREEZE, 30s CLOSED."""
        while self._running:
            try:
                from services.market_feed import get_market_status
                status = get_market_status()
                # Fast refresh during any active market phase
                interval = 1.0 if status in ("LIVE", "PRE_OPEN", "FREEZE") else 30.0

                results = await asyncio.gather(
                    *(self._analyze_symbol_multi_tf(sym, status) for sym in self.SYMBOLS),
                    return_exceptions=True,
                )

                snapshot: Dict[str, Any] = {}
                for sym, result in zip(self.SYMBOLS, results):
                    if isinstance(result, Exception):
                        logger.debug(f"🕯️ Candle Intel {sym} loop error: {result}")
                        # Keep previous snapshot for this symbol when available
                        snapshot[sym] = self._last_snapshot.get(sym) or self._last_good.get(sym) or _empty_result()
                        continue
                    snapshot[sym] = result

                self._last_snapshot = snapshot

                # Persist to disk periodically (debounced)
                self._save_to_disk(snapshot)

                if candle_intel_manager.client_count > 0:
                    await candle_intel_manager.broadcast({
                        "type": "candle_intel_update",
                        "data": snapshot,
                        "timestamp": datetime.now(IST).isoformat(),
                    })

                await asyncio.sleep(interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"🕯️ Candle Intel loop error: {e}")
                await asyncio.sleep(5)

    async def _analyze_single_tf(
        self, symbol: str, market_status: str, cache_key_prefix: str, tf_label: str
    ) -> Dict[str, Any]:
        """Run candle engine for one timeframe on one symbol."""
        try:
            cache = get_cache()

            candle_key = f"{cache_key_prefix}:{symbol}"
            raw_candles = await cache.lrange(candle_key, 0, self.CANDLE_LOOKBACK - 1)

            # Parse candles
            parsed: List[Dict] = []
            for item in raw_candles:
                c = item if isinstance(item, dict) else None
                if c is None and isinstance(item, str):
                    try:
                        c = json.loads(item)
                    except Exception:
                        continue
                if c and "open" in c and "high" in c and "low" in c and "close" in c:
                    parsed.append(c)

            # Reverse to chronological order (oldest first)
            parsed.reverse()

            # Get market data (handles TTL + PersistentMarketState fallback)
            market_data = await cache.get_market_data(symbol)

            # Read the in-progress live candle for THIS specific timeframe
            # (built by _update_candle_generic in MarketFeedService)
            live_key = f"{cache_key_prefix}_live:{symbol}"
            tf_live_candle = await cache.get(live_key)

            if tf_live_candle and isinstance(tf_live_candle, dict):
                # Use the timeframe-specific live candle (proper OHLC for this interval)
                live_candle = {
                    "open": tf_live_candle.get("open", 0),
                    "high": tf_live_candle.get("high", 0),
                    "low": tf_live_candle.get("low", 0),
                    "close": tf_live_candle.get("close", 0),
                    "volume": tf_live_candle.get("volume", 0),
                    "_live": True,
                }
                if live_candle["open"] > 0 and live_candle["close"] > 0:
                    if parsed and parsed[-1].get("_live"):
                        parsed[-1] = live_candle
                    else:
                        parsed.append(live_candle)
            elif market_data and isinstance(market_data, dict):
                # Fallback: use current price to update the last candle's close only
                current_price = market_data.get("price", 0)
                if current_price > 0 and parsed:
                    # Don't replace with day OHLC; just update the close of the last candle
                    parsed[-1] = {**parsed[-1], "close": current_price}
                elif current_price > 0:
                    # No candles at all — create a minimal candle from current price
                    parsed.append({
                        "open": current_price,
                        "high": current_price,
                        "low": current_price,
                        "close": current_price,
                        "volume": market_data.get("volume", 0),
                    })

            # Run engine
            result = candle_engine(parsed)
            result["symbol"] = symbol
            result["timeframe"] = tf_label
            ds_map = {"LIVE": "LIVE", "PRE_OPEN": "PRE_OPEN", "FREEZE": "FREEZE"}
            result["dataSource"] = ds_map.get(market_status, "MARKET_CLOSED")
            result["timestamp"] = datetime.now(IST).isoformat()

            # Price info
            if market_data and isinstance(market_data, dict):
                result["price"] = market_data.get("price", 0)
                result["changePct"] = market_data.get("changePercent", market_data.get("changePct", 0))
            else:
                result["price"] = parsed[-1]["close"] if parsed else 0
                result["changePct"] = 0

            # ── 3FA (3 Factor Alignment) ──
            pdh = None
            pdl = None
            vwap = None
            current_vol = None
            avg_vol = None

            if market_data and isinstance(market_data, dict):
                pdh = market_data.get("prev_day_high")
                pdl = market_data.get("prev_day_low")
                # VWAP from analysis data if available
                analysis = market_data.get("analysis")
                if isinstance(analysis, dict):
                    indicators = analysis.get("indicators", {})
                    vwap = indicators.get("vwap")
                current_vol = market_data.get("volume", 0) or 0

            # Compute average volume from candle history
            candle_vols = [c.get("volume", 0) for c in parsed if c.get("volume", 0) > 0]
            if candle_vols:
                avg_vol = sum(candle_vols) / len(candle_vols)

            # Recompute anatomies for 3FA (candle_engine doesn't expose them)
            anatomies_for_3fa = [_anatomy(c) for c in parsed] if parsed else []

            tfa_result = compute_3fa(
                candles=parsed,
                anatomies=anatomies_for_3fa,
                price=result["price"],
                pdh=pdh,
                pdl=pdl,
                vwap=vwap,
                volume=current_vol,
                avg_volume=avg_vol,
            )
            tfa_result["market_active"] = market_status in ("LIVE", "PRE_OPEN", "FREEZE")
            result["three_factor"] = tfa_result

            return result

        except Exception as e:
            logger.debug(f"🕯️ Candle Intel {symbol}/{tf_label} error: {e}")
            r = _empty_result()
            r["symbol"] = symbol
            r["timeframe"] = tf_label
            r["dataSource"] = "MARKET_CLOSED"
            r["timestamp"] = datetime.now(IST).isoformat()
            r["price"] = 0
            r["changePct"] = 0
            return r

    async def _analyze_symbol_multi_tf(self, symbol: str, market_status: str) -> Dict[str, Any]:
        """Run candle engine on all 3 timeframes for a symbol.

        Returns:
        {
            "timeframes": { "3m": {...}, "5m": {...}, "15m": {...} },
            // Top-level fields mirror the "5m" result for backward compat
            "pattern": ..., "signal": ..., etc.
        }
        """
        tf_tasks = [
            self._analyze_single_tf(symbol, market_status, cache_prefix, tf_label)
            for tf_label, cache_prefix in self.TIMEFRAMES
        ]
        tf_values = await asyncio.gather(*tf_tasks, return_exceptions=True)

        tf_results: Dict[str, Dict] = {}
        for (tf_label, _), tf_result in zip(self.TIMEFRAMES, tf_values):
            if isinstance(tf_result, Exception):
                logger.debug(f"🕯️ Candle Intel {symbol}/{tf_label} task error: {tf_result}")
                fallback = _empty_result()
                fallback["symbol"] = symbol
                fallback["timeframe"] = tf_label
                fallback["dataSource"] = "MARKET_CLOSED"
                fallback["timestamp"] = datetime.now(IST).isoformat()
                fallback["price"] = 0
                fallback["changePct"] = 0
                tf_results[tf_label] = fallback
            else:
                tf_results[tf_label] = tf_result

        # Primary = 5m for backward compatibility
        primary = tf_results.get("5m", tf_results.get("3m", _empty_result()))
        # Multi-timeframe consensus (faster frontend, consistent intelligence contract)
        signals = [tf_results[k].get("signal", "NEUTRAL") for k in ("3m", "5m", "15m") if k in tf_results]
        biases = [_signal_to_bias(s) for s in signals]
        bull_count = sum(1 for b in biases if b > 0)
        bear_count = sum(1 for b in biases if b < 0)
        neutral_count = len(biases) - bull_count - bear_count
        dominant = max(bull_count, bear_count)
        dominant_dir = "BULLISH" if bull_count >= bear_count else "BEARISH"
        alignment_pct = int(round((dominant / max(len(biases), 1)) * 100))
        weighted_raw = sum(_signal_to_strength(s) for s in signals) / max(len(signals), 1)
        probability_bull = int(max(5, min(95, round((1 / (1 + pow(2.718281828, -weighted_raw * 3.5))) * 100))))

        result = {
            **primary,
            "timeframes": tf_results,
            "mtfConsensus": {
                "bullCount": bull_count,
                "bearCount": bear_count,
                "neutralCount": neutral_count,
                "dominant": dominant_dir if dominant > 0 else "MIXED",
                "aligned": dominant == len(biases) and dominant > 0,
                "alignmentPct": alignment_pct,
                "probabilityBull": probability_bull,
                "probabilityBear": 100 - probability_bull,
            },
        }

        # Track last good result
        if result.get("pattern") or result.get("price", 0) > 0:
            self._last_good[symbol] = result

        return result


# ── Singleton ────────────────────────────────────────────────────────────────

_candle_intel_service: Optional[CandleIntelligenceService] = None


def get_candle_intelligence_service() -> CandleIntelligenceService:
    global _candle_intel_service
    if _candle_intel_service is None:
        _candle_intel_service = CandleIntelligenceService()
    return _candle_intel_service

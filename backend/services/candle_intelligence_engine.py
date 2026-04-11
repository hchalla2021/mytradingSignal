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
import collections
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE, get_cache

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


def _compute_trend_context(candles: List[Dict], anatomies: List[Dict]) -> Dict[str, Any]:
    """Compute short-term trend from last 5 candles."""
    n = min(5, len(candles))
    if n < 2:
        return {"direction": "NEUTRAL", "bullish_count": 0, "bearish_count": 0, "avg_body_ratio": 0}

    recent_a = anatomies[-n:]
    bull_count = sum(1 for a in recent_a if a["is_bullish"])
    bear_count = n - bull_count
    avg_br = sum(a["body_ratio"] for a in recent_a) / n

    if bull_count >= 4:
        direction = "STRONG_BULLISH"
    elif bull_count >= 3:
        direction = "BULLISH"
    elif bear_count >= 4:
        direction = "STRONG_BEARISH"
    elif bear_count >= 3:
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
    }


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
    CANDLE_LOOKBACK = 10  # Read last 10 candles for multi-pattern analysis
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
                interval = 2.0 if status in ("LIVE", "PRE_OPEN", "FREEZE") else 30.0

                snapshot = {}
                for sym in self.SYMBOLS:
                    snapshot[sym] = await self._analyze_symbol_multi_tf(sym, status)

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

            if market_data and isinstance(market_data, dict):
                live_candle = {
                    "open": market_data.get("open", 0),
                    "high": market_data.get("high", 0),
                    "low": market_data.get("low", 0),
                    "close": market_data.get("price", market_data.get("close", 0)),
                }
                if live_candle["open"] > 0 and live_candle["close"] > 0:
                    if parsed and parsed[-1].get("_live"):
                        parsed[-1] = live_candle
                    else:
                        parsed.append(live_candle)

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
        tf_results: Dict[str, Dict] = {}
        for tf_label, cache_prefix in self.TIMEFRAMES:
            tf_results[tf_label] = await self._analyze_single_tf(
                symbol, market_status, cache_prefix, tf_label
            )

        # Primary = 5m for backward compatibility
        primary = tf_results.get("5m", tf_results.get("3m", _empty_result()))
        result = {**primary, "timeframes": tf_results}

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

"""
🏦 ICT Smart Money Intelligence Engine
========================================
Advanced Inner Circle Trader (ICT) concepts applied to NIFTY, BANKNIFTY, SENSEX.

100% isolated. Zero shared state. Reads only from in-memory cache.
Zero external API calls. Designed for live market speed.

ICT Signals (6 factors → weighted composite):

  Signal                    Weight   Source
  ────────────────────────  ──────   ─────────────────────────────────────
  1. Order Blocks            25%     Institutional supply/demand from candles
  2. Fair Value Gaps         20%     Price imbalance zones (3-candle FVG)
  3. Market Structure        20%     BOS (Break of Structure) / CHoCH
  4. Liquidity Sweeps        15%     Stop hunts above/below swing points
  5. Displacement            10%     Strong impulsive candle moves
  6. Smart Money Divergence  10%     OI vs Price divergence (institutional footprint)

5-Minute ICT Prediction:
  Re-weighted toward fast-moving signals (displacement, structure, sweeps).

Confidence System:
  - Overall ICT confidence (1-99)
  - Per-signal confidence
  - 5-min prediction confidence (separate)
"""

import asyncio
import collections
import json
import math
import time
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple, Deque, Set

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Factor weights (sum = 1.0) ────────────────────────────────────────────────

WEIGHTS: Dict[str, float] = {
    "order_blocks":       0.25,
    "fair_value_gaps":    0.20,
    "market_structure":   0.20,
    "liquidity_sweeps":   0.15,
    "displacement":       0.10,
    "smart_money_div":    0.10,
}

# 5-minute prediction weights (bias toward fast signals)
W5M: Dict[str, float] = {
    "displacement":       0.30,
    "market_structure":   0.25,
    "liquidity_sweeps":   0.20,
    "order_blocks":       0.15,
    "fair_value_gaps":    0.05,
    "smart_money_div":    0.05,
}

BULL_T = 0.20
BEAR_T = -0.20


# ── Isolated WebSocket manager ────────────────────────────────────────────────

class ICTConnectionManager:
    """Completely isolated WebSocket manager — no shared state."""

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
            for ws in self._connections:
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            self._connections -= dead

    async def send_personal(self, ws: WebSocket, data: Dict[str, Any]):
        try:
            await ws.send_text(json.dumps(data, default=str))
        except Exception:
            await self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


ict_manager = ICTConnectionManager()


# ── Utility functions ─────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _sig(score: float) -> str:
    if score >= 0.15:
        return "BULL"
    if score <= -0.15:
        return "BEAR"
    return "NEUTRAL"


def _parse_candle(item) -> Optional[Dict]:
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        try:
            return json.loads(item)
        except Exception:
            return None
    return None


def _linear_slope(values: List[float]) -> float:
    n = len(values)
    if n < 3:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


# ── Swing Point Tracker ──────────────────────────────────────────────────────

class SwingTracker:
    """Tracks swing highs/lows for market structure and liquidity sweep detection."""
    MAXLEN = 50

    def __init__(self):
        self._highs: Deque[Dict] = collections.deque(maxlen=self.MAXLEN)
        self._lows: Deque[Dict] = collections.deque(maxlen=self.MAXLEN)
        self._last_bos: Optional[str] = None  # "BULLISH" or "BEARISH"

    def update(self, candles: List[Dict]):
        """Detect swing highs and lows from candle data (3-bar pivot)."""
        if len(candles) < 3:
            return
        # Clear and rebuild from current candle window to prevent duplicate entries
        self._highs.clear()
        self._lows.clear()
        for i in range(1, len(candles) - 1):
            h = float(candles[i].get("high", 0))
            l = float(candles[i].get("low", 0))
            prev_h = float(candles[i - 1].get("high", 0))
            next_h = float(candles[i + 1].get("high", 0))
            prev_l = float(candles[i - 1].get("low", 0))
            next_l = float(candles[i + 1].get("low", 0))

            ts = candles[i].get("timestamp", "")

            if h > prev_h and h > next_h:
                self._highs.append({"price": h, "ts": ts, "idx": i})
            if l < prev_l and l < next_l:
                self._lows.append({"price": l, "ts": ts, "idx": i})

    @property
    def highs(self) -> List[Dict]:
        return list(self._highs)

    @property
    def lows(self) -> List[Dict]:
        return list(self._lows)

    @property
    def last_swing_high(self) -> Optional[float]:
        return self._highs[-1]["price"] if self._highs else None

    @property
    def last_swing_low(self) -> Optional[float]:
        return self._lows[-1]["price"] if self._lows else None


# ══════════════════════════════════════════════════════════════════════════════
# ICT SIGNAL FUNCTIONS
# ══════════════════════════════════════════════════════════════════════════════


def _order_block_signal(candles: List[Dict], price: float) -> Dict:
    """
    ORDER BLOCKS — Institutional Supply/Demand Zones
    ─────────────────────────────────────────────────
    Bullish OB: Last bearish candle before a strong bullish displacement
    Bearish OB: Last bullish candle before a strong bearish displacement
    Price near OB = high-probability reversal zone.
    """
    if len(candles) < 4:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Insufficient candles for OB detection",
            "weight": WEIGHTS["order_blocks"], "value": None,
            "extra": {"bullish_obs": 0, "bearish_obs": 0, "nearest_ob": None},
        }

    bullish_obs: List[Dict] = []
    bearish_obs: List[Dict] = []

    for i in range(len(candles) - 2):
        c0 = candles[i]
        c1 = candles[i + 1]
        o0, cl0 = float(c0.get("open", 0)), float(c0.get("close", 0))
        o1, cl1 = float(c1.get("open", 0)), float(c1.get("close", 0))
        h1, l1 = float(c1.get("high", 0)), float(c1.get("low", 0))

        body0 = cl0 - o0
        body1 = cl1 - o1
        range1 = h1 - l1 if h1 > l1 else 0.001

        # Bullish OB: bearish candle → strong bullish candle
        if body0 < 0 and body1 > 0 and abs(body1) / range1 > 0.6:
            strength = min(abs(body1) / (abs(body0) + 0.001), 3.0) / 3.0
            bullish_obs.append({
                "high": float(c0.get("high", 0)),
                "low": float(c0.get("low", 0)),
                "strength": strength,
                "ts": c0.get("timestamp", ""),
            })

        # Bearish OB: bullish candle → strong bearish candle
        if body0 > 0 and body1 < 0 and abs(body1) / range1 > 0.6:
            strength = min(abs(body1) / (abs(body0) + 0.001), 3.0) / 3.0
            bearish_obs.append({
                "high": float(c0.get("high", 0)),
                "low": float(c0.get("low", 0)),
                "strength": strength,
                "ts": c0.get("timestamp", ""),
            })

    # Score: price proximity to OBs
    score = 0.0
    nearest_ob = None
    nearest_dist = float("inf")

    # Check bullish OBs (support zones — price above = bullish)
    for ob in bullish_obs[-5:]:  # Last 5
        dist_pct = (price - ob["low"]) / (price + 0.001) * 100
        if 0 < dist_pct < 1.5:  # Price within 1.5% of bullish OB
            score += 0.35 * ob["strength"]
            if abs(dist_pct) < nearest_dist:
                nearest_dist = abs(dist_pct)
                nearest_ob = {"type": "BULLISH", "zone": f"{ob['low']:.0f}-{ob['high']:.0f}", "dist": round(dist_pct, 2)}
        elif -0.5 < dist_pct <= 0:  # Price inside bullish OB
            score += 0.65 * ob["strength"]
            if abs(dist_pct) < nearest_dist:
                nearest_dist = abs(dist_pct)
                nearest_ob = {"type": "BULLISH_RETEST", "zone": f"{ob['low']:.0f}-{ob['high']:.0f}", "dist": 0}

    # Check bearish OBs (resistance zones — price below = bearish)
    for ob in bearish_obs[-5:]:
        dist_pct = (ob["high"] - price) / (price + 0.001) * 100
        if 0 < dist_pct < 1.5:
            score -= 0.35 * ob["strength"]
            if abs(dist_pct) < nearest_dist:
                nearest_dist = abs(dist_pct)
                nearest_ob = {"type": "BEARISH", "zone": f"{ob['low']:.0f}-{ob['high']:.0f}", "dist": round(dist_pct, 2)}
        elif -0.5 < dist_pct <= 0:
            score -= 0.65 * ob["strength"]
            if abs(dist_pct) < nearest_dist:
                nearest_dist = abs(dist_pct)
                nearest_ob = {"type": "BEARISH_RETEST", "zone": f"{ob['low']:.0f}-{ob['high']:.0f}", "dist": 0}

    score = _clamp(score, -1.0, 1.0)

    if nearest_ob:
        ob_type = nearest_ob["type"]
        label = f"{'Bullish' if 'BULLISH' in ob_type else 'Bearish'} OB @ {nearest_ob['zone']} ({nearest_ob['dist']}% away)"
    else:
        label = "No active Order Block near price"

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["order_blocks"],
        "value": round(score, 3),
        "extra": {
            "bullish_obs": len(bullish_obs),
            "bearish_obs": len(bearish_obs),
            "nearest_ob": nearest_ob,
        },
    }


def _fair_value_gap_signal(candles: List[Dict], price: float) -> Dict:
    """
    FAIR VALUE GAPS (FVG) — Price Imbalance Zones
    ──────────────────────────────────────────────
    Bullish FVG: candle[i+1].low > candle[i-1].high (gap up between bars 0 and 2)
    Bearish FVG: candle[i-1].low > candle[i+1].high (gap down between bars 0 and 2)
    Unfilled FVGs act as magnets — price tends to return to fill them.
    """
    if len(candles) < 3:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Insufficient candles for FVG detection",
            "weight": WEIGHTS["fair_value_gaps"], "value": None,
            "extra": {"bullish_fvgs": 0, "bearish_fvgs": 0, "nearest_fvg": None},
        }

    bullish_fvgs: List[Dict] = []
    bearish_fvgs: List[Dict] = []

    for i in range(1, len(candles) - 1):
        prev_h = float(candles[i - 1].get("high", 0))
        prev_l = float(candles[i - 1].get("low", 0))
        next_h = float(candles[i + 1].get("high", 0))
        next_l = float(candles[i + 1].get("low", 0))
        mid_h = float(candles[i].get("high", 0))
        mid_l = float(candles[i].get("low", 0))

        # Bullish FVG: gap between candle[i-1] high and candle[i+1] low
        if next_l > prev_h:
            gap_size = next_l - prev_h
            fvg_pct = gap_size / (price + 0.001) * 100
            if fvg_pct > 0.02:  # Minimum gap threshold
                bullish_fvgs.append({
                    "top": next_l, "bottom": prev_h,
                    "size_pct": round(fvg_pct, 3),
                    "ts": candles[i].get("timestamp", ""),
                    "filled": price <= next_l,
                })

        # Bearish FVG: gap between candle[i+1] high and candle[i-1] low
        if prev_l > next_h:
            gap_size = prev_l - next_h
            fvg_pct = gap_size / (price + 0.001) * 100
            if fvg_pct > 0.02:
                bearish_fvgs.append({
                    "top": prev_l, "bottom": next_h,
                    "size_pct": round(fvg_pct, 3),
                    "ts": candles[i].get("timestamp", ""),
                    "filled": price >= next_h,
                })

    # Score based on unfilled FVGs near current price
    score = 0.0
    nearest_fvg = None
    nearest_dist = float("inf")

    for fvg in bullish_fvgs[-8:]:
        if not fvg["filled"]:
            mid_fvg = (fvg["top"] + fvg["bottom"]) / 2
            dist_pct = (price - mid_fvg) / (price + 0.001) * 100
            if 0 < dist_pct < 2.0:  # Price above unfilled bullish FVG = bullish support
                score += 0.4 * min(fvg["size_pct"] / 0.3, 1.0)
                if abs(dist_pct) < nearest_dist:
                    nearest_dist = abs(dist_pct)
                    nearest_fvg = {"type": "BULLISH", "zone": f"{fvg['bottom']:.0f}-{fvg['top']:.0f}", "dist": round(dist_pct, 2)}

    for fvg in bearish_fvgs[-8:]:
        if not fvg["filled"]:
            mid_fvg = (fvg["top"] + fvg["bottom"]) / 2
            dist_pct = (mid_fvg - price) / (price + 0.001) * 100
            if 0 < dist_pct < 2.0:
                score -= 0.4 * min(fvg["size_pct"] / 0.3, 1.0)
                if abs(dist_pct) < nearest_dist:
                    nearest_dist = abs(dist_pct)
                    nearest_fvg = {"type": "BEARISH", "zone": f"{fvg['bottom']:.0f}-{fvg['top']:.0f}", "dist": round(dist_pct, 2)}

    score = _clamp(score, -1.0, 1.0)

    if nearest_fvg:
        label = f"{'Bullish' if nearest_fvg['type'] == 'BULLISH' else 'Bearish'} FVG @ {nearest_fvg['zone']}"
    else:
        unfilled = len([f for f in bullish_fvgs if not f["filled"]]) + len([f for f in bearish_fvgs if not f["filled"]])
        label = f"{unfilled} unfilled FVGs detected" if unfilled else "No active FVGs near price"

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["fair_value_gaps"],
        "value": round(score, 3),
        "extra": {
            "bullish_fvgs": len(bullish_fvgs),
            "bearish_fvgs": len(bearish_fvgs),
            "nearest_fvg": nearest_fvg,
        },
    }


def _market_structure_signal(candles: List[Dict], swing_tracker: SwingTracker) -> Dict:
    """
    MARKET STRUCTURE — Break of Structure (BOS) / Change of Character (CHoCH)
    ──────────────────────────────────────────────────────────────────────────
    BOS (bullish): Price breaks above the last swing high → trend continuation
    BOS (bearish): Price breaks below the last swing low → trend continuation
    CHoCH: Opposite — trend reversal signal (break in opposite direction)
    """
    swing_tracker.update(candles)

    if not candles or len(candles) < 5:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Building market structure...",
            "weight": WEIGHTS["market_structure"], "value": None,
            "extra": {"structure": "FORMING", "swing_highs": 0, "swing_lows": 0},
        }

    current_close = float(candles[-1].get("close", 0))
    current_high = float(candles[-1].get("high", 0))
    current_low = float(candles[-1].get("low", 0))

    highs = swing_tracker.highs
    lows = swing_tracker.lows

    if len(highs) < 2 or len(lows) < 2:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Waiting for swing points to form",
            "weight": WEIGHTS["market_structure"], "value": None,
            "extra": {"structure": "FORMING", "swing_highs": len(highs), "swing_lows": len(lows)},
        }

    last_sh = highs[-1]["price"]
    prev_sh = highs[-2]["price"]
    last_sl = lows[-1]["price"]
    prev_sl = lows[-2]["price"]

    # Determine market structure
    score = 0.0
    structure = "RANGING"
    label = "Market in ranging structure"

    # Higher highs + higher lows = bullish structure
    if last_sh > prev_sh and last_sl > prev_sl:
        structure = "BULLISH_TREND"
        score = 0.45
        label = "Bullish structure — Higher Highs + Higher Lows"

        # BOS check: current price breaking above last swing high
        if current_high > last_sh:
            structure = "BULLISH_BOS"
            score = 0.75
            label = f"🔥 Bullish BOS — Price broke above {last_sh:.0f}"

    # Lower highs + lower lows = bearish structure
    elif last_sh < prev_sh and last_sl < prev_sl:
        structure = "BEARISH_TREND"
        score = -0.45
        label = "Bearish structure — Lower Highs + Lower Lows"

        # BOS check: current price breaking below last swing low
        if current_low < last_sl:
            structure = "BEARISH_BOS"
            score = -0.75
            label = f"🔥 Bearish BOS — Price broke below {last_sl:.0f}"

    # CHoCH detection: bullish structure but price breaks below last swing low
    if last_sh > prev_sh and current_low < last_sl:
        structure = "BEARISH_CHOCH"
        score = -0.60
        label = f"⚠️ CHoCH — Bearish reversal below {last_sl:.0f}"

    # CHoCH: bearish structure but price breaks above last swing high
    if last_sh < prev_sh and current_high > last_sh:
        structure = "BULLISH_CHOCH"
        score = 0.60
        label = f"⚠️ CHoCH — Bullish reversal above {last_sh:.0f}"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["market_structure"],
        "value": round(score, 3),
        "extra": {
            "structure": structure,
            "swing_highs": len(highs),
            "swing_lows": len(lows),
            "last_swing_high": round(last_sh, 2),
            "last_swing_low": round(last_sl, 2),
        },
    }


def _liquidity_sweep_signal(candles: List[Dict], swing_tracker: SwingTracker, price: float) -> Dict:
    """
    LIQUIDITY SWEEPS — Stop Hunt Detection
    ──────────────────────────────────────
    Smart money hunts stops placed beyond swing points.
    Sweep = price pierces beyond swing high/low, then reverses.
    Bullish sweep: price dips below swing low → closes above (trapped shorts)
    Bearish sweep: price spikes above swing high → closes below (trapped longs)
    """
    if len(candles) < 3:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Monitoring for liquidity sweeps...",
            "weight": WEIGHTS["liquidity_sweeps"], "value": None,
            "extra": {"sweeps_detected": 0, "last_sweep": None},
        }

    highs = swing_tracker.highs
    lows = swing_tracker.lows
    sweeps: List[Dict] = []

    # Check last 5 candles for sweep patterns
    for i in range(max(0, len(candles) - 5), len(candles)):
        c = candles[i]
        c_high = float(c.get("high", 0))
        c_low = float(c.get("low", 0))
        c_open = float(c.get("open", 0))
        c_close = float(c.get("close", 0))

        # Bullish sweep: wick below swing low, close above
        for sl in lows[-5:]:
            if c_low < sl["price"] and c_close > sl["price"]:
                wick_depth = (sl["price"] - c_low) / (price + 0.001) * 100
                if wick_depth > 0.03:
                    sweeps.append({
                        "type": "BULLISH_SWEEP",
                        "level": sl["price"],
                        "depth_pct": round(wick_depth, 3),
                        "ts": c.get("timestamp", ""),
                    })

        # Bearish sweep: wick above swing high, close below
        for sh in highs[-5:]:
            if c_high > sh["price"] and c_close < sh["price"]:
                wick_depth = (c_high - sh["price"]) / (price + 0.001) * 100
                if wick_depth > 0.03:
                    sweeps.append({
                        "type": "BEARISH_SWEEP",
                        "level": sh["price"],
                        "depth_pct": round(wick_depth, 3),
                        "ts": c.get("timestamp", ""),
                    })

    score = 0.0
    last_sweep = None

    if sweeps:
        last_sweep = sweeps[-1]
        if last_sweep["type"] == "BULLISH_SWEEP":
            score = 0.55 * min(last_sweep["depth_pct"] / 0.2, 1.5)
        else:
            score = -0.55 * min(last_sweep["depth_pct"] / 0.2, 1.5)

    score = _clamp(score, -1.0, 1.0)

    if last_sweep:
        sweep_type = "Bullish" if "BULLISH" in last_sweep["type"] else "Bearish"
        label = f"{sweep_type} sweep @ {last_sweep['level']:.0f} — Stops hunted"
    else:
        label = "No liquidity sweep detected"

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["liquidity_sweeps"],
        "value": round(score, 3),
        "extra": {
            "sweeps_detected": len(sweeps),
            "last_sweep": last_sweep,
        },
    }


def _displacement_signal(candles: List[Dict]) -> Dict:
    """
    DISPLACEMENT — Strong Impulsive Moves
    ──────────────────────────────────────
    Large-body candles with minimal wicks = institutional conviction.
    Multiple consecutive displacement candles = very strong signal.
    """
    if len(candles) < 2:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Waiting for displacement detection...",
            "weight": WEIGHTS["displacement"], "value": None,
            "extra": {"displacement_count": 0, "avg_body_ratio": 0},
        }

    # Analyze last 5 candles for displacement
    recent = candles[-min(5, len(candles)):]
    displacements: List[Dict] = []

    for c in recent:
        o = float(c.get("open", 0))
        cl = float(c.get("close", 0))
        h = float(c.get("high", 0))
        l = float(c.get("low", 0))

        body = abs(cl - o)
        total_range = h - l if h > l else 0.001
        body_ratio = body / total_range

        # Displacement = body > 70% of range (institutional conviction)
        if body_ratio > 0.70 and total_range > 0:
            direction = "BULL" if cl > o else "BEAR"
            displacements.append({
                "direction": direction,
                "body_ratio": round(body_ratio, 3),
                "range_pct": round(total_range / (o + 0.001) * 100, 3),
            })

    if not displacements:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "No displacement — market chopping",
            "weight": WEIGHTS["displacement"],
            "value": 0.0,
            "extra": {"displacement_count": 0, "avg_body_ratio": 0},
        }

    # Weight recent displacements more (later index = more recent = higher weight)
    weighted_bull = 0.0
    weighted_bear = 0.0
    total_weight = 0.0
    for idx, d in enumerate(displacements):
        w = 1.0 + idx * 0.5
        total_weight += w
        if d["direction"] == "BULL":
            weighted_bull += w
        else:
            weighted_bear += w

    bull_disp = sum(1 for d in displacements if d["direction"] == "BULL")
    bear_disp = sum(1 for d in displacements if d["direction"] == "BEAR")
    avg_ratio = sum(d["body_ratio"] for d in displacements) / len(displacements)

    if weighted_bull > weighted_bear:
        score = 0.4 + (weighted_bull / total_weight) * 0.4
        label = f"Bullish displacement × {bull_disp} — Institutional buying"
    elif weighted_bear > weighted_bull:
        score = -(0.4 + (weighted_bear / total_weight) * 0.4)
        label = f"Bearish displacement × {bear_disp} — Institutional selling"
    else:
        score = 0.0
        label = "Mixed displacement — indecision"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["displacement"],
        "value": round(avg_ratio, 3),
        "extra": {
            "displacement_count": len(displacements),
            "avg_body_ratio": round(avg_ratio, 3),
            "bull_count": bull_disp,
            "bear_count": bear_disp,
        },
    }


def _smart_money_divergence_signal(
    candles: List[Dict],
    price: float,
    oi: int,
    change_pct: float,
) -> Dict:
    """
    SMART MONEY DIVERGENCE — OI vs Price Divergence
    ──────────────────────────────────────────────────
    When price moves one way but OI moves the opposite, institutions
    are positioned against the move — high reversal probability.

    Price ↑ + OI ↓ = weak rally (no institutional backing) → BEARISH divergence
    Price ↓ + OI ↑ = accumulation under (institutions adding) → BULLISH divergence
    """
    score = 0.0
    divergence_type = "NONE"

    if len(candles) < 3 or oi <= 0:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Waiting for OI data for divergence analysis",
            "weight": WEIGHTS["smart_money_div"], "value": None,
            "extra": {"divergence": "NO_DATA"},
        }

    # Get OI from recent candles
    oi_values = []
    for c in candles[-10:]:
        c_oi = c.get("oi") or c.get("open_interest")
        if c_oi and int(c_oi) > 0:
            oi_values.append(int(c_oi))

    if len(oi_values) < 3:
        # Use current OI + price trend
        if change_pct > 0.3 and oi > 0:
            # Price up — check if it's supported
            score = 0.15  # Mild bullish (can't confirm divergence without OI history)
            divergence_type = "PRICE_UP_OI_UNKNOWN"
            label = f"Price ↑{change_pct:.1f}% — OI history building"
        elif change_pct < -0.3 and oi > 0:
            score = -0.15
            divergence_type = "PRICE_DOWN_OI_UNKNOWN"
            label = f"Price ↓{abs(change_pct):.1f}% — OI history building"
        else:
            label = "No significant divergence — flat market"

        return {
            "score": round(score, 4),
            "signal": _sig(score),
            "label": label,
            "weight": WEIGHTS["smart_money_div"],
            "value": round(score, 3),
            "extra": {"divergence": divergence_type},
        }

    oi_slope = _linear_slope(oi_values)

    # Use candle-derived price change for same timeframe as OI data
    oi_window = len(oi_values)
    if len(candles) >= oi_window >= 3:
        first_close = float(candles[-oi_window].get("close", 0))
        last_close = float(candles[-1].get("close", 0))
        if first_close > 0:
            change_pct = (last_close - first_close) / first_close * 100

    # Price up + OI decreasing = bearish divergence (smart money exiting)
    if change_pct > 0.2 and oi_slope < -0.5:
        score = -0.50
        divergence_type = "BEARISH_DIVERGENCE"
        label = f"⚠️ Bearish divergence — Price ↑{change_pct:.1f}% but OI dropping"

    # Price down + OI increasing = bullish divergence (smart money accumulating)
    elif change_pct < -0.2 and oi_slope > 0.5:
        score = 0.50
        divergence_type = "BULLISH_DIVERGENCE"
        label = f"⚠️ Bullish divergence — Price ↓{abs(change_pct):.1f}% but OI rising"

    # Price up + OI up = confirmed bullish (trend health)
    elif change_pct > 0.2 and oi_slope > 0.5:
        score = 0.30
        divergence_type = "CONFIRMED_BULL"
        label = f"Price ↑{change_pct:.1f}% + OI rising — Confirmed bullish"

    # Price down + OI down = confirmed bearish
    elif change_pct < -0.2 and oi_slope < -0.5:
        score = -0.30
        divergence_type = "CONFIRMED_BEAR"
        label = f"Price ↓{abs(change_pct):.1f}% + OI dropping — Confirmed bearish"

    else:
        label = "No significant smart money divergence"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["smart_money_div"],
        "value": round(score, 3),
        "extra": {
            "divergence": divergence_type,
            "price_change": round(change_pct, 2),
            "oi_slope": round(oi_slope, 4),
        },
    }


# ══════════════════════════════════════════════════════════════════════════════
# ICT SERVICE CLASS
# ══════════════════════════════════════════════════════════════════════════════

class ICTService:
    """
    🏦 ICT Smart Money Intelligence Service
    Fully isolated. Reads from shared cache. Writes nowhere.
    Own asyncio loop, own WS manager, own computation.
    """

    CADENCE = 2.0  # seconds between updates

    def __init__(self):
        self._cache = CacheService()
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_snapshot: Dict[str, Any] = {}

        # Per-symbol state
        self._swing_trackers: Dict[str, SwingTracker] = {
            "NIFTY": SwingTracker(),
            "BANKNIFTY": SwingTracker(),
            "SENSEX": SwingTracker(),
        }

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info("🏦 ICT Smart Money Intelligence: STARTED")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("🏦 ICT Smart Money Intelligence: STOPPED")

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _loop(self):
        while self._running:
            try:
                snapshot = await self._compute_all()
                self._last_snapshot = snapshot

                if ict_manager.client_count > 0:
                    await ict_manager.broadcast({
                        "type": "ict_update",
                        "data": snapshot,
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except Exception as e:
                logger.error(f"🏦 ICT loop error: {e}", exc_info=True)

            # Throttle during closed market to free event loop for HTTP requests
            try:
                from services.market_feed import get_market_status
                _status = get_market_status()
            except Exception:
                _status = "CLOSED"
            await asyncio.sleep(self.CADENCE if _status == "LIVE" else 30)

    # ── Snapshot (REST) ───────────────────────────────────────────────────

    async def get_snapshot(self) -> Dict[str, Any]:
        if self._last_snapshot:
            return self._last_snapshot
        return await self._compute_all()

    # ── Core computation ──────────────────────────────────────────────────

    async def _compute_all(self) -> Dict[str, Any]:
        result: Dict[str, Any] = {}
        for symbol in ["NIFTY", "BANKNIFTY", "SENSEX"]:
            try:
                result[symbol] = await self._compute_symbol(symbol)
            except Exception as e:
                logger.debug(f"🏦 ICT {symbol} error: {e}")
                result[symbol] = self._fallback(symbol)
        return result

    async def _compute_symbol(self, symbol: str) -> Dict[str, Any]:
        # Read live market data from shared cache
        # _SHARED_CACHE stores (json_string, expire_at) tuples
        raw = _SHARED_CACHE.get(f"market:{symbol}")
        if not raw:
            return self._fallback(symbol)

        try:
            if isinstance(raw, tuple):
                json_str, expire_at = raw
                if time.time() >= expire_at:
                    return self._fallback(symbol)
                data = json.loads(json_str) if isinstance(json_str, str) else {}
            elif isinstance(raw, dict):
                data = raw
            elif isinstance(raw, str):
                data = json.loads(raw)
            else:
                data = {}
        except Exception:
            data = {}

        if not data:
            return self._fallback(symbol)

        price = float(data.get("price") or data.get("last_price") or 0)
        if price <= 0:
            return self._fallback(symbol)

        change_pct = float(data.get("changePercent") or data.get("change_percent") or 0)
        oi = int(data.get("oi") or data.get("open_interest") or 0)

        # Get candle data (await async lrange)
        candle_key = f"analysis_candles:{symbol}"
        raw_candles = await self._cache.lrange(candle_key, 0, 30)
        candles: List[Dict] = []
        for item in (raw_candles or []):
            c = _parse_candle(item)
            if c:
                candles.append(c)
        candles.reverse()  # Oldest first

        # Determine data source
        now_ist = datetime.now(IST)
        hour = now_ist.hour
        minute = now_ist.minute
        weekday = now_ist.weekday()
        is_live = (
            weekday < 5
            and ((hour == 9 and minute >= 15) or (hour > 9 and hour < 15) or (hour == 15 and minute <= 30))
        )
        data_source = "LIVE" if is_live else "MARKET_CLOSED"

        swing_tracker = self._swing_trackers[symbol]

        # ── Compute all 6 ICT signals ────────────────────────────────────
        signals = {
            "order_blocks": _order_block_signal(candles, price),
            "fair_value_gaps": _fair_value_gap_signal(candles, price),
            "market_structure": _market_structure_signal(candles, swing_tracker),
            "liquidity_sweeps": _liquidity_sweep_signal(candles, swing_tracker, price),
            "displacement": _displacement_signal(candles),
            "smart_money_div": _smart_money_divergence_signal(candles, price, oi, change_pct),
        }

        # ── Composite score ──────────────────────────────────────────────
        composite = sum(
            signals[k]["score"] * WEIGHTS[k]
            for k in WEIGHTS
        )
        composite = _clamp(composite, -1.0, 1.0)

        # Direction
        if composite >= BULL_T:
            direction = "BULLISH"
        elif composite <= BEAR_T:
            direction = "BEARISH"
        else:
            direction = "NEUTRAL"

        # Confidence: how aligned are the signals?
        signal_scores = [signals[k]["score"] for k in WEIGHTS]
        active_signals = [s for s in signal_scores if abs(s) > 0.05]
        magnitude = abs(composite)

        if direction == "NEUTRAL":
            # For NEUTRAL: confidence = how balanced/conflicting signals are
            # High confidence NEUTRAL = signals truly cancel out (strong opposing forces)
            # Low confidence NEUTRAL = all signals near zero (no data / no conviction)
            if active_signals:
                avg_magnitude = sum(abs(s) for s in active_signals) / len(active_signals)
                bull_count = sum(1 for s in active_signals if s > 0)
                bear_count = sum(1 for s in active_signals if s < 0)
                balance = 1.0 - abs(bull_count - bear_count) / max(len(active_signals), 1)
                confidence = int(_clamp(balance * 35 + avg_magnitude * 30 + (1.0 - magnitude / 0.20) * 20, 5, 85))
            else:
                confidence = 5
        else:
            # For BULLISH/BEARISH: confidence = signal agreement with direction
            if active_signals and magnitude > 0.03:
                agreement = sum(1 for s in active_signals if (s > 0) == (composite > 0)) / len(active_signals)
            else:
                agreement = 0.0
            confidence = int(_clamp(agreement * 55 + magnitude * 44, 5, 99))

        # ── ICT Setup type ───────────────────────────────────────────────
        ict_setup = self._classify_setup(signals, composite)

        # ── 5-Min ICT Prediction ─────────────────────────────────────────
        pred_score = sum(
            signals[k]["score"] * W5M[k]
            for k in W5M
        )
        pred_score = _clamp(pred_score, -1.0, 1.0)

        if pred_score >= 0.45:
            prediction_5m = "STRONG_BUY"
        elif pred_score >= 0.15:
            prediction_5m = "BUY"
        elif pred_score <= -0.45:
            prediction_5m = "STRONG_SELL"
        elif pred_score <= -0.15:
            prediction_5m = "SELL"
        else:
            prediction_5m = "NEUTRAL"

        # 5m prediction confidence (separate from overall)
        fast_signals = [signals[k]["score"] for k in ["displacement", "market_structure", "liquidity_sweeps"]]
        active_fast = [s for s in fast_signals if abs(s) > 0.05]
        if active_fast and abs(pred_score) > 0.03:
            fast_agreement = sum(1 for s in active_fast if (s > 0) == (pred_score > 0)) / len(active_fast)
        else:
            fast_agreement = 0.0
        pred_conf = int(_clamp(fast_agreement * 50 + abs(pred_score) * 48, 5, 99))

        return {
            "symbol": symbol,
            "direction": direction,
            "confidence": confidence,
            "rawScore": round(composite, 4),
            "ictSetup": ict_setup,
            "prediction5m": prediction_5m,
            "pred5mConf": pred_conf,
            "pred5mScore": round(pred_score, 4),
            "signals": signals,
            "metrics": {
                "price": price,
                "changePct": round(change_pct, 2),
                "oi": oi,
                "candleCount": len(candles),
                "swingHighs": len(swing_tracker.highs),
                "swingLows": len(swing_tracker.lows),
                "lastSwingHigh": swing_tracker.last_swing_high,
                "lastSwingLow": swing_tracker.last_swing_low,
            },
            "dataSource": data_source,
            "timestamp": datetime.now(IST).isoformat(),
        }

    def _classify_setup(self, signals: Dict, composite: float) -> Dict:
        """Classify the ICT setup type based on signal combination."""
        structure = signals["market_structure"]["extra"].get("structure", "RANGING")
        has_ob = abs(signals["order_blocks"]["score"]) > 0.2
        has_fvg = abs(signals["fair_value_gaps"]["score"]) > 0.15
        has_sweep = abs(signals["liquidity_sweeps"]["score"]) > 0.2
        has_disp = abs(signals["displacement"]["score"]) > 0.3
        has_div = abs(signals["smart_money_div"]["score"]) > 0.3
        has_struct = "BOS" in structure or "CHOCH" in structure

        # Count only directionally-aligned confluences (not opposing signals)
        bull_checks = [
            has_ob and signals["order_blocks"]["score"] > 0.2,
            has_fvg and signals["fair_value_gaps"]["score"] > 0.15,
            has_sweep and signals["liquidity_sweeps"]["score"] > 0.2,
            has_disp and signals["displacement"]["score"] > 0.3,
            has_div and signals["smart_money_div"]["score"] > 0.3,
            has_struct and "BULLISH" in structure,
        ]
        bear_checks = [
            has_ob and signals["order_blocks"]["score"] < -0.2,
            has_fvg and signals["fair_value_gaps"]["score"] < -0.15,
            has_sweep and signals["liquidity_sweeps"]["score"] < -0.2,
            has_disp and signals["displacement"]["score"] < -0.3,
            has_div and signals["smart_money_div"]["score"] < -0.3,
            has_struct and "BEARISH" in structure,
        ]
        bull_confluences = sum(bull_checks)
        bear_confluences = sum(bear_checks)

        if composite >= BULL_T:
            confluence_count = bull_confluences
            if has_sweep and has_ob and has_disp:
                setup_name = "🎯 PREMIUM LONG"
                setup_desc = "Sweep + Order Block + Displacement — Institutional long entry"
                grade = "A+"
            elif has_sweep and (has_ob or has_fvg):
                setup_name = "📈 SWEEP & REJECT LONG"
                setup_desc = "Liquidity sweep into demand zone — Smart money accumulation"
                grade = "A"
            elif "BOS" in structure and has_ob:
                setup_name = "💎 BOS + OB LONG"
                setup_desc = "Bullish BOS with order block support"
                grade = "A-"
            elif has_disp and has_fvg:
                setup_name = "⚡ FVG ENTRY LONG"
                setup_desc = "Displacement creating FVG — Price likely to retrace and hold"
                grade = "B+"
            elif confluence_count >= 2:
                setup_name = "📊 CONFLUENCE LONG"
                setup_desc = f"{confluence_count} bullish ICT signals aligned"
                grade = "B"
            else:
                setup_name = "▲ ICT LEAN LONG"
                setup_desc = "Mild bullish bias from ICT framework"
                grade = "C"
        elif composite <= BEAR_T:
            confluence_count = bear_confluences
            if has_sweep and has_ob and has_disp:
                setup_name = "🎯 PREMIUM SHORT"
                setup_desc = "Sweep + Supply Block + Displacement — Institutional short entry"
                grade = "A+"
            elif has_sweep and (has_ob or has_fvg):
                setup_name = "📉 SWEEP & REJECT SHORT"
                setup_desc = "Liquidity sweep into supply zone — Smart money distribution"
                grade = "A"
            elif "BOS" in structure and has_ob:
                setup_name = "💎 BOS + OB SHORT"
                setup_desc = "Bearish BOS with supply block resistance"
                grade = "A-"
            elif has_disp and has_fvg:
                setup_name = "⚡ FVG ENTRY SHORT"
                setup_desc = "Bearish displacement creating FVG — Sell on retrace"
                grade = "B+"
            elif confluence_count >= 2:
                setup_name = "📊 CONFLUENCE SHORT"
                setup_desc = f"{confluence_count} bearish ICT signals aligned"
                grade = "B"
            else:
                setup_name = "▼ ICT LEAN SHORT"
                setup_desc = "Mild bearish bias from ICT framework"
                grade = "C"
        else:
            confluence_count = 0  # No aligned confluences in NO TRADE ZONE
            setup_name = "⚖️ NO TRADE ZONE"
            setup_desc = "ICT signals mixed — Wait for alignment"
            grade = "—"

        return {
            "name": setup_name,
            "description": setup_desc,
            "grade": grade,
            "confluences": confluence_count,
        }

    def _fallback(self, symbol: str) -> Dict[str, Any]:
        """Return safe empty structure when data unavailable."""
        empty_signal = {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Awaiting live data...",
            "weight": 0.0, "value": None,
            "extra": {},
        }
        return {
            "symbol": symbol,
            "direction": "NEUTRAL",
            "confidence": 0,
            "rawScore": 0.0,
            "ictSetup": {"name": "⏳ LOADING", "description": "Waiting for market data", "grade": "—", "confluences": 0},
            "prediction5m": "NEUTRAL",
            "pred5mConf": 0,
            "pred5mScore": 0.0,
            "signals": {k: {**empty_signal, "weight": WEIGHTS[k]} for k in WEIGHTS},
            "metrics": {
                "price": 0, "changePct": 0, "oi": 0,
                "candleCount": 0, "swingHighs": 0, "swingLows": 0,
                "lastSwingHigh": None, "lastSwingLow": None,
            },
            "dataSource": "MARKET_CLOSED",
            "timestamp": datetime.now(IST).isoformat(),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_ict_service: Optional[ICTService] = None


def get_ict_service() -> ICTService:
    global _ict_service
    if _ict_service is None:
        _ict_service = ICTService()
    return _ict_service

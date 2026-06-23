"""
📈 Real-Time Chart Intelligence Engine
========================================
SMC-based charting: 3m/5m candles with auto-detected FVG zones,
support/resistance, PDH/PDL, CDH/CDL for NIFTY/BANKNIFTY/SENSEX.

DATA SOURCE: Zerodha historical_data API (3minute / 5minute intervals).
             Spot price from CacheService for latest candle updates.

CADENCE:     Live market  → full fetch every 10s, broadcast every 3s
             Closed       → serve persisted, broadcast every 60s

ISOLATION:   Own ConnectionManager, own asyncio task, own singleton.
             Zero impact on other services.
"""

import asyncio
import json
import logging
import math
import time as time_mod
from datetime import datetime, time, date, timedelta
from typing import Dict, Any, Optional, List, Set
from pathlib import Path

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE
from services.chart_intelligence_ai import ChartIntelligenceAIEngine
from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
settings = get_settings()


def _current_settings():
    """Fetch latest cached settings object (updated after token refresh)."""
    return get_settings()

SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

# Well-known Zerodha instrument tokens for indices
INDEX_TOKENS: Dict[str, int] = {
    "NIFTY": 256265,
    "BANKNIFTY": 260105,
    "SENSEX": 265,
}

PERSISTENT_FILE = Path(__file__).parent.parent / "data" / "chart_intelligence_state.json"
_CHART_AI_ENGINE = ChartIntelligenceAIEngine()


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class ChartIntelConnectionManager:
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
            await asyncio.wait_for(
                ws.send_text(json.dumps(data, default=str)), timeout=3.0
            )
        except Exception:
            await self.disconnect(ws)

    @property
    def client_count(self) -> int:
        return len(self._connections)


chart_intel_manager = ChartIntelConnectionManager()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sf(v, default=0.0):
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _load_persistent() -> Dict[str, Any]:
    try:
        if PERSISTENT_FILE.exists():
            with open(PERSISTENT_FILE, "r") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_persistent(state: Dict[str, Any]):
    try:
        PERSISTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PERSISTENT_FILE, "w") as f:
            json.dump(state, f, default=str)
    except Exception:
        pass


# ── SMC Computations ─────────────────────────────────────────────────────────

def _detect_fvg(candles: List[Dict]) -> List[Dict]:
    """
    Detect Fair Value Gaps with advanced quality scoring.

    Quality tiers:
      PREMIUM  — high-probability retrace zone (score ≥ 0.72)
        • Impulse momentum ≥ 0.3% (strong push created the gap)
        • Gap size ≥ 0.15% of price (meaningful imbalance)
        • Body-to-range ratio ≥ 0.6 on the impulse candle (conviction, not a wick trap)
        • NOT overlapping with an existing unfilled FVG (fresh imbalance)
        • RECENT: formed within last 30 candles
      STANDARD — medium probability (score 0.42–0.72)
      WEAK     — low probability, clutter (score < 0.42) — still drawn, but very dim

    Additional fields:
      partialFill  — how much of the gap (%) has been touched back into (0–1)
      momentum     — impulse body % move that created the gap (useful for label display)
      candles_ago  — how many candles back the FVG was formed
    """
    fvgs = []
    if len(candles) < 3:
        return fvgs

    n = len(candles)

    for i in range(2, n):
        c0 = candles[i - 2]  # First candle
        c1 = candles[i - 1]  # Middle candle (the impulse candle)
        c2 = candles[i]      # Third candle

        h0, l0 = c0["h"], c0["l"]
        h1, l1, o1, cl1 = c1["h"], c1["l"], c1["o"], c1["c"]
        h2, l2 = c2["h"], c2["l"]

        candles_ago = n - 1 - i  # 0 = most recent

        for fvg_type in ("bullish", "bearish"):
            if fvg_type == "bullish":
                # Bullish FVG: gap up — third candle low > first candle high
                if l2 <= h0:
                    continue
                gap_top    = l2
                gap_bottom = h0
                # Impulse candle should be bullish (confirms the gap direction)
                impulse_body    = (cl1 - o1) / max(o1, 1) if cl1 > o1 else 0.0
                body_range_rat  = abs(cl1 - o1) / (h1 - l1) if h1 > l1 else 0.0
                momentum_move   = (h2 - l0) / l0 if l0 > 0 else 0.0  # full swing
            else:
                # Bearish FVG: gap down — third candle high < first candle low
                if h2 >= l0:
                    continue
                gap_top    = l0
                gap_bottom = h2
                # Impulse candle should be bearish
                impulse_body    = (o1 - cl1) / max(o1, 1) if o1 > cl1 else 0.0
                body_range_rat  = abs(cl1 - o1) / (h1 - l1) if h1 > l1 else 0.0
                momentum_move   = (h0 - l2) / l2 if l2 > 0 else 0.0

            gap_size    = gap_top - gap_bottom
            mid_price   = (gap_top + gap_bottom) / 2
            gap_pct     = gap_size / mid_price if mid_price > 0 else 0.0

            # ── Fill detection ─────────────────────────────────────────────
            filled       = False
            partial_fill = 0.0
            max_penetration = 0.0
            for j in range(i + 1, n):
                cj = candles[j]
                if fvg_type == "bullish":
                    # Price came back down into the gap
                    if cj["l"] < gap_top:
                        pen = min(gap_top, max(cj["l"], gap_bottom))
                        pen_ratio = (gap_top - pen) / gap_size if gap_size > 0 else 0.0
                        if pen_ratio > max_penetration:
                            max_penetration = pen_ratio
                    if cj["l"] <= gap_bottom:
                        filled = True
                        max_penetration = 1.0
                        break
                else:
                    if cj["h"] > gap_bottom:
                        pen = max(gap_bottom, min(cj["h"], gap_top))
                        pen_ratio = (pen - gap_bottom) / gap_size if gap_size > 0 else 0.0
                        if pen_ratio > max_penetration:
                            max_penetration = pen_ratio
                    if cj["h"] >= gap_top:
                        filled = True
                        max_penetration = 1.0
                        break
            partial_fill = round(max_penetration, 2)

            # ── Quality scoring ─────────────────────────────────────────────
            # Each criterion contributes to score (0.0–1.0)
            score = 0.0

            # 1. Gap size significance (0–0.25): ≥0.15% = full credit
            score += min(0.25, (gap_pct / 0.0015) * 0.25)

            # 2. Impulse body pct (0–0.25): ≥0.3% move on impulse candle
            score += min(0.25, (impulse_body / 0.003) * 0.25)

            # 3. Body-to-range ratio (0–0.20): ≥0.6 = conviction candle, not a wick
            score += min(0.20, (body_range_rat / 0.6) * 0.20)

            # 4. Recency (0–0.15): formed within last 10 candles = full credit
            recency = max(0.0, 1.0 - candles_ago / 30.0)
            score += recency * 0.15

            # 5. Not yet touched (partial fill penalty)
            # FVG that was touched 50%+ loses half its quality
            score *= (1.0 - partial_fill * 0.55)

            score = round(min(1.0, score), 2)

            # ── Quality tier ────────────────────────────────────────────────
            if score >= 0.72:
                quality = "PREMIUM"
            elif score >= 0.42:
                quality = "STANDARD"
            else:
                quality = "WEAK"

            fvgs.append({
                "type": fvg_type,
                "top": round(gap_top, 2),
                "bottom": round(gap_bottom, 2),
                "startIdx": i,
                "filled": filled,
                "strength": score,          # backward-compat alias
                "quality": quality,         # PREMIUM | STANDARD | WEAK
                "partialFill": partial_fill,
                "momentum": round(momentum_move * 100, 3),   # % swing that created the gap
                "candles_ago": candles_ago,
            })

    # Keep: all PREMIUM + STANDARD unfilled, last 3 WEAK unfilled, all filled for fading
    result = []
    for q in ("PREMIUM", "STANDARD"):
        result.extend([f for f in fvgs if f["quality"] == q and not f["filled"]])
    result.extend([f for f in fvgs if f["quality"] == "WEAK" and not f["filled"]][-3:])
    result.extend([f for f in fvgs if f["filled"]][-4:])  # keep recent filled for reference

    # Sort by startIdx so chart draws in order
    result.sort(key=lambda f: f["startIdx"])
    return result


def _compute_zone_participants(candles: List[Dict], zone_top: float, zone_bottom: float) -> Dict:
    """
    Compute bull/bear participant volume at a price zone.

    A candle "participates" in a zone if its high-low range overlaps the zone.
    Bull participants = volume from bullish (close >= open) candles touching the zone.
    Bear participants = volume from bearish (close < open) candles touching the zone.
    In trading: bull_vol = buyers defending/attacking the level,
                bear_vol = sellers defending/attacking the level.

    Returns:
        bull_vol    — total volume from bullish candles in the zone
        bear_vol    — total volume from bearish candles in the zone
        touch_count — how many candles have overlapped this zone
        total_vol   — bull_vol + bear_vol
        defender    — 'BULLS' | 'BEARS' | 'BALANCED' (who dominates the zone)
        bull_pct    — percentage of total volume that is bullish (0–100)
    """
    bull_vol = 0
    bear_vol = 0
    touch_count = 0

    for c in candles:
        # A candle touches the zone when its range overlaps zone [bottom, top]
        if c["l"] <= zone_top and c["h"] >= zone_bottom:
            touch_count += 1
            vol = c.get("v") or 0
            if c["c"] >= c["o"]:  # bullish or neutral candle — buyers in control
                bull_vol += vol
            else:                 # bearish candle — sellers in control
                bear_vol += vol

    total = bull_vol + bear_vol
    if total == 0:
        defender = "BALANCED"
        bull_pct = 50
    else:
        bull_pct = round(bull_vol / total * 100)
        if bull_vol > bear_vol * 1.25:
            defender = "BULLS"
        elif bear_vol > bull_vol * 1.25:
            defender = "BEARS"
        else:
            defender = "BALANCED"

    return {
        "bull_vol": bull_vol,
        "bear_vol": bear_vol,
        "touch_count": touch_count,
        "total_vol": total,
        "defender": defender,
        "bull_pct": bull_pct,
    }


def _inject_participants(candles: List[Dict], fvgs: List[Dict], obs: List[Dict], liqs: List[Dict]) -> None:
    """Inject participant volume data into FVG, OB, and Liquidity zone lists in-place."""
    # FVGs — zone spans [bottom, top]
    for fvg in fvgs:
        p = _compute_zone_participants(candles, fvg["top"], fvg["bottom"])
        fvg.update(p)

    # Order Blocks — use the OB body zone [bottom, top] (body of the OB candle)
    for ob in obs:
        p = _compute_zone_participants(candles, ob["top"], ob["bottom"])
        ob.update(p)

    # Liquidity levels — treat as a thin band ±0.12% around the level
    for liq in liqs:
        lv = liq["level"]
        band = lv * 0.0012
        p = _compute_zone_participants(candles, lv + band, lv - band)
        liq.update(p)


def _inject_level_participants(candles: List[Dict], levels: Dict) -> None:
    """Inject participant volume into PDH/PDL/CDH/CDL and S/R level dicts."""
    def _zone_for_level(price: float) -> Dict:
        band = price * 0.0012  # ±0.12% band around the level
        return _compute_zone_participants(candles, price + band, price - band)

    for key in ("pdh", "pdl", "cdh", "cdl"):
        lv = levels.get(key, 0.0)
        if lv and lv > 0:
            p = _zone_for_level(lv)
            levels[f"{key}_participants"] = p

    # Support and resistance arrays — compute per level
    sr_participants: Dict[str, List[Dict]] = {"support": [], "resistance": []}
    for lv in levels.get("support", []):
        sr_participants["support"].append({"price": lv, **_zone_for_level(lv)})
    for lv in levels.get("resistance", []):
        sr_participants["resistance"].append({"price": lv, **_zone_for_level(lv)})
    levels["sr_participants"] = sr_participants


def _inject_strike_oi(fvgs: List[Dict], obs: List[Dict], liqs: List[Dict], levels: Dict, symbol: str) -> None:
    """
    Inject live CE/PE OI data at the nearest option strike for every zone price.
    Uses the per-strike OI map maintained by pcr_service (updated every 10s).
    All data is live option chain data from Zerodha — no historical candle fallback.
    """
    try:
        from services.pcr_service import get_strike_oi
    except Exception:
        return

    def _inject(zone: Dict, price: float) -> None:
        oi = get_strike_oi(symbol, price)
        zone["strike"]           = oi["strike"]
        zone["ce_oi"]            = oi["ce_oi"]
        zone["pe_oi"]            = oi["pe_oi"]
        zone["ce_oi_chg"]        = oi["ce_oi_chg"]
        zone["pe_oi_chg"]        = oi["pe_oi_chg"]
        zone["ce_vol"]           = oi["ce_vol"]
        zone["pe_vol"]           = oi["pe_vol"]
        zone["rotation"]         = oi["rotation"]
        zone["oi_defender"]      = oi["defender"]
        zone["oi_interpretation"]= oi["oi_interpretation"]

    for fvg in fvgs:
        _inject(fvg, (fvg["top"] + fvg["bottom"]) / 2)
    for ob in obs:
        _inject(ob, (ob["top"] + ob["bottom"]) / 2)
    for lq in liqs:
        _inject(lq, lq["level"])

    for key in ("pdh", "pdl", "cdh", "cdl"):
        lv = levels.get(key, 0.0)
        if lv and lv > 0:
            oi = get_strike_oi(symbol, lv)
            levels[f"{key}_strike_oi"] = oi

    # S/R levels
    sr_p = levels.get("sr_participants", {})
    for side in ("support", "resistance"):
        for entry in sr_p.get(side, []):
            oi = get_strike_oi(symbol, entry["price"])
            entry.update({
                "strike": oi["strike"], "ce_oi": oi["ce_oi"], "pe_oi": oi["pe_oi"],
                "ce_oi_chg": oi["ce_oi_chg"], "pe_oi_chg": oi["pe_oi_chg"],
                "ce_vol": oi["ce_vol"], "pe_vol": oi["pe_vol"],
                "rotation": oi["rotation"], "oi_defender": oi["defender"],
                "oi_interpretation": oi["oi_interpretation"],
            })


def _detect_order_blocks(candles: List[Dict]) -> List[Dict]:
    """
    Detect Order Blocks: last bullish/bearish candle before a strong impulsive move.
    Bullish OB  = last bearish candle before a strong up-move (≥0.15% from candle high in next 3 candles).
    Bearish OB  = last bullish candle before a strong down-move.

    FIXES applied:
    • Mitigation now uses OB body (open/close range) NOT the wick — wick-based mitigation
      falsely kept phantom OBs active when their body zone had already been traded through.
    • impulse_vol added — volume from the 3 candles after the OB that confirmed the move.
      This lets the UI show the actual directional conviction (buying for bullish OB,
      selling for bearish OB) instead of the OB candle's own volume which is always
      the OPPOSITE direction (bearish candle for bullish OB, bullish candle for bearish OB).
    • Balanced return: up to 4 bullish (demand zones, below price) + 4 bearish (supply zones,
      above price). Previous code took the last 6 regardless of type, which meant in a trending
      market all 6 could be one-sided, leaving the other side of the chart empty.
    """
    obs = []
    if len(candles) < 5:
        return obs

    for i in range(1, len(candles) - 3):
        c = candles[i]
        body = abs(c["c"] - c["o"])
        mid = (c["h"] + c["l"]) / 2 or 1.0
        # Minimum body size: 0.02% of price (avoid pure doji)
        if body < mid * 0.0002:
            continue

        is_bear = c["c"] < c["o"]
        is_bull = c["c"] > c["o"]

        # Measure impulse over next 3 candles
        future = candles[i + 1: i + 4]
        if not future:
            continue
        imp_high = max(f["h"] for f in future)
        imp_low = min(f["l"] for f in future)
        # impulse_vol = total volume of the 3 candles that moved price away from the OB.
        # For a bullish OB this is the buying conviction; for bearish OB it is the selling conviction.
        impulse_vol = sum(f.get("v", 0) for f in future)

        # OB body bounds — used for proper mitigation check (wick excluded)
        ob_body_top    = round(max(c["o"], c["c"]), 2)
        ob_body_bottom = round(min(c["o"], c["c"]), 2)

        # Bullish OB: bearish candle, then up-move ≥ 0.15%
        if is_bear and c["h"] > 0 and (imp_high - c["h"]) / c["h"] >= 0.0015:
            # FIX: mitigated when price trades back INTO the OB body (not wick low)
            mitigated = any(
                candles[j]["l"] <= ob_body_bottom
                for j in range(i + 4, len(candles))
            )
            ob_strength = round(min(1.0, (imp_high - c["h"]) / (c["h"] * 0.005)), 2)
            ob_quality = (
                "PREMIUM" if ob_strength >= 0.80 and not mitigated else
                "STANDARD" if ob_strength >= 0.45 and not mitigated else
                "WEAK"
            )
            obs.append({
                "type": "bullish",
                "top": ob_body_top,
                "bottom": ob_body_bottom,
                "high": round(c["h"], 2),
                "low": round(c["l"], 2),
                "startIdx": i,
                "mitigated": mitigated,
                "strength": ob_strength,
                "quality": ob_quality,
                "candles_ago": len(candles) - 1 - i,
                "impulse_vol": impulse_vol,
            })

        # Bearish OB: bullish candle, then down-move ≥ 0.15%
        if is_bull and c["l"] > 0 and (c["l"] - imp_low) / c["l"] >= 0.0015:
            # FIX: mitigated when price trades back INTO the OB body (not wick high)
            mitigated = any(
                candles[j]["h"] >= ob_body_top
                for j in range(i + 4, len(candles))
            )
            ob_strength = round(min(1.0, (c["l"] - imp_low) / (c["l"] * 0.005)), 2)
            ob_quality = (
                "PREMIUM" if ob_strength >= 0.80 and not mitigated else
                "STANDARD" if ob_strength >= 0.45 and not mitigated else
                "WEAK"
            )
            obs.append({
                "type": "bearish",
                "top": ob_body_top,
                "bottom": ob_body_bottom,
                "high": round(c["h"], 2),
                "low": round(c["l"], 2),
                "startIdx": i,
                "mitigated": mitigated,
                "strength": ob_strength,
                "quality": ob_quality,
                "candles_ago": len(candles) - 1 - i,
                "impulse_vol": impulse_vol,
            })

    # FIX: Balance bullish (demand/below price) and bearish (supply/above price) OBs.
    # Previous code returned the last 6 regardless of type — in trending markets all 6
    # were the same direction, leaving the opposite side of the chart with no OBs.
    bullish_obs = sorted(
        [ob for ob in obs if ob["type"] == "bullish" and not ob["mitigated"]],
        key=lambda x: x["startIdx"],
    )[-4:]
    bearish_obs = sorted(
        [ob for ob in obs if ob["type"] == "bearish" and not ob["mitigated"]],
        key=lambda x: x["startIdx"],
    )[-4:]
    mitigated_recent = sorted(
        [ob for ob in obs if ob["mitigated"]],
        key=lambda x: x["startIdx"],
    )[-3:]
    return bullish_obs + bearish_obs + mitigated_recent


def _detect_liquidity(candles: List[Dict]) -> List[Dict]:
    """
    Detect liquidity levels (equal highs / equal lows) and sweeps.
    Equal highs = resistance cluster where price faked above then reversed.
    Equal lows  = support cluster where price faked below then reversed.
    """
    if len(candles) < 10:
        return []

    liquidity = []
    tol = 0.002  # 0.2% tolerance for "equal" highs/lows

    highs = [(i, c["h"]) for i, c in enumerate(candles)]
    lows = [(i, c["l"]) for i, c in enumerate(candles)]

    # Find clusters of equal highs (sell-side liquidity above)
    for i in range(len(highs) - 3):
        idx_a, h_a = highs[i]
        matches = [
            idx_b for idx_b, h_b in highs[i + 1:]
            if abs(h_b - h_a) / h_a < tol
        ]
        if len(matches) >= 1:
            # Check if a later candle swept above and closed back below
            sweep_idx = None
            for j in range(matches[-1] + 1, len(candles)):
                if candles[j]["h"] > h_a * (1 + tol) and candles[j]["c"] < h_a:
                    sweep_idx = j
                    break
            tc_sell = 1 + len(matches)
            is_swept_sell = sweep_idx is not None
            lq_quality_sell = (
                "PREMIUM" if tc_sell >= 3 and not is_swept_sell else
                "STANDARD" if not is_swept_sell else
                "WEAK"
            )
            liquidity.append({
                "type": "sell_side",          # liquidity resting above equal highs
                "level": round(h_a, 2),
                "startIdx": idx_a,
                "swept": is_swept_sell,
                "sweepIdx": sweep_idx,
                "touchCount": tc_sell,
                "quality": lq_quality_sell,
            })

    # Find clusters of equal lows (buy-side liquidity below)
    for i in range(len(lows) - 3):
        idx_a, l_a = lows[i]
        matches = [
            idx_b for idx_b, l_b in lows[i + 1:]
            if abs(l_b - l_a) / l_a < tol
        ]
        if len(matches) >= 1:
            sweep_idx = None
            for j in range(matches[-1] + 1, len(candles)):
                if candles[j]["l"] < l_a * (1 - tol) and candles[j]["c"] > l_a:
                    sweep_idx = j
                    break
            tc_buy = 1 + len(matches)
            is_swept_buy = sweep_idx is not None
            lq_quality_buy = (
                "PREMIUM" if tc_buy >= 3 and not is_swept_buy else
                "STANDARD" if not is_swept_buy else
                "WEAK"
            )
            liquidity.append({
                "type": "buy_side",           # liquidity resting below equal lows
                "level": round(l_a, 2),
                "startIdx": idx_a,
                "swept": is_swept_buy,
                "sweepIdx": sweep_idx,
                "touchCount": tc_buy,
                "quality": lq_quality_buy,
            })

    # Keep strongest 8 (by touch count), deduplicate by level within 0.2%
    liquidity.sort(key=lambda x: x["touchCount"], reverse=True)
    seen: List[float] = []
    deduped = []
    for lq in liquidity:
        lv = lq["level"]
        if not any(abs(lv - s) / s < 0.002 for s in seen):
            seen.append(lv)
            deduped.append(lq)
        if len(deduped) >= 8:
            break

    return deduped


def _compute_support_resistance(candles: List[Dict], window: int = 3) -> Dict[str, List[float]]:
    """Detect swing highs/lows as support/resistance levels."""
    supports = []
    resistances = []
    if len(candles) < window * 2 + 1:
        # Not enough candles for swing detection — fall back to recent high/low
        if candles:
            recent = candles[-min(20, len(candles)):]
            return {
                "support": [round(min(c["l"] for c in recent), 2)],
                "resistance": [round(max(c["h"] for c in recent), 2)],
            }
        return {"support": [], "resistance": []}

    for i in range(window, len(candles) - window):
        # Swing high
        is_swing_high = True
        for j in range(i - window, i + window + 1):
            if j == i:
                continue
            if candles[j]["h"] >= candles[i]["h"]:
                is_swing_high = False
                break
        if is_swing_high:
            resistances.append(round(candles[i]["h"], 2))

        # Swing low
        is_swing_low = True
        for j in range(i - window, i + window + 1):
            if j == i:
                continue
            if candles[j]["l"] <= candles[i]["l"]:
                is_swing_low = False
                break
        if is_swing_low:
            supports.append(round(candles[i]["l"], 2))

    # Cluster nearby levels (within 0.15% of each other)
    def cluster(levels: List[float]) -> List[float]:
        if not levels:
            return []
        levels.sort()
        clusters = []
        current = [levels[0]]
        for lv in levels[1:]:
            if current and abs(lv - current[-1]) / current[-1] < 0.0015:
                current.append(lv)
            else:
                clusters.append(round(sum(current) / len(current), 2))
                current = [lv]
        if current:
            clusters.append(round(sum(current) / len(current), 2))
        return clusters[-8:]  # Keep up to 8 levels

    return {
        "support": cluster(supports),
        "resistance": cluster(resistances),
    }


def _compute_levels(candles_3m: List[Dict], daily_candles: List[Dict], spot: float) -> Dict:
    """Compute PDH/PDL, CDH/CDL, and S/R levels."""
    # PDH / PDL from daily candles
    pdh = 0.0
    pdl = 0.0
    if daily_candles and len(daily_candles) >= 2:
        prev = daily_candles[-2]
        pdh = round(_sf(prev.get("h", prev.get("high"))), 2)
        pdl = round(_sf(prev.get("l", prev.get("low"))), 2)
    elif daily_candles and len(daily_candles) == 1:
        prev = daily_candles[0]
        pdh = round(_sf(prev.get("h", prev.get("high"))), 2)
        pdl = round(_sf(prev.get("l", prev.get("low"))), 2)
    else:
        pdh = round(spot * 1.008, 2)
        pdl = round(spot * 0.992, 2)

    # CDH / CDL from today's intraday candles
    today_str = datetime.now(IST).strftime("%Y-%m-%d")
    today_candles = [c for c in candles_3m if str(c.get("t", "")).startswith(today_str)]
    if today_candles:
        cdh = round(max(c["h"] for c in today_candles), 2)
        cdl = round(min(c["l"] for c in today_candles), 2)
    else:
        cdh = round(max((c["h"] for c in candles_3m), default=spot), 2)
        cdl = round(min((c["l"] for c in candles_3m), default=spot), 2)

    sr = _compute_support_resistance(candles_3m)

    return {
        "pdh": pdh, "pdl": pdl,
        "cdh": cdh, "cdl": cdl,
        "support": sr["support"],
        "resistance": sr["resistance"],
    }


# ── Core Service ─────────────────────────────────────────────────────────────

class ChartIntelligenceService:
    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._cache = CacheService()
        self._kite = None
        self._kite_initialized = False
        self._last_token: Optional[str] = None
        self._last_snapshot: Dict[str, Any] = {}
        self._instruments_cache: Dict[str, List] = {}
        self._daily_cache: Dict[str, Any] = {}  # symbol -> {date, candles}
        self._last_save_time: float = 0.0
        self._last_full_fetch: float = 0.0
        self._cadence_broadcast = 0.5   # 0.5s — TradingView-like live candle motion
        self._cadence_fetch = 1.5       # Full Zerodha candle re-fetch every 1.5s (fast volume refresh)
        self._cadence_closed = 60.0
        self._heartbeat_interval = 30.0
        self._kite_init_backoff_until: float = 0.0
        self._fetch_task: Optional[asyncio.Task] = None
        self._need_immediate_fetch: bool = False  # Set True when new bar detected
        # Real-time candle volume tracking via SHARED_CACHE (tick data)
        # key = "SYMBOL:Xm"  value = day-cumulative volume at candle-bar start
        self._candle_start_vol: Dict[str, int] = {}
        # key = "SYMBOL"  value = last seen day-total volume from cache
        self._last_day_vol: Dict[str, int] = {}
        # LOT sizes for futures volume → units conversion
        self._LOT_SIZES: Dict[str, int] = {"NIFTY": 75, "BANKNIFTY": 30, "SENSEX": 20}

    # ── Kite init ────────────────────────────────────────────────────────

    def _init_kite(self):
        cfg = _current_settings()
        current_token = cfg.zerodha_access_token
        if current_token and current_token != self._last_token:
            self._kite_initialized = False
            self._last_token = current_token
            self._kite_init_backoff_until = 0.0

        if self._kite_initialized:
            return

        now = time_mod.time()
        if now < self._kite_init_backoff_until:
            return

        if not cfg.zerodha_api_key or not cfg.zerodha_access_token:
            self._kite_init_backoff_until = now + 60
            return

        try:
            from kiteconnect import KiteConnect
            self._kite = KiteConnect(api_key=cfg.zerodha_api_key)
            self._kite.set_access_token(cfg.zerodha_access_token)
            try:
                self._kite.profile()
                self._kite_initialized = True
                logger.info("Chart Intelligence: KiteConnect initialized")
            except Exception as e:
                logger.warning("Chart Intelligence: Token failed: %s", e)
                self._kite = None
                self._kite_initialized = False
                self._kite_init_backoff_until = now + 30
        except Exception as e:
            logger.warning("Chart Intelligence: Init error: %s", e)
            self._kite = None
            self._kite_initialized = False
            self._kite_init_backoff_until = now + 30

    # ── Spot price ───────────────────────────────────────────────────────

    def _get_spot_price(self, symbol: str) -> float:
        # _SHARED_CACHE stores (json_str, expire_at) tuples — unpack correctly
        cache_key = f"market:{symbol}"
        raw = _SHARED_CACHE.get(cache_key)
        if raw is not None:
            try:
                value_json, expire_at = raw
                if time_mod.time() < expire_at:
                    data = json.loads(value_json)
                    spot = _sf(data.get("price") or data.get("last_price"))
                    if spot > 0:
                        return spot
            except Exception:
                pass
        try:
            from services.persistent_market_state import PersistentMarketState
            state = PersistentMarketState.get_state(symbol)
            if state:
                spot = _sf(state.get("price") or state.get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass
        try:
            pfile = Path(__file__).parent.parent / "data" / "persistent_market_state.json"
            if pfile.exists():
                with open(pfile, "r") as f:
                    pdata = json.load(f)
                spot = _sf(pdata.get(symbol, {}).get("price") or pdata.get(symbol, {}).get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass
        return 0.0

    def _get_live_candle_volume(self, symbol: str, candle_t_iso: str, interval_min: int) -> int:
        """Return current candle's volume using tick-level day-cumulative volume from SHARED_CACHE.

        Strategy:
        1. Read the latest day-total volume from the market tick cache (updated every 0.5s).
        2. On each new candle bar, record that moment's day-total as the candle-start baseline.
        3. current_candle_volume = day_total_now − candle_start_baseline

        Falls back to 0 if cache has no volume data (indices return v=0 from Zerodha ticks,
        but the futures historical volume injected by _fetch_candles_sync covers those).
        """
        try:
            cache_key = f"market:{symbol}"
            raw = _SHARED_CACHE.get(cache_key)
            if raw is None:
                return 0
            value_json, expire_at = raw
            if time_mod.time() >= expire_at:
                return 0
            data = json.loads(value_json)
            day_vol = int(data.get("volume") or 0)
            if day_vol <= 0:
                return 0

            # Lot-size conversion: cache volume may be in lots (from QUOTE_VOLUMES)
            # or raw units — we store both and pick whichever is larger (safer)
            lot_size = self._LOT_SIZES.get(symbol, 1)

            track_key = f"{symbol}:{interval_min}m"
            candle_marker_key = f"{track_key}:t"
            last_t = self._last_day_vol.get(candle_marker_key)

            # Track each timeframe independently. Sharing one last-seen candle marker
            # across 3m/5m bars lets one timeframe reset the other's volume baseline.
            if last_t != candle_t_iso:
                self._candle_start_vol[track_key] = day_vol * lot_size
                self._last_day_vol[candle_marker_key] = candle_t_iso

            self._last_day_vol[symbol] = day_vol * lot_size
            baseline = self._candle_start_vol.get(track_key, day_vol * lot_size)
            current_vol = max(0, day_vol * lot_size - baseline)
            return current_vol
        except Exception:
            return 0

    # ── Market phase ─────────────────────────────────────────────────────

    def _get_market_phase(self) -> str:
        now = datetime.now(IST)
        if now.weekday() >= 5:
            return "CLOSED"
        t = now.time()
        if time(9, 15) <= t <= time(15, 30):
            return "LIVE"
        if time(9, 0) <= t < time(9, 15):
            return "PRE_OPEN"
        return "CLOSED"

    # ── Fetch candle data from Zerodha ───────────────────────────────────

    def _fetch_candles_sync(self, symbol: str, interval: str) -> List[Dict]:
        """Fetch intraday candles from Zerodha historical data API.
        Index tokens return v=0, so we also fetch futures candles for volume.
        """
        if not self._kite:
            return []

        token = INDEX_TOKENS.get(symbol)
        if not token:
            return []

        now = datetime.now(IST)
        today = now.date()
        from_dt = datetime.combine(today, time(9, 15), tzinfo=IST)
        to_dt = now

        try:
            raw = self._kite.historical_data(token, from_dt, to_dt, interval)
        except Exception as e:
            logger.debug("Chart intel fetch %s %s failed: %s", symbol, interval, e)
            return []

        # Build spot candles
        candles = []
        for r in raw:
            candles.append({
                "t": r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"]),
                "o": round(float(r["open"]), 2),
                "h": round(float(r["high"]), 2),
                "l": round(float(r["low"]), 2),
                "c": round(float(r["close"]), 2),
                "v": int(r.get("volume", 0)),
            })

        # Inject futures volume — indices return v=0 from Zerodha historical data.
        # Futures contracts have real traded volume; match by candle timestamp.
        try:
            _cfg = get_settings()
            fut_token_map = {
                "NIFTY":     getattr(_cfg, "nifty_fut_token",     None),
                "BANKNIFTY": getattr(_cfg, "banknifty_fut_token", None),
                "SENSEX":    getattr(_cfg, "sensex_fut_token",    None),
            }
            fut_token = fut_token_map.get(symbol)
            if fut_token:
                fut_raw = self._kite.historical_data(fut_token, from_dt, to_dt, interval)
                # Zerodha returns futures volume in contracts (lots).
                # Multiply by lot size to get actual units traded — this gives
                # proper K/M scale numbers (e.g. NIFTY 56K lots × 75 = 4.3M).
                LOT_SIZES: Dict[str, int] = {"NIFTY": 75, "BANKNIFTY": 30, "SENSEX": 20}
                lot_size = LOT_SIZES.get(symbol, 1)
                # Build timestamp → volume lookup from futures candles
                vol_map: Dict[str, int] = {}
                for r in fut_raw:
                    ts = r["date"].isoformat() if hasattr(r["date"], "isoformat") else str(r["date"])
                    # Normalise to minute-level key (strip seconds/tz)
                    ts_key = ts[:16]
                    vol_map[ts_key] = int(r.get("volume", 0)) * lot_size
                # Inject into spot candles
                injected = 0
                for c in candles:
                    if c["v"] == 0:
                        ts_key = c["t"][:16]
                        v = vol_map.get(ts_key, 0)
                        if v > 0:
                            c["v"] = v
                            injected += 1
                logger.debug("Chart intel vol inject %s %s: fut_candles=%d injected=%d (lot_size=%d)",
                             symbol, interval, len(fut_raw), injected, lot_size)
        except Exception as e:
            logger.debug("Chart intel futures vol inject %s failed: %s", symbol, e)

        return candles

    def _fetch_daily_sync(self, symbol: str) -> List[Dict]:
        """Fetch last 2 daily candles for PDH/PDL."""
        if not self._kite:
            return []

        token = INDEX_TOKENS.get(symbol)
        if not token:
            return []

        today = datetime.now(IST).date()
        # Check cache
        cached = self._daily_cache.get(symbol)
        if cached and cached.get("date") == today:
            return cached["candles"]

        from_dt = today - timedelta(days=5)
        try:
            raw = self._kite.historical_data(token, from_dt, today, "day")
            candles = []
            for r in raw:
                candles.append({
                    "t": str(r["date"]),
                    "o": round(float(r["open"]), 2),
                    "h": round(float(r["high"]), 2),
                    "l": round(float(r["low"]), 2),
                    "c": round(float(r["close"]), 2),
                    "v": int(r.get("volume", 0)),
                })
            self._daily_cache[symbol] = {"date": today, "candles": candles}
            return candles
        except Exception as e:
            logger.debug("Chart intel daily fetch %s failed: %s", symbol, e)
            return []

    # ── Build symbol payload ─────────────────────────────────────────────

    def _build_symbol_data(self, symbol: str, c3: List, c5: List, daily: List, spot: float, phase: str) -> Dict:
        fvg3 = _detect_fvg(c3)
        fvg5 = _detect_fvg(c5)
        ob3 = _detect_order_blocks(c3)
        ob5 = _detect_order_blocks(c5)
        liq3 = _detect_liquidity(c3)
        liq5 = _detect_liquidity(c5)
        levels = _compute_levels(c3, daily, spot)

        # Inject participant volume data into all zones
        _inject_participants(c3, fvg3, ob3, liq3)
        _inject_participants(c5, fvg5, ob5, liq5)
        _inject_level_participants(c3, levels)

        # Inject live strike OI (CE/PE at nearest option strike per zone)
        _inject_strike_oi(fvg3, ob3, liq3, levels, symbol)
        _inject_strike_oi(fvg5, ob5, liq5, levels, symbol)

        data_source = "LIVE" if phase == "LIVE" else "MARKET_CLOSED"
        ai_summary = _CHART_AI_ENGINE.infer(
            symbol=symbol,
            spot=round(spot, 2),
            candles3m=c3,
            candles5m=c5,
            fvg3m=fvg3,
            ob3m=ob3,
            liquidity3m=liq3,
            levels=levels,
            data_source=data_source,
        )

        return {
            "symbol": symbol,
            "spot": round(spot, 2),
            "candles3m": c3,
            "candles5m": c5,
            "fvg3m": fvg3,
            "fvg5m": fvg5,
            "ob3m": ob3,
            "ob5m": ob5,
            "liquidity3m": liq3,
            "liquidity5m": liq5,
            "levels": levels,
            "ai": ai_summary,
            "dataSource": data_source,
            "timestamp": datetime.now(IST).isoformat(),
        }

    def _refresh_entry_with_live_spot(self, entry: Dict[str, Any], symbol: str, now_ist: datetime) -> Dict[str, Any]:
        refreshed = dict(entry)
        spot = self._get_spot_price(symbol)
        if spot <= 0:
            refreshed["timestamp"] = now_ist.isoformat()
            return refreshed

        refreshed["spot"] = round(spot, 2)
        refreshed["timestamp"] = now_ist.isoformat()

        last_candles_3m: List[Dict[str, Any]] = refreshed.get("candles3m") or []

        for tf_key, interval_min in (("candles3m", 3), ("candles5m", 5)):
            candles = [dict(c) for c in (refreshed.get(tf_key) or [])]
            if not candles:
                continue

            last = candles[-1]
            try:
                last_t = datetime.fromisoformat(last["t"])
                if last_t.tzinfo is None:
                    last_t = IST.localize(last_t)

                next_bar_open = last_t + timedelta(minutes=interval_min)
                if now_ist >= next_bar_open:
                    session_open = datetime.combine(now_ist.date(), time(9, 15), tzinfo=IST)
                    minutes_since_open = max(0, int((now_ist - session_open).total_seconds() // 60))
                    aligned_min = (minutes_since_open // interval_min) * interval_min
                    new_bar_t = session_open + timedelta(minutes=aligned_min)
                    if new_bar_t <= last_t:
                        new_bar_t = next_bar_open
                    new_bar_t_iso = new_bar_t.isoformat()
                    # New bar: flag immediate fetch so historical vol arrives fast
                    self._need_immediate_fetch = True
                    candles.append({
                        "t": new_bar_t_iso,
                        "o": round(spot, 2),
                        "h": round(spot, 2),
                        "l": round(spot, 2),
                        "c": round(spot, 2),
                        "v": 0,   # Will be filled by tick-delta or next historical fetch
                    })
                else:
                    last["c"] = round(spot, 2)
                    if last.get("o", spot) > 0:
                        drift = abs(spot - last["o"]) / last["o"]
                        if drift < 0.015:
                            last["h"] = round(max(last["h"], spot), 2)
                            last["l"] = round(min(last["l"], spot), 2)
                    # ── Real-time volume injection from tick cache ─────────────
                    # Try tick-delta volume (day_total_now − candle_start_baseline)
                    tick_vol = self._get_live_candle_volume(symbol, last["t"][:16], interval_min)
                    if tick_vol > 0:
                        # Prefer tick-delta if it's meaningful (≥10% of last historical value)
                        hist_vol = last.get("v", 0)
                        if tick_vol >= hist_vol * 0.1 or hist_vol == 0:
                            last["v"] = tick_vol
                    # If tick vol is zero and we have historical vol, keep it
            except Exception:
                last["c"] = round(spot, 2)

            if len(candles) > 200:
                candles = candles[-200:]

            candles.sort(key=lambda c: str(c.get("t", "")))
            refreshed[tf_key] = candles
            if tf_key == "candles3m":
                last_candles_3m = candles

        # Recompute all live overlays from the current in-progress candles so
        # FVG / OB / BSL-SSL / EQH-EQL react immediately to live market structure.
        c3_live = refreshed.get("candles3m") or []
        c5_live = refreshed.get("candles5m") or []
        fvg3_live = _detect_fvg(c3_live)
        fvg5_live = _detect_fvg(c5_live)
        ob3_live = _detect_order_blocks(c3_live)
        ob5_live = _detect_order_blocks(c5_live)
        liq3_live = _detect_liquidity(c3_live)
        liq5_live = _detect_liquidity(c5_live)
        _inject_participants(c3_live, fvg3_live, ob3_live, liq3_live)
        _inject_participants(c5_live, fvg5_live, ob5_live, liq5_live)
        refreshed["fvg3m"] = fvg3_live
        refreshed["fvg5m"] = fvg5_live
        refreshed["ob3m"] = ob3_live
        refreshed["ob5m"] = ob5_live
        refreshed["liquidity3m"] = liq3_live
        refreshed["liquidity5m"] = liq5_live

        if isinstance(refreshed.get("levels"), dict):
            daily = self._fetch_daily_sync(symbol)
            refreshed["levels"] = _compute_levels(last_candles_3m, daily, spot)
            _inject_level_participants(last_candles_3m, refreshed["levels"])

        # Inject live strike OI for all zones (live path)
        _inject_strike_oi(fvg3_live, ob3_live, liq3_live, refreshed.get("levels", {}), symbol)
        _inject_strike_oi(fvg5_live, ob5_live, liq5_live, refreshed.get("levels", {}), symbol)

        refreshed["dataSource"] = "LIVE"
        refreshed["ai"] = _CHART_AI_ENGINE.infer(
            symbol=symbol,
            spot=round(spot, 2),
            candles3m=c3_live,
            candles5m=c5_live,
            fvg3m=fvg3_live,
            ob3m=ob3_live,
            liquidity3m=liq3_live,
            levels=refreshed.get("levels", {}) if isinstance(refreshed.get("levels"), dict) else {},
            data_source="LIVE",
        )
        return refreshed

    async def _bg_fetch_live(self, phase: str) -> None:
        async def _fetch_one(sym: str):
            spot = self._get_spot_price(sym)
            if spot <= 0:
                if sym in self._last_snapshot:
                    return (sym, {**self._last_snapshot[sym], "dataSource": "CACHED"})
                return (sym, None)

            c3 = await asyncio.to_thread(self._fetch_candles_sync, sym, "3minute")
            c5 = await asyncio.to_thread(self._fetch_candles_sync, sym, "5minute")
            daily = await asyncio.to_thread(self._fetch_daily_sync, sym)

            # If 5m fetch returned empty (API hiccup), fall back to cached candles5m
            # so the frontend never receives candles5m:[] and flashes the loading state.
            if not c5 and sym in self._last_snapshot:
                c5 = self._last_snapshot[sym].get("candles5m") or []

            if c3:
                return (sym, self._build_symbol_data(sym, c3, c5 or [], daily, spot, phase))
            if sym in self._last_snapshot:
                return (sym, {**self._last_snapshot[sym], "dataSource": "CACHED"})
            logger.warning("Chart Intelligence: no candle data for %s and no cached state", sym)
            return (sym, None)

        results = await asyncio.gather(*[_fetch_one(s) for s in SYMBOLS], return_exceptions=True)

        snapshot: Dict[str, Any] = {}
        for result in results:
            if isinstance(result, Exception):
                continue
            sym, entry = result
            if entry is not None:
                snapshot[sym] = entry

        if snapshot:
            self._last_snapshot = snapshot
            self._last_full_fetch = time_mod.time()

    # ── Lifecycle ────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        persisted = _load_persistent()
        if persisted:
            # Only use persisted data if it includes the new ob3m/liquidity3m fields
            first_sym = next(iter(persisted.values()), None)
            if isinstance(first_sym, dict) and "ob3m" in first_sym:
                self._last_snapshot = persisted
            else:
                logger.info("Chart Intelligence: Stale cache (missing ob3m), forcing fresh generation")
        self._task = asyncio.create_task(self._run_loop())
        logger.info("ChartIntelligenceService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        if self._last_snapshot:
            await asyncio.to_thread(_save_persistent, self._last_snapshot)
        logger.info("ChartIntelligenceService stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        if not self._last_snapshot:
            persisted = _load_persistent()
            if persisted:
                for sym in persisted:
                    if isinstance(persisted[sym], dict):
                        persisted[sym]["dataSource"] = "MARKET_CLOSED"
                self._last_snapshot = persisted
        return self._last_snapshot

    # ── Main loop ────────────────────────────────────────────────────────

    async def _run_loop(self):
        last_heartbeat = 0.0
        _closed_fetch_done = False

        while self._running:
            try:
                phase = self._get_market_phase()
                now_ts = time_mod.time()

                if phase == "LIVE":
                    _closed_fetch_done = False

                need_fetch = (
                    phase in ("LIVE", "PRE_OPEN")
                    or (phase == "CLOSED" and not self._last_snapshot and not _closed_fetch_done)
                )

                if need_fetch:
                    # Force immediate fetch when a new candle bar just opened
                    do_full = (
                        (now_ts - self._last_full_fetch >= self._cadence_fetch)
                        or self._need_immediate_fetch
                    )
                    if self._need_immediate_fetch:
                        self._need_immediate_fetch = False  # consume the flag

                    if do_full:
                        self._init_kite()
                        fetch_idle = self._fetch_task is None or self._fetch_task.done()
                        if fetch_idle:
                            self._fetch_task = asyncio.create_task(self._bg_fetch_live(phase))
                            if phase == "CLOSED":
                                _closed_fetch_done = True
                    else:
                        # Between full fetches: keep all live overlays synced with the
                        # current in-progress candles every broadcast tick.
                        if self._last_snapshot:
                            now_ist = datetime.now(IST)
                            refreshed_snapshot: Dict[str, Any] = {}
                            results = await asyncio.gather(
                                *[
                                    asyncio.to_thread(
                                        self._refresh_entry_with_live_spot,
                                        self._last_snapshot[sym],
                                        sym,
                                        now_ist,
                                    )
                                    for sym in SYMBOLS
                                    if sym in self._last_snapshot
                                ],
                                return_exceptions=True,
                            )
                            for sym, result in zip([s for s in SYMBOLS if s in self._last_snapshot], results):
                                if isinstance(result, Exception):
                                    logger.debug("Chart intel live refresh failed for %s: %s", sym, result)
                                    refreshed_snapshot[sym] = self._last_snapshot[sym]
                                else:
                                    refreshed_snapshot[sym] = result
                            if refreshed_snapshot:
                                self._last_snapshot = refreshed_snapshot

                    # Broadcast current data
                    if self._last_snapshot:
                        await chart_intel_manager.broadcast({
                            "type": "chart_intel_update",
                            "data": self._last_snapshot,
                        })

                        if now_ts - self._last_save_time > 30:
                            self._last_save_time = now_ts
                            await asyncio.to_thread(_save_persistent, self._last_snapshot)

                    await asyncio.sleep(self._cadence_broadcast)

                else:
                    # CLOSED with data
                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()
                        for sym in self._last_snapshot:
                            if isinstance(self._last_snapshot[sym], dict):
                                self._last_snapshot[sym]["dataSource"] = "MARKET_CLOSED"
                                self._last_snapshot[sym]["timestamp"] = ts_now
                        await chart_intel_manager.broadcast({
                            "type": "chart_intel_update",
                            "data": self._last_snapshot,
                        })

                    if now_ts - last_heartbeat > self._heartbeat_interval:
                        last_heartbeat = now_ts
                        await chart_intel_manager.broadcast({
                            "type": "chart_intel_heartbeat",
                            "timestamp": datetime.now(IST).isoformat(),
                        })

                    await asyncio.sleep(self._cadence_closed)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Chart Intelligence loop error: %s", e, exc_info=True)
                await asyncio.sleep(10)


# ── Singleton ────────────────────────────────────────────────────────────────

_service: Optional[ChartIntelligenceService] = None


def get_chart_intelligence_service() -> ChartIntelligenceService:
    global _service
    if _service is None:
        _service = ChartIntelligenceService()
    return _service

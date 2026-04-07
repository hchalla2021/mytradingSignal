"""
⚡ Pure Liquidity Intelligence Service
=======================================
Think as a 25-year-old institutional trader watching MONEY FLOW, not price.

Philosophy:
  Price is a lagging indicator. LIQUIDITY tells you WHERE institutions
  are building positions BEFORE price moves confirm it.

4 Pure Liquidity Signals (all from live cache — zero external API calls):

  Signal                  Weight   Source
  ──────────────────────  ──────   ──────────────────────────────────────
  1. PCR Sentiment         35 %    putOI / callOI from options market
  2. OI Buildup Pattern    30 %    5-min candle OI delta × price direction
  3. Price Momentum        25 %    EMA9/20 alignment + VWAP deviation
  4. Candle Conviction     10 %    Candle body consistency (last 3 bars)

PCR (Put-Call Ratio) in India:
  PCR > 1.2 → Put writers dominating → BULLISH (institutions selling puts = floor)
  PCR < 0.8 → Call writers dominating → BEARISH (institutions selling calls = ceiling)
  Rate of change matters more than level alone.

OI Profile Matrix:
  Price ↑ + OI ↑  →  LONG BUILDUP    (institutional longs entering)
  Price ↑ + OI ↓  →  SHORT COVERING  (shorts exiting, weaker bullish)
  Price ↓ + OI ↑  →  SHORT BUILDUP   (institutional shorts entering)
  Price ↓ + OI ↓  →  LONG UNWINDING  (longs exiting, weaker bearish)

Isolation: own ConnectionManager, own asyncio task, own CacheService instance.
           Zero shared state. Zero impact on ALL other services.
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
from services.advanced_5m_predictor import (
    MicroTrendBuffer,
    calculate_advanced_5m_prediction,
)

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Factor weights (must sum to 1.0) ─────────────────────────────────────────

WEIGHTS: Dict[str, float] = {
    "pcr_sentiment":   0.35,
    "oi_buildup":      0.30,
    "price_momentum":  0.25,
    "candle_conviction": 0.10,
}

# 5-minute prediction re-weights (bias toward momentum)
W5M: Dict[str, float] = {
    "oi_buildup":        0.40,
    "price_momentum":    0.35,
    "pcr_sentiment":     0.20,
    "candle_conviction": 0.05,
}

BULL_T =  0.12
BEAR_T = -0.12


# ── Isolated WebSocket manager ────────────────────────────────────────────────

class LiquidityConnectionManager:
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


liquidity_manager = LiquidityConnectionManager()


# ── Pure utility functions ────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _linear_slope(values: List[float]) -> float:
    n = len(values)
    if n < 3:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def _sig(score: float) -> str:
    if score >=  0.15: return "BULL"
    if score <= -0.15: return "BEAR"
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


def _ema(series: List[float], period: int) -> Optional[float]:
    """EMA with graceful degradation: seeds from first value when fewer candles than period.
    Requires at least 3 data points; returns None only when data is truly insufficient.
    """
    if len(series) < 3:
        return None
    k = 2.0 / (period + 1)
    if len(series) >= period:
        # Standard SMA seed over first `period` bars
        val = sum(series[:period]) / period
        for price in series[period:]:
            val = price * k + val * (1.0 - k)
    else:
        # Fewer bars than period — seed from first close, apply multiplier over all
        # Result is an approximation that converges as more bars arrive
        val = series[0]
        for price in series[1:]:
            val = price * k + val * (1.0 - k)
    return val


def _vwap(candles: List[Dict]) -> Optional[float]:
    total_pv = total_vol = 0.0
    for c in candles:
        vol = float(c.get("volume") or 0)
        if vol <= 0:
            continue
        tp = (float(c.get("high") or 0) + float(c.get("low") or 0) + float(c.get("close") or 0)) / 3.0
        total_pv += tp * vol
        total_vol += vol
    if total_vol > 0:
        return round(total_pv / total_vol, 2)

    # Fallback for index instruments with zero volume:
    # use equal-weighted typical price across candles
    if len(candles) >= 3:
        tp_sum = 0.0
        count = 0
        for c in candles:
            h = float(c.get("high") or 0)
            lo = float(c.get("low") or 0)
            cl = float(c.get("close") or 0)
            if cl > 0:
                tp_sum += (h + lo + cl) / 3.0
                count += 1
        if count > 0:
            return round(tp_sum / count, 2)

    return None


# ── PCR ring buffer ───────────────────────────────────────────────────────────

class PCRHistory:
    """Tracks PCR values over time to detect momentum shifts."""
    MAXLEN = 30  # 30 readings × ~2s = ~1 min of PCR history

    def __init__(self):
        self._buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)

    def push(self, pcr: float):
        if pcr > 0:
            self._buf.append(pcr)

    def slope(self) -> float:
        """Rate of change of PCR. Positive = PCR rising = bullish momentum."""
        if len(self._buf) < 5:
            return 0.0
        return _linear_slope(list(self._buf)[-15:])

    def current(self) -> Optional[float]:
        return self._buf[-1] if self._buf else None

    def average(self) -> Optional[float]:
        if not self._buf:
            return None
        return sum(self._buf) / len(self._buf)


# ── Signal computation functions ──────────────────────────────────────────────

def _pcr_sentiment_signal(
    pcr: float,
    call_oi: int,
    put_oi: int,
    pcr_history: PCRHistory,
) -> Dict:
    """
    Put-Call Ratio analysis — the purest options liquidity signal.

    In Indian index options:
    - High PCR OI (>1.2) = More put writers = Floor support = BULLISH
    - Low PCR OI (<0.8)  = More call writers = Ceiling resistance = BEARISH
    - PCR rising fast    = Increasing put protection = Bearish sentiment building
    - PCR falling fast   = Put protection unwinding = Bullish confidence building
    """
    if pcr <= 0 or (call_oi == 0 and put_oi == 0):
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "PCR data loading — awaiting NSE options feed",
            "weight": WEIGHTS["pcr_sentiment"], "value": None,
            "extra": {"pcr": None, "callOI": 0, "putOI": 0, "pcrSlope": 0.0, "interpretation": "NO_DATA"},
        }

    # Recompute PCR from raw if passed separately
    if call_oi > 0 and put_oi > 0:
        pcr = put_oi / call_oi

    pcr_history.push(pcr)
    slope = pcr_history.slope()

    # ── Level score ────────────────────────────────────────────────────────
    if pcr >= 1.6:
        level_score = 0.70    # Extreme put hedging — strong floor support
        interp = "EXTREME_PUT_WALL"
        label_core = f"PCR {pcr:.2f} — Extreme put wall; strong institutional floor"
    elif pcr >= 1.3:
        level_score = 0.55
        interp = "PUT_DOMINANT_BULL"
        label_core = f"PCR {pcr:.2f} — Heavy put writing; institutions building support"
    elif pcr >= 1.1:
        level_score = 0.25
        interp = "MILD_PUT_BULLISH"
        label_core = f"PCR {pcr:.2f} — Mild bullish: put protection in place"
    elif pcr >= 0.9:
        level_score = 0.00
        interp = "BALANCED"
        label_core = f"PCR {pcr:.2f} — Balanced OI; no directional edge"
    elif pcr >= 0.7:
        level_score = -0.30
        interp = "CALL_DOMINANT_BEAR"
        label_core = f"PCR {pcr:.2f} — Call dominant; resistance ceiling building"
    elif pcr >= 0.5:
        level_score = -0.60
        interp = "HEAVY_CALL_BEAR"
        label_core = f"PCR {pcr:.2f} — Heavy call writing; market capped"
    else:
        level_score = -0.40   # Extreme = contrarian (too many calls = reversal risk)
        interp = "EXTREME_CALL_WALL"
        label_core = f"PCR {pcr:.2f} — Extreme call wall; potential short squeeze"

    # ── Momentum nudge from PCR slope (±15 %) ──────────────────────────────
    # PCR rising = bearish (more puts being bought)
    # PCR falling = bullish (put protection unwinding / call buying)
    slope_nudge = _clamp(-slope / 0.008, -0.15, 0.15)  # rising PCR = -ve score nudge

    score = _clamp(level_score + slope_nudge, -1.0, 1.0)
    slope_desc = "rising" if slope > 0.001 else ("falling" if slope < -0.001 else "stable")

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": f"{label_core} (PCR {slope_desc})",
        "weight": WEIGHTS["pcr_sentiment"],
        "value": round(pcr, 3),
        "extra": {
            "pcr":           round(pcr, 3),
            "callOI":        call_oi,
            "putOI":         put_oi,
            "pcrSlope":      round(slope, 6),
            "slopeTrend":    slope_desc,
            "interpretation": interp,
        },
    }


def _oi_buildup_signal(candles: List[Dict], spot_change_pct: float, live_oi: float = 0.0, spot_price: float = 0.0, prev_oi: float = 0.0, vol_up_override: Optional[bool] = None) -> Dict:
    """
    OI × Price × Volume direction matrix — detects WHERE institutions are positioning.

    3-factor classification (Price × Volume × OI) with 8 cases:
      STRONG: Long Buildup, Short Covering, Short Buildup, Long Unwinding
      MIXED:  Unconfirmed Rally, Bear Exhaustion
      WEAK:   Quiet Accumulation, Weak Short Buildup
    """
    neutral = {
        "score": 0.0, "signal": "NEUTRAL",
        "label": "OI change unavailable — price proxy only",
        "weight": WEIGHTS["oi_buildup"], "value": None,
        "extra": {"profile": "NEUTRAL", "oiDeltaPct": 0.0, "lastOI": 0,
                  "clarity": "NONE", "volConfirmed": False},
    }

    if not candles:
        return neutral

    # Recent 3 candles, weighted: last = 85%, prev = 10%, before = 5%
    recent   = candles[-3:] if len(candles) >= 3 else candles
    w_map    = [0.05, 0.10, 0.85][-len(recent):]

    oi_deltas   : List[float] = []
    price_moves : List[float] = []
    volumes     : List[float] = []
    last_oi     = 0.0

    for c in recent:
        oi_end   = float(c.get("oi") or 0)
        oi_start_raw = c.get("oi_prev")
        # Fix: oi_prev=0 means "not captured" (spot indices before PCR loads).
        # Use None sentinel to distinguish "no data" from "genuinely zero".
        if oi_start_raw is not None and float(oi_start_raw) > 0:
            oi_start = float(oi_start_raw)
        else:
            oi_start = oi_end  # no valid prev → assume no change for this candle
        vol      = float(c.get("volume") or 0)
        if oi_end > 0:
            oi_deltas.append(oi_end - oi_start)
            price_moves.append(float(c.get("close") or 0) - float(c.get("open") or 0))
            volumes.append(vol)
            last_oi = oi_end

    if not oi_deltas or last_oi <= 0:
        # Fallback: use live OI vs previous tracked OI (from PCR service)
        # This fires when candle OI is 0 (spot indices) or before first candle closes
        if live_oi > 0 and prev_oi > 0:
            oi_delta_live = live_oi - prev_oi
            oi_pct_live = (oi_delta_live / prev_oi) * 100
            magnitude_live = _clamp(abs(oi_pct_live) / 0.5, 0.25, 1.0)

            price_up_fb = spot_change_pct > 0.02
            price_dn_fb = spot_change_pct < -0.02
            oi_up_fb = oi_delta_live > 0
            vol_up_fb = vol_up_override is True

            _STRONG_OI_FB   = 0.30
            _STRONG_PRICE_FB = 0.50
            is_strong = abs(oi_pct_live) >= _STRONG_OI_FB and abs(spot_change_pct) >= _STRONG_PRICE_FB

            if price_up_fb and oi_up_fb:
                if is_strong and vol_up_fb:
                    profile = "STRONG_LONG_BUILDUP"
                    score = magnitude_live * 1.0
                    label = f"🚀 Strong Long Buildup — OI ↑{abs(oi_pct_live):.3f}% + price surging {spot_change_pct:+.2f}% (live OI)"
                else:
                    profile = "LONG_BUILDUP"
                    score = magnitude_live * 0.70
                    label = f"Long Buildup — OI ↑{abs(oi_pct_live):.3f}% + price rising (live OI)"
            elif price_up_fb and not oi_up_fb:
                profile = "SHORT_COVERING"
                score = magnitude_live * 0.35
                label = f"Short Covering — OI ↓{abs(oi_pct_live):.3f}%, shorts exiting (live OI)"
            elif price_dn_fb and oi_up_fb:
                if is_strong and vol_up_fb:
                    profile = "STRONG_SHORT_BUILDUP"
                    score = -magnitude_live * 1.0
                    label = f"💥 Strong Short Buildup — OI ↑{abs(oi_pct_live):.3f}% + price plunging {spot_change_pct:+.2f}% (live OI)"
                else:
                    profile = "SHORT_BUILDUP"
                    score = -magnitude_live * 0.70
                    label = f"Short Buildup — OI ↑{abs(oi_pct_live):.3f}% + price falling (live OI)"
            elif price_dn_fb and not oi_up_fb:
                profile = "LONG_UNWINDING"
                score = -magnitude_live * 0.35
                label = f"Long Unwinding — OI ↓{abs(oi_pct_live):.3f}%, longs exiting (live OI)"
            else:
                profile = "NEUTRAL"
                score = _clamp(oi_pct_live / 0.2, -0.15, 0.15)
                label = f"OI neutral — {oi_pct_live:+.3f}% change (live OI)"

            score = _clamp(score, -1.0, 1.0)
            return {
                "score": round(score, 4), "signal": _sig(score),
                "label": label,
                "weight": WEIGHTS["oi_buildup"], "value": round(oi_pct_live, 4),
                "extra": {"profile": profile, "oiDeltaPct": round(oi_pct_live, 4),
                          "lastOI": round(live_oi, 0), "magnitude": round(magnitude_live, 3),
                          "clarity": "LIVE", "volConfirmed": False},
            }

        # Last resort: derive weak signal from price momentum alone
        score = _clamp(spot_change_pct / 3.0, -0.20, 0.20)
        return {
            "score": round(score, 4), "signal": _sig(score),
            "label": "No OI in candles — price-direction proxy",
            "weight": WEIGHTS["oi_buildup"], "value": None,
            "extra": {"profile": "NEUTRAL", "oiDeltaPct": 0.0, "lastOI": 0,
                      "clarity": "NONE", "volConfirmed": False},
        }

    weights_used = w_map[-len(oi_deltas):]
    tw = sum(weights_used)
    wt_oi    = sum(d * w for d, w in zip(oi_deltas, weights_used)) / tw
    wt_price = sum(p * w for p, w in zip(price_moves, weights_used)) / tw

    # Leading-edge: blend live OI delta for faster detection (70% live, 30% candle)
    if live_oi > 0 and last_oi > 0:
        live_delta = live_oi - last_oi
        wt_oi = wt_oi * 0.30 + live_delta * 0.70

    oi_base = live_oi if live_oi > 0 else last_oi
    oi_pct = (wt_oi / oi_base) * 100  # OI change as % of current OI

    # ── Intraday-responsive price direction ────────────────────────────────
    # Blend live spot price action (vs last candle close) with candle momentum
    # so the signal transitions immediately when price reverses intraday,
    # instead of staying stuck on the day-level spot_change_pct.
    live_price_move = 0.0
    if spot_price > 0 and candles:
        last_candle_close = float(candles[-1].get("close") or 0)
        if last_candle_close > 0:
            live_price_move = spot_price - last_candle_close

    # 70% live spot action + 30% candle momentum — faster reaction to reversals
    blended_price = wt_price * 0.30 + live_price_move * 0.70

    price_up = blended_price > 0
    price_dn = blended_price < 0
    # Fallback: day-level change only when blended signal is exactly flat
    if not price_up and not price_dn:
        price_up = spot_change_pct > 0.03
        price_dn = spot_change_pct < -0.03

    oi_up    = wt_oi > 0
    oi_dn    = wt_oi < 0

    # Volume direction: use caller-supplied vol_up (from tick-level rolling history)
    # which is accurate for index instruments. Only fall back to candle-based
    # comparison when the caller doesn't provide it.
    if vol_up_override is not None:
        vol_up = vol_up_override
    else:
        vol_up = False
        if len(volumes) >= 2:
            vol_avg = sum(volumes[:-1]) / len(volumes[:-1])
            vol_up = vol_avg > 0 and volumes[-1] > vol_avg * 1.005
        elif candles and len(candles) >= 5:
            all_vols = [float(c.get("volume") or 0) for c in candles[-5:-1]]
            valid = [v for v in all_vols if v > 0]
            if valid:
                vol_avg = sum(valid) / len(valid)
                vol_up = float(candles[-1].get("volume") or 0) > vol_avg * 1.005

    # Magnitude: cap at 0.5% OI change = full signal
    magnitude = _clamp(abs(oi_pct) / 0.5, 0.25, 1.0)

    # Strong thresholds: heavy OI buildup + decisive price move = RALLY / CRASH
    _STRONG_OI_PCT   = 0.30   # OI must change ≥0.30% for strong classification
    _STRONG_PRICE_PCT = 0.50  # price must move ≥0.50% for strong classification

    # Use intraday price change (blended) for Strong classification instead of
    # day-level spot_change_pct. This allows Strong detection during a big intraday
    # rally even if the day started flat (small gap-up/down from yesterday's close).
    intraday_pct = 0.0
    if spot_price > 0 and candles:
        first_open = float(candles[0].get("open") or 0)
        if first_open > 0:
            intraday_pct = ((spot_price - first_open) / first_open) * 100.0
    # Use whichever shows larger move — day-level or intraday
    effective_price_pct = max(abs(spot_change_pct), abs(intraday_pct))

    # 3-factor P × V × OI classification (8 cases)
    if price_up and oi_up:
        if vol_up:
            # P↑ V↑ OI↑ — volume-confirmed Long Buildup
            clarity = "STRONG"
            if abs(oi_pct) >= _STRONG_OI_PCT and effective_price_pct >= _STRONG_PRICE_PCT:
                profile = "STRONG_LONG_BUILDUP"
                score   = magnitude * 1.0
                label   = f"🚀 Strong Long Buildup (Rally) — OI ↑{abs(oi_pct):.3f}% + price surging {spot_change_pct:+.2f}%"
            else:
                profile = "LONG_BUILDUP"
                score   = magnitude * 0.90
                label   = f"Long Buildup — OI ↑{abs(oi_pct):.3f}% + price rising, volume confirming"
        else:
            # P↑ V↓ OI↑ — OI building but low volume: stealthy accumulation
            clarity = "WEAK"
            profile = "QUIET_ACCUMULATION"
            score   = magnitude * 0.55
            label   = f"Quiet Accumulation — OI ↑{abs(oi_pct):.3f}% + price rising, low volume"
    elif price_up and oi_dn:
        if not vol_up:
            # P↑ V↓ OI↓ — classic Short Covering
            clarity = "STRONG"
            profile = "SHORT_COVERING"
            score   = magnitude * 0.40
            label   = f"Short Covering — OI ↓{abs(oi_pct):.3f}%, shorts exiting"
        else:
            # P↑ V↑ OI↓ — volume rising into OI drop: unconfirmed rally
            clarity = "MIXED"
            profile = "UNCONFIRMED_RALLY"
            score   = magnitude * 0.25
            label   = f"Unconfirmed Rally — price ↑ + volume ↑ but OI ↓{abs(oi_pct):.3f}%, caution"
    elif price_dn and oi_up:
        if vol_up:
            # P↓ V↑ OI↑ — volume-confirmed Short Buildup
            clarity = "STRONG"
            if abs(oi_pct) >= _STRONG_OI_PCT and effective_price_pct >= _STRONG_PRICE_PCT:
                profile = "STRONG_SHORT_BUILDUP"
                score   = -magnitude * 1.0
                label   = f"💥 Strong Short Buildup (Crash) — OI ↑{abs(oi_pct):.3f}% + price plunging {spot_change_pct:+.2f}%"
            else:
                profile = "SHORT_BUILDUP"
                score   = -magnitude * 0.90
                label   = f"Short Buildup — OI ↑{abs(oi_pct):.3f}% + price falling, volume confirming"
        else:
            # P↓ V↓ OI↑ — OI building but no volume: unconvincing
            clarity = "WEAK"
            profile = "WEAK_SHORT_BUILDUP"
            score   = -magnitude * 0.55
            label   = f"Weak Short Buildup — OI ↑{abs(oi_pct):.3f}% + price falling, low volume"
    elif price_dn and oi_dn:
        if not vol_up:
            # P↓ V↓ OI↓ — classic Long Unwinding
            clarity = "STRONG"
            profile = "LONG_UNWINDING"
            score   = -magnitude * 0.40
            label   = f"Long Unwinding — OI ↓{abs(oi_pct):.3f}%, longs exiting"
        else:
            # P↓ V↑ OI↓ — heavy selling into OI drop: exhaustion
            clarity = "MIXED"
            profile = "BEAR_EXHAUSTION"
            score   = -magnitude * 0.25
            label   = f"Bear Exhaustion — price ↓ + volume ↑ but OI ↓{abs(oi_pct):.3f}%, sellers tiring"
    else:
        clarity = "NONE"
        profile = "NEUTRAL"
        score   = _clamp(oi_pct / 0.2, -0.15, 0.15)
        label   = f"OI neutral — {oi_pct:+.3f}% change, no clear direction"

    score = _clamp(score, -1.0, 1.0)
    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["oi_buildup"],
        "value": round(oi_pct, 4),
        "extra": {
            "profile":      profile,
            "oiDeltaPct":   round(oi_pct, 4),
            "lastOI":       round(last_oi, 0),
            "magnitude":    round(magnitude, 3),
            "clarity":      clarity,
            "volConfirmed": vol_up,
        },
    }


def _price_momentum_signal(candles: List[Dict], spot_price: float) -> Dict:
    """
    Smart-money price positioning: EMA 9/20 alignment + VWAP deviation.

    When price is above both EMA9 and EMA20 (9>20) + above VWAP,
    institutions are sitting on paper profits and adding. This is a
    liquidity signal: money is flowing into the security.
    """
    neutral = {
        "score": 0.0, "signal": "NEUTRAL",
        "label": "Insufficient candles for momentum",
        "weight": WEIGHTS["price_momentum"], "value": None,
        "extra": {"ema9": None, "ema20": None, "vwap": None, "vwapDev": None},
    }

    if len(candles) < 3 or spot_price <= 0:
        return neutral

    closes = [float(c.get("close") or 0) for c in candles if c.get("close")]
    if len(closes) < 3:
        return neutral

    ema9  = _ema(closes, 9)
    ema20 = _ema(closes, 20)
    vwap  = _vwap(candles)

    parts: List[Tuple[float, float]] = []  # (score, weight)

    # ── EMA alignment score (70 % of this signal) ─────────────────────────
    if ema9 and ema20:
        if ema9 > ema20 and spot_price > ema9:
            ema_score = 0.85
            ema_label = f"EMA9>{ema9:.0f}>EMA20{ema20:.0f}, price above"
        elif ema9 > ema20:
            ema_score = 0.40
            ema_label = f"EMA9>{ema9:.0f}>EMA20{ema20:.0f}"
        elif ema9 < ema20 and spot_price < ema9:
            ema_score = -0.85
            ema_label = f"EMA9<{ema9:.0f}<EMA20{ema20:.0f}, price below"
        elif ema9 < ema20:
            ema_score = -0.40
            ema_label = f"EMA9<{ema9:.0f}<EMA20{ema20:.0f}"
        else:
            ema_score = 0.0
            ema_label = "EMA mixed / flat"
        parts.append((ema_score, 0.70))
    else:
        ema_label = "EMA N/A"

    # ── VWAP deviation score (30 % of this signal) ────────────────────────
    vwap_dev = None
    if vwap and vwap > 0:
        vwap_dev = (spot_price - vwap) / vwap * 100
        vwap_score = _clamp(vwap_dev / 0.40, -1.0, 1.0)
        parts.append((vwap_score, 0.30))

    if not parts:
        return neutral

    total_w = sum(w for _, w in parts)
    score   = _clamp(sum(s * w for s, w in parts) / total_w, -1.0, 1.0)

    label = ema_label
    if vwap_dev is not None:
        label += f" · VWAP{vwap_dev:+.2f}%"

    # EMA slope: rate of change between current and one-candle-ago EMA9
    ema_slope_val = 0.0
    if ema9 is not None and len(closes) >= 5:
        prev_ema9 = _ema(closes[:-1], 9)
        if prev_ema9 is not None and prev_ema9 > 0:
            ema_slope_val = (ema9 - prev_ema9) / prev_ema9 * 100

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["price_momentum"],
        "value": round(spot_price - (ema9 or spot_price), 2),
        "extra": {
            "ema9":     round(ema9, 2)  if ema9  else None,
            "ema20":    round(ema20, 2) if ema20 else None,
            "emaSlope": round(ema_slope_val, 6),
            "vwap":     round(vwap, 2)  if vwap  else None,
            "vwapDev":  round(vwap_dev, 4) if vwap_dev is not None else None,
        },
    }


def _candle_conviction_signal(candles: List[Dict]) -> Dict:
    """
    Candle body consistency — are institutions consistently buying or selling?

    We analyze the last 4 candles:
    - All green = conviction buy
    - All red = conviction sell
    - Mixed = no institutional consensus
    - Large bodies = money is moving decisively
    """
    neutral = {
        "score": 0.0, "signal": "NEUTRAL",
        "label": "Insufficient candle data",
        "weight": WEIGHTS["candle_conviction"], "value": None,
        "extra": {"bullCount": 0, "bearCount": 0, "avgBodyPct": 0.0},
    }

    if len(candles) < 3:
        return neutral

    recent   = candles[-4:] if len(candles) >= 4 else candles
    bull_cnt = 0
    bear_cnt = 0
    body_pcts: List[float] = []

    for c in recent:
        o = float(c.get("open")  or 0)
        cl = float(c.get("close") or 0)
        h = float(c.get("high")  or 0)
        lo = float(c.get("low")  or 0)
        if o <= 0 or cl <= 0:
            continue
        rng  = h - lo
        body = abs(cl - o)
        body_pct = (body / rng * 100) if rng > 0 else 50.0
        body_pcts.append(body_pct)
        if cl >= o:
            bull_cnt += 1
        else:
            bear_cnt += 1

    total = bull_cnt + bear_cnt
    if total == 0:
        return neutral

    avg_body_pct = sum(body_pcts) / len(body_pcts) if body_pcts else 50.0

    # Conviction: % of candles in one direction × body strength multiplier
    bull_ratio = bull_cnt / total
    body_mult  = _clamp(avg_body_pct / 60.0, 0.5, 1.5)   # 60% body = full strength

    if bull_cnt > bear_cnt:
        net = (bull_ratio - 0.5) * 2.0   # 0 at 50/50, 1.0 at 100%
        score = _clamp(net * body_mult, -1.0, 1.0)
        label = f"{bull_cnt}/{total} bullish candles · avg body {avg_body_pct:.0f}%"
    elif bear_cnt > bull_cnt:
        bear_ratio = bear_cnt / total
        net = (bear_ratio - 0.5) * 2.0
        score = _clamp(-net * body_mult, -1.0, 1.0)
        label = f"{bear_cnt}/{total} bearish candles · avg body {avg_body_pct:.0f}%"
    else:
        score = 0.0
        label = f"50/50 split — no institutional consensus"

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["candle_conviction"],
        "value": round(avg_body_pct, 1),
        "extra": {
            "bullCount":  bull_cnt,
            "bearCount":  bear_cnt,
            "avgBodyPct": round(avg_body_pct, 2),
        },
    }


# ── Direction + confidence finalization ──────────────────────────────────────

def _finalize_liquidity(signals: Dict) -> Tuple[str, int, float]:
    raw = sum(s["score"] * s["weight"] for s in signals.values())

    if raw >= BULL_T:
        direction = "BULLISH"
    elif raw <= BEAR_T:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    # ── Confidence: strength × consensus (mirrors compass_service pattern) ──────────
    # NEUTRAL  (25–48 %): peaks at raw=0, falls toward band edges.
    # Directional (35–99 %): normalised strength + contradiction penalty.
    if direction == "NEUTRAL":
        band_centre = 1.0 - (abs(raw) / BULL_T)
        confidence  = int(25 + band_centre * 23)          # 25–48 %
    else:
        sign = 1.0 if direction == "BULLISH" else -1.0
        # pos_contrib / neg_contrib: track both WITH and AGAINST contributions
        pos_contrib = sum(
            max(0.0, s["score"] * sign) * s["weight"] for s in signals.values()
        )
        neg_contrib = sum(
            max(0.0, -s["score"] * sign) * s["weight"] for s in signals.values()
        )
        net      = pos_contrib - neg_contrib
        # strength: 0 at threshold, 1 when all factors max-agree
        strength = (net - BULL_T) / (1.0 - BULL_T)
        # penalty: each opposing weighted unit costs 20 pts
        penalty    = neg_contrib * 20
        confidence = int(round(35 + strength * 64 - penalty))

    return direction, max(1, min(99, confidence)), round(raw, 4)


def _predict_5m_liquidity(signals: Dict) -> Tuple[str, int]:
    """
    5-minute forward prediction — emphasises fastest-moving signals.
    Returns (prediction_label, confidence_pct).
    """
    score = sum(signals[k]["score"] * W5M.get(k, 0) for k in signals)
    score = _clamp(score, -1.0, 1.0)

    # Piecewise confidence: continuous across ALL tier boundaries — no cliffs.
    #   NEUTRAL  (|score| < 0.25):            40–48 %  — await clearer signal
    #   BUY/SELL (0.25 ≤ |score| < 0.55):    50–65 %  — directional momentum
    #   STRONG   (|score| ≥ 0.55):            65–92 %  — multi-factor alignment
    abs_s = abs(score)
    if abs_s < 0.25:
        conf = int(40 + (abs_s / 0.25) * 8)                    # 40–48 %
    elif abs_s < 0.55:
        conf = int(50 + ((abs_s - 0.25) / 0.30) * 15)          # 50–65 %
    else:
        conf = int(65 + ((abs_s - 0.55) / 0.45) * 27)          # 65–92 %
    conf = max(40, min(92, conf))

    if score >=  0.55: pred = "STRONG_BUY"
    elif score >=  0.25: pred = "BUY"
    elif score <= -0.55: pred = "STRONG_SELL"
    elif score <= -0.25: pred = "SELL"
    else:                pred = "NEUTRAL"

    return pred, conf


# ── Main Service ──────────────────────────────────────────────────────────────

class LiquidityService:
    """
    ⚡ Pure Liquidity Intelligence Engine

    Completely isolated — reads only from CacheService.
    start() → background_loop → stop()
    get_snapshot() → latest payload (sync)
    """

    INDICES       = ["NIFTY", "BANKNIFTY", "SENSEX"]
    TICK_INTERVAL = 1.5   # 1.5-second broadcast cadence (faster than compass)

    def __init__(self, cache: CacheService):
        self._cache = cache
        self._pcr_buffers: Dict[str, PCRHistory] = {
            sym: PCRHistory() for sym in self.INDICES
        }
        # Micro-trend buffers for advanced 5-min prediction
        self._micro_trends: Dict[str, MicroTrendBuffer] = {
            sym: MicroTrendBuffer(sym, maxlen=20) for sym in self.INDICES
        }
        # Track last known values for delta calculation
        self._last_values: Dict[str, Dict[str, float]] = {
            sym: {"oi": 0.0, "price": 0.0, "volume": 0.0, "cum_volume": 0.0} for sym in self.INDICES
        }
        # Rolling volume history for accurate vol_up detection (tick-level, not candle)
        self._vol_history: Dict[str, Deque[float]] = {
            sym: collections.deque(maxlen=20) for sym in self.INDICES
        }
        self._last_spot_data: Dict[str, Dict] = {}   # no-TTL fallback
        self._latest: Dict[str, Any] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False

    # ── Kite session helper (same pattern as compass_service) ─────────────────

    def _get_kite(self):
        """Return authenticated KiteConnect instance, or None if unavailable."""
        try:
            from services.auth_state_machine import auth_state_manager
            kite = auth_state_manager.kite
            return kite if kite else None
        except Exception:
            return None

    # ── Startup price fetch (works when market is closed) ────────────────────

    def _fetch_initial_spot_sync(self):
        """
        Blocking kite.quote() call on startup.
        Pre-populates _last_spot_data so the section never shows skeletons
        even if market is closed and live ticks haven't arrived.
        Also tries the file backup as a secondary source.
        """
        # First try: file-based backup (cache.py writes this on every tick)
        try:
            from services.cache import _load_backup_from_file
            backup = _load_backup_from_file()
            for sym in self.INDICES:
                if sym in backup and backup[sym]:
                    d = backup[sym]
                    if float(d.get("price") or 0) > 0 and sym not in self._last_spot_data:
                        self._last_spot_data[sym] = d
                        logger.info(f"⚡ Loaded {sym} from file backup")
        except Exception as e:
            logger.debug(f"⚡ File backup load: {e}")

        # Second try: kite.quote() for truly fresh last-traded price
        kite = self._get_kite()
        if not kite:
            return
        QUOTE_MAP = {
            "NSE:NIFTY 50":   "NIFTY",
            "NSE:NIFTY BANK": "BANKNIFTY",
            "BSE:SENSEX":     "SENSEX",
        }
        try:
            quotes = kite.quote(list(QUOTE_MAP.keys()))
            for q_key, sym in QUOTE_MAP.items():
                q = quotes.get(q_key, {})
                if not q:
                    continue
                ltp        = float(q.get("last_price") or 0)
                prev_close = float((q.get("ohlc") or {}).get("close") or ltp)
                change     = ltp - prev_close
                chg_pct    = (change / prev_close * 100) if prev_close else 0.0
                trend = "bullish" if change > 0 else ("bearish" if change < 0 else "neutral")
                self._last_spot_data[sym] = {
                    "symbol":        sym,
                    "price":         round(ltp, 2),
                    "change":        round(change, 2),
                    "changePercent": round(chg_pct, 2),
                    "high":  float((q.get("ohlc") or {}).get("high") or ltp),
                    "low":   float((q.get("ohlc") or {}).get("low")  or ltp),
                    "open":  float((q.get("ohlc") or {}).get("open") or ltp),
                    "trend": trend,
                    "status": "CLOSED",
                    # PCR/OI will be 0 — that's expected outside market hours
                    "pcr": 0, "callOI": 0, "putOI": 0,
                }
            logger.info(f"⚡ Initial spot data loaded: {list(self._last_spot_data.keys())}")
        except Exception as e:
            logger.debug(f"⚡ Initial spot fetch error: {e}")

    # ── Cache reads ───────────────────────────────────────────────────────────

    async def _read_spot_data(self, symbol: str) -> Tuple[Optional[Dict], bool]:
        # 1. Live cache (5-second TTL)
        data = await self._cache.get_market_data(symbol)
        if data:
            self._last_spot_data[symbol] = data
            return data, True

        # 2. In-service no-TTL fallback (populated by kite.quote on startup)
        stale = self._last_spot_data.get(symbol)
        if stale:
            return stale, False

        # 3. Last-resort: read stale entry directly from _SHARED_CACHE (ignore TTL)
        raw = _SHARED_CACHE.get(f"market:{symbol}")
        if raw:
            try:
                val = json.loads(raw[0])  # (json_str, expire_at) tuple
                if val and float(val.get("price") or 0) > 0:
                    self._last_spot_data[symbol] = val
                    return val, False
            except Exception:
                pass

        return None, False

    async def _read_candles(self, symbol: str) -> List[Dict]:
        raw = await self._cache.lrange(f"analysis_candles:{symbol}", 0, 49)
        result: List[Dict] = []
        for item in reversed(raw):   # lpush prepends → newest first; reverse for TA
            c = _parse_candle(item)
            if c:
                result.append(c)

        # Append the live in-progress candle (updated every tick by market_feed)
        # so that price momentum and OI buildup react within seconds instead of
        # waiting up to 5 minutes for each candle to close.
        live = await self._cache.get(f"analysis_candle_live:{symbol}")
        if live and isinstance(live, dict) and float(live.get("close") or 0) > 0:
            # Avoid duplicate: skip if timestamp matches the last closed candle
            if not result or result[-1].get("timestamp") != live.get("timestamp"):
                result.append(live)

        return result

    # ── Per-symbol computation ────────────────────────────────────────────────

    async def _compute(self, symbol: str) -> Optional[Dict[str, Any]]:
        spot_data, is_live = await self._read_spot_data(symbol)
        if not spot_data:
            return None

        price = float(spot_data.get("price") or 0)
        if price <= 0:
            return None

        change_pct = float(spot_data.get("changePercent") or 0)
        oi_raw     = float(spot_data.get("oi") or 0)
        pcr_val    = float(spot_data.get("pcr") or 0)
        call_oi    = int(spot_data.get("callOI") or 0)
        put_oi     = int(spot_data.get("putOI") or 0)

        # Recompute PCR from raw if pcr field is 0
        if pcr_val == 0 and call_oi > 0 and put_oi > 0:
            pcr_val = put_oi / call_oi

        candles = await self._read_candles(symbol)

        # ── Tick-level volume direction (fixes index instruments where candle volume is 0) ──
        # Index volume from Zerodha is CUMULATIVE session volume, so we track
        # per-tick deltas to get meaningful volume acceleration readings.
        spot_volume = float(spot_data.get("volume") or 0)
        vol_hist = self._vol_history[symbol]
        prev_cum_vol = self._last_values[symbol].get("cum_volume", 0.0)
        vol_delta = max(0, spot_volume - prev_cum_vol) if prev_cum_vol > 0 else 0
        if vol_delta > 0:
            vol_hist.append(vol_delta)
        # vol_up: current volume rate > rolling average (need at least 5 readings)
        vol_up_live: Optional[bool] = None
        if len(vol_hist) >= 5:
            recent = list(vol_hist)
            avg_vol = sum(recent[:-1]) / len(recent[:-1])
            vol_up_live = avg_vol > 0 and recent[-1] > avg_vol * 1.005

        # Previous OI for live-OI fallback (when candle OI is absent)
        tracked_prev_oi = self._last_values[symbol]["oi"]
        # Bootstrap: if prev OI is still 0 (first iteration), seed it from current
        # so that the next iteration gets a valid delta baseline
        if tracked_prev_oi == 0 and oi_raw > 0:
            tracked_prev_oi = oi_raw

        # ── Run 4 signals ──────────────────────────────────────────────────
        sig_pcr  = _pcr_sentiment_signal(pcr_val, call_oi, put_oi, self._pcr_buffers[symbol])
        sig_oi   = _oi_buildup_signal(candles, change_pct, live_oi=oi_raw, spot_price=price,
                                       prev_oi=tracked_prev_oi, vol_up_override=vol_up_live)
        sig_mom  = _price_momentum_signal(candles, price)
        sig_conv = _candle_conviction_signal(candles)

        signals = {
            "pcr_sentiment":    sig_pcr,
            "oi_buildup":       sig_oi,
            "price_momentum":   sig_mom,
            "candle_conviction": sig_conv,
        }

        direction, confidence, raw_score = _finalize_liquidity(signals)
        prediction_5m, pred_conf         = _predict_5m_liquidity(signals)

        # ── OI Profile: use OI signal first, then enhance with PCR + direction ──
        oi_profile = sig_oi["extra"].get("profile", "NEUTRAL")

        # When OI signal alone is NEUTRAL (no OI data or no delta),
        # use PCR + price momentum to provide a meaningful profile
        if oi_profile == "NEUTRAL":
            pcr_interp = sig_pcr["extra"].get("interpretation", "")
            pcr_score = sig_pcr["score"]
            mom_score = sig_mom["score"]

            # PCR extreme overrides
            if pcr_interp == "EXTREME_PUT_WALL":
                oi_profile = "PCR_EXTREME_BULL"
            elif pcr_interp == "EXTREME_CALL_WALL":
                oi_profile = "PCR_EXTREME_BEAR"
            # Strong directional signal from PCR + momentum combined
            elif direction == "BULLISH" and confidence >= 55:
                if pcr_score >= 0.30 and mom_score >= 0.20:
                    oi_profile = "LONG_BUILDUP"
                elif pcr_score >= 0.15 or mom_score >= 0.30:
                    oi_profile = "SHORT_COVERING"
            elif direction == "BEARISH" and confidence >= 55:
                if pcr_score <= -0.30 and mom_score <= -0.20:
                    oi_profile = "SHORT_BUILDUP"
                elif pcr_score <= -0.15 or mom_score <= -0.30:
                    oi_profile = "LONG_UNWINDING"

        data_source = "LIVE" if is_live else "MARKET_CLOSED"

        # ── Calculate micro-trends for advanced 5-min prediction ──────────────
        # Track OI, volume, and price changes for micro-trend detection
        last_vals = self._last_values[symbol]
        
        # OI change percentage
        oi_change_pct = 0.0
        if last_vals["oi"] > 0 and oi_raw > 0:
            oi_change_pct = ((oi_raw - last_vals["oi"]) / last_vals["oi"]) * 100.0
        
        # Price change percentage (from last candle close, not change_pct which is from prev close)
        price_change_pct = 0.0
        if len(candles) >= 2:
            prev_close = float(candles[-2].get("close") or 0)
            if prev_close > 0:
                price_change_pct = ((price - prev_close) / prev_close) * 100.0
        
        # Volume from latest candle
        current_volume = float(candles[-1].get("volume") or 0) if candles else 0.0
        prev_volume = float(candles[-2].get("volume") or 0) if len(candles) >= 2 else current_volume
        
        # Volume ratio (current vs average)
        volume_ratio = 0.0
        if candles and len(candles) >= 5:
            recent_volumes = [float(c.get("volume") or 0) for c in candles[-5:]]
            avg_volume = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 1
            if avg_volume > 0:
                volume_ratio = current_volume / avg_volume
        
        # EMA slope (from price momentum signal)
        ema_slope = sig_mom["extra"].get("emaSlope", 0.0)
        
        # Push to micro-trend buffer
        micro_buffer = self._micro_trends[symbol]
        micro_buffer.push(
            pcr=pcr_val,
            oi_change_pct=oi_change_pct,
            volume_ratio=volume_ratio,
            price_change_pct=price_change_pct,
            ema_slope=ema_slope
        )
        
        # Update last known values for next iteration
        self._last_values[symbol] = {
            "oi": oi_raw,
            "price": price,
            "volume": current_volume,
            "cum_volume": spot_volume,
        }
        
        # ── Advanced 5-min prediction (if we have enough micro-trend data) ────
        advanced_5m = None
        if micro_buffer.is_full():
            try:
                recent_oi_changes = [
                    (d['oi_change'] * last_vals["oi"] / 100.0) if last_vals["oi"] > 0 else 0.0
                    for d in micro_buffer.get_recent(n=10)
                ]
                recent_volumes_list = [
                    current_volume * d['volume_ratio'] if d['volume_ratio'] > 0 else current_volume
                    for d in micro_buffer.get_recent(n=10)
                ]
                recent_prices_list = [price * (1 + d['price_change'] / 100.0) for d in micro_buffer.get_recent(n=10)]
                
                advanced_5m = calculate_advanced_5m_prediction(
                    signals=signals,
                    recent_oi_changes=recent_oi_changes,
                    recent_volumes=recent_volumes_list,
                    recent_prices=recent_prices_list,
                    current_pcr=pcr_val,
                    current_direction=direction
                )
            except Exception as e:
                logger.warning(f"Advanced 5m prediction error for {symbol}: {e}")

        response = {
            "symbol":       symbol,
            "direction":    direction,
            "confidence":   confidence,
            "rawScore":     raw_score,
            "oiProfile":    oi_profile,
            "prediction5m": prediction_5m,
            "pred5mConf":   pred_conf,
            "signals":      signals,
            "metrics": {
                "price":     round(price, 2),
                "changePct": round(change_pct, 2),
                "oi":        round(oi_raw, 0),
                "pcr":       round(pcr_val, 3) if pcr_val > 0 else None,
                "callOI":    call_oi,
                "putOI":     put_oi,
                "vwap":      sig_mom["extra"].get("vwap"),
                "ema9":      sig_mom["extra"].get("ema9"),
                "ema20":     sig_mom["extra"].get("ema20"),
                "vwapDev":   sig_mom["extra"].get("vwapDev"),
            },
            "dataSource": data_source,
            "timestamp":  datetime.now(IST).isoformat(),
        }
        
        # Add advanced 5-min prediction if available
        if advanced_5m:
            response["advanced5mPrediction"] = advanced_5m

        return response

    # ── Background broadcast loop ─────────────────────────────────────────────

    async def _broadcast_loop(self):
        logger.info("⚡ LiquidityService broadcast loop started")
        while self._running:
            try:
                payload: Dict[str, Any] = {}
                for sym in self.INDICES:
                    data = await self._compute(sym)
                    if data:
                        payload[sym] = data
                        self._latest[sym] = data

                if payload:
                    await liquidity_manager.broadcast({
                        "type":      "liquidity_update",
                        "data":      payload,
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"⚡ Liquidity loop error: {e}")

            # Throttle during closed market to free event loop for HTTP requests
            try:
                from services.market_feed import get_market_status
                _status = get_market_status()
            except Exception:
                _status = "CLOSED"
            await asyncio.sleep(self.TICK_INTERVAL if _status == "LIVE" else 30)

        logger.info("⚡ LiquidityService stopped")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        # Pre-populate last-spot fallback (fire-and-forget, non-blocking)
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, self._fetch_initial_spot_sync)
        self._task = asyncio.create_task(self._broadcast_loop())
        logger.info("⚡ LiquidityService started (isolated)")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def get_snapshot(self) -> Dict[str, Any]:
        return dict(self._latest)


# ── Singleton ─────────────────────────────────────────────────────────────────

_instance: Optional[LiquidityService] = None


def get_liquidity_service() -> LiquidityService:
    global _instance
    if _instance is None:
        _instance = LiquidityService(CacheService())
    return _instance

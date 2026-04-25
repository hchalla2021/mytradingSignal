"""
📈 MarketEdge Intelligence Engine
===================================
Think as the #1 derivatives analyst in the world.

PURPOSE: Real-time Futures OI analysis, OI Spurts detection,
IV estimation, IV Rank tracking, and Futures Basis monitoring
for NIFTY, BANKNIFTY, and SENSEX.

SECTIONS:
  1. OI Spurts — Sudden OI bursts that signal institutional entry/exit
  2. IV + IV Rank — Implied volatility estimation & percentile ranking
  3. Futures OI — Open interest trends + buildup classification
  4. Futures Basis — Premium/discount to spot with carry cost

DATA SOURCES: LIVE Zerodha API only.
  - Spot: CacheService ("market:{SYMBOL}")
  - Candles: CacheService ("analysis_candles:{SYMBOL}")
  - Options OI: kite.quote() for nearest-expiry chain (batch)
  - Futures: kite.quote() for near-month futures contracts
  - VIX: CacheService ("market:INDIAVIX")

SIGNAL OUTPUT:
  Each sub-section generates a score [-1, +1] and a label.
  Combined weighted score → STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL.

Isolation: Own ConnectionManager, own asyncio task, own singleton.
           Zero shared state with other services.
"""

import asyncio
import collections
import json
import math
import logging
import time
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List, Tuple, Deque, Set

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Weights for MarketEdge scoring ───────────────────────────────────────────

EDGE_WEIGHTS: Dict[str, float] = {
    "oi_spurts":            0.25,   # Sudden OI bursts — institutional entry
    "futures_oi":           0.25,   # Futures OI buildup classification
    "live_price_momentum":  0.20,   # NEW: live spot vs candle anchors — instant reversal detection
    "iv_estimation":        0.15,   # IV level + direction (slow, reduced weight)
    "iv_rank":              0.10,   # IV percentile rank (slow, reduced weight)
    "futures_basis":        0.05,   # Premium/discount to spot
}

STRONG_BULL_T = 0.35
BULL_T = 0.15
BEAR_T = -0.15
STRONG_BEAR_T = -0.35


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class MarketEdgeConnectionManager:
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


edge_manager = MarketEdgeConnectionManager()


# ── Utility helpers ──────────────────────────────────────────────────────────

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


def _pct_change(old: float, new: float) -> float:
    if old == 0:
        return 0.0
    return (new - old) / old * 100.0


# ── Ring buffers for tracking momentum ───────────────────────────────────────

class EdgeHistory:
    """Ring buffers for per-index tracking across ticks."""
    MAXLEN = 60

    def __init__(self):
        self._spot_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._fut_price_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._fut_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._options_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._iv_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._basis_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._call_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._put_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._volume_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        # IV history for IV Rank (252 data points ≈ 1 year of daily readings)
        self._iv_history: Deque[float] = collections.deque(maxlen=252)

    def push_spot(self, v: float):
        if v > 0:
            self._spot_buf.append(v)

    def push_futures(self, price: float, oi: float):
        if price > 0:
            self._fut_price_buf.append(price)
        if oi >= 0:
            self._fut_oi_buf.append(oi)

    def push_options_oi(self, total_oi: float, call_oi: float, put_oi: float):
        if total_oi > 0:
            self._options_oi_buf.append(total_oi)
        if call_oi > 0:
            self._call_oi_buf.append(call_oi)
        if put_oi > 0:
            self._put_oi_buf.append(put_oi)

    def push_iv(self, iv: float):
        if iv > 0:
            self._iv_buf.append(iv)
            self._iv_history.append(iv)

    def push_basis(self, basis_pct: float):
        self._basis_buf.append(basis_pct)

    def push_volume(self, vol: float):
        if vol >= 0:
            self._volume_buf.append(vol)

    @property
    def data_ready(self) -> bool:
        return len(self._spot_buf) >= 3

    # ── Derived properties ────────────────────────────────────────────

    @property
    def fut_oi_slope(self) -> float:
        return _linear_slope(list(self._fut_oi_buf))

    @property
    def spot_slope(self) -> float:
        return _linear_slope(list(self._spot_buf))

    @property
    def iv_slope(self) -> float:
        return _linear_slope(list(self._iv_buf))

    @property
    def basis_slope(self) -> float:
        return _linear_slope(list(self._basis_buf))

    @property
    def options_oi_spurt(self) -> float:
        """Detect OI spurt: latest reading vs rolling average. >1.5 = spurt."""
        vals = list(self._options_oi_buf)
        if len(vals) < 5:
            return 1.0
        avg = sum(vals[:-1]) / len(vals[:-1])
        return vals[-1] / avg if avg > 0 else 1.0

    @property
    def fut_oi_spurt(self) -> float:
        """Detect futures OI spurt."""
        vals = list(self._fut_oi_buf)
        if len(vals) < 5:
            return 1.0
        avg = sum(vals[:-1]) / len(vals[:-1])
        return vals[-1] / avg if avg > 0 else 1.0

    @property
    def fut_oi_velocity(self) -> float:
        """Rate of futures OI change — recent vs older."""
        vals = list(self._fut_oi_buf)
        if len(vals) < 6:
            return 0.0
        recent = vals[-3:]
        older = vals[-6:-3]
        avg_r = sum(recent) / len(recent)
        avg_o = sum(older) / len(older)
        return _pct_change(avg_o, avg_r)

    @property
    def iv_rank(self) -> float:
        """IV Rank = (current IV - 52w low) / (52w high - 52w low) * 100."""
        vals = list(self._iv_history)
        if len(vals) < 10:
            return 50.0  # Default mid-range
        current = vals[-1]
        iv_low = min(vals)
        iv_high = max(vals)
        if iv_high == iv_low:
            return 50.0
        return _clamp((current - iv_low) / (iv_high - iv_low) * 100.0, 0.0, 100.0)

    @property
    def iv_percentile(self) -> float:
        """IV Percentile = % of days where IV was below current IV."""
        vals = list(self._iv_history)
        if len(vals) < 10:
            return 50.0
        current = vals[-1]
        below = sum(1 for v in vals if v < current)
        return round(below / len(vals) * 100.0, 1)

    @property
    def volume_surge(self) -> float:
        """Volume surge ratio: latest vs rolling avg."""
        vals = list(self._volume_buf)
        if len(vals) < 3:
            return 1.0
        avg = sum(vals[:-1]) / len(vals[:-1])
        return vals[-1] / avg if avg > 0 else 1.0


# ── Signal computation functions ─────────────────────────────────────────────

def _oi_spurts_signal(
    call_oi: float, put_oi: float, total_oi: float,
    fut_oi: float, history: EdgeHistory, candles: List[Dict]
) -> Dict[str, Any]:
    """
    OI Spurts Detection — Sudden bursts in OI = institutional activity.

    OI Spurt = current OI significantly above rolling average.
    Combined with price direction to determine bullish/bearish intent.
    """
    score = 0.0
    label = "Normal OI flow"
    extras: Dict[str, Any] = {}

    opt_spurt = history.options_oi_spurt
    fut_spurt = history.fut_oi_spurt
    extras["optionsOISpurt"] = round(opt_spurt, 2)
    extras["futuresOISpurt"] = round(fut_spurt, 2)

    # Price direction from spot history
    spot_slope = history.spot_slope
    extras["spotSlope"] = round(spot_slope, 4)

    # Combined spurt score
    max_spurt = max(opt_spurt, fut_spurt)
    extras["peakSpurt"] = round(max_spurt, 2)

    # When history buffers are cold (spurt = 1.0 default),
    # derive signal from candle OI changes + PCR
    buffers_cold = len(history._options_oi_buf) < 5 and len(history._fut_oi_buf) < 5

    if buffers_cold and candles and len(candles) >= 2:
        # Use candle OI delta as OI spurt proxy
        oi_vals = [float(c.get("oi") or 0) for c in candles[-5:] if float(c.get("oi") or 0) > 0]
        if len(oi_vals) >= 2:
            oi_change_pct = _pct_change(oi_vals[0], oi_vals[-1])
            extras["candleOIChangePct"] = round(oi_change_pct, 2)
            if abs(oi_change_pct) > 1.0:
                max_spurt = 1.3 + min(abs(oi_change_pct) / 8.0, 1.7)
                extras["peakSpurt"] = round(max_spurt, 2)
            elif total_oi > 0:
                # Even mild OI changes matter — compute ratio-based spurt
                avg_oi = sum(oi_vals) / len(oi_vals)
                if avg_oi > 0:
                    max_spurt = oi_vals[-1] / avg_oi
                    extras["peakSpurt"] = round(max_spurt, 2)
        # Also use PCR for direction when spot_slope is flat
        if call_oi > 0 and put_oi > 0:
            pcr = put_oi / call_oi
            extras["pcr"] = round(pcr, 3)
            if spot_slope == 0:
                # Infer direction from PCR
                if pcr >= 1.2:
                    spot_slope = 0.001  # Treat as mild bullish
                elif pcr <= 0.8:
                    spot_slope = -0.001  # Treat as mild bearish

    if max_spurt >= 2.0:
        # Massive OI spurt — institutional move
        if spot_slope > 0:
            score = _clamp(0.5 + (max_spurt - 2.0) * 0.2, 0.5, 0.9)
            label = f"🔥 MASSIVE OI SPURT {max_spurt:.1f}x + Price ↑ → LONG BUILDUP"
        elif spot_slope < 0:
            score = _clamp(-0.5 - (max_spurt - 2.0) * 0.2, -0.9, -0.5)
            label = f"🔥 MASSIVE OI SPURT {max_spurt:.1f}x + Price ↓ → SHORT BUILDUP"
        else:
            score = 0.1
            label = f"🔥 MASSIVE OI SPURT {max_spurt:.1f}x — Direction unclear"
    elif max_spurt >= 1.5:
        if spot_slope > 0:
            score = 0.35
            label = f"⚡ OI Spurt {max_spurt:.1f}x + Bullish momentum"
        elif spot_slope < 0:
            score = -0.35
            label = f"⚡ OI Spurt {max_spurt:.1f}x + Bearish momentum"
        else:
            score = 0.05
            label = f"⚡ OI Spurt {max_spurt:.1f}x — Watching direction"
    elif max_spurt >= 1.2:
        score = 0.1 if spot_slope > 0 else (-0.1 if spot_slope < 0 else 0.0)
        label = f"Mild OI pickup ({max_spurt:.1f}x)"
    else:
        label = f"Normal OI flow ({max_spurt:.1f}x)"

    # Call vs Put OI spurt asymmetry
    if call_oi > 0 and put_oi > 0:
        pcr = put_oi / call_oi
        extras["pcr"] = round(pcr, 3)
        if pcr >= 1.3 and max_spurt >= 1.3:
            score += 0.1  # Put writing spurt = bullish
            extras["oiSkew"] = "PUT_HEAVY_SPURT"
        elif pcr <= 0.7 and max_spurt >= 1.3:
            score -= 0.1  # Call writing spurt = bearish
            extras["oiSkew"] = "CALL_HEAVY_SPURT"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["oi_spurts"],
        "extra": extras,
    }


def _iv_estimation_signal(
    iv_est: float, history: EdgeHistory, vix: float
) -> Dict[str, Any]:
    """
    IV Estimation — Implied volatility level and direction.

    IV is approximated from:
    - India VIX (broad market IV proxy)
    - Realized volatility from recent candles
    - ATR expansion/contraction

    High IV = expensive options, possible reversal
    Low IV = cheap options, possible breakout setup
    """
    score = 0.0
    label = "Normal IV"
    extras: Dict[str, Any] = {}

    extras["ivEstimate"] = round(iv_est, 2)
    extras["vix"] = round(vix, 2)

    iv_slope = history.iv_slope
    extras["ivSlope"] = round(iv_slope, 4)

    if iv_est <= 0 and vix <= 0:
        # Fallback: infer from recent IV history if any was ever pushed
        iv_vals = list(history._iv_buf)
        if iv_vals:
            iv_est = iv_vals[-1]
            extras["ivEstimate"] = round(iv_est, 2)
            extras["ivSource"] = "history"
        else:
            # Use a neutral-leaning default based on spot price volatility
            spot_vals = list(history._spot_buf)
            if len(spot_vals) >= 5:
                returns = [abs(spot_vals[i] - spot_vals[i-1]) / spot_vals[i-1] * 100
                           for i in range(1, len(spot_vals)) if spot_vals[i-1] > 0]
                if returns:
                    avg_move = sum(returns) / len(returns)
                    # Annualize: avg 5-min move × sqrt(75 candles/day × 252 days)
                    iv_est = round(avg_move * math.sqrt(75 * 252), 2)
                    extras["ivEstimate"] = iv_est
                    extras["ivSource"] = "realized_vol"
            if iv_est <= 0:
                return {"score": 0.0, "signal": "NEUTRAL", "label": "IV data unavailable",
                        "weight": EDGE_WEIGHTS["iv_estimation"], "extra": extras}

    # Use VIX as primary IV proxy — it IS implied vol.
    # Candle-derived IV is just realized vol, often far too low.
    effective_iv = vix if vix > 0 else iv_est

    if effective_iv >= 25:
        # Very high IV — options expensive, potential mean-reversion
        score = -0.3
        label = f"🔴 HIGH IV {effective_iv:.1f} — Options expensive, reversal possible"
        if iv_slope < 0:
            score = -0.1  # IV falling from high = normalizing
            label = f"IV falling from high ({effective_iv:.1f}) — Normalizing"
    elif effective_iv >= 18:
        # Elevated IV
        if iv_slope > 0:
            score = -0.15
            label = f"IV rising ({effective_iv:.1f}) — Increasing fear"
        else:
            score = 0.05
            label = f"IV stable-elevated ({effective_iv:.1f})"
    elif effective_iv >= 12:
        # Normal range
        if iv_slope > 0:
            score = -0.1
            label = f"IV picking up ({effective_iv:.1f}) — Watch for spike"
        else:
            score = 0.1
            label = f"🟢 Normal IV ({effective_iv:.1f}) — Options fairly priced"
    else:
        # Very low IV — cheap options, breakout potential
        score = 0.3
        label = f"🟢 LOW IV {effective_iv:.1f} — Cheap options, breakout setup"
        if iv_slope > 0:
            score = 0.4
            label = f"🟢 IV expanding from low ({effective_iv:.1f}) — Breakout forming"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["iv_estimation"],
        "extra": extras,
    }


def _iv_rank_signal(history: EdgeHistory) -> Dict[str, Any]:
    """
    IV Rank — Where is current IV relative to its historical range?

    IV Rank < 20 → Options are very cheap (good to BUY options)
    IV Rank 20-50 → Fair value
    IV Rank 50-80 → Elevated (option selling zone)
    IV Rank > 80 → Extreme (sell premium / expect IV crush)
    """
    score = 0.0
    label = "IV Rank loading"
    extras: Dict[str, Any] = {}

    rank = history.iv_rank
    percentile = history.iv_percentile
    extras["ivRank"] = round(rank, 1)
    extras["ivPercentile"] = round(percentile, 1)

    # When IV history is too short for reliable rank, use current IV level as proxy
    iv_history_cold = len(history._iv_history) < 10
    if iv_history_cold:
        iv_slope = history.iv_slope
        extras["ivSlope"] = round(iv_slope, 4)
        extras["historyWarmup"] = len(history._iv_history)

        # Use current IV value (preferring VIX) for basic classification
        iv_vals = list(history._iv_buf)
        current_iv = iv_vals[-1] if iv_vals and iv_vals[-1] > 0 else 0

        if current_iv > 0:
            if current_iv >= 25:
                score = -0.35
                label = f"High IV {current_iv:.1f} — Options expensive (rank building)"
            elif current_iv >= 18:
                score = -0.15
                label = f"Elevated IV {current_iv:.1f} — Moderately expensive (rank building)"
            elif current_iv <= 12:
                score = 0.3
                label = f"Low IV {current_iv:.1f} — Options cheap (rank building)"
            elif current_iv <= 15:
                score = 0.1
                label = f"Fair-low IV {current_iv:.1f} — Normal (rank building)"
            else:
                score = 0.0
                label = f"IV Rank warming up — IV {current_iv:.1f} (normal range)"
        elif iv_slope > 0.01:
            score = -0.15
            label = "IV rising — getting expensive (limited history)"
        elif iv_slope < -0.01:
            score = 0.15
            label = "IV falling — getting cheaper (limited history)"
        else:
            score = 0.0
            label = "IV Rank warming up — collecting data"
        return {"score": round(score, 4), "signal": _sig(score), "label": label,
                "weight": EDGE_WEIGHTS["iv_rank"], "extra": extras}

    if rank >= 80:
        score = -0.5
        label = f"🔴 EXTREME IV Rank {rank:.0f} — Sell premium zone"
    elif rank >= 60:
        score = -0.2
        label = f"Elevated IV Rank {rank:.0f} — Caution on buying"
    elif rank >= 40:
        score = 0.0
        label = f"Fair IV Rank {rank:.0f} — Balanced"
    elif rank >= 20:
        score = 0.2
        label = f"🟢 Low IV Rank {rank:.0f} — Options cheap"
    else:
        score = 0.5
        label = f"🟢 VERY LOW IV Rank {rank:.0f} — Buy options zone"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["iv_rank"],
        "extra": extras,
    }


def _futures_oi_signal(
    fut_oi: float, fut_price: float, spot_price: float,
    history: EdgeHistory, candles: List[Dict]
) -> Dict[str, Any]:
    """
    Futures OI Analysis — Institutional positioning via futures OI trends.

    OI Matrix (same as equity delivery analysis):
      Price ↑ + OI ↑ → LONG BUILDUP (institutions adding longs)
      Price ↑ + OI ↓ → SHORT COVERING (shorts exiting)
      Price ↓ + OI ↑ → SHORT BUILDUP (institutions adding shorts)
      Price ↓ + OI ↓ → LONG UNWINDING (longs exiting)

    OI velocity indicates conviction strength.
    """
    score = 0.0
    label = "Analyzing Futures OI"
    extras: Dict[str, Any] = {}
    profile = "NEUTRAL"

    if fut_oi <= 0:
        # Fallback: use spot price slope + PCR for basic positioning
        spot_slope = history.spot_slope
        # Try reading PCR from history or cache
        pcr_vals = list(history._put_oi_buf)
        call_vals = list(history._call_oi_buf)
        pcr = pcr_vals[-1] / call_vals[-1] if pcr_vals and call_vals and call_vals[-1] > 0 else 0
        extras["fallback"] = "spot_pcr"
        extras["spotSlope"] = round(spot_slope, 4)

        if spot_slope > 0:
            profile = "LONG_BUILDUP" if pcr >= 1.0 else "SHORT_COVERING"
            score = _clamp(0.2 + abs(spot_slope) * 20, 0.15, 0.5)
            label = f"{profile} — price rising (no futures data)"
        elif spot_slope < 0:
            profile = "SHORT_BUILDUP" if pcr <= 1.0 else "LONG_UNWINDING"
            score = _clamp(-0.2 - abs(spot_slope) * 20, -0.5, -0.15)
            label = f"{profile} — price falling (no futures data)"
        else:
            label = "Flat — no futures data available"

        extras["profile"] = profile
        return {"score": round(score, 4), "signal": _sig(score), "label": label,
                "weight": EDGE_WEIGHTS["futures_oi"], "extra": extras}

    oi_slope = history.fut_oi_slope
    spot_slope = history.spot_slope
    oi_vel = history.fut_oi_velocity
    extras["oiSlope"] = round(oi_slope, 4)
    extras["spotSlope"] = round(spot_slope, 4)
    extras["oiVelocity"] = round(oi_vel, 2)
    extras["futOI"] = fut_oi

    # Blend ring-buffer slope (60% weight) with live vs last-candle-close (40% weight)
    # so price direction flips immediately during a mid-session reversal instead
    # of waiting for the full 60-tick ring buffer to fill with new values.
    live_price_move = 0.0
    if spot_price > 0 and candles:
        last_close = float(candles[-1].get("close") or 0)
        if last_close > 0:
            live_price_move = (spot_price - last_close) / last_close * 100.0
    blended_spot = spot_slope * 0.60 + live_price_move * 0.40

    price_up = blended_spot > 0
    price_dn = blended_spot < 0
    if not price_up and not price_dn:
        price_up = spot_slope > 0
        price_dn = spot_slope < 0

    # OI × Price direction matrix (uses blended price direction)
    if price_up and oi_slope > 0:
        profile = "LONG_BUILDUP"
        score = _clamp(0.35 + min(abs(oi_vel) * 0.02, 0.35), 0.3, 0.8)
        label = f"LONG BUILDUP — Institutions adding longs (OI vel: {oi_vel:+.1f}%)"
    elif price_up and oi_slope <= 0:
        profile = "SHORT_COVERING"
        score = _clamp(0.15 + abs(blended_spot) * 10, 0.1, 0.4)
        label = "SHORT COVERING — Shorts exiting, mild bullish"
    elif price_dn and oi_slope > 0:
        profile = "SHORT_BUILDUP"
        score = _clamp(-0.35 - min(abs(oi_vel) * 0.02, 0.35), -0.8, -0.3)
        label = f"SHORT BUILDUP — Institutions adding shorts (OI vel: {oi_vel:+.1f}%)"
    elif price_dn and oi_slope <= 0:
        profile = "LONG_UNWINDING"
        score = _clamp(-0.15 + abs(blended_spot) * -10, -0.4, -0.1)
        label = "LONG UNWINDING — Longs exiting, mild bearish"

    extras["profile"] = profile

    # Volume confirmation
    vol_surge = history.volume_surge
    extras["volumeSurge"] = round(vol_surge, 2)
    if vol_surge >= 2.0:
        # High volume confirms the OI signal
        score *= 1.2
        score = _clamp(score, -1.0, 1.0)
        extras["volumeConfirmed"] = True
    else:
        extras["volumeConfirmed"] = False

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["futures_oi"],
        "extra": extras,
    }


def _futures_basis_signal(
    fut_price: float, spot_price: float, history: EdgeHistory
) -> Dict[str, Any]:
    """
    Futures Basis (Premium/Discount) Analysis.

    Basis = (Futures Price - Spot Price) / Spot Price × 100
    Premium > fair value → Bullish institutional demand
    Discount → Bearish (hedging activity or selling)
    Basis trend (widening/narrowing) matters more than absolute level.
    """
    score = 0.0
    label = "Basis data loading"
    extras: Dict[str, Any] = {}

    if fut_price <= 0 or spot_price <= 0:
        # Fallback: use spot Price trend as weak basis proxy
        spot_slope = history.spot_slope
        if abs(spot_slope) > 0:
            direction_score = _clamp(spot_slope * 15, -0.3, 0.3)
            trend_label = "bullish" if spot_slope > 0 else "bearish"
            return {"score": round(direction_score, 4), "signal": _sig(direction_score),
                    "label": f"No futures data — spot trend {trend_label}",
                    "weight": EDGE_WEIGHTS["futures_basis"], "extra": {"fallback": "spot_trend"}}
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Futures data unavailable",
                "weight": EDGE_WEIGHTS["futures_basis"], "extra": extras}

    basis_pct = (fut_price - spot_price) / spot_price * 100.0
    basis_abs = fut_price - spot_price
    history.push_basis(basis_pct)
    extras["basisPct"] = round(basis_pct, 4)
    extras["basisAbs"] = round(basis_abs, 2)

    basis_slope = history.basis_slope
    extras["basisSlope"] = round(basis_slope, 4)

    if basis_pct >= 0.3:
        score = 0.4
        label = f"🟢 STRONG PREMIUM {basis_pct:.2f}% — Bullish institutional demand"
        if basis_slope > 0:
            score = 0.6
            label = f"🟢 PREMIUM WIDENING {basis_pct:.2f}% — Strong bullish"
    elif basis_pct >= 0.1:
        score = 0.2
        label = f"Mild premium {basis_pct:.2f}%"
        if basis_slope > 0:
            score = 0.3
    elif basis_pct <= -0.3:
        score = -0.4
        label = f"🔴 STRONG DISCOUNT {basis_pct:.2f}% — Bearish hedging"
        if basis_slope < 0:
            score = -0.6
            label = f"🔴 DISCOUNT WIDENING {basis_pct:.2f}% — Strong bearish"
    elif basis_pct <= -0.1:
        score = -0.2
        label = f"Mild discount {basis_pct:.2f}%"
        if basis_slope < 0:
            score = -0.3
    else:
        label = f"Flat basis {basis_pct:.2f}% — No edge"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["futures_basis"],
        "extra": extras,
    }


# ── Live Price Momentum — multi-anchor reversal detector ────────────────────

def _live_price_momentum_signal(candles: List[Dict], spot_price: float) -> Dict[str, Any]:
    """
    Live Price vs Candle-Close Anchors (20% weight) — HIGHEST RESPONSIVENESS.

    Compares live spot against 4 historical candle closes at increasing lookbacks.
    Runs on every broadcast tick (every 1.5s) — detects mid-session reversals
    within seconds, completely independent of slow EMA/OI ring-buffer signals.

    candles is oldest-first (chronological order).
    """
    if len(candles) < 2 or spot_price <= 0:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "Insufficient candles for live momentum",
            "weight": EDGE_WEIGHTS["live_price_momentum"], "extra": {},
        }

    closes = [float(c.get("close") or 0) for c in candles if float(c.get("close") or 0) > 0]
    if len(closes) < 2:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "No valid candle closes",
            "weight": EDGE_WEIGHTS["live_price_momentum"], "extra": {},
        }

    # Anchors: (lookback from end of closes list, contribution weight)
    # Recent anchors matter more — detects reversal in progress
    anchors = [(1, 4), (3, 3), (6, 2), (12, 1)]
    num = 0.0
    den = 0.0
    anchor_details: Dict[str, float] = {}

    for lb, w in anchors:
        if lb < len(closes):
            ac = closes[-lb]
            if ac > 0:
                pct = (spot_price - ac) / ac * 100.0
                # ±0.3% vs anchor = full score at that anchor
                clamped = _clamp(pct / 0.3, -1.0, 1.0)
                num += clamped * w
                den += w
                anchor_details[f"vs_{lb}c_ago"] = round(pct, 3)

    if den == 0:
        return {
            "score": 0.0, "signal": "NEUTRAL",
            "label": "No anchor data",
            "weight": EDGE_WEIGHTS["live_price_momentum"], "extra": {},
        }

    score = _clamp(num / den, -1.0, 1.0)

    # Also factor in the last 6 candles direction (recency-weighted candle consistency)
    recent = closes[-6:] if len(closes) >= 6 else closes
    bull_w = sum((2.0 if i >= len(recent) - 2 else 1.0)
                 for i, (o, c) in enumerate(zip(recent[:-1], recent[1:])) if c > o)
    bear_w = sum((2.0 if i >= len(recent) - 2 else 1.0)
                 for i, (o, c) in enumerate(zip(recent[:-1], recent[1:])) if c < o)
    candle_total = bull_w + bear_w
    if candle_total > 0:
        candle_dir = (bull_w - bear_w) / candle_total  # -1 to +1
        # 30% candle direction, 70% live anchor comparison
        score = _clamp(score * 0.70 + candle_dir * 0.30, -1.0, 1.0)

    if score >= 0.40:
        label = f"Strong upward momentum vs recent closes ({anchor_details})"
    elif score >= 0.15:
        label = f"Mild bullish momentum vs recent candle closes"
    elif score <= -0.40:
        label = f"Strong downward momentum vs recent closes"
    elif score <= -0.15:
        label = f"Mild bearish momentum vs recent candle closes"
    else:
        label = "Neutral — price near recent candle closes"

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EDGE_WEIGHTS["live_price_momentum"],
        "extra": {"anchors": anchor_details, "candleBullW": round(bull_w, 1), "candleBearW": round(bear_w, 1)},
    }


# ── Final aggregation ────────────────────────────────────────────────────────

def _finalize_edge(
    signals: Dict[str, Dict]
) -> Tuple[str, int, float, str]:
    """Weighted aggregation → direction, confidence, raw_score, action.

    Confidence uses signal agreement + magnitude + breadth,
    NOT just abs(raw_score) which produces ~2% when signals cancel.

    OI-profile alignment: When futures_oi shows a clear directional
    profile (LONG_BUILDUP / SHORT_BUILDUP), add a bias so the composite
    action does not contradict the OI profile.
    """
    total_score = 0.0
    bull_weight = 0.0
    bear_weight = 0.0
    contributing = 0

    for key, sig in signals.items():
        w = sig.get("weight", 0.0)
        s = sig.get("score", 0.0)
        total_score += w * s
        if abs(s) > 0.05:
            contributing += 1
            if s > 0:
                bull_weight += w * abs(s)
            else:
                bear_weight += w * abs(s)

    # OI-profile alignment bonus: prevent LONG_BUILDUP + NEUTRAL contradiction
    fut_oi_sig = signals.get("futures_oi", {})
    oi_profile = fut_oi_sig.get("extra", {}).get("profile", "NEUTRAL")
    oi_score = fut_oi_sig.get("score", 0.0)
    if oi_profile in ("LONG_BUILDUP", "SHORT_BUILDUP") and abs(oi_score) >= 0.30:
        # Strong directional OI: nudge composite toward the OI direction
        bias = 0.06 if oi_score > 0 else -0.06
        total_score += bias

    total_score = _clamp(total_score, -1.0, 1.0)

    if total_score >= STRONG_BULL_T:
        direction, action = "BULLISH", "STRONG_BUY"
    elif total_score >= BULL_T:
        direction, action = "BULLISH", "BUY"
    elif total_score <= STRONG_BEAR_T:
        direction, action = "BEARISH", "STRONG_SELL"
    elif total_score <= BEAR_T:
        direction, action = "BEARISH", "SELL"
    else:
        direction, action = "NEUTRAL", "NEUTRAL"

    # Agreement-based confidence
    dominant = max(bull_weight, bear_weight)
    opposing = min(bull_weight, bear_weight)
    agreement = (dominant - opposing) / max(0.01, dominant + opposing)

    if direction == "NEUTRAL":
        edge = abs(total_score) / max(BULL_T, 0.01)
        confidence = int(25 + edge * 23)  # 25-48%
    else:
        raw_contrib = min(1.0, abs(total_score) / 0.60) * 30    # 0-30 pts
        agree_contrib = agreement * 25                            # 0-25 pts
        breadth_contrib = min(5, contributing) / 5.0 * 15         # 0-15 pts
        confidence = int(35 + raw_contrib + agree_contrib + breadth_contrib)

    confidence = max(1, min(99, confidence))
    return direction, confidence, round(total_score, 4), action


# ── IV estimation from candle data ───────────────────────────────────────────

def _estimate_iv_from_candles(candles: List[Dict], spot: float) -> float:
    """
    Estimate implied volatility proxy from realized volatility (ATR).
    Annualized: IV_est ≈ (ATR / price) × sqrt(252) × 100
    """
    if not candles or len(candles) < 5 or spot <= 0:
        return 0.0

    ranges = []
    for c in candles[-20:]:
        h = float(c.get("high") or 0)
        l = float(c.get("low") or 0)
        if h > 0 and l > 0:
            ranges.append(h - l)

    if len(ranges) < 3:
        return 0.0

    atr = sum(ranges) / len(ranges)
    # 5-min candles → ~75 candles per day → annualize differently
    # Daily ATR ≈ intraday ATR × sqrt(75/len_used)
    candles_per_day = 75  # 6.25 hours × 12 candles/hour
    daily_atr = atr * math.sqrt(candles_per_day / min(len(ranges), candles_per_day))
    iv_est = (daily_atr / spot) * math.sqrt(252) * 100.0
    return round(iv_est, 2)


# ── Futures OI data shape per-index ──────────────────────────────────────────

class FuturesData:
    """Holds live futures metadata for one index."""
    __slots__ = ("price", "oi", "volume", "prev_close", "name")

    def __init__(self):
        self.price: float = 0.0
        self.oi: float = 0.0
        self.volume: float = 0.0
        self.prev_close: float = 0.0
        self.name: str = ""


# ── Main service class ───────────────────────────────────────────────────────

class MarketEdgeService:
    """
    📈 MarketEdge Intelligence Engine

    Reads from CacheService + kite.quote() for futures data.
    start() → _loop() → stop()
    get_snapshot() → latest payload (sync)
    """

    INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"]
    TICK_INTERVAL = 1.5    # 1.5-second broadcast cadence — faster reversal detection
    FUTURES_REFRESH = 5.0  # Refresh futures quote every 5s

    def __init__(self, cache: CacheService):
        self._cache = cache
        self._histories: Dict[str, EdgeHistory] = {
            sym: EdgeHistory() for sym in self.INDICES
        }
        self._futures: Dict[str, FuturesData] = {
            sym: FuturesData() for sym in self.INDICES
        }
        self._latest: Dict[str, Any] = {}
        self._last_spot: Dict[str, Dict] = {}
        self._task: Optional[asyncio.Task] = None
        self._futures_task: Optional[asyncio.Task] = None
        self._running = False
        self._last_futures_fetch = 0.0
        self._contracts: Dict[str, Dict] = {}

    def _get_kite(self):
        """Return authenticated KiteConnect instance or None."""
        try:
            from services.auth_state_machine import auth_state_manager
            kite = auth_state_manager.kite
            return kite if kite else None
        except Exception:
            return None

    def _refresh_contracts_sync(self):
        """Sync call: populate futures contract names from ContractManager."""
        kite = self._get_kite()
        if not kite:
            return
        try:
            from services.contract_manager import ContractManager
            cm = ContractManager(kite)
            for sym in self.INDICES:
                contracts = cm.get_all_contracts(sym)
                if contracts:
                    self._contracts[sym] = contracts
        except Exception as e:
            logger.debug(f"📈 Contract refresh error: {e}")

    async def _fetch_futures_data(self):
        """Fetch futures price + OI for near-month contracts via kite.quote()."""
        kite = self._get_kite()
        if not kite:
            return

        now = time.time()
        if now - self._last_futures_fetch < self.FUTURES_REFRESH:
            return
        self._last_futures_fetch = now

        ltp_keys: List[str] = []
        key_to_sym: Dict[str, str] = {}

        for sym in self.INDICES:
            contracts = self._contracts.get(sym, {})
            near = contracts.get("near", {})
            name = near.get("name", "") if isinstance(near, dict) else ""
            if not name:
                continue
            exch = "BFO" if sym == "SENSEX" else "NFO"
            key = f"{exch}:{name}"
            ltp_keys.append(key)
            key_to_sym[key] = sym
            self._futures[sym].name = name

        if not ltp_keys:
            return

        try:
            loop = asyncio.get_event_loop()
            quote_data = await loop.run_in_executor(None, lambda: kite.quote(ltp_keys))
            for key, sym in key_to_sym.items():
                entry = quote_data.get(key, {})
                if not entry:
                    continue
                fd = self._futures[sym]
                ltp = float(entry.get("last_price") or 0)
                if ltp > 0:
                    fd.price = ltp
                fd.oi = float(entry.get("oi") or 0)
                fd.volume = float(entry.get("volume") or 0)
                prev_close = float((entry.get("ohlc") or {}).get("close") or 0)
                if prev_close > 0:
                    fd.prev_close = prev_close
        except Exception as e:
            logger.debug(f"📈 Futures quote error: {e}")

    async def _read_spot(self, symbol: str) -> Optional[Dict]:
        """Read spot data from cache."""
        data = await self._cache.get_market_data(symbol)
        if data:
            self._last_spot[symbol] = data
            return data
        return self._last_spot.get(symbol)

    async def _read_candles(self, symbol: str) -> List[Dict]:
        """Read 5-min candles from cache."""
        raw = await self._cache.lrange(f"analysis_candles:{symbol}", 0, 49)
        result: List[Dict] = []
        for item in reversed(raw):
            c = _parse_candle(item)
            if c:
                result.append(c)
        return result

    def _read_vix(self) -> float:
        """Read India VIX from shared cache."""
        raw = _SHARED_CACHE.get("market:INDIAVIX")
        if raw:
            try:
                val = json.loads(raw[0]) if isinstance(raw[0], str) else raw[0]
                return float(val.get("price") or val.get("ltp") or 0)
            except Exception:
                pass
        return 0.0

    async def _compute(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Compute all MarketEdge signals for one index."""
        spot_data = await self._read_spot(symbol)
        if not spot_data:
            return None

        spot_price = float(spot_data.get("price") or 0)
        if spot_price <= 0:
            return None

        change_pct = float(spot_data.get("changePercent") or 0)
        call_oi = int(spot_data.get("callOI") or 0)
        put_oi = int(spot_data.get("putOI") or 0)
        total_oi = int(spot_data.get("oi") or 0)
        volume = float(spot_data.get("volume") or 0)
        is_live = spot_data.get("status") == "LIVE"

        # Fallback: read PCR directly from PCR service cache if spot data lacks it
        if call_oi == 0 and put_oi == 0:
            try:
                from services.pcr_service import _PCR_CACHE
                pcr_data = _PCR_CACHE.get(symbol, {})
                if pcr_data:
                    call_oi = int(pcr_data.get("callOI") or 0)
                    put_oi = int(pcr_data.get("putOI") or 0)
                    if total_oi == 0:
                        total_oi = call_oi + put_oi
            except Exception:
                pass

        candles = await self._read_candles(symbol)
        vix = self._read_vix()

        # Futures data
        fd = self._futures[symbol]
        fut_price = fd.price
        fut_oi = fd.oi

        # Estimate IV from candle ATR
        iv_est = _estimate_iv_from_candles(candles, spot_price)

        # Update histories
        hist = self._histories[symbol]
        hist.push_spot(spot_price)
        hist.push_options_oi(total_oi, call_oi, put_oi)
        hist.push_volume(volume)
        if fut_price > 0:
            hist.push_futures(fut_price, fut_oi)
        if iv_est > 0:
            hist.push_iv(iv_est)
        if vix > 0:
            hist.push_iv(vix)  # Always push VIX too — builds IV history faster

        # ── Compute all 5 signals ─────────────────────────────────────
        sig_oi_spurts = _oi_spurts_signal(call_oi, put_oi, total_oi, fut_oi, hist, candles)
        sig_iv = _iv_estimation_signal(iv_est, hist, vix)
        sig_iv_rank = _iv_rank_signal(hist)
        sig_fut_oi = _futures_oi_signal(fut_oi, fut_price, spot_price, hist, candles)
        sig_basis = _futures_basis_signal(fut_price, spot_price, hist)
        sig_live_mom = _live_price_momentum_signal(candles, spot_price)

        signals = {
            "oi_spurts":           sig_oi_spurts,
            "iv_estimation":       sig_iv,
            "iv_rank":             sig_iv_rank,
            "futures_oi":          sig_fut_oi,
            "futures_basis":       sig_basis,
            "live_price_momentum": sig_live_mom,
        }

        direction, confidence, raw_score, action = _finalize_edge(signals)
        data_source = "LIVE" if is_live else "MARKET_CLOSED"

        # Futures section data
        futures_section = {
            "price": round(fut_price, 2),
            "oi": fut_oi,
            "volume": fd.volume,
            "basis": round(fut_price - spot_price, 2) if fut_price > 0 else 0,
            "basisPct": round((fut_price - spot_price) / spot_price * 100, 4) if fut_price > 0 and spot_price > 0 else 0,
            "contractName": fd.name,
            "prevClose": fd.prev_close,
            "changePct": round(_pct_change(fd.prev_close, fut_price), 2) if fd.prev_close > 0 else 0,
        }

        # OI profile from futures_oi signal
        oi_profile = sig_fut_oi.get("extra", {}).get("profile", "NEUTRAL")

        return {
            "symbol": symbol,
            "direction": direction,
            "action": action,
            "confidence": confidence,
            "rawScore": raw_score,
            "oiProfile": oi_profile,
            "signals": signals,
            "futures": futures_section,
            "metrics": {
                "price": round(spot_price, 2),
                "changePct": round(change_pct, 2),
                "totalOI": total_oi,
                "callOI": call_oi,
                "putOI": put_oi,
                "volume": volume,
                "ivEstimate": iv_est,
                "ivRank": round(hist.iv_rank, 1),
                "ivPercentile": round(hist.iv_percentile, 1),
                "vix": round(vix, 2),
            },
            "dataSource": data_source,
            "timestamp": datetime.now(IST).isoformat(),
        }

    async def _loop(self):
        """Main background loop — compute and broadcast."""
        heartbeat_counter = 0
        contract_retry = 0
        while self._running:
            try:
                # Retry contract loading if still empty (kite may not be ready at startup)
                if not self._contracts:
                    contract_retry += 1
                    if contract_retry <= 20 or contract_retry % 60 == 0:
                        try:
                            await asyncio.to_thread(self._refresh_contracts_sync)
                            if self._contracts:
                                logger.info(f"📈 Futures contracts loaded: {list(self._contracts.keys())}")
                        except Exception:
                            pass

                # Fetch futures data (rate-limited internally)
                await self._fetch_futures_data()

                payload: Dict[str, Any] = {}
                for sym in self.INDICES:
                    result = await self._compute(sym)
                    if result:
                        payload[sym] = result
                        self._latest[sym] = result

                if payload:
                    await edge_manager.broadcast({
                        "type": "edge_update",
                        "data": payload,
                    })

                # Heartbeat every 30s
                heartbeat_counter += 1
                if heartbeat_counter >= int(30 / self.TICK_INTERVAL):
                    heartbeat_counter = 0
                    await edge_manager.broadcast({
                        "type": "edge_heartbeat",
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except Exception as e:
                logger.error(f"📈 MarketEdge loop error: {e}")

            await asyncio.sleep(self.TICK_INTERVAL)

    async def start(self):
        if self._running:
            return
        self._running = True
        try:
            await asyncio.to_thread(self._refresh_contracts_sync)
        except Exception:
            pass
        self._task = asyncio.create_task(self._loop())
        logger.info("📈 MarketEdge Intelligence Service: STARTED")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("📈 MarketEdge Intelligence Service: STOPPED")

    def get_snapshot(self) -> Dict[str, Any]:
        return dict(self._latest)


# ── Singleton ─────────────────────────────────────────────────────────────────

_edge_service: Optional[MarketEdgeService] = None


def get_market_edge_service() -> MarketEdgeService:
    global _edge_service
    if _edge_service is None:
        cache = CacheService()
        cache.connected = True
        _edge_service = MarketEdgeService(cache)
    return _edge_service

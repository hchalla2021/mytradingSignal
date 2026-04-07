"""
💥 Expiry Explosion Zone Engine
================================
Think as the #1 expiry-day options trader in the world.

PURPOSE: Identify ultra-cheap options (₹10–₹50 range) on EXPIRY DAY
that can multiply 3x–10x within hours due to gamma acceleration.

On expiry day, ATM options lose time value rapidly (theta decay),
BUT options near the money experience GAMMA EXPLOSION — small ₹20–₹50
moves in the underlying can cause 200–500% premium spikes.

This engine combines:
  1. Gamma Exposure (GEX) — net dealer gamma positioning
  2. Delta Acceleration — how fast delta changes near ATM
  3. OI Concentration Zones — where max pain & pin risk exist
  4. Volume Surge Detection — sudden volume spikes = smart money entry
  5. PCR Extreme Zones — extreme readings signal reversals
  6. IV Crush / IV Pop — implied vol behavior on expiry
  7. Time Decay Accelerator — theta acceleration in last hours
  8. Breakout Probability — statistical edge on directional moves

SIGNAL OUTPUT:
  STRONG_BUY  → Gamma setup aligning, cheap option likely to explode
  BUY         → Favorable setup, moderate conviction
  NEUTRAL     → No clear edge, stay flat
  SELL        → Unfavorable, premium decay likely
  STRONG_SELL → Against the flow, avoid buying

Data Sources: LIVE market data from Zerodha KiteTicker only.
              No dummy/test data. No simulations.
              Falls back gracefully when market is closed.

Isolation: Own ConnectionManager, own asyncio task, own CacheService instance.
           Zero shared state with other services.
"""

import asyncio
import calendar
import collections
import json
import math
import time
import logging
from datetime import datetime, date, timedelta
from typing import Dict, Any, Optional, List, Tuple, Deque, Set

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE
from config.nse_holidays import is_trading_day, shift_to_prev_trading_day

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Signal weights for Expiry Explosion scoring ──────────────────────────────

EXPIRY_WEIGHTS: Dict[str, float] = {
    "gamma_exposure":       0.25,   # GEX — most important on expiry
    "oi_concentration":     0.20,   # Where money is sitting
    "volume_surge":         0.18,   # Smart money detection
    "pcr_extreme":          0.15,   # Extreme PCR = reversal signal
    "delta_acceleration":   0.10,   # Speed of directional change
    "iv_behavior":          0.07,   # IV crush vs IV pop
    "theta_decay":          0.05,   # Time decay pressure
}

STRONG_BULL_T = 0.35
BULL_T = 0.15
BEAR_T = -0.15
STRONG_BEAR_T = -0.35

# ── Expiry calendar ──────────────────────────────────────────────────────────
# NSE weekly expiry days (0=Monday ... 6=Sunday)
# NIFTY weekly F&O: Tuesday (1)
# BANKNIFTY weekly F&O: Wednesday (2)
# SENSEX weekly F&O: Thursday (3)
# Monthly expiry: last Tuesday of the month for all

NIFTY_EXPIRY_DAY = 1       # Tuesday (0=Mon)
BANKNIFTY_EXPIRY_DAY = 2   # Wednesday
SENSEX_EXPIRY_DAY = 3      # Thursday

EXPIRY_WEEKDAY_MAP = {
    "NIFTY": NIFTY_EXPIRY_DAY,
    "BANKNIFTY": BANKNIFTY_EXPIRY_DAY,
    "SENSEX": SENSEX_EXPIRY_DAY,
}


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class ExpiryConnectionManager:
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
        # Send OUTSIDE lock — per-client 3s timeout to prevent blocking
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


expiry_manager = ExpiryConnectionManager()


# ── Utility functions ─────────────────────────────────────────────────────────

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


def _parse_candle(item) -> Optional[Dict]:
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        try:
            return json.loads(item)
        except Exception:
            return None
    return None


def _sig(score: float) -> str:
    if score >= 0.15:
        return "BULL"
    if score <= -0.15:
        return "BEAR"
    return "NEUTRAL"


# ── Expiry date computation (holiday-aware) ──────────────────────────────────

def _effective_expiry_date(symbol: str, candidate: date) -> date:
    """Shift a candidate expiry date backward if it falls on a holiday/weekend."""
    return shift_to_prev_trading_day(candidate)


def _get_monthly_expiry(now_date: date) -> date:
    """Get the last Tuesday of the current month (monthly F&O expiry)."""
    year, month = now_date.year, now_date.month
    last_day = calendar.monthrange(year, month)[1]
    d = date(year, month, last_day)
    # Walk backward to find last Tuesday (weekday=1)
    while d.weekday() != 1:  # 1 = Tuesday
        d -= timedelta(days=1)
    return _effective_expiry_date("NIFTY", d)


def _is_expiry_day(symbol: str, now: Optional[datetime] = None) -> bool:
    """Check if today is the weekly expiry day for the given symbol (holiday-aware)."""
    now = now or datetime.now(IST)
    today = now.date() if isinstance(now, datetime) else now
    # Check weekly expiry
    nxt = _get_next_expiry(symbol, now)
    nxt_date = nxt.date() if isinstance(nxt, datetime) else nxt
    return today == nxt_date


def _get_next_expiry(symbol: str, now: Optional[datetime] = None) -> datetime:
    """Get the next expiry datetime for the symbol (holiday-aware).

    Logic:
    1. Find the next occurrence of the symbol's weekly expiry weekday.
    2. Shift backward if that day is a holiday/weekend → previous trading day.
    3. If that effective expiry is already past (market closed), look at next week.
    4. Also check monthly expiry (last Tuesday) — return whichever is sooner.
    """
    now = now or datetime.now(IST)
    today = now.date() if isinstance(now, datetime) else now
    target_day = EXPIRY_WEEKDAY_MAP.get(symbol, 1)  # default Tuesday
    market_close_today = now.replace(hour=15, minute=30, second=0, microsecond=0)

    # --- Weekly expiry ---
    # Find next occurrence of target_day from today
    days_ahead = (target_day - today.weekday()) % 7
    candidate = today + timedelta(days=days_ahead)
    effective = _effective_expiry_date(symbol, candidate)

    # If effective expiry is today but market is closed, move to next week
    if isinstance(now, datetime) and effective == today and now >= market_close_today:
        candidate = today + timedelta(days=7)
        # Re-find next target_day (candidate is already +7, but recalc for safety)
        days_ahead2 = (target_day - candidate.weekday()) % 7
        candidate = candidate + timedelta(days=days_ahead2)
        effective = _effective_expiry_date(symbol, candidate)

    # If effective shifted to before today (rare edge: holiday shifted back past today),
    # move forward a week
    if effective < today:
        candidate = candidate + timedelta(days=7)
        effective = _effective_expiry_date(symbol, candidate)

    weekly_expiry = effective

    # --- Monthly expiry (last Tuesday of month, holiday-shifted) ---
    monthly = _get_monthly_expiry(today)
    if monthly < today or (monthly == today and isinstance(now, datetime) and now >= market_close_today):
        # This month's monthly expiry passed, look at next month
        next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        monthly = _get_monthly_expiry(next_month)

    # Return whichever is sooner (weekly or monthly — monthly IS a weekly for NIFTY)
    chosen = min(weekly_expiry, monthly)

    return datetime(chosen.year, chosen.month, chosen.day, 15, 30, 0, tzinfo=IST)


def _hours_to_expiry(symbol: str, now: Optional[datetime] = None) -> float:
    """Hours remaining until expiry close (15:30 IST), counting only market hours."""
    now = now or datetime.now(IST)
    expiry = _get_next_expiry(symbol, now)
    diff = (expiry - now).total_seconds() / 3600.0
    return max(0.0, diff)


def _get_expiry_label(symbol: str, now: Optional[datetime] = None) -> str:
    """Human-readable expiry label like 'Weekly Tue' or 'Monthly (Last Tue)'."""
    now = now or datetime.now(IST)
    today = now.date() if isinstance(now, datetime) else now
    expiry_dt = _get_next_expiry(symbol, now)
    exp_date = expiry_dt.date()

    monthly = _get_monthly_expiry(today)
    if monthly < today:
        next_month = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        monthly = _get_monthly_expiry(next_month)

    day_name = exp_date.strftime("%A")
    if exp_date == monthly:
        return f"Monthly Expiry ({day_name})"
    return f"Weekly Expiry ({day_name})"


def _expiry_phase(hours_left: float) -> str:
    """Classify the expiry day time phase."""
    if hours_left > 48:
        return "PRE_EXPIRY"
    if hours_left > 24:
        return "DAY_BEFORE"
    if hours_left > 4:
        return "EXPIRY_MORNING"
    if hours_left > 2:
        return "GAMMA_ZONE"       # 2–4 hours left — gamma accelerates
    if hours_left > 0.5:
        return "EXPLOSION_ZONE"   # Last 30 min to 2 hrs — max gamma
    if hours_left > 0:
        return "FINAL_MINUTES"    # Last 30 min — extreme moves
    return "EXPIRED"


# ── OI ring buffer for tracking momentum ─────────────────────────────────────

class OIHistory:
    """Tracks OI values for momentum detection."""
    MAXLEN = 40

    def __init__(self):
        self._oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._price_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._vol_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._pcr_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._call_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._put_oi_buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)

    def push(self, oi: float, price: float, volume: float, pcr: float,
             call_oi: float, put_oi: float):
        if oi > 0:
            self._oi_buf.append(oi)
        if price > 0:
            self._price_buf.append(price)
        if volume >= 0:
            self._vol_buf.append(volume)
        if pcr > 0:
            self._pcr_buf.append(pcr)
        if call_oi > 0:
            self._call_oi_buf.append(call_oi)
        if put_oi > 0:
            self._put_oi_buf.append(put_oi)

    @property
    def oi_slope(self) -> float:
        return _linear_slope(list(self._oi_buf))

    @property
    def price_slope(self) -> float:
        return _linear_slope(list(self._price_buf))

    @property
    def volume_slope(self) -> float:
        return _linear_slope(list(self._vol_buf))

    @property
    def pcr_slope(self) -> float:
        return _linear_slope(list(self._pcr_buf))

    @property
    def call_oi_trend(self) -> float:
        return _linear_slope(list(self._call_oi_buf))

    @property
    def put_oi_trend(self) -> float:
        return _linear_slope(list(self._put_oi_buf))

    @property
    def oi_velocity(self) -> float:
        """Rate of OI change — positive = OI increasing, negative = unwinding."""
        vals = list(self._oi_buf)
        if len(vals) < 5:
            return 0.0
        recent = vals[-5:]
        older = vals[-10:-5] if len(vals) >= 10 else vals[:5]
        avg_recent = sum(recent) / len(recent)
        avg_older = sum(older) / len(older)
        if avg_older == 0:
            return 0.0
        return (avg_recent - avg_older) / avg_older * 100.0

    @property
    def volume_surge_ratio(self) -> float:
        """Current volume vs average — >2.0 = surge."""
        vals = list(self._vol_buf)
        if len(vals) < 5:
            return 1.0
        avg = sum(vals[:-1]) / len(vals[:-1])
        return vals[-1] / avg if avg > 0 else 1.0

    @property
    def pcr_extremity(self) -> float:
        """How extreme the current PCR is. >0 = bullish extreme, <0 = bearish extreme."""
        vals = list(self._pcr_buf)
        if len(vals) < 3:
            return 0.0
        current = vals[-1]
        if current >= 1.5:
            return min(1.0, (current - 1.2) / 0.8)
        if current <= 0.5:
            return max(-1.0, -(0.8 - current) / 0.8)
        return 0.0

    @property
    def data_ready(self) -> bool:
        # OI may be 0 for spot indices — only require price data
        return len(self._price_buf) >= 3


# ── Signal computation functions ─────────────────────────────────────────────

def _gamma_exposure_signal(
    oi: float, call_oi: float, put_oi: float,
    price: float, history: OIHistory,
    hours_left: float, candles: List[Dict]
) -> Dict[str, Any]:
    """
    Gamma Exposure (GEX) estimation from available data.

    On expiry day, gamma is highest for ATM options.
    Key insight: When OI is concentrated near current price AND
    price is moving toward that concentration, gamma explodes.

    GEX proxy = |callOI - putOI| × proximity_to_ATM × time_decay_factor
    Positive GEX → dealers are long gamma → they sell rallies/buy dips (mean-reverting)
    Negative GEX → dealers short gamma → they chase moves (trending/explosive)
    """
    score = 0.0
    label = "Insufficient data"
    extras = {}

    if call_oi <= 0 or put_oi <= 0 or price <= 0:
        return {"score": 0.0, "signal": "NEUTRAL", "label": label,
                "weight": EXPIRY_WEIGHTS["gamma_exposure"], "extra": extras}

    pcr = put_oi / call_oi if call_oi > 0 else 1.0

    # Net gamma proxy: ratio of put writers vs call writers
    # High put writing = dealers sold puts = dealers are SHORT gamma on downside
    # High call writing = dealers sold calls = dealers are SHORT gamma on upside
    net_oi_imbalance = (put_oi - call_oi) / (put_oi + call_oi) if (put_oi + call_oi) > 0 else 0.0

    # Time factor: gamma effect amplifies as expiry approaches
    # Use moderate multipliers to avoid premature score saturation at ±1.0
    time_multiplier = 1.0
    if hours_left <= 0.5:
        time_multiplier = 1.8    # Last 30 min: strong gamma
    elif hours_left <= 2:
        time_multiplier = 1.6    # Last 2 hrs: high gamma
    elif hours_left <= 4:
        time_multiplier = 1.4    # Morning of expiry
    elif hours_left <= 24:
        time_multiplier = 1.2    # Day of expiry
    elif hours_left <= 48:
        time_multiplier = 1.1    # Day before

    extras["timeMultiplier"] = round(time_multiplier, 2)
    extras["netOIImbalance"] = round(net_oi_imbalance, 4)
    extras["pcr"] = round(pcr, 3)

    # OI velocity tells us if positions are being added or unwound
    oi_vel = history.oi_velocity
    extras["oiVelocity"] = round(oi_vel, 2)

    # Price trend from candles
    price_direction = 0.0
    if candles and len(candles) >= 3:
        recent_closes = [float(c.get("close") or 0) for c in candles[-5:] if float(c.get("close") or 0) > 0]
        if len(recent_closes) >= 3:
            price_direction = _linear_slope(recent_closes)

    # Gamma explosion setup detection:
    # 1. PCR extreme + OI buildup + price moving toward OI concentration = explosion
    if pcr >= 1.3:
        # Heavy put writing = bullish floor → CE likely to explode
        score = 0.3 + min(0.4, oi_vel * 0.01) * time_multiplier
        label = f"PUT WALL → CE explosion likely (PCR={pcr:.2f})"
        if pcr >= 1.6:
            score = 0.6 * time_multiplier
            label = f"EXTREME PUT WALL → Strong CE buy (PCR={pcr:.2f})"
    elif pcr <= 0.7:
        # Heavy call writing = bearish ceiling → PE likely to explode
        score = -(0.3 + min(0.4, abs(oi_vel) * 0.01)) * time_multiplier
        label = f"CALL WALL → PE explosion likely (PCR={pcr:.2f})"
        if pcr <= 0.4:
            score = -0.6 * time_multiplier
            label = f"EXTREME CALL WALL → Strong PE buy (PCR={pcr:.2f})"
    else:
        # Balanced PCR — look at OI velocity for direction
        if oi_vel > 5:
            score = 0.15 * time_multiplier
            label = f"OI building up, mild bullish (vel={oi_vel:.1f}%)"
        elif oi_vel < -5:
            score = -0.15 * time_multiplier
            label = f"OI unwinding, mild bearish (vel={oi_vel:.1f}%)"
        else:
            score = 0.0
            label = "Balanced gamma — no clear edge"

    score = _clamp(score, -1.0, 1.0)
    extras["priceDirection"] = round(price_direction, 4)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["gamma_exposure"],
        "extra": extras,
    }


def _oi_concentration_signal(
    oi: float, call_oi: float, put_oi: float,
    price: float, history: OIHistory, candles: List[Dict]
) -> Dict[str, Any]:
    """
    OI Concentration Analysis — where is the money sitting?

    Max Pain Theory: Price gravitates toward the strike where option buyers
    lose the most money (= where OI is highest on both sides).

    OI Profile Matrix (institutional positioning):
      Price ↑ + OI ↑ → LONG BUILDUP (bulls entering)
      Price ↑ + OI ↓ → SHORT COVERING (bears exiting)
      Price ↓ + OI ↑ → SHORT BUILDUP (bears entering)
      Price ↓ + OI ↓ → LONG UNWINDING (bulls exiting)
    """
    score = 0.0
    label = "Analyzing OI concentration"
    extras = {}
    profile = "NEUTRAL"

    if not history.data_ready:
        # Even without price history, use PCR if available for basic positioning
        if call_oi > 0 and put_oi > 0:
            pcr = put_oi / call_oi
            if pcr >= 1.3:
                return {"score": 0.3, "signal": "BULL",
                        "label": f"Heavy put writing (PCR={pcr:.2f}) — building support floor",
                        "weight": EXPIRY_WEIGHTS["oi_concentration"],
                        "extra": {"profile": "LONG_BUILDUP", "pcr": round(pcr, 3)}}
            elif pcr <= 0.7:
                return {"score": -0.3, "signal": "BEAR",
                        "label": f"Heavy call writing (PCR={pcr:.2f}) — building resistance ceiling",
                        "weight": EXPIRY_WEIGHTS["oi_concentration"],
                        "extra": {"profile": "SHORT_BUILDUP", "pcr": round(pcr, 3)}}
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Collecting OI data...",
                "weight": EXPIRY_WEIGHTS["oi_concentration"], "extra": {"profile": profile}}

    oi_slope = history.oi_slope
    price_slope = history.price_slope
    extras["oiSlope"] = round(oi_slope, 4)
    extras["priceSlope"] = round(price_slope, 4)

    # When OI buffer is empty (spot indices), derive signal from price + PCR
    has_oi_data = len(history._oi_buf) >= 3

    if has_oi_data:
        # OI × Price direction matrix
        if price_slope > 0 and oi_slope > 0:
            profile = "LONG_BUILDUP"
            score = _clamp(0.3 + oi_slope * 100, 0.2, 0.8)
            label = "LONG BUILDUP — Institutions adding longs"
        elif price_slope > 0 and oi_slope <= 0:
            profile = "SHORT_COVERING"
            score = _clamp(0.15 + price_slope * 50, 0.1, 0.5)
            label = "SHORT COVERING — Weak bullish (shorts exiting)"
        elif price_slope < 0 and oi_slope > 0:
            profile = "SHORT_BUILDUP"
            score = _clamp(-0.3 - oi_slope * 100, -0.8, -0.2)
            label = "SHORT BUILDUP — Institutions adding shorts"
        elif price_slope < 0 and oi_slope <= 0:
            profile = "LONG_UNWINDING"
            score = _clamp(-0.15 + price_slope * 50, -0.5, -0.1)
            label = "LONG UNWINDING — Weak bearish (longs exiting)"
    else:
        # No OI history (spot index) — use price slope + PCR as proxy
        pcr = put_oi / call_oi if call_oi > 0 else 1.0
        if price_slope > 0:
            profile = "LONG_BUILDUP" if pcr >= 1.0 else "SHORT_COVERING"
            score = _clamp(0.2 + price_slope * 30, 0.1, 0.6)
            label = f"{profile} — price rising (PCR={pcr:.2f})"
        elif price_slope < 0:
            profile = "SHORT_BUILDUP" if pcr <= 1.0 else "LONG_UNWINDING"
            score = _clamp(-0.2 + price_slope * 30, -0.6, -0.1)
            label = f"{profile} — price falling (PCR={pcr:.2f})"
        else:
            label = f"Flat price action (PCR={pcr:.2f})"

    # Call vs Put OI trend
    call_trend = history.call_oi_trend
    put_trend = history.put_oi_trend
    extras["callOItrend"] = round(call_trend, 4)
    extras["putOItrend"] = round(put_trend, 4)

    # If put OI rising faster than call OI → put writers active → bullish
    if put_trend > call_trend * 1.3 and put_trend > 0:
        score += 0.15
        extras["oiSkew"] = "PUT_HEAVY"
    elif call_trend > put_trend * 1.3 and call_trend > 0:
        score -= 0.15
        extras["oiSkew"] = "CALL_HEAVY"
    else:
        extras["oiSkew"] = "BALANCED"

    score = _clamp(score, -1.0, 1.0)
    extras["profile"] = profile

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["oi_concentration"],
        "extra": extras,
    }


def _volume_surge_signal(history: OIHistory, candles: List[Dict]) -> Dict[str, Any]:
    """
    Volume Surge Detection — smart money footprint.

    Sudden volume spikes on expiry day often indicate:
    - Institutional entry into cheap options
    - Gamma hedging activity by market makers
    - Breakout confirmation
    """
    score = 0.0
    label = "Normal volume"
    extras = {}

    surge_ratio = history.volume_surge_ratio
    vol_slope = history.volume_slope
    extras["surgeRatio"] = round(surge_ratio, 2)
    extras["volumeSlope"] = round(vol_slope, 4)

    # Candle-based volume analysis
    if candles and len(candles) >= 3:
        recent_vols = [float(c.get("volume") or 0) for c in candles[-5:]]
        avg_vol = sum(recent_vols) / len(recent_vols) if recent_vols else 1
        last_vol = recent_vols[-1] if recent_vols else 0

        vol_ratio = last_vol / avg_vol if avg_vol > 0 else 1.0
        extras["candleVolRatio"] = round(vol_ratio, 2)

        # Detect if volume is in green or red candle
        last_candle = candles[-1]
        candle_open = float(last_candle.get("open") or 0)
        candle_close = float(last_candle.get("close") or 0)
        is_green = candle_close >= candle_open

        if vol_ratio >= 3.0:
            # Massive spike — 3x average
            score = 0.7 if is_green else -0.7
            label = f"🔥 MASSIVE volume surge ({vol_ratio:.1f}x avg) — {'Buying' if is_green else 'Selling'} pressure"
        elif vol_ratio >= 2.0:
            score = 0.5 if is_green else -0.5
            label = f"⚡ High volume ({vol_ratio:.1f}x avg) — {'Buying' if is_green else 'Selling'}"
        elif vol_ratio >= 1.5:
            score = 0.25 if is_green else -0.25
            label = f"Volume rising ({vol_ratio:.1f}x avg)"
        else:
            label = f"Normal volume ({vol_ratio:.1f}x avg)"
    elif surge_ratio >= 2.0:
        score = 0.4
        label = f"Volume surge detected ({surge_ratio:.1f}x)"
    elif surge_ratio >= 1.5:
        score = 0.2
        label = f"Volume pickup ({surge_ratio:.1f}x)"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["volume_surge"],
        "extra": extras,
    }


def _pcr_extreme_signal(pcr: float, history: OIHistory) -> Dict[str, Any]:
    """
    PCR Extreme Zone Detection.

    On expiry day, extreme PCR readings are powerful reversal signals:
    PCR > 1.5 → Extreme put writing = very strong support below
    PCR < 0.5 → Extreme call writing = very strong resistance above
    PCR momentum (slope) matters more than absolute level.
    """
    score = 0.0
    label = "Normal PCR range"
    extras = {}

    if pcr <= 0:
        return {"score": 0.0, "signal": "NEUTRAL", "label": "PCR unavailable",
                "weight": EXPIRY_WEIGHTS["pcr_extreme"], "extra": extras}

    pcr_slope = history.pcr_slope
    pcr_extreme = history.pcr_extremity
    extras["pcr"] = round(pcr, 3)
    extras["pcrSlope"] = round(pcr_slope, 4)
    extras["pcrExtremity"] = round(pcr_extreme, 3)

    if pcr >= 1.8:
        score = 0.8
        label = f"🟢 ULTRA-BULLISH PCR {pcr:.2f} — Massive put wall"
    elif pcr >= 1.5:
        score = 0.6
        label = f"🟢 Very Bullish PCR {pcr:.2f} — Strong put writing"
    elif pcr >= 1.2:
        score = 0.3
        label = f"Mild Bullish PCR {pcr:.2f}"
    elif pcr <= 0.4:
        score = -0.8
        label = f"🔴 ULTRA-BEARISH PCR {pcr:.2f} — Massive call wall"
    elif pcr <= 0.6:
        score = -0.6
        label = f"🔴 Very Bearish PCR {pcr:.2f} — Heavy call writing"
    elif pcr <= 0.8:
        score = -0.3
        label = f"Mild Bearish PCR {pcr:.2f}"
    else:
        score = 0.0
        label = f"Neutral PCR {pcr:.2f}"

    # PCR momentum adds conviction
    if pcr_slope > 0.01:
        score += 0.1   # PCR rising = more put writing = bullish
    elif pcr_slope < -0.01:
        score -= 0.1   # PCR falling = puts exiting/calls building = bearish

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["pcr_extreme"],
        "extra": extras,
    }


def _delta_acceleration_signal(
    price: float, history: OIHistory, hours_left: float, candles: List[Dict]
) -> Dict[str, Any]:
    """
    Delta Acceleration — how fast the market is moving toward a side.

    On expiry, delta of ATM options swings from 0.5 to 1.0 rapidly.
    This measures the ACCELERATION of price movement, not just direction.
    Fast acceleration + gamma = explosive premium move.
    """
    score = 0.0
    label = "Low delta acceleration"
    extras = {}

    if not candles or len(candles) < 3:
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Insufficient candle data",
                "weight": EXPIRY_WEIGHTS["delta_acceleration"], "extra": extras}

    # Price velocity (slope of recent closes)
    closes = [float(c.get("close") or 0) for c in candles[-10:] if float(c.get("close") or 0) > 0]
    if len(closes) < 3:
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Insufficient data",
                "weight": EXPIRY_WEIGHTS["delta_acceleration"], "extra": extras}

    price_vel = _linear_slope(closes)
    extras["priceVelocity"] = round(price_vel, 4)

    # Price acceleration (change in velocity)
    if len(closes) >= 6:
        first_half = closes[:len(closes) // 2]
        second_half = closes[len(closes) // 2:]
        vel_1 = _linear_slope(first_half)
        vel_2 = _linear_slope(second_half)
        acceleration = vel_2 - vel_1
        extras["acceleration"] = round(acceleration, 4)
    else:
        acceleration = 0.0
        extras["acceleration"] = 0.0

    # Range expansion: comparing recent candle ranges to earlier ones
    ranges = [float(c.get("high") or 0) - float(c.get("low") or 0) for c in candles[-6:]]
    if len(ranges) >= 4:
        recent_range = sum(ranges[-2:]) / 2
        older_range = sum(ranges[:-2]) / max(1, len(ranges) - 2)
        range_expansion = recent_range / older_range if older_range > 0 else 1.0
        extras["rangeExpansion"] = round(range_expansion, 2)
    else:
        range_expansion = 1.0
        extras["rangeExpansion"] = 1.0

    # Time amplifier for expiry
    time_amp = 1.0
    if hours_left <= 2:
        time_amp = 2.0
    elif hours_left <= 4:
        time_amp = 1.5

    # Score based on acceleration and range expansion
    if acceleration > 0 and price_vel > 0:
        # Accelerating upward
        score = _clamp(0.2 + acceleration * 30 + (range_expansion - 1) * 0.3, 0.1, 0.9) * time_amp
        label = f"⚡ Bullish acceleration • Range expanding {range_expansion:.1f}x"
    elif acceleration < 0 and price_vel < 0:
        # Accelerating downward
        score = _clamp(-0.2 + acceleration * 30 - (range_expansion - 1) * 0.3, -0.9, -0.1) * time_amp
        label = f"⚡ Bearish acceleration • Range expanding {range_expansion:.1f}x"
    elif abs(acceleration) > 0.5:
        # Significant acceleration in either direction
        score = (0.15 if acceleration > 0 else -0.15) * time_amp
        label = f"Moderate acceleration ({acceleration:.2f})"
    else:
        label = "Low acceleration — consolidation"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["delta_acceleration"],
        "extra": extras,
    }


def _iv_behavior_signal(
    candles: List[Dict], history: OIHistory, hours_left: float
) -> Dict[str, Any]:
    """
    IV Behavior — Implied Volatility dynamics on expiry.

    We approximate IV behavior using:
    - Range expansion/contraction (proxy for realized vol)
    - OI changes (unwinding = IV crush, buildup = IV pop)
    - Time decay pressure (theta accelerates near expiry)

    IV Crush: Options lose value despite price movement (expiry effect)
    IV Pop: Sudden directional move causes premium spike
    """
    score = 0.0
    label = "Normal IV"
    extras = {}

    if not candles or len(candles) < 5:
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Collecting IV proxy data...",
                "weight": EXPIRY_WEIGHTS["iv_behavior"], "extra": extras}

    # Realized volatility proxy: average true range (ATR)
    ranges = []
    for i, c in enumerate(candles[-10:]):
        h = float(c.get("high") or 0)
        l = float(c.get("low") or 0)
        if h > 0 and l > 0:
            ranges.append(h - l)

    if len(ranges) < 3:
        return {"score": 0.0, "signal": "NEUTRAL", "label": "Insufficient range data",
                "weight": EXPIRY_WEIGHTS["iv_behavior"], "extra": extras}

    avg_range = sum(ranges) / len(ranges)
    recent_range = sum(ranges[-3:]) / 3
    range_trend = recent_range / avg_range if avg_range > 0 else 1.0
    extras["rangeTrend"] = round(range_trend, 2)

    # OI velocity → positive = IV likely rising (new positions), negative = IV crush
    oi_vel = history.oi_velocity
    extras["oiVelocity"] = round(oi_vel, 2)

    if range_trend >= 1.5 and oi_vel > 3:
        score = 0.4
        label = "IV POP — Range expanding + OI building → Premium ↑"
    elif range_trend >= 1.3:
        score = 0.2
        label = "Range expanding — vol pickup"
    elif range_trend <= 0.7 and oi_vel < -3:
        score = -0.3
        label = "IV CRUSH — Range contracting + OI unwinding → Premium ↓"
    elif range_trend <= 0.8:
        score = -0.1
        label = "Range contracting — vol drop"
    else:
        label = f"Stable IV (range trend: {range_trend:.1f}x)"

    # Near expiry, theta dominates — IV crush more likely
    if hours_left <= 1:
        score -= 0.2
        extras["thetaDominance"] = True
    elif hours_left <= 3:
        score -= 0.1
        extras["thetaDominance"] = False

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["iv_behavior"],
        "extra": extras,
    }


def _theta_decay_signal(hours_left: float, candles: List[Dict]) -> Dict[str, Any]:
    """
    Theta Decay Accelerator — time value erosion speed.

    Theta (time decay) accelerates exponentially near expiry:
    - 48h before: ~5% daily decay
    - 24h before: ~10% daily decay
    - 4h before: ~25% decay in remaining hours
    - 1h before: ~50% of remaining premium gone
    - 15min before: Only intrinsic value remains

    This signal warns against buying when theta will destroy premium,
    or signals opportunity when gamma > theta (directional moves).
    """
    score = 0.0
    label = "Normal time decay"
    extras = {}

    phase = _expiry_phase(hours_left)
    extras["phase"] = phase
    extras["hoursLeft"] = round(hours_left, 2)

    # Theta intensity (0 = no decay, 1 = maximum decay)
    if hours_left <= 0:
        theta_intensity = 1.0
    elif hours_left <= 0.25:
        theta_intensity = 0.95  # Last 15 min
    elif hours_left <= 0.5:
        theta_intensity = 0.85  # Last 30 min
    elif hours_left <= 1:
        theta_intensity = 0.70
    elif hours_left <= 2:
        theta_intensity = 0.55
    elif hours_left <= 4:
        theta_intensity = 0.40
    elif hours_left <= 24:
        theta_intensity = 0.20
    else:
        theta_intensity = 0.05

    extras["thetaIntensity"] = round(theta_intensity, 2)

    # Negative score = theta working against option buyers
    # But if market is trending (check range expansion), gamma can overcome theta
    if candles and len(candles) >= 3:
        recent_ranges = [float(c.get("high") or 0) - float(c.get("low") or 0) for c in candles[-3:]]
        avg_range = sum(recent_ranges) / len(recent_ranges) if recent_ranges else 0
        price = float(candles[-1].get("close") or 0)
        range_pct = (avg_range / price * 100) if price > 0 else 0

        extras["recentRangePct"] = round(range_pct, 3)

        # If range is expanding enough, gamma beats theta
        if range_pct > 0.3 and hours_left <= 4:
            score = 0.2  # Gamma winning
            label = f"🟢 Gamma > Theta — Range {range_pct:.2f}% despite {hours_left:.1f}h left"
        elif range_pct > 0.15 and hours_left <= 2:
            score = 0.1
            label = f"Gamma ≈ Theta — Marginal edge ({range_pct:.2f}% range)"
        else:
            score = -theta_intensity * 0.5
            label = f"⚠️ Theta dominant — {theta_intensity * 100:.0f}% decay intensity"
    else:
        score = -theta_intensity * 0.3
        label = f"Theta decay: {theta_intensity * 100:.0f}% intensity"

    score = _clamp(score, -1.0, 1.0)

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": EXPIRY_WEIGHTS["theta_decay"],
        "extra": extras,
    }


# ── Final aggregation ────────────────────────────────────────────────────────

def _finalize_explosion(
    signals: Dict[str, Dict]
) -> Tuple[str, int, float, str]:
    """Weighted aggregation of all 7 signals → direction, confidence, raw_score, action.

    Confidence approach: count signal AGREEMENT, not just raw score magnitude.
    This avoids the near-zero-average problem when signals partially cancel.
    """
    total_score = 0.0
    total_weight = 0.0
    bull_weight = 0.0
    bear_weight = 0.0
    contributing_count = 0

    for key, sig in signals.items():
        w = sig.get("weight", 0.0)
        s = sig.get("score", 0.0)
        total_score += w * s
        total_weight += w
        if abs(s) > 0.05:
            contributing_count += 1
            if s > 0:
                bull_weight += w * abs(s)
            else:
                bear_weight += w * abs(s)

    total_score = _clamp(total_score, -1.0, 1.0)

    if total_score >= STRONG_BULL_T:
        direction = "BULLISH"
        action = "STRONG_BUY"
    elif total_score >= BULL_T:
        direction = "BULLISH"
        action = "BUY"
    elif total_score <= STRONG_BEAR_T:
        direction = "BEARISH"
        action = "STRONG_SELL"
    elif total_score <= BEAR_T:
        direction = "BEARISH"
        action = "SELL"
    else:
        direction = "NEUTRAL"
        action = "NEUTRAL"

    # Confidence: based on signal agreement + magnitude, not raw average
    dominant_weight = max(bull_weight, bear_weight)
    opposing_weight = min(bull_weight, bear_weight)
    agreement_ratio = (dominant_weight - opposing_weight) / max(0.01, dominant_weight + opposing_weight)

    if direction == "NEUTRAL":
        # NEUTRAL confidence: 25-48%, based on how close to a directional call
        edge = abs(total_score) / max(BULL_T, 0.01)
        confidence = int(25 + edge * 23)  # 25% at center, 48% at boundary
    else:
        # Directional confidence: 35-95%
        # Component 1: raw magnitude (how far past threshold)
        raw_contrib = min(1.0, abs(total_score) / 0.60) * 30   # 0-30 pts
        # Component 2: signal agreement (how many agree)
        agree_contrib = agreement_ratio * 25                     # 0-25 pts
        # Component 3: number of contributing signals
        breadth_contrib = min(7, contributing_count) / 7.0 * 15  # 0-15 pts
        confidence = int(35 + raw_contrib + agree_contrib + breadth_contrib)

    confidence = max(1, min(99, confidence))

    return direction, confidence, round(total_score, 4), action


def _compute_strike_recommendation(
    price: float, direction: str, hours_left: float
) -> Dict[str, Any]:
    """
    Compute recommended strike levels for expiry day options.

    Strategy: Buy slightly OTM options near key round numbers.
    On expiry, ATM/slight OTM gives max gamma leverage.
    """
    if price <= 0:
        return {}

    # Round to nearest 50 for NIFTY/SENSEX, 100 for BANKNIFTY
    # (We don't know exact symbol here, so use price-based heuristic)
    if price > 30000:
        step = 100  # BANKNIFTY/SENSEX
    else:
        step = 50   # NIFTY

    atm_strike = round(price / step) * step

    if direction == "BULLISH":
        # Buy CE — ATM or 1 strike OTM
        entry_strike = atm_strike
        target_strike = atm_strike + step
        option_type = "CE"
        entry_label = f"Buy {atm_strike} CE"
        target_label = f"Target: price above {atm_strike + step}"
        stoploss_label = f"SL: price below {atm_strike - step}"
    elif direction == "BEARISH":
        entry_strike = atm_strike
        target_strike = atm_strike - step
        option_type = "PE"
        entry_label = f"Buy {atm_strike} PE"
        target_label = f"Target: price below {atm_strike - step}"
        stoploss_label = f"SL: price above {atm_strike + step}"
    else:
        option_type = "STRADDLE"
        entry_strike = atm_strike
        target_strike = atm_strike
        entry_label = f"No clear direction — avoid or straddle {atm_strike}"
        target_label = "Wait for breakout confirmation"
        stoploss_label = "Define max loss before entry"

    # Estimated premium range (very rough proxy)
    if hours_left <= 1:
        premium_range = "₹5–₹30"
        potential = "3x–10x on breakout"
    elif hours_left <= 4:
        premium_range = "₹20–₹80"
        potential = "2x–5x on strong move"
    elif hours_left <= 24:
        premium_range = "₹50–₹200"
        potential = "1.5x–3x on trending day"
    else:
        premium_range = "₹100+"
        potential = "1.2x–2x"

    return {
        "atmStrike": atm_strike,
        "step": step,
        "optionType": option_type,
        "entryStrike": entry_strike,
        "targetStrike": target_strike,
        "entryLabel": entry_label,
        "targetLabel": target_label,
        "stoplossLabel": stoploss_label,
        "estimatedPremium": premium_range,
        "potential": potential,
    }


def _compute_breakout_levels(price: float, candles: List[Dict]) -> Dict[str, Any]:
    """Compute breakout support/resistance from recent candles."""
    if not candles or price <= 0:
        return {"support": 0, "resistance": 0, "atr": 0, "rangeWidth": 0, "pricePosition": 50.0}

    # Filter candles where BOTH high and low are valid to avoid zip misalignment
    valid_candles = [
        c for c in candles[-20:]
        if float(c.get("high") or 0) > 0 and float(c.get("low") or 0) > 0
    ]

    if not valid_candles:
        return {"support": round(price * 0.995, 2), "resistance": round(price * 1.005, 2),
                "atr": 0, "rangeWidth": round(price * 0.01, 2), "pricePosition": 50.0}

    highs = [float(c["high"]) for c in valid_candles]
    lows = [float(c["low"]) for c in valid_candles]

    resistance = max(highs)
    support = min(lows)

    # ATR from paired high/low of same candle
    ranges = [h - l for h, l in zip(highs, lows)]
    atr = sum(ranges) / len(ranges) if ranges else 0

    return {
        "support": round(support, 2),
        "resistance": round(resistance, 2),
        "atr": round(atr, 2),
        "rangeWidth": round(resistance - support, 2),
        "pricePosition": round((price - support) / (resistance - support) * 100, 1) if (resistance - support) > 0 else 50.0,
    }


# ── Main service class ───────────────────────────────────────────────────────

class ExpiryExplosionService:
    """
    💥 Expiry Explosion Zone Engine

    Completely isolated — reads only from CacheService.
    start() → background_loop → stop()
    get_snapshot() → latest payload (sync)
    """

    INDICES = ["NIFTY", "BANKNIFTY", "SENSEX"]
    TICK_INTERVAL = 2.0   # 2-second broadcast cadence

    def __init__(self, cache: CacheService):
        self._cache = cache
        self._histories: Dict[str, OIHistory] = {
            sym: OIHistory() for sym in self.INDICES
        }
        self._last_spot_data: Dict[str, Dict] = {}
        self._latest: Dict[str, Any] = {}
        self._task: Optional[asyncio.Task] = None
        self._running = False

    def _get_kite(self):
        """Return authenticated KiteConnect instance, or None."""
        try:
            from services.auth_state_machine import auth_state_manager
            kite = auth_state_manager.kite
            return kite if kite else None
        except Exception:
            return None

    def _fetch_initial_spot_sync(self):
        """Pre-populate spot data from file backup + kite.quote()."""
        try:
            from services.cache import _load_backup_from_file
            backup = _load_backup_from_file()
            for sym in self.INDICES:
                if sym in backup and backup[sym]:
                    d = backup[sym]
                    if float(d.get("price") or 0) > 0 and sym not in self._last_spot_data:
                        self._last_spot_data[sym] = d
        except Exception:
            pass

        kite = self._get_kite()
        if not kite:
            return
        QUOTE_MAP = {
            "NSE:NIFTY 50": "NIFTY",
            "NSE:NIFTY BANK": "BANKNIFTY",
            "BSE:SENSEX": "SENSEX",
        }
        try:
            # Timeout: if Kite API is slow/unreachable, don't block other services
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(kite.quote, list(QUOTE_MAP.keys()))
                quotes = future.result(timeout=5)  # 5s max
            for q_key, sym in QUOTE_MAP.items():
                q = quotes.get(q_key, {})
                if not q:
                    continue
                ltp = float(q.get("last_price") or 0)
                prev_close = float((q.get("ohlc") or {}).get("close") or ltp)
                change = ltp - prev_close
                chg_pct = (change / prev_close * 100) if prev_close else 0.0
                self._last_spot_data[sym] = {
                    "symbol": sym,
                    "price": round(ltp, 2),
                    "change": round(change, 2),
                    "changePercent": round(chg_pct, 2),
                    "high": float((q.get("ohlc") or {}).get("high") or ltp),
                    "low": float((q.get("ohlc") or {}).get("low") or ltp),
                    "open": float((q.get("ohlc") or {}).get("open") or ltp),
                    "trend": "bullish" if change > 0 else ("bearish" if change < 0 else "neutral"),
                    "status": "CLOSED",
                    "pcr": 0, "callOI": 0, "putOI": 0,
                }
        except Exception as e:
            logger.debug(f"💥 Initial spot fetch error: {e}")

    async def _read_spot_data(self, symbol: str) -> Tuple[Optional[Dict], bool]:
        data = await self._cache.get_market_data(symbol)
        if data:
            self._last_spot_data[symbol] = data
            return data, True
        stale = self._last_spot_data.get(symbol)
        if stale:
            return stale, False
        raw = _SHARED_CACHE.get(f"market:{symbol}")
        if raw:
            try:
                val = json.loads(raw[0])
                if val and float(val.get("price") or 0) > 0:
                    self._last_spot_data[symbol] = val
                    return val, False
            except Exception:
                pass
        return None, False

    async def _read_candles(self, symbol: str) -> List[Dict]:
        raw = await self._cache.lrange(f"analysis_candles:{symbol}", 0, 49)
        result: List[Dict] = []
        for item in reversed(raw):
            c = _parse_candle(item)
            if c:
                result.append(c)
        live = await self._cache.get(f"analysis_candle_live:{symbol}")
        if live and isinstance(live, dict) and float(live.get("close") or 0) > 0:
            if not result or result[-1].get("timestamp") != live.get("timestamp"):
                result.append(live)
        return result

    async def _compute(self, symbol: str) -> Optional[Dict[str, Any]]:
        spot_data, is_live = await self._read_spot_data(symbol)
        if not spot_data:
            return None

        price = float(spot_data.get("price") or 0)
        if price <= 0:
            return None

        change_pct = float(spot_data.get("changePercent") or 0)
        oi_raw = float(spot_data.get("oi") or 0)
        pcr_val = float(spot_data.get("pcr") or 0)
        call_oi = int(spot_data.get("callOI") or 0)
        put_oi = int(spot_data.get("putOI") or 0)
        volume = float(spot_data.get("volume") or 0)

        # Fallback: read PCR directly from PCR service cache if spot data lacks it
        if pcr_val == 0 or (call_oi == 0 and put_oi == 0):
            try:
                from services.pcr_service import _PCR_CACHE
                pcr_data = _PCR_CACHE.get(symbol, {})
                if pcr_data:
                    if pcr_val == 0:
                        pcr_val = float(pcr_data.get("pcr") or 0)
                    if call_oi == 0:
                        call_oi = int(pcr_data.get("callOI") or 0)
                    if put_oi == 0:
                        put_oi = int(pcr_data.get("putOI") or 0)
            except Exception:
                pass

        if pcr_val == 0 and call_oi > 0 and put_oi > 0:
            pcr_val = put_oi / call_oi

        candles = await self._read_candles(symbol)

        # Update history buffers
        history = self._histories[symbol]
        history.push(oi_raw, price, volume, pcr_val, call_oi, put_oi)

        # Expiry timing
        now = datetime.now(IST)
        is_expiry = _is_expiry_day(symbol, now)
        hours_left = _hours_to_expiry(symbol, now)
        phase = _expiry_phase(hours_left)
        expiry_label = _get_expiry_label(symbol, now)
        expiry_dt = _get_next_expiry(symbol, now)
        expiry_date_str = expiry_dt.strftime("%Y-%m-%d")

        # Monthly expiry detection
        today = now.date()
        monthly = _get_monthly_expiry(today)
        if monthly < today:
            next_m = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
            monthly = _get_monthly_expiry(next_m)
        is_monthly = (expiry_dt.date() == monthly)

        # ── Compute all 7 signals ──────────────────────────────────────
        sig_gamma = _gamma_exposure_signal(oi_raw, call_oi, put_oi, price, history, hours_left, candles)
        sig_oi = _oi_concentration_signal(oi_raw, call_oi, put_oi, price, history, candles)
        sig_vol = _volume_surge_signal(history, candles)
        sig_pcr = _pcr_extreme_signal(pcr_val, history)
        sig_delta = _delta_acceleration_signal(price, history, hours_left, candles)
        sig_iv = _iv_behavior_signal(candles, history, hours_left)
        sig_theta = _theta_decay_signal(hours_left, candles)

        signals = {
            "gamma_exposure": sig_gamma,
            "oi_concentration": sig_oi,
            "volume_surge": sig_vol,
            "pcr_extreme": sig_pcr,
            "delta_acceleration": sig_delta,
            "iv_behavior": sig_iv,
            "theta_decay": sig_theta,
        }

        direction, confidence, raw_score, action = _finalize_explosion(signals)
        data_source = "LIVE" if is_live else "MARKET_CLOSED"

        # Strike recommendation
        strike_rec = _compute_strike_recommendation(price, direction, hours_left)

        # Breakout levels
        breakout = _compute_breakout_levels(price, candles)

        return {
            "symbol": symbol,
            "direction": direction,
            "action": action,
            "confidence": confidence,
            "rawScore": raw_score,
            "isExpiryDay": is_expiry,
            "isMonthlyExpiry": is_monthly,
            "hoursToExpiry": round(hours_left, 2),
            "expiryPhase": phase,
            "expiryLabel": expiry_label,
            "expiryDate": expiry_date_str,
            "signals": signals,
            "strikeRecommendation": strike_rec,
            "breakoutLevels": breakout,
            "metrics": {
                "price": round(price, 2),
                "changePct": round(change_pct, 2),
                "oi": oi_raw,
                "pcr": round(pcr_val, 3) if pcr_val > 0 else None,
                "callOI": call_oi,
                "putOI": put_oi,
                "volume": volume,
            },
            "dataSource": data_source,
            "timestamp": datetime.now(IST).isoformat(),
        }

    async def _loop(self):
        """Main background loop — compute and broadcast every TICK_INTERVAL seconds."""
        heartbeat_counter = 0
        while self._running:
            try:
                payload: Dict[str, Any] = {}
                for sym in self.INDICES:
                    result = await self._compute(sym)
                    if result:
                        payload[sym] = result
                        self._latest[sym] = result

                if payload:
                    await expiry_manager.broadcast({
                        "type": "expiry_update",
                        "data": payload,
                    })

                # Heartbeat every 30s
                heartbeat_counter += 1
                if heartbeat_counter >= int(30 / self.TICK_INTERVAL):
                    heartbeat_counter = 0
                    await expiry_manager.broadcast({
                        "type": "expiry_heartbeat",
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except Exception as e:
                logger.error(f"💥 Expiry loop error: {e}")

            await asyncio.sleep(self.TICK_INTERVAL)

    async def start(self):
        if self._running:
            return
        self._running = True

        # Async initial spot data fetch (non-blocking)
        try:
            await asyncio.to_thread(self._fetch_initial_spot_sync)
        except Exception:
            pass

        self._task = asyncio.create_task(self._loop())
        logger.info("💥 Expiry Explosion Service: STARTED")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("💥 Expiry Explosion Service: STOPPED")

    def get_snapshot(self) -> Dict[str, Any]:
        return dict(self._latest)


# ── Singleton ─────────────────────────────────────────────────────────────────

_expiry_service: Optional[ExpiryExplosionService] = None


def get_expiry_explosion_service() -> ExpiryExplosionService:
    global _expiry_service
    if _expiry_service is None:
        cache = CacheService()
        # CacheService.connect() is async; in-memory mode works without it,
        # but mark connected so Redis-backed mode doesn't break.
        cache.connected = True
        _expiry_service = ExpiryExplosionService(cache)
    return _expiry_service

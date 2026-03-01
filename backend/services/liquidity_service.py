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

BULL_T =  0.20
BEAR_T = -0.20


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
    if len(series) < period:
        return None
    k = 2.0 / (period + 1)
    val = sum(series[:period]) / period
    for price in series[period:]:
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
    return round(total_pv / total_vol, 2) if total_vol > 0 else None


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


def _oi_buildup_signal(candles: List[Dict], spot_change_pct: float) -> Dict:
    """
    OI × Price direction matrix — detects WHERE institutions are positioning.

    Uses per-candle OI delta (oi - oi_prev) to classify:
      Long Buildup / Short Covering / Short Buildup / Long Unwinding
    """
    neutral = {
        "score": 0.0, "signal": "NEUTRAL",
        "label": "OI change unavailable — price proxy only",
        "weight": WEIGHTS["oi_buildup"], "value": None,
        "extra": {"profile": "NEUTRAL", "oiDeltaPct": 0.0, "lastOI": 0},
    }

    if not candles:
        return neutral

    # Recent 3 candles, weighted: last = 55%, prev = 30%, before = 15%
    recent   = candles[-3:] if len(candles) >= 3 else candles
    w_map    = [0.15, 0.30, 0.55][-len(recent):]
    total_w  = sum(w_map)

    oi_deltas   : List[float] = []
    price_moves : List[float] = []
    last_oi     = 0.0

    for c in recent:
        oi_end   = float(c.get("oi") or 0)
        oi_start = float(c.get("oi_prev") or oi_end)
        if oi_end > 0:
            oi_deltas.append(oi_end - oi_start)
            price_moves.append(float(c.get("close") or 0) - float(c.get("open") or 0))
            last_oi = oi_end

    if not oi_deltas or last_oi <= 0:
        # Fallback: derive weak signal from price momentum alone
        score = _clamp(spot_change_pct / 3.0, -0.20, 0.20)
        return {
            "score": round(score, 4), "signal": _sig(score),
            "label": "No OI in candles — price-direction proxy",
            "weight": WEIGHTS["oi_buildup"], "value": None,
            "extra": {"profile": "NEUTRAL", "oiDeltaPct": 0.0, "lastOI": 0},
        }

    weights_used = w_map[-len(oi_deltas):]
    tw = sum(weights_used)
    wt_oi    = sum(d * w for d, w in zip(oi_deltas, weights_used)) / tw
    wt_price = sum(p * w for p, w in zip(price_moves, weights_used)) / tw

    oi_pct = (wt_oi / last_oi) * 100  # weighted OI change as % of current OI

    price_up = wt_price > 0 or spot_change_pct > 0.10
    price_dn = wt_price < 0 or spot_change_pct < -0.10
    oi_up    = wt_oi > 0
    oi_dn    = wt_oi < 0

    # Magnitude: cap at 0.5% OI change = full signal
    magnitude = _clamp(abs(oi_pct) / 0.5, 0.25, 1.0)

    if price_up and oi_up:
        profile = "LONG_BUILDUP"
        score   = magnitude * 0.90
        label   = f"Long Buildup — OI ↑{abs(oi_pct):.3f}% + price rising"
    elif price_up and oi_dn:
        profile = "SHORT_COVERING"
        score   = magnitude * 0.40
        label   = f"Short Covering — OI ↓{abs(oi_pct):.3f}%, shorts exiting"
    elif price_dn and oi_up:
        profile = "SHORT_BUILDUP"
        score   = -magnitude * 0.90
        label   = f"Short Buildup — OI ↑{abs(oi_pct):.3f}% + price falling"
    elif price_dn and oi_dn:
        profile = "LONG_UNWINDING"
        score   = -magnitude * 0.40
        label   = f"Long Unwinding — OI ↓{abs(oi_pct):.3f}%, longs exiting"
    else:
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
            "profile":     profile,
            "oiDeltaPct":  round(oi_pct, 4),
            "lastOI":      round(last_oi, 0),
            "magnitude":   round(magnitude, 3),
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

    if len(candles) < 10 or spot_price <= 0:
        return neutral

    closes = [float(c.get("close") or 0) for c in candles if c.get("close")]
    if len(closes) < 10:
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

    return {
        "score": round(score, 4),
        "signal": _sig(score),
        "label": label,
        "weight": WEIGHTS["price_momentum"],
        "value": round(spot_price - (ema9 or spot_price), 2),
        "extra": {
            "ema9":    round(ema9, 2)  if ema9  else None,
            "ema20":   round(ema20, 2) if ema20 else None,
            "vwap":    round(vwap, 2)  if vwap  else None,
            "vwapDev": round(vwap_dev, 4) if vwap_dev is not None else None,
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

    sig_type = "BULL" if direction == "BULLISH" else ("BEAR" if direction == "BEARISH" else None)
    if sig_type:
        agreement = sum(s["weight"] for s in signals.values() if s["signal"] == sig_type)
        confidence = int(35 + agreement * 65)
    else:
        neutrality = 1.0 - (abs(raw) / max(abs(BULL_T), 0.01))
        confidence = int(40 + neutrality * 20)

    return direction, max(1, min(99, confidence)), round(raw, 4)


def _predict_5m_liquidity(signals: Dict) -> Tuple[str, int]:
    """
    5-minute forward prediction — emphasises fastest-moving signals.
    Returns (prediction_label, confidence_pct).
    """
    score = sum(signals[k]["score"] * W5M.get(k, 0) for k in signals)
    score = _clamp(score, -1.0, 1.0)

    if score >=  0.55: pred, base = "STRONG_BUY",  82
    elif score >=  0.25: pred, base = "BUY",         62
    elif score <= -0.55: pred, base = "STRONG_SELL", 82
    elif score <= -0.25: pred, base = "SELL",         62
    else:                pred, base = "NEUTRAL",      48

    conf = int(base + abs(score) * 14)
    return pred, max(1, min(99, conf))


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

        # ── Run 4 signals ──────────────────────────────────────────────────
        sig_pcr  = _pcr_sentiment_signal(pcr_val, call_oi, put_oi, self._pcr_buffers[symbol])
        sig_oi   = _oi_buildup_signal(candles, change_pct)
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

        oi_profile = sig_oi["extra"].get("profile", "NEUTRAL")
        data_source = "LIVE" if is_live else "MARKET_CLOSED"

        return {
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

            await asyncio.sleep(self.TICK_INTERVAL)

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
